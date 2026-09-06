import * as React from 'react';
import { StreamChatClient, StreamEvent } from '../api/StreamClient';
import { MessageProps, MessageStep } from '../components/MessageBubble/MessageBubble';
import { AttachedFile, ContextFigures, RunUsage, UsageFigures, UsagePayload } from '../api/types';
import { turnUsage } from '../common/usageSummary';
import { StepPath, appendStepAt, appendTextAt, patchStepAt } from './subAgentSteps';

export interface UseStreamChatOptions {
    client: StreamChatClient | null;
    onEvent?: (event: StreamEvent, assistantMessageId: string, updateMessage: (updater: (prev: string) => string) => void) => void;
    storageApiUrl?: string;
    /** Per-tool handlers and presentation, forwarded to MessageBubble. */
    tools?: MessageProps['tools'];
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
    jobId?: string,
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

/**
 * Failures the caller cannot clear by trying again: entitlement, quota and
 * authorisation are configuration, not weather. Telling someone to retry a
 * `model_not_entitled` denial sends them round a loop that can never succeed.
 */
const NON_RETRYABLE_ERROR_PATTERNS: RegExp[] = [
    /not entitled/i,
    /no model available/i,
    /insufficient[\s_]credits/i,
    /credits[\s_]exhausted/i,
    /not permitted/i,
    /forbidden/i,
    /unauthor(?:is|iz)ed/i,
    /not allowed/i,
];

/**
 * Turn a stream failure into something worth reading.
 *
 * The gateway and archiver already send a precise reason down the stream — e.g.
 * "Requested model gpt-5-mini is not entitled for partner plan 4 or tenant
 * plan 1". That used to be replaced wholesale with "Something went wrong.
 * Please try again.", which threw away the only actionable detail and then gave
 * advice that was wrong for this class of error.
 */
/**
 * Shown when a turn is still running but this page can no longer watch it.
 *
 * A stream token lives for 30 minutes while the events behind it are retained
 * for a day, so a reload late into a long turn has no usable credential and no
 * way to mint another. Nothing has failed, which is why this is not phrased as
 * an error and why retrying is not suggested — the run is still going and its
 * output will be in the transcript once it finishes.
 */
/** Shown in place of the rest of an answer the user chose to stop. */
export const STOPPED_NOTICE = '_Stopped._';

/**
 * What "Continue" says to the agent when the run it would have reattached to has
 * actually ended.
 *
 * Phrased as an instruction rather than a question so the model resumes instead
 * of asking what the user meant, and kept short so it does not dominate the
 * context it is appended to.
 */
export const CONTINUE_PROMPT = 'Please continue from where you stopped.';

export const STALE_TURN_NOTICE =
    'This turn is still running, but this page can no longer follow it live. '
    + 'Reload once it has finished to see the rest.';

export function describeStreamError(error: Error | undefined): string {
    const detail = error?.message?.trim();
    if (!detail) return 'Something went wrong. Please try again.';
    const permanent = NON_RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(detail));
    return permanent ? detail : `${detail}\n\nPlease try again.`;
}

export const useStreamChat = ({ client, onEvent, storageApiUrl, tools }: UseStreamChatOptions) => {
    const [messages, setMessages] = React.useState<MessageProps[]>([]);
    const [isThinking, setIsThinking] = React.useState(false);
    // Kept apart from isThinking so a resumed turn can show an indicator without
    // being able to disable the composer. See resumeTurn.
    const [isResuming, setIsResuming] = React.useState(false);
    // Set the moment the user asks to stop, cleared when the turn actually ends.
    // The gap between the two is real — the run stops at its next step boundary,
    // not on the click — so the button has to be able to say "asked".
    const [isStopping, setIsStopping] = React.useState(false);
    // The same fact as `isStopping`, readable from the teardown closure. State
    // captured at render time would be stale exactly when it is needed — the
    // turn ends after the click, so the closure that reports the outcome was
    // created before the user asked.
    const stoppingRef = React.useRef(false);
    // The last thing the user sent, kept so a failed turn can be re-sent
    // verbatim. Not read from the transcript: a failed turn's user message is
    // still on screen, but recovering the exact attachments from rendered props
    // would be reconstructing what we already had.
    const lastSentRef = React.useRef<{ text: string; files?: AttachedFile[] } | null>(null);
    const assistantIdRef = React.useRef<string | null>(null);
    const currentUserMessageIdRef = React.useRef<string | null>(null);
    /**
     * Which job opened each approval gate.
     *
     * The orchestrator binds an approval to one job and drops a verdict claiming
     * another, so a gate opened inside a sub-agent can only be answered against
     * that child. The gate's own frame is the only place that job id appears, so
     * it is kept here from the moment the request arrives until the user answers.
     */
    const approvalJobRef = React.useRef(new Map<string, string>());
    /** Which resume is the current one, so a superseded one clears nothing. */
    const resumeSeq = React.useRef(0);
    // ``continueTurn`` is declared before ``resumeTurn`` and needs to call it.
    // A ref rather than reordering the file: the two are mutually referential in
    // spirit — a resume is one way of continuing — and a ref says that without
    // shuffling three hundred lines.
    const resumeTurnRef = React.useRef<
        ((conversationId: string, assistantMessageId: string) => Promise<void>) | null
    >(null);

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

    /**
     * Build the stream handlers for one assistant bubble.
     *
     * Extracted from ``sendMessage`` because a resumed turn needs exactly the
     * same handling: a replay re-delivers the turn's frames verbatim, so the code
     * that interpreted them the first time is the code that must interpret them
     * again. Two paths sharing one implementation is also the only way they stay
     * in step — a second copy would drift on the first new event type.
     *
     * The per-turn state lives in the closure rather than in a ref, so two
     * bubbles can never share a sub-agent path map.
     */
    const buildStreamHandlers = React.useCallback((assistantId: string) => {
        // Which block each job's events belong in. The turn's own job is not in
        // here — an unknown job uuid means the root, which is also the correct
        // answer for every stream that has no sub-agents in it.
        const pathByJob = new Map<string, StepPath>();
        const pathFor = (event: any): StepPath =>
            pathByJob.get(event.data?.job_uuid) ?? [];
        // Whether an event comes from a sub-agent this turn started — a
        // delegated child *or* a handoff child. Not ``pathFor(event).length``:
        // a handoff child shares its parent's path, but its run is still its
        // own and its cost is still part of the turn.
        const isSubAgentJob = (event: any): boolean =>
            pathByJob.has(event.data?.job_uuid);

        // How many thinking blocks each step has already closed. A reasoning
        // model with tools thinks, calls a tool, and thinks again, so one step
        // can produce several blocks; keying only by step would merge them and
        // the second ``reasoning_complete`` would overwrite the first block's
        // text. Lives in the closure for the same reason ``pathByJob`` does —
        // two bubbles must not share it.
        const closedThinkingBlocks = new Map<string, number>();
        const thinkingStepKey = (event: any): string =>
            `${event.data?.job_uuid ?? 'self'}-step-${event.data?.step_sequence ?? '0'}`;
        const thinkingStepId = (event: any): string => {
            const key = thinkingStepKey(event);
            return `thinking-${key}-${closedThinkingBlocks.get(key) ?? 0}`;
        };

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

        // Fields on the turn's bubble itself (the usage footer, the pressure
        // flag) rather than on a step. Same routing rule as ``editSteps``: the
        // turn is one message, whichever job in the tree the event came from.
        const patchTurn = (
            patch: Partial<MessageProps> | ((message: MessageProps) => Partial<MessageProps>)
        ) => {
            setMessages(prev =>
                prev.map(m => {
                    if (m.id !== assistantId) return m;
                    return { ...m, ...(typeof patch === 'function' ? patch(m) : patch) };
                })
            );
        };

        // Record one sub-agent run's latest meter on the turn, keeping the name
        // ``sub_agent_started`` gave it. Replace, never add: snapshots.
        const recordSubAgentRun = (
            jobUuid: string,
            figures: UsageFigures,
            agentName?: string,
            context?: ContextFigures | null,
        ) => {
            patchTurn(m => {
                const previous = m.subAgentRuns?.[jobUuid];
                const run: RunUsage = {
                    agentName: agentName ?? previous?.agentName ?? null,
                    figures,
                    // A terminal event carries no context; keep the last prompt's.
                    context: context ?? previous?.context ?? null,
                };
                return { subAgentRuns: { ...m.subAgentRuns, [jobUuid]: run } };
            });
        };
        const NO_USAGE: UsageFigures = {
            steps: 0, input_tokens: 0, output_tokens: 0, credits_charged: 0, credits_waived: 0,
        };

        // A check-in is answered through the same endpoint as an approval, so
        // it is rendered as the same card; this is what the card says.
        const describeCheckIn = (elapsedSeconds: number, credits?: number): string => {
            const minutes = Math.floor(elapsedSeconds / 60);
            const seconds = elapsedSeconds % 60;
            const worked = minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`;
            const spent = credits !== undefined && credits > 0
                ? ` and used ${credits} ${credits === 1 ? 'credit' : 'credits'}`
                : '';
            return `The agent has been working for ${worked}${spent}. Continue?`;
        };

        const handleEvent = (event: StreamEvent) => {
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
                    // The child's meter starts at zero under its name, so the
                    // consumption card can count it before its first step settles.
                    recordSubAgentRun(child_job_uuid, NO_USAGE, agent_name || 'Sub-agent');
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
                console.debug('[useStreamChat] client_tool_call', { step_uuid, tool_slug, tool_input, hasHandler: Boolean(tools?.[tool_slug ?? '']) });
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
                    const owningJob = event.data?.job_uuid;
                    if (owningJob) {
                        approvalJobRef.current.set(approval_uuid, String(owningJob));
                    }
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

            // The run is waiting for token capacity, not failing. A notice with
            // no button: it resumes by itself, and the only thing the user needs
            // is to know why nothing is moving.
            if (event.type === 'rate_limited') {
                const seconds = Number(
                    event.data?.payload?.retry_after_seconds ?? 0
                );
                editSteps(steps => [
                    ...steps.filter(step => step.type !== 'notice'),
                    {
                        id: `${assistantId}-waiting`,
                        type: 'notice' as const,
                        content: seconds > 0
                            ? `Waiting for capacity — resuming in ${seconds}s…`
                            : 'Waiting for capacity…',
                    },
                ]);
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

            // What the step that just settled cost, and where the run stands.
            // Cumulative figures are replaced, never summed: the orchestrator
            // sends snapshots so a replayed event is idempotent. A sub-agent's
            // event updates only the shared tree figure on the turn's bubble —
            // its own steps and credits are its own run's, already counted in
            // the tree the parent shows.
            if (event.type === 'usage') {
                const payload = event.data?.payload as UsagePayload | undefined;
                if (payload?.run) {
                    if (isSubAgentJob(event)) {
                        // A sub-agent's run: its own meter under its own key,
                        // and the tree counter it carries — the turn's
                        // authoritative credit total, root and children alike.
                        recordSubAgentRun(
                            String(event.data?.job_uuid), payload.run, undefined, payload.context
                        );
                        if (payload.tree) patchTurn({ tree: payload.tree });
                    } else {
                        patchTurn({
                            usage: payload.run,
                            context: payload.context,
                            tree: payload.tree,
                        });
                    }
                }
                return;
            }

            // The run's final totals ride on the terminal events, so a client
            // that missed a usage frame still ends with the right number.
            if (event.type === 'end' || event.type === 'error') {
                const usage = event.data?.payload?.usage as UsageFigures | undefined;
                if (usage) {
                    if (isSubAgentJob(event)) {
                        recordSubAgentRun(String(event.data?.job_uuid), usage);
                    } else {
                        patchTurn({ usage });
                    }
                }
            }

            // The orchestrator paused between steps to ask whether the run
            // should continue (ADR-010's check-in). Answered through the same
            // endpoint as an approval, with the check-in uuid as the approval
            // uuid, so it is rendered as the same card and routed the same way.
            if (event.type === 'check_in_request') {
                const { check_in_uuid, elapsed_seconds } = event.data?.payload ?? {};
                if (check_in_uuid) {
                    const owningJob = event.data?.job_uuid;
                    if (owningJob) {
                        approvalJobRef.current.set(check_in_uuid, String(owningJob));
                    }
                    setMessages(prev => prev.map(m => {
                        if (m.id !== assistantId) return m;
                        const step: MessageStep = {
                            id: check_in_uuid,
                            type: 'confirm-request',
                            toolCallId: check_in_uuid,
                            toolName: 'continue_working',
                            confirmLabel: 'Continue working?',
                            confirmDescription: describeCheckIn(
                                Number(elapsed_seconds ?? 0),
                                turnUsage(m).turn.credits_charged,
                            ),
                            confirmStatus: 'pending',
                        };
                        return { ...m, steps: appendStepAt(m.steps ?? [], pathFor(event), step) };
                    }));
                }
                return;
            }

            if (event.type === 'check_in_resolved') {
                const { check_in_uuid, decision } = event.data?.payload ?? {};
                if (check_in_uuid) {
                    setApprovalStatus(
                        assistantId,
                        check_in_uuid,
                        decision === 'approved' ? 'confirmed' : 'rejected'
                    );
                }
                return;
            }

            // The last prompt reached 90% of the model's window. Not an error
            // and not a wait: the run goes on, and the footer turns amber.
            if (event.type === 'context_pressure') {
                if (pathFor(event).length === 0) {
                    patchTurn({ contextPressure: true });
                }
                return;
            }

            // The tree spent its credit ceiling: no run in it may start another
            // agent from here on. The user is told once; the model is not.
            if (event.type === 'tree_ceiling_reached') {
                const { credits_spent, max_tree_credits } = event.data?.payload ?? {};
                patchTurn({
                    tree: {
                        credits_spent: Number(credits_spent ?? 0),
                        max_tree_credits: max_tree_credits ?? null,
                        ceiling_reached: true,
                    },
                });
                return;
            }

            // A reasoning model's thinking, into its own collapsible block.
            // Handled before the generic chunk path below because the text is
            // NOT the answer: appending it to the bubble's content would put
            // the model's deliberation in its reply.
            if (event.type === 'reasoning' || event.type === 'reasoning_complete') {
                const text: string = event.data?.payload?.text ?? '';
                const path = pathFor(event);
                const stepId = thinkingStepId(event);
                if (event.type === 'reasoning') {
                    if (text) {
                        editSteps(steps =>
                            appendTextAt(steps, path, text, stepId, 'thinking')
                        );
                    }
                } else {
                    const key = thinkingStepKey(event);
                    editSteps(steps => {
                        // Create-then-patch so a client that connected
                        // mid-block — a reconnect, or a second tab — still
                        // gets the whole block from this one frame, having
                        // seen none of the deltas.
                        const withBlock = appendTextAt(
                            steps, path, '', stepId, 'thinking'
                        );
                        return patchStepAt(withBlock, path, stepId, {
                            content: text,
                            isFinished: true,
                        });
                    });
                    // The next delta on this step opens a fresh block.
                    closedThinkingBlocks.set(
                        key, (closedThinkingBlocks.get(key) ?? 0) + 1
                    );
                }
                return;
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
        };

        /**
         * Report a stream failure inside the bubble.
         *
         * Teardown is deliberately not done here: the send path clears its state
         * in a ``finally`` that also covers the abort paths this is never called
         * on, and the resume path has its own flag to clear.
         */
        const handleError = (error: Error) => {
            console.error('[useStreamChat] stream error:', error);
            // Its own block, with a button. Appending the failure to the answer
            // as prose was the previous behaviour and it had two problems: the
            // apology read as part of the reply, and there was nothing to press.
            //
            // Which button depends on what the turn already produced, which only
            // the message state knows — so it is decided here: a turn that has
            // said something can be *continued*, one that has not can only be
            // *retried*. Offering the wrong one either discards a partial answer
            // or silently starts a second billable turn.
            setMessages(prev => prev.map(m => {
                if (m.id !== assistantId) return m;
                const steps = m.steps ?? [];
                const producedSomething = Boolean(m.content?.trim())
                    || steps.some(step => step.type !== 'notice');
                return {
                    ...m,
                    steps: [
                        // A pending notice is replaced: the wait is over, and
                        // this is what it ended as.
                        ...steps.filter(step => step.type !== 'notice'),
                        {
                            id: `${assistantId}-error`,
                            type: 'error' as const,
                            content: describeStreamError(error),
                            recovery: producedSomething
                                ? ('continue' as const)
                                : ('retry' as const),
                        },
                    ],
                };
            }));
        };

        return { handleEvent, handleError };
    }, [onEvent, tools, setApprovalStatus, storageApiUrl, updateAssistantContent]);

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
            { id: assistantId, role: 'assistant', content: '', tools },
        ]);
        setIsThinking(true);

        lastSentRef.current = { text, files: attachedFiles };
        const handlers = buildStreamHandlers(assistantId);

        try {
            await client.sendMessage(
                text,
                handlers.handleEvent,
                () => {
                    // The wait, if there was one, is over. A notice left behind
                    // would claim the run is waiting after it has finished.
                    setMessages(prev => prev.map(m =>
                        m.id === assistantId
                            ? {
                                ...m,
                                steps: (m.steps ?? []).filter(
                                    x => x.type !== 'notice'
                                ),
                            }
                            : m
                    ));
                },
                handlers.handleError,
                fileIds,
            );
        } finally {
            // Say so, rather than letting the answer just stop. A cancelled turn
            // and a finished one look identical in the transcript otherwise, and
            // the user who pressed stop is the one person entitled to know which
            // happened. The steps that ran are kept: they ran, and they were
            // charged for.
            if (stoppingRef.current) {
                updateAssistantContent(assistantId, (prev) =>
                    (prev ? prev + '\n\n' : '') + STOPPED_NOTICE
                );
            }
            stoppingRef.current = false;
            // In a finally, not in onComplete/onError, because the abort paths
            // call neither: an aborted reader used to leave ``isThinking`` true
            // for good, and ``sendMessage`` early-returns while it is, so one
            // superseded turn permanently disabled sending.
            setIsThinking(false);
            setIsStopping(false);
            assistantIdRef.current = null;
            currentUserMessageIdRef.current = null;
        }
    }, [client, isThinking, buildStreamHandlers, tools, updateAssistantContent]);

    /**
     * Re-attach to a turn that is still running and let the replay rebuild it.
     *
     * ``assistantMessageId`` is the bubble the history read already rendered for
     * that turn, and this **clears** it rather than appending to it. Both halves
     * of that are deliberate:
     *
     * * Clearing, because the replay starts at the turn's own boundary and
     *   re-delivers every frame of it. Keeping the history-built steps would
     *   duplicate everything the archiver has already persisted — and still not
     *   recover the part that matters, since the tokens of the step that was in
     *   flight at reload time exist only on the stream: that step's persisted
     *   payload is empty until it completes.
     * * Writing into that id, because the persisted steps and the streamed ones
     *   are keyed differently (the database's step uuid versus the step's
     *   sequence), so the two cannot be interleaved into one bubble at all.
     *
     * ``isResuming`` is separate from ``isThinking`` on purpose. ``isThinking``
     * gates the composer and ``sendMessage``'s own re-entry guard, so reusing it
     * would let a resumed turn lock the only input in the UI — and with one flag
     * the send teardown and this setup would overwrite each other.
     */
    const resumeTurn = React.useCallback(async (
        conversationId: string,
        assistantMessageId: string,
    ) => {
        if (!client?.resumeStream || !client.hasLiveTurn?.(conversationId)) return;

        // A turn that reloaded before producing anything has no bubble at all —
        // jobsToMessageProps omits an assistant message with no text and no
        // steps — so make sure there is somewhere for the replay, or the notice,
        // to land. An existing bubble is left exactly as the history read
        // rendered it.
        setMessages(prev => prev.some(m => m.id === assistantMessageId)
            ? prev
            : [
                ...prev,
                {
                    id: assistantMessageId,
                    role: 'assistant' as const,
                    content: '',
                    steps: [],
                    tools,
                },
            ]);

        assistantIdRef.current = assistantMessageId;
        // The replayed attachments frame is correctly a no-op: this turn's
        // attachment metadata is already in the history-built user message.
        currentUserMessageIdRef.current = null;

        const handlers = buildStreamHandlers(assistantMessageId);

        // Blank the bubble on the first frame, not before it.
        //
        // Clearing is still required — the replay re-delivers every frame of the
        // turn, so keeping the history-built steps beside them would show
        // everything twice, and the two cannot be merged because the persisted
        // steps and the streamed ones are keyed differently. But doing it up
        // front meant an expired, stalled or superseded resume erased a
        // transcript it then had nothing to replace with. Deferring it to the
        // first frame makes the erasure conditional on the replay actually
        // arriving.
        let cleared = false;
        const clearOnFirstFrame = (event: StreamEvent) => {
            if (!cleared) {
                cleared = true;
                setMessages(prev => prev.map(m =>
                    m.id === assistantMessageId
                        ? { ...m, content: '', steps: [] }
                        : m
                ));
            }
            handlers.handleEvent(event);
        };

        const seq = ++resumeSeq.current;
        setIsResuming(true);
        try {
            const outcome = await client.resumeStream(
                conversationId, clearOnFirstFrame, handlers.handleError
            );
            if (outcome === 'expired' || outcome === 'stalled') {
                // Not describeStreamError: nothing failed. The turn is still
                // running on the server, this page just can no longer watch it.
                updateAssistantContent(assistantMessageId, (prev) =>
                    (prev ? prev + '\n\n' : '') + STALE_TURN_NOTICE
                );
            }
        } finally {
            // Only if this is still the current resume: a superseded one
            // finishing later must not clear the indicator that belongs to the
            // resume that replaced it.
            if (seq === resumeSeq.current) {
                setIsResuming(false);
                setIsStopping(false);
                assistantIdRef.current = null;
            }
        }
    }, [
        client, buildStreamHandlers, tools,
        updateAssistantContent,
    ]);

    /**
     * Ask the server to stop the turn in progress.
     *
     * Deliberately does **not** abort the stream. The reader is what delivers
     * the cancellation: the run stops at its next step boundary and writes a
     * terminal event, and reading that event is what settles the transcript
     * instead of leaving it frozen mid-answer. Aborting locally would also hide
     * the fact that the run keeps going and keeps being charged until the server
     * acts.
     *
     * A client with no `cancelTurn` cannot stop anything server-side, so nothing
     * pretends otherwise — the flag is left alone and the button stays as it was.
     */
    const stopTurn = React.useCallback(async () => {
        if (!client?.cancelTurn) {
            console.warn('[useStreamChat] this client cannot cancel a run');
            return;
        }
        stoppingRef.current = true;
        setIsStopping(true);
        try {
            await client.cancelTurn();
        } catch (error) {
            console.error('[useStreamChat] cancelling the turn failed', error);
            // Put the button back: the run is still going and the user must be
            // able to ask again.
            stoppingRef.current = false;
            setIsStopping(false);
        }
    }, [client]);

    /**
     * Re-send the turn that failed.
     *
     * For a failure that produced nothing — refused at admission, rate limited
     * past its retry, a stream that never opened. The failed pair is dropped
     * first so the transcript does not show the same prompt twice.
     */
    const retryTurn = React.useCallback(async () => {
        const last = lastSentRef.current;
        if (!last) return;
        setMessages(prev => {
            // Drop the trailing assistant bubble carrying the error, and the
            // user message it answered: sendMessage appends both again.
            const cut = [...prev];
            while (cut.length && cut[cut.length - 1].role === 'assistant') cut.pop();
            if (cut.length && cut[cut.length - 1].role === 'user') cut.pop();
            return cut;
        });
        await sendMessage(last.text, last.files);
    }, [sendMessage]);

    /**
     * Pick up a turn that produced output and then stopped.
     *
     * Two different situations, and telling them apart is the point. If the run
     * is still going and only the *connection* broke, this reattaches and costs
     * nothing. If the run itself ended, the only way forward is a new turn — so
     * it asks the agent to carry on, which is a fresh billable turn and is
     * labelled as such by the button that offers it.
     */
    const continueTurn = React.useCallback(async () => {
        const conversationId = (client as { getConversationId?: () => string | null })
            ?.getConversationId?.() ?? null;
        const canReattach = Boolean(
            conversationId && client?.hasLiveTurn?.(conversationId)
        );
        if (conversationId && canReattach) {
            const jobId = (client as { getLiveJobId?: (id: string) => string | null })
                .getLiveJobId?.(conversationId);
            if (jobId) {
                await resumeTurnRef.current?.(conversationId, `${jobId}-assistant`);
                return;
            }
        }
        await sendMessage(CONTINUE_PROMPT);
    }, [client, sendMessage]);

    resumeTurnRef.current = resumeTurn;

    /**
     * Replace the transcript with a thread loaded from history.
     *
     * ``approvalJobs`` maps each still-open gate in that thread to the job it
     * must be answered against. Without it a recovered approval card would post
     * its verdict at the session's current job — which for a reloaded thread is
     * no job at all, and for a gate opened inside a sub-agent is the wrong one;
     * the orchestrator drops a verdict claiming a job that did not open it, so
     * the button would appear to work and change nothing.
     */
    const loadConversation = React.useCallback((
        messages: MessageProps[],
        approvalJobs?: Map<string, string>,
    ) => {
        setMessages(messages);
        setIsThinking(false);
        assistantIdRef.current = null;
        currentUserMessageIdRef.current = null;
        // The gates recorded here belong to the thread being replaced. Keeping
        // them would grow the map for the life of the mount with entries no
        // rendered step can ever refer to again.
        approvalJobRef.current.clear();
        if (approvalJobs) {
            for (const [approvalUuid, jobUuid] of approvalJobs) {
                approvalJobRef.current.set(approvalUuid, jobUuid);
            }
        }
    }, []);

    const reset = React.useCallback(() => {
        setMessages([]);
        setIsThinking(false);
        // Also the escape hatch: if a resumed turn is following a run that has
        // stopped answering, "new chat" is what gives the user their composer
        // back.
        setIsResuming(false);
        setIsStopping(false);
        stoppingRef.current = false;
        resumeSeq.current += 1;
        assistantIdRef.current = null;
        currentUserMessageIdRef.current = null;
        approvalJobRef.current.clear();
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
                .submitApproval(
                    approvalUuid,
                    decision,
                    undefined,
                    approvalJobRef.current.get(approvalUuid),
                );
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
        isResuming,
        isStopping,
        sendMessage,
        resumeTurn,
        retryTurn,
        continueTurn,
        stopTurn,
        loadConversation,
        reset,
        confirmApproval,
        rejectApproval,
    };
};
