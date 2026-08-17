import * as React from 'react';
import { StreamChatClient, StreamEvent } from '../api/StreamClient';
import { MessageProps, MessageStep } from '../components/MessageBubble/MessageBubble';
import { AttachedFile } from '../api/types';
import { StepPath, appendStepAt, appendTextAt, patchStepAt } from './subAgentSteps';

export interface UseStreamChatOptions {
    client: StreamChatClient | null;
    onEvent?: (event: StreamEvent, assistantMessageId: string, updateMessage: (updater: (prev: string) => string) => void) => void;
    storageApiUrl?: string;
    /** External tool callbacks forwarded to MessageBubble's onToolCall prop. */
    onToolCall?: Record<string, (data: any) => Promise<any> | void>;
    /** Result previewers forwarded to MessageBubble's onToolPreview prop. */
    onToolPreview?: MessageProps['onToolPreview'];
    /** Per-tool action presentation, forwarded to MessageBubble. */
    toolActions?: MessageProps['toolActions'];
}

/**
 * Append a chunk of streamed text to the live assistant message.
 *
 * Streamed tokens are accumulated into a **`'text'` step on `m.steps`** rather
 * than into the message's top-level ``content`` field, so the step ordering in
 * a live stream matches the ordering the persisted history produces (see
 * ``mapSteps`` in useConversations.ts). Without this, text streamed *after* a
 * ``tool-call`` step would still render at the front of the bubble and only
 * reorder correctly after a reload.
 *
 * A new ``'text'`` step is created when there is no trailing ``'text'`` step to
 * extend (e.g. the previous step was a tool call), preserving true arrival
 * order. ``messageId``-unique ids keep React keys stable across appends.
 */
/** How many characters of a gated call's arguments to show the user. */
const MAX_APPROVAL_ARGS_CHARS = 400;

/**
 * The one method this hook needs from a client to settle an approval.
 *
 * Structurally typed rather than importing ``GatewayStreamClient``: the hook is
 * written against ``StreamChatClient``, and only the gateway client can answer a
 * gate. Narrowing to the single method keeps that optional without the hook
 * depending on the concrete class.
 */
type GatewayApprovalSubmitter = (
    approvalUuid: string,
    decision: 'approved' | 'denied',
    reason?: string,
) => Promise<void>;

/**
 * Describe a held tool call for the confirmation card.
 *
 * The arguments are shown, not just the tool name, because they are the thing
 * being approved: "fetch a web page" is not a decision a user can make, while
 * "fetch `https://example.com/pricing`" is. Truncated rather than omitted when
 * long — an approval prompt that hides what it is asking about is worse than one
 * that is slightly clipped.
 */
export function describeApprovalRequest(
    toolSlug: string,
    toolInput: any,
    dispatchMode?: string,
): string {
    const where = dispatchMode === 'client'
        ? 'in this app'
        : 'on the server';
    const entries = toolInput && typeof toolInput === 'object'
        ? Object.entries(toolInput as Record<string, any>)
        : [];
    if (entries.length === 0) {
        return `The assistant wants to run ${toolSlug} ${where}.`;
    }
    const rendered = entries
        .map(([key, value]) => {
            const shown = typeof value === 'string' ? value : JSON.stringify(value);
            return `${key}: ${shown}`;
        })
        .join('\n');
    const clipped = rendered.length > MAX_APPROVAL_ARGS_CHARS
        ? `${rendered.slice(0, MAX_APPROVAL_ARGS_CHARS)}…`
        : rendered;
    return `The assistant wants to run ${toolSlug} ${where} with:\n${clipped}`;
}

export const useStreamChat = ({ client, onEvent, storageApiUrl, onToolCall, onToolPreview, toolActions }: UseStreamChatOptions) => {
    const [messages, setMessages] = React.useState<MessageProps[]>([]);
    const [isThinking, setIsThinking] = React.useState(false);
    const assistantIdRef = React.useRef<string | null>(null);
    const currentUserMessageIdRef = React.useRef<string | null>(null);

    /**
     * Flip one ``confirm-request`` step to a settled state.
     *
     * Called from two places that must agree: optimistically when the user
     * clicks, and again when the server's ``approval_resolved`` event lands. The
     * second is idempotent with the first, which is the point — the click gives
     * immediate feedback and the event is what makes it true.
     *
     * ``messageId`` is optional because a decision can arrive after the run has
     * moved on to a later assistant message; searching every message is cheap
     * and avoids losing the update.
     */
    const setApprovalStatus = React.useCallback((
        messageId: string | null,
        approvalUuid: string,
        status: 'confirmed' | 'rejected',
    ) => {
        setMessages(prev =>
            prev.map(m => {
                if (!m.steps) return m;
                if (messageId && m.id !== messageId) return m;
                let changed = false;
                const steps = m.steps.map(s => {
                    if (s.type !== 'confirm-request' || s.toolCallId !== approvalUuid) {
                        return s;
                    }
                    changed = true;
                    return { ...s, confirmStatus: status };
                });
                return changed ? { ...m, steps } : m;
            })
        );
    }, []);

    const updateAssistantContent = React.useCallback((
        id: string,
        updater: (prev: string) => string,
        stepSequence?: string | number
    ) => {
        setMessages(prev =>
            prev.map(m => {
                if (m.id !== id) return m;

                const prevContent = m.content ?? '';
                const nextContent = updater(prevContent);
                if (nextContent === prevContent) return m;

                // Find or construct step sequence
                const seq = stepSequence !== undefined && stepSequence !== null && stepSequence !== ''
                    ? String(stepSequence)
                    : '';

                if (seq || (m.steps && m.steps.length > 0)) {
                    const steps = m.steps ?? [];
                    // If no explicit stepSequence is provided, we associate with a generic token step or the last step if it is a text step.
                    const stepId = seq ? `step-${seq}` : (steps.length > 0 && steps[steps.length - 1].type === 'text' ? steps[steps.length - 1].id : `step-token-${Date.now()}`);
                    const stepIndex = steps.findIndex(s => s.id === stepId);

                    let updatedSteps: MessageStep[];
                    if (stepIndex > -1) {
                        updatedSteps = [...steps];
                        updatedSteps[stepIndex] = {
                            ...updatedSteps[stepIndex],
                            content: nextContent.startsWith(prevContent)
                                ? (updatedSteps[stepIndex].content ?? '') + nextContent.slice(prevContent.length)
                                : nextContent,
                        };
                    } else {
                        const chunk = nextContent.startsWith(prevContent)
                            ? nextContent.slice(prevContent.length)
                            : nextContent;
                        updatedSteps = [
                            ...steps,
                            {
                                id: stepId,
                                type: 'text',
                                content: chunk,
                            }
                        ];
                    }
                    return {
                        ...m,
                        content: nextContent,
                        steps: updatedSteps,
                    };
                }

                return {
                    ...m,
                    content: nextContent,
                };
            })
        );
    }, []);

    console.log('useStreamChat initialized with client:', client, 'storageApiUrl:', storageApiUrl, 'messages:', messages);

    const sendMessage = React.useCallback(async (text: string, attachedFiles?: AttachedFile[]) => {
        if (!client || !text.trim() || isThinking) return;

        const userId = `user-${Date.now()}`;
        const assistantId = `assistant-${Date.now() + 1}`;
        assistantIdRef.current = assistantId;
        currentUserMessageIdRef.current = userId;

        const fileIds = attachedFiles?.map(f => f.file_id).filter(Boolean);
        const attachments = attachedFiles?.map(f => ({
            id: f.file_id,
            type: (f.content_type?.startsWith('image/') ? 'image' : 'file') as 'image' | 'file',
            url: f.localBlobUrl ?? '',
            name: f.filename,
            size: f.size_bytes,
            contentType: f.content_type ?? undefined,
            localUrl: f.localBlobUrl ?? undefined,
        }));

        setMessages(prev => [
            ...prev,
            { id: userId, role: 'user', content: text, attachments },
            { id: assistantId, role: 'assistant', content: '', onToolCall, onToolPreview, toolActions },
        ]);
        setIsThinking(true);

        // Which block each job's events belong in. The turn's own job is not in
        // here — an unknown job uuid means the root, which is also the correct
        // answer for every stream that has no sub-agents in it.
        const pathByJob = new Map<string, StepPath>();
        const pathFor = (event: any): StepPath =>
            pathByJob.get(event.data?.job_uuid) ?? [];

        // Every step mutation goes through here so routing is applied in one
        // place: a handler that appended directly would be correct until the
        // first sub-agent and then quietly wrong.
        const editSteps = (
            edit: (steps: MessageStep[]) => MessageStep[]
        ) => {
            setMessages(prev =>
                prev.map(m =>
                    m.id === assistantId ? { ...m, steps: edit(m.steps ?? []) } : m
                )
            );
        };

        await client.sendMessage(
            text,
            (event) => {
                // Handle attachment metadata events.
                if (event.type === 'attachments' && currentUserMessageIdRef.current && storageApiUrl) {
                    const jobUuid = event.data?.job_uuid;
                    let attachmentsJson = event.data?.attachments_json;
                    if (typeof attachmentsJson === 'string') {
                        try { attachmentsJson = JSON.parse(attachmentsJson); } catch { attachmentsJson = []; }
                    }
                    if (jobUuid && Array.isArray(attachmentsJson) && attachmentsJson.length > 0) {
                        setMessages(prev =>
                            prev.map(m => {
                                if (m.id !== currentUserMessageIdRef.current) return m;
                                if (!m.attachments || m.attachments.length === 0) return m;
                                const updatedAttachments = m.attachments.map((att, idx) => {
                                    const meta = attachmentsJson[idx];
                                    if (!meta || !meta.attachment_uuid) return att;
                                    return {
                                        ...att,
                                        id: meta.attachment_uuid,
                                        url: `${storageApiUrl.replace(/\/$/, '')}/api/v1/attachments/jobs/${jobUuid}/files/${meta.attachment_uuid}`,
                                        localUrl: undefined,
                                        contentType: meta.content_type || att.contentType,
                                        size: meta.size_bytes ?? att.size,
                                    };
                                });
                                return { ...m, attachments: updatedAttachments };
                            })
                        );
                    }
                }

                // Handle sub_agent_started: open a block for another agent's
                // run, and remember that its job's events belong inside it.
                // This must be handled before anything the child emits, which
                // is why the Orchestrator publishes it at dispatch time rather
                // than when the child finishes.
                if (event.type === 'sub_agent_started') {
                    const { step_uuid, child_job_uuid, agent_name, handoff } =
                        event.data?.payload ?? {};
                    if (step_uuid && child_job_uuid) {
                        const parentPath = pathFor(event);
                        // A handoff child speaks to the user directly, so its
                        // output stays at this level rather than being nested
                        // in a block belonging to the agent that stepped aside.
                        pathByJob.set(
                            child_job_uuid,
                            handoff ? parentPath : [...parentPath, step_uuid]
                        );
                        if (!handoff) {
                            editSteps(steps => appendStepAt(steps, parentPath, {
                                id: step_uuid,
                                type: 'sub-agent',
                                agentName: agent_name || 'Sub-agent',
                                toolStatus: 'running',
                                subSteps: [],
                            }));
                        }
                    }
                }

                // Handle tool_request: add a running tool-call step.
                if (event.type === 'tool_request') {
                    const { step_uuid, tool_slug, tool_input } = event.data?.payload ?? {};
                    if (step_uuid && tool_slug) {
                        editSteps(steps => appendStepAt(steps, pathFor(event), {
                            id: step_uuid,
                            type: 'tool-call',
                            toolName: tool_slug,
                            toolArgs: tool_input,
                            toolStatus: 'running',
                        }));
                    }
                }

                // Handle tool_result: update matching step to completed.
                if (event.type === 'tool_result') {
                    const { step_uuid, tool_output, status } = event.data?.payload ?? {};
                    if (step_uuid) {
                        // Also the completion signal for a ``sub-agent`` block:
                        // a delegated child answers on the same step uuid its
                        // anchor carries, so one handler settles both.
                        editSteps(steps => patchStepAt(steps, pathFor(event), step_uuid, {
                            toolStatus: (status === 'completed' ? 'completed' : 'failed') as MessageStep['toolStatus'],
                            toolResult: tool_output,
                        }));
                    }
                }

                // Handle client_tool_call: add a tool-call step. Most client tools
                // ack immediately (fire-and-forget preview), so they land as
                // 'completed'. Interactive tools that wait for user input (e.g.
                // ask_user_questions, whose form renders separately) stay 'running'
                // until the resume tool_result flips them to 'completed'.
                if (event.type === 'client_tool_call') {
                    const { step_uuid, tool_slug, tool_input } = event.data?.payload ?? {};
                    console.debug('[useStreamChat] client_tool_call', { step_uuid, tool_slug, tool_input, hasHandler: Boolean(onToolCall?.[tool_slug ?? '']) });
                    if (step_uuid && tool_slug) {
                        const isInteractive = tool_slug === 'ask_user_questions';
                        editSteps(steps => appendStepAt(steps, pathFor(event), {
                            id: step_uuid,
                            type: 'tool-call',
                            toolName: tool_slug,
                            toolArgs: tool_input,
                            toolStatus: isInteractive ? 'running' : 'completed',
                            ...(isInteractive ? {} : { toolResult: { status: 'previewed' } }),
                        }));
                    }
                }

                // Handle approval_request: the orchestrator is holding a tool
                // call and will not dispatch it until the user answers (ADR-006).
                // Rendered as a 'confirm-request' step whose toolCallId is the
                // approval_uuid, which is what submitApproval needs back.
                if (event.type === 'approval_request') {
                    const { approval_uuid, tool_slug, tool_input, dispatch_mode } =
                        event.data?.payload ?? {};
                    if (approval_uuid && tool_slug) {
                        editSteps(steps => appendStepAt(steps, pathFor(event), {
                            id: approval_uuid,
                            type: 'confirm-request',
                            toolCallId: approval_uuid,
                            toolName: tool_slug,
                            confirmLabel: tool_slug,
                            confirmDescription: describeApprovalRequest(
                                tool_slug, tool_input, dispatch_mode
                            ),
                            confirmStatus: 'pending',
                        }));
                    }
                }

                // Handle approval_resolved: authoritative confirmation of how a
                // gate was settled. Not redundant with the local button press —
                // a second tab watching this run never saw that press, and a
                // reload mid-decision has only this event to rebuild from.
                if (event.type === 'approval_resolved') {
                    const { approval_uuid, decision } = event.data?.payload ?? {};
                    if (approval_uuid) {
                        setApprovalStatus(
                            assistantId,
                            approval_uuid,
                            decision === 'approved' ? 'confirmed' : 'rejected'
                        );
                    }
                }

                if (onEvent) {
                    onEvent(event, assistantId, (updater) => updateAssistantContent(assistantId, updater, event.data?.step_sequence));
                    return;
                }
                const chunk: string =
                    event.data?.content ??
                    event.data?.delta ??
                    event.data?.text ??
                    (typeof event.data === 'string' ? event.data : '');
                if (chunk) {
                    const path = pathFor(event);
                    if (path.length > 0) {
                        // A sub-agent's tokens are its own. They go in its
                        // block, never into the turn's ``content`` — which is
                        // the answer the agent the user addressed gives.
                        const seq = event.data?.step_sequence;
                        editSteps(steps => appendTextAt(
                            steps,
                            path,
                            chunk,
                            `sub-${event.data?.job_uuid}-step-${seq ?? '0'}`
                        ));
                    } else {
                        updateAssistantContent(assistantId, (prev) => prev + chunk, event.data?.step_sequence);
                    }
                }
            },
            () => {
                setIsThinking(false);
                assistantIdRef.current = null;
                currentUserMessageIdRef.current = null;
            },
            (error) => {
                console.error('[useStreamChat] stream error:', error);
                // Append the error to a trailing 'text' step (or create one) so it
                // surfaces whether or not prior steps exist. Falls back to the
                // legacy content path when nothing has streamed yet.
                updateAssistantContent(assistantId, (prev) =>
                    (prev ? prev + '\n\n' : '') + 'Something went wrong. Please try again.'
                );
                setIsThinking(false);
                assistantIdRef.current = null;
                currentUserMessageIdRef.current = null;
            },
            fileIds,
        );
    }, [client, isThinking, onEvent, onToolCall, onToolPreview, toolActions, updateAssistantContent, storageApiUrl]);

    const loadConversation = React.useCallback((messages: MessageProps[]) => {
        setMessages(messages);
        setIsThinking(false);
        assistantIdRef.current = null;
        currentUserMessageIdRef.current = null;
    }, []);

    const reset = React.useCallback(() => {
        setMessages([]);
        setIsThinking(false);
        assistantIdRef.current = null;
        currentUserMessageIdRef.current = null;
        client?.reset?.();
    }, [client]);

    /**
     * Answer an approval-gated tool call (ADR-006).
     *
     * The optimistic flip comes first so the buttons stop being clickable
     * immediately — the run is suspended on this decision, and a double-click
     * would publish two verdicts for one gate. On failure the step is put back
     * to ``pending``: the orchestrator is still waiting, so leaving the card
     * settled would strand the run with no way to answer it.
     */
    const resolveApproval = React.useCallback(async (
        approvalUuid: string,
        decision: 'approved' | 'denied',
    ) => {
        if (!client || !('submitApproval' in client)) {
            console.warn(
                '[useStreamChat] no client able to submit approvals; ignoring decision'
            );
            return;
        }
        setApprovalStatus(null, approvalUuid, decision === 'approved' ? 'confirmed' : 'rejected');
        try {
            await (client as { submitApproval: GatewayApprovalSubmitter })
                .submitApproval(approvalUuid, decision);
        } catch (error) {
            console.error('[useStreamChat] submitting the approval failed', error);
            setMessages(prev =>
                prev.map(m => {
                    if (!m.steps) return m;
                    const steps = m.steps.map(s =>
                        s.type === 'confirm-request' && s.toolCallId === approvalUuid
                            ? { ...s, confirmStatus: 'pending' as const }
                            : s
                    );
                    return { ...m, steps };
                })
            );
        }
    }, [client, setApprovalStatus]);

    const confirmApproval = React.useCallback(
        (approvalUuid: string) => { void resolveApproval(approvalUuid, 'approved'); },
        [resolveApproval]
    );

    const rejectApproval = React.useCallback(
        (approvalUuid: string) => { void resolveApproval(approvalUuid, 'denied'); },
        [resolveApproval]
    );

    return {
        messages,
        isThinking,
        sendMessage,
        loadConversation,
        reset,
        confirmApproval,
        rejectApproval,
    };
};
