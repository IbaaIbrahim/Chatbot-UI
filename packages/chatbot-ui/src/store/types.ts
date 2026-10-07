import type { StreamChatClient } from '../api/StreamClient';
import type { EnablableTool, GatewayStreamClient } from '../api/GatewayStreamClient';
import type { AttachedFile, ConversationSummary, UserCredits } from '../api/types';
import type { ChatbotConfig, ResolvedChatbotConfig } from '../common/chatbotConfig';
import type { ToolConfig } from '../common/toolConfig';
import type { TurnUsageSummary } from '../common/usageSummary';
import type { AgentSidebarItem } from '../components/AgentSidebar/AgentSidebar';
import type { ChatMode } from '../components/ChatContainer/presentation';
import type { MessageProps } from '../components/MessageBubble/MessageBubble';
import type { QuestionSpec } from '../components/Questionnaire/QuestionnaireForm';
import type { ChatStore } from './createChatStore';

/** What a search of the conversation list currently shows. */
export interface ConversationSearch {
    /** Empty when no search is active. */
    query: string;
    results: ConversationSummary[];
    isSearching: boolean;
}

/**
 * Everything the chat knows, as one read-only value.
 *
 * Read it a slice at a time with `useChatState(selector)`; a component
 * re-renders only when its slice changes. Change it only through
 * `useChatActions()`.
 */
export interface ChatSnapshot {
    // --- Session ---
    client: StreamChatClient | GatewayStreamClient | null;
    storageApiUrl: string;
    accessToken: string | null;
    userName: string;
    /** The configuration in force, with every `useChatOverrides` layer applied. */
    config: ResolvedChatbotConfig;

    // --- Presence ---
    isOpen: boolean;
    isSidebarOpen: boolean;
    /**
     * The host handles `onOpenChange`, so closing is something it can undo. Without
     * it only a floating chat can close: its launcher is the way back.
     */
    hostHandlesOpenChange: boolean;
    /** A provider `onSwitchMode` exists, so "Switch view" has something to call. */
    canSwitchMode: boolean;
    canShare: boolean;
    /** The client can cancel a turn on the server, not only stop reading it. */
    canStop: boolean;
    /** The client can read the user's own allowance, so "Credit usage" has something to show. */
    canShowCredits: boolean;
    isCreditUsageOpen: boolean;

    // --- The turn ---
    messages: MessageProps[];
    isThinking: boolean;
    isResuming: boolean;
    isStopping: boolean;
    usageSummary: TurnUsageSummary | null;
    /** The questions an `ask_user_questions` call is waiting on, if any. */
    pendingQuestions: QuestionSpec[] | null;
    /** The open turn waits on a client tool this page can no longer answer. */
    staleClientCall: boolean;

    // --- Conversations ---
    activeConversationId: string | null;
    /** Recent conversations — the unstarred ones when starring is supported. */
    conversations: ConversationSummary[];
    starredConversations: ConversationSummary[];
    /** The Gateway reports `starred_at`, so starring will persist. */
    starringSupported: boolean;
    isLoadingConversations: boolean;
    isLoadingMore: boolean;
    hasMore: boolean;
    search: ConversationSearch;

    // --- Tools and agents ---
    registeredTools: Record<string, ToolConfig>;
    enablableTools: EnablableTool[];
    enabledToolIds: string[];
    handledToolSlugs: string[];
    agents: AgentSidebarItem[];
    agentId: string | null;
    agentsLoading: boolean;
}

/**
 * Everything the chat can be asked to do, from anywhere under the provider.
 *
 * The object and its functions keep their identity for the provider's
 * lifetime, so they are safe in dependency arrays and event handlers, and
 * always act on the current state — there is no stale closure to capture.
 */
export interface ChatActions {
    open: () => void;
    close: () => void;
    toggleOpen: () => void;
    openSidebar: () => void;
    closeSidebar: () => void;
    toggleSidebar: () => void;
    /** Calls the provider's `onSwitchMode`. */
    switchMode: (mode: ChatMode) => void;
    /** Calls the provider's `onShare`. */
    share: () => void;
    /** Opens the "Credit usage" dialog, which reads the allowance afresh each time. */
    openCreditUsage: () => void;
    closeCreditUsage: () => void;

    sendMessage: (text: string, attachedFiles?: AttachedFile[]) => Promise<void>;
    stopTurn: () => Promise<void>;
    retryTurn: () => Promise<void>;
    continueTurn: () => Promise<void>;
    confirmApproval: (approvalUuid: string) => void;
    rejectApproval: (approvalUuid: string) => void;
    submitQuestionnaire: (formattedAnswers: string) => void;

    newChat: () => void;
    selectConversation: (conversationId: string) => Promise<boolean>;
    /** Rejects when the server refuses; the row is removed only once it accepted. */
    deleteConversation: (conversationId: string) => Promise<void>;
    setConversationStarred: (conversationId: string, starred: boolean) => Promise<void>;
    /** An empty query ends the search. */
    searchConversations: (query: string) => void;
    refreshConversations: () => Promise<void>;
    loadMoreConversations: () => Promise<void>;
    copyConversationId: () => void;

    setAgentId: (agentId: string | null) => void;
    setEnabledToolIds: (toolIds: string[]) => void;

    focusComposer: () => void;
    /** Replace the composer's text, e.g. to prefill a prompt from a page button. */
    setComposerText: (text: string) => void;
}

type NoPayload = Record<string, never>;

/** What happened, for hosts that react to a moment rather than render a state. */
export interface ChatEventMap {
    'chat.opened': NoPayload;
    'chat.closed': NoPayload;
    'sidebar.opened': NoPayload;
    'sidebar.closed': NoPayload;
    'message.sent': { text: string };
    'conversation.created': NoPayload;
    'conversation.selected': { conversationId: string };
    'conversation.starred': { conversationId: string; starred: boolean };
    'conversation.deleted': { conversationId: string };
}

export type ChatEventType = keyof ChatEventMap;
export type ChatEventHandler<Type extends ChatEventType> = (payload: ChatEventMap[Type]) => void;

export interface ChatEventBus {
    emit: <Type extends ChatEventType>(type: Type, payload: ChatEventMap[Type]) => void;
    on: <Type extends ChatEventType>(type: Type, handler: ChatEventHandler<Type>) => () => void;
}

/** The imperative surface a mounted composer offers the provider. */
export interface ComposerControl {
    focus: () => void;
    setText: (text: string) => void;
}

/** Authenticated reads: the storage API for attachments and images, and the user's credits. */
export interface ChatServices {
    fetchAuthenticatedUrl: (url: string) => Promise<string>;
    getFileDownloadUrl: (fileIdOrDownloadUrl: string) => Promise<string>;
    /** The user's own allowance; rejects when the client cannot read it. */
    fetchCredits: () => Promise<UserCredits>;
}

/**
 * The value behind the provider's React context. Every member keeps its
 * identity for the provider's lifetime, which is why reading it never
 * re-renders anything — the store is where change happens.
 */
export interface ChatRuntime {
    store: ChatStore<ChatSnapshot>;
    actions: ChatActions;
    events: ChatEventBus;
    services: ChatServices;
    overrides: {
        register: (owner: string, layer: ChatbotConfig) => void;
        unregister: (owner: string) => void;
    };
    registerComposer: (control: ComposerControl) => () => void;
}
