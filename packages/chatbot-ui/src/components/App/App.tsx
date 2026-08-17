import * as React from 'react';
import { ChatContainer, ChatMode } from '../ChatContainer/ChatContainer';
import { MessageBubble } from '../MessageBubble/MessageBubble';
import { Composer } from '../Composer/Composer';
import { WelcomeScreen } from '../WelcomeScreen/WelcomeScreen';
import { ThinkingIndicator } from '../ThinkingIndicator/ThinkingIndicator';
import { AgentSidebar, AgentSidebarItem } from '../AgentSidebar/AgentSidebar';
import { AgentSwitcher } from '../AgentSwitcher/AgentSwitcher';
import { ChatbotProvider } from '../../context/ChatbotContext';
import { QuestionnaireForm, QuestionSpec } from '../Questionnaire/QuestionnaireForm';
import { StreamClient, StreamChatClient } from '../../api/StreamClient';
import {
    GatewayStreamClient,
    EnablableTool,
    ExternalToolConfig,
    ResultPreviewer,
} from '../../api/GatewayStreamClient';
import { useStreamChat, UseStreamChatOptions } from '../../hooks/useStreamChat';
import { useConversations } from '../../hooks/useConversations';
import { ConversationDrawer } from '../ConversationDrawer/ConversationDrawer';
import { ToolActionConfig } from '../ToolInvocation/ToolInvocation';
import { AttachedFile } from '../../api/types';

/**
 * Where a user's tool selection is remembered, per agent.
 *
 * Keyed by agent because the allowed set differs per agent — one shared key
 * would carry a UUID into an agent that denies it, and the Gateway rejects that
 * whole job rather than ignoring the extra tool.
 */
const TOOL_SELECTION_STORAGE_PREFIX = 'chatbot-ui:enabled-tools:';

function toolSelectionKey(agentId?: string | null): string {
    return `${TOOL_SELECTION_STORAGE_PREFIX}${agentId ?? '__agentless__'}`;
}

/**
 * Read a remembered selection. Never throws: `localStorage` is unavailable in
 * private-mode Safari and in SSR, and a chat that refuses to load because a
 * preference could not be read would be a poor trade.
 */
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
        // Storage full or unavailable — the selection still applies to this
        // session, it just won't be remembered.
    }
}

export interface AppProps {
    client?: StreamChatClient | GatewayStreamClient | null;
    streamUrl?: string;
    streamHeaders?: Record<string, string>;
    mode?: ChatMode;
    isOpen?: boolean;
    onClose?: () => void;
    onOpen?: () => void;
    embedded?: boolean;
    userName?: string;
    onEvent?: UseStreamChatOptions['onEvent'];
    storageApiUrl?: string;
    accessToken?: string | null;
    /**
     * Agent list to show in the sidebar. When provided the drawer shows an
     * agent-switcher section above the conversation history. Each item's
     * ``onClick`` is responsible for switching the active agent on the client.
     */
    agents?: AgentSidebarItem[];
    /**
     * Handlers for **client-side** tools — those with
     * ``quota.tools.dispatch_mode = 'client'``, or defined inline here via
     * ``definition``. The agent's call suspends the job; the callback receives
     * the agent's ``tool_input`` and whatever it returns resumes the job as the
     * tool result.
     *
     * Example:
     * ```ts
     * external_tools={{ preview_property_agent_result: { callback: openPreview } }}
     * ```
     *
     * Registering a **server-side** tool here does not work and never fired:
     * a ``kafka``/``inline`` tool emits no ``client_tool_call``, so the callback
     * would only ever be reachable from the action button — and with the
     * arguments the model invented, not the result. Use
     * {@link AppProps.result_previewers} for those.
     */
    external_tools?: Record<string, ExternalToolConfig>;
    /**
     * Handlers for the **output of server-side** tools, keyed by tool slug.
     * Fired when the tool's ``tool_result`` event arrives, and again whenever
     * the user clicks "Open Preview" on the completed step (including after a
     * conversation reload). The handler receives the tool's parsed output; its
     * return value is ignored, because no job is suspended waiting on it.
     *
     * Example:
     * ```ts
     * result_previewers={{ generate_checklist: (checklist) => openPreview(checklist) }}
     * ```
     */
    result_previewers?: Record<string, ResultPreviewer>;
    /**
     * How each tool's completed step presents its action, keyed by tool slug.
     *
     * Registering a handler in `external_tools` or `result_previewers` is what
     * makes an action possible; this is what decides whether it is *offered*.
     * They are separate because they answer different questions — a tool like
     * `read_page_context` needs a handler to work at all but has nothing a user
     * would want to re-open, so its button is noise.
     *
     * A slug with no entry keeps the default button, which is what every
     * registered handler had before this existed.
     *
     * ```tsx
     * tool_actions={{
     *   read_page_context: { show: false },
     *   generate_checklist: {
     *     label: 'View checklist',
     *     render: ({ onAction, payload }) => (
     *       <MyButton onClick={onAction}>{payload.title}</MyButton>
     *     ),
     *   },
     * }}
     * ```
     */
    tool_actions?: Record<string, ToolActionConfig>;
    /**
     * The agent the client is currently pointed at, if any.
     *
     * Needed because which tools a user may switch on depends on the agent's
     * policy, and the host application owns agent selection (`client.setAgentId`)
     * — this component has no way to observe that call. Pass the same value you
     * pass to `setAgentId` and the tool list stays in step with it.
     */
    agentId?: string | null;
    /**
     * Offer the tools menu from the composer's toolbar. Default `true`.
     *
     * Turn it off to render your own switches; call
     * `client.setEnabledToolIds(...)` yourself if you do, or the tools stay off.
     */
    show_tool_toggles?: boolean;
}

export const App: React.FC<AppProps> = ({
    client: clientProp,
    streamUrl,
    streamHeaders,
    mode = 'fullscreen',
    isOpen = true,
    onClose,
    onOpen,
    embedded = false,
    userName = 'User',
    onEvent,
    storageApiUrl,
    accessToken,
    agents,
    external_tools,
    result_previewers,
    tool_actions,
    agentId,
    show_tool_toggles = true,
}) => {
    const internalClient = React.useMemo(
        () => streamUrl ? new StreamClient({ baseUrl: streamUrl, headers: streamHeaders }) : null,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [streamUrl, JSON.stringify(streamHeaders)]
    );

    const activeClient = clientProp !== undefined ? clientProp : internalClient;

    // Pending questionnaire (the built-in ``ask_user_questions`` client tool).
    // ``resolve`` is the Promise resolver the GatewayStreamClient is awaiting;
    // calling it with the formatted answers resumes the suspended job.
    const [pendingQuestionnaire, setPendingQuestionnaire] = React.useState<
        { questions: QuestionSpec[]; resolve: (formatted: string) => void } | null
    >(null);

    // Built-in handler for the ``ask_user_questions`` tool: show the form and
    // resolve once the user submits, so its answers flow back as the result.
    const handleAskUserQuestions = React.useCallback((data: any): Promise<string> => {
        const questions: QuestionSpec[] = Array.isArray(data?.questions) ? data.questions : [];
        return new Promise<string>(resolve => {
            setPendingQuestionnaire({ questions, resolve });
        });
    }, []);

    const handleQuestionnaireSubmit = React.useCallback((formatted: string) => {
        setPendingQuestionnaire(prev => {
            prev?.resolve(formatted);
            return null;
        });
    }, []);

    // Register the built-in questionnaire handler alongside any app-provided
    // external tools (the app may override it by passing its own entry).
    React.useEffect(() => {
        if (activeClient && 'setExternalTools' in activeClient) {
            (activeClient as GatewayStreamClient).setExternalTools({
                ask_user_questions: { callback: handleAskUserQuestions },
                ...external_tools,
            });
        }
    }, [activeClient, external_tools, handleAskUserQuestions]);

    // --- User-enabled tools -------------------------------------------------
    // A `user_enabled_*` tool is left out of a job's tool snapshot entirely
    // unless its UUID is named on job creation, so the model is never shown one
    // the user has not switched on. These two pieces of state are what makes
    // that switch reachable.
    const [enablableTools, setEnablableTools] = React.useState<EnablableTool[]>([]);
    const [enabledToolIds, setEnabledToolIds] = React.useState<string[]>([]);

    // Slugs the host app can actually execute. A `client`-dispatch tool with no
    // handler must not be offered — see ToolToggles.
    const handledSlugs = React.useMemo(
        () => Object.keys(external_tools ?? {}),
        [external_tools]
    );

    React.useEffect(() => {
        if (!show_tool_toggles || !activeClient || !('listEnablableTools' in activeClient)) {
            return;
        }
        let cancelled = false;
        const gateway = activeClient as GatewayStreamClient;
        gateway.listEnablableTools(agentId)
            .then(tools => {
                if (cancelled) return;
                setEnablableTools(tools);
                // Reconcile the remembered selection against what this agent
                // actually allows. Carrying a stale UUID over from another agent
                // is not cosmetic: the Gateway rejects the whole job with
                // TOOL_NOT_ALLOWED_BY_AGENT, so the user's next message fails to
                // send with no obvious cause.
                const allowed = new Set(tools.map(t => t.uuid));
                setEnabledToolIds(readStoredToolIds(agentId).filter(id => allowed.has(id)));
            })
            .catch(error => {
                if (cancelled) return;
                console.error('[ChatApp] listing enablable tools failed', error);
                setEnablableTools([]);
            });
        return () => { cancelled = true; };
    }, [activeClient, agentId, show_tool_toggles]);

    // Push the selection down to the client, which attaches it to every job.
    // Runs on mount too, so a remembered selection applies to the first message
    // rather than only after the user touches a switch.
    React.useEffect(() => {
        if (activeClient && 'setEnabledToolIds' in activeClient) {
            (activeClient as GatewayStreamClient).setEnabledToolIds(enabledToolIds);
        }
    }, [activeClient, enabledToolIds]);

    const handleToolSelectionChange = React.useCallback((next: string[]) => {
        setEnabledToolIds(next);
        writeStoredToolIds(agentId, next);
    }, [agentId]);

    // Register the server-tool output handlers on the client, which fires them
    // when each ``tool_result`` event arrives.
    React.useEffect(() => {
        if (activeClient && 'setResultPreviewers' in activeClient) {
            (activeClient as GatewayStreamClient).setResultPreviewers(result_previewers ?? {});
        }
    }, [activeClient, result_previewers]);

    // Surface external tool callbacks as per-message ``onToolCall`` handlers so
    // that a completed client-tool step renders an "Open Result" button the
    // user can click to re-trigger the side effect (e.g. re-open the preview).
    // The same callbacks are already fired once automatically by the
    // GatewayStreamClient on arrival; exposing them here adds the button.
    const externalToolHandlers = React.useMemo<Record<string, (data: any) => void>>(() => {
        const map: Record<string, (data: any) => void> = {};
        if (external_tools) {
            for (const [slug, config] of Object.entries(external_tools)) {
                map[slug] = config.callback;
            }
        }
        return map;
    }, [external_tools]);

    // The same for result previewers, kept as a separate map: MessageBubble
    // uses which map a slug is in to decide whether the button replays the
    // step's arguments or its result.
    type PreviewHandler = (output: any, context: { step_uuid: string }) => void;
    const resultPreviewHandlers = React.useMemo<Record<string, PreviewHandler>>(() => {
        const map: Record<string, PreviewHandler> = {};
        if (result_previewers) {
            for (const [slug, previewer] of Object.entries(result_previewers)) {
                map[slug] = (output, { step_uuid }) => {
                    void previewer(output, { tool_slug: slug, step_uuid, status: 'completed' });
                };
            }
        }
        return map;
    }, [result_previewers]);

    const {
        messages,
        isThinking,
        sendMessage,
        loadConversation,
        reset,
        confirmApproval,
        rejectApproval,
    } = useStreamChat({
        client: activeClient,
        onEvent,
        storageApiUrl,
        onToolCall: externalToolHandlers,
        onToolPreview: resultPreviewHandlers,
        toolActions: tool_actions,
    });

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
    } = useConversations(activeClient as GatewayStreamClient | null, storageApiUrl);

    const [isDrawerOpen, setIsDrawerOpen] = React.useState(false);

    const handleSend = React.useCallback(async (text: string, attachedFiles?: AttachedFile[]) => {
        await sendMessage(text, attachedFiles);
        fetchConversations();
    }, [sendMessage, fetchConversations]);

    const handleSelectConversation = React.useCallback(async (id: string) => {
        const loadedMessages = await selectConversation(id);
        if (loadedMessages) {
            loadConversation(loadedMessages);
        }
        setIsDrawerOpen(false);
    }, [selectConversation, loadConversation]);

    const handleNewChat = React.useCallback(() => {
        newChat();
        reset();
    }, [newChat, reset]);

    const showThinking = isThinking && (
        messages.length === 0 ||
        messages[messages.length - 1]?.role !== 'assistant' ||
        !messages[messages.length - 1]?.content
    );

    // Build chat history sidebar items from fetched conversations.
    const chatHistoryItems: AgentSidebarItem[] = React.useMemo(() =>
        conversations.map(conv => ({
            id: conv.uuid,
            label: conv.title,
            active: conv.uuid === activeConversationId,
            onClick: () => handleSelectConversation(conv.uuid),
        })),
        [conversations, activeConversationId, handleSelectConversation]
    );

    // When agents are provided use the AgentSidebar (agents + conversations);
    // otherwise fall back to the plain ConversationDrawer.
    const hasAgents = Boolean(agents && agents.length > 0);

    const drawerContent = hasAgents
        ? (
            <AgentSidebar
                agents={agents!}
                chatHistory={chatHistoryItems}
                onNewChat={handleNewChat}
            />
        )
        : (
            <ConversationDrawer
                conversations={conversations}
                onSelect={handleSelectConversation}
                onNewChat={handleNewChat}
                activeConversationId={activeConversationId}
                isLoading={isLoadingConversations}
                hasMore={hasMore}
                isLoadingMore={isLoadingMore}
                onLoadMore={loadMore}
            />
        );

    return (
        <ChatbotProvider accessToken={accessToken} apiBaseUrl={storageApiUrl}>
            <ChatContainer
                mode={mode}
                isOpen={isOpen}
                onClose={onClose}
                onOpen={onOpen}
                embedded={embedded}
                isDrawerOpen={isDrawerOpen}
                onDrawerOpenChange={setIsDrawerOpen}
                drawerContent={drawerContent}
                brand={hasAgents ? <AgentSwitcher agents={agents!} /> : undefined}
                footer={
                    <>
                        {pendingQuestionnaire && (
                            <QuestionnaireForm
                                questions={pendingQuestionnaire.questions}
                                onSubmit={handleQuestionnaireSubmit}
                            />
                        )}
                        <Composer
                            onSend={handleSend}
                            disabled={isThinking || !!pendingQuestionnaire}
                            placeholder={pendingQuestionnaire ? 'Answer the questions above…' : 'Type a message...'}
                            storageApiUrl={storageApiUrl}
                            accessToken={accessToken}
                            tools={show_tool_toggles ? enablableTools : []}
                            enabledToolIds={enabledToolIds}
                            onToolsChange={show_tool_toggles ? handleToolSelectionChange : undefined}
                            handledToolSlugs={handledSlugs}
                        />
                    </>
                }
            >
                {messages.length === 0 ? (
                    <WelcomeScreen userName={userName} actions={[]} />
                ) : (
                    <>
                        {messages.map(msg => {
                            // Attach both handler maps to every assistant
                            // message at render time. This covers BOTH paths
                            // that produce a tool-call step — live streaming
                            // (client_tool_call / tool_result events) and
                            // historical reload (jobsToMessageProps from the
                            // DB) — so a completed client tool (e.g.
                            // ``preview_property_agent_result``) and a
                            // previewed server tool (e.g.
                            // ``generate_checklist``) both keep their button.
                            const hasHandlers = Object.keys(externalToolHandlers).length > 0
                                || Object.keys(resultPreviewHandlers).length > 0;
                            const withTools = msg.role === 'assistant'
                                ? {
                                    ...msg,
                                    ...(hasHandlers ? {
                                        onToolCall: { ...externalToolHandlers, ...(msg.onToolCall ?? {}) },
                                        onToolPreview: { ...resultPreviewHandlers, ...(msg.onToolPreview ?? {}) },
                                    } : {}),
                                    // Presentation config travels with the handlers so
                                    // it applies on a history reload too, where the
                                    // message came from the DB and carries neither.
                                    toolActions: { ...tool_actions, ...(msg.toolActions ?? {}) },
                                    // Approval handling is built in, not opt-in: a
                                    // gated tool suspends the run, so a host app that
                                    // forgot to wire these would leave the user
                                    // watching a spinner until the Redis TTL expired.
                                    onConfirm: msg.onConfirm ?? confirmApproval,
                                    onReject: msg.onReject ?? rejectApproval,
                                }
                                : msg;
                            return (
                                <MessageBubble key={withTools.id} {...withTools} shouldAnimate={false} />
                            );
                        })}
                        {showThinking && (
                            <div style={{ paddingLeft: '16px' }}>
                                <ThinkingIndicator />
                            </div>
                        )}
                    </>
                )}
            </ChatContainer>
        </ChatbotProvider>
    );
};
