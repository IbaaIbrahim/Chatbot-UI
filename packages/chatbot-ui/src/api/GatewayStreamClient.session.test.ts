// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayStreamClient } from './GatewayStreamClient';

const SESSION_KEY = 'chatbot-ui.active-session';
const GATEWAY_URL = 'https://gateway.test';

/**
 * The job POST is refused, so `sendMessage` stops right after it: what these
 * tests care about is the form it posted, not the stream that would follow.
 */
function refusingFetch() {
    return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
        ok: false,
        status: 500,
        headers: { get: () => null },
        text: async () => JSON.stringify({ message: 'stopped by the test' }),
    }));
}

let fetchMock: ReturnType<typeof refusingFetch>;

function storedSession(): Record<string, unknown> | null {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
}

async function postedForm(client: GatewayStreamClient): Promise<FormData> {
    const onError = vi.fn();
    await client.sendMessage('hello', () => {}, () => {}, onError);
    expect(onError).toHaveBeenCalledTimes(1);
    const jobPost = fetchMock.mock.calls.find(([input]) => String(input) === `${GATEWAY_URL}/v1/user/jobs`);
    expect(jobPost).toBeDefined();
    const body = jobPost![1]?.body;
    expect(body).toBeInstanceOf(FormData);
    return body as FormData;
}

beforeEach(() => {
    sessionStorage.clear();
    fetchMock = refusingFetch();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('GatewayStreamClient — the agent is not restored from the tab', () => {
    it('ignores an agentId persisted before 4.0, and keeps the conversation', () => {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
            conversationId: 'conv-1',
            agentId: 'legacy-agent',
            liveTurns: {},
        }));

        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });

        expect(client.getAgentId()).toBeNull();
        expect(client.getConversationId()).toBe('conv-1');
    });

    it('scrubs the legacy agentId on the next write', () => {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ conversationId: 'conv-1', agentId: 'legacy-agent' }));
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });

        client.setConversationId('conv-2');

        const stored = storedSession();
        expect(stored).not.toBeNull();
        expect(stored!.conversationId).toBe('conv-2');
        expect(stored).not.toHaveProperty('agentId');
    });

    it('does not send the legacy agent', async () => {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ conversationId: 'conv-1', agentId: 'legacy-agent' }));
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });

        const form = await postedForm(client);

        expect(form.has('agent_id')).toBe(false);
        expect(form.get('conversation_id')).toBe('conv-1');
    });

    it('never persists an agent it was given', async () => {
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL, agentId: 'agent-1' });
        client.setAgentId('agent-2');
        await postedForm(client);

        expect(storedSession()).not.toHaveProperty('agentId');
        // The next client in this tab — another screen's — starts without one.
        expect(new GatewayStreamClient({ gatewayUrl: GATEWAY_URL }).getAgentId()).toBeNull();
    });
});

describe('GatewayStreamClient — agent_id on the job', () => {
    it('posts config.agentId as agent_id', async () => {
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL, agentId: 'agent-1' });

        expect(client.getAgentId()).toBe('agent-1');
        const form = await postedForm(client);

        expect(form.get('agent_id')).toBe('agent-1');
    });

    it('posts the agent bound with setAgentId', async () => {
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });
        client.setAgentId('agent-2');

        const form = await postedForm(client);

        expect(form.get('agent_id')).toBe('agent-2');
    });

    it('sends no agent_id field without an agent (central mode)', async () => {
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });

        const form = await postedForm(client);

        expect(form.has('agent_id')).toBe(false);
        expect(form.get('prompt')).toBe('hello');
    });

    it('sends no agent_id field once the agent is cleared', async () => {
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL, agentId: 'agent-1' });
        client.setAgentId(null);

        const form = await postedForm(client);

        expect(form.has('agent_id')).toBe(false);
    });
});

describe('GatewayStreamClient — how the application\'s tools reach the platform', () => {
    const schema = { type: 'object', properties: {} };

    const hostTools = () => ({
        validate_checklist: {
            run: () => ({ is_valid: true }),
            definition: { description: 'Validate', input_schema: schema, share_with_sub_agents: true },
        },
        show_step_output: {
            run: () => ({ success: true }),
            definition: { description: 'Show', input_schema: schema },
        },
    });

    describe('central mode (no agent): the host catalogue', () => {
        it('announces host_catalogue and sends no definition (platform ADR-018)', async () => {
            const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });
            client.setTools(hostTools());
            client.setSkills([{ slug: 'manage_assets', name: 'Manage assets', description: 'Assets', instructions: 'Do it.' }]);

            const form = await postedForm(client);

            expect(form.get('host_catalogue')).toBe('true');
            expect(form.has('client_tools')).toBe(false);
            // Skills are never sent either: the platform asks for them.
            expect([...form.keys()].some(key => key.includes('skill'))).toBe(false);
            expect(form.has('agent_id')).toBe(false);
        });

        it('announces it with nothing registered: the browser still answers, with nothing', async () => {
            const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });

            const form = await postedForm(client);

            expect(form.getAll('host_catalogue')).toEqual(['true']);
            expect(form.has('client_tools')).toBe(false);
        });

        it('switches to it once the agent is cleared', async () => {
            const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL, agentId: 'agent-1' });
            client.setTools(hostTools());
            client.setAgentId(null);

            const form = await postedForm(client);

            expect(form.get('host_catalogue')).toBe('true');
            expect(form.has('client_tools')).toBe(false);
        });

        it('keeps announcing it on the 429 retry, which reuses the form', async () => {
            vi.useFakeTimers();
            try {
                let calls = 0;
                const retryAfter = (status: number, header: string | null) => ({
                    ok: false, status, headers: { get: () => header }, text: async () => '',
                });
                fetchMock = vi.fn(async () => {
                    calls += 1;
                    return calls === 1 ? retryAfter(429, '1') : retryAfter(500, null);
                }) as unknown as typeof fetchMock;
                vi.stubGlobal('fetch', fetchMock);
                const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });

                const sending = client.sendMessage('hello', () => {}, () => {}, () => {});
                await vi.advanceTimersByTimeAsync(1000);
                await sending;

                const bodies = fetchMock.mock.calls.map(([, init]) => init?.body as FormData);
                expect(bodies).toHaveLength(2);
                for (const body of bodies) {
                    expect(body.get('host_catalogue')).toBe('true');
                    expect(body.has('client_tools')).toBe(false);
                }
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('agent-bound: every definition on the job', () => {
        it('states for every tool whether a sub-agent may call it, and sends no host_catalogue', async () => {
            const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL, agentId: 'agent-1' });
            client.setTools(hostTools());

            const form = await postedForm(client);
            const sent = JSON.parse(String(form.get('client_tools')));

            expect(sent).toEqual([
                { name: 'validate_checklist', description: 'Validate', input_schema: schema, requires_approval: false, share_with_sub_agents: true, defer_loading: false, skills: [] },
                { name: 'show_step_output', description: 'Show', input_schema: schema, requires_approval: false, share_with_sub_agents: false, defer_loading: false, skills: [] },
            ]);
            expect(form.has('host_catalogue')).toBe(false);
        });

        it('still sends the deprecated defer_loading, and the skills, when set', async () => {
            const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });
            client.setAgentId('agent-2');
            client.setTools({
                list_assets: {
                    run: () => ({ rows: [] }),
                    definition: { description: 'List assets', input_schema: schema, defer_loading: true, skills: ['manage_assets'] },
                },
            });

            const form = await postedForm(client);
            const [sent] = JSON.parse(String(form.get('client_tools')));

            expect(sent).toEqual({
                name: 'list_assets', description: 'List assets', input_schema: schema,
                requires_approval: false, share_with_sub_agents: false, defer_loading: true, skills: ['manage_assets'],
            });
        });

        it('never sends a tool registered under the reserved host-request slug, which the Gateway would refuse', async () => {
            const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL, agentId: 'agent-1' });
            client.setTools({
                ...hostTools(),
                __host_request: {
                    run: () => ({}),
                    definition: { description: 'Not a tool', input_schema: schema },
                },
            });

            const form = await postedForm(client);
            const sent = JSON.parse(String(form.get('client_tools')));

            expect(sent.map((tool: { name: string }) => tool.name)).toEqual(['validate_checklist', 'show_step_output']);
        });

        it('sends neither field when no tool carries a definition', async () => {
            const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL, agentId: 'agent-1' });
            client.setTools({
                read_page_context: { run: () => ({}) },
                generate_checklist: { preview: () => {} },
            });

            const form = await postedForm(client);

            expect(form.has('client_tools')).toBe(false);
            expect(form.has('host_catalogue')).toBe(false);
        });
    });
});

describe('GatewayStreamClient — client skills', () => {
    it('setSkills replaces the list and keeps its own copy', () => {
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });
        const skills = [{ slug: 'a', name: 'A', description: 'a', instructions: 'a' }];

        client.setSkills(skills);
        skills.push({ slug: 'b', name: 'B', description: 'b', instructions: 'b' });

        expect(client.getSkills().map(skill => skill.slug)).toEqual(['a']);
        client.setSkills([]);
        expect(client.getSkills()).toEqual([]);
        client.setSkills(undefined as any);
        expect(client.getSkills()).toEqual([]);
    });
});

describe('GatewayStreamClient — host context on the job', () => {
    it('sends the facts a provider computes at the moment of sending', async () => {
        let page = 'Templates';
        const client = new GatewayStreamClient({
            gatewayUrl: GATEWAY_URL,
            hostContext: () => ({ 'Can manage checklist templates': false, 'Current page': page, 'Selected record': null }),
        });
        page = 'Template builder';

        const form = await postedForm(client);

        expect(JSON.parse(String(form.get('host_context')))).toEqual({
            'Can manage checklist templates': false,
            'Current page': 'Template builder',
        });
    });

    it('takes a plain object through setHostContext, and null clears it', async () => {
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });
        client.setHostContext({ Roles: ['Inspector', 'Auditor'] });
        expect(client.resolveHostContext()).toEqual({ Roles: ['Inspector', 'Auditor'] });

        client.setHostContext(null);
        const form = await postedForm(client);

        expect(form.has('host_context')).toBe(false);
    });

    it('sends no field when there is nothing to say', async () => {
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL, hostContext: () => ({ Empty: undefined }) });

        const form = await postedForm(client);

        expect(form.has('host_context')).toBe(false);
    });

    it('never holds a message back: a throwing provider sends the job without it', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const client = new GatewayStreamClient({
            gatewayUrl: GATEWAY_URL,
            hostContext: () => { throw new Error('ability not loaded'); },
        });

        const form = await postedForm(client);

        expect(form.has('host_context')).toBe(false);
        expect(form.get('prompt')).toBe('hello');
        error.mockRestore();
    });
});

describe('GatewayStreamClient — the block languages on the job', () => {
    // 2026-10-14: the platform indexes the blocks of the languages a turn was
    // sent with, so a drawn block is listed as "Not saved" until it is saved.
    it('sends the languages the page draws as a JSON array: valid, distinct, sorted', async () => {
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });
        client.setBlockLanguages(['table', 'chart', 'kpi', 'chart', 'Report', '1chart', 'x'.repeat(33), 'report']);

        const form = await postedForm(client);

        expect(JSON.parse(String(form.get('block_languages')))).toEqual(['chart', 'kpi', 'report', 'table']);
        expect(client.getBlockLanguages()).toEqual(['chart', 'kpi', 'report', 'table']);
    });

    it('takes them from the config too, and sends at most 16', async () => {
        const many = Array.from({ length: 20 }, (_, index) => `lang${String(index).padStart(2, '0')}`);
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL, blockLanguages: many });

        const form = await postedForm(client);

        expect(JSON.parse(String(form.get('block_languages')))).toEqual(many.slice(0, 16));
    });

    it('sends no field with none, or none valid', async () => {
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });
        expect((await postedForm(client)).has('block_languages')).toBe(false);

        client.setBlockLanguages(['Chart', '']);
        fetchMock.mockClear();
        expect((await postedForm(client)).has('block_languages')).toBe(false);

        client.setBlockLanguages(null);
        fetchMock.mockClear();
        expect((await postedForm(client)).has('block_languages')).toBe(false);
    });

    it('rides on an agent-bound job as on a central one', async () => {
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL, agentId: 'agent-1', blockLanguages: ['chart'] });

        const form = await postedForm(client);

        expect(form.get('agent_id')).toBe('agent-1');
        expect(form.get('block_languages')).toBe('["chart"]');
        expect(form.has('direct_tool_slug')).toBe(false);
    });
});
