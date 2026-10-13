import { describe, expect, it, vi } from 'vitest';
import { HOST_REQUEST_SLUG, answerHostRequest, isHostRequestSlug } from './hostCatalogue';
import type { ClientSkillDefinition, ToolConfig } from './toolConfig';

const schema = { type: 'object', properties: { id: { type: 'string' } } };

/**
 * A registry with one of everything a host request must tell apart: client
 * tools with a definition (the only ones it describes), a backend-registered
 * client tool (a `run` with no definition), a server tool (`preview`), and the
 * library's built-in questionnaire.
 */
function registry(): Record<string, ToolConfig> {
    return {
        ask_user_questions: { run: vi.fn(), show: false },
        list_assets: {
            run: vi.fn(),
            definition: {
                name: 'List assets',
                description: 'List the assets of the current site.',
                input_schema: schema,
                skills: ['manage_assets'],
            },
        },
        validate_checklist: {
            run: vi.fn(),
            definition: {
                description: 'Validate a checklist draft.',
                input_schema: schema,
                share_with_sub_agents: true,
                skills: ['create_checklist', 'manage_assets'],
            },
        },
        delete_asset: {
            run: vi.fn(),
            definition: {
                description: 'Delete an asset.',
                input_schema: schema,
                requires_approval: true,
                defer_loading: true,
            },
        },
        read_page_context: { run: vi.fn() },
        generate_checklist: { preview: vi.fn() },
    };
}

const SKILLS: ClientSkillDefinition[] = [
    {
        slug: 'manage_assets',
        name: 'Manage assets',
        description: 'Create, edit and retire assets.',
        instructions: '# Manage assets\nAlways list before you edit.',
    },
    {
        slug: 'review_inspections',
        name: 'Review inspections',
        description: 'Read and summarise inspection results.',
        instructions: 'Summarise per site.',
    },
];

describe('isHostRequestSlug', () => {
    it('recognises only the reserved slug', () => {
        expect(HOST_REQUEST_SLUG).toBe('__host_request');
        expect(isHostRequestSlug('__host_request')).toBe(true);
        for (const slug of ['host_request', '__host_request ', 'load_tool', '', null, undefined, 1]) {
            expect(isHostRequestSlug(slug)).toBe(false);
        }
    });
});

describe('answerHostRequest — catalogue', () => {
    it('lists tools with a definition and every skill, metadata only', () => {
        const answer = answerHostRequest({ op: 'catalogue' }, registry(), SKILLS);

        expect(answer).toEqual({
            tools: [
                { name: 'list_assets', description: 'List the assets of the current site.', skills: ['manage_assets'], requires_approval: false },
                { name: 'validate_checklist', description: 'Validate a checklist draft.', skills: ['create_checklist', 'manage_assets'], requires_approval: false },
                { name: 'delete_asset', description: 'Delete an asset.', skills: [], requires_approval: true },
            ],
            skills: [
                { slug: 'manage_assets', name: 'Manage assets', description: 'Create, edit and retire assets.' },
                { slug: 'review_inspections', name: 'Review inspections', description: 'Read and summarise inspection results.' },
            ],
        });
    });

    it('carries no schema and no instructions — a search needs neither', () => {
        const answer = answerHostRequest({ op: 'catalogue' }, registry(), SKILLS) as any;

        for (const tool of answer.tools) expect(tool).not.toHaveProperty('input_schema');
        for (const skill of answer.skills) expect(skill).not.toHaveProperty('instructions');
        expect(JSON.stringify(answer)).not.toContain('Always list before you edit');
    });

    it('is empty, not an error, when nothing is registered', () => {
        expect(answerHostRequest({ op: 'catalogue' }, {}, [])).toEqual({ tools: [], skills: [] });
    });

    it('never offers a tool registered under the reserved slug', () => {
        const tools: Record<string, ToolConfig> = {
            [HOST_REQUEST_SLUG]: { run: vi.fn(), definition: { description: 'Shadow', input_schema: schema } },
        };

        expect(answerHostRequest({ op: 'catalogue' }, tools, [])).toEqual({ tools: [], skills: [] });
        expect(answerHostRequest({ op: 'definitions', names: [HOST_REQUEST_SLUG] }, tools, []))
            .toEqual({ tools: [], missing: [HOST_REQUEST_SLUG] });
        expect(answerHostRequest({ op: 'all_definitions' }, tools, [])).toEqual({ tools: [] });
    });

    it('keeps the first skill of a slug and drops entries no load could name', () => {
        const skills = [
            SKILLS[0],
            { ...SKILLS[0], name: 'Shadowing duplicate' },
            null,
            { name: 'No slug', description: 'x', instructions: 'y' },
        ] as unknown as ClientSkillDefinition[];

        const answer = answerHostRequest({ op: 'catalogue' }, {}, skills) as any;

        expect(answer.skills).toEqual([
            { slug: 'manage_assets', name: 'Manage assets', description: 'Create, edit and retire assets.' },
        ]);
    });

    it('never runs a tool', () => {
        const tools = registry();
        for (const op of [
            { op: 'catalogue' },
            { op: 'definitions', names: ['list_assets', 'validate_checklist'] },
            { op: 'skill', slug: 'manage_assets' },
            { op: 'all_definitions', shared_only: false },
        ]) {
            answerHostRequest(op, tools, SKILLS);
        }
        for (const config of Object.values(tools)) {
            const handler = (config as any).run ?? (config as any).preview;
            expect(handler).not.toHaveBeenCalled();
        }
    });
});

describe('answerHostRequest — definitions', () => {
    it('answers the names it has, in the shape the platform validates, and lists the rest as missing', () => {
        const answer = answerHostRequest(
            { op: 'definitions', names: ['delete_asset', 'gone_tool', 'list_assets'] },
            registry(),
            SKILLS,
        );

        expect(answer).toEqual({
            tools: [
                {
                    name: 'delete_asset', description: 'Delete an asset.', input_schema: schema,
                    requires_approval: true, share_with_sub_agents: false, skills: [],
                },
                {
                    name: 'list_assets', description: 'List the assets of the current site.', input_schema: schema,
                    requires_approval: false, share_with_sub_agents: false, skills: ['manage_assets'],
                },
            ],
            missing: ['gone_tool'],
        });
    });

    it('sends neither the display name nor the deprecated defer_loading', () => {
        const answer = answerHostRequest({ op: 'definitions', names: ['list_assets', 'delete_asset'] }, registry(), []) as any;

        for (const spec of answer.tools) {
            expect(Object.keys(spec).sort()).toEqual(
                ['description', 'input_schema', 'name', 'requires_approval', 'share_with_sub_agents', 'skills'],
            );
        }
        // The wire name is the registration key, never `definition.name`.
        expect(answer.tools[0].name).toBe('list_assets');
    });

    it('reports a name without a definition as missing — a backend tool, a server tool, the questionnaire', () => {
        const answer = answerHostRequest(
            { op: 'definitions', names: ['read_page_context', 'generate_checklist', 'ask_user_questions'] },
            registry(),
            [],
        );

        expect(answer).toEqual({ tools: [], missing: ['read_page_context', 'generate_checklist', 'ask_user_questions'] });
    });

    it('answers each name once and ignores entries that are not names', () => {
        const answer = answerHostRequest(
            { op: 'definitions', names: ['list_assets', 'list_assets', 7, null, 'nope', 'nope'] },
            registry(),
            [],
        ) as any;

        expect(answer.tools.map((tool: any) => tool.name)).toEqual(['list_assets']);
        expect(answer.missing).toEqual(['nope']);
    });

    it('is an error without a names list', () => {
        expect(answerHostRequest({ op: 'definitions' }, registry(), [])).toEqual({
            error: 'A "definitions" host request needs a "names" list.',
        });
        expect(answerHostRequest({ op: 'definitions', names: 'list_assets' }, registry(), [])).toHaveProperty('error');
    });

    it('does not share the definition objects with the registry', () => {
        const tools = registry();
        const answer = answerHostRequest({ op: 'definitions', names: ['list_assets'] }, tools, []) as any;

        answer.tools[0].skills.push('mutated');

        expect((tools.list_assets as any).definition.skills).toEqual(['manage_assets']);
    });
});

describe('answerHostRequest — skill', () => {
    it('a client skill: its four fields, and every host tool that names it', () => {
        const answer = answerHostRequest({ op: 'skill', slug: 'manage_assets' }, registry(), SKILLS);

        expect(answer).toEqual({
            skill: {
                slug: 'manage_assets',
                name: 'Manage assets',
                description: 'Create, edit and retire assets.',
                instructions: '# Manage assets\nAlways list before you edit.',
            },
            tools: [
                {
                    name: 'list_assets', description: 'List the assets of the current site.', input_schema: schema,
                    requires_approval: false, share_with_sub_agents: false, skills: ['manage_assets'],
                },
                {
                    name: 'validate_checklist', description: 'Validate a checklist draft.', input_schema: schema,
                    requires_approval: false, share_with_sub_agents: true, skills: ['create_checklist', 'manage_assets'],
                },
            ],
        });
    });

    it('a platform skill: no skill of its own, but the host tools that name it still load', () => {
        const answer = answerHostRequest({ op: 'skill', slug: 'create_checklist' }, registry(), SKILLS) as any;

        expect(answer.skill).toBeNull();
        expect(answer.tools.map((tool: any) => tool.name)).toEqual(['validate_checklist']);
    });

    it('a skill with no member tools: instructions alone', () => {
        const answer = answerHostRequest({ op: 'skill', slug: 'review_inspections' }, registry(), SKILLS) as any;

        expect(answer.skill.slug).toBe('review_inspections');
        expect(answer.tools).toEqual([]);
    });

    it('an unknown slug: null and nothing', () => {
        expect(answerHostRequest({ op: 'skill', slug: 'nobody_has_this' }, registry(), SKILLS))
            .toEqual({ skill: null, tools: [] });
    });

    it('sends only the four fields of a skill, whatever else the host object carries', () => {
        const skills = [{ ...SKILLS[0], internalNote: 'do not send', file: '/abs/path.md' }] as unknown as ClientSkillDefinition[];

        const answer = answerHostRequest({ op: 'skill', slug: 'manage_assets' }, {}, skills) as any;

        expect(Object.keys(answer.skill).sort()).toEqual(['description', 'instructions', 'name', 'slug']);
    });

    it('is an error without a slug', () => {
        expect(answerHostRequest({ op: 'skill' }, registry(), SKILLS)).toEqual({
            error: 'A "skill" host request needs a skill "slug".',
        });
        expect(answerHostRequest({ op: 'skill', slug: '' }, registry(), SKILLS)).toHaveProperty('error');
    });
});

describe('answerHostRequest — all_definitions', () => {
    it('every tool with a definition, for a run that offers its whole tool set', () => {
        const answer = answerHostRequest({ op: 'all_definitions', shared_only: false }, registry(), SKILLS) as any;

        expect(answer.tools.map((tool: any) => tool.name)).toEqual(['list_assets', 'validate_checklist', 'delete_asset']);
        expect(answer).not.toHaveProperty('missing');
    });

    it('shared_only keeps what a delegated sub-agent may call', () => {
        const answer = answerHostRequest({ op: 'all_definitions', shared_only: true }, registry(), SKILLS) as any;

        expect(answer.tools.map((tool: any) => tool.name)).toEqual(['validate_checklist']);
    });

    it('treats a missing or non-boolean shared_only as false', () => {
        const all = ['list_assets', 'validate_checklist', 'delete_asset'];
        expect((answerHostRequest({ op: 'all_definitions' }, registry(), []) as any).tools.map((t: any) => t.name)).toEqual(all);
        expect((answerHostRequest({ op: 'all_definitions', shared_only: 'yes' }, registry(), []) as any).tools.map((t: any) => t.name)).toEqual(all);
    });
});

describe('answerHostRequest — what it cannot answer', () => {
    it('an unknown op is an error, never a guess', () => {
        expect(answerHostRequest({ op: 'run', name: 'delete_asset' }, registry(), SKILLS))
            .toEqual({ error: "Unknown host request op 'run'." });
        expect(answerHostRequest({}, registry(), SKILLS)).toEqual({ error: "Unknown host request op 'undefined'." });
    });

    it('a request that is not an object is an error', () => {
        for (const request of [null, undefined, 'catalogue', 42, ['catalogue']]) {
            expect(answerHostRequest(request, registry(), SKILLS)).toEqual({
                error: 'A host request must be an object naming an "op".',
            });
        }
    });

    it('tolerates a missing registry', () => {
        expect(answerHostRequest({ op: 'catalogue' }, undefined as any, undefined as any)).toEqual({ tools: [], skills: [] });
    });
});
