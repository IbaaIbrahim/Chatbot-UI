import { StreamChatClient, StreamEvent, StreamOutcome } from './StreamClient';
import { ConversationClient } from './ConversationClient';
import { ConversationDetail, ConversationListResponse } from './types';
import { parseToolOutput } from './toolOutput';
import { createUuid } from '../common/uuid';
import { netFetch } from '../common/localNetwork';
import { isClientTool, isServerTool } from '../common/toolConfig';
import type { ClientToolConfig, ToolConfig } from '../common/toolConfig';

// The tool contract moved to ../common/toolConfig so that one module owns it
// end to end; these two are re-exported here because they were part of this
// module's public surface and nothing else about their meaning changed.
export type { ClientToolDefinition, ResultPreviewContext } from '../common/toolConfig';

export interface GatewayStreamClientConfig {
    gatewayUrl: string;
    token?: string | null;
    modelId?: string;
    conversationId?: string | null;
    /** Optional chat agent UUID. When set, jobs run under this agent's persona. */
    agentId?: string | null;
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
 * Where the active conversation + agent are parked so they outlive the client
 * object.
 *
 * Both used to live only as instance fields. Any replacement of the instance —
 * an HMR update, a StrictMode double-mount, an error boundary remounting the
 * host app — silently dropped them, and because `sendMessage` minted a fresh
 * uuid whenever `conversationId` was null, the very next message opened a *new*
 * conversation mid-thread and lost the agent binding with it (so the agent's
 * system prompt and its tool restrictions went too).
 *
 * sessionStorage, not localStorage: "the conversation I am currently in" is
 * per-tab, and a second tab should get its own thread rather than joining this
 * one.
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
}

/** The part of a session that survives a page load. */
interface PersistedLiveTurn {
    jobId: string;
    streamUrl: string;
    openedAtMs: number;
}

interface PersistedSession {
    conversationId: string | null;
    agentId: string | null;
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
        if (!raw) return { conversationId: null, agentId: null };
        const parsed = JSON.parse(raw) as Partial<PersistedSession>;
        return {
            conversationId: parsed.conversationId ?? null,
            agentId: parsed.agentId ?? null,
            // Absent in anything written before resume existed, and absent is
            // simply "no turn to re-open".
            liveTurns: parsed.liveTurns ?? {},
        };
    } catch {
        // Private-mode or disabled storage: fall back to in-memory only.
        return { conversationId: null, agentId: null };
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
    private conversationClient: ConversationClient;

    /**
     * Per-tool handlers and presentation registered by the application, keyed
     * by tool slug. One map, because one tool has one entry: whether it carries
     * ``run`` or ``preview`` is what says which end of the call it handles.
     */
    private tools: Record<string, ToolConfig> = {};
    /** UUIDs of user-enabled tools switched on for this caller's jobs. */
    private enabledToolIds: string[] = [];

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

    constructor(config: GatewayStreamClientConfig) {
        this.gatewayUrl = config.gatewayUrl.replace(/\/$/, '');
        this.token = config.token ?? null;
        this.modelId = config.modelId ?? 'gpt-5-mini';
        // An explicit config value wins; otherwise resume whatever this tab was
        // already in, so a remount continues the thread instead of forking it.
        const restored = readSession();
        this.conversationId = config.conversationId ?? restored.conversationId;
        this.agentId = config.agentId ?? restored.agentId;
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
            };
        }
        writeSession({
            conversationId: this.conversationId,
            agentId: this.agentId,
            liveTurns,
        });
    }

    setAgentId(id: string | null) {
        this.agentId = id;
        this.persistSession();
    }

    /**
     * The agent currently bound, including one restored from a previous page
     * load. A host app must consult this before auto-selecting a default, or it
     * will overwrite the restored binding on every mount.
     */
    getAgentId(): string | null {
        return this.agentId;
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
     * List the tools this caller may switch on, for the current agent.
     *
     * Pass the agent id to get only what that agent's policy allows; omit it for
     * an agentless job, where any active user-enabled tool may be requested.
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
     * Stop reading a conversation's stream but keep it re-openable.
     *
     * Called when the user switches away. Discarding the session instead would
     * be a false economy — the job runs and bills on the server whether or not
     * anyone is listening, so the only thing dropping the credential achieves is
     * making the output unreachable when the user comes back.
     */
    parkStream(conversationId: string): void {
        const session = this.sessions.get(conversationId);
        if (!session) return;
        session.abort?.abort();
        session.abort = null;
        session.generation += 1;
        this._cancelReplayFlush(session);
        this.persistSession();
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
        if (Date.now() - session.openedAtMs < STREAM_TOKEN_TTL_MS) return true;
        // Pruned on the way past rather than left to accumulate: an expired
        // entry can never become usable again. The reader is aborted first —
        // dropping the map entry without it would leave a loop running that
        // nothing can find to stop, still firing client-tool callbacks, and
        // would let the next send open a second reader on the same conversation.
        session.abort?.abort();
        session.abort = null;
        this._cancelReplayFlush(session);
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
    ): StreamSession {
        const existing = this.sessions.get(conversationId);
        if (existing) {
            existing.abort?.abort();
            // Retire its pending-flush clock too, or a held client tool call
            // from the session being replaced would fire a second later against
            // the old session's job — outside the new session's bookkeeping. The
            // settled set carries over below, so the new reader re-decides the
            // same call on its own replay.
            this._cancelReplayFlush(existing);
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
        this._cancelReplayFlush(session);
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
        // retires the first rather than running two readers over one turn.
        const session = this._openSession(
            conversationId, stored.jobId, stored.streamUrl
        );
        // _openSession stamps a fresh mint time; the credential is the original
        // one, so its age must be preserved or the TTL check would never expire.
        session.openedAtMs = stored.openedAtMs;
        this.persistSession();

        return this._runStream(session, onEvent, onError, { isResume: true });
    }

    async getConversations(offset?: number, limit?: number): Promise<ConversationListResponse> {
        return this.conversationClient.getConversations(limit, offset);
    }

    async getConversationDetail(id: string): Promise<ConversationDetail> {
        return this.conversationClient.getConversationDetail(id);
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

        // Dynamic client tools: send the schema of every registered external
        // tool that carries an inline ``definition``. The slug is the tool
        // name. Tools without a definition are backend-registered and need
        // nothing here.
        const clientTools = this._buildClientTools();
        if (clientTools.length > 0) {
            body.append('client_tools', JSON.stringify(clientTools));
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
            conversationId, jobId ?? conversationId, streamUrl
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
     */
    private async _runStream(
        session: StreamSession,
        onEvent: (event: StreamEvent) => void,
        onError: (error: Error) => void,
        opts: { isResume: boolean },
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
            const abort = session.abort;
            if (!abort || abort.signal.aborted || !stillOurs()) return 'aborted';

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
            const armStallDeadline = opts.isResume && firstAttempt;
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
        opts: { isResume: boolean; armStallDeadline: boolean },
    ): Promise<'completed' | 'errored' | 'dropped' | 'stalled' | 'aborted'> {
        const reader = streamResponse.body?.getReader();
        if (!reader) {
            onError(new Error('No stream body'));
            return 'errored';
        }

        const decoder = new TextDecoder();
        let buffer = '';

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

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    // Track the composite cursor so a reconnect resumes here.
                    if (line.startsWith('id:')) {
                        session.lastEventId = line.slice(3).trim();
                        continue;
                    }
                    if (!line.startsWith('data:')) continue; // skips ": ping" too
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
                    // starts at the tail, where the hazard does not arise.
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
                        session.settledStepUuids.add(String(payload.step_uuid));
                        session.deferredClientCalls.delete(String(payload.step_uuid));
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
                    if (event.type === 'tool_result') {
                        this._handleToolResult(session, payload).catch(err =>
                            console.error('[GatewayStreamClient] result previewer failed', err)
                        );
                    }

                    // Any frame at all means the replay is still arriving, so the
                    // "caught up" clock restarts. Held calls fire only once it
                    // runs out.
                    if (opts.isResume && session.deferredClientCalls.size > 0) {
                        this._armReplayFlush(session);
                    }

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
     * Build the ``client_tools`` payload from registered client tools that
     * carry an inline ``definition``. Shape matches the gateway contract:
     * ``{ name, description, input_schema, requires_approval }`` per tool.
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
    }> {
        const advertised: Array<[string, ClientToolConfig]> = [];
        for (const [slug, config] of Object.entries(this.tools)) {
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
     */
    private _onClientToolCall(
        session: StreamSession,
        event: any,
        payload: any,
        opts: { isResume: boolean },
    ): void {
        const stepUuid = payload?.step_uuid ? String(payload.step_uuid) : null;
        if (stepUuid && session.settledStepUuids.has(stepUuid)) return;

        if (opts.isResume && stepUuid) {
            session.deferredClientCalls.set(stepUuid, { event, payload });
            this._armReplayFlush(session);
            return;
        }

        if (stepUuid) session.settledStepUuids.add(stepUuid);
        this._handleClientToolCall(session, event, payload).catch(err =>
            console.error('[GatewayStreamClient] client tool ack failed', err)
        );
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
                console.error(`[GatewayStreamClient] client tool '${tool_slug}' run error`, err);
            }
        } else {
            // Acked with the placeholder above rather than left hanging: an
            // unregistered slug — or one registered as a server tool by mistake
            // — must still resume the job.
            console.warn(`[GatewayStreamClient] no 'run' handler for client tool '${tool_slug}'`);
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
