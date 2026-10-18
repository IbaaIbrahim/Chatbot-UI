import { describe, expect, it } from 'vitest';
import { DEFAULT_LABELS } from './labels';
import { META_TOOL_SLUGS, describeMetaTool, isMetaTool } from './metaTools';
import { DEFAULT_TOOL_NAMES, resolveToolDisplayName } from './toolConfig';

const describe_ = (
    slug: string,
    status: 'running' | 'completed' | 'failed',
    args: unknown,
    result: unknown,
    toolName?: (name: string) => string,
) => describeMetaTool(slug, status, args, result, DEFAULT_LABELS, toolName);

describe('isMetaTool', () => {
    it('recognises the four meta-tools', () => {
        expect([...META_TOOL_SLUGS]).toEqual(['search_tools', 'load_tool', 'search_skills', 'load_skill']);
        for (const slug of META_TOOL_SLUGS) expect(isMetaTool(slug)).toBe(true);
    });

    it('rejects everything else', () => {
        for (const slug of ['web_search', 'switch_agent', 'load_tools', 'Load tools', '', null, undefined]) {
            expect(isMetaTool(slug)).toBe(false);
        }
    });

    it('gives every meta-tool a default name for the generic row', () => {
        for (const slug of META_TOOL_SLUGS) expect(DEFAULT_TOOL_NAMES[slug]).toBeTruthy();
        // Kept so transcripts from before 4.0 still read well.
        expect(DEFAULT_TOOL_NAMES.switch_agent).toBe('Switch agent');
    });
});

describe('describeMetaTool — searches', () => {
    it('search_tools: running, done, with and without a query', () => {
        expect(describe_('search_tools', 'running', { query: 'checklist' }, undefined))
            .toEqual({ text: 'Searching tools…', detail: '“checklist”' });
        expect(describe_('search_tools', 'completed', { query: '  checklist ' }, '{"tools":[]}'))
            .toEqual({ text: 'Searched tools', detail: '“checklist”' });
        expect(describe_('search_tools', 'completed', {}, undefined)).toEqual({ text: 'Searched tools' });
        expect(describe_('search_tools', 'completed', { query: '   ' }, undefined)).toEqual({ text: 'Searched tools' });
    });

    it('search_skills: running, done, missing arguments', () => {
        expect(describe_('search_skills', 'running', { query: 'audit' }, undefined))
            .toEqual({ text: 'Searching skills…', detail: '“audit”' });
        expect(describe_('search_skills', 'completed', null, null)).toEqual({ text: 'Searched skills' });
    });

    it('a failed search falls back to the generic row', () => {
        expect(describe_('search_tools', 'failed', { query: 'x' }, 'boom')).toBeNull();
        expect(describe_('search_skills', 'failed', { query: 'x' }, 'boom')).toBeNull();
    });
});

describe('describeMetaTool — load_tool', () => {
    it('running shows what was asked for', () => {
        expect(describe_('load_tool', 'running', { names: ['a', 'b'] }, undefined))
            .toEqual({ text: 'Loading tools…', detail: 'a, b' });
        expect(describe_('load_tool', 'running', {}, undefined)).toEqual({ text: 'Loading tools…' });
    });

    it('done lists what was loaded, from a JSON string or an object', () => {
        const output = { loaded: ['a', 'b'], refused: [] };
        expect(describe_('load_tool', 'completed', { names: ['a', 'b'] }, JSON.stringify(output)))
            .toEqual({ text: 'Loaded tools · a, b' });
        expect(describe_('load_tool', 'completed', { names: ['a', 'b'] }, output))
            .toEqual({ text: 'Loaded tools · a, b' });
    });

    it('counts refusals, and lists only what was actually loaded', () => {
        const output = { loaded: ['a'], refused: [{ name: 'b', reason: 'not_in_snapshot' }] };
        expect(describe_('load_tool', 'completed', { names: ['a', 'b'] }, output))
            .toEqual({ text: 'Loaded tools · a (1 refused)' });
    });

    it('nothing loaded at all falls back to the generic row', () => {
        const output = { loaded: [], refused: [{ name: 'a', reason: 'cap_reached' }, { name: 'b', reason: 'x' }] };
        expect(describe_('load_tool', 'completed', { names: ['a', 'b'] }, output)).toBeNull();
    });

    it('a missing or unparseable output falls back to the names asked for', () => {
        expect(describe_('load_tool', 'completed', { names: ['a'] }, undefined)).toEqual({ text: 'Loaded tools · a' });
        expect(describe_('load_tool', 'completed', { names: ['a'] }, 'not json')).toEqual({ text: 'Loaded tools · a' });
        expect(describe_('load_tool', 'completed', {}, undefined)).toBeNull();
    });

    it('resolves tool names through the given function', () => {
        const output = { loaded: ['web_search', 'my_tool'], refused: [] };
        expect(describe_('load_tool', 'completed', {}, output, name => resolveToolDisplayName(name)))
            .toEqual({ text: 'Loaded tools · Web search, My Tool' });
    });

    it('a failed load falls back to the generic row', () => {
        expect(describe_('load_tool', 'failed', { names: ['a'] }, { loaded: ['a'], refused: [] })).toBeNull();
    });
});

describe('describeMetaTool — load_skill', () => {
    const skill = { uuid: 'u-1', slug: 'audit-planning', name: 'Audit planning' };

    it('running shows the skill asked for', () => {
        expect(describe_('load_skill', 'running', { skill: 'audit-planning' }, undefined))
            .toEqual({ text: 'Loading skill…', detail: 'audit-planning' });
        expect(describe_('load_skill', 'running', {}, undefined)).toEqual({ text: 'Loading skill…' });
    });

    it('done names the skill: its name, else its slug, else the argument', () => {
        const output = { skill, instructions: '# Plan', tools_loaded: ['a'], tools_unavailable: [] };
        expect(describe_('load_skill', 'completed', { skill: 'audit-planning' }, JSON.stringify(output)))
            .toEqual({ text: 'Loaded skill · Audit planning' });
        expect(describe_('load_skill', 'completed', { skill: 'x' }, { skill: { slug: 'audit-planning' } }))
            .toEqual({ text: 'Loaded skill · audit-planning' });
        expect(describe_('load_skill', 'completed', { skill: 'audit-planning' }, undefined))
            .toEqual({ text: 'Loaded skill · audit-planning' });
    });

    it('tools the skill could not bring do not change the row', () => {
        const output = { skill, instructions: '', tools_loaded: [], tools_unavailable: ['b', 'c'] };
        expect(describe_('load_skill', 'completed', { skill: 'audit-planning' }, output))
            .toEqual({ text: 'Loaded skill · Audit planning' });
    });

    it('nothing to name falls back to the generic row', () => {
        expect(describe_('load_skill', 'completed', {}, undefined)).toBeNull();
        expect(describe_('load_skill', 'completed', {}, 'not json')).toBeNull();
    });

    it('a failed load falls back to the generic row', () => {
        expect(describe_('load_skill', 'failed', { skill: 'audit-planning' }, { skill })).toBeNull();
    });
});

describe('describeMetaTool — anything else', () => {
    it('returns null for a tool that is not a meta-tool', () => {
        expect(describe_('web_search', 'completed', { query: 'x' }, 'y')).toBeNull();
    });

    it('is written in the labels it is given', () => {
        const labels = { ...DEFAULT_LABELS, metaLoadedTools: 'Werkzeuge geladen · {names}', metaRefused: '{count} abgelehnt' };
        const output = { loaded: ['a'], refused: [{ name: 'b', reason: 'x' }] };
        expect(describeMetaTool('load_tool', 'completed', {}, output, labels))
            .toEqual({ text: 'Werkzeuge geladen · a (1 abgelehnt)' });
    });
});
