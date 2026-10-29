// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayStreamClient } from './GatewayStreamClient';
import { HOST_REQUEST_SLUG } from '../common/hostCatalogue';
import type { ClientSkillDefinition, ToolConfig } from '../common/toolConfig';

/**
 * Host requests on a turn nobody is looking at, and on a resumed read.
 *
 * Each Stream Edge connection here stays open and is written to by the test,
 * frame by frame, so what matters can be timed: which connection the client
 * opens when the user leaves a conversation, from which cursor, what it
 * answers there and what it leaves alone, and how long a resumed read holds a
 * host request while other jobs keep streaming.
 *
 * Timers are faked (``setTimeout`` only, plus ``Date`` where the token's
 * lifetime matters); the stream itself runs on promises, which
 * ``advanceTimersByTimeAsync`` lets settle.
 */

const SESSION_KEY = 'chatbot-ui.active-session';
const GATEWAY_URL = 'https://gateway.test';
const STREAM_URL = 'https://edge.test/v1/stream';
const JOB = 'job-1';
const TOKEN_TTL_MS = 1800 * 1000;

const schema = { type: 'object', properties: { id: { type: 'string' } } };

type Frame = Record<string, unknown>;

interface Posted {
    url: string;
    body: any;
}

/** One Stream Edge connection, open until the test or the client ends it. */
interface Connection {
    url: string;
    /** The ``Last-Event-ID`` it was opened with: ``null`` reads from the turn's start. */
    lastEventId: string | null;
    body: ReadableStream<Uint8Array>;
    /** Writes one frame under the next id. */
    send(event: Frame): void;
    /** Writes exactly this text, for a frame split across reads. */
    raw(text: string): void;
    readonly aborted: boolean;
}

let posts: Posted[];
let connections: Connection[];
let frameId: number;

function frame(type: string, payload: Record<string, unknown>, jobUuid: string = JOB): Frame {
    return { type, job_uuid: jobUuid, payload_json: JSON.stringify(payload) };
}

function hostRequest(stepUuid: string, toolInput: unknown, jobUuid: string = JOB): Frame {
    return frame('client_tool_call', { step_uuid: stepUuid, tool_slug: HOST_REQUEST_SLUG, tool_input: toolInput }, jobUuid);
}

function token(text: string, jobUuid: string = JOB): Frame {
    return frame('token', { text }, jobUuid);
}

const end = (jobUuid: string = JOB): Frame => ({ type: 'end', job_uuid: jobUuid });

function openConnection(url: string, lastEventId: string | null, signal: AbortSignal | null): Connection {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    signal?.addEventListener('abort', () => {
        try { controller.error(new DOMException('aborted', 'AbortError')); } catch { /* closed */ }
    });
    const write = (text: string) => {
        try { controller.enqueue(encoder.encode(text)); } catch { /* aborted: nobody reads it */ }
    };
    return {
        url,
        lastEventId,
        body,
        send(event) {
            frameId += 1;
            write(`id: ${frameId}-0\ndata: ${JSON.stringify(event)}\n\n`);
        },
        raw: write,
        get aborted() { return signal?.aborted ?? false; },
    };
}

/**
 * The Gateway and Stream Edge. Each job creation names the next job
 * (``job-1``, ``job-2``…) with a stream URL of its own; each stream request
 * opens a {@link Connection} the test drives.
 */
function stubGateway({ answerStatus }: { answerStatus?: (n: number) => number } = {}) {
    let jobs = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === `${GATEWAY_URL}/v1/user/jobs`) {
            jobs += 1;
            const job = `job-${jobs}`;
            return {
                ok: true,
                status: 201,
                json: async () => ({ data: { job: { uuid: job, stream_url: `${STREAM_URL}?job=${job}` } } }),
            };
        }
        if (url.startsWith(STREAM_URL)) {
            const headers = (init?.headers ?? {}) as Record<string, string>;
            const connection = openConnection(url, headers['Last-Event-ID'] ?? null, init?.signal ?? null);
            connections.push(connection);
            return { ok: true, status: 200, body: connection.body };
        }
        if (url.endsWith('/tool-results')) {
            posts.push({ url, body: JSON.parse(String(init?.body)) });
            const status = answerStatus?.(posts.length) ?? 202;
            return { ok: status >= 200 && status < 300, status };
        }
        throw new Error(`unexpected request to ${url}`);
    }));
}

const toolResultsUrl = (job: string) => `${GATEWAY_URL}/v1/user/tools/jobs/${job}/tool-results`;

/** Let every promise in flight settle, and move the clock on by ``ms``. */
async function advance(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(0);
}

function tools(): Record<string, ToolConfig> {
    return {
        list_assets: {
            run: vi.fn(() => ({ rows: [] })),
            definition: { description: 'List assets.', input_schema: schema, skills: ['manage_assets'] },
        },
        validate_checklist: {
            run: vi.fn(() => ({ is_valid: true })),
            definition: { description: 'Validate.', input_schema: schema, share_with_sub_agents: true },
        },
        read_page_context: { run: vi.fn(() => ({ page: 'Assets' })) },
        generate_checklist: { preview: vi.fn() },
    };
}

const SKILLS: ClientSkillDefinition[] = [
    { slug: 'manage_assets', name: 'Manage assets', description: 'Assets.', instructions: 'List first.' },
];

function client(options: { agentId?: string; registry?: Record<string, ToolConfig> } = {}): GatewayStreamClient {
    const instance = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL, agentId: options.agentId });
    instance.setTools(options.registry ?? tools());
    instance.setSkills(SKILLS);
    return instance;
}

/**
 * Send a message in ``conversationId`` and wait for its stream to open. The
 * send is left running, as it is while a turn is in progress; it settles when
 * the conversation is parked.
 */
async function startTurn(
    instance: GatewayStreamClient,
    conversationId: string,
    onEvent: (event: any) => void = () => {},
): Promise<{ connection: Connection; settled: Promise<void> }> {
    instance.setConversationId(conversationId);
    const before = connections.length;
    const settled = instance.sendMessage('hello', onEvent, () => {}, () => {});
    await advance();
    expect(connections).toHaveLength(before + 1);
    return { connection: connections[before], settled };
}

/**
 * A tab that was reading conv-1's turn when it reloaded. ``stored`` is what
 * the stored turn says about host requests; ``{}`` is a turn stored by 3.x.
 */
function reloadedClient(stored: { hostCatalogue?: boolean } = { hostCatalogue: true }): GatewayStreamClient {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        conversationId: 'conv-1',
        liveTurns: {
            'conv-1': { jobId: JOB, streamUrl: `${STREAM_URL}?job=${JOB}`, openedAtMs: Date.now(), ...stored },
        },
    }));
    return client();
}

/** Fake ``Date`` as well, for a test about the stream token's lifetime. */
function fakeTheClockToo(): void {
    // Re-installing over the fakes beforeEach set up does not add ``Date``.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
}

beforeEach(() => {
    sessionStorage.clear();
    posts = [];
    connections = [];
    frameId = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('a parked conversation keeps answering host requests', () => {
    it('reads on from where the foreground reader stopped, and answers to the job', async () => {
        stubGateway();
        const instance = client();
        const onEvent = vi.fn();
        const { connection, settled } = await startTurn(instance, 'conv-1', onEvent);
        connection.send(token('Looking'));
        await advance();
        expect(onEvent).toHaveBeenCalled();

        instance.parkStream('conv-1');
        await settled;
        await advance();

        expect(connection.aborted).toBe(true);
        expect(connections).toHaveLength(2);
        const parked = connections[1];
        expect(parked.lastEventId).toBe('1-0');
        expect(parked.aborted).toBe(false);

        const forwarded = onEvent.mock.calls.length;
        parked.send(hostRequest('step-search', { op: 'catalogue' }));
        await advance(1000);

        expect(posts).toHaveLength(1);
        expect(posts[0].url).toBe(toolResultsUrl(JOB));
        expect(posts[0].body.step_uuid).toBe('step-search');
        expect(posts[0].body.tool_output.tools.map((tool: any) => tool.name)).toEqual(['list_assets', 'validate_checklist']);
        expect(onEvent).toHaveBeenCalledTimes(forwarded);
    });

    it('starts on "New chat" too, which parks every conversation', async () => {
        stubGateway();
        const instance = client();
        const { settled } = await startTurn(instance, 'conv-1');

        instance.reset();
        await settled;
        await advance();

        expect(connections).toHaveLength(2);
        connections[1].send(hostRequest('step-load', { op: 'definitions', names: ['list_assets'] }));
        await advance(1000);

        expect(posts).toHaveLength(1);
        expect(posts[0].body.tool_output.tools.map((tool: any) => tool.name)).toEqual(['list_assets']);
    });

    it('answers a delegated child announced while parked, to the child', async () => {
        stubGateway();
        const instance = client();
        const { settled } = await startTurn(instance, 'conv-1');
        instance.parkStream('conv-1');
        await settled;
        await advance();

        const parked = connections[1];
        parked.send(frame('sub_agent_started', { step_uuid: 'step-delegate', child_job_uuid: 'child-1', agent_name: 'Builder' }));
        parked.send(hostRequest('bootstrap-1', { op: 'all_definitions', shared_only: true }, 'child-1'));
        await advance(1000);

        expect(posts).toHaveLength(1);
        expect(posts[0].url).toBe(toolResultsUrl('child-1'));
        expect(posts[0].body.tool_output).toEqual({
            tools: [{
                name: 'validate_checklist',
                description: 'Validate.',
                input_schema: schema,
                requires_approval: false,
                share_with_sub_agents: true,
                skills: [],
                loads_with: [],
            }],
        });
    });

    it('leaves another turn\'s requests alone', async () => {
        stubGateway();
        const instance = client();
        const { settled } = await startTurn(instance, 'conv-1');
        instance.parkStream('conv-1');
        await settled;
        await advance();

        connections[1].send(hostRequest('step-other', { op: 'catalogue' }, 'job-from-another-tab'));
        await advance(2000);

        expect(posts).toHaveLength(0);
    });

    it('runs no client tool, opens no preview and forwards nothing — those wait for the user to come back', async () => {
        stubGateway();
        const registry = tools();
        const instance = client({ registry });
        const onEvent = vi.fn();
        const { settled } = await startTurn(instance, 'conv-1', onEvent);
        instance.parkStream('conv-1');
        await settled;
        await advance();
        const forwarded = onEvent.mock.calls.length;

        const parked = connections[1];
        const result = frame('tool_result', {
            step_uuid: 'step-gen', tool_slug: 'generate_checklist', status: 'completed', tool_output: '{"title":"T"}',
        });
        const call = frame('client_tool_call', { step_uuid: 'step-read', tool_slug: 'read_page_context', tool_input: { scope: 'page' } });
        parked.send(result);
        parked.send(call);
        await advance(2000);

        expect((registry.read_page_context as any).run).not.toHaveBeenCalled();
        expect((registry.generate_checklist as any).preview).not.toHaveBeenCalled();
        expect(posts).toHaveLength(0);
        expect(onEvent).toHaveBeenCalledTimes(forwarded);

        // Coming back replays the turn, and the call the parked reader left
        // alone is still asked: it was never marked settled.
        void instance.resumeStream('conv-1', () => {}, () => {});
        await advance();
        expect(parked.aborted).toBe(true);
        const replay = connections[2];
        expect(replay.lastEventId).toBeNull();
        replay.send(result);
        replay.send(call);
        await advance(1000);

        expect((registry.generate_checklist as any).preview).toHaveBeenCalledTimes(1);
        expect((registry.read_page_context as any).run).toHaveBeenCalledTimes(1);
        expect(posts).toHaveLength(1);
        expect(posts[0].body).toEqual({ step_uuid: 'step-read', status: 'completed', tool_output: { page: 'Assets' } });
        instance.parkStream('conv-1');
    });

    it('is not asked again by the replay for a request it answered', async () => {
        stubGateway();
        const instance = client();
        const { settled } = await startTurn(instance, 'conv-1');
        instance.parkStream('conv-1');
        await settled;
        await advance();
        // A start-up fetch: no result frame will ever say it was answered.
        connections[1].send(hostRequest('bootstrap-1', { op: 'all_definitions', shared_only: false }));
        await advance(1000);
        expect(posts).toHaveLength(1);

        void instance.resumeStream('conv-1', () => {}, () => {});
        await advance();
        connections[2].send(hostRequest('bootstrap-1', { op: 'all_definitions', shared_only: false }));
        await advance(2000);

        expect(posts).toHaveLength(1);
        instance.parkStream('conv-1');
    });

    it('stops at the turn\'s end and keeps the credential for the way back', async () => {
        stubGateway();
        const instance = client();
        const { settled } = await startTurn(instance, 'conv-1');
        instance.parkStream('conv-1');
        await settled;
        await advance();

        connections[1].send(token('Done.'));
        connections[1].send(end());
        await advance();

        expect(connections[1].aborted).toBe(true);
        expect(instance.hasLiveTurn('conv-1')).toBe(true);
        expect(instance.getLiveJobId('conv-1')).toBe(JOB);

        const onEvent = vi.fn();
        const resumed = instance.resumeStream('conv-1', onEvent, () => {});
        await advance();
        expect(connections).toHaveLength(3);
        expect(connections[2].lastEventId).toBeNull();
        connections[2].send(token('Done.'));
        connections[2].send(end());
        await advance();

        await expect(resumed).resolves.toBe('completed');
        expect(onEvent.mock.calls.map(([event]) => event.data.content)).toContain('Done.');
        expect(instance.hasLiveTurn('conv-1')).toBe(false);
    });

    it('is not opened for a turn sent to an agent, which never sends host requests', async () => {
        stubGateway();
        const instance = client({ agentId: 'agent-1' });
        const { settled } = await startTurn(instance, 'conv-1');

        instance.parkStream('conv-1');
        await settled;
        await advance();

        expect(connections).toHaveLength(1);
    });

    it('is not opened by parking a conversation that is already parked', async () => {
        stubGateway();
        const instance = client();
        const { settled } = await startTurn(instance, 'conv-1');
        instance.parkStream('conv-1');
        await settled;
        await advance();

        instance.parkStream('conv-1');
        instance.reset();
        await advance();

        expect(connections).toHaveLength(2);
        expect(connections[1].aborted).toBe(false);
    });

    it('keeps at most three, stopping the longest-parked', async () => {
        stubGateway();
        const instance = client();
        for (const conversationId of ['conv-a', 'conv-b', 'conv-c', 'conv-d']) {
            const { settled } = await startTurn(instance, conversationId);
            instance.parkStream(conversationId);
            await settled;
            await advance();
        }

        // Foreground and parked reader per conversation, in that order.
        const parked = [connections[1], connections[3], connections[5], connections[7]];
        expect(parked.map(connection => connection.url)).toEqual(
            ['job-1', 'job-2', 'job-3', 'job-4'].map(job => `${STREAM_URL}?job=${job}`),
        );
        expect(parked.map(connection => connection.aborted)).toEqual([true, false, false, false]);
    });

    it('stops once the stream token\'s lifetime is up', async () => {
        fakeTheClockToo();
        stubGateway();
        const instance = client();
        const { settled } = await startTurn(instance, 'conv-1');
        instance.parkStream('conv-1');
        await settled;
        await advance();

        vi.setSystemTime(Date.now() + TOKEN_TTL_MS);
        connections[1].raw(': ping\n\n');
        await advance();
        expect(connections[1].aborted).toBe(true);

        connections[1].send(hostRequest('step-late', { op: 'catalogue' }));
        await advance(2000);
        expect(posts).toHaveLength(0);
    });

    it('is not opened for a turn whose token has already expired', async () => {
        fakeTheClockToo();
        stubGateway();
        const instance = client();
        const { settled } = await startTurn(instance, 'conv-1');

        vi.setSystemTime(Date.now() + TOKEN_TTL_MS);
        instance.parkStream('conv-1');
        await settled;
        await advance();

        expect(connections).toHaveLength(1);
    });

    it('is not opened for a turn whose resumed stream turned out to be empty', async () => {
        stubGateway();
        const instance = reloadedClient();
        const resumed = instance.resumeStream('conv-1', () => {}, () => {});
        await advance(20000);
        await expect(resumed).resolves.toBe('stalled');

        instance.parkStream('conv-1');
        await advance();

        expect(connections).toHaveLength(1);
    });

    it('takes over from the frame before one whose data had not arrived', async () => {
        stubGateway();
        const instance = client();
        const { connection, settled } = await startTurn(instance, 'conv-1');
        // Frame 7 whole; frame 8's ``id:`` line only — the read ended there.
        connection.raw(`id: 7-0\ndata: ${JSON.stringify(token('Looking'))}\n\nid: 8-0\n`);
        await advance();

        instance.parkStream('conv-1');
        await settled;
        await advance();

        expect(connections[1].lastEventId).toBe('7-0');
    });

    it('keeps the clock of a host request held when the user left', async () => {
        stubGateway();
        const instance = reloadedClient();
        void instance.resumeStream('conv-1', () => {}, () => {});
        await advance();
        connections[0].send(hostRequest('bootstrap-1', { op: 'all_definitions', shared_only: false }));
        await advance(500);
        expect(posts).toHaveLength(0);

        instance.parkStream('conv-1');
        await advance(500);

        expect(posts).toHaveLength(1);
        expect(posts[0].body.step_uuid).toBe('bootstrap-1');
        // The parked reader took over after the request, not before it.
        expect(connections[1].lastEventId).toBe('1-0');
    });
});

describe('whether a turn may send host requests survives a reload', () => {
    it('is stored with the turn', async () => {
        stubGateway();
        const central = client();
        await startTurn(central, 'conv-central');
        const bound = client({ agentId: 'agent-1' });
        await startTurn(bound, 'conv-bound');

        const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}');
        expect(stored.liveTurns['conv-central'].hostCatalogue).toBe(true);
        expect(stored.liveTurns['conv-bound'].hostCatalogue).toBe(false);
        central.parkStream('conv-central');
        bound.parkStream('conv-bound');
    });

    it('gives a resumed turn a parked reader when it is parked again', async () => {
        stubGateway();
        const instance = reloadedClient({ hostCatalogue: true });
        void instance.resumeStream('conv-1', () => {}, () => {});
        await advance();

        instance.parkStream('conv-1');
        await advance();

        expect(connections).toHaveLength(2);
        expect(connections[1].aborted).toBe(false);
    });

    it('reads a turn stored without the field (3.x) as one that never asks', async () => {
        stubGateway();
        const instance = reloadedClient({});
        void instance.resumeStream('conv-1', () => {}, () => {});
        await advance();

        instance.parkStream('conv-1');
        await advance();

        expect(connections).toHaveLength(1);
    });
});

describe('host requests on a resumed read have a clock of their own', () => {
    it('are answered within a second while other jobs keep streaming', async () => {
        stubGateway();
        const instance = reloadedClient();
        void instance.resumeStream('conv-1', () => {}, () => {});
        await advance();
        const stream = connections[0];
        stream.send(frame('sub_agent_started', { step_uuid: 's-a', child_job_uuid: 'child-a', agent_name: 'Writer' }));
        stream.send(frame('sub_agent_started', { step_uuid: 's-b', child_job_uuid: 'child-b', agent_name: 'Builder' }));
        stream.send(hostRequest('bootstrap-b', { op: 'all_definitions', shared_only: true }, 'child-b'));

        // child-a writes its answer, a token every 200 ms, for three seconds.
        let answeredAtMs: number | null = null;
        for (let elapsed = 200; elapsed <= 3000; elapsed += 200) {
            await advance(200);
            stream.send(token('…', 'child-a'));
            if (answeredAtMs === null && posts.length > 0) answeredAtMs = elapsed;
        }

        expect(answeredAtMs).toBe(1000);
        expect(posts).toHaveLength(1);
        expect(posts[0].url).toBe(toolResultsUrl('child-b'));
        instance.parkStream('conv-1');
    });

    it('are still dropped by the meta-tool\'s result when it follows within the second', async () => {
        stubGateway();
        const instance = reloadedClient();
        void instance.resumeStream('conv-1', () => {}, () => {});
        await advance();
        const stream = connections[0];
        stream.send(frame('tool_request', { step_uuid: 'step-load', tool_slug: 'load_tool', dispatch_mode: 'harness' }));
        stream.send(hostRequest('step-load', { op: 'definitions', names: ['list_assets'] }));
        await advance(600);
        stream.send(frame('tool_result', { step_uuid: 'step-load', tool_slug: 'load_tool', status: 'completed', tool_output: '{}' }));
        await advance(2000);

        expect(posts).toHaveLength(0);
        instance.parkStream('conv-1');
    });

    it('are answered once even if the frame is seen twice', async () => {
        stubGateway();
        const instance = reloadedClient();
        void instance.resumeStream('conv-1', () => {}, () => {});
        await advance();
        connections[0].send(hostRequest('bootstrap-1', { op: 'all_definitions', shared_only: false }));
        await advance(600);
        connections[0].send(hostRequest('bootstrap-1', { op: 'all_definitions', shared_only: false }));
        await advance(400);

        expect(posts).toHaveLength(1);
        await advance(2000);
        expect(posts).toHaveLength(1);
        instance.parkStream('conv-1');
    });

    it('are not answered by a session that has been replaced', async () => {
        stubGateway();
        const instance = reloadedClient();
        void instance.resumeStream('conv-1', () => {}, () => {});
        await advance();
        connections[0].send(hostRequest('bootstrap-1', { op: 'all_definitions', shared_only: false }));
        await advance(500);

        // The user sends in the same conversation: a new turn, a new session.
        instance.setConversationId('conv-1');
        void instance.sendMessage('next', () => {}, () => {}, () => {});
        await advance(2000);

        expect(posts).toHaveLength(0);
        instance.parkStream('conv-1');
    });
});
