import { StreamChatClient, StreamEvent, StreamOutcome } from './StreamClient';
import { ConversationClient } from './ConversationClient';
import { ConversationDetail, ConversationListFilters, ConversationListResponse, ConversationSummary, UserCredits } from './types';
import { parseToolOutput } from './toolOutput';
import { createUuid } from '../common/uuid';
import { netFetch } from '../common/localNetwork';
import { isClientTool, isServerTool } from '../common/toolConfig';
import type { ClientSkillDefinition, ClientToolConfig, ToolConfig } from '../common/toolConfig';
import { answerHostRequest, isHostRequestSlug } from '../common/hostCatalogue';
import type { HostRequestAnswer } from '../common/hostCatalogue';
import { blockLanguagesOf } from '../common/markdownBlocks';

// The tool contract moved to ../common/toolConfig so that one module owns it
// end to end; these two are re-exported here because they were part of this
// module's public surface and nothing else about their meaning changed.
export type { ClientToolDefinition, ResultPreviewContext } from '../common/toolConfig';

export interface GatewayStreamClientConfig {
    gatewayUrl: string;
    token?: string | null;
    modelId?: string;
    conversationId?: string | null;
    /**
     * A fixed agent for this client's jobs, for a screen that must always talk
     * to one specialist (a "create a template with AI" page, say). Sent as
     * ``agent_id``, with every client tool's definition as ``client_tools``;
     * without one the platform runs its central mode, which loads whatever
     * tools and skills the turn needs — the application's included, read from
     * this browser on demand (see {@link GatewayStreamClient.setSkills}). Not
     * persisted — see {@link GatewayStreamClient.setAgentId}.
     */
    agentId?: string | null;
    /**
     * Facts about the user and their screen to send with every job — see
     * {@link HostContext} and {@link GatewayStreamClient.setHostContext}.
     */
    hostContext?: HostContext | HostContextProvider | null;
    /**
     * The fence languages this page draws as rich blocks, sent as
     * `block_languages` with every job — see
     * {@link GatewayStreamClient.setBlockLanguages}. The provider sets it from
     * `config.markdown.blockRenderers`; a host rarely needs this.
     */
    blockLanguages?: readonly string[] | null;
}

/** One fact's value. A list is joined with ", "; `null` leaves the fact out. */
export type HostContextValue = string | number | boolean | null | undefined
    | Array<string | number | boolean>;

/**
 * What the host application tells the agent about its user and screen, per
 * message: `{ label: value }`, e.g.
 * `{ 'Can manage checklist templates': false, 'Current page': 'Templates' }`.
 *
 * The platform renders it at the end of the system prompt as a
 * `<host_context>` block, framed as information rather than instructions, for
 * that turn only (platform ADR-019). It never grants anything: the user's
 * browser sends it, so the user could change it, and nothing the platform
 * enforces reads it. Use it for what the agent should *know* — the user's
 * permissions in your app, the interface language, the page and the record
 * open on it — so it does not offer what the user cannot do.
 *
 * Bounded by the gateway: 30 facts, labels of 64 characters, values of 300,
 * 4 KB in all; larger is a 422. Keep it to a few lines — every turn pays for
 * it — and leave heavy page content to an on-demand tool.
 */
export type HostContext = Record<string, HostContextValue>;

/** Computes the {@link HostContext} when a message is sent, so it is current. */
export type HostContextProvider = () => HostContext | null | undefined;

/**
 * A chat agent this caller may bind a job to.
 *
 * Returned by ``GET /v1/user/agents``. Binding one is not cosmetic: the job
 * takes that agent's system prompt and its tool restrictions for the whole
 * run. A job sent with no ``agent_id`` runs the platform's **central mode**
 * instead — the application's central agent (or none) with only the four
 * meta-tools, loading the tools and skills the turn needs as it goes. Since
 * 4.0 the library offers no picker; this stays as plain client API for a host
 * that wants to show or choose agents itself. See
 * {@link GatewayStreamClient.setAgentId}.
 */
export interface ChatAgent {
    uuid: string;
    name: string;
    description?: string | null;
}

/**
 * A tool the caller may switch on for a job.
 *
 * Returned by ``GET /v1/user/tools/enablable`` — only the ``user_enabled_*``
 * types, because those are the ones absent from a job's tool snapshot unless
 * their UUID is named in ``enabled_tool_ids``. Always-on tools are not listed:
 * they are in every snapshot regardless, so a switch for one would do nothing.
 */
export interface EnablableTool {
    /** The value to pass to {@link GatewayStreamClient.setEnabledToolIds}. */
    uuid: string;
    slug: string;
    name: string;
    description: string | null;
    /** ``user_enabled_backend_side`` | ``user_enabled_client_side``. */
    type: string;
    /**
     * ``kafka`` | ``inline`` | ``client``. Decides who must be ready for the
     * call: a ``client`` tool executes in the host application, so switching one
     * on without a registered handler suspends the run until its TTL expires.
     */
    dispatch_mode: string;
}

/**
 * Where the active conversation is parked so it outlives the client object.
 *
 * It used to live only as an instance field. Any replacement of the instance —
 * an HMR update, a StrictMode double-mount, an error boundary remounting the
 * host app — silently dropped it, and because `sendMessage` minted a fresh
 * uuid whenever `conversationId` was null, the very next message opened a *new*
 * conversation mid-thread.
 *
 * sessionStorage, not localStorage: "the conversation I am currently in" is
 * per-tab, and a second tab should get its own thread rather than joining this
 * one.
 *
 * The agent is **not** parked here (until 4.0 it was). The key is per tab, not
 * per screen, so every client in the tab shares it — Flowdit's root chat and
 * its template-create-ai screen both do. A restored agent then outlived the
 * screen that chose it: the next client built without one picked it back up
 * and sent it as ``agent_id``, silently bypassing the platform's central mode.
 * A screen that needs an agent passes it every time (``config.agentId`` or
 * {@link GatewayStreamClient.setAgentId}); a thread that already has one keeps
 * it on the server (``conversations.agent_id``), so nothing needs restoring.
 */
const SESSION_KEY = 'chatbot-ui.active-session';

/**
 * How long a stream URL stays usable.
 *
 * The URL carries a Fernet token whose TTL Stream Edge enforces on every
 * request (``stream_token_ttl_seconds``, 1800). Past it each reconnect is
 * refused, and there is no way to mint a replacement: the gateway signs a stream
 * token in exactly one place, inside job creation, so asking for another one
 * means starting another job. That makes this constant the honest bound on how
 * long a turn can be resumed — not the 24 hours the Redis streams are retained
 * for.
 */
const STREAM_TOKEN_TTL_MS = 1800 * 1000;

/**
 * How long a resumed reader waits for its first frame before giving up.
 *
 * Set above Stream Edge's own idle rhythm (a 5s XREAD window inside a 15s
 * keepalive) because Stream Edge never closes a connection itself — an expired
 * or never-created stream key reads as empty forever and the connection just
 * keeps pinging. Without a deadline a resume against a dead stream blocks in
 * ``reader.read()`` indefinitely and the caller's spinner never clears.
 *
 * Generous by design: a turn that really is resumable replays its history
 * immediately, so silence this long means the stream is empty, not slow.
 */
const RESUME_FIRST_FRAME_TIMEOUT_MS = 20000;

/**
 * How long the replay must be quiet before its held client tool calls are fired.
 *
 * A replay arrives as a continuous burst — Redis hands over everything it has as
 * fast as it can be read — and then the connection goes quiet at the live tail.
 * That gap is the only "you are caught up" signal available: SSE has no marker
 * for it, and Stream Edge is a stateless merger that could not add one without
 * learning what a turn is.
 *
 * A second is far longer than the gap between frames of a burst and far shorter
 * than a user notices, so the held call is fired promptly and only after
 * everything that might have answered it has been seen.
 */
const REPLAY_SETTLE_MS = 1000;

/**
 * How many parked conversations keep a reader open for their host requests
 * (see {@link GatewayStreamClient.parkStream}).
 *
 * Each one is another long-lived connection to Stream Edge, and a browser
 * speaking HTTP/1.1 opens at most six to one host — the reader of the
 * conversation on screen and its reconnects included. Three leaves room for
 * those, and a user seldom leaves more than one turn running behind them.
 * Past the cap the longest-parked reader is stopped: the turn the user left
 * most recently is the likeliest to still be finding and loading its tools.
 */
const MAX_PARKED_READERS = 3;

/**
 * The largest host answer this client posts as it is.
 *
 * The Gateway caps a tool-result body at 2 000 000 bytes
 * (``PROVIDER_RESULT_MAX_BYTES``), and it refuses a declared ``Content-Length``
 * over that *without reading the body*. Closing a connection that still has
 * unread upload data in it commonly resets it, so the browser may see a
 * network error with no status rather than the 413. The answer would then be
 * lost, and the run would wait out its whole host-request timeout. Measuring
 * first avoids the round trip. The headroom keeps a modest cut of the
 * platform's cap from reopening that gap before this constant follows it.
 */
const HOST_ANSWER_MAX_BYTES = 2_000_000 - 64 * 1024;

/** What a host answer too large to send is replaced with. */
const HOST_ANSWER_TOO_LARGE = 'The application\'s answer was too large to send.';

/**
 * How much of a thrown error's message reaches the model. Enough to say what
 * went wrong; a handler that throws a page of HTML is not repeated to it.
 */
const RUN_ERROR_MAX_CHARS = 500;

/**
 * The answer to a client tool call whose ``run`` threw: an error the model can
 * report or work around, never the success placeholder.
 */
function describeRunFailure(slug: string, err: unknown): string {
    const message = (err instanceof Error ? err.message : String(err ?? '')).trim();
    if (!message) return `'${slug}' failed in this application.`;
    const bounded = message.length > RUN_ERROR_MAX_CHARS
        ? `${message.slice(0, RUN_ERROR_MAX_CHARS)}…`
        : message;
    return `'${slug}' failed in this application: ${bounded}`;
}

/** The size of ``text`` on the wire, which is what a byte cap counts. */
function utf8ByteLength(text: string): number {
    return new TextEncoder().encode(text).length;
}

/**
 * Seconds to wait from a `Retry-After` header.
 *
 * The gateway sends whole seconds. Anything unparseable falls back to a small
 * delay rather than zero: retrying immediately lands in the very window that
 * just refused the request.
 */
function parseRetryAfter(header: string | null): number {
    const seconds = Number.parseInt(header ?? '', 10);
    if (!Number.isFinite(seconds) || seconds <= 0) return 5;
    // Bounded so a hostile or misconfigured header cannot park the UI for
    // minutes; past this the user is better served by being told.
    return Math.min(seconds, 120);
}

/**
 * Turn a failed job submission into something worth reading.
 *
 * The gateway's error bodies carry a `message` written for a person — an
 * entitlement refusal names the model and the plans, a funding refusal says
 * which side is dry. Showing the raw status and JSON instead threw that away.
 */
function describeHttpFailure(status: number, body: string): string {
    try {
        const parsed = JSON.parse(body);
        const message = parsed?.message || parsed?.error?.message;
        if (typeof message === 'string' && message.trim()) return message;
    } catch {
        /* Not JSON — fall through to the status line. */
    }
    if (status === 429) return 'Too many requests just now. Please try again shortly.';
    if (status >= 500) return 'The service is unavailable right now.';
    return `The request was refused (${status}).`;
}

/**
 * One conversation's reader, and the credential that can re-open it.
 *
 * Keyed by conversation rather than by job because that is what the stream is
 * actually scoped to: every job in a thread — including a sub-agent's — writes
 * to the same three Redis streams, and the token authorises the thread. The job
 * id is carried here only because the tool-result and approval endpoints are
 * addressed by job.
 */
interface StreamSession {
    conversationId: string;
    /** The job that opened this turn; the fallback POST target. */
    jobId: string;
    /** Carries the Fernet token, whose boundary is this turn's start. */
    streamUrl: string;
    /** When the token was minted, for the TTL check. */
    openedAtMs: number;
    /** ``null`` when the reader is parked but the session is still resumable. */
    abort: AbortController | null;
    /** Bumped whenever this conversation's reader is replaced. */
    generation: number;
    /** This turn's job plus every sub-agent child it announced. */
    knownJobIds: Set<string>;
    /** In-memory only — a mid-connection reconnect cursor, never persisted. */
    lastEventId: string | null;
    /** Steps whose previewer has already fired, so a replay does not re-fire it. */
    previewedStepUuids: Set<string>;
    /**
     * Client tool calls this browser has already settled — dispatched, or seen
     * answered. A replay re-delivers the request frame whether or not the answer
     * came back, and re-running the handler would re-open a form the user has
     * already filled in.
     */
    settledStepUuids: Set<string>;
    /**
     * Client tool calls seen during a replay that may or may not be outstanding.
     *
     * Held rather than fired, because a replay delivers the request before the
     * result: at the moment the request frame arrives there is no way to know
     * whether its answer is two frames further on. Anything still here once the
     * replay has caught up is genuinely unanswered — which is the whole point of
     * replaying, since a suspended run has exactly one outstanding client call
     * per job.
     */
    deferredClientCalls: Map<string, { event: any; payload: any }>;
    /** Fires once the replay burst goes quiet. See {@link _armReplayFlush}. */
    replayFlushTimer: ReturnType<typeof setTimeout> | null;
    /**
     * Host requests seen on a read that may be replaying, each on its own
     * clock. See {@link GatewayStreamClient._holdHostRequest}.
     */
    heldHostRequests: Map<string, ReturnType<typeof setTimeout>>;
    /**
     * Whether this turn's job was sent with ``host_catalogue`` and so may ask
     * this browser about the application's tools. Only such a turn gets a
     * parked reader.
     */
    hostCatalogue: boolean;
    /**
     * The reader that keeps answering this turn's host requests while the
     * conversation is parked, or ``null``. Separate from ``abort``: parking
     * empties that slot, which is how {@link GatewayStreamClient.resumeStream}
     * knows no reader is showing the conversation.
     */
    parkedReader: AbortController | null;
    /** When the parked reader started, in start order; for the cap. */
    parkedOrder: number;
}

/** The part of a session that survives a page load. */
interface PersistedLiveTurn {
    jobId: string;
    streamUrl: string;
    openedAtMs: number;
    /**
     * See {@link StreamSession.hostCatalogue}. Absent from a turn stored by
     * 3.x, which never sent the flag, so absent reads as false.
     */
    hostCatalogue?: boolean;
}

interface PersistedSession {
    conversationId: string | null;
    /**
     * The re-openable turn per conversation.
     *
     * This stores a URL containing a stream token, which is a real trade and
     * worth naming: it is per-tab (the reason sessionStorage was chosen above),
     * same-origin, scoped to a single conversation the caller already owns, and
     * dead within 30 minutes — and the same token is already sitting in this
     * tab's memory for the life of the turn. What it buys is the only thing that
     * makes a reload recover an unanswered questionnaire: the credential to
     * replay the turn that asked the question.
     *
     * The reconnect cursor is deliberately **not** stored. A resume must replay
     * the turn from the token's own boundary, because the tokens of the step
     * that was in flight at reload time exist nowhere else — that step's
     * persisted payload is empty until it completes, so resuming from a saved
     * cursor would start the answer mid-sentence with no way back to its front.
     */
    liveTurns?: Record<string, PersistedLiveTurn>;
}

function readSession(): PersistedSession {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return { conversationId: null };
        const parsed = JSON.parse(raw) as Partial<PersistedSession>;
        // Picked field by field, so an ``agentId`` written before 4.0 is left
        // behind here rather than carried into memory — and, because the next
        // write rebuilds the value from these fields alone, scrubbed from
        // storage too. See SESSION_KEY for why the agent is not restored.
        return {
            conversationId: parsed.conversationId ?? null,
            // Absent in anything written before resume existed, and absent is
            // simply "no turn to re-open".
            liveTurns: parsed.liveTurns ?? {},
        };
    } catch {
        // Private-mode or disabled storage: fall back to in-memory only.
        return { conversationId: null };
    }
}

function writeSession(session: PersistedSession): void {
    try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
        /* Storage unavailable — the instance fields still work for this page. */
    }
}

export class GatewayStreamClient implements StreamChatClient {
    private gatewayUrl: string;
    private token: string | null;
    private modelId: string;
    private conversationId: string | null;
    private agentId: string | null;
    private hostContext: HostContext | HostContextProvider | null;
    /** Sent as `block_languages`; see {@link setBlockLanguages}. */
    private blockLanguages: string[] = [];
    private conversationClient: ConversationClient;

    /**
     * Per-tool handlers and presentation registered by the application, keyed
     * by tool slug. One map, because one tool has one entry: whether it carries
     * ``run`` or ``preview`` is what says which end of the call it handles.
     */
    private tools: Record<string, ToolConfig> = {};
    /**
     * The application's own skills ("client skills"), served to the platform
     * on request and never sent with a message. See {@link setSkills}.
     */
    private skills: ClientSkillDefinition[] = [];
    /** UUIDs of user-enabled tools switched on for this caller's jobs. */
    private enabledToolIds: string[] = [];

    /**
     * Cache of settled tool results keyed by step UUID.
     * Retains outputs from live stream events and fetched history so client-side
     * action tools (like show_step_output) can resolve artifacts without waiting
     * for Kafka archival.
     */
    private stepOutputs = new Map<string, any>();

    /**
     * One reader per conversation — the whole of change (b).
     *
     * This used to be a single ``AbortController`` slot and a single
     * ``currentJobId``, and both were wrong in the same way. Sending in one
     * conversation aborted whichever reader was open, while *switching*
     * conversations aborted nothing at all, so the thread the user left kept
     * reading and kept firing the host app's client-tool callbacks into a UI
     * showing something else. And one ambient job id meant every sub-agent's
     * tool result and approval was posted against the parent job, which the
     * orchestrator drops — after the gateway has already answered 202, so the
     * browser saw success while the child hung until its TTL.
     *
     * Keeping the invariant here rather than in the caller: every path that
     * opens a reader goes through {@link _openSession}, so "one conversation,
     * one reader, one credential" cannot be forgotten at a call site.
     */
    private sessions = new Map<string, StreamSession>();

    /** Numbers parked readers in start order; see {@link MAX_PARKED_READERS}. */
    private parkedReaderCount = 0;

    constructor(config: GatewayStreamClientConfig) {
        this.gatewayUrl = config.gatewayUrl.replace(/\/$/, '');
        this.token = config.token ?? null;
        this.modelId = config.modelId ?? 'claude-opus-5-5';
        // An explicit config value wins; otherwise resume whatever this tab was
        // already in, so a remount continues the thread instead of forking it.
        // The agent is the exception: only the config says it, never the tab's
        // storage (see SESSION_KEY).
        const restored = readSession();
        this.conversationId = config.conversationId ?? restored.conversationId;
        this.agentId = config.agentId ?? null;
        this.hostContext = config.hostContext ?? null;
        this.blockLanguages = blockLanguagesOf(config.blockLanguages);
        this.conversationClient = new ConversationClient(this.gatewayUrl, this.token);
        this._rehydrateSessions(restored.liveTurns ?? {});
    }

    /**
     * Turn each stored turn back into a session with no reader attached.
     *
     * A parked session and a restored one are the same thing — a credential
     * without a reader — so there is one representation for both and
     * ``abort === null`` is what distinguishes them from a live one. Expired
     * entries are dropped here rather than filtered at every read.
     */
    private _rehydrateSessions(stored: Record<string, PersistedLiveTurn>): void {
        for (const [conversationId, turn] of Object.entries(stored)) {
            if (!turn?.streamUrl || !turn?.jobId) continue;
            if (Date.now() - (turn.openedAtMs ?? 0) >= STREAM_TOKEN_TTL_MS) continue;
            this.sessions.set(conversationId, {
                conversationId,
                jobId: turn.jobId,
                streamUrl: turn.streamUrl,
                openedAtMs: turn.openedAtMs,
                abort: null,
                generation: 0,
                knownJobIds: new Set([turn.jobId]),
                lastEventId: null,
                previewedStepUuids: new Set(),
                settledStepUuids: new Set(),
                deferredClientCalls: new Map(),
                replayFlushTimer: null,
                heldHostRequests: new Map(),
                hostCatalogue: turn.hostCatalogue === true,
                parkedReader: null,
                parkedOrder: 0,
            });
        }
    }

    /** Mirror the identity fields into per-tab storage after every change. */
    private persistSession() {
        const liveTurns: Record<string, PersistedLiveTurn> = {};
        for (const [conversationId, session] of this.sessions) {
            liveTurns[conversationId] = {
                jobId: session.jobId,
                streamUrl: session.streamUrl,
                openedAtMs: session.openedAtMs,
                hostCatalogue: session.hostCatalogue,
            };
        }
        writeSession({
            conversationId: this.conversationId,
            liveTurns,
        });
    }

    /**
     * Bind this client's next jobs to one agent, or `null` for none.
     *
     * With an agent the job runs exactly that agent — its system prompt and
     * tool restrictions — which is what a screen built around one specialist
     * wants, and every client tool's definition rides on the job as
     * ``client_tools``. With none the platform runs central mode: the
     * application's central agent, starting with only the four meta-tools and
     * loading the tools and skills the turn calls for (shown as compact rows;
     * see `describeMetaTool`). The job then carries ``host_catalogue`` instead
     * of any definition, and this client answers the platform's host requests
     * (see {@link setSkills}). A thread already bound to an agent on the server
     * keeps it either way; its runs fetch the application's tools from this
     * browser once, at their start.
     *
     * Call it before the provider first sees the client, so the provider's
     * tools menu lists what this agent allows. Held in memory only: storing it
     * per tab let it leak into other screens' clients (see SESSION_KEY).
     */
    setAgentId(id: string | null) {
        this.agentId = id;
    }

    /** The agent this client's jobs are bound to, or `null` (central mode). */
    getAgentId(): string | null {
        return this.agentId;
    }

    /**
     * Facts about the user and their screen, sent as `host_context` with every
     * job from now on — an object, or a function the client calls at each send
     * so the facts are current (the page the user is on now, a permission
     * revoked a minute ago). `null` sends none. See {@link HostContext}.
     *
     * Never in the way of a message: a provider that throws, or returns
     * nothing, sends the job without the field.
     */
    setHostContext(context: HostContext | HostContextProvider | null) {
        this.hostContext = context;
    }

    /** The `host_context` the next job would carry, or `null` for none. */
    resolveHostContext(): Record<string, string | number | boolean | Array<string | number | boolean>> | null {
        let context: HostContext | null | undefined;
        try {
            context = typeof this.hostContext === 'function' ? this.hostContext() : this.hostContext;
        } catch (err) {
            console.error('[GatewayStreamClient] host context provider failed; sending without it', err);
            return null;
        }
        if (!context) return null;
        const facts: Record<string, string | number | boolean | Array<string | number | boolean>> = {};
        for (const [label, value] of Object.entries(context)) {
            if (value !== null && value !== undefined) facts[label] = value;
        }
        return Object.keys(facts).length > 0 ? facts : null;
    }

    /**
     * The fence languages this page draws as rich blocks — the keys of
     * `config.markdown.blockRenderers`, which the provider passes here
     * whenever they change. Sent with every job as `block_languages` (a JSON
     * array), so the platform indexes those blocks of the turn's answer when
     * it ends: a block the user did not save is listed as "Not saved" in the
     * conversation's files and under Artifacts, and its Save is matched to it.
     *
     * Kept as the platform takes them: lower-case `^[a-z][a-z0-9_-]{0,31}$`,
     * each once, sorted, at most 16 (`blockLanguagesOf`). With none the field
     * is left out. Every job the chat sends is an agent-mode job — the only
     * kind the platform takes it with.
     */
    setBlockLanguages(languages: readonly string[] | null | undefined) {
        this.blockLanguages = blockLanguagesOf(languages);
    }

    /** What the next job sends as `block_languages`; empty when it sends none. */
    getBlockLanguages(): string[] {
        return [...this.blockLanguages];
    }

    setToken(token: string | null) {
        this.token = token;
        this.conversationClient.setToken(token);
    }

    setConversationId(id: string | null) {
        this.conversationId = id;
        this.persistSession();
    }

    /**
     * List the agents this caller may bind a job to.
     *
     * Plain client API since 4.0: the library draws no agent picker, and a job
     * sent without an agent runs the platform's central mode. Kept for a host
     * that shows or chooses agents itself.
     *
     * Here rather than in the host application because the three things the
     * request needs — the gateway URL, the bearer token, and {@link netFetch}'s
     * local-network annotation — all already live on this client. A host that
     * rolls its own ``fetch`` for this gets the first two right and silently
     * loses the third, so the call is blocked on exactly the loopback gateways
     * that local development runs against.
     */
    async listAgents(): Promise<ChatAgent[]> {
        const response = await netFetch(
            `${this.gatewayUrl}/v1/user/agents`,
            { headers: { 'Authorization': `Bearer ${this.token ?? ''}` } }
        );
        if (!response.ok) {
            throw new Error(
                `[GatewayStreamClient] listing agents failed with ${response.status}`
            );
        }
        const payload = await response.json();
        return payload?.data?.agents ?? [];
    }

    /**
     * List the tools this caller may switch on, for the given agent.
     *
     * Pass the agent id to get only what that agent's policy allows; omit it for
     * a job sent without one (central mode), where any active user-enabled tool
     * may be requested.
     */
    async listEnablableTools(agentId?: string | null): Promise<EnablableTool[]> {
        const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : '';
        const response = await netFetch(
            `${this.gatewayUrl}/v1/user/tools/enablable${query}`,
            { headers: { 'Authorization': `Bearer ${this.token ?? ''}` } }
        );
        if (!response.ok) {
            throw new Error(
                `[GatewayStreamClient] listing enablable tools failed with ${response.status}`
            );
        }
        const payload = await response.json();
        return payload?.data?.tools ?? [];
    }

    /**
     * Choose which user-enabled tools this caller's jobs may use.
     *
     * These UUIDs ride on every subsequent job as ``enabled_tool_ids``. A
     * ``user_enabled_*`` tool the caller does not name is left out of the job's
     * tool snapshot entirely, so the model is never shown it — enabling is not a
     * UI preference, it is what makes the tool exist for the run.
     *
     * Set it to the full selection each time, not a delta: the list replaces the
     * previous one, which is what makes turning a switch *off* work.
     */
    setEnabledToolIds(toolIds: string[]) {
        this.enabledToolIds = [...toolIds];
    }

    getEnabledToolIds(): string[] {
        return [...this.enabledToolIds];
    }

    getConversationId(): string | null {
        return this.conversationId;
    }

    /**
     * Register the application's tool handlers, keyed by tool slug.
     *
     * An entry's handler field says which end of the call it takes, because a
     * host application can only sit on one of them:
     *
     *  - ``run`` — a ``client``-dispatched tool. The orchestrator emits a
     *    ``client_tool_call`` SSE event and suspends the job; this client fires
     *    ``run`` with the agent's ``tool_input`` and POSTs whatever it returns
     *    so the job resumes.
     *  - ``preview`` — a ``kafka``/``inline`` tool. It runs in a worker and
     *    never emits ``client_tool_call``, so its result arrives on
     *    ``tool_result`` and ``preview`` is fired with that output.
     *
     * Replaces the whole map rather than merging into it, so unregistering is
     * possible.
     *
     * Usage:
     * ```ts
     * client.setTools({
     *   preview_property_agent_result: { run: (input) => openPreview(input) },
     *   generate_checklist: { preview: (checklist) => openChecklist(checklist) },
     * });
     * ```
     */
    setTools(tools: Record<string, ToolConfig>) {
        this.tools = tools;
    }

    /**
     * Register the application's own skills — "client skills": instructions
     * the model loads with ``load_skill`` when a conversation needs them,
     * together with every client tool whose ``definition.skills`` names the
     * skill's slug. See {@link ClientSkillDefinition}.
     *
     * Nothing here is sent with a message. A central-mode job (no agent)
     * carries ``host_catalogue=true``, which tells the platform this browser
     * answers *host requests* on the conversation's stream: a
     * ``client_tool_call`` under the reserved slug ``__host_request`` asking
     * for the catalogue (names and descriptions, for a search), some tools'
     * definitions (for ``load_tool``), one skill (for ``load_skill``), or every
     * definition (for a run that offers its whole tool set). This client
     * answers each from the tools and skills registered *when the request
     * arrives*, so what it offers follows the page; it never runs a tool to do
     * so. See `common/hostCatalogue.ts`.
     *
     * Replaces the whole list, like {@link setTools}.
     */
    setSkills(skills: ClientSkillDefinition[]) {
        this.skills = Array.isArray(skills) ? [...skills] : [];
    }

    /** The client skills a host request is answered from. */
    getSkills(): ClientSkillDefinition[] {
        return [...this.skills];
    }

    /** Retrieve the cached output of a completed step by its UUID. */
    getStepOutput(stepUuid: string): any | undefined {
        return this.stepOutputs.get(stepUuid);
    }

    /** Manually record or override a step output in cache. */
    setStepOutput(stepUuid: string, output: any): void {
        if (stepUuid && output !== undefined) {
            this.stepOutputs.set(stepUuid, output);
        }
    }

    reset() {
        // Every reader stops, but no credential is thrown away. "New chat" says
        // where the user is going, not that the thread they left should become
        // unwatchable — those turns keep running and billing, and parking is
        // what lets the user go back and see how they ended.
        for (const conversationId of [...this.sessions.keys()]) {
            this.parkStream(conversationId);
        }
        this.conversationId = null;
        // Deliberate: this is the explicit "new conversation" path, so the
        // stored id is cleared as well. Losing the instance is not this path.
        this.persistSession();
    }

    /**
     * Stop showing a conversation's stream but keep it re-openable.
     *
     * Called when the user switches away, and for every conversation on "New
     * chat". Discarding the session instead would be a false economy — the job
     * runs and bills on the server whether or not anyone is listening, so the
     * only thing dropping the credential achieves is making the output
     * unreachable when the user comes back.
     *
     * The reader showing the conversation stops: nothing more reaches the
     * caller's ``onEvent``, no preview opens and no client tool runs, so the
     * thread the user left cannot act on a screen that shows another. A turn
     * sent with ``host_catalogue`` gets a *parked reader* in its place (see
     * {@link _startParkedReader}). That reader answers the turn's host requests
     * and nothing else, because the run cannot find or load the application's
     * tools without those answers. A search the turn makes while the user is
     * elsewhere would otherwise go unanswered for the platform's whole
     * timeout, and the platform would then treat the app's catalogue as
     * unavailable for the rest of the job. Everything else waits for the
     * replay when the user comes back, as before.
     *
     * A conversation already parked, or one restored after a reload and never
     * opened, has no reader showing it and is left as it is.
     */
    parkStream(conversationId: string): void {
        const session = this.sessions.get(conversationId);
        if (!session || !session.abort) return;
        // Already aborted only when a resumed reader stalled: its stream had
        // nothing in it, so a parked reader would only wait on a dead stream.
        const wasReading = !session.abort.signal.aborted;
        session.abort.abort();
        session.abort = null;
        session.generation += 1;
        // Held host requests keep their own clocks: answering one is pure and
        // the run is waiting on it. Held client calls are dropped; the replay
        // asks them again when the user comes back.
        this._cancelReplayFlush(session);
        if (wasReading) this._startParkedReader(session);
        this.persistSession();
    }

    /**
     * Keep answering a parked turn's host requests (see {@link parkStream}).
     *
     * A second connection rather than the first one kept open: the caller of
     * the send or resume that opened the first is told ``'aborted'`` at once,
     * as before, and so stops acting on a conversation it no longer shows.
     *
     * It reads on from the cursor where the foreground reader stopped, so it
     * sees only frames nobody has handled yet. Without a cursor it reads the
     * turn from the token's boundary. It reads with replay semantics either
     * way, because a resumed foreground reader may have been parked mid-replay:
     * frames from another turn's jobs are dropped, and a host request is held
     * for up to a second in case its answer is already in the stream (see
     * {@link _holdHostRequest}). It forwards nothing to ``onEvent``, runs no
     * previews and no client tools. It stops at the turn's terminal frame,
     * when the token's lifetime is up, or when the conversation is opened
     * again. It never closes the session: coming back replays the turn from
     * the credential exactly as before, the ending included.
     */
    private _startParkedReader(session: StreamSession): void {
        if (!session.hostCatalogue || session.parkedReader || this._tokenExpired(session)) return;

        const parked = [...this.sessions.values()].filter(other => other !== session && other.parkedReader);
        if (parked.length >= MAX_PARKED_READERS) {
            const oldest = parked.reduce((a, b) => (a.parkedOrder <= b.parkedOrder ? a : b));
            this._stopParkedReader(oldest);
        }

        const controller = new AbortController();
        session.parkedReader = controller;
        this.parkedReaderCount += 1;
        session.parkedOrder = this.parkedReaderCount;
        const ignore = () => {};
        void this._runStream(session, ignore, ignore, { isResume: true, parked: true })
            .catch(err => console.error('[GatewayStreamClient] parked reader failed', err))
            .finally(() => {
                // Aborted however the reader ended, so a reader that stopped
                // on its own (the token's lifetime) does not leave its
                // connection open.
                controller.abort();
                if (session.parkedReader === controller) session.parkedReader = null;
            });
    }

    /** Stop a session's parked reader, if it has one. */
    private _stopParkedReader(session: StreamSession): void {
        session.parkedReader?.abort();
        session.parkedReader = null;
    }

    /** Whether the session's stream token has outlived its TTL. */
    private _tokenExpired(session: StreamSession): boolean {
        return Date.now() - session.openedAtMs >= STREAM_TOKEN_TTL_MS;
    }

    /** Stop the quiet-period clock, so a parked reader fires nothing later. */
    private _cancelReplayFlush(session: StreamSession): void {
        if (session.replayFlushTimer !== null) {
            clearTimeout(session.replayFlushTimer);
            session.replayFlushTimer = null;
        }
        session.deferredClientCalls.clear();
    }

    /**
     * Stop every held host request's clock. Only for a session that is ending
     * or being replaced: a replacement's own replay re-holds what is still
     * outstanding.
     */
    private _releaseHostRequests(session: StreamSession): void {
        for (const timer of session.heldHostRequests.values()) clearTimeout(timer);
        session.heldHostRequests.clear();
    }

    /** Everything that would act on a session that is ending or being replaced. */
    private _retireSession(session: StreamSession): void {
        this._stopParkedReader(session);
        this._cancelReplayFlush(session);
        this._releaseHostRequests(session);
    }

    /**
     * Whether this conversation's turn can still be re-opened.
     *
     * Deliberately a question about the credential rather than about the job.
     * A run the orchestrator abandoned keeps a non-terminal row indefinitely —
     * nothing fails a stuck job — so believing a status field would raise a
     * spinner that never resolves. A token, by contrast, either works or does
     * not, and this client is the only thing that knows whether it holds one.
     */
    hasLiveTurn(conversationId: string): boolean {
        const session = this.sessions.get(conversationId);
        if (!session) return false;
        if (!this._tokenExpired(session)) return true;
        // Pruned on the way past rather than left to accumulate: an expired
        // entry can never become usable again. The readers are aborted first —
        // dropping the map entry without it would leave a loop running that
        // nothing can find to stop, still firing client-tool callbacks, and
        // would let the next send open a second reader on the same conversation.
        session.abort?.abort();
        session.abort = null;
        this._retireSession(session);
        this.sessions.delete(conversationId);
        this.persistSession();
        return false;
    }

    /** The job whose turn is re-openable in this conversation, if any. */
    getLiveJobId(conversationId: string): string | null {
        return this.sessions.get(conversationId)?.jobId ?? null;
    }

    /**
     * Open a reader for one conversation, replacing whatever it had.
     *
     * Only that conversation's reader is touched. Bumping ``generation`` is what
     * retires the outgoing loop even after its controller has been dropped: the
     * loop re-checks its generation after every await and returns silently when
     * it no longer owns the conversation.
     */
    private _openSession(
        conversationId: string,
        jobId: string,
        streamUrl: string,
        hostCatalogue: boolean,
    ): StreamSession {
        const existing = this.sessions.get(conversationId);
        if (existing) {
            existing.abort?.abort();
            // Retire its clocks and its parked reader too, or a held client
            // tool call or host request from the session being replaced would
            // fire a second later against the old session's job — outside the
            // new session's bookkeeping. The settled set carries over below,
            // so the new reader re-decides the same call on its own replay.
            this._retireSession(existing);
        }

        const session: StreamSession = {
            conversationId,
            jobId,
            streamUrl,
            openedAtMs: Date.now(),
            abort: new AbortController(),
            generation: (existing?.generation ?? 0) + 1,
            knownJobIds: new Set([jobId]),
            lastEventId: null,
            // Carried over, not reset. Switching away from a conversation and
            // back re-opens its reader, which replays the turn — and without
            // this every preview panel the turn produced would open again, in
            // order. A reload legitimately starts a fresh set: the host app's
            // panels are gone too, so re-firing is the correct behaviour there.
            previewedStepUuids: existing?.previewedStepUuids ?? new Set(),
            // Carried for the same reason as the previews above: a park/resume
            // cycle replays the turn, and a client call this page already
            // answered must not be asked again.
            settledStepUuids: existing?.settledStepUuids ?? new Set(),
            deferredClientCalls: new Map(),
            replayFlushTimer: null,
            heldHostRequests: new Map(),
            hostCatalogue,
            parkedReader: null,
            parkedOrder: 0,
        };
        this.sessions.set(conversationId, session);
        this.persistSession();
        return session;
    }

    /**
     * Forget a conversation's turn because it has ended.
     *
     * Called on a frame that terminates the turn. Without it ``liveTurns`` would
     * grow for every thread the tab ever visited and ``hasLiveTurn`` would offer
     * to resume answers that are already complete.
     */
    private _closeSession(session: StreamSession): void {
        // Only if it is still the conversation's session. A reader that was
        // superseded can still reach a terminal frame, and closing by
        // conversation id would delete the *replacement* — taking a live turn's
        // credential with it.
        if (this.sessions.get(session.conversationId) !== session) return;
        session.abort = null;
        this._retireSession(session);
        this.sessions.delete(session.conversationId);
        this.persistSession();
    }

    /**
     * Re-open a conversation's stream and replay its turn.
     *
     * The replay is the whole mechanism: the token minted when the job was
     * created carries this turn's own starting cursor, so re-opening the URL
     * without a ``Last-Event-ID`` re-delivers every frame of the turn — tokens,
     * tool requests and results, and any ``client_tool_call`` or
     * ``approval_request`` still waiting on an answer — through the same
     * handlers that processed them the first time. Nothing has to be
     * reconstructed from the database, and the questionnaire the user was
     * looking at before the reload comes back by itself.
     */
    async resumeStream(
        conversationId: string,
        onEvent: (event: StreamEvent) => void,
        onError: (error: Error) => void,
    ): Promise<StreamOutcome> {
        if (!this.hasLiveTurn(conversationId)) return 'expired';
        const stored = this.sessions.get(conversationId);
        if (!stored) return 'expired';
        if (stored.abort) {
            // A reader already owns this turn and is delivering it. Re-opening
            // would abort a working connection only to replay what the caller
            // has already seen — and would saddle it with the resume path's
            // first-frame deadline. Nothing to do.
            return 'aborted';
        }

        // Through _openSession so a second resume for the same conversation
        // retires the first rather than running two readers over one turn —
        // the parked reader included: from here this reader answers the
        // turn's host requests, from its own replay.
        const session = this._openSession(
            conversationId, stored.jobId, stored.streamUrl, stored.hostCatalogue
        );
        // _openSession stamps a fresh mint time; the credential is the original
        // one, so its age must be preserved or the TTL check would never expire.
        session.openedAtMs = stored.openedAtMs;
        this.persistSession();

        return this._runStream(session, onEvent, onError, { isResume: true });
    }

    private _indexJobsSteps(jobs: any[]): void {
        for (const job of jobs) {
            if (Array.isArray(job.steps)) {
                for (const step of job.steps) {
                    if (step?.uuid && step?.tool_output !== undefined && step?.tool_output !== null) {
                        this.stepOutputs.set(String(step.uuid), parseToolOutput(step.tool_output));
                    }
                }
            }
            if (Array.isArray(job.sub_agent_jobs)) {
                this._indexJobsSteps(job.sub_agent_jobs);
            }
        }
    }

    async getConversations(
        offset?: number,
        limit?: number,
        filters?: ConversationListFilters
    ): Promise<ConversationListResponse> {
        return this.conversationClient.getConversations(limit, offset, filters);
    }

    /** Star or unstar a conversation; resolves to the updated summary. */
    async setConversationStarred(id: string, starred: boolean): Promise<ConversationSummary> {
        return this.conversationClient.setConversationStarred(id, starred);
    }

    /** Rename a conversation; resolves to the updated summary. */
    async renameConversation(id: string, title: string): Promise<ConversationSummary> {
        return this.conversationClient.renameConversation(id, title);
    }

    async getConversationDetail(id: string): Promise<ConversationDetail> {
        const detail = await this.conversationClient.getConversationDetail(id);
        if (detail?.jobs) {
            this._indexJobsSteps(detail.jobs);
        }
        return detail;
    }

    async deleteConversation(id: string): Promise<void> {
        return this.conversationClient.deleteConversation(id);
    }

    /** The signed-in user's own allowance — what the "Credit usage" view shows. */
    async getCredits(): Promise<UserCredits> {
        return this.conversationClient.getCredits();
    }

    async sendMessage(
        text: string,
        onEvent: (event: StreamEvent) => void,
        onComplete: () => void,
        onError: (error: Error) => void,
        fileIds?: string[]
    ): Promise<void> {
        // Read once, up front, and use this local everywhere below.
        //
        // ``this.conversationId`` is mutated synchronously by
        // ``setConversationId``, which the conversation-switch path calls. A
        // switch landing during the awaited job POST would otherwise file this
        // conversation's stream under the newly selected one's key — precisely
        // the cross-wiring per-conversation sessions exist to prevent, and it
        // would survive a reload because the session map is persisted.
        const conversationId = this._ensureConversationId();

        const body = new FormData();
        body.append('prompt', text);
        body.append('model_id', this.modelId);
        body.append('conversation_id', conversationId);
        if (this.agentId) {
            body.append('agent_id', this.agentId);
        }
        if (fileIds && fileIds.length > 0) {
            body.append('file_ids', fileIds.join(','));
        }

        // User-enabled tools the caller switched on. Repeated field, one append
        // per id — the gateway reads `enabled_tool_ids` as a list, so joining
        // them into one comma-separated value would arrive as a single
        // unparseable "uuid,uuid" string.
        for (const toolId of this.enabledToolIds) {
            body.append('enabled_tool_ids', toolId);
        }

        // The application's own tools reach the platform one of two ways, and
        // the agent binding decides which (platform ADR-018, "Host catalogue
        // and conversation-scoped loads"):
        //
        //  - Agent-bound: every registered tool that carries an inline
        //    ``definition`` rides on the job as ``client_tools`` (the slug is
        //    the tool name; a tool without a definition is backend-registered
        //    and needs nothing here). An agent's run offers its whole tool set
        //    and has no meta-tools to load anything with, so it needs them all
        //    up front.
        //  - Central mode: no definition is sent. ``host_catalogue`` says this
        //    browser answers host requests instead, so the meta-tools search
        //    and load the application's tools and skills on demand — a turn
        //    pays only for what it loads, and what it loads stays loaded for
        //    the conversation. A thread an agent already owns on the server
        //    runs non-centrally even without ``agent_id``; the platform covers
        //    that by fetching every definition from this browser once, at the
        //    run's start.
        //
        // Never both: ``client_tools`` on a central job would bring back the
        // per-message cost the catalogue exists to remove.
        //
        // Decided once and kept on the session below: whether the turn may
        // send host requests is what decides whether it gets a parked reader
        // (see parkStream), and the agent may change during the POST.
        const hostCatalogue = !this.agentId;
        if (!hostCatalogue) {
            const clientTools = this._buildClientTools();
            if (clientTools.length > 0) {
                body.append('client_tools', JSON.stringify(clientTools));
            }
        } else {
            body.append('host_catalogue', 'true');
        }

        // What the host reports about the user and their screen, computed now
        // so it describes this moment (platform ADR-019).
        const hostContext = this.resolveHostContext();
        if (hostContext) {
            body.append('host_context', JSON.stringify(hostContext));
        }

        // The languages this page draws as rich blocks, so the platform indexes
        // the turn's blocks when it ends (2026-10-14). Omitted with none: the
        // platform reads an empty list as none too, but the field is noise.
        if (this.blockLanguages.length > 0) {
            body.append('block_languages', JSON.stringify(this.blockLanguages));
        }

        let jobResponse: Response;
        try {
            jobResponse = await netFetch(`${this.gatewayUrl}/v1/user/jobs`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token ?? ''}` },
                body,
            });
        } catch (err) {
            onError(new Error(`Gateway unreachable: ${err}`));
            return;
        }

        if (jobResponse.status === 429) {
            // Rate limited before anything ran. The gateway sends `Retry-After`
            // and it is exact — the window is a calendar minute — so this waits
            // it out once rather than surfacing an error the user can only
            // answer by clicking retry at a moment of their own choosing, which
            // is how a rate limit becomes a retry storm.
            //
            // Once, not repeatedly: a second refusal means the ceiling is not a
            // brief burst, and at that point the user should be told rather than
            // kept waiting.
            const waitSeconds = parseRetryAfter(jobResponse.headers.get('Retry-After'));
            onEvent({
                type: 'rate_limited',
                data: {
                    payload: { retry_after_seconds: waitSeconds, phase: 'submitting' },
                },
            });
            await this._delay(waitSeconds * 1000);
            jobResponse = await netFetch(`${this.gatewayUrl}/v1/user/jobs`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token ?? ''}` },
                body,
            }).catch(() => null) as Response;
            if (!jobResponse) {
                onError(new Error('Gateway unreachable'));
                return;
            }
        }

        if (!jobResponse.ok) {
            const text = await jobResponse.text().catch(() => '');
            onError(new Error(describeHttpFailure(jobResponse.status, text)));
            return;
        }

        const jobData = await jobResponse.json();
        const streamUrl: string | undefined = jobData?.data?.job?.stream_url;
        const jobId: string | undefined = jobData?.data?.job?.uuid ?? jobData?.data?.job?.job_uuid;

        if (!streamUrl) {
            onError(new Error('Gateway response missing stream_url'));
            return;
        }

        // Open the SSE stream with automatic reconnection. While a client tool
        // waits for user input (e.g. an ask_user_questions form) the agent is
        // suspended and NO terminal event is written, so the connection can
        // idle for a long time and may be dropped by the network. Stream Edge
        // retains history and supports Last-Event-ID resume, so on any
        // non-terminal drop we reconnect from the last frame we saw and only
        // finish on a real ``end``/``error`` event.
        //
        // ``jobId ?? conversationId`` only to keep the field typed: every
        // successful create response carries a uuid, and a response without one
        // has already failed above.
        const session = this._openSession(
            conversationId, jobId ?? conversationId, streamUrl, hostCatalogue
        );
        const outcome = await this._runStream(
            session, onEvent, onError, { isResume: false }
        );

        if (outcome === 'completed') { onComplete(); return; }
        if (outcome === 'expired' || outcome === 'stalled') {
            onError(new Error('Stream connection lost'));
            return;
        }
        // 'errored' has already called onError; 'aborted' is deliberate and the
        // caller is told by whatever aborted it.
    }

    /**
     * The conversation this client is in, minting one if it has none.
     *
     * Split out so ``sendMessage`` can take the value as a local before its
     * first await. A conversation id is client-minted because the gateway
     * accepts one but never creates or returns one.
     */
    private _ensureConversationId(): string {
        if (!this.conversationId) {
            this.conversationId = createUuid();
            this.persistSession();
        }
        return this.conversationId;
    }

    /**
     * Read one conversation's stream to a conclusion, reconnecting on drops.
     *
     * Shared by the send path and the resume path because they differ in exactly
     * two ways, both carried in ``opts``: a resume starts from the token's own
     * boundary rather than from a cursor, and a resume enforces a first-frame
     * deadline because it may be pointed at a stream that no longer has anything
     * in it.
     *
     * A parked reader (``opts.parked``; see {@link _startParkedReader}) runs
     * the same loop on its own controller, with three differences. It has no
     * first-frame deadline, since a suspended turn is legitimately silent. It
     * stops once the token's lifetime is up rather than minting another,
     * because past that point the conversation cannot be re-opened from this
     * page anyway (see {@link hasLiveTurn}). And it never closes the session:
     * the credential is for the reader that shows the conversation again.
     */
    private async _runStream(
        session: StreamSession,
        onEvent: (event: StreamEvent) => void,
        onError: (error: Error) => void,
        opts: { isResume: boolean; parked?: boolean },
    ): Promise<StreamOutcome> {
        const RECONNECT_DELAY_MS = 1000;
        const MAX_CONSECUTIVE_RETRIES = 30;
        const generation = session.generation;
        let retries = 0;
        // The first-frame deadline belongs to the first attempt only. A resumed
        // read that connects, replays and then drops has already proved the
        // stream is there; re-arming it on the reconnect would abort a healthy
        // suspended turn, because a reconnect carries Last-Event-ID and so
        // legitimately receives nothing until the run moves again.
        let firstAttempt = true;
        // Whether this loop has already exchanged an expired token for a new
        // one without reading anything since. Reset on progress, so a run long
        // enough to outlive several token lifetimes keeps renewing.
        let remintedSinceProgress = false;

        // True while this loop still owns its conversation. Checked after every
        // await: a superseded loop must exit even if its controller was replaced
        // rather than aborted.
        const stillOurs = () =>
            this.sessions.get(session.conversationId) === session
            && session.generation === generation;

        while (true) {
            const abort = opts.parked ? session.parkedReader : session.abort;
            if (!abort || abort.signal.aborted || !stillOurs()) return 'aborted';
            if (opts.parked && this._tokenExpired(session)) return 'expired';

            let streamResponse: Response;
            try {
                streamResponse = await netFetch(session.streamUrl, {
                    signal: abort.signal,
                    headers: session.lastEventId
                        ? { 'Last-Event-ID': session.lastEventId }
                        : undefined,
                });
            } catch (err) {
                if (abort.signal.aborted || !stillOurs()) return 'aborted';
                if (retries++ >= MAX_CONSECUTIVE_RETRIES) {
                    onError(new Error(`Stream-edge unreachable: ${err}`));
                    return 'errored';
                }
                await this._delay(RECONNECT_DELAY_MS);
                continue;
            }

            if (!stillOurs()) return 'aborted';

            if (streamResponse.status === 401 || streamResponse.status === 403) {
                // A parked reader stops and leaves the credential as it is:
                // renewing it, or closing the session, is for the reader that
                // shows the conversation again.
                if (opts.parked) return 'expired';
                // The token expired. Ask the gateway for another one and try
                // again — but only once between reads: if a *freshly minted*
                // credential is rejected too, the problem is not its age and
                // minting a third would spin.
                if (!remintedSinceProgress) {
                    const renewed = await this._refreshStreamUrl(session);
                    if (!stillOurs()) return 'aborted';
                    if (renewed) {
                        remintedSinceProgress = true;
                        continue;
                    }
                }
                // Nothing more to try: the turn is no longer reachable from
                // this page. Not a failure to retry or to report as one.
                this._closeSession(session);
                return 'expired';
            }

            if (!streamResponse.ok) {
                onError(new Error(`Stream-edge ${streamResponse.status}`));
                return 'errored';
            }

            const idBeforeRead: string | null = session.lastEventId;
            const armStallDeadline = opts.isResume && !opts.parked && firstAttempt;
            firstAttempt = false;
            const outcome = await this._readStream(
                session,
                streamResponse,
                onEvent,
                onError,
                abort,
                { ...opts, armStallDeadline },
            );

            if (outcome === 'aborted' || outcome === 'stalled') return outcome;
            if (outcome === 'completed' || outcome === 'errored') return outcome;

            // 'dropped' — reconnect. Reset the retry budget whenever we made
            // progress, so the cap only trips on a genuinely stuck stream.
            if (session.lastEventId !== idBeforeRead) {
                retries = 0;
                remintedSinceProgress = false;
            }
            if (retries++ >= MAX_CONSECUTIVE_RETRIES) {
                onError(new Error('Stream connection lost'));
                return 'errored';
            }
            await this._delay(RECONNECT_DELAY_MS);
        }
    }

    /**
     * Read one SSE connection to completion. Returns why it ended:
     *  - ``completed``: a terminal ``end`` event arrived (turn done).
     *  - ``errored``: a terminal ``error`` event arrived (``onError`` called).
     *  - ``dropped``: the connection closed without a terminal event — the
     *    caller should reconnect with ``Last-Event-ID``.
     *  - ``stalled``: a resumed read produced no frame at all within the
     *    deadline, which means the stream is gone rather than quiet.
     *  - ``aborted``: the reader was aborted or superseded.
     */
    private async _readStream(
        session: StreamSession,
        streamResponse: Response,
        onEvent: (event: StreamEvent) => void,
        onError: (error: Error) => void,
        abort: AbortController,
        opts: { isResume: boolean; armStallDeadline: boolean; parked?: boolean },
    ): Promise<'completed' | 'errored' | 'dropped' | 'stalled' | 'aborted'> {
        const reader = streamResponse.body?.getReader();
        if (!reader) {
            onError(new Error('No stream body'));
            return 'errored';
        }

        const decoder = new TextDecoder();
        let buffer = '';
        // The ``id:`` of the frame being read, until its ``data:`` arrives.
        let pendingEventId: string | null = null;

        // A resumed reader may be pointed at a stream that no longer holds
        // anything. Stream Edge cannot tell us that — an expired key reads as
        // empty and the connection pings forever — so the deadline is ours, and
        // it is cancelled by the first frame of a real replay.
        let stalled = false;
        let firstFrameSeen = false;
        const stallTimer = opts.armStallDeadline
            ? setTimeout(() => {
                if (firstFrameSeen) return;
                stalled = true;
                abort.abort();
            }, RESUME_FIRST_FRAME_TIMEOUT_MS)
            : null;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) return 'dropped';
                // Checked on every chunk, keepalive pings included, because
                // Stream Edge checks a token only when a connection opens and
                // an open one can outlive it.
                if (opts.parked && this._tokenExpired(session)) return 'aborted';

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    // Track the composite cursor so a reconnect resumes here.
                    if (line.startsWith('id:')) {
                        pendingEventId = line.slice(3).trim();
                        continue;
                    }
                    if (!line.startsWith('data:')) continue; // skips ": ping" too
                    // The cursor moves past a frame only once its data is in
                    // hand, and the frame is handled before the next read.
                    // Stream Edge writes ``id:`` first and a chunk can end
                    // between the two lines. Moving the cursor on the ``id:``
                    // alone would make a reconnect, or a parked reader taking
                    // over from here, start after a frame nobody handled.
                    if (pendingEventId !== null) {
                        session.lastEventId = pendingEventId;
                        pendingEventId = null;
                    }
                    const raw = line.slice(5).trim();
                    if (!raw) continue;

                    let event: any;
                    try {
                        event = JSON.parse(raw);
                    } catch {
                        continue;
                    }

                    firstFrameSeen = true;

                    // Parsed once, here, because three separate places below need
                    // it — which job was announced, what an error said, and what
                    // the caller is handed. An unparseable payload is an empty
                    // one: every reader below checks the field it wants.
                    let payload: any = {};
                    if (event.payload_json) {
                        try { payload = JSON.parse(event.payload_json); } catch { }
                    }

                    // Which jobs belong to this turn. A delegated child is
                    // announced before it can publish anything, so adding it
                    // here is always in time.
                    if (event.type === 'sub_agent_started' && payload.child_job_uuid) {
                        session.knownJobIds.add(String(payload.child_job_uuid));
                        // A handoff child takes the turn over: the parent is
                        // finished and the child is now the job answering the
                        // user. Anything addressed at "this turn's job" — a stop
                        // request above all — has to follow it, or pressing stop
                        // would target a job that has already completed and do
                        // nothing at all. A *delegated* child does not move it:
                        // its parent is still the turn and is still cancellable,
                        // and the server propagates a cancellation down to it.
                        if (payload.handoff) {
                            session.jobId = String(payload.child_job_uuid);
                            this.persistSession();
                        }
                    }

                    // On a resume only, ignore frames from a job that is not
                    // part of this turn.
                    //
                    // A replay starts at the turn's boundary but the stream is
                    // scoped to the whole conversation, so a *later* turn's
                    // frames can appear in the same read — and Stream Edge
                    // decides to close from the frame alone, without regard to
                    // which job it came from, so a foreign ``end`` would cut this
                    // replay off mid-turn. The live path is left unfiltered: it
                    // starts at the tail, where the hazard does not arise. A
                    // parked reader always reads as a resume (see
                    // _startParkedReader), and also answers only this turn.
                    if (
                        opts.isResume
                        && event.job_uuid
                        && !session.knownJobIds.has(String(event.job_uuid))
                    ) {
                        continue;
                    }

                    // A terminal event ends the *turn* only when it says so.
                    // Several jobs now share one conversation-scoped stream, and
                    // a delegated sub-agent finishing is not the turn finishing —
                    // its parent is still running and about to receive the
                    // result. Closing here would cut the user off mid-turn.
                    //
                    // The field is absent on everything that predates
                    // sub-agents, and absent means "closes", so nothing changes
                    // for a stream with one job in it.
                    const terminatesStream = event.terminates_stream !== 'false';

                    if (event.type === 'end') {
                        if (terminatesStream) {
                            // A parked reader's work ends with the turn, but
                            // the credential stays: coming back replays the
                            // ending from it, as it did before parked readers.
                            if (opts.parked) return 'completed';
                            // The turn is over, so there is nothing left to
                            // resume — drop the credential rather than offer to
                            // replay a finished answer.
                            this._closeSession(session);
                            return 'completed';
                        }
                        continue;
                    }

                    if (event.type === 'error') {
                        if (!terminatesStream) {
                            // A sub-agent failed. Its parent is told through its
                            // own resume path and decides what to say about it;
                            // surfacing it here would report someone else's
                            // failure as the turn's.
                            console.warn('[GatewayStreamClient] sub-agent job failed', event.job_uuid);
                            continue;
                        }
                        // As for ``end`` above: the failure is reported by the
                        // replay when the user comes back.
                        if (opts.parked) return 'errored';
                        this._closeSession(session);
                        onError(new Error(payload.error_message ?? 'Stream error'));
                        return 'errored';
                    }

                    // A result settles its step, whichever kind of tool produced
                    // it. Recorded before the client-tool branch below so a
                    // replay that carries both frames never re-asks: on the
                    // resume path the request is held, and this is what discards
                    // it when its answer turns up further down the same replay.
                    if (event.type === 'tool_result' && payload.step_uuid) {
                        const stepUuid = String(payload.step_uuid);
                        session.settledStepUuids.add(stepUuid);
                        session.deferredClientCalls.delete(stepUuid);
                        // A meta-tool's host request shares its step: the
                        // meta-tool's result means it was answered.
                        const heldHostRequest = session.heldHostRequests.get(stepUuid);
                        if (heldHostRequest !== undefined) {
                            clearTimeout(heldHostRequest);
                            session.heldHostRequests.delete(stepUuid);
                        }
                        if (payload.tool_output !== undefined && payload.tool_output !== null) {
                            this.stepOutputs.set(stepUuid, parseToolOutput(payload.tool_output));
                        }
                    }

                    // Handle client-side tool call: fire callback, then ack
                    // (immediately for previews, or after the user submits an
                    // interactive form — see _handleClientToolCall).
                    if (event.type === 'client_tool_call') {
                        this._onClientToolCall(session, event, payload, opts);
                    }

                    // Hand a server-side tool's output to its registered
                    // previewer. Nothing is acked here — the job did not
                    // suspend for this and is already running the next step.
                    // Not from a parked reader: a preview is a side effect on
                    // the screen, which shows another conversation. The
                    // replay fires it when the user comes back.
                    if (event.type === 'tool_result' && !opts.parked) {
                        this._handleToolResult(session, payload).catch(err =>
                            console.error('[GatewayStreamClient] result previewer failed', err)
                        );
                    }

                    // Any frame at all means the replay is still arriving, so the
                    // "caught up" clock restarts. Held calls fire only once it
                    // runs out. (Held host requests have clocks of their own,
                    // which nothing restarts — see _holdHostRequest.)
                    if (opts.isResume && session.deferredClientCalls.size > 0) {
                        this._armReplayFlush(session);
                    }

                    // A parked reader forwards nothing: whoever was listening
                    // has moved to another conversation.
                    if (opts.parked) continue;

                    const streamEvent: StreamEvent = {
                        type: event.type,
                        data: {
                            ...event,
                            payload,
                            content: event.type === 'token' ? (payload.text ?? '') : undefined,
                        },
                    };
                    onEvent(streamEvent);
                }
            }
        } catch (err) {
            // An abort surfaces here as a thrown error; everything else is a
            // recoverable mid-read drop. The stall check comes first because a
            // stall *is* implemented as an abort, and reporting it as one would
            // leave the caller waiting for a read that will never resume.
            if (stalled) return 'stalled';
            if (abort.signal.aborted) return 'aborted';
            return 'dropped';
        } finally {
            if (stallTimer !== null) clearTimeout(stallTimer);
            reader.releaseLock();
        }
    }

    private _delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Build an agent-bound job's ``client_tools`` payload from registered
     * client tools that carry an inline ``definition``. Shape matches the
     * gateway contract: ``{ name, description, input_schema,
     * requires_approval, share_with_sub_agents, defer_loading, skills }`` per
     * tool. (A central-mode job sends none; its host requests are answered in
     * the same shape, less the deprecated ``defer_loading`` — see
     * `common/hostCatalogue.ts`.)
     *
     * Entries without a ``definition`` are omitted on purpose: those are
     * backend-registered tools whose schema already lives in ``quota.tools``, and
     * sending one here would be rejected as a client tool shadowing a
     * backend tool's reserved name.
     */
    private _buildClientTools(): Array<{
        name: string;
        description: string;
        input_schema: Record<string, any>;
        requires_approval: boolean;
        share_with_sub_agents: boolean;
        defer_loading: boolean;
        skills: string[];
    }> {
        const advertised: Array<[string, ClientToolConfig]> = [];
        for (const [slug, config] of Object.entries(this.tools)) {
            // Never the reserved host-request slug: the Gateway refuses a job
            // whose ``client_tools`` names it (422 ``INVALID_CLIENT_TOOLS``),
            // so one stray registration would fail every message, and this
            // client never routes a call to it anyway. A central-mode answer
            // leaves it out for the same reason (`common/hostCatalogue.ts`).
            if (isHostRequestSlug(slug)) continue;
            if (isClientTool(config) && config.definition) {
                advertised.push([slug, config]);
            }
        }
        return advertised.map(([slug, config]) => ({
            name: slug,
            description: config.definition!.description,
            input_schema: config.definition!.input_schema,
            // Always sent explicitly rather than left to the server default,
            // so a spec read in isolation states its own gate.
            requires_approval: config.definition!.requires_approval ?? false,
            share_with_sub_agents: config.definition!.share_with_sub_agents ?? false,
            // Deprecated and ignored by an agent's run, which offers its whole
            // tool set; kept on the wire so a spec states what its host set.
            defer_loading: config.definition!.defer_loading ?? false,
            skills: config.definition!.skills ?? [],
        }));
    }

    /**
     * Fire the registered ``preview`` handler for a completed server-side tool.
     *
     * Skipped entirely when the entry sets ``autoRun: false`` — the handler is
     * then reachable only from the step's action control, which is how a host
     * app keeps a preview from opening itself mid-turn or on a reload.
     *
     * Failed steps are skipped: a preview exists to display a result, and
     * the error body of a failed tool is not one. Errors thrown by the handler
     * are logged and swallowed — a broken preview must not kill the stream
     * reader, which is still delivering the rest of the run.
     */
    private async _handleToolResult(
        session: StreamSession,
        payload: any,
    ): Promise<void> {
        const { step_uuid, tool_slug, tool_output, status } = payload ?? {};
        if (!tool_slug || status !== 'completed') return;

        if (step_uuid && tool_output !== undefined && tool_output !== null) {
            this.stepOutputs.set(String(step_uuid), parseToolOutput(tool_output));
        }

        const config = this.tools[tool_slug];
        if (!config || !isServerTool(config)) return;

        // Checked before the once-per-step set below, not after: marking a step
        // previewed that was never previewed would poison it for a later
        // ``setTools`` that turns ``autoRun`` back on.
        if (config.autoRun === false) return;

        // Once per step, per session. A resume replays every ``tool_result`` the
        // turn produced, and a previewer is a side effect on the host app's UI —
        // without this, reloading a finished-tool turn re-opens every preview
        // panel the turn ever produced, in order.
        if (step_uuid) {
            if (session.previewedStepUuids.has(step_uuid)) return;
            session.previewedStepUuids.add(step_uuid);
        }

        await config.preview(parseToolOutput(tool_output), {
            tool_slug,
            step_uuid: step_uuid ?? '',
            status,
        });
    }

    /**
     * Fire the registered callback for a client-side tool and POST the result
     * so the suspended job resumes.  The callback may return synchronously
     * (fire-and-forget preview) or a Promise that resolves once the user has
     * acted (e.g. submitted a questionnaire form) — we await it either way and
     * send whatever it resolves to back to the agent as the tool result.
     */
    /**
     * Decide whether a ``client_tool_call`` frame should run now, later, or not
     * at all.
     *
     * Live, it runs now — the agent is suspended on it. Replayed, it is held:
     * the frame is history, and the answer may already be a few frames away. A
     * call this page has already settled is dropped outright, which is what stops
     * a reload from re-opening a questionnaire the user has filled in and posting
     * a second answer the orchestrator would drop unexplained.
     *
     * A host request is held on a clock of its own instead (see
     * {@link _holdHostRequest}). A parked reader answers host requests only:
     * any other call waits for the replay when the user comes back, and is not
     * marked settled, so that replay still asks it.
     */
    private _onClientToolCall(
        session: StreamSession,
        event: any,
        payload: any,
        opts: { isResume: boolean; parked?: boolean },
    ): void {
        const stepUuid = payload?.step_uuid ? String(payload.step_uuid) : null;
        if (stepUuid && session.settledStepUuids.has(stepUuid)) return;

        const hostRequest = isHostRequestSlug(payload?.tool_slug);
        if (opts.parked && !hostRequest) return;

        if (opts.isResume && stepUuid) {
            if (hostRequest) {
                this._holdHostRequest(session, stepUuid, event, payload);
                return;
            }
            session.deferredClientCalls.set(stepUuid, { event, payload });
            this._armReplayFlush(session);
            return;
        }

        if (stepUuid) session.settledStepUuids.add(stepUuid);
        this._handleClientToolCall(session, event, payload).catch(err =>
            console.error('[GatewayStreamClient] client tool ack failed', err)
        );
    }

    /**
     * Answer a host request seen on a read that may be replaying, a second
     * from now, unless its answer turns up first.
     *
     * Not through the replay's quiet-period clock, which held client tool
     * calls share. That clock restarts on every frame from any job in the
     * turn, and a resumed read keeps those semantics for the rest of its life,
     * live frames included. A parent runs its delegated children side by side,
     * so while one child streams its answer, another child's start-up fetch
     * could wait past the platform's host-request timeout (15 s by default).
     * The run would then go on without the application's tools. Holding is
     * worth so little here because answering is pure: a duplicate answer
     * only meets a harmless 409.
     *
     * The second still lets a meta-tool's result further down the same replay
     * drop the request (see the ``tool_result`` branch of _readStream). A run's
     * start-up fetch has no result frame to show it was answered, so after a
     * reload it is answered again and refused with that 409.
     */
    private _holdHostRequest(session: StreamSession, stepUuid: string, event: any, payload: any): void {
        // The first sighting's clock stands: a reconnect that re-delivers the
        // frame must not push the answer back.
        if (session.heldHostRequests.has(stepUuid)) return;
        const timer = setTimeout(() => {
            session.heldHostRequests.delete(stepUuid);
            // A replaced or closed session's own reader has taken the turn
            // over, or the turn is over.
            if (this.sessions.get(session.conversationId) !== session) return;
            if (session.settledStepUuids.has(stepUuid)) return;
            session.settledStepUuids.add(stepUuid);
            this._handleClientToolCall(session, event, payload).catch(err =>
                console.error('[GatewayStreamClient] client tool ack failed', err)
            );
        }, REPLAY_SETTLE_MS);
        session.heldHostRequests.set(stepUuid, timer);
    }

    /** Restart the quiet-period clock that releases held client tool calls. */
    private _armReplayFlush(session: StreamSession): void {
        if (session.replayFlushTimer !== null) {
            clearTimeout(session.replayFlushTimer);
        }
        session.replayFlushTimer = setTimeout(
            () => this._flushDeferredClientCalls(session),
            REPLAY_SETTLE_MS,
        );
    }

    /**
     * Run whatever client tool calls survived the replay.
     *
     * Whatever is left here was requested and never answered, so the agent is
     * still waiting on it — the case this whole mechanism exists to recover.
     */
    private _flushDeferredClientCalls(session: StreamSession): void {
        session.replayFlushTimer = null;
        const held = [...session.deferredClientCalls.entries()];
        session.deferredClientCalls.clear();
        for (const [stepUuid, { event, payload }] of held) {
            if (session.settledStepUuids.has(stepUuid)) continue;
            session.settledStepUuids.add(stepUuid);
            this._handleClientToolCall(session, event, payload).catch(err =>
                console.error('[GatewayStreamClient] client tool ack failed', err)
            );
        }
    }

    private async _handleClientToolCall(
        session: StreamSession,
        event: any,
        payload: any,
    ): Promise<void> {
        const { step_uuid, tool_slug, tool_input } = payload;

        // A host request is the platform asking about this application's tools
        // and skills, not a tool call. Decided by the reserved slug alone and
        // before the registry is read, so an application tool registered under
        // that slug can never shadow the answer — and it never runs one.
        if (isHostRequestSlug(tool_slug)) {
            await this._answerHostRequest(session, event, payload);
            return;
        }

        // Default ack for side-effect-only tools that return nothing.
        let toolOutput: any = { status: 'previewed' };

        const config = this.tools[tool_slug];
        if (config && isClientTool(config)) {
            try {
                const result = await config.run(tool_input ?? {}, {
                    tool_slug,
                    step_uuid: step_uuid ?? '',
                    job_uuid: event?.job_uuid ?? session.jobId ?? undefined,
                });
                if (result !== undefined) {
                    toolOutput = result;
                }
            } catch (err) {
                // Answered as a failure, for the reason given for the
                // unregistered slug below: until 4.0 this posted the
                // ``previewed`` placeholder, a success for a call that did
                // not happen. A handler that throws on stale page state is
                // likelier now that a tool loaded in an earlier turn is
                // called across navigations.
                console.error(`[GatewayStreamClient] client tool '${tool_slug}' run error`, err);
                toolOutput = { error: describeRunFailure(tool_slug, err) };
            }
        } else {
            // Answered rather than left hanging — an unregistered slug, or one
            // registered as a server tool by mistake, must still resume the
            // job — and answered as what it is. This used to be the
            // ``previewed`` placeholder, a success the model then reported to
            // the user although nothing ran. It is no longer rare: a tool
            // loaded in an earlier turn stays loaded for the conversation, and
            // the page that registered it may be gone by the time it is called.
            // An ``error`` lets the model say so, or look for another way.
            console.warn(`[GatewayStreamClient] no 'run' handler for client tool '${tool_slug}'`);
            toolOutput = {
                error: `No handler for '${tool_slug}' is registered in this application right now.`,
            };
        }

        // The job that made this call, not whichever job opened the stream.
        //
        // A conversation-scoped stream carries a delegated sub-agent's frames
        // too, and a sub-agent's ``client_tool_call`` is tagged with the child's
        // uuid. Answering against the parent looked like it worked — the gateway
        // checks only that the caller owns the job it named and returns 202 —
        // but the orchestrator resolves the step's real owner, sees the mismatch
        // and drops the message, so the child stayed suspended until its TTL
        // with nothing on screen to say so.
        const jobId: string | null = event?.job_uuid ?? session.jobId ?? null;
        if (!jobId || !step_uuid) return;

        await this._postToJob(jobId, 'tool-results', {
            step_uuid,
            tool_output: toolOutput,
            status: 'completed',
        });
    }

    /**
     * Answer one host request (see {@link setSkills} and
     * `common/hostCatalogue.ts`) through the same ``tool-results`` endpoint a
     * client tool's answer takes.
     *
     * Always ``status: 'completed'``: an answer this browser cannot give is
     * ``{ error }`` in the output, which the platform reads as "the
     * application did not answer" and continues with its own half at once,
     * rather than waiting out its host-request timeout.
     *
     * An answer over the Gateway's tool-result cap is replaced with a small
     * ``{ error }`` before it is sent ({@link HOST_ANSWER_MAX_BYTES} says why
     * it is measured here rather than left to the Gateway's 413).
     *
     * Two refusals are handled here because they are expected:
     *
     *  - ``413``: the answer is over the cap after all (the platform's cap
     *    shrank, say) and the browser could read the refusal. The platform
     *    would wait out its timeout for an answer that will never come, so the
     *    small ``{ error }`` is sent in its place.
     *  - ``409``: the run is no longer waiting on this request. Either the
     *    platform timed it out, or a replay after a reload re-delivered a run's
     *    start-up fetch, which has no ``tool_result`` frame to show it was
     *    answered. Nothing is lost, so it is not reported as a failure.
     */
    private async _answerHostRequest(
        session: StreamSession,
        event: any,
        payload: any,
    ): Promise<void> {
        const { step_uuid, tool_input } = payload ?? {};
        // The job that asked — a sub-agent's own start-up fetch names the
        // child — for the same reason as a client tool's answer (see
        // _handleClientToolCall).
        const jobId: string | null = event?.job_uuid ?? session.jobId ?? null;
        if (!jobId || !step_uuid) return;

        let answer: HostRequestAnswer;
        try {
            answer = answerHostRequest(tool_input, this.tools, this.skills);
        } catch (err) {
            // Only a hostile registry gets here (a definition getter that
            // throws, say); the platform still deserves an answer.
            console.error('[GatewayStreamClient] answering a host request failed', err);
            answer = { error: 'The application could not describe its tools.' };
        }

        const envelope = (toolOutput: HostRequestAnswer) => ({
            step_uuid,
            tool_output: toolOutput,
            status: 'completed' as const,
        });

        // The whole body, as _postToJob will encode it: that is what the
        // Gateway's cap counts.
        if (!('error' in answer) && utf8ByteLength(JSON.stringify(envelope(answer))) > HOST_ANSWER_MAX_BYTES) {
            console.warn('[GatewayStreamClient] host answer over the tool-result cap; sending an error instead', step_uuid);
            answer = { error: HOST_ANSWER_TOO_LARGE };
        }

        const post = (toolOutput: HostRequestAnswer) =>
            this._postToJob(jobId, 'tool-results', envelope(toolOutput));

        try {
            await post(answer);
        } catch (err) {
            const status = (err as { status?: number })?.status;
            if (status === 409) {
                console.debug('[GatewayStreamClient] host request no longer pending', step_uuid);
                return;
            }
            if (status === 413 && !('error' in answer)) {
                await post({ error: HOST_ANSWER_TOO_LARGE });
                return;
            }
            throw err;
        }
    }

    /**
     * Ask the server to stop this conversation's current turn.
     *
     * Not the same as closing the stream, and that distinction is the whole
     * reason this exists: aborting the reader only stops *watching*. The run
     * keeps going, keeps calling tools and keeps being charged, and the user who
     * pressed stop is told nothing about any of it.
     *
     * The reader is deliberately left open. The Orchestrator stops at its next
     * step boundary and writes a terminal event, so the connection carries the
     * cancellation through the same path as a normal ending — which is what
     * settles the transcript instead of freezing it mid-answer. The steps that
     * already ran are still charged; work performed is always billed.
     */
    async cancelTurn(conversationId?: string): Promise<void> {
        const target = conversationId ?? this.conversationId;
        const jobId = target ? this.sessions.get(target)?.jobId : null;
        if (!jobId) return;

        const response = await netFetch(
            `${this.gatewayUrl}/v1/user/jobs/${jobId}/cancel`,
            {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token ?? ''}` },
            }
        );
        if (!response.ok) {
            throw new Error(
                `[GatewayStreamClient] cancelling job ${jobId} failed with ${response.status}`
            );
        }
    }

    /**
     * Answer a client tool call this page did not receive over a stream.
     *
     * The stream path needs the credential the originating tab holds, so it can
     * never work in another browser. This one needs only what the transcript
     * already carries — the job, the step's correlation uuid, and the answer —
     * which is why a questionnaire can be finished from any device.
     *
     * Throws on refusal, and one refusal is expected and meaningful: `409`
     * means the run is no longer waiting, because it was answered elsewhere or
     * its state expired. The caller should say so rather than retry.
     */
    async submitClientToolResult(
        jobId: string,
        stepUuid: string,
        toolOutput: any,
    ): Promise<void> {
        await this._postToJob(jobId, 'tool-results', {
            step_uuid: stepUuid,
            tool_output: toolOutput,
            status: 'completed',
        });
    }

    /**
     * Answer an approval-gated tool call so the suspended run continues.
     *
     * The orchestrator holds a gated call *without dispatching it* and emits an
     * ``approval_request`` event (see ADR-006). Until this is called the run
     * stays suspended, so a UI that renders the request must always give the
     * user a way to reach both outcomes — an unanswered gate expires with the
     * run's Redis TTL and the user is left watching a spinner.
     *
     * ``'denied'`` is not a failure: the agent is told the user refused and may
     * explain or work around it, so there is no need to also cancel the run.
     */
    async submitApproval(
        approvalUuid: string,
        decision: 'approved' | 'denied',
        reason?: string,
        jobId?: string,
    ): Promise<void> {
        // ``jobId`` is the job whose ``approval_request`` frame this answers.
        // The orchestrator binds an approval to its own job and drops a verdict
        // claiming a different one, so a gate opened inside a sub-agent can only
        // be settled against the child — the same routing defect as a client
        // tool result. The session's job is the fallback for a caller that did
        // not keep the frame's job id.
        const target =
            jobId
            ?? this.sessions.get(this.conversationId ?? '')?.jobId
            ?? null;
        if (!target) {
            throw new Error(
                '[GatewayStreamClient] cannot submit an approval before a job has started'
            );
        }
        await this._postToJob(target, 'tool-approvals', {
            approval_uuid: approvalUuid,
            decision,
            ...(reason ? { reason } : {}),
        });
    }

    /**
     * POST a JSON body to one of the current job's tool endpoints.
     *
     * Both callers hand the orchestrator something it is actively waiting on, so
     * a silent failure leaves the run suspended until its TTL expires. Throwing
     * on a non-2xx is what lets the caller surface that rather than leaving the
     * user with a spinner and no explanation.
     */
    /**
     * Replace a session's stream URL with a freshly minted one.
     *
     * The credential handed back at job creation has a fixed lifetime, and
     * these runs outlive it — a single `analyze_file` call takes minutes, and a
     * turn with twenty of them passes half an hour routinely. Once it expires
     * the connection cannot be re-established, and everything the run emits
     * afterwards is lost with no error anywhere: a tool result, a token, or an
     * `approval_request` the whole turn is then blocked on.
     *
     * Returns whether a new URL was obtained. `false` covers every reason —
     * the endpoint is missing, the job is gone, the network failed — because
     * the caller does the same thing in all of them: give up on this stream.
     */
    private async _refreshStreamUrl(session: StreamSession): Promise<boolean> {
        try {
            const response = await netFetch(
                `${this.gatewayUrl}/v1/user/jobs/${session.jobId}/stream-token`,
                {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${this.token ?? ''}` },
                }
            );
            if (!response.ok) return false;
            const body = await response.json();
            const url = body?.data?.stream?.stream_url;
            if (typeof url !== 'string' || !url) return false;
            session.streamUrl = url;
            return true;
        } catch {
            return false;
        }
    }

    private async _postToJob(
        jobId: string,
        path: string,
        body: Record<string, any>,
    ): Promise<void> {
        const response = await netFetch(
            `${this.gatewayUrl}/v1/user/tools/jobs/${jobId}/${path}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token ?? ''}`,
                },
                body: JSON.stringify(body),
            }
        );
        if (!response.ok) {
            // The status is part of the meaning here, not just diagnostics: a
            // caller distinguishes "no longer pending" (409) from a transport
            // failure, and answers the user differently.
            const error = new Error(
                `[GatewayStreamClient] POST ${path} failed with ${response.status}`
            ) as Error & { status?: number };
            error.status = response.status;
            throw error;
        }
    }
}
