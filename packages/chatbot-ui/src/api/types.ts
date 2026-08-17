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

export interface ConversationJob {
    uuid: string;
    user_prompt: string;
    status: string;
    total_steps: number | null;
    total_input_tokens: number | null;
    total_output_tokens: number | null;
    total_credits_charged: number | null;
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
