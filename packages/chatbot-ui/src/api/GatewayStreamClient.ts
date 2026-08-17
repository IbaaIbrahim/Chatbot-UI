import { StreamChatClient, StreamEvent } from './StreamClient';
import { ConversationClient } from './ConversationClient';
import { ConversationDetail, ConversationListResponse } from './types';
import { parseToolOutput } from './toolOutput';
import { createUuid } from '../common/uuid';

export interface GatewayStreamClientConfig {
    gatewayUrl: string;
    token?: string | null;
    modelId?: string;
    conversationId?: string | null;
    /** Optional chat agent UUID. When set, jobs run under this agent's persona. */
    agentId?: string | null;
}

/**
 * A dynamic ("bring-your-own") client tool definition sent to the gateway on
 * job creation. The agent sees these like any other tool; there is no backend
 * registration. The registration key (slug) becomes the tool ``name``.
 */
export interface ClientToolDefinition {
    /** What the tool does — shown to the model to decide when to call it. */
    description: string;
    /** JSON Schema for the tool arguments. Must be ``{ "type": "object", ... }``. */
    input_schema: Record<string, any>;
    /**
     * Ask the user to approve each call before the callback runs (ADR-006).
     *
     * The orchestrator holds the call, emits an ``approval_request`` event, and
     * only dispatches it once the user has agreed — so the callback below never
     * sees a call the user refused, and needs no confirmation of its own.
     *
     * This is how an app gates a tool it declared itself. A **backend-registered**
     * tool is gated by its execution profile instead, per tenant, in the Admin
     * Dashboard; setting it here would have nothing to resolve against, because
     * an app-supplied tool has no ``quota.tools`` row and no policy.
     *
     * Turn it on for anything that spends money, reaches a system outside the
     * platform, or changes what the user is looking at.
     */
    requires_approval?: boolean;
}

/** Callback configuration for a client-side external tool. */
export interface ExternalToolConfig {
    /**
     * Called when the agent invokes this tool.  The ``data`` argument is the
     * raw ``tool_input`` object from the ``client_tool_call`` SSE event.
     *
     * The client awaits the return value before acking the suspended job:
     *  - Return ``undefined`` (or nothing) for a fire-and-forget side effect
     *    (e.g. opening a preview modal). The job is acked immediately with a
     *    ``{ status: 'previewed' }`` placeholder.
     *  - Return a value — or a Promise that resolves once the user has acted
     *    (e.g. submitted a form) — to send that value back to the agent as the
     *    tool result.
     */
    callback: (data: any) => any | Promise<any>;
    /**
     * Optional inline tool definition. When present it is sent to the gateway
     * as a dynamic ``client_tools`` entry on each job, so no backend tool row
     * is required — the agent can call it purely on the strength of this
     * schema. Omit it for tools already registered in the backend (the
     * callback still fires on ``client_tool_call``).
     */
    definition?: ClientToolDefinition;
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

/** Where a result previewer's payload came from, for handlers that care. */
export interface ResultPreviewContext {
    /** The slug of the tool that produced the output. */
    tool_slug: string;
    /** The step this result belongs to — stable across a reload. */
    step_uuid: string;
    /** Always ``'completed'`` today; failures are not previewed. */
    status: string;
}

/**
 * Handler for the **output** of a server-side (``kafka``/``inline``) tool.
 *
 * This is the counterpart to {@link ExternalToolConfig}, and the two are not
 * interchangeable — they sit on opposite ends of a tool call:
 *
 * | | {@link ExternalToolConfig} | {@link ResultPreviewer} |
 * |---|---|---|
 * | `quota.tools.dispatch_mode` | `client` | `kafka` / `inline` |
 * | SSE event | `client_tool_call` | `tool_result` |
 * | Receives | the agent's ``tool_input`` | the worker's ``tool_output`` |
 * | Return value | posted back to resume the suspended job | ignored |
 *
 * A previewer is read-only: the job never suspends for it, so nothing is
 * waiting on what it returns. Register a server tool in ``external_tools``
 * and its callback is handed the *arguments* the model invented, never the
 * generated result.
 *
 * A JSON-string ``tool_output`` (what a ``BaseTool.execute`` returns) is
 * parsed before the handler sees it; anything unparseable is passed through
 * verbatim.
 */
export type ResultPreviewer = (
    output: any,
    context: ResultPreviewContext,
) => void | Promise<void>;

export class GatewayStreamClient implements StreamChatClient {
    private gatewayUrl: string;
    private token: string | null;
    private modelId: string;
    private conversationId: string | null;
    private agentId: string | null;
    private conversationClient: ConversationClient;

    /** Current job UUID, kept for the tool-results endpoint. */
    private currentJobId: string | null = null;
    /** External tool handlers registered by the application. */
    private externalTools: Record<string, ExternalToolConfig> = {};
    /** Server-tool output handlers registered by the application. */
    private resultPreviewers: Record<string, ResultPreviewer> = {};
    /** UUIDs of user-enabled tools switched on for this caller's jobs. */
    private enabledToolIds: string[] = [];
    /** Aborts the in-flight SSE stream (and its reconnect loop). */
    private currentStreamAbort: AbortController | null = null;

    constructor(config: GatewayStreamClientConfig) {
        this.gatewayUrl = config.gatewayUrl.replace(/\/$/, '');
        this.token = config.token ?? null;
        this.modelId = config.modelId ?? 'gpt-5-mini';
        this.conversationId = config.conversationId ?? null;
        this.agentId = config.agentId ?? null;
        this.conversationClient = new ConversationClient(this.gatewayUrl, this.token);
    }

    setAgentId(id: string | null) {
        this.agentId = id;
    }

    setToken(token: string | null) {
        this.token = token;
        this.conversationClient.setToken(token);
    }

    setConversationId(id: string | null) {
        this.conversationId = id;
    }

    /**
     * List the tools this caller may switch on, for the current agent.
     *
     * Pass the agent id to get only what that agent's policy allows; omit it for
     * an agentless job, where any active user-enabled tool may be requested.
     */
    async listEnablableTools(agentId?: string | null): Promise<EnablableTool[]> {
        const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : '';
        const response = await fetch(
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
     * Register client-side tool handlers.
     *
     * When the agent calls a ``client``-dispatched tool the orchestrator
     * emits a ``client_tool_call`` SSE event.  This client looks up the
     * matching entry here, fires the callback (e.g. opens a modal), and
     * immediately POSTs an ack to the gateway so the suspended job resumes.
     *
     * Usage:
     * ```ts
     * client.setExternalTools({
     *   preview_property_agent_result: { callback: (data) => openPreview(data) }
     * });
     * ```
     */
    setExternalTools(tools: Record<string, ExternalToolConfig>) {
        this.externalTools = tools;
    }

    /**
     * Register handlers for the **output** of server-side tools.
     *
     * A tool whose ``dispatch_mode`` is ``kafka`` or ``inline`` runs in a
     * worker and never emits ``client_tool_call``, so it can never reach an
     * {@link ExternalToolConfig}. Its result arrives on ``tool_result``, and
     * the handler registered here is fired with that output.
     *
     * Usage:
     * ```ts
     * client.setResultPreviewers({
     *   generate_checklist: (checklist) => openChecklistPreview(checklist)
     * });
     * ```
     */
    setResultPreviewers(previewers: Record<string, ResultPreviewer>) {
        this.resultPreviewers = previewers;
    }

    reset() {
        this.currentStreamAbort?.abort();
        this.currentStreamAbort = null;
        this.conversationId = null;
        this.currentJobId = null;
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
        if (!this.conversationId) {
            this.conversationId = createUuid();
        }

        const body = new FormData();
        body.append('prompt', text);
        body.append('model_id', this.modelId);
        body.append('conversation_id', this.conversationId);
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
            jobResponse = await fetch(`${this.gatewayUrl}/v1/user/jobs`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token ?? ''}` },
                body,
            });
        } catch (err) {
            onError(new Error(`Gateway unreachable: ${err}`));
            return;
        }

        if (!jobResponse.ok) {
            const text = await jobResponse.text().catch(() => '');
            onError(new Error(`Gateway ${jobResponse.status}: ${text}`));
            return;
        }

        const jobData = await jobResponse.json();
        const streamUrl: string | undefined = jobData?.data?.job?.stream_url;
        const jobId: string | undefined = jobData?.data?.job?.uuid ?? jobData?.data?.job?.job_uuid;

        if (!streamUrl) {
            onError(new Error('Gateway response missing stream_url'));
            return;
        }

        if (jobId) {
            this.currentJobId = jobId;
        }

        // Open the SSE stream with automatic reconnection. While a client tool
        // waits for user input (e.g. an ask_user_questions form) the agent is
        // suspended and NO terminal event is written, so the connection can
        // idle for a long time and may be dropped by the network. Stream Edge
        // retains history and supports Last-Event-ID resume, so on any
        // non-terminal drop we reconnect from the last frame we saw and only
        // finish on a real ``end``/``error`` event.
        this.currentStreamAbort?.abort();
        const abort = new AbortController();
        this.currentStreamAbort = abort;

        const RECONNECT_DELAY_MS = 1000;
        const MAX_CONSECUTIVE_RETRIES = 30;
        let lastEventId: string | null = null;
        let retries = 0;

        while (true) {
            if (abort.signal.aborted) return;

            let streamResponse: Response;
            try {
                streamResponse = await fetch(streamUrl, {
                    signal: abort.signal,
                    headers: lastEventId ? { 'Last-Event-ID': lastEventId } : undefined,
                });
            } catch (err) {
                if (abort.signal.aborted) return;
                if (retries++ >= MAX_CONSECUTIVE_RETRIES) {
                    onError(new Error(`Stream-edge unreachable: ${err}`));
                    return;
                }
                await this._delay(RECONNECT_DELAY_MS);
                continue;
            }

            if (!streamResponse.ok) {
                // 4xx/5xx (e.g. an expired stream token) is not recoverable by
                // retrying with the same URL — surface it and stop.
                onError(new Error(`Stream-edge ${streamResponse.status}`));
                return;
            }

            const idBeforeRead: string | null = lastEventId;
            const outcome = await this._readStream(
                streamResponse,
                onEvent,
                onError,
                abort,
                (id) => { lastEventId = id; },
            );

            if (outcome === 'aborted') return;
            if (outcome === 'completed') { onComplete(); return; }
            if (outcome === 'errored') return; // onError already called

            // 'dropped' — reconnect. Reset the retry budget whenever we made
            // progress, so the cap only trips on a genuinely stuck stream.
            if (lastEventId !== idBeforeRead) retries = 0;
            if (retries++ >= MAX_CONSECUTIVE_RETRIES) {
                onError(new Error('Stream connection lost'));
                return;
            }
            await this._delay(RECONNECT_DELAY_MS);
        }
    }

    /**
     * Read one SSE connection to completion. Returns why it ended:
     *  - ``completed``: a terminal ``end`` event arrived (job done).
     *  - ``errored``: a terminal ``error`` event arrived (``onError`` called).
     *  - ``dropped``: the connection closed without a terminal event — the
     *    caller should reconnect with ``Last-Event-ID``.
     *  - ``aborted``: the stream was aborted (new send or ``reset()``).
     */
    private async _readStream(
        streamResponse: Response,
        onEvent: (event: StreamEvent) => void,
        onError: (error: Error) => void,
        abort: AbortController,
        setLastEventId: (id: string) => void,
    ): Promise<'completed' | 'errored' | 'dropped' | 'aborted'> {
        const reader = streamResponse.body?.getReader();
        if (!reader) {
            onError(new Error('No stream body'));
            return 'errored';
        }

        const decoder = new TextDecoder();
        let buffer = '';

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
                        setLastEventId(line.slice(3).trim());
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

                    // Track job_uuid from first event that carries it.
                    if (!this.currentJobId && event.job_uuid) {
                        this.currentJobId = event.job_uuid;
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
                        if (terminatesStream) return 'completed';
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
                        let payload: any = {};
                        try { payload = JSON.parse(event.payload_json ?? '{}'); } catch { }
                        onError(new Error(payload.error_message ?? 'Stream error'));
                        return 'errored';
                    }

                    let payload: any = {};
                    if (event.payload_json) {
                        try { payload = JSON.parse(event.payload_json); } catch { }
                    }

                    // Handle client-side tool call: fire callback, then ack
                    // (immediately for previews, or after the user submits an
                    // interactive form — see _handleClientToolCall).
                    if (event.type === 'client_tool_call') {
                        this._handleClientToolCall(payload).catch(err =>
                            console.error('[GatewayStreamClient] client tool ack failed', err)
                        );
                    }

                    // Hand a server-side tool's output to its registered
                    // previewer. Nothing is acked here — the job did not
                    // suspend for this and is already running the next step.
                    if (event.type === 'tool_result') {
                        this._handleToolResult(payload).catch(err =>
                            console.error('[GatewayStreamClient] result previewer failed', err)
                        );
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
            // recoverable mid-read drop.
            if (abort.signal.aborted) return 'aborted';
            return 'dropped';
        } finally {
            reader.releaseLock();
        }
    }

    private _delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Build the ``client_tools`` payload from registered external tools that
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
        return Object.entries(this.externalTools)
            .filter(([, config]) => config.definition)
            .map(([slug, config]) => ({
                name: slug,
                description: config.definition!.description,
                input_schema: config.definition!.input_schema,
                // Always sent explicitly rather than left to the server default,
                // so a spec read in isolation states its own gate.
                requires_approval: config.definition!.requires_approval ?? false,
            }));
    }

    /**
     * Fire the registered previewer for a completed server-side tool.
     *
     * Failed steps are skipped: a previewer exists to display a result, and
     * the error body of a failed tool is not one. Errors thrown by the handler
     * are logged and swallowed — a broken preview must not kill the stream
     * reader, which is still delivering the rest of the run.
     */
    private async _handleToolResult(payload: any): Promise<void> {
        const { step_uuid, tool_slug, tool_output, status } = payload ?? {};
        if (!tool_slug || status !== 'completed') return;

        const previewer = this.resultPreviewers[tool_slug];
        if (!previewer) return;

        await previewer(parseToolOutput(tool_output), {
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
    private async _handleClientToolCall(payload: any): Promise<void> {
        const { step_uuid, tool_slug, tool_input } = payload;

        // Default ack for side-effect-only tools that return nothing.
        let toolOutput: any = { status: 'previewed' };

        const config = this.externalTools[tool_slug];
        if (config) {
            try {
                const result = await config.callback(tool_input ?? {});
                if (result !== undefined) {
                    toolOutput = result;
                }
            } catch (err) {
                console.error(`[GatewayStreamClient] external tool '${tool_slug}' callback error`, err);
            }
        } else {
            console.warn(`[GatewayStreamClient] no handler for client tool '${tool_slug}'`);
        }

        if (!this.currentJobId || !step_uuid) return;

        await this._postToJob('tool-results', {
            step_uuid,
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
    ): Promise<void> {
        if (!this.currentJobId) {
            throw new Error(
                '[GatewayStreamClient] cannot submit an approval before a job has started'
            );
        }
        await this._postToJob('tool-approvals', {
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
    private async _postToJob(path: string, body: Record<string, any>): Promise<void> {
        const response = await fetch(
            `${this.gatewayUrl}/v1/user/tools/jobs/${this.currentJobId}/${path}`,
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
            throw new Error(
                `[GatewayStreamClient] POST ${path} failed with ${response.status}`
            );
        }
    }
}
