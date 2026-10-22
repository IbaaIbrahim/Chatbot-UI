import React from 'react';
import { netFetch, configureLocalNetworkAccess, warnIfLocalNetworkUrl } from '../common/localNetwork';
import { StreamClient, StreamChatClient } from '../api/StreamClient';
import { GatewayStreamClient, EnablableTool } from '../api/GatewayStreamClient';
import { StorageClient, StorageRequestError } from '../api/StorageClient';
import { BlobUrlCache } from '../common/blobCache';
import { useStreamChat, UseStreamChatOptions } from '../hooks/useStreamChat';
import {
    collectPendingApprovals,
    findPendingClientToolCalls,
    useConversations,
} from '../hooks/useConversations';
import { isClientTool } from '../common/toolConfig';
import type { ClientSkillDefinition, ToolConfig } from '../common/toolConfig';
import { isHostRequestSlug } from '../common/hostCatalogue';
import type { AttachedFile, ConversationDetail, UserCredits } from '../api/types';
import { summarizeUsage } from '../common/usageSummary';
import { resolveChatbotConfig } from '../common/chatbotConfig';
import { formattingLocale, labelledError } from '../common/i18n';
import { blockLanguagesOf } from '../common/markdownBlocks';
import type { ChatbotConfig } from '../common/chatbotConfig';
import type { QuestionSpec } from '../components/Questionnaire/QuestionnaireForm';
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

/**
 * Where the user's tool switches are kept, across page loads and screens.
 *
 * One key since 4.0. Until then it was one key per agent (`…:<agent uuid>`,
 * `…:__agentless__` when none was picked), because the picker changed which
 * tools a job could have. With no picker, almost every job is sent without an
 * agent, so the agentless key is the selection the user actually made; it is
 * read once, when the new key has never been written, and removed by the
 * first write. The per-agent keys are left alone: they belong to a choice the
 * user can no longer make.
 */
const TOOL_SELECTION_STORAGE_KEY = 'chatbot-ui:enabled-tools';
const LEGACY_TOOL_SELECTION_STORAGE_KEY = 'chatbot-ui:enabled-tools:__agentless__';

/**
 * When to read the list again after a new thread's first turn, for its title.
 *
 * The Gateway names a thread from its first turn after that turn ends — the
 * Orchestrator asks the model once the reply is complete, and the Archiver
 * stores the answer — so the read made the moment the turn finishes still
 * shows the six-word fallback. Two later reads cover a quick answer and a slow
 * one; past the second the title appears on the next read anyway.
 */
const TITLE_REFRESH_DELAYS_MS = [3000, 8000];

function readStoredToolIds(): string[] {
    try {
        const raw = window.localStorage.getItem(TOOL_SELECTION_STORAGE_KEY)
            ?? window.localStorage.getItem(LEGACY_TOOL_SELECTION_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
    } catch {
        return [];
    }
}

/**
 * Save the switches this page changed without forgetting the ones it cannot see.
 *
 * Pages do not all list the same tools: a screen whose client is bound to one
 * agent lists only what that agent's policy allows, while a chat sent without
 * one (central mode) lists every active user-enabled tool. With one key for
 * both, writing `next` alone would let the narrower page wipe every selection
 * outside its list the moment the user touched one switch, and the root chat
 * would come back with its tools off after a visit to it. Only what this page
 * lists is its to change; every stored id outside that list is kept as it was.
 */
function writeStoredToolIds(next: string[], listedIds: ReadonlySet<string>): void {
    try {
        const keptUnseen = readStoredToolIds().filter(id => !listedIds.has(id) && !next.includes(id));
        window.localStorage.setItem(TOOL_SELECTION_STORAGE_KEY, JSON.stringify([...next, ...keptUnseen]));
        window.localStorage.removeItem(LEGACY_TOOL_SELECTION_STORAGE_KEY);
    } catch {
        // Storage full or unavailable
    }
}

const CONFIG_GROUPS = ['icons', 'header', 'composer', 'sidebar', 'greeting', 'markdown'] as const;
const CONFIG_LISTS = ['suggestions', 'quickActions', 'featureCards'] as const;

/**
 * Two label maps that say the same: key by key, a counting label's plural
 * forms compared form by form — so `{ credits: { one, other } }` written
 * inline is equal to itself on the next render.
 */
function labelMapsEqual(left: object | undefined, right: object | undefined): boolean {
    if (Object.is(left, right)) return true;
    if (!left || !right) return false;
    const leftEntries = Object.entries(left);
    if (leftEntries.length !== Object.keys(right).length) return false;
    return leftEntries.every(([key, value]) => {
        if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
        const other = (right as Record<string, unknown>)[key];
        return Object.is(value, other)
            || (typeof value === 'object' && typeof other === 'object' && shallowEqual(value, other));
    });
}

/** Two translation maps that say the same: language by language, each map as {@link labelMapsEqual}. */
function translationsEqual(left: ChatbotConfig['translations'], right: ChatbotConfig['translations']): boolean {
    if (Object.is(left, right)) return true;
    if (!left || !right) return false;
    const languages = Object.keys(left);
    if (languages.length !== Object.keys(right).length) return false;
    return languages.every(language =>
        Object.prototype.hasOwnProperty.call(right, language) && labelMapsEqual(left[language], right[language])
    );
}

/**
 * Whether two override layers say the same thing, so re-registering an equal
 * layer — a literal rebuilt on every render — changes nothing downstream.
 * Groups compare key by key; `labels` and `translations` one level further,
 * so plural forms and a language's map written inline count as equal.
 */
function layersEqual(left: ChatbotConfig, right: ChatbotConfig): boolean {
    return CONFIG_GROUPS.every(group => shallowEqual(left[group], right[group]))
        && labelMapsEqual(left.labels, right.labels)
        && translationsEqual(left.translations, right.translations)
        && CONFIG_LISTS.every(list => Object.is(left[list], right[list]))
        && Object.is(left.language, right.language);
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
    /** Fills `{name}` in the greeting. Defaults to `labels.defaultUserName` ("User"). */
    userName?: string;
    onEvent?: UseStreamChatOptions['onEvent'];
    allowLocalNetworkAccess?: boolean;
    tools?: Record<string, ToolConfig>;
    /**
     * This application's own skills ("client skills"): instructions the model
     * loads with `load_skill` when a conversation needs them, together with
     * every tool whose `definition.skills` names the slug. Never sent with a
     * message — in central mode the platform asks the browser for them on
     * demand (platform ADR-018, "Host catalogue and conversation-scoped
     * loads"). See `ClientSkillDefinition`.
     *
     * Memoise it. Omit it to leave the client's skills as they are (set with
     * `client.setSkills`); pass `[]` to clear them.
     */
    skills?: ClientSkillDefinition[];
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
    /**
     * The URL that opens a conversation in the host, e.g.
     * `id => \`${location.origin}/ai/assistant/${id}\``. With it the header's
     * menu offers "Copy conversation link" instead of "Copy conversation ID":
     * only the host knows its own routes, so the library cannot build one.
     */
    conversationLink?: (conversationId: string) => string;
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
    userName: userNameProp,
    onEvent,
    allowLocalNetworkAccess = false,
    tools,
    skills,
    config,
    open: openProp,
    defaultOpen = true,
    onOpenChange,
    sidebarOpen: sidebarOpenProp,
    defaultSidebarOpen = false,
    onSidebarOpenChange,
    onSwitchMode,
    onShare,
    conversationLink,
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
    // What the turn's hooks write into a message — a notice, an error, a
    // check-in — is written in the language in force when it happens: read
    // through a ref, so the hooks' callbacks need not change with it.
    const labelsRef = useRef(resolvedConfig.labels);
    labelsRef.current = resolvedConfig.labels;
    const languageRef = useRef(resolvedConfig.language);
    languageRef.current = resolvedConfig.language;
    const getLabels = useCallback(() => labelsRef.current, []);
    const getLanguage = useCallback(() => formattingLocale(languageRef.current), []);
    const userName = userNameProp ?? resolvedConfig.labels.defaultUserName;

    // --- Authenticated storage access ---
    // Object URLs of fetched files, by URL, least recently used first — see
    // `common/blobCache.ts` for why it is bounded.
    const blobCacheRef = useRef<BlobUrlCache>(new BlobUrlCache());
    // A fetch already under way for a URL, so two thumbnails of one file share it.
    const pendingBlobsRef = useRef<Map<string, Promise<string>>>(new Map());

    const fetchAuthenticatedUrl = useCallback(
        async (url: string): Promise<string> => {
            const resolvedUrl = url.startsWith('http')
                ? url
                : `${storageApiUrl.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}`;

            const cached = blobCacheRef.current.get(resolvedUrl);
            if (cached) {
                return cached;
            }
            const pending = pendingBlobsRef.current.get(resolvedUrl);
            if (pending) return pending;

            if (!accessToken) {
                throw labelledError('attachmentNoAuth', 'No access token available for authenticated fetch');
            }

            const load = (async () => {
                const response = await netFetch(resolvedUrl, {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                    },
                });

                if (!response.ok) {
                    throw labelledError(
                        'attachmentLoadFailedStatus',
                        `Failed to fetch authenticated URL: ${response.status}`,
                        { status: response.status },
                    );
                }

                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);
                blobCacheRef.current.set(resolvedUrl, blobUrl, blob.size);
                return blobUrl;
            })();
            pendingBlobsRef.current.set(resolvedUrl, load);
            try {
                return await load;
            } finally {
                pendingBlobsRef.current.delete(resolvedUrl);
            }
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

    // --- Conversation files and artifacts (storage API) ---
    // One client per URL and token, so a panel's effects that depend on it run
    // when the user's session changes and not on every render.
    const storageClient = useMemo(
        () => (storageApiUrl && accessToken ? new StorageClient({ storageApiUrl, token: accessToken }) : null),
        [storageApiUrl, accessToken]
    );
    const [isFilesPanelOpen, setFilesPanelOpen] = useState(false);
    const [isArtifactsPanelOpen, setArtifactsPanelOpen] = useState(false);
    const [artifactsOpenings, setArtifactsOpenings] = useState(0);
    const [filesRevision, setFilesRevision] = useState(0);

    // Cleanup blob URLs on unmount
    useEffect(() => {
        const cache = blobCacheRef.current;
        return () => {
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

    // Beside the tools and for the same reason: both are read when a host
    // request arrives, and this effect is declared before the one that
    // restores the tab's conversation — effects run in declaration order — so
    // a request replayed by that restore is answered with the skills in place.
    // Duck-typed like `setTools`: only the gateway client serves skills.
    useEffect(() => {
        if (skills !== undefined && activeClient && 'setSkills' in activeClient) {
            (activeClient as GatewayStreamClient).setSkills(skills);
        }
    }, [activeClient, skills]);

    // The fence languages this page draws, sent with every job as
    // `block_languages` so the platform indexes the turn's blocks (the files
    // panel and Artifacts list them as "Not saved" until saved). Keyed on the
    // list's text, so a renderer map rebuilt with the same languages changes
    // nothing. Duck-typed like `setTools`: only the gateway client sends it.
    const blockLanguagesKey = blockLanguagesOf(Object.keys(resolvedConfig.markdown.blockRenderers)).join(',');
    useEffect(() => {
        if (activeClient && 'setBlockLanguages' in activeClient) {
            (activeClient as GatewayStreamClient).setBlockLanguages(blockLanguagesKey ? blockLanguagesKey.split(',') : []);
        }
    }, [activeClient, blockLanguagesKey]);

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

    /**
     * The list follows the client's agent, read when this runs rather than held
     * as state. Since 4.0 the agent is a binding the host makes on the client
     * — `config.agentId` or `setAgentId()` before the provider first sees it —
     * not a choice the user makes in the chat, so nothing in here changes it
     * and there is nothing to re-list on. Without one (central mode) the
     * Gateway lists every active user-enabled tool.
     */
    useEffect(() => {
        if (!toolsMenuEnabled || !activeClient || !('listEnablableTools' in activeClient)) {
            return;
        }
        let cancelled = false;
        const client = activeClient as GatewayStreamClient;
        client
            .listEnablableTools(client.getAgentId?.() ?? null)
            .then(listed => {
                if (cancelled) return;
                setEnablableTools(listed);
                const allowed = new Set(listed.map(t => t.uuid));
                setEnabledToolIds(readStoredToolIds().filter(id => allowed.has(id)));
            })
            .catch(error => {
                if (cancelled) return;
                console.error('[ChatbotProvider] listing enablable tools failed', error);
                setEnablableTools([]);
            });
        return () => {
            cancelled = true;
        };
    }, [activeClient, toolsMenuEnabled]);

    useEffect(() => {
        if (activeClient && 'setEnabledToolIds' in activeClient) {
            (activeClient as GatewayStreamClient).setEnabledToolIds(enabledToolIds);
        }
    }, [activeClient, enabledToolIds]);

    const changeEnabledToolIds = useCallback(
        (next: string[]) => {
            setEnabledToolIds(next);
            writeStoredToolIds(next, new Set(enablableTools.map(tool => tool.uuid)));
        },
        [enablableTools]
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
        getLabels,
        getLanguage,
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
        renamingSupported,
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
        renameConversation,
        searchConversations,
    } = useConversations(gateway, storageApiUrl, { getLabels, getLanguage });

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

    const titleRefreshTimers = useRef<number[]>([]);
    useEffect(() => () => titleRefreshTimers.current.forEach(timer => window.clearTimeout(timer)), []);

    const sendMessage = useCallback(
        async (text: string, attachedFiles?: AttachedFile[]) => {
            const startsThread = !(activeConversationId || gateway?.getConversationId?.());
            await sendStreamMessage(text, attachedFiles);
            fetchConversations();
            if (startsThread) {
                titleRefreshTimers.current = TITLE_REFRESH_DELAYS_MS.map(delay =>
                    window.setTimeout(() => void fetchConversations(), delay)
                );
            }
        },
        [sendStreamMessage, fetchConversations, activeConversationId, gateway]
    );

    const answerPendingCall = useCallback(
        async (call: { jobUuid: string; stepUuid: string; toolSlug: string; toolInput: any }) => {
            // A host request is never a pending *client* step (it rides on the
            // meta-tool's harness step, or on none), so the transcript cannot
            // offer one; and a reserved slug must never reach a host tool of
            // the same name. The platform times an unanswered one out itself.
            if (isHostRequestSlug(call.toolSlug)) return;
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
        // The files panel lists the open conversation's files, and a new chat
        // has none: left open it would show the empty state of a thread that
        // does not exist yet.
        setFilesPanelOpen(false);
        focusComposer();
    }, [newChat, reset, focusComposer]);

    /**
     * Reopen the conversation the client points at — the one this tab last had
     * open, or one the host named before handing the client over (a link to
     * it, say).
     *
     * One that will not load is let go of rather than retried. The client's
     * pointer is also where the *next message* goes, so keeping a pointer to a
     * thread that was deleted, or that is someone else's (a link they were
     * sent), filed that message into a conversation the Gateway refuses, and
     * every send failed. Only if the pointer still names it: the user may have
     * picked another thread while this one was loading, and that pick stands.
     */
    const didRestoreRef = useRef(false);
    useEffect(() => {
        if (didRestoreRef.current || activeConversationId) return;
        const restored = gateway?.getConversationId?.();
        if (!restored) return;
        didRestoreRef.current = true;
        void handleSelectConversation(restored).then(ok => {
            if (!ok && gateway?.getConversationId?.() === restored) handleNewChat();
        });
    }, [gateway, activeConversationId, handleSelectConversation, handleNewChat]);

    const currentConversationId = activeConversationId || gateway?.getConversationId?.() || null;

    const copyConversationId = useCallback(() => {
        if (currentConversationId && navigator.clipboard) {
            void navigator.clipboard.writeText(currentConversationId);
        }
    }, [currentConversationId]);

    const copyConversationLink = useCallback(() => {
        if (currentConversationId && conversationLink && navigator.clipboard) {
            void navigator.clipboard.writeText(conversationLink(currentConversationId));
        }
    }, [currentConversationId, conversationLink]);

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
        canCopyConversationLink: Boolean(conversationLink),
        canStop: Boolean(activeClient && 'cancelTurn' in activeClient),
        canShowCredits,
        isCreditUsageOpen: canShowCredits && isCreditUsageOpen,

        storageClient,
        isFilesPanelOpen: Boolean(storageClient) && isFilesPanelOpen,
        isArtifactsPanelOpen: Boolean(storageClient) && isArtifactsPanelOpen,
        artifactsOpenings,
        filesRevision,

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
        renamingSupported,
        isLoadingConversations,
        isLoadingMore,
        hasMore,
        search,

        registeredTools,
        enablableTools,
        enabledToolIds,
        handledToolSlugs,
    };

    // --- What the actions do, as of this render ---
    const [events] = useState(createEventBus);

    const saveFile: ChatActions['saveFile'] = async (jobUuid, file, options) => {
        if (!storageClient) {
            throw new StorageRequestError(
                'Saving a file needs the provider\'s storageApiUrl and accessToken.', 0, null, 'storageNotConfigured'
            );
        }
        const stored = await storageClient.saveFile(jobUuid, file, options);
        // After the server accepted, never before: a panel that read again on
        // a refused save would show nothing new, and a host listening for the
        // event would count a file that does not exist.
        setFilesRevision(revision => revision + 1);
        events.emit('chat.files.changed', {
            change: 'saved',
            attachmentUuid: stored.attachment_uuid,
            file: stored,
            conversationId: stored.conversation_uuid ?? currentConversationId,
            jobUuid,
            blockKey: stored.block_key ?? (options?.isArtifact && options.blockKey ? options.blockKey : null),
            savedFromUuid: stored.saved_from_uuid,
        });
        return stored;
    };

    const saveGeneratedFile: ChatActions['saveGeneratedFile'] = async attachmentUuid => {
        if (!storageClient) {
            throw new StorageRequestError(
                'Saving a file needs the provider\'s storageApiUrl and accessToken.', 0, null, 'storageNotConfigured'
            );
        }
        const stored = await storageClient.saveGeneratedFile(attachmentUuid);
        setFilesRevision(revision => revision + 1);
        events.emit('chat.files.changed', {
            change: 'saved',
            attachmentUuid: stored.attachment_uuid,
            file: stored,
            conversationId: stored.conversation_uuid ?? currentConversationId,
            jobUuid: stored.job_uuid,
            blockKey: null,
            savedFromUuid: stored.saved_from_uuid ?? attachmentUuid,
        });
        return stored;
    };

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
        // One at a time: the files panel covers the chat, the Artifacts view
        // takes its place, and the view can open a conversation the files
        // panel would then describe.
        openFiles: () => {
            setArtifactsPanelOpen(false);
            setFilesPanelOpen(true);
        },
        closeFiles: () => setFilesPanelOpen(false),
        openArtifacts: () => {
            setFilesPanelOpen(false);
            setArtifactsPanelOpen(true);
            // Counted, so "Artifacts" chosen while it already shows takes the
            // view back to its list (an artifact may be open) and focus to it.
            setArtifactsOpenings(count => count + 1);
        },
        closeArtifacts: () => setArtifactsPanelOpen(false),

        saveFile,
        saveArtifact: (jobUuid, file, options) => saveFile(jobUuid, file, { ...options, isArtifact: true }),
        saveGeneratedFile,
        deleteArtifact: async (attachmentUuid) => {
            if (!storageClient) {
                throw new StorageRequestError(
                    'Deleting an artifact needs the provider\'s storageApiUrl and accessToken.', 0, null, 'storageNotConfigured'
                );
            }
            await storageClient.deleteArtifact(attachmentUuid);
            // Its bytes, if a thumbnail or a preview fetched them, are of a
            // file that no longer exists: let them go now, not at unmount.
            blobCacheRef.current.forgetAttachment(attachmentUuid);
            setFilesRevision(revision => revision + 1);
            events.emit('chat.files.changed', {
                change: 'deleted',
                attachmentUuid,
                file: null,
                conversationId: null,
                jobUuid: null,
                blockKey: null,
                savedFromUuid: null,
            });
        },

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

        // A new chat, a conversation picked or a prompt put in the composer
        // is a chat the user wants to see: the Artifacts view, which stands
        // in its place (2026-10-14), gives the column back — from the
        // sidebar, the header or a host's own button alike.
        newChat: () => {
            setArtifactsPanelOpen(false);
            handleNewChat();
            events.emit('conversation.created', {});
        },
        selectConversation: async (conversationId) => {
            setArtifactsPanelOpen(false);
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
        renameConversation: async (conversationId, title) => {
            await renameConversation(conversationId, title);
            events.emit('conversation.renamed', { conversationId, title: title.trim() });
        },
        searchConversations,
        refreshConversations: fetchConversations,
        loadMoreConversations: loadMore,
        copyConversationId,
        copyConversationLink,

        setEnabledToolIds: changeEnabledToolIds,

        focusComposer,
        setComposerText: (text) => {
            composerRef.current?.setText(text);
            if (isArtifactsPanelOpen) {
                // Hidden behind the view until the next render: focus once it is back.
                setArtifactsPanelOpen(false);
                focusComposer();
            } else {
                composerRef.current?.focus();
            }
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
        openFiles: () => latest.current.openFiles(),
        closeFiles: () => latest.current.closeFiles(),
        openArtifacts: () => latest.current.openArtifacts(),
        closeArtifacts: () => latest.current.closeArtifacts(),
        saveFile: (jobUuid, file, options) => latest.current.saveFile(jobUuid, file, options),
        saveArtifact: (jobUuid, file, options) => latest.current.saveArtifact(jobUuid, file, options),
        saveGeneratedFile: attachmentUuid => latest.current.saveGeneratedFile(attachmentUuid),
        deleteArtifact: attachmentUuid => latest.current.deleteArtifact(attachmentUuid),
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
        renameConversation: (id, title) => latest.current.renameConversation(id, title),
        searchConversations: query => latest.current.searchConversations(query),
        refreshConversations: () => latest.current.refreshConversations(),
        loadMoreConversations: () => latest.current.loadMoreConversations(),
        copyConversationId: () => latest.current.copyConversationId(),
        copyConversationLink: () => latest.current.copyConversationLink(),
        setEnabledToolIds: ids => latest.current.setEnabledToolIds(ids),
        focusComposer: () => latest.current.focusComposer(),
        setComposerText: text => latest.current.setComposerText(text),
    };
}
