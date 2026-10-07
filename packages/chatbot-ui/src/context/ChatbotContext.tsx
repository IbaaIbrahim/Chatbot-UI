import React from 'react';
import { netFetch, configureLocalNetworkAccess, warnIfLocalNetworkUrl } from '../common/localNetwork';
import { StreamClient, StreamChatClient } from '../api/StreamClient';
import { GatewayStreamClient, EnablableTool } from '../api/GatewayStreamClient';
import { useStreamChat, UseStreamChatOptions } from '../hooks/useStreamChat';
import {
    collectPendingApprovals,
    findPendingClientToolCalls,
    useConversations,
} from '../hooks/useConversations';
import { isClientTool } from '../common/toolConfig';
import type { ToolConfig } from '../common/toolConfig';
import type { AttachedFile, ConversationDetail, UserCredits } from '../api/types';
import { summarizeUsage } from '../common/usageSummary';
import { resolveChatbotConfig } from '../common/chatbotConfig';
import type { ChatbotConfig } from '../common/chatbotConfig';
import type { QuestionSpec } from '../components/Questionnaire/QuestionnaireForm';
import type { AgentSidebarItem } from '../components/AgentSidebar/AgentSidebar';
import type { ChatMode } from '../components/ChatContainer/presentation';
import { createChatStore, shallowEqual } from '../store/createChatStore';
import { createEventBus } from '../store/eventBus';
import { ChatRuntimeContext } from '../store/hooks';
import type {
    ChatActions,
    ChatRuntime,
    ChatServices,
    ChatSnapshot,
    ComposerControl,
} from '../store/types';

const { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } = React;

const TOOL_SELECTION_STORAGE_PREFIX = 'chatbot-ui:enabled-tools:';
const NO_AGENTS: AgentSidebarItem[] = [];

function toolSelectionKey(agentId?: string | null): string {
    return `${TOOL_SELECTION_STORAGE_PREFIX}${agentId ?? '__agentless__'}`;
}

function readStoredToolIds(agentId?: string | null): string[] {
    try {
        const raw = window.localStorage.getItem(toolSelectionKey(agentId));
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
    } catch {
        return [];
    }
}

function writeStoredToolIds(agentId: string | null | undefined, toolIds: string[]): void {
    try {
        window.localStorage.setItem(toolSelectionKey(agentId), JSON.stringify(toolIds));
    } catch {
        // Storage full or unavailable
    }
}

const CONFIG_GROUPS = ['labels', 'icons', 'header', 'composer', 'sidebar', 'greeting'] as const;
const CONFIG_LISTS = ['suggestions', 'quickActions', 'featureCards'] as const;

/**
 * Whether two override layers say the same thing, so re-registering an equal
 * layer — a literal rebuilt on every render — changes nothing downstream.
 */
function layersEqual(left: ChatbotConfig, right: ChatbotConfig): boolean {
    return CONFIG_GROUPS.every(group => shallowEqual(left[group], right[group]))
        && CONFIG_LISTS.every(list => Object.is(left[list], right[list]));
}

interface OverrideLayer {
    owner: string;
    layer: ChatbotConfig;
}

export interface ChatbotProviderProps {
    children: React.ReactNode;
    client?: StreamChatClient | GatewayStreamClient | null;
    /** Builds a plain `StreamClient` when no `client` is given. */
    streamUrl?: string;
    streamHeaders?: Record<string, string>;
    storageApiUrl?: string;
    accessToken?: string | null;
    userName?: string;
    onEvent?: UseStreamChatOptions['onEvent'];
    allowLocalNetworkAccess?: boolean;
    agents?: AgentSidebarItem[];
    /** Controlled agent selection. Omit to let the chat keep its own. */
    agentId?: string | null;
    agentsLoading?: boolean;
    onAgentChange?: (agentId: string | null) => void;
    tools?: Record<string, ToolConfig>;
    /** Labels, icons, which controls exist and the welcome content. See `ChatbotConfig`. */
    config?: ChatbotConfig;

    /**
     * Whether the chat is open. Pass it to own the state (a host that persists
     * it, or must navigate when the chat closes); omit it and the chat keeps its
     * own, starting from `defaultOpen`. Either way `onOpenChange` hears every
     * request, including `useChatActions().close()` from anywhere in the app.
     */
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;

    /** The conversation sidebar, on the same terms as `open`. */
    sidebarOpen?: boolean;
    defaultSidebarOpen?: boolean;
    onSidebarOpenChange?: (open: boolean) => void;

    /** Enables the header's "Switch view" item. */
    onSwitchMode?: (mode: ChatMode) => void;
    /** Enables the header's share button. */
    onShare?: () => void;
}

/**
 * The chat itself: its client, its conversations, the turn in progress and
 * every action on them, for everything rendered below.
 *
 * Mount it once, high enough that every part of the host that wants to drive
 * the chat is inside it — then any component can open the chat, send a
 * message or toggle the sidebar with `useChatActions()`, and read any part of
 * it with `useChatState()`. The widgets (`ChatApp`, `ChatContainer`,
 * `MainChat`, `Composer`, `ChatHeader`, `ConversationSidebar`) read from it and
 * can be placed anywhere under it, portals included.
 *
 * State is published through an external store rather than as the context
 * value, so a component re-renders when the slice it reads changes — not on
 * every streamed token.
 */
export const ChatbotProvider: React.FC<ChatbotProviderProps> = ({
    children,
    client: clientProp,
    streamUrl,
    streamHeaders,
    storageApiUrl = '',
    accessToken = null,
    userName = 'User',
    onEvent,
    allowLocalNetworkAccess = false,
    agents,
    agentId,
    agentsLoading = false,
    onAgentChange,
    tools,
    config,
    open: openProp,
    defaultOpen = true,
    onOpenChange,
    sidebarOpen: sidebarOpenProp,
    defaultSidebarOpen = false,
    onSidebarOpenChange,
    onSwitchMode,
    onShare,
}) => {
    // Before any child effect can issue a request.
    configureLocalNetworkAccess({ enabled: allowLocalNetworkAccess });
    warnIfLocalNetworkUrl('ChatbotProvider streamUrl', streamUrl);
    warnIfLocalNetworkUrl('ChatbotProvider storageApiUrl', storageApiUrl);

    const streamHeadersKey = JSON.stringify(streamHeaders ?? {});
    const internalClient = useMemo(
        () => (streamUrl ? new StreamClient({ baseUrl: streamUrl, headers: JSON.parse(streamHeadersKey) }) : null),
        [streamUrl, streamHeadersKey]
    );
    const activeClient = clientProp !== undefined ? clientProp : internalClient;
    const gateway = activeClient as GatewayStreamClient | null;

    // --- Configuration: the provider's `config`, then each screen's layer ---
    const [overrideLayers, setOverrideLayers] = useState<OverrideLayer[]>([]);
    const resolvedConfig = useMemo(
        () => resolveChatbotConfig([config, ...overrideLayers.map(entry => entry.layer)]),
        [config, overrideLayers]
    );

    // --- Authenticated storage access ---
    const blobCacheRef = useRef<Map<string, string>>(new Map());

    const fetchAuthenticatedUrl = useCallback(
        async (url: string): Promise<string> => {
            const resolvedUrl = url.startsWith('http')
                ? url
                : `${storageApiUrl.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}`;

            const cached = blobCacheRef.current.get(resolvedUrl);
            if (cached) {
                return cached;
            }

            if (!accessToken) {
                throw new Error('No access token available for authenticated fetch');
            }

            const response = await netFetch(resolvedUrl, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch authenticated URL: ${response.status}`);
            }

            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            blobCacheRef.current.set(resolvedUrl, blobUrl);
            return blobUrl;
        },
        [accessToken, storageApiUrl]
    );

    const getFileDownloadUrl = useCallback(
        async (fileIdOrDownloadUrl: string): Promise<string> => {
            if (!accessToken) {
                throw new Error('No access token available');
            }
            const base = storageApiUrl.replace(/\/$/, '');
            const uuidLike = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
            const fileId = uuidLike.test(fileIdOrDownloadUrl)
                ? fileIdOrDownloadUrl
                : (fileIdOrDownloadUrl.match(/\/files\/([a-f0-9-]+)(?:\/download)?\/?$/i) ||
                      fileIdOrDownloadUrl.match(/\/v1\/files\/([a-f0-9-]+)(?:\/download)?\/?$/i))?.[1] ??
                  fileIdOrDownloadUrl;
            const url = `${base}/v1/files/${fileId}/download-url`;
            const response = await netFetch(url, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });
            if (!response.ok) {
                throw new Error(`Failed to get download URL: ${response.status}`);
            }
            const data = await response.json();
            return data.url as string;
        },
        [accessToken, storageApiUrl]
    );

    // Cleanup blob URLs on unmount
    useEffect(() => {
        const cache = blobCacheRef.current;
        return () => {
            cache.forEach(blobUrl => {
                URL.revokeObjectURL(blobUrl);
            });
            cache.clear();
        };
    }, []);

    // --- The built-in questionnaire tool ---
    const [pendingQuestionnaire, setPendingQuestionnaire] = useState<{
        questions: QuestionSpec[];
        resolve: (formatted: string) => void;
    } | null>(null);

    const handleAskUserQuestions = useCallback((data: any): Promise<string> => {
        const questions: QuestionSpec[] = Array.isArray(data?.questions) ? data.questions : [];
        return new Promise<string>(resolve => {
            setPendingQuestionnaire({ questions, resolve });
        });
    }, []);

    const submitQuestionnaire = useCallback((formatted: string) => {
        setPendingQuestionnaire(prev => {
            prev?.resolve(formatted);
            return null;
        });
    }, []);

    const registeredTools = useMemo<Record<string, ToolConfig>>(() => ({
        ask_user_questions: { run: handleAskUserQuestions, show: false },
        ...tools,
    }), [tools, handleAskUserQuestions]);

    useEffect(() => {
        if (activeClient && 'setTools' in activeClient) {
            (activeClient as GatewayStreamClient).setTools(registeredTools);
        }
    }, [activeClient, registeredTools]);

    // --- Agents ---
    const [internalAgentId, setInternalAgentId] = useState<string | null>(null);
    const effectiveAgentId = agentId !== undefined ? agentId : internalAgentId;

    const setAgentId = useCallback(
        (id: string | null) => {
            setInternalAgentId(id);
            onAgentChange?.(id);
            if (activeClient && 'setAgentId' in activeClient) {
                (activeClient as GatewayStreamClient).setAgentId(id);
            }
        },
        [activeClient, onAgentChange]
    );

    // --- Tools the user may switch on per conversation ---
    const [enablableTools, setEnablableTools] = useState<EnablableTool[]>([]);
    const [enabledToolIds, setEnabledToolIds] = useState<string[]>([]);
    const toolsMenuEnabled = resolvedConfig.composer.tools;

    const handledToolSlugs = useMemo(
        () =>
            Object.entries(registeredTools)
                .filter(([, cfg]) => isClientTool(cfg))
                .map(([slug]) => slug),
        [registeredTools]
    );

    useEffect(() => {
        if (!toolsMenuEnabled || !activeClient || !('listEnablableTools' in activeClient)) {
            return;
        }
        let cancelled = false;
        (activeClient as GatewayStreamClient)
            .listEnablableTools(effectiveAgentId)
            .then(listed => {
                if (cancelled) return;
                setEnablableTools(listed);
                const allowed = new Set(listed.map(t => t.uuid));
                setEnabledToolIds(readStoredToolIds(effectiveAgentId).filter(id => allowed.has(id)));
            })
            .catch(error => {
                if (cancelled) return;
                console.error('[ChatbotProvider] listing enablable tools failed', error);
                setEnablableTools([]);
            });
        return () => {
            cancelled = true;
        };
    }, [activeClient, effectiveAgentId, toolsMenuEnabled]);

    useEffect(() => {
        if (activeClient && 'setEnabledToolIds' in activeClient) {
            (activeClient as GatewayStreamClient).setEnabledToolIds(enabledToolIds);
        }
    }, [activeClient, enabledToolIds]);

    const changeEnabledToolIds = useCallback(
        (next: string[]) => {
            setEnabledToolIds(next);
            writeStoredToolIds(effectiveAgentId, next);
        },
        [effectiveAgentId]
    );

    // --- The turn ---
    const {
        messages,
        isThinking,
        isResuming,
        isStopping,
        sendMessage: sendStreamMessage,
        resumeTurn,
        retryTurn,
        continueTurn,
        stopTurn,
        loadConversation,
        reset,
        confirmApproval,
        rejectApproval,
    } = useStreamChat({
        client: activeClient,
        onEvent,
        storageApiUrl,
        tools: registeredTools,
    });

    const usageSummary = useMemo(
        () => summarizeUsage(messages, isThinking || isResuming),
        [messages, isThinking, isResuming]
    );

    // --- Conversations ---
    const {
        conversations,
        starredConversations,
        starringSupported,
        isLoading: isLoadingConversations,
        isLoadingMore,
        hasMore,
        activeConversationId,
        search,
        fetchConversations,
        loadMore,
        selectConversation,
        newChat,
        deleteConversation,
        setStarred,
        searchConversations,
    } = useConversations(gateway, storageApiUrl);

    const [staleClientCall, setStaleClientCall] = useState(false);

    // --- Presence: open and sidebar, controlled or not ---
    const [internalOpen, setInternalOpen] = useState(defaultOpen);
    const isOpen = openProp ?? internalOpen;
    const [internalSidebarOpen, setInternalSidebarOpen] = useState(defaultSidebarOpen);
    const isSidebarOpen = resolvedConfig.sidebar.enabled && (sidebarOpenProp ?? internalSidebarOpen);

    const setOpen = useCallback((next: boolean) => {
        if (next === isOpen) return;
        if (openProp === undefined) setInternalOpen(next);
        onOpenChange?.(next);
    }, [isOpen, openProp, onOpenChange]);

    const setSidebarOpen = useCallback((next: boolean) => {
        if (next === isSidebarOpen) return;
        if (sidebarOpenProp === undefined) setInternalSidebarOpen(next);
        onSidebarOpenChange?.(next);
    }, [isSidebarOpen, sidebarOpenProp, onSidebarOpenChange]);

    // --- Credit usage: the user's own allowance, read when the dialog opens ---
    const [isCreditUsageOpen, setCreditUsageOpen] = useState(false);
    const canShowCredits = Boolean(activeClient && 'getCredits' in activeClient);

    const fetchCredits = useCallback((): Promise<UserCredits> => {
        if (!activeClient || !('getCredits' in activeClient)) {
            return Promise.reject(new Error('This client cannot read credit usage.'));
        }
        return (activeClient as GatewayStreamClient).getCredits();
    }, [activeClient]);

    // --- The composer, which registers itself when it mounts ---
    const composerRef = useRef<ComposerControl | null>(null);

    const focusComposer = useCallback(() => {
        window.setTimeout(() => {
            const field = document.activeElement;
            if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
                return;
            }
            composerRef.current?.focus();
        }, 0);
    }, []);

    const wasBusyRef = useRef(false);
    useEffect(() => {
        const busy = isThinking || isResuming;
        if (wasBusyRef.current && !busy) focusComposer();
        wasBusyRef.current = busy;
    }, [isThinking, isResuming, focusComposer]);

    const sendMessage = useCallback(
        async (text: string, attachedFiles?: AttachedFile[]) => {
            await sendStreamMessage(text, attachedFiles);
            fetchConversations();
        },
        [sendStreamMessage, fetchConversations]
    );

    const answerPendingCall = useCallback(
        async (call: { jobUuid: string; stepUuid: string; toolSlug: string; toolInput: any }) => {
            const cfg = registeredTools[call.toolSlug];
            const run = cfg && isClientTool(cfg) ? cfg.run : null;
            if (!gateway?.submitClientToolResult || !run) {
                setStaleClientCall(true);
                return;
            }
            try {
                const answer = await run(call.toolInput ?? {}, {
                    tool_slug: call.toolSlug,
                    step_uuid: call.stepUuid,
                    job_uuid: call.jobUuid,
                });
                await gateway.submitClientToolResult(
                    call.jobUuid,
                    call.stepUuid,
                    answer ?? { status: 'previewed' }
                );
            } catch (error) {
                const status = (error as { status?: number })?.status;
                if (status === 409) setStaleClientCall(true);
                else console.error('[ChatbotProvider] answering pending call failed', error);
            }
        },
        [gateway, registeredTools]
    );

    const applyLoadedConversation = useCallback(
        async (id: string, detail: ConversationDetail) => {
            if (gateway?.hasLiveTurn?.(id)) {
                const jobId = gateway.getLiveJobId?.(id);
                if (jobId) {
                    void resumeTurn(id, `${jobId}-assistant`);
                    return;
                }
            }
            const pending = findPendingClientToolCalls(detail.jobs);
            if (pending.length === 0) return;
            await answerPendingCall(pending[0]);
        },
        [gateway, resumeTurn, answerPendingCall]
    );

    const handleSelectConversation = useCallback(
        async (id: string): Promise<boolean> => {
            const departing = gateway?.getConversationId?.() ?? null;

            const loaded = await selectConversation(id);
            if (!loaded) return false;

            if (departing && departing !== id) {
                gateway?.parkStream?.(departing);
            }
            setPendingQuestionnaire(null);
            setStaleClientCall(false);

            loadConversation(loaded.messages, collectPendingApprovals(loaded.detail.jobs));
            await applyLoadedConversation(id, loaded.detail);
            return true;
        },
        [gateway, selectConversation, loadConversation, applyLoadedConversation]
    );

    const handleNewChat = useCallback(() => {
        newChat();
        reset();
        setPendingQuestionnaire(null);
        setStaleClientCall(false);
        focusComposer();
    }, [newChat, reset, focusComposer]);

    const didRestoreRef = useRef(false);
    useEffect(() => {
        if (didRestoreRef.current || activeConversationId) return;
        const restored = gateway?.getConversationId?.();
        if (!restored) return;
        didRestoreRef.current = true;
        void handleSelectConversation(restored).then(ok => {
            if (!ok) didRestoreRef.current = false;
        });
    }, [gateway, activeConversationId, handleSelectConversation]);

    const currentConversationId = activeConversationId || gateway?.getConversationId?.() || null;

    const copyConversationId = useCallback(() => {
        if (currentConversationId && navigator.clipboard) {
            void navigator.clipboard.writeText(currentConversationId);
        }
    }, [currentConversationId]);

    const handleDeleteConversation = useCallback(
        async (id: string) => {
            await deleteConversation(id);
            if (currentConversationId === id) {
                handleNewChat();
            }
        },
        [deleteConversation, currentConversationId, handleNewChat]
    );

    // --- What the store publishes ---
    const snapshot: ChatSnapshot = {
        client: activeClient,
        storageApiUrl,
        accessToken,
        userName,
        config: resolvedConfig,

        isOpen,
        isSidebarOpen,
        hostHandlesOpenChange: Boolean(onOpenChange),
        canSwitchMode: Boolean(onSwitchMode),
        canShare: Boolean(onShare),
        canStop: Boolean(activeClient && 'cancelTurn' in activeClient),
        canShowCredits,
        isCreditUsageOpen: canShowCredits && isCreditUsageOpen,

        messages,
        isThinking,
        isResuming,
        isStopping,
        usageSummary,
        pendingQuestions: pendingQuestionnaire?.questions ?? null,
        staleClientCall,

        activeConversationId: currentConversationId,
        conversations,
        starredConversations,
        starringSupported,
        isLoadingConversations,
        isLoadingMore,
        hasMore,
        search,

        registeredTools,
        enablableTools,
        enabledToolIds,
        handledToolSlugs,
        agents: agents ?? NO_AGENTS,
        agentId: effectiveAgentId,
        agentsLoading,
    };

    // --- What the actions do, as of this render ---
    const [events] = useState(createEventBus);

    const actionsNow: ChatActions = {
        open: () => setOpen(true),
        close: () => setOpen(false),
        toggleOpen: () => setOpen(!isOpen),
        openSidebar: () => setSidebarOpen(true),
        closeSidebar: () => setSidebarOpen(false),
        toggleSidebar: () => setSidebarOpen(!isSidebarOpen),
        switchMode: (mode) => onSwitchMode?.(mode),
        share: () => onShare?.(),
        openCreditUsage: () => setCreditUsageOpen(true),
        closeCreditUsage: () => setCreditUsageOpen(false),

        sendMessage: async (text, attachedFiles) => {
            events.emit('message.sent', { text });
            await sendMessage(text, attachedFiles);
        },
        stopTurn,
        retryTurn,
        continueTurn,
        confirmApproval,
        rejectApproval,
        submitQuestionnaire,

        newChat: () => {
            handleNewChat();
            events.emit('conversation.created', {});
        },
        selectConversation: async (conversationId) => {
            const selected = await handleSelectConversation(conversationId);
            if (selected) events.emit('conversation.selected', { conversationId });
            return selected;
        },
        deleteConversation: async (conversationId) => {
            await handleDeleteConversation(conversationId);
            events.emit('conversation.deleted', { conversationId });
        },
        setConversationStarred: async (conversationId, starred) => {
            await setStarred(conversationId, starred);
            events.emit('conversation.starred', { conversationId, starred });
        },
        searchConversations,
        refreshConversations: fetchConversations,
        loadMoreConversations: loadMore,
        copyConversationId,

        setAgentId,
        setEnabledToolIds: changeEnabledToolIds,

        focusComposer,
        setComposerText: (text) => {
            composerRef.current?.setText(text);
            composerRef.current?.focus();
        },
    };
    const servicesNow: ChatServices = { fetchAuthenticatedUrl, getFileDownloadUrl, fetchCredits };

    // Read through refs by the stable runtime below, so a caller holding an
    // action from an earlier render still acts on the current state.
    const latestActions = useRef(actionsNow);
    const latestServices = useRef(servicesNow);
    useLayoutEffect(() => {
        latestActions.current = actionsNow;
        latestServices.current = servicesNow;
    });

    const [runtime] = useState<ChatRuntime>(() => ({
        store: createChatStore(snapshot),
        actions: delegateActions(latestActions),
        events,
        services: {
            fetchAuthenticatedUrl: url => latestServices.current.fetchAuthenticatedUrl(url),
            getFileDownloadUrl: fileIdOrUrl => latestServices.current.getFileDownloadUrl(fileIdOrUrl),
            fetchCredits: () => latestServices.current.fetchCredits(),
        },
        overrides: {
            register: (owner, layer) =>
                setOverrideLayers(prev => {
                    const index = prev.findIndex(entry => entry.owner === owner);
                    if (index === -1) return [...prev, { owner, layer }];
                    if (layersEqual(prev[index].layer, layer)) return prev;
                    const next = [...prev];
                    next[index] = { owner, layer };
                    return next;
                }),
            unregister: owner =>
                setOverrideLayers(prev =>
                    prev.some(entry => entry.owner === owner) ? prev.filter(entry => entry.owner !== owner) : prev
                ),
        },
        registerComposer: control => {
            composerRef.current = control;
            return () => {
                if (composerRef.current === control) composerRef.current = null;
            };
        },
    }));

    // Publish after commit. Children render from the store, so between the
    // provider's render and this effect they still show the previous snapshot —
    // never a torn mix of two — and re-render before the browser paints.
    useLayoutEffect(() => {
        runtime.store.setState(snapshot);
    });

    // Report state changes as events, whoever made them: an action, or a host
    // flipping a controlled prop.
    useStateChangeEvents(isOpen, open => events.emit(open ? 'chat.opened' : 'chat.closed', {}));
    useStateChangeEvents(isSidebarOpen, open => events.emit(open ? 'sidebar.opened' : 'sidebar.closed', {}));

    return <ChatRuntimeContext.Provider value={runtime}>{children}</ChatRuntimeContext.Provider>;
};

function useStateChangeEvents(value: boolean, onChange: (value: boolean) => void): void {
    const previous = useRef(value);
    useEffect(() => {
        if (previous.current === value) return;
        previous.current = value;
        onChange(value);
    });
}

/** The stable action object: every call goes to the latest implementation. */
function delegateActions(latest: React.MutableRefObject<ChatActions>): ChatActions {
    return {
        open: () => latest.current.open(),
        close: () => latest.current.close(),
        toggleOpen: () => latest.current.toggleOpen(),
        openSidebar: () => latest.current.openSidebar(),
        closeSidebar: () => latest.current.closeSidebar(),
        toggleSidebar: () => latest.current.toggleSidebar(),
        switchMode: mode => latest.current.switchMode(mode),
        share: () => latest.current.share(),
        openCreditUsage: () => latest.current.openCreditUsage(),
        closeCreditUsage: () => latest.current.closeCreditUsage(),
        sendMessage: (text, attachedFiles) => latest.current.sendMessage(text, attachedFiles),
        stopTurn: () => latest.current.stopTurn(),
        retryTurn: () => latest.current.retryTurn(),
        continueTurn: () => latest.current.continueTurn(),
        confirmApproval: approvalUuid => latest.current.confirmApproval(approvalUuid),
        rejectApproval: approvalUuid => latest.current.rejectApproval(approvalUuid),
        submitQuestionnaire: formatted => latest.current.submitQuestionnaire(formatted),
        newChat: () => latest.current.newChat(),
        selectConversation: id => latest.current.selectConversation(id),
        deleteConversation: id => latest.current.deleteConversation(id),
        setConversationStarred: (id, starred) => latest.current.setConversationStarred(id, starred),
        searchConversations: query => latest.current.searchConversations(query),
        refreshConversations: () => latest.current.refreshConversations(),
        loadMoreConversations: () => latest.current.loadMoreConversations(),
        copyConversationId: () => latest.current.copyConversationId(),
        setAgentId: id => latest.current.setAgentId(id),
        setEnabledToolIds: ids => latest.current.setEnabledToolIds(ids),
        focusComposer: () => latest.current.focusComposer(),
        setComposerText: text => latest.current.setComposerText(text),
    };
}
