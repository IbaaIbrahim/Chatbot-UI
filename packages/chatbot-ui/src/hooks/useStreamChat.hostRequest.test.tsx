// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useStreamChat } from './useStreamChat';
import { HOST_REQUEST_SLUG } from '../common/hostCatalogue';
import type { StreamChatClient, StreamEvent } from '../api/StreamClient';
import type { MessageStep } from '../components/MessageBubble/MessageBubble';

/**
 * What a turn's transcript shows for a host request: nothing of its own. The
 * meta-tool it serves already has a row (from ``tool_request``, under the same
 * step uuid), and a sub-agent's start-up fetch has none at all.
 *
 * Driven through the real hook with a client that replays a fixed list of
 * frames, shaped as `GatewayStreamClient` hands them to ``onEvent``.
 */

const JOB = 'job-1';

function event(type: string, payload: Record<string, unknown>, jobUuid: string = JOB): StreamEvent {
    return { type, data: { type, job_uuid: jobUuid, payload } };
}

function scriptedClient(frames: StreamEvent[]): StreamChatClient {
    return {
        async sendMessage(_text, onEvent, onComplete) {
            for (const frame of frames) onEvent(frame);
            onComplete();
        },
    };
}

type Hook = ReturnType<typeof useStreamChat>;

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
});

/** Mount the hook and return a getter for its latest result. */
function mount(client: StreamChatClient): () => Hook {
    let latest: Hook | null = null;
    const Probe: React.FC = () => {
        latest = useStreamChat({ client });
        return null;
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Probe />));
    return () => latest!;
}

async function sendTurn(frames: StreamEvent[]): Promise<MessageStep[]> {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const hook = mount(scriptedClient(frames));
    await act(async () => {
        await hook().sendMessage('hello');
    });
    const assistant = hook().messages.find(message => message.role === 'assistant');
    expect(assistant).toBeDefined();
    return assistant!.steps ?? [];
}

const allSteps = (steps: MessageStep[]): MessageStep[] =>
    steps.flatMap(step => [step, ...allSteps(step.subSteps ?? [])]);

describe('useStreamChat — host requests draw no row', () => {
    it('a meta-tool that asked the browser shows one row, settled by its result', async () => {
        const steps = await sendTurn([
            event('tool_request', {
                step_uuid: 'step-load', tool_slug: 'load_skill', dispatch_mode: 'harness',
                tool_input: { skill: 'manage_assets' },
            }),
            event('client_tool_call', {
                step_uuid: 'step-load', tool_slug: HOST_REQUEST_SLUG,
                tool_input: { op: 'skill', slug: 'manage_assets' },
            }),
            event('tool_result', {
                step_uuid: 'step-load', tool_slug: 'load_skill', status: 'completed',
                tool_output: JSON.stringify({
                    skill: { slug: 'manage_assets', name: 'Manage assets', source: 'host' },
                    instructions: '…', tools_loaded: ['list_assets'], tools_unavailable: [],
                }),
            }),
        ]);

        const toolRows = steps.filter(step => step.type === 'tool-call');
        expect(toolRows).toHaveLength(1);
        expect(toolRows[0]).toMatchObject({ id: 'step-load', toolSlug: 'load_skill', toolStatus: 'completed' });
        expect(allSteps(steps).some(step => step.toolSlug === HOST_REQUEST_SLUG)).toBe(false);
    });

    it('a sub-agent\'s start-up fetch shows nothing, in or out of its block', async () => {
        const steps = await sendTurn([
            event('sub_agent_started', { step_uuid: 'step-delegate', child_job_uuid: 'child-1', agent_name: 'Builder' }),
            event('client_tool_call', {
                step_uuid: 'bootstrap-1', tool_slug: HOST_REQUEST_SLUG,
                tool_input: { op: 'all_definitions', shared_only: true },
            }, 'child-1'),
        ]);

        const block = steps.find(step => step.type === 'sub-agent');
        expect(block).toBeDefined();
        expect(block!.subSteps).toEqual([]);
        expect(allSteps(steps).some(step => step.id === 'bootstrap-1')).toBe(false);
    });

    it('an ordinary client tool call still gets its row', async () => {
        const steps = await sendTurn([
            event('client_tool_call', { step_uuid: 'step-read', tool_slug: 'read_page_context', tool_input: {} }),
            event('client_tool_call', { step_uuid: 'step-ask', tool_slug: 'ask_user_questions', tool_input: { questions: [] } }),
        ]);

        expect(steps.filter(step => step.type === 'tool-call')).toEqual([
            expect.objectContaining({ id: 'step-read', toolSlug: 'read_page_context', toolStatus: 'completed' }),
            expect.objectContaining({ id: 'step-ask', toolSlug: 'ask_user_questions', toolStatus: 'running' }),
        ]);
    });
});
