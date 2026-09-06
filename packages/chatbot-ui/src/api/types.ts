import { MessageProps } from '../components/MessageBubble/MessageBubble';

export interface AttachedFile {
    file_id: string;
    filename: string;
    content_type: string;
    size_bytes: number;
    localBlobUrl?: string;
}

export interface ChatState {
    messages: MessageProps[];
    isThinking: boolean;
    isWaitingForDeltas?: boolean; // True when job is running but no deltas received recently
    conversationTitle?: string; // Auto-generated title from first user-assistant exchange
}

export interface ConversationSummary {
    uuid: string;
    title: string;
    created_at: string;
    updated_at: string;
}

export interface ConversationAttachment {
    uuid: string;
    filename: string;
    content_type: string | null;
    size_bytes: number;
}

export interface ConversationStep {
    uuid: string;
    step_type: string;
    step_sequence: number;
    status: string;
    request_message: any;
    response_payload: any;
    tool_slug: string | null;
    tool_input: any;
    tool_output: any;
    /**
     * How this tool call is executed: ``kafka``/``inline`` run in a worker,
     * ``client`` runs in this browser, ``sub_agent`` starts another agent.
     *
     * Worth reading only in combination with ``status``: a ``client`` step still
     * ``running`` is a call *this page* has not answered, which is a different
     * situation from a worker call in flight even though both look identical
     * without this field. ``null`` on every non-tool step.
     */
    dispatch_mode?: string | null;
    input_tokens: number;
    output_tokens: number;
    credits_charged: number;
    started_at: string;
    completed_at: string | null;
    /**
     * Set only on a ``run_sub_agent`` step: the job this step delegated to.
     * Names which entry of the job's ``sub_agent_jobs`` renders here, so the
     * child's block lands at the right point in the transcript rather than
     * after everything else.
     */
    child_job_uuid?: string | null;
}

export interface ConversationAgent {
    uuid: string;
    name: string;
}

/**
 * A tool call a run is holding until the user decides (ADR-006).
 *
 * Carried on history because a held call writes **no step row** — the tool has
 * not run, and a row would say it had. The live ``approval_request`` event is a
 * one-time announcement, so a page that reloads, a second tab, or a run whose
 * gate opened after the stream token expired has nothing else to render, and
 * the thread reads as finished while the run sits suspended.
 */
export interface PendingApproval {
    /** Correlation key to POST back with the verdict. */
    approval_uuid: string;
    tool_slug: string;
    tool_input: any;
    /** Where the call would run — ``kafka``/``inline`` on the server, ``client`` here. */
    dispatch_mode: string;
}

/**
 * The run's meter — every settled step so far — as the orchestrator reports it
 * on the ``usage`` stream event (``run``) and on ``end`` / ``error``
 * (``usage``). Cumulative snapshots, never deltas: replace what is held, never
 * sum, so a replayed event is idempotent.
 */
export interface UsageFigures {
    steps: number;
    input_tokens: number;
    output_tokens: number;
    credits_charged: number;
    credits_waived: number;
}

/** Where the turn's last prompt sat against the model's window (migration 080). */
export interface ContextFigures {
    input_tokens: number;
    /** Null when the model's limit is not seeded — draw no bar rather than a wrong one. */
    max_input_tokens: number | null;
    ratio: number | null;
    max_output_tokens: number | null;
}

/** The sub-agent tree's spend against the policy's ceiling; null for a plain run. */
export interface TreeFigures {
    credits_spent: number;
    max_tree_credits: number | null;
    /** Set client-side when ``tree_ceiling_reached`` arrives: no more sub-agents this turn. */
    ceiling_reached?: boolean;
}

/** What one settled step cost — the ``step`` block of a ``usage`` event. */
export interface StepCost {
    step_sequence: number;
    step_type: string;
    tool_slug: string | null;
    model: { model_id: number | null; provider: string | null; model: string | null };
    input_tokens: number;
    output_tokens: number;
    credits_charged: number;
    credits_waived: number;
    charge_outcome: string | null;
}

/**
 * One run's meter inside a turn — a sub-agent's, keyed by its job uuid on the
 * turn's message — with the agent's name when it is known. Replaced whole on
 * every event from that run (snapshots, never deltas); a turn's cost is the
 * root run plus every one of these.
 */
export interface RunUsage {
    agentName?: string | null;
    figures: UsageFigures;
    /** That run's own last prompt against its model's window; a sub-agent's context ends with it. */
    context?: ContextFigures | null;
}

export interface UsagePayload {
    step: StepCost;
    run: UsageFigures;
    tree: TreeFigures | null;
    context: ContextFigures;
}

export interface ConversationJob {
    uuid: string;
    user_prompt: string;
    status: string;
    total_steps: number | null;
    total_input_tokens: number | null;
    total_output_tokens: number | null;
    total_credits_charged: number | null;
    /**
     * The context window of the model this job ran on, so the usage footer can
     * be drawn from history as well as from the live ``usage`` event. Null when
     * the model's limit is not seeded or the job ran no model.
     */
    context_window?: number | null;
    created_at: string;
    updated_at: string;
    attachments: ConversationAttachment[];
    steps: ConversationStep[];
    /** Which agent produced this turn. Null for an agentless job. */
    agent?: ConversationAgent | null;
    /** The job whose agent started this one; null for a user turn. */
    triggered_by_job_uuid?: string | null;
    /**
     * True when this job took the conversation over rather than returning a
     * result — which is why it appears at top level despite having a parent.
     */
    handoff?: boolean;
    /** The parent step this job's output belongs to. Delegated children only. */
    parent_step_uuid?: string | null;
    /**
     * Delegated sub-agents, nested under the step that started them. The
     * server does the nesting; a client that ignores this field simply never
     * shows what the sub-agents did, rather than showing them as user turns.
     */
    sub_agent_jobs?: ConversationJob[];
    /**
     * Decisions this run is still waiting on. Empty or absent for every job
     * that has reached a terminal state, and for every run holding nothing.
     */
    pending_approvals?: PendingApproval[];
}

export interface ConversationDetail {
    uuid: string;
    title: string;
    created_at: string;
    updated_at: string;
    jobs: ConversationJob[];
}

export interface Pagination {
    total: number;
    page: number;
    per_page: number;
    pages: number;
}

export interface ConversationListResponse {
    items: ConversationSummary[];
    pagination: Pagination;
}

export interface ChatClient {
    sendMessage: (content: string, onUpdate: (state: ChatState) => void, fileIds?: string[], attachedFiles?: AttachedFile[], replyToMessageId?: string, replyToContent?: string, replyToRole?: string, replyToSelectedText?: string) => Promise<void>;
    reset: (onUpdate: (state: ChatState) => void) => void;
    setModel: (model: string | null) => void;
    setEnabledTools: (tools: string[]) => void;
    setToolHandler: (name: string, handler: (args: any) => Promise<string | any>) => void;
    enableWebSearch: (enabled: boolean) => void;
    enablePageContext: (enabled: boolean) => void;
    setEffortLevel?: (level: 'low' | 'medium' | 'high') => void;
    sendConfirmResponse?: (toolCallId: string, confirmed: boolean) => Promise<void>;
    setPageReadingCallback?: (callback: (isReading: boolean) => void) => void;
    uploadFile?: (file: File) => Promise<AttachedFile>;

    // Conversation management
    getConversations?: (offset?: number, limit?: number) => Promise<ConversationListResponse>;
    getConversationDetail?: (id: string) => Promise<ConversationDetail>;
    loadConversation?: (id: string, onUpdate: (state: ChatState) => void) => Promise<void>;
    deleteConversation?: (id: string) => Promise<void>;
    searchConversations?: (query: string, offset?: number, limit?: number) => Promise<ConversationListResponse>;
    setConversationId?: (id: string | null) => void;
    getConversationId?: () => string | null;

    // Branching
    editMessage?: (messageId: string, content: string) => Promise<void>;
    switchBranch?: (branchPointMessageId: string, targetChildMessageId: string) => Promise<void>;
}
