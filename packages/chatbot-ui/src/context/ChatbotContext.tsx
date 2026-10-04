import React from 'react';
const { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } = React;
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
import { AttachedFile, ConversationDetail, ConversationSummary } from '../api/types';
import { summarizeUsage, TurnUsageSummary } from '../common/usageSummary';
import type { ChatbotUIConfig } from '../common/chatbotConfig';
import type { QuestionSpec } from '../components/Questionnaire/QuestionnaireForm';
import type { AgentSidebarItem } from '../components/AgentSidebar/AgentSidebar';
import type { ChatMode, ChatTheme } from '../components/ChatContainer/ChatContainer';
import type { MessageProps } from '../components/MessageBubble/MessageBubble';
import type { ComposerHandle } from '../components/Composer/Composer';

const TOOL_SELECTION_STORAGE_PREFIX = 'chatbot-ui:enabled-tools:';

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

export interface ChatbotContextValue {
    // Clients & Configuration
    client: StreamChatClient | GatewayStreamClient | null;
    storageApiUrl: string;
    accessToken?: string | null;
    mode: ChatMode;
    theme: ChatTheme;
    config?: ChatbotUIConfig;
    userName: string;
    allowLocalNetworkAccess?: boolean;

    // Authenticated resource helpers (backward compatible)
    fetchAuthenticatedUrl: (url: string) => Promise<string>;
    getFileDownloadUrl: (fileIdOrDownloadUrl: string) => Promise<string>;

    // Chat / Stream state & actions
    messages: MessageProps[];
    isThinking: boolean;
    isResuming: boolean;
    isStopping: boolean;
    sendMessage: (text: string, attachedFiles?: AttachedFile[], contextIds?: string[]) => Promise<void>;
    stopTurn: () => Promise<void>;
    retryTurn: () => Promise<void>;
    continueTurn: () => Promise<void>;
    reset: () => void;
    loadConversation: (messages: MessageProps[], approvalJobs?: Map<string, string>) => void;
    confirmApproval: (approvalUuid: string) => void;
    rejectApproval: (approvalUuid: string) => void;
    usageSummary: TurnUsageSummary | null;

    // Interactive questionnaire & stale turn state
    pendingQuestionnaire: { questions: QuestionSpec[]; resolve: (formatted: string) => void } | null;
    handleQuestionnaireSubmit: (formatted: string) => void;
    staleClientCall: boolean;
    focusComposer: () => void;
    composerRef: React.RefObject<ComposerHandle>;

    // Conversation history state & actions
    conversations: ConversationSummary[];
    activeConversationId: string | null;
    isLoadingConversations: boolean;
    isLoadingMore: boolean;
    hasMore: boolean;
    fetchConversations: () => void;
    loadMore: () => void;
    selectConversation: (id: string) => Promise<boolean>;
    newChat: () => void;
    deleteConversation: (id: string) => Promise<void>;
    copyConversationId: () => void;

    // Tools & Agents
    registeredTools: Record<string, ToolConfig>;
    enablableTools: EnablableTool[];
    enabledToolIds: string[];
    handledToolSlugs: string[];
    handleToolSelectionChange: (next: string[]) => void;
    agents?: AgentSidebarItem[];
    agentId: string | null;
    agentsLoading?: boolean;
    onAgentChange?: (agentId: string | null) => void;
    setAgentId: (agentId: string | null) => void;

    // Layout / Drawer state
    isDrawerOpen: boolean;
    setIsDrawerOpen: (open: boolean) => void;
    isOpen: boolean;
    onClose?: () => void;
    onOpen?: () => void;
    onSwitchMode?: (mode: ChatMode) => void;
    onShare?: () => void;

    // Composer & Agent display toggles
    showAgentSwitcher?: boolean;
    show_agent_switcher?: boolean;
    showBottomSection?: boolean;
    show_bottom_section?: boolean;
}

const ChatbotContext = createContext<ChatbotContextValue | null>(null);

export interface ChatbotProviderProps {
    children: React.ReactNode;
    client?: StreamChatClient | GatewayStreamClient | null;
    streamUrl?: string;
    streamHeaders?: Record<string, string>;
    storageApiUrl?: string;
    /** Alias for storageApiUrl for backward compatibility */
    apiBaseUrl?: string;
    accessToken?: string | null;
    mode?: ChatMode;
    theme?: ChatTheme;
    isOpen?: boolean;
    onClose?: () => void;
    onOpen?: () => void;
    userName?: string;
    onEvent?: UseStreamChatOptions['onEvent'];
    allowLocalNetworkAccess?: boolean;
    agents?: AgentSidebarItem[];
    tools?: Record<string, ToolConfig>;
    agentId?: string | null;
    agentsLoading?: boolean;
    onAgentChange?: (agentId: string | null) => void;
    show_tool_toggles?: boolean;
    showAgentSwitcher?: boolean;
    show_agent_switcher?: boolean;
    showBottomSection?: boolean;
    show_bottom_section?: boolean;
    config?: ChatbotUIConfig;
    onContextChange?: (contexts: string[]) => void;
    onSwitchMode?: (mode: ChatMode) => void;
    onShare?: () => void;
}

export const ChatbotProvider: React.FC<ChatbotProviderProps> = ({
    children,
    client: clientProp,
    streamUrl,
    streamHeaders,
    storageApiUrl: storageApiUrlProp,
    apiBaseUrl,
    accessToken,
    mode = 'floating',
    theme = 'system',
    isOpen = true,
    onClose,
    onOpen,
    userName = 'User',
    onEvent,
    allowLocalNetworkAccess = false,
    agents,
    tools,
    agentId,
    agentsLoading = false,
    onAgentChange,
    show_tool_toggles = true,
    showAgentSwitcher: showAgentSwitcherProp,
    show_agent_switcher: show_agent_switcherProp,
    showBottomSection: showBottomSectionProp,
    show_bottom_section: show_bottom_sectionProp,
    config,
    onContextChange: _onContextChange,
    onSwitchMode,
    onShare,
}) => {
    const storageApiUrl = storageApiUrlProp || apiBaseUrl || '';

    const effectiveShowAgentSwitcher = showAgentSwitcherProp !== undefined
        ? showAgentSwitcherProp
        : (show_agent_switcherProp !== undefined ? show_agent_switcherProp : true);

    const effectiveShowBottomSection = showBottomSectionProp !== undefined
        ? showBottomSectionProp
        : (show_bottom_sectionProp !== undefined ? show_bottom_sectionProp : true);

    // Configure Local Network Access early
    configureLocalNetworkAccess({ enabled: allowLocalNetworkAccess });
    warnIfLocalNetworkUrl('ChatbotProvider streamUrl', streamUrl);
    warnIfLocalNetworkUrl('ChatbotProvider storageApiUrl', storageApiUrl);

    const internalClient = useMemo(
        () => (streamUrl ? new StreamClient({ baseUrl: streamUrl, headers: streamHeaders }) : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [streamUrl, JSON.stringify(streamHeaders)]
    );

    const activeClient = clientProp !== undefined ? clientProp : internalClient;

    // Cache for blob URLs to avoid refetching
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

    // Questionnaire handling
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

    const handleQuestionnaireSubmit = useCallback((formatted: string) => {
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

    // Enablable tools
    const [enablableTools, setEnablableTools] = useState<EnablableTool[]>([]);
    const [enabledToolIds, setEnabledToolIds] = useState<string[]>([]);

    const handledToolSlugs = useMemo(
        () =>
            Object.entries(registeredTools)
                .filter(([, cfg]) => isClientTool(cfg))
                .map(([slug]) => slug),
        [registeredTools]
    );

    useEffect(() => {
        if (!show_tool_toggles || !activeClient || !('listEnablableTools' in activeClient)) {
            return;
        }
        let cancelled = false;
        const gateway = activeClient as GatewayStreamClient;
        gateway
            .listEnablableTools(agentId)
            .then(listed => {
                if (cancelled) return;
                setEnablableTools(listed);
                const allowed = new Set(listed.map(t => t.uuid));
                setEnabledToolIds(readStoredToolIds(agentId).filter(id => allowed.has(id)));
            })
            .catch(error => {
                if (cancelled) return;
                console.error('[ChatbotProvider] listing enablable tools failed', error);
                setEnablableTools([]);
            });
        return () => {
            cancelled = true;
        };
    }, [activeClient, agentId, show_tool_toggles]);

    useEffect(() => {
        if (activeClient && 'setEnabledToolIds' in activeClient) {
            (activeClient as GatewayStreamClient).setEnabledToolIds(enabledToolIds);
        }
    }, [activeClient, enabledToolIds]);

    const handleToolSelectionChange = useCallback(
        (next: string[]) => {
            setEnabledToolIds(next);
            writeStoredToolIds(agentId, next);
        },
        [agentId]
    );

    // Stream Chat
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

    // Conversations
    const {
        conversations,
        isLoading: isLoadingConversations,
        isLoadingMore,
        hasMore,
        activeConversationId,
        fetchConversations,
        loadMore,
        selectConversation,
        newChat,
        deleteConversation,
    } = useConversations(activeClient as GatewayStreamClient | null, storageApiUrl);

    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [staleClientCall, setStaleClientCall] = useState(false);
    const composerRef = useRef<ComposerHandle>(null);

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
        async (text: string, attachedFiles?: AttachedFile[], _contextIds?: string[]) => {
            await sendStreamMessage(text, attachedFiles);
            fetchConversations();
        },
        [sendStreamMessage, fetchConversations]
    );

    const answerPendingCall = useCallback(
        async (call: { jobUuid: string; stepUuid: string; toolSlug: string; toolInput: any }) => {
            const gateway = activeClient as GatewayStreamClient | null;
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
        [activeClient, registeredTools]
    );

    const applyLoadedConversation = useCallback(
        async (id: string, detail: ConversationDetail) => {
            const gateway = activeClient as GatewayStreamClient | null;
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
        [activeClient, resumeTurn, answerPendingCall]
    );

    const handleSelectConversation = useCallback(
        async (id: string): Promise<boolean> => {
            const gateway = activeClient as GatewayStreamClient | null;
            const departing = gateway?.getConversationId?.() ?? null;

            const loaded = await selectConversation(id);
            if (!loaded) return false;

            if (departing && departing !== id) {
                gateway?.parkStream?.(departing);
            }
            setPendingQuestionnaire(null);
            setStaleClientCall(false);

            loadConversation(loaded.messages, collectPendingApprovals(loaded.detail.jobs));
            setIsDrawerOpen(false);
            await applyLoadedConversation(id, loaded.detail);
            return true;
        },
        [activeClient, selectConversation, loadConversation, applyLoadedConversation]
    );

    const handleNewChat = useCallback(() => {
        newChat();
        reset();
        setPendingQuestionnaire(null);
        setStaleClientCall(false);
        setIsDrawerOpen(false);
        focusComposer();
    }, [newChat, reset, focusComposer]);

    const didRestoreRef = useRef(false);
    useEffect(() => {
        if (didRestoreRef.current || activeConversationId) return;
        const restored = (activeClient as GatewayStreamClient | null)?.getConversationId?.();
        if (!restored) return;
        didRestoreRef.current = true;
        void handleSelectConversation(restored).then(ok => {
            if (!ok) didRestoreRef.current = false;
        });
    }, [activeClient, activeConversationId, handleSelectConversation]);

    const [internalAgentId, setInternalAgentId] = useState<string | null>(null);
    const effectiveAgentId = agentId !== undefined ? agentId : internalAgentId;

    const setAgentId = useCallback(
        (id: string | null) => {
            setInternalAgentId(id);
            onAgentChange?.(id);
            if (activeClient && 'setAgentId' in activeClient) {
                (activeClient as any).setAgentId(id);
            }
        },
        [activeClient, onAgentChange]
    );

    const currentConversationId =
        activeConversationId || (activeClient as GatewayStreamClient | null)?.getConversationId?.() || null;

    const copyConversationId = useCallback(() => {
        if (currentConversationId && navigator.clipboard) {
            void navigator.clipboard.writeText(currentConversationId);
        }
    }, [currentConversationId]);

    const handleDeleteConversation = useCallback(
        async (id: string) => {
            await deleteConversation(id);
            if (activeConversationId === id || currentConversationId === id) {
                handleNewChat();
            }
        },
        [deleteConversation, activeConversationId, currentConversationId, handleNewChat]
    );

    const value: ChatbotContextValue = useMemo(
        () => ({
            client: activeClient,
            storageApiUrl,
            accessToken,
            mode,
            theme,
            config,
            userName,
            allowLocalNetworkAccess,

            fetchAuthenticatedUrl,
            getFileDownloadUrl,

            messages,
            isThinking,
            isResuming,
            isStopping,
            sendMessage,
            stopTurn,
            retryTurn,
            continueTurn,
            reset,
            loadConversation,
            confirmApproval,
            rejectApproval,
            usageSummary,

            pendingQuestionnaire,
            handleQuestionnaireSubmit,
            staleClientCall,
            focusComposer,
            composerRef,

            conversations,
            activeConversationId: currentConversationId,
            isLoadingConversations,
            isLoadingMore,
            hasMore,
            fetchConversations,
            loadMore,
            selectConversation: handleSelectConversation,
            newChat: handleNewChat,
            deleteConversation: handleDeleteConversation,
            copyConversationId,

            registeredTools,
            enablableTools,
            enabledToolIds,
            handledToolSlugs,
            handleToolSelectionChange,
            agents,
            agentId: effectiveAgentId,
            agentsLoading,
            onAgentChange,
            setAgentId,

            isDrawerOpen,
            setIsDrawerOpen,
            isOpen,
            onClose,
            onOpen,
            onSwitchMode,
            onShare,

            showAgentSwitcher: effectiveShowAgentSwitcher,
            show_agent_switcher: effectiveShowAgentSwitcher,
            showBottomSection: effectiveShowBottomSection,
            show_bottom_section: effectiveShowBottomSection,
        }),
        [
            activeClient,
            storageApiUrl,
            accessToken,
            mode,
            theme,
            config,
            userName,
            allowLocalNetworkAccess,
            fetchAuthenticatedUrl,
            getFileDownloadUrl,
            messages,
            isThinking,
            isResuming,
            isStopping,
            sendMessage,
            stopTurn,
            retryTurn,
            continueTurn,
            reset,
            loadConversation,
            confirmApproval,
            rejectApproval,
            usageSummary,
            pendingQuestionnaire,
            handleQuestionnaireSubmit,
            staleClientCall,
            focusComposer,
            composerRef,
            conversations,
            currentConversationId,
            isLoadingConversations,
            isLoadingMore,
            hasMore,
            fetchConversations,
            loadMore,
            handleSelectConversation,
            handleNewChat,
            handleDeleteConversation,
            copyConversationId,
            registeredTools,
            enablableTools,
            enabledToolIds,
            handledToolSlugs,
            handleToolSelectionChange,
            agents,
            effectiveAgentId,
            agentsLoading,
            onAgentChange,
            setAgentId,
            isDrawerOpen,
            isOpen,
            onClose,
            onOpen,
            onSwitchMode,
            onShare,
            effectiveShowAgentSwitcher,
            effectiveShowBottomSection,
        ]
    );

    return <ChatbotContext.Provider value={value}>{children}</ChatbotContext.Provider>;
};

export const useChatbot = (): ChatbotContextValue | null => {
    return useContext(ChatbotContext);
};

export const useChatbotContext = (): ChatbotContextValue | null => {
    return useContext(ChatbotContext);
};

export const useChatMessages = () => {
    const ctx = useChatbot();
    return {
        messages: ctx?.messages ?? [],
        isThinking: ctx?.isThinking ?? false,
        isResuming: ctx?.isResuming ?? false,
        isStopping: ctx?.isStopping ?? false,
        sendMessage: ctx?.sendMessage,
        stopTurn: ctx?.stopTurn,
        retryTurn: ctx?.retryTurn,
        continueTurn: ctx?.continueTurn,
        reset: ctx?.reset,
        confirmApproval: ctx?.confirmApproval,
        rejectApproval: ctx?.rejectApproval,
    };
};

export const useChatConversations = () => {
    const ctx = useChatbot();
    return {
        conversations: ctx?.conversations ?? [],
        activeConversationId: ctx?.activeConversationId ?? null,
        isLoading: ctx?.isLoadingConversations ?? false,
        isLoadingMore: ctx?.isLoadingMore ?? false,
        hasMore: ctx?.hasMore ?? false,
        selectConversation: ctx?.selectConversation,
        newChat: ctx?.newChat,
        deleteConversation: ctx?.deleteConversation,
        fetchConversations: ctx?.fetchConversations,
        loadMore: ctx?.loadMore,
    };
};

export const useChatComposer = () => {
    const ctx = useChatbot();
    return {
        sendMessage: ctx?.sendMessage,
        focusComposer: ctx?.focusComposer,
        composerRef: ctx?.composerRef,
        isThinking: ctx?.isThinking ?? false,
        isResuming: ctx?.isResuming ?? false,
        isStopping: ctx?.isStopping ?? false,
        stopTurn: ctx?.stopTurn,
        usageSummary: ctx?.usageSummary ?? null,
        tools: ctx?.enablableTools ?? [],
        enabledToolIds: ctx?.enabledToolIds ?? [],
        onToolsChange: ctx?.handleToolSelectionChange,
        handledToolSlugs: ctx?.handledToolSlugs ?? [],
        agents: ctx?.agents ?? [],
        agentId: ctx?.agentId ?? null,
        setAgentId: ctx?.setAgentId,
        storageApiUrl: ctx?.storageApiUrl ?? '',
        accessToken: ctx?.accessToken ?? null,
        showAgentSwitcher: ctx?.showAgentSwitcher ?? true,
        show_agent_switcher: ctx?.show_agent_switcher ?? true,
        showBottomSection: ctx?.showBottomSection ?? true,
        show_bottom_section: ctx?.show_bottom_section ?? true,
    };
};
