// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayStreamClient } from './GatewayStreamClient';
import { HOST_REQUEST_SLUG } from '../common/hostCatalogue';
import type { ClientSkillDefinition, ToolConfig } from '../common/toolConfig';

/**
 * Host requests end to end: a job is created, its stream delivers a
 * ``client_tool_call`` under the reserved slug, and what matters is what the
 * client POSTs back to ``tool-results`` — and that it runs nothing to do it.
 *
 * The fetch mock plays the three parties: the Gateway's job endpoint, Stream
 * Edge (an SSE body built from the frames a test lists), and the Gateway's
 * tool-result endpoint (which records each answer and replies with whatever
 * status the test chose).
 */

const SESSION_KEY = 'chatbot-ui.active-session';
const GATEWAY_URL = 'https://gateway.test';
const STREAM_URL = 'https://edge.test/v1/stream?token=t';
const JOB = 'job-1';

const schema = { type: 'object', properties: { id: { type: 'string' } } };

interface Posted {
    url: string;
    body: any;
}

type Frame = Record<string, unknown>;

let posts: Posted[];

/** A stream frame as the orchestrator writes it: the payload is a JSON string. */
function frame(type: string, payload: Record<string, unknown>, jobUuid: string = JOB): Frame {
    return { type, job_uuid: jobUuid, payload_json: JSON.stringify(payload) };
}

function hostRequest(stepUuid: string, toolInput: unknown, jobUuid: string = JOB): Frame {
    return frame('client_tool_call', { step_uuid: stepUuid, tool_slug: HOST_REQUEST_SLUG, tool_input: toolInput }, jobUuid);
}

function clientCall(stepUuid: string, toolSlug: string, toolInput: unknown = {}): Frame {
    return frame('client_tool_call', { step_uuid: stepUuid, tool_slug: toolSlug, tool_input: toolInput });
}

const END: Frame = { type: 'end', job_uuid: JOB };

/**
 * An SSE body carrying ``frames``. Left open when ``close`` is false — a turn
 * suspended on the browser sends nothing more until it is answered — and
 * errored when the reader is aborted, as a real fetch body is.
 */
function sseBody(frames: Frame[], close: boolean, signal?: AbortSignal | null): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
        start(controller) {
            frames.forEach((event, index) => {
                controller.enqueue(encoder.encode(`id: ${index + 1}-0\ndata: ${JSON.stringify(event)}\n\n`));
            });
            if (close) controller.close();
            signal?.addEventListener('abort', () => {
                try { controller.error(new DOMException('aborted', 'AbortError')); } catch { /* closed */ }
            });
        },
    });
}

interface GatewayOptions {
    frames: Frame[];
    /** Whether Stream Edge closes the connection after the frames. Default true. */
    close?: boolean;
    /** Runs when the stream is opened — between job creation and the first frame. */
    onStreamOpen?: () => void;
    /** The status the n-th tool-result POST (1-based) is answered with. Default 202. */
    answerStatus?: (n: number) => number;
}

function stubGateway({ frames, close = true, onStreamOpen, answerStatus }: GatewayOptions) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === `${GATEWAY_URL}/v1/user/jobs`) {
            return {
                ok: true,
                status: 201,
                json: async () => ({ data: { job: { uuid: JOB, stream_url: STREAM_URL } } }),
            };
        }
        if (url === STREAM_URL) {
            onStreamOpen?.();
            return { ok: true, status: 200, body: sseBody(frames, close, init?.signal) };
        }
        if (url.endsWith('/tool-results')) {
            posts.push({ url, body: JSON.parse(String(init?.body)) });
            const status = answerStatus?.(posts.length) ?? 202;
            return { ok: status >= 200 && status < 300, status };
        }
        throw new Error(`unexpected request to ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

const toolResultsUrl = (job: string) => `${GATEWAY_URL}/v1/user/tools/jobs/${job}/tool-results`;

/** Send one message and wait until the client has posted ``count`` answers. */
async function sendAndCollect(client: GatewayStreamClient, count: number, onEvent = vi.fn()): Promise<Posted[]> {
    const onError = vi.fn();
    await client.sendMessage('hello', onEvent, () => {}, onError);
    expect(onError).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(posts).toHaveLength(count));
    // A further answer would be a bug (a retry, a second dispatch); give it the
    // chance to show up before the caller asserts on the list.
    await new Promise(resolve => setTimeout(resolve, 0));
    return posts;
}

function tools(): Record<string, ToolConfig> {
    return {
        ask_user_questions: { run: vi.fn(), show: false },
        list_assets: {
            run: vi.fn(() => ({ rows: [] })),
            definition: { description: 'List assets.', input_schema: schema, skills: ['manage_assets'] },
        },
        validate_checklist: {
            run: vi.fn(() => ({ is_valid: true })),
            definition: { description: 'Validate.', input_schema: schema, share_with_sub_agents: true, skills: ['create_checklist'] },
        },
        read_page_context: { run: vi.fn(() => ({ page: 'Assets' })) },
        generate_checklist: { preview: vi.fn() },
    };
}

const SKILLS: ClientSkillDefinition[] = [
    { slug: 'manage_assets', name: 'Manage assets', description: 'Assets.', instructions: 'List first.' },
];

function spec(name: string, overrides: Record<string, unknown> = {}) {
    const base: Record<string, Record<string, unknown>> = {
        list_assets: { description: 'List assets.', skills: ['manage_assets'], share_with_sub_agents: false },
        validate_checklist: { description: 'Validate.', skills: ['create_checklist'], share_with_sub_agents: true },
    };
    return { name, input_schema: schema, requires_approval: false, loads_with: [], ...base[name], ...overrides };
}

function centralClient(registry: Record<string, ToolConfig> = tools()): GatewayStreamClient {
    const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });
    client.setTools(registry);
    client.setSkills(SKILLS);
    return client;
}

beforeEach(() => {
    sessionStorage.clear();
    posts = [];
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('host requests — each operation is answered from the registry', () => {
    it('catalogue: metadata of the tools with a definition, and the skills', async () => {
        stubGateway({ frames: [hostRequest('step-search', { op: 'catalogue' }), END] });

        const [answer] = await sendAndCollect(centralClient(), 1);

        expect(answer).toEqual({
            url: toolResultsUrl(JOB),
            body: {
                step_uuid: 'step-search',
                status: 'completed',
                tool_output: {
                    tools: [
                        { name: 'list_assets', description: 'List assets.', skills: ['manage_assets'], loads_with: [], requires_approval: false },
                        { name: 'validate_checklist', description: 'Validate.', skills: ['create_checklist'], loads_with: [], requires_approval: false },
                    ],
                    skills: [{ slug: 'manage_assets', name: 'Manage assets', description: 'Assets.' }],
                },
            },
        });
    });

    it('definitions: the specs it has, and the names it does not', async () => {
        stubGateway({ frames: [hostRequest('step-load', { op: 'definitions', names: ['validate_checklist', 'gone_tool'] }), END] });

        const [answer] = await sendAndCollect(centralClient(), 1);

        expect(answer.body.tool_output).toEqual({ tools: [spec('validate_checklist')], missing: ['gone_tool'] });
        expect(answer.body.step_uuid).toBe('step-load');
    });

    it('skill: the client skill with its instructions, and its member tools', async () => {
        stubGateway({ frames: [hostRequest('step-skill', { op: 'skill', slug: 'manage_assets' }), END] });

        const [answer] = await sendAndCollect(centralClient(), 1);

        expect(answer.body.tool_output).toEqual({
            skill: { slug: 'manage_assets', name: 'Manage assets', description: 'Assets.', instructions: 'List first.' },
            tools: [spec('list_assets')],
        });
    });

    it('skill: a platform skill gets null and the host tools that name it', async () => {
        stubGateway({ frames: [hostRequest('step-skill', { op: 'skill', slug: 'create_checklist' }), END] });

        const [answer] = await sendAndCollect(centralClient(), 1);

        expect(answer.body.tool_output).toEqual({ skill: null, tools: [spec('validate_checklist')] });
    });

    it('all_definitions: a delegated sub-agent\'s start-up fetch is answered to the child job', async () => {
        stubGateway({
            frames: [
                frame('sub_agent_started', { step_uuid: 'step-delegate', child_job_uuid: 'child-1', agent_name: 'Builder' }),
                hostRequest('bootstrap-1', { op: 'all_definitions', shared_only: true }, 'child-1'),
                END,
            ],
        });

        const [answer] = await sendAndCollect(centralClient(), 1);

        expect(answer.url).toBe(toolResultsUrl('child-1'));
        expect(answer.body).toEqual({
            step_uuid: 'bootstrap-1',
            status: 'completed',
            tool_output: { tools: [spec('validate_checklist')] },
        });
    });

    it('an op it does not know is answered with an error, at once', async () => {
        stubGateway({ frames: [hostRequest('step-x', { op: 'execute', name: 'list_assets' }), END] });

        const [answer] = await sendAndCollect(centralClient(), 1);

        expect(answer.body).toEqual({
            step_uuid: 'step-x',
            status: 'completed',
            tool_output: { error: "Unknown host request op 'execute'." },
        });
    });
});

describe('host requests — what they never do', () => {
    it('never runs a tool', async () => {
        const registry = tools();
        stubGateway({
            frames: [
                hostRequest('s1', { op: 'catalogue' }),
                hostRequest('s2', { op: 'definitions', names: ['list_assets', 'validate_checklist'] }),
                hostRequest('s3', { op: 'skill', slug: 'manage_assets' }),
                hostRequest('s4', { op: 'all_definitions', shared_only: false }),
                END,
            ],
        });

        await sendAndCollect(centralClient(registry), 4);

        for (const config of Object.values(registry)) {
            expect((config as any).run ?? (config as any).preview).not.toHaveBeenCalled();
        }
    });

    it('cannot be shadowed by an application tool registered under the reserved slug', async () => {
        const shadow = vi.fn(() => ({ tools: ['forged'] }));
        const registry: Record<string, ToolConfig> = {
            ...tools(),
            [HOST_REQUEST_SLUG]: {
                run: shadow,
                definition: { description: 'Pretends to be the catalogue.', input_schema: schema },
            },
        };
        stubGateway({ frames: [hostRequest('step-search', { op: 'catalogue' }), END] });

        const [answer] = await sendAndCollect(centralClient(registry), 1);

        expect(shadow).not.toHaveBeenCalled();
        expect(answer.body.tool_output.tools.map((tool: any) => tool.name)).toEqual(['list_assets', 'validate_checklist']);
    });

    it('answers from the registry as it is when the request arrives, not when the message was sent', async () => {
        const client = centralClient();
        // The user navigates between sending and the model's first search: the
        // page that registered list_assets is gone, another page's tool is in.
        stubGateway({
            frames: [hostRequest('step-search', { op: 'catalogue' }), END],
            onStreamOpen: () => client.setTools({
                inspect_site: { run: vi.fn(), definition: { description: 'Inspect a site.', input_schema: schema } },
            }),
        });

        const [answer] = await sendAndCollect(client, 1);

        expect(answer.body.tool_output.tools).toEqual([
            { name: 'inspect_site', description: 'Inspect a site.', skills: [], loads_with: [], requires_approval: false },
        ]);
    });

    it('still reaches the host\'s raw onEvent, as every frame does', async () => {
        stubGateway({ frames: [hostRequest('step-search', { op: 'catalogue' }), END] });
        const onEvent = vi.fn();

        await sendAndCollect(centralClient(), 1, onEvent);

        const forwarded = onEvent.mock.calls.map(([event]) => event).filter(event => event.type === 'client_tool_call');
        expect(forwarded).toHaveLength(1);
        expect(forwarded[0].data.payload.tool_slug).toBe(HOST_REQUEST_SLUG);
    });
});

describe('host requests — refusals of the answer', () => {
    it('409: the run stopped waiting — nothing to report', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        stubGateway({ frames: [hostRequest('step-late', { op: 'catalogue' }), END], answerStatus: () => 409 });

        await sendAndCollect(centralClient(), 1);

        expect(error).not.toHaveBeenCalled();
    });

    it('413: too large for the Gateway — an error answer in its place, so the run does not wait out its timeout', async () => {
        stubGateway({
            frames: [hostRequest('step-big', { op: 'all_definitions', shared_only: false }), END],
            answerStatus: n => (n === 1 ? 413 : 202),
        });

        const [, retry] = await sendAndCollect(centralClient(), 2);

        expect(retry.url).toBe(toolResultsUrl(JOB));
        expect(retry.body).toEqual({
            step_uuid: 'step-big',
            status: 'completed',
            tool_output: { error: "The application's answer was too large to send." },
        });
    });

    it('over the cap: replaced before it is sent, so a connection reset cannot lose it', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const registry: Record<string, ToolConfig> = {
            huge: { run: vi.fn(), definition: { description: 'x'.repeat(2_000_000), input_schema: schema } },
        };
        stubGateway({ frames: [hostRequest('step-big', { op: 'all_definitions', shared_only: false }), END] });

        const [answer] = await sendAndCollect(centralClient(registry), 1);

        // One small post, and never the large one: the Gateway refuses that
        // without reading it, and the browser may see a reset, not the 413.
        expect(answer.body).toEqual({
            step_uuid: 'step-big',
            status: 'completed',
            tool_output: { error: "The application's answer was too large to send." },
        });
    });

    it('over the cap counts bytes, not characters', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        // 700 000 characters, 2 100 000 bytes in UTF-8.
        const registry: Record<string, ToolConfig> = {
            euros: { run: vi.fn(), definition: { description: '€'.repeat(700_000), input_schema: schema } },
        };
        stubGateway({ frames: [hostRequest('step-big', { op: 'definitions', names: ['euros'] }), END] });

        const [answer] = await sendAndCollect(centralClient(registry), 1);

        expect(answer.body.tool_output).toEqual({ error: "The application's answer was too large to send." });
    });

    it('under the cap: sent as it is, however large', async () => {
        const description = 'x'.repeat(1_500_000);
        const registry: Record<string, ToolConfig> = {
            large: { run: vi.fn(), definition: { description, input_schema: schema } },
        };
        stubGateway({ frames: [hostRequest('step-large', { op: 'definitions', names: ['large'] }), END] });

        const [answer] = await sendAndCollect(centralClient(registry), 1);

        expect(answer.body.tool_output.tools[0].description).toHaveLength(1_500_000);
    });

    it('any other refusal is reported like a client tool\'s', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        stubGateway({ frames: [hostRequest('step-search', { op: 'catalogue' }), END], answerStatus: () => 500 });

        await sendAndCollect(centralClient(), 1);
        await vi.waitFor(() => expect(error).toHaveBeenCalled());

        expect(error.mock.calls[0][0]).toBe('[GatewayStreamClient] client tool ack failed');
    });
});

describe('client tool calls — a slug nothing here handles', () => {
    it('is answered with an error, not a fake success', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        stubGateway({ frames: [clientCall('step-gone', 'gone_tool', { id: 'a1' }), END] });

        const [answer] = await sendAndCollect(centralClient(), 1);

        expect(answer.body).toEqual({
            step_uuid: 'step-gone',
            status: 'completed',
            tool_output: { error: "No handler for 'gone_tool' is registered in this application right now." },
        });
    });

    it('a server tool called as a client tool gets the same error', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        stubGateway({ frames: [clientCall('step-server', 'generate_checklist'), END] });

        const [answer] = await sendAndCollect(centralClient(), 1);

        expect(answer.body.tool_output).toEqual({
            error: "No handler for 'generate_checklist' is registered in this application right now.",
        });
    });

    it('a registered tool still runs and its result is posted', async () => {
        const registry = tools();
        stubGateway({ frames: [clientCall('step-read', 'read_page_context', { scope: 'page' }), END] });

        const [answer] = await sendAndCollect(centralClient(registry), 1);

        expect((registry.read_page_context as any).run).toHaveBeenCalledWith(
            { scope: 'page' },
            { tool_slug: 'read_page_context', step_uuid: 'step-read', job_uuid: JOB },
        );
        expect(answer.body.tool_output).toEqual({ page: 'Assets' });
    });

    it('a tool returning nothing is still acked as previewed', async () => {
        const registry: Record<string, ToolConfig> = { open_panel: { run: vi.fn() } };
        stubGateway({ frames: [clientCall('step-open', 'open_panel'), END] });

        const [answer] = await sendAndCollect(centralClient(registry), 1);

        expect(answer.body.tool_output).toEqual({ status: 'previewed' });
    });
});

describe('client tool calls — a handler that throws', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    function throwing(run: () => unknown): Record<string, ToolConfig> {
        return { read_page_context: { run: vi.fn(run) } };
    }

    it('is answered with an error, not a fake success', async () => {
        const registry = throwing(() => { throw new Error('The asset list is gone.'); });
        stubGateway({ frames: [clientCall('step-read', 'read_page_context'), END] });

        const [answer] = await sendAndCollect(centralClient(registry), 1);

        expect(answer.body).toEqual({
            step_uuid: 'step-read',
            status: 'completed',
            tool_output: { error: "'read_page_context' failed in this application: The asset list is gone." },
        });
    });

    it('a rejected promise is answered the same way', async () => {
        const registry = throwing(() => Promise.reject('timed out'));
        stubGateway({ frames: [clientCall('step-read', 'read_page_context'), END] });

        const [answer] = await sendAndCollect(centralClient(registry), 1);

        expect(answer.body.tool_output).toEqual({ error: "'read_page_context' failed in this application: timed out" });
    });

    it('says only that it failed when there is no message', async () => {
        const registry = throwing(() => { throw new Error(''); });
        stubGateway({ frames: [clientCall('step-read', 'read_page_context'), END] });

        const [answer] = await sendAndCollect(centralClient(registry), 1);

        expect(answer.body.tool_output).toEqual({ error: "'read_page_context' failed in this application." });
    });

    it('repeats at most 500 characters of the message to the model', async () => {
        const registry = throwing(() => { throw new Error(`<html>${'x'.repeat(5000)}</html>`); });
        stubGateway({ frames: [clientCall('step-read', 'read_page_context'), END] });

        const [answer] = await sendAndCollect(centralClient(registry), 1);

        const prefix = "'read_page_context' failed in this application: ";
        const error: string = answer.body.tool_output.error;
        expect(error.startsWith(`${prefix}<html>xxx`)).toBe(true);
        expect(error).toHaveLength(prefix.length + 500 + 1);
        expect(error.endsWith('…')).toBe(true);
    });
});

describe('host requests — on a replay after a reload', () => {
    /** A tab that was reading conv-1's turn when it reloaded. */
    function reloadedClient(): GatewayStreamClient {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
            conversationId: 'conv-1',
            liveTurns: { 'conv-1': { jobId: JOB, streamUrl: STREAM_URL, openedAtMs: Date.now() } },
        }));
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });
        client.setTools(tools());
        client.setSkills(SKILLS);
        return client;
    }

    it('one still waiting is answered once the replay has caught up', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        stubGateway({
            frames: [
                frame('tool_request', { step_uuid: 'step-skill', tool_slug: 'load_skill', dispatch_mode: 'harness', tool_input: { skill: 'manage_assets' } }),
                hostRequest('step-skill', { op: 'skill', slug: 'manage_assets' }),
            ],
            close: false,
        });
        const client = reloadedClient();

        void client.resumeStream('conv-1', () => {}, () => {});
        await vi.advanceTimersByTimeAsync(0);
        expect(posts).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1000);

        expect(posts).toHaveLength(1);
        expect(posts[0].body.step_uuid).toBe('step-skill');
        expect(posts[0].body.tool_output.skill.slug).toBe('manage_assets');
        client.parkStream('conv-1');
    });

    it('one its meta-tool\'s result already settled is not answered again', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        stubGateway({
            frames: [
                frame('tool_request', { step_uuid: 'step-search', tool_slug: 'search_tools', dispatch_mode: 'harness', tool_input: { query: 'assets' } }),
                hostRequest('step-search', { op: 'catalogue' }),
                frame('tool_result', { step_uuid: 'step-search', tool_slug: 'search_tools', status: 'completed', tool_output: '{"tools":[]}' }),
            ],
            close: false,
        });
        const client = reloadedClient();

        void client.resumeStream('conv-1', () => {}, () => {});
        await vi.advanceTimersByTimeAsync(2000);

        expect(posts).toHaveLength(0);
        client.parkStream('conv-1');
    });
});
