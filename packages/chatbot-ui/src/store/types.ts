import type { StreamChatClient } from '../api/StreamClient';
import type { EnablableTool, GatewayStreamClient } from '../api/GatewayStreamClient';
import type {
    AttachedFile,
    ConversationFile,
    ConversationSummary,
    SaveFileOptions,
    StandingEntry,
    StandingEntryChanges,
    StandingEntryDraft,
    UserCredits,
} from '../api/types';
import type { StorageClient } from '../api/StorageClient';
import type { ChatbotConfig, ResolvedChatbotConfig } from '../common/chatbotConfig';
import type { CreditAlert } from '../common/creditAlert';
import type { ToolConfig } from '../common/toolConfig';
import type { TurnUsageSummary } from '../common/usageSummary';
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
    /** A provider `conversationLink` exists, so the menu copies a link rather than an id. */
    canCopyConversationLink: boolean;
    /** The client can cancel a turn on the server, not only stop reading it. */
    canStop: boolean;
    /** The client can read the user's own allowance, so "Credit usage" has something to show. */
    canShowCredits: boolean;
    isCreditUsageOpen: boolean;
    /**
     * The user's own allowance as last read: when the chat opened, after each
     * turn, or by the "Credit usage" dialog. `null` before the first read, when
     * the client cannot read it, or with `composer.creditAlerts` off and the
     * dialog never opened. Since 4.3.
     */
    credits: UserCredits | null;
    /**
     * What the composer's credit notice shows, or `null`: nothing to say,
     * `composer.creditAlerts` off, or the user closed this warning since the
     * chat opened. Being out of credits cannot be closed. Since 4.3.
     */
    creditAlert: CreditAlert | null;
    /**
     * The client can read and write the user's standing context, so "Memory &
     * instructions" has something to show (`listStandingContext`). Since 4.4.
     */
    canManageStandingContext: boolean;
    isStandingContextOpen: boolean;

    // --- Files: the conversation's files and the user's artifacts ---
    /**
     * The storage API's client for this user, built from the provider's
     * `storageApiUrl` and `accessToken`; `null` without both, and then no
     * files button, no Artifacts entry and nothing to save with.
     */
    storageClient: StorageClient | null;
    /** The "Conversation files" panel is open. */
    isFilesPanelOpen: boolean;
    /**
     * The "Artifacts" view is showing. Since 2026-10-14 it stands in the chat
     * column in place of the transcript and the composer (`ArtifactsPanel`),
     * rather than over them; the name is the 4.1 one.
     */
    isArtifactsPanelOpen: boolean;
    /**
     * Counts the calls to `openArtifacts()`. The view reads it to go back to
     * its list when "Artifacts" is chosen while it already shows.
     */
    artifactsOpenings: number;
    /**
     * Counts every file saved or deleted through the chat since it mounted —
     * a panel that lists files reads it to know when to read again.
     */
    filesRevision: number;

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
    /** The client can rename conversations. */
    renamingSupported: boolean;
    isLoadingConversations: boolean;
    isLoadingMore: boolean;
    hasMore: boolean;
    search: ConversationSearch;

    // --- Tools ---
    registeredTools: Record<string, ToolConfig>;
    enablableTools: EnablableTool[];
    enabledToolIds: string[];
    handledToolSlugs: string[];
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
    /**
     * Reads the user's allowance again — after the host knows it changed, say
     * — and resolves to it; to `null` when the client cannot read it or the
     * read failed, which leaves the last figures in place. Since 4.3.
     */
    refreshCredits: () => Promise<UserCredits | null>;
    /** Closes the composer's credit warning until the chat is next opened. Since 4.3. */
    dismissCreditAlert: () => void;
    /** Opens "Memory & instructions", which reads the entries afresh each time. Since 4.4. */
    openStandingContext: () => void;
    closeStandingContext: () => void;
    /** The "Conversation files" panel, for the open conversation. */
    openFiles: () => void;
    closeFiles: () => void;
    /**
     * The "Artifacts" view: what the user saved, across conversations, in
     * the chat column in place of the transcript. `newChat`,
     * `selectConversation` and `setComposerText` close it too — each is a
     * chat the user wants to see.
     */
    openArtifacts: () => void;
    closeArtifacts: () => void;

    /**
     * Store a file in the conversation against the turn `jobUuid` (a block's
     * `jobUuid` prop) — an export, by default, or an artifact with
     * `isArtifact: true`. Resolves to the stored file, after which the panels
     * read again and `chat.files.changed` fires; rejects with the server's
     * reason, or at once when there is no storage API or no `jobUuid`. A turn
     * the storage API has not stored yet (404 `JOB_NOT_FOUND`) is tried again
     * for 3 s first.
     */
    saveFile: (jobUuid: string, file: Blob, options?: SaveFileOptions) => Promise<ConversationFile>;
    /**
     * `saveFile` with `isArtifact: true`: the user chose to keep it, and it is
     * listed under "Artifacts". A block's Save passes its `blockKey` prop
     * (`options.blockKey`), which marks that block "Saved" in the
     * conversation's files and under Artifacts.
     */
    saveArtifact: (jobUuid: string, file: Blob, options?: Omit<SaveFileOptions, 'isArtifact'>) => Promise<ConversationFile>;
    /**
     * Saves a file the application generated (an export) as an artifact —
     * a copy the storage API makes, listed under "Artifacts" (2026-10-14).
     * Resolves to that artifact (the existing one when it was saved before),
     * after which the panels read again and `chat.files.changed` fires;
     * rejects with the server's reason (409 `NOT_GENERATED` for an upload or
     * an artifact), or at once without a storage API.
     */
    saveGeneratedFile: (attachmentUuid: string) => Promise<ConversationFile>;
    /** Removes one of the user's artifacts; rejects when the server refuses. */
    deleteArtifact: (attachmentUuid: string) => Promise<void>;

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
    /** Rejects when the server refuses, and the old title is shown again. */
    renameConversation: (conversationId: string, title: string) => Promise<void>;
    /** An empty query ends the search. */
    searchConversations: (query: string) => void;
    refreshConversations: () => Promise<void>;
    loadMoreConversations: () => Promise<void>;
    copyConversationId: () => void;
    /** Copies the provider's `conversationLink` for the open conversation; nothing without one. */
    copyConversationLink: () => void;

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
    'conversation.renamed': { conversationId: string; title: string };
    'conversation.deleted': { conversationId: string };
    /** A file was saved to, or an artifact deleted from, a conversation through the chat. */
    'chat.files.changed': FilesChangedPayload;
}

/** What `chat.files.changed` says about the change. */
export interface FilesChangedPayload {
    change: 'saved' | 'deleted';
    attachmentUuid: string;
    /** The stored file; `null` for a deletion. */
    file: ConversationFile | null;
    /** The conversation the file is in, when known. */
    conversationId: string | null;
    jobUuid: string | null;
    /** A saved block's key (`SaveFileOptions.blockKey`): that block is now "Saved". `null` otherwise. */
    blockKey: string | null;
    /** A saved generated file's uuid (`saveGeneratedFile`): that file is now "Saved". `null` otherwise. */
    savedFromUuid: string | null;
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
    /**
     * The user's own allowance; rejects when the client cannot read it. A
     * successful read is also what `credits` shows from then on.
     */
    fetchCredits: () => Promise<UserCredits>;
    /**
     * The user's standing context (ADR-021), through the client; each rejects
     * when the client cannot (`canManageStandingContext`), and with the
     * Gateway's `status` and `reason` when it refuses. Since 4.4.
     */
    standingContext: StandingContextService;
}

/** Reads and writes "Memory & instructions": the user's own entries, and their organisation's to read. */
export interface StandingContextService {
    list: () => Promise<StandingEntry[]>;
    create: (draft: StandingEntryDraft) => Promise<StandingEntry>;
    update: (uuid: string, changes: StandingEntryChanges) => Promise<StandingEntry>;
    remove: (uuid: string) => Promise<void>;
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
