// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useStreamChat } from './useStreamChat';
import { jobsToMessageProps } from './useConversations';
import type { StreamChatClient, StreamEvent } from '../api/StreamClient';
import type { ConversationJob } from '../api/types';

/**
 * Which turn a message belongs to (`MessageProps.jobUuid`), live and after a
 * reload — what a host saves a block's file against. Live, it is the first
 * frame's job that is not a sub-agent's; from history, the job's own uuid.
 */

function event(type: string, payload: Record<string, unknown>, jobUuid?: string): StreamEvent {
    return { type, data: { type, ...(jobUuid ? { job_uuid: jobUuid } : {}), payload } };
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
    vi.restoreAllMocks();
});

async function sendTurn(frames: StreamEvent[]): Promise<Hook> {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    let latest: Hook | null = null;
    const Probe: React.FC = () => {
        latest = useStreamChat({ client: scriptedClient(frames) });
        return null;
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Probe />));
    await act(async () => {
        await latest!.sendMessage('hello');
    });
    return latest!;
}

const assistantOf = (hook: Hook) => hook.messages.find(message => message.role === 'assistant')!;

describe('useStreamChat — the turn a live answer belongs to', () => {
    it("is the first frame's job", async () => {
        const hook = await sendTurn([
            // The client's own wait notice names no job.
            event('rate_limited', { retry_after_seconds: 0 }),
            event('token', { text: 'Hello' }, 'job-root'),
            event('token', { text: ' there' }, 'job-root'),
        ]);
        expect(assistantOf(hook).jobUuid).toBe('job-root');
    });

    it("is never a sub-agent's, delegated or handed off", async () => {
        const hook = await sendTurn([
            event('sub_agent_started', { step_uuid: 'step-1', child_job_uuid: 'job-child', agent_name: 'Analyst' }, 'job-root'),
            event('token', { text: 'working' }, 'job-child'),
            event('sub_agent_started', {
                step_uuid: 'step-2', child_job_uuid: 'job-heir', agent_name: 'Heir', handoff: true,
            }, 'job-root'),
            event('token', { text: 'Answer' }, 'job-heir'),
        ]);
        expect(assistantOf(hook).jobUuid).toBe('job-root');
    });

    it('stays unknown until a frame names a job', async () => {
        const hook = await sendTurn([event('rate_limited', { retry_after_seconds: 0 })]);
        expect(assistantOf(hook).jobUuid).toBeUndefined();
    });
});

describe('jobsToMessageProps — the turn a reloaded answer belongs to', () => {
    it("is the job's own uuid, on the question and the answer", () => {
        const job: ConversationJob = {
            uuid: 'job-1',
            user_prompt: 'How are we doing?',
            status: 'completed',
            total_steps: 1,
            total_input_tokens: 10,
            total_output_tokens: 5,
            total_credits_charged: 1,
            created_at: '2026-10-13T10:00:00Z',
            updated_at: '2026-10-13T10:00:05Z',
            attachments: [],
            steps: [{
                uuid: 'step-1',
                step_type: 'llm_call',
                step_sequence: 1,
                status: 'completed',
                request_message: null,
                response_payload: { content_blocks: [{ type: 'text', text: 'Fine.' }] },
                tool_slug: null,
                tool_input: null,
                tool_output: null,
                input_tokens: 10,
                output_tokens: 5,
                credits_charged: 1,
                started_at: '2026-10-13T10:00:00Z',
                completed_at: '2026-10-13T10:00:05Z',
            }],
        };

        const [question, answer] = jobsToMessageProps([job]);

        expect(question).toMatchObject({ role: 'user', jobUuid: 'job-1' });
        expect(answer).toMatchObject({ id: 'job-1-assistant', role: 'assistant', jobUuid: 'job-1' });
    });
});

describe('jobsToMessageProps — a handoff child\'s answer, after a reload', () => {
    /** One job of the history, answering `text`. */
    const job = (uuid: string, text: string, extra: Partial<ConversationJob> = {}): ConversationJob => ({
        uuid,
        user_prompt: 'Hand it over',
        status: 'completed',
        total_steps: 1,
        total_input_tokens: 1,
        total_output_tokens: 1,
        total_credits_charged: 0,
        created_at: '2026-10-13T10:00:00Z',
        updated_at: '2026-10-13T10:00:05Z',
        attachments: [],
        steps: [{
            uuid: `${uuid}-step`,
            step_type: 'llm_call',
            step_sequence: 1,
            status: 'completed',
            request_message: null,
            response_payload: { content_blocks: [{ type: 'text', text }] },
            tool_slug: null,
            tool_input: null,
            tool_output: null,
            input_tokens: 1,
            output_tokens: 1,
            credits_charged: 0,
            started_at: '2026-10-13T10:00:00Z',
            completed_at: '2026-10-13T10:00:05Z',
        }],
        ...extra,
    });

    // Review of 2026-10-14: the platform's turn of a handoff child is the job
    // that handed over (`root_job_uuid`), as the live stream has it; the
    // history keyed the child's answer by the child, so its blocks were two
    // rows in the files panel and read Not saved after a save.
    it('belongs to the turn that handed over — through a chain of handoffs too', () => {
        const messages = jobsToMessageProps([
            job('parent', 'Over to the analyst.'),
            job('child', 'Here is the chart.', { triggered_by_job_uuid: 'parent', handoff: true }),
            job('grandchild', 'And the table.', { triggered_by_job_uuid: 'child', handoff: true }),
        ]);
        expect(messages.filter(message => message.role === 'assistant').map(message => [message.id, message.jobUuid])).toEqual([
            ['parent-assistant', 'parent'],
            ['child-assistant', 'parent'],
            ['grandchild-assistant', 'parent'],
        ]);
    });

    it("keeps a top-level job's own, and takes a parent the history does not list as the closest known turn", () => {
        const messages = jobsToMessageProps([
            job('turn-1', 'One.'),
            job('orphan', 'Promoted.', { triggered_by_job_uuid: 'gone-parent' }),
        ]);
        expect(messages.filter(message => message.role === 'assistant').map(message => message.jobUuid)).toEqual(['turn-1', 'gone-parent']);
    });
});
