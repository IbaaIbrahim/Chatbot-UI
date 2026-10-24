import { describe, expect, it } from 'vitest';
import type { MessageStep } from '../components/MessageBubble/MessageBubble';
import { DEFAULT_LABELS } from './labels';
import {
    LIVE_THOUGHT_CHARS,
    describeLatestActivity,
    groupActivity,
    latestThoughtLine,
    summarizeActivity,
} from './activity';

/**
 * A run of thinking, tool calls and sub-agents is one section: grouped by these
 * rules, headed by the newest step while live and by a count once done.
 */

let n = 0;
const thought = (extra: Partial<MessageStep> = {}): MessageStep =>
    ({ id: `t${++n}`, type: 'thinking', content: 'pondering', isFinished: true, ...extra });
const call = (toolSlug: string, extra: Partial<MessageStep> = {}): MessageStep =>
    ({ id: `c${++n}`, type: 'tool-call', toolSlug, toolStatus: 'completed', ...extra });
const text = (content: string): MessageStep => ({ id: `x${++n}`, type: 'text', content });

/** The turn in the 2026-10-13 screenshot: nine rows before the answer. */
const SCREENSHOT_TURN: MessageStep[] = [
    thought(),
    call('search_tools', { toolArgs: { query: 'read page context' } }),
    call('search_skills', { toolArgs: { query: 'inspections list' } }),
    thought(),
    call('load_skill', { toolResult: { skill: { name: 'Review inspection reports' } } }),
    thought(),
    call('list_inspections', { toolName: 'List Inspections' }),
    thought(),
    text('Here are the first 5 rows…'),
];

describe('groupActivity', () => {
    it('turns the working before the answer into one section and keeps the answer', () => {
        const items = groupActivity(SCREENSHOT_TURN);

        expect(items.map(item => item.type)).toEqual(['activity', 'single']);
        expect(items[0].type === 'activity' && items[0].steps).toHaveLength(8);
        expect(items[1]).toMatchObject({ type: 'single', index: 8 });
    });

    it('draws a run of one step as that step', () => {
        const items = groupActivity([thought(), text('answer')]);

        expect(items.map(item => item.type)).toEqual(['single', 'single']);
    });

    it('ends a run at anything the user must see', () => {
        const confirm: MessageStep = { id: 'cr', type: 'confirm-request' };
        const error: MessageStep = { id: 'e', type: 'error', content: 'failed' };
        const steps = [thought(), call('a'), confirm, call('b'), thought(), error, text('done')];

        expect(groupActivity(steps).map(item => item.type)).toEqual(
            ['activity', 'single', 'activity', 'single', 'single'],
        );
    });

    it('starts a new section after text the agent wrote between steps', () => {
        const steps = [thought(), call('a'), text('Let me check one more thing.'), call('b'), thought()];

        expect(groupActivity(steps).map(item => item.type)).toEqual(['activity', 'single', 'activity']);
    });

    it('counts a sub-agent run as activity', () => {
        const agent: MessageStep = { id: 'sa', type: 'sub-agent', agentName: 'Checklist Builder', toolStatus: 'completed' };

        expect(groupActivity([thought(), agent]).map(item => item.type)).toEqual(['activity']);
    });
});

describe('summarizeActivity', () => {
    const toolName = (name: string) => (name === 'list_inspections' ? 'List Inspections' : name);

    it('counts what happened, in order', () => {
        const [activity] = groupActivity(SCREENSHOT_TURN);
        const steps = activity.type === 'activity' ? activity.steps : [];

        expect(summarizeActivity(steps, DEFAULT_LABELS, toolName)).toBe(
            'Thought 4 times · searched 2 times · loaded a skill · ran List Inspections',
        );
    });

    it('names one tool called several times, and counts several tools', () => {
        // Without a namer of the host's, a platform tool is named by its label.
        expect(summarizeActivity([call('web_search'), call('web_search'), thought()], DEFAULT_LABELS))
            .toBe('Thought once · ran Web search 2 times');
        expect(summarizeActivity([call('web_search'), call('fetch_web_page')], DEFAULT_LABELS))
            .toBe('Ran 2 tools');
    });

    it('names sub-agents and says how many steps failed', () => {
        const agent: MessageStep = { id: 'sa', type: 'sub-agent', agentName: 'Checklist Builder', toolStatus: 'completed' };
        const steps = [agent, call('generate_checklist', { toolStatus: 'failed' }), call('load_tool')];

        expect(summarizeActivity(steps, DEFAULT_LABELS))
            .toBe('Loaded tools · ran Checklist Generator · used Checklist Builder · 1 failed');
    });
});

describe('describeLatestActivity', () => {
    it('says which tool is running', () => {
        const steps = [thought(), call('list_inspections', { toolName: 'List Inspections', toolStatus: 'running' })];

        expect(describeLatestActivity(steps, DEFAULT_LABELS)).toEqual({ text: 'Running', detail: 'List Inspections' });
    });

    it('says what a meta-tool is doing, with its query', () => {
        const steps = [thought(), call('search_skills', { toolStatus: 'running', toolArgs: { query: 'inspections list' } })];

        expect(describeLatestActivity(steps, DEFAULT_LABELS)).toEqual({ text: 'Searching skills…', detail: '“inspections list”' });
    });

    it('shows the latest line of a thought being written', () => {
        const live = thought({ isFinished: false, content: 'First I need the list.\n\n**Then sort by `updated_at`**' });

        expect(describeLatestActivity([call('a'), live], DEFAULT_LABELS)).toEqual({ text: 'Then sort by updated_at' });
        expect(describeLatestActivity([thought({ isFinished: false, content: '' })], DEFAULT_LABELS))
            .toEqual({ text: 'Thinking…' });
    });

    it('prefers the step still running over a later finished one', () => {
        const steps = [call('slow', { toolStatus: 'running' }), call('fast')];

        // A slug no label names, and no name from the platform: the slug in words.
        expect(describeLatestActivity(steps, DEFAULT_LABELS)).toEqual({ text: 'Running', detail: 'Slow' });
    });

    it('shows the last step done while the next is awaited', () => {
        expect(describeLatestActivity([thought(), call('list_inspections')], DEFAULT_LABELS))
            .toEqual({ text: 'Ran', detail: 'List Inspections' });
    });

    it('says a sub-agent is working', () => {
        const agent: MessageStep = { id: 'sa', type: 'sub-agent', agentName: 'Checklist Builder', toolStatus: 'running' };

        expect(describeLatestActivity([thought(), agent], DEFAULT_LABELS)).toEqual({ text: 'Checklist Builder is working…' });
    });
});

describe('latestThoughtLine', () => {
    it('cuts a long line', () => {
        const line = latestThoughtLine('x'.repeat(500));

        expect(line).toHaveLength(LIVE_THOUGHT_CHARS);
        expect(line?.endsWith('…')).toBe(true);
    });
});
