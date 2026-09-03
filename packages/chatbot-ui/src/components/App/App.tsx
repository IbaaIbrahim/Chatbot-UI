import * as React from 'react';
import { configureLocalNetworkAccess, warnIfLocalNetworkUrl } from '../../common/localNetwork';
import { ChatContainer, ChatMode, ChatTheme } from '../ChatContainer/ChatContainer';
import { MessageBubble } from '../MessageBubble/MessageBubble';
import { Composer, ComposerHandle } from '../Composer/Composer';
import { WelcomeScreen } from '../WelcomeScreen/WelcomeScreen';
import { ThinkingIndicator } from '../ThinkingIndicator/ThinkingIndicator';
import { AgentSidebar, AgentSidebarItem } from '../AgentSidebar/AgentSidebar';
import { AgentSwitcher } from '../AgentSwitcher/AgentSwitcher';
import { ChatbotProvider } from '../../context/ChatbotContext';
import { QuestionnaireForm, QuestionSpec } from '../Questionnaire/QuestionnaireForm';
import { StreamClient, StreamChatClient } from '../../api/StreamClient';
import { GatewayStreamClient, EnablableTool } from '../../api/GatewayStreamClient';
import { useStreamChat, UseStreamChatOptions } from '../../hooks/useStreamChat';
import {
    collectPendingApprovals,
    findPendingClientToolCalls,
    useConversations,
} from '../../hooks/useConversations';
import { ConversationDrawer } from '../ConversationDrawer/ConversationDrawer';
import { isClientTool } from '../../common/toolConfig';
import type { ToolConfig } from '../../common/toolConfig';
import { AttachedFile, ConversationDetail } from '../../api/types';

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
     * Opt in to reaching a loopback or private-network address (``localhost``,
     * ``10.*``, ``192.168.*``, ``*.local``) with ``streamUrl`` /
     * ``storageApiUrl`` / the client's gateway URL.
     *
     * Chromium 142+ calls that Local Network Access and gates it behind a user
     * permission — on Android, *"Access other apps and services on this
     * device"*. Setting this annotates those requests with
     * ``targetAddressSpace`` so an ``https:`` page can reach the prompt instead
     * of being stopped earlier by the mixed-content check.
     *
     * It does not grant the permission. When this UI runs in an iframe, every
     * parent frame must also delegate it:
     * ``allow="local-network-access; loopback-network; local-network"``.
     * Prefer public, same-scheme URLs and leave this off.
     */
    allowLocalNetworkAccess?: boolean;
    /**
     * Agent list to show in the sidebar. When provided the drawer shows an
     * agent-switcher section above the conversation history. Each item's
     * ``onClick`` is responsible for switching the active agent on the client.
     */
    agents?: AgentSidebarItem[];
    /**
     * Everything this application contributes to a tool, keyed by tool slug:
     * its handler, its schema if it has no backend row, and how its completed
     * step presents an action.
     *
     * One entry per tool, and the handler field says which end of the call the
     * entry takes — because a host application can only sit on one of them:
     *
     * - **`run`** — a **client-side** tool (`quota.tools.dispatch_mode =
     *   'client'`, or defined inline here via `definition`). The agent's call
     *   suspends the job; `run` receives the agent's `tool_input` and whatever
     *   it returns resumes the job as the tool result.
     * - **`preview`** — a **server-side** (`kafka`/`inline`) tool. It runs in a
     *   worker, so its result arrives on `tool_result` and `preview` receives
     *   the parsed output. Its return value is ignored, because no job is
     *   suspended waiting on it.
     *
     * Getting that pair the wrong way round used to compile and then fail
     * silently — a `kafka` tool emits no `client_tool_call`, so its handler
     * simply never fired. An entry now carries one or the other, never both, so
     * the mistake is a type error.
     *
     * Presentation lives in the same entry (`show`, `label`, `render`,
     * `placement`), and `autoRun: false` on a `preview` entry keeps it from
     * opening itself the moment the result lands.
     *
     * ```tsx
     * tools={{
     *   read_page_context: {
     *     run: ({ scope }) => collectContext(scope),
     *     show: false,                  // nothing here a user would re-open
     *   },
     *   generate_checklist: {
     *     preview: (checklist) => openChecklist(checklist),
     *     autoRun: false,
     *     placement: 'turn-end',
     *     label: 'View checklist',
     *     render: ({ onAction, payload }) => (
     *       <MyButton onClick={onAction}>{payload.title}</MyButton>
     *     ),
     *   },
     * }}
     * ```
     */
    tools?: Record<string, ToolConfig>;
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
     * True while the host application is still resolving which agent to bind.
     *
     * Pass it whenever `agents` are fetched asynchronously. A message sent
     * before that fetch resolves goes out with no `agent_id` at all, and the
     * failure is silent and total: the job runs with **no system prompt**, so
     * the model does not know to delegate or to ask the user anything, and with
     * none of the agent's tool restrictions, so a tool the agent forbids becomes
     * callable. Nothing in the response says any of this happened — the answer
     * just comes back generic.
     *
     * Omit it for a deliberately agentless integration; the composer then stays
     * enabled, which is correct because no binding is coming.
     */
    agentsLoading?: boolean;
    /**
     * Which palette to use: `'light'`, `'dark'`, or `'system'` (the default,
     * which follows the viewer's OS setting).
     */
    theme?: ChatTheme;
    /**
     * Offer the tools menu from the composer's toolbar. Default `true`.
     *
     * Turn it off to render your own switches; call
     * `client.setEnabledToolIds(...)` yourself if you do, or the tools stay off.
     */
    show_tool_toggles?: boolean;
    /**
     * Controls rendered in the header's action row, immediately before the
     * close button.
     *
     * The header is the only chrome a host application shares with the widget,
     * and where the chat sits on the page is the host's decision, not the
     * widget's — a dock/float/expand control belongs to whoever owns the layout.
     * Passing the nodes in, rather than adding a `presentation` prop here, keeps
     * that ownership where it already is: this component is told a `mode`, it
     * does not choose one.
     *
     * ```tsx
     * headerActions={<MyModeSwitcher value={mode} onChange={setMode} />}
     * ```
     */
    headerActions?: React.ReactNode;
    /**
     * Replaces the header's brand area — the "AI Assistant" label, or the agent
     * switcher when `agents` is set.
     *
     * Left undefined the default stands, so a host that wants only
     * {@link AppProps.headerActions} does not have to reproduce the switcher to
     * get it.
     */
    brand?: React.ReactNode;
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
    allowLocalNetworkAccess = false,
    agents,
    tools,
    agentId,
    agentsLoading = false,
    theme = 'system',
    show_tool_toggles = true,
    headerActions,
    brand,
}) => {
    // Before any client is constructed: the flag has to be in place by the time
    // the first request goes out, and `netFetch` reads it at call time.
    configureLocalNetworkAccess({ enabled: allowLocalNetworkAccess });
    warnIfLocalNetworkUrl('App streamUrl', streamUrl);
    warnIfLocalNetworkUrl('App storageApiUrl', storageApiUrl);

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

    // The built-in questionnaire handler alongside any app-provided tools (the
    // app may override it by passing its own entry). Everything downstream —
    // the client, the hook, the message tree — derives from this one map, which
    // is what keeps them from disagreeing about a slug.
    //
    // ``show: false`` is load-bearing, not cosmetic. This map is also what
    // decides which completed steps offer an action control, and a button on a
    // finished ``ask_user_questions`` step would re-open a historical form,
    // disable the composer, and resolve a promise nothing is awaiting.
    const registeredTools = React.useMemo<Record<string, ToolConfig>>(() => ({
        ask_user_questions: { run: handleAskUserQuestions, show: false },
        ...tools,
    }), [tools, handleAskUserQuestions]);

    React.useEffect(() => {
        if (activeClient && 'setTools' in activeClient) {
            (activeClient as GatewayStreamClient).setTools(registeredTools);
        }
    }, [activeClient, registeredTools]);

    // --- User-enabled tools -------------------------------------------------
    // A `user_enabled_*` tool is left out of a job's tool snapshot entirely
    // unless its UUID is named on job creation, so the model is never shown one
    // the user has not switched on. These two pieces of state are what makes
    // that switch reachable.
    const [enablableTools, setEnablableTools] = React.useState<EnablableTool[]>([]);
    const [enabledToolIds, setEnabledToolIds] = React.useState<string[]>([]);

    // Slugs the host app can actually execute. A `client`-dispatch tool with no
    // handler must not be offered — see ToolToggles.
    // Only ``run`` entries count. A ``preview`` entry for a slug the backend
    // classifies ``client`` cannot execute the call, so offering that tool in
    // the menu would get it dispatched to a browser with no handler and acked
    // with a placeholder — the agent gets nothing back and nothing says so.
    const handledSlugs = React.useMemo(
        () => Object.entries(registeredTools)
            .filter(([, config]) => isClientTool(config))
            .map(([slug]) => slug),
        [registeredTools]
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

    const {
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
    } = useStreamChat({
        client: activeClient,
        onEvent,
        storageApiUrl,
        tools: registeredTools,
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
    const composerRef = React.useRef<ComposerHandle>(null);

    /**
     * Put the cursor back in the composer.
     *
     * Called at the two moments the user is about to type and should not have to
     * click first: starting a new chat, and the assistant finishing its answer.
     *
     * Deliberately reads **no React state**. The obvious guard —
     * `isThinking || isResuming || pendingQuestionnaire` — is wrong here, and
     * subtly: `handleNewChat` clears the questionnaire and then asks for focus in
     * the same handler, so a state-based guard tests the value from *before* the
     * click and refuses to focus a composer that is in the act of becoming
     * usable. Asking the DOM on the next frame asks the only question that
     * matters — is this field focusable now — and cannot go stale.
     */
    const focusComposer = React.useCallback(() => {
        // A timer, not requestAnimationFrame. rAF does not fire while the page is
        // hidden, and a backgrounded tab is exactly when a stream finishes and
        // the caret should be waiting — so the frame-based version worked only
        // when the user was already looking. A zero timer still runs there, and
        // is late enough for React to have committed the render that re-enables
        // the field.
        window.setTimeout(() => {
            const field = document.activeElement;
            // Never steal focus from something the user is already typing in.
            if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
                return;
            }
            composerRef.current?.focus();
        }, 0);
    }, []);

    // Streaming just ended. `isThinking` going true → false is the signal; a
    // ref is what makes "it *changed*" distinguishable from "it is false",
    // which is true for most of the session and would refocus constantly.
    const wasBusyRef = React.useRef(false);
    React.useEffect(() => {
        const busy = isThinking || isResuming;
        if (wasBusyRef.current && !busy) focusComposer();
        wasBusyRef.current = busy;
    }, [isThinking, isResuming, focusComposer]);

    /**
     * Set when a thread holds a client tool call this page can no longer answer.
     *
     * The agent dispatched a call to a browser and is still waiting on it, but
     * the credential needed to re-open that turn's stream has expired, so the
     * call cannot be re-delivered. Saying so is the point: without it the thread
     * looks finished while the run sits suspended.
     */
    const [staleClientCall, setStaleClientCall] = React.useState(false);

    const handleSend = React.useCallback(async (text: string, attachedFiles?: AttachedFile[]) => {
        await sendMessage(text, attachedFiles);
        fetchConversations();
    }, [sendMessage, fetchConversations]);

    /**
     * Re-ask a question the agent is still waiting on, and deliver the answer.
     *
     * The handler is the same one a live `client_tool_call` would reach — for
     * `ask_user_questions` that is the built-in questionnaire — so the user sees
     * the identical form whether the call arrived over a stream or was recovered
     * from the transcript. Only the delivery differs.
     */
    const answerPendingCall = React.useCallback(async (call: {
        jobUuid: string;
        stepUuid: string;
        toolSlug: string;
        toolInput: any;
    }) => {
        const gateway = activeClient as GatewayStreamClient | null;
        // The `run` handler specifically, not whichever handler the entry
        // happens to carry. A pending call is always a `client` step, so a
        // `preview` registered for that slug is the wrong end of it: handed the
        // arguments the model invented, it would return nothing, and the
        // placeholder below would be POSTed as the answer to a suspended run.
        const config = registeredTools[call.toolSlug];
        const run = config && isClientTool(config) ? config.run : null;
        if (!gateway?.submitClientToolResult || !run) {
            // Nothing here can execute it, so say so rather than leaving the
            // user looking at a finished-looking thread.
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
                answer ?? { status: 'previewed' },
            );
        } catch (error) {
            const status = (error as { status?: number })?.status;
            // 409 is the expected refusal: answered elsewhere, or the run
            // expired. Either way this page cannot deliver it, which is exactly
            // what the notice says.
            if (status === 409) setStaleClientCall(true);
            else console.error('[ChatApp] answering the pending call failed', error);
        }
    }, [activeClient, registeredTools]);

    /**
     * Decide what a freshly loaded thread should do about a turn in flight.
     *
     * Resumability is read from the client's own session record, not from any
     * job status in the response. That is deliberate: nothing on the server fails
     * a stuck run, so an abandoned job keeps a non-terminal row indefinitely and
     * trusting it would raise a spinner that never clears. A usable stream token,
     * by contrast, is something only this client can know it holds — and if it
     * holds one, the turn is genuinely watchable.
     */
    const applyLoadedConversation = React.useCallback(async (
        id: string,
        detail: ConversationDetail,
    ) => {
        const gateway = activeClient as GatewayStreamClient | null;
        if (gateway?.hasLiveTurn?.(id)) {
            const jobId = gateway.getLiveJobId?.(id);
            if (jobId) {
                // The bubble jobsToMessageProps gave this turn.
                void resumeTurn(id, `${jobId}-assistant`);
                return;
            }
        }
        // No live stream to reattach to, but the transcript may still hold a
        // call the agent is waiting on — and everything needed to answer it is
        // in there. This is what lets a questionnaire be finished from a
        // different browser than the one that started the run.
        const pending = findPendingClientToolCalls(detail.jobs);
        if (pending.length === 0) return;
        await answerPendingCall(pending[0]);
    }, [activeClient, resumeTurn, answerPendingCall]);

    const handleSelectConversation = React.useCallback(async (id: string): Promise<boolean> => {
        const gateway = activeClient as GatewayStreamClient | null;
        // The thread being left, read from the client rather than from
        // `activeConversationId`: that state is only ever set by a drawer
        // selection, so a conversation the user *started* in this tab — whose id
        // the client minted on the first send — is not recorded there and its
        // reader would never be parked.
        const departing = gateway?.getConversationId?.() ?? null;

        // Load first, mutate second. Everything below is destructive to the
        // conversation currently on screen, and a failed load leaves the user
        // looking at it — so doing any of it before the response lands means a
        // failed drawer click silently parks a running stream and throws away an
        // open questionnaire for a switch that never happened.
        const loaded = await selectConversation(id);
        if (!loaded) return false; // Leave the drawer open: nothing changed.

        if (departing && departing !== id) {
            // Parked, not abandoned: its transcript writes are already no-ops
            // once the messages array is replaced, but its client-tool callbacks
            // are not — a questionnaire belonging to the thread the user just
            // left would open over the one they are now reading.
            gateway?.parkStream?.(departing);
        }
        // Nothing used to clear this, so conversation A's form stayed on screen
        // above conversation B's composer — disabling it — and submitting it
        // answered A's suspended job.
        setPendingQuestionnaire(null);
        setStaleClientCall(false);

        // The routing for any gate this thread is still holding, alongside the
        // cards that render it: both come from the same response, and a card
        // without its job posts a verdict the orchestrator drops.
        loadConversation(loaded.messages, collectPendingApprovals(loaded.detail.jobs));
        setIsDrawerOpen(false);
        await applyLoadedConversation(id, loaded.detail);
        return true;
    }, [activeClient, selectConversation, loadConversation, applyLoadedConversation]);

    const handleNewChat = React.useCallback(() => {
        newChat();
        reset();
        setPendingQuestionnaire(null);
        setStaleClientCall(false);
        // The drawer's job is done the moment a new chat starts, and the next
        // thing the user wants is to type — so get out of the way and give them
        // the caret rather than making them close the panel and click the field.
        setIsDrawerOpen(false);
        focusComposer();
    }, [newChat, reset, focusComposer]);

    /**
     * Put the user back in the thread this tab was already in.
     *
     * The client restores its conversation binding from per-tab storage when it
     * is constructed, but nothing ever asked for that thread's history — so a
     * reload showed the welcome screen while the next message silently appended
     * to a conversation the user could not see. This is also what makes a live
     * turn visible at all: the history read returns it now, and this is the call
     * that fetches it.
     *
     * Once per mount. The ref guard is for StrictMode's double-invocation, and
     * agent selection is deliberately untouched here.
     */
    const didRestoreRef = React.useRef(false);
    React.useEffect(() => {
        if (didRestoreRef.current || activeConversationId) return;
        const restored = (activeClient as GatewayStreamClient | null)
            ?.getConversationId?.();
        if (!restored) return;
        // Set before the call so a re-render mid-load cannot start a second one,
        // and released again if the load failed — a transient network error on
        // the first paint should not leave the tab permanently showing the
        // welcome screen while the client is still bound to a thread.
        didRestoreRef.current = true;
        void handleSelectConversation(restored).then(ok => {
            if (!ok) didRestoreRef.current = false;
        });
    }, [activeClient, activeConversationId, handleSelectConversation]);

    // Only while a binding is genuinely still coming. Once the fetch has
    // resolved, an absent agentId is a real answer — an agentless job — and
    // blocking on it would disable the composer for good.
    const awaitingAgentBinding = agentsLoading && !agentId;

    const showThinking = (isThinking || isResuming) && (
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
                theme={theme}
                isOpen={isOpen}
                onClose={onClose}
                onOpen={onOpen}
                embedded={embedded}
                isDrawerOpen={isDrawerOpen}
                onDrawerOpenChange={setIsDrawerOpen}
                drawerContent={drawerContent}
                headerActions={headerActions}
                brand={brand ?? (hasAgents ? <AgentSwitcher agents={agents!} /> : undefined)}
                footer={
                    <>
                        {staleClientCall && !pendingQuestionnaire && (
                            <div
                                role="status"
                                style={{
                                    padding: '8px 16px', fontSize: 13, opacity: 0.75,
                                }}
                            >
                                This turn is waiting on a response from this page
                                that can no longer be delivered.
                            </div>
                        )}
                        {pendingQuestionnaire && (
                            <QuestionnaireForm
                                questions={pendingQuestionnaire.questions}
                                onSubmit={handleQuestionnaireSubmit}
                            />
                        )}
                        <Composer
                            ref={composerRef}
                            onSend={handleSend}
                            // A resume counts as a turn in progress. Sending
                            // into a conversation that already has one running
                            // would put two turns on one stream, where either
                            // one's terminal frame closes the other's reader and
                            // their tokens land in the same bubble. Bounded: the
                            // resume ends with the turn, on a dead token, or on
                            // the first-frame deadline — and "New chat" clears it
                            // outright.
                            disabled={
                                isThinking
                                || isResuming
                                || !!pendingQuestionnaire
                                || awaitingAgentBinding
                            }
                            placeholder={
                                pendingQuestionnaire
                                    ? 'Answer the questions above…'
                                    : awaitingAgentBinding
                                        ? 'Connecting…'
                                        : 'Type a message…'
                            }
                            storageApiUrl={storageApiUrl}
                            accessToken={accessToken}
                            tools={show_tool_toggles ? enablableTools : []}
                            enabledToolIds={enabledToolIds}
                            onToolsChange={show_tool_toggles ? handleToolSelectionChange : undefined}
                            handledToolSlugs={handledSlugs}
                            // Offered only while a turn is actually running, and
                            // only by a client that can stop one server-side.
                            onStop={
                                'cancelTurn' in (activeClient ?? {})
                                    ? () => { void stopTurn(); }
                                    : undefined
                            }
                            isRunning={isThinking || isResuming}
                            isStopping={isStopping}
                        />
                    </>
                }
            >
                {messages.length === 0 ? (
                    <WelcomeScreen userName={userName} actions={[]} />
                ) : (
                    <>
                        {messages.map((msg, index) => {
                            // Only the trailing assistant message can be in
                            // flight, and only while the run is. Everything
                            // above it is finished, and so is every message once
                            // the run ends — which is what releases a tool action
                            // placed at `'turn-end'`.
                            const isLiveTurn = index === messages.length - 1
                                && msg.role === 'assistant'
                                && (isThinking || isResuming);
                            // Attach both handler maps to every assistant
                            // message at render time. This covers BOTH paths
                            // that produce a tool-call step — live streaming
                            // (client_tool_call / tool_result events) and
                            // historical reload (jobsToMessageProps from the
                            // DB) — so a completed client tool (e.g.
                            // ``preview_property_agent_result``) and a
                            // previewed server tool (e.g.
                            // ``generate_checklist``) both keep their button.
                            const withTools = msg.role === 'assistant'
                                ? {
                                    ...msg,
                                    // Attached here rather than only at message
                                    // creation so it applies on a history reload
                                    // too, where the message came from the DB and
                                    // carries nothing. Per-key: a per-message entry
                                    // replaces the app-level one for that slug,
                                    // handler and presentation together, because
                                    // half an entry is not a valid entry.
                                    tools: { ...registeredTools, ...(msg.tools ?? {}) },
                                    // Approval handling is built in, not opt-in: a
                                    // gated tool suspends the run, so a host app that
                                    // forgot to wire these would leave the user
                                    // watching a spinner until the Redis TTL expired.
                                    onConfirm: msg.onConfirm ?? confirmApproval,
                                    onReject: msg.onReject ?? rejectApproval,
                                    isTurnComplete: !isLiveTurn,
                                    // Recovery is built in rather than opt-in,
                                    // for the same reason approvals are: a host
                                    // app that forgot to wire these would leave
                                    // a failed turn with a button that does
                                    // nothing.
                                    onRetry: () => { void retryTurn(); },
                                    onContinue: () => { void continueTurn(); },
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
