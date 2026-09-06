import { useCallback, useEffect, useRef, useState } from 'react';
import { GatewayStreamClient } from '../api/GatewayStreamClient';
import { ConversationDetail, ConversationJob, ConversationStep, ConversationSummary, PendingApproval, UsageFigures, ContextFigures, RunUsage, TreeFigures } from '../api/types';
import { MessageProps, MessageStep } from '../components/MessageBubble/MessageBubble';
import { describeApprovalRequest } from './useStreamChat';

function extractTextFromContentBlocks(responsePayload: any): string {
    if (!responsePayload || typeof responsePayload !== 'object') return '';
    const blocks = responsePayload.content_blocks;
    if (!Array.isArray(blocks)) return '';

    const textParts: string[] = [];
    for (const block of blocks) {
        if (block && block.type === 'text' && typeof block.text === 'string') {
            textParts.push(block.text);
        }
    }
    return textParts.join('\n\n');
}

/**
 * The thinking a step recorded, if any.
 *
 * A sibling of ``content_blocks``, never one of them: the orchestrator keeps
 * reasoning out of the blocks so it is never replayed to the model, which is
 * exactly why it has to be read separately here.
 */
function extractReasoning(responsePayload: any): string {
    if (!responsePayload || typeof responsePayload !== 'object') return '';
    const reasoning = responsePayload.reasoning;
    return typeof reasoning === 'string' ? reasoning : '';
}

function extractFinalText(steps: ConversationStep[]): string {
    // Walk backwards to find the last llm_call or final_synthesis with text content
    for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i];
        if (step.step_type === 'llm_call' || step.step_type === 'final_synthesis') {
            const text = extractTextFromContentBlocks(step.response_payload);
            if (text) return text;
        }
    }
    return '';
}

/**
 * The child a ``run_sub_agent`` step delegated to, from the same job's nested
 * list. The server sends both halves of the link — ``child_job_uuid`` on the
 * step, the job in ``sub_agent_jobs`` — so the block renders at the point in
 * the transcript where it was actually started, not appended at the end.
 */
function findSubAgentJob(
    step: ConversationStep,
    subAgentJobs: ConversationJob[]
): ConversationJob | undefined {
    if (!step.child_job_uuid) return undefined;
    return subAgentJobs.find(job => job.uuid === step.child_job_uuid);
}

function mapSteps(steps: ConversationStep[], subAgentJobs: ConversationJob[] = []): MessageStep[] {
    const messageSteps: MessageStep[] = [];

    for (const step of steps) {
        if (step.step_type === 'run_sub_agent') {
            const child = findSubAgentJob(step, subAgentJobs);
            messageSteps.push({
                id: step.uuid,
                type: 'sub-agent',
                agentName: child?.agent?.name || 'Sub-agent',
                // Recursive: a sub-agent may itself have delegated. Bounded by
                // MAX_SUB_AGENT_DEPTH server-side, so this cannot run away.
                subSteps: child ? mapSteps(child.steps, child.sub_agent_jobs ?? []) : [],
                content: child ? extractFinalText(child.steps) : '',
                toolStatus:
                    step.status === 'completed'
                        ? 'completed'
                        : step.status === 'running'
                            ? 'running'
                            : 'failed',
            });
        } else if (step.step_type === 'tool_call') {
            messageSteps.push({
                id: step.uuid,
                type: 'tool-call',
                toolName: step.tool_slug || 'Tool',
                toolArgs: step.tool_input,
                toolResult: step.tool_output,
                // Three-way, matching the sub-agent branch above. A two-way
                // completed/failed split was survivable only while the history
                // read hid unfinished jobs: now that a live turn is returned,
                // collapsing 'running' into 'failed' would draw every tool call
                // in flight as a red error on reload.
                toolStatus:
                    step.status === 'completed'
                        ? 'completed'
                        : step.status === 'running'
                            ? 'running'
                            : 'failed',
            });
        } else if (step.step_type === 'llm_call' || step.step_type === 'final_synthesis') {
            // Thinking first, in the order it streamed: the model deliberates,
            // then answers. Its own step so it renders as the same collapsible
            // block a live turn produces — a reload that dropped it made the
            // transcript disagree with what the user had just watched.
            const reasoning = extractReasoning(step.response_payload);
            if (reasoning) {
                messageSteps.push({
                    id: `${step.uuid}-thinking`,
                    type: 'thinking',
                    content: reasoning,
                    isFinished: true,
                });
            }
            const text = extractTextFromContentBlocks(step.response_payload);
            if (text) {
                messageSteps.push({
                    id: step.uuid,
                    type: 'text',
                    content: text,
                });
            } else if (!reasoning) {
                // Neither text nor thinking: the step's visible work is a tool
                // call, which is its own step. The empty block is what shows a
                // turn still in flight, so it stays — but only when there is
                // genuinely nothing else to draw.
                messageSteps.push({
                    id: step.uuid,
                    type: 'thinking',
                    content: '',
                    isFinished: true,
                });
            }
        }
    }

    return messageSteps;
}

/**
 * Render a run's held approvals as the same card a live gate produces.
 *
 * The identical shape ``useStreamChat`` builds from an ``approval_request``
 * event — a ``confirm-request`` step whose ``toolCallId`` is the
 * ``approval_uuid`` — so the buttons already wired on every message settle it
 * without knowing where it came from.
 */
/** The history record a paused run leaves for its "continue?" question (ADR-010). */
const CHECK_IN_TOOL_SLUG = 'continue_working';

function describeRecordedCheckIn(toolInput: any): string {
    const elapsed = Number(toolInput?.elapsed_seconds ?? 0);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const worked = minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`;
    return `The agent had been working for ${worked} and paused to ask whether to continue.`;
}

function approvalSteps(approvals: PendingApproval[] | undefined): MessageStep[] {
    return (approvals ?? []).map(approval => {
        // A check-in is recorded where a held tool call is, and answered the
        // same way; only its wording differs — nobody is approving a tool.
        const isCheckIn = approval.tool_slug === CHECK_IN_TOOL_SLUG;
        return {
            id: approval.approval_uuid,
            type: 'confirm-request' as const,
            toolCallId: approval.approval_uuid,
            toolName: approval.tool_slug,
            confirmLabel: isCheckIn ? 'Continue working?' : approval.tool_slug,
            confirmDescription: isCheckIn
                ? describeRecordedCheckIn(approval.tool_input)
                : describeApprovalRequest(
                    approval.tool_slug, approval.tool_input, approval.dispatch_mode
                ),
            confirmStatus: 'pending' as const,
        };
    });
}

/**
 * The usage footer of a turn loaded from history.
 *
 * Built from the job's persisted totals, which the Archiver stamps at
 * completion (and recomputes if a step lands late). ``credits_waived`` is not
 * totalled on the row, so a reloaded footer shows no waived badge — the live
 * ``usage`` event carries it while the run is in flight. Absent when the row
 * has no totals yet (a run still in progress at load time).
 */
function figuresOf(job: ConversationJob): UsageFigures {
    return {
        steps: job.total_steps ?? job.steps.length,
        input_tokens: job.total_input_tokens ?? 0,
        output_tokens: job.total_output_tokens ?? 0,
        credits_charged: job.total_credits_charged ?? 0,
        credits_waived: 0,
    };
}

/**
 * Every sub-agent under a job, recursively, each with its own totals. A turn's
 * cost is the root job plus all of these — the nested ``sub_agent_jobs`` are
 * what the Archiver stamped for the runs this turn started.
 */
function collectSubAgentRuns(jobs: ConversationJob[], into: Record<string, RunUsage>): void {
    for (const child of jobs) {
        into[child.uuid] = {
            agentName: child.agent?.name ?? null,
            figures: figuresOf(child),
            context: contextOf(child),
        };
        collectSubAgentRuns(child.sub_agent_jobs ?? [], into);
    }
}

/**
 * Where a run's last prompt sat against its model's window: the last LLM
 * step's input tokens over the job's ``context_window`` (null when the model's
 * limit is not seeded, so no ratio and no bar).
 */
function contextOf(job: ConversationJob): ContextFigures {
    const lastLlmStep = [...job.steps].reverse().find(step => step.step_type === 'llm_call');
    const inputTokens = lastLlmStep?.input_tokens ?? 0;
    const window = job.context_window ?? null;
    return {
        input_tokens: inputTokens,
        max_input_tokens: window,
        ratio: window ? Math.round((inputTokens / window) * 10000) / 10000 : null,
        max_output_tokens: null,
    };
}

function usageFromJob(job: ConversationJob): {
    usage: UsageFigures | null;
    context: ContextFigures | null;
    subAgentRuns: Record<string, RunUsage> | undefined;
    tree: TreeFigures | null;
} {
    if (job.total_credits_charged === null && job.total_input_tokens === null) {
        return { usage: null, context: null, subAgentRuns: undefined, tree: null };
    }
    const usage = figuresOf(job);
    const subAgentRuns: Record<string, RunUsage> = {};
    collectSubAgentRuns(job.sub_agent_jobs ?? [], subAgentRuns);
    const children = Object.values(subAgentRuns);
    // No Redis counter to read after the fact; the tree's spend is the sum of
    // what the Archiver stamped on every run in it.
    const tree: TreeFigures | null = children.length > 0
        ? {
            credits_spent: children.reduce((sum, run) => sum + run.figures.credits_charged, usage.credits_charged),
            max_tree_credits: null,
        }
        : null;
    // The last LLM step's prompt is the most recent measure of the window.
    const context = contextOf(job);
    return { usage, context, subAgentRuns: children.length > 0 ? subAgentRuns : undefined, tree };
}

/**
 * Which job each held approval must be answered against.
 *
 * The orchestrator binds an approval to the job that opened it and drops a
 * verdict claiming any other, so a gate opened inside a sub-agent is settled
 * against the **child** — the same routing rule as a client tool result. A live
 * gate carries its job on the event; a recovered one has only this.
 */
export function collectPendingApprovals(
    jobs: ConversationJob[]
): Map<string, string> {
    const byApproval = new Map<string, string>();
    for (const job of jobs) {
        for (const approval of job.pending_approvals ?? []) {
            byApproval.set(approval.approval_uuid, job.uuid);
        }
        for (const [uuid, owner] of collectPendingApprovals(job.sub_agent_jobs ?? [])) {
            byApproval.set(uuid, owner);
        }
    }
    return byApproval;
}

export function jobsToMessageProps(
    jobs: ConversationJob[],
    storageApiUrl?: string
): MessageProps[] {
    const messages: MessageProps[] = [];

    for (const job of jobs) {
        // An agent-started job has no user message: the *user* did not write its
        // prompt, another agent did. Rendering it would put words in their
        // mouth. Its assistant turn still shows, labelled with the agent that
        // produced it.
        //
        // Any parent counts, not only a handoff. A delegated child normally
        // renders nested inside its parent's turn and never reaches here — but
        // the server promotes one to top level when its anchor step is missing,
        // and that job's prompt is one agent's private instructions to another.
        // Requiring `handoff` too was what let those surface as the user's own
        // words.
        const isAgentStartedTurn = Boolean(job.triggered_by_job_uuid);

        // User message
        const attachments = job.attachments.map(att => ({
            id: att.uuid,
            type: (att.content_type?.startsWith('image/') ? 'image' : 'file') as 'image' | 'file',
            url: storageApiUrl
                ? `${storageApiUrl.replace(/\/$/, '')}/api/v1/attachments/jobs/${job.uuid}/files/${att.uuid}`
                : '',
            name: att.filename,
            size: att.size_bytes,
            contentType: att.content_type || undefined,
        }));

        if (!isAgentStartedTurn) {
            messages.push({
                id: job.uuid,
                role: 'user',
                content: job.user_prompt,
                attachments,
            });
        }

        // Assistant message
        const steps = mapSteps(job.steps, job.sub_agent_jobs ?? []);
        // Appended after the steps, not woven in by sequence: a held call has no
        // step row to sort against, and it is by definition the last thing the
        // run did — everything after it is waiting on the answer.
        steps.push(...approvalSteps(job.pending_approvals));
        const finalText = extractFinalText(job.steps);

        // A handoff *parent* often has nothing to say — it decided to hand over
        // and stopped. An empty bubble is worse than none.
        if (!finalText && steps.length === 0) continue;

        const { usage, context, subAgentRuns, tree } = usageFromJob(job);
        messages.push({
            id: `${job.uuid}-assistant`,
            role: 'assistant',
            content: finalText,
            steps,
            senderName: job.agent?.name,
            usage,
            context,
            subAgentRuns,
            tree,
        });
    }

    return messages;
}

/**
 * Whether any turn in this thread is waiting on a client tool this page owes.
 *
 * A ``tool_call`` step with ``dispatch_mode = 'client'`` that is still
 * ``running`` means the orchestrator dispatched the call to a browser and no
 * answer ever came back — the usual cause being that the browser was reloaded
 * while a questionnaire was open. Walks sub-agent jobs too, because a delegated
 * child can be the one holding the call.
 *
 * Used only to explain an unrecoverable turn. Recovery itself is by stream
 * replay, which needs no knowledge of which tool or which step: the replayed
 * ``client_tool_call`` frame goes to the same handler that served it live.
 */
export function hasPendingClientToolCall(jobs: ConversationJob[]): boolean {
    return findPendingClientToolCalls(jobs).length > 0;
}

/** A client tool call the browser still owes an answer for. */
export interface PendingClientToolCall {
    /** The job to POST the answer to. A sub-agent's call belongs to the child. */
    jobUuid: string;
    /** The orchestrator's correlation key for the call. */
    stepUuid: string;
    toolSlug: string;
    /** The arguments the agent called it with — for a questionnaire, the questions. */
    toolInput: any;
}

/**
 * Every client tool call in this thread that is still waiting on an answer.
 *
 * This is what makes a questionnaire answerable from a browser that did not
 * start the run. The alternative — replaying the stream — needs the credential
 * the *originating tab* holds, so it could never work anywhere else. Everything
 * needed to answer is in the transcript instead: the arguments in `tool_input`,
 * and the correlation key as the step's own uuid.
 *
 * That second part is only true of steps written after the orchestrator began
 * sending `StepRecord.uuid`. An older row carries an unrelated
 * `gen_random_uuid()`, and a POST against it is refused by the gateway rather
 * than silently dropped.
 *
 * Recurses into sub-agent jobs and reports the **child's** uuid as `jobUuid`,
 * because the orchestrator binds a step to the job that dispatched it and drops
 * an answer claiming any other.
 */
export function findPendingClientToolCalls(
    jobs: ConversationJob[]
): PendingClientToolCall[] {
    const found: PendingClientToolCall[] = [];
    for (const job of jobs) {
        for (const step of job.steps) {
            if (
                step.step_type === 'tool_call'
                && step.dispatch_mode === 'client'
                && step.status === 'running'
            ) {
                found.push({
                    jobUuid: job.uuid,
                    stepUuid: step.uuid,
                    toolSlug: step.tool_slug ?? '',
                    toolInput: step.tool_input,
                });
            }
        }
        found.push(...findPendingClientToolCalls(job.sub_agent_jobs ?? []));
    }
    return found;
}

const PAGE_SIZE = 20;

export interface UseConversationsResult {
    conversations: ConversationSummary[];
    isLoading: boolean;
    isLoadingMore: boolean;
    hasMore: boolean;
    activeConversationId: string | null;
    fetchConversations: () => Promise<void>;
    loadMore: () => Promise<void>;
    /**
     * Load a thread and make it the active one.
     *
     * Returns the raw ``detail`` as well as the rendered messages because the
     * caller has to decide, in the same tick, whether this thread has a turn to
     * resume — and React state set inside this callback is not visible to the
     * closure that awaited it, so handing it back is the only way it arrives in
     * time.
     */
    selectConversation: (
        id: string
    ) => Promise<{ messages: MessageProps[]; detail: ConversationDetail } | null>;
    newChat: () => void;
}

export function useConversations(
    client: GatewayStreamClient | null,
    storageApiUrl?: string
): UseConversationsResult {
    const [conversations, setConversations] = useState<ConversationSummary[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [offset, setOffset] = useState(0);
    const [total, setTotal] = useState(0);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    // Which load is the current one. See selectConversation.
    const requestSeq = useRef(0);

    const hasMore = conversations.length < total;

    const fetchConversations = useCallback(async () => {
        if (!client) return;
        setIsLoading(true);
        setOffset(0);
        try {
            const resp = await client.getConversations(0, PAGE_SIZE);
            setConversations(resp.items);
            setTotal(resp.pagination.total);
        } catch (e) {
            console.error('[useConversations] failed to fetch conversations:', e);
        } finally {
            setIsLoading(false);
        }
    }, [client]);

    const loadMore = useCallback(async () => {
        if (!client || isLoadingMore || !hasMore) return;
        setIsLoadingMore(true);
        const nextOffset = offset + PAGE_SIZE;
        try {
            const resp = await client.getConversations(nextOffset, PAGE_SIZE);
            setConversations(prev => [...prev, ...resp.items]);
            setOffset(nextOffset);
            setTotal(resp.pagination.total);
        } catch (e) {
            console.error('[useConversations] failed to load more conversations:', e);
        } finally {
            setIsLoadingMore(false);
        }
    }, [client, isLoadingMore, hasMore, offset]);

    const selectConversation = useCallback(async (
        id: string
    ): Promise<{ messages: MessageProps[]; detail: ConversationDetail } | null> => {
        if (!client) return null;
        // Two quick clicks in the drawer are two concurrent loads, and without a
        // guard the slower one wins whatever it finishes last — leaving the
        // client pointed at one thread while the screen shows another, so the
        // next message is filed into the wrong conversation.
        const seq = ++requestSeq.current;
        setIsLoading(true);
        try {
            const detail: ConversationDetail = await client.getConversationDetail(id);
            if (seq !== requestSeq.current) return null;
            setActiveConversationId(id);
            client.setConversationId(id);
            return {
                messages: jobsToMessageProps(detail.jobs, storageApiUrl),
                detail,
            };
        } catch (e) {
            console.error('[useConversations] failed to load conversation:', e);
            return null;
        } finally {
            if (seq === requestSeq.current) setIsLoading(false);
        }
    }, [client, storageApiUrl]);

    const newChat = useCallback(() => {
        setActiveConversationId(null);
        client?.setConversationId(null);
    }, [client]);

    useEffect(() => {
        fetchConversations();
    }, [fetchConversations]);

    return {
        conversations,
        isLoading,
        isLoadingMore,
        hasMore,
        activeConversationId,
        fetchConversations,
        loadMore,
        selectConversation,
        newChat,
    };
}
