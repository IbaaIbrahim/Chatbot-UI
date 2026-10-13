import { describe, expect, it } from 'vitest';
import { findPendingClientToolCalls, hasPendingClientToolCall, jobsToMessageProps } from './useConversations';
import { HOST_REQUEST_SLUG } from '../common/hostCatalogue';
import type { ConversationJob, ConversationStep } from '../api/types';

/**
 * A reloaded transcript and host requests. The platform records none as a
 * step of its own: a meta-tool's request rides on the meta-tool's ``harness``
 * step, and a run's start-up fetch has no step. So nothing about one is a
 * pending *client* call the transcript could answer from another device, and
 * nothing about one is a row — and should a step ever be recorded under the
 * reserved slug, it is neither.
 */

let sequence = 0;

function step(overrides: Partial<ConversationStep>): ConversationStep {
    sequence += 1;
    return {
        uuid: `step-${sequence}`,
        step_type: 'tool_call',
        step_sequence: sequence,
        status: 'completed',
        request_message: null,
        response_payload: null,
        tool_slug: null,
        tool_input: null,
        tool_output: null,
        dispatch_mode: null,
        input_tokens: 0,
        output_tokens: 0,
        credits_charged: 0,
        started_at: '2026-10-12T10:00:00Z',
        completed_at: null,
        ...overrides,
    } as ConversationStep;
}

function job(steps: ConversationStep[], overrides: Partial<ConversationJob> = {}): ConversationJob {
    return {
        uuid: 'job-1',
        user_prompt: 'Load the asset skill',
        status: 'running',
        total_steps: null,
        total_input_tokens: null,
        total_output_tokens: null,
        total_credits_charged: null,
        created_at: '2026-10-12T10:00:00Z',
        updated_at: '2026-10-12T10:00:00Z',
        attachments: [],
        steps,
        ...overrides,
    } as ConversationJob;
}

describe('findPendingClientToolCalls — host requests are never pending client calls', () => {
    it('ignores a running meta-tool step waiting on the browser', () => {
        const jobs = [job([
            step({ tool_slug: 'load_skill', dispatch_mode: 'harness', status: 'running', tool_input: { skill: 'manage_assets' } }),
        ])];

        expect(findPendingClientToolCalls(jobs)).toEqual([]);
        expect(hasPendingClientToolCall(jobs)).toBe(false);
    });

    it('ignores a running client step under the reserved slug, even in a sub-agent', () => {
        const child = job(
            [step({ tool_slug: HOST_REQUEST_SLUG, dispatch_mode: 'client', status: 'running', tool_input: { op: 'all_definitions' } })],
            { uuid: 'child-1', triggered_by_job_uuid: 'job-1' },
        );
        const jobs = [job(
            [step({ tool_slug: HOST_REQUEST_SLUG, dispatch_mode: 'client', status: 'running', tool_input: { op: 'catalogue' } })],
            { sub_agent_jobs: [child] } as Partial<ConversationJob>,
        )];

        expect(findPendingClientToolCalls(jobs)).toEqual([]);
    });

    it('still finds a real pending client call behind one', () => {
        const pending = step({ tool_slug: 'ask_user_questions', dispatch_mode: 'client', status: 'running', tool_input: { questions: [] } });
        const jobs = [job([
            step({ tool_slug: HOST_REQUEST_SLUG, dispatch_mode: 'client', status: 'running' }),
            pending,
        ])];

        expect(findPendingClientToolCalls(jobs)).toEqual([
            { jobUuid: 'job-1', stepUuid: pending.uuid, toolSlug: 'ask_user_questions', toolInput: { questions: [] } },
        ]);
    });
});

describe('jobsToMessageProps — host requests draw no row', () => {
    it('draws the meta-tool and skips a step under the reserved slug', () => {
        const meta = step({
            tool_slug: 'search_tools', dispatch_mode: 'harness', status: 'completed',
            tool_input: { query: 'assets' }, tool_output: '{"tools":[]}',
        });
        const messages = jobsToMessageProps([job([
            meta,
            step({ tool_slug: HOST_REQUEST_SLUG, dispatch_mode: 'client', status: 'completed', tool_output: '{"tools":[]}' }),
        ], { status: 'completed' })]);

        const assistant = messages.find(message => message.role === 'assistant');
        const rows = (assistant?.steps ?? []).filter(row => row.type === 'tool-call');
        expect(rows.map(row => row.toolSlug)).toEqual(['search_tools']);
        expect(rows[0].id).toBe(meta.uuid);
    });
});
