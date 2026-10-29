/**
 * The host catalogue: how the platform finds and loads this application's
 * tools and skills through the browser, instead of receiving every definition
 * with every message (platform ADR-018, "Host catalogue and conversation-scoped
 * loads").
 *
 * A central-mode job (one sent without an agent) carries ``host_catalogue=true``
 * and no ``client_tools``. That flag tells the platform this browser answers
 * *host requests* on the conversation's stream, and its meta-tools then search
 * and load from both sides with one set of tools: ``search_tools`` and
 * ``search_skills`` rank the platform's entries and this application's
 * together, and ``load_tool`` / ``load_skill`` load from whichever side owns
 * the entry. What a run loads belongs to the conversation, so a later turn
 * does not load it again.
 *
 * A host request rides on the ``client_tool_call`` event under one reserved
 * slug, {@link HOST_REQUEST_SLUG}, so no new event type, endpoint or gateway
 * route was needed: the answer goes back through the same ``tool-results``
 * POST as any client tool's. Its ``tool_input`` names an operation:
 *
 * | ``op`` | Answer |
 * | --- | --- |
 * | ``catalogue`` | ``{ tools: [{ name, description, skills, loads_with, requires_approval }], skills: [{ slug, name, description }] }`` — metadata only, for a search, and for a load to know which tools come with the ones it names |
 * | ``definitions`` (``names``) | ``{ tools: ClientToolSpec[], missing: string[] }`` — for ``load_tool`` |
 * | ``skill`` (``slug``) | ``{ skill: { slug, name, description, instructions } \| null, tools: ClientToolSpec[] }`` — for ``load_skill``; ``tools`` is every host tool naming the slug in its ``skills``, so a *platform* skill's host tools load with it too |
 * | ``all_definitions`` (``shared_only``) | ``{ tools: ClientToolSpec[] }`` — a run that offers its whole tool set (an agent's thread, a sub-agent) fetches them once at its start; ``shared_only`` keeps the ``share_with_sub_agents`` ones |
 *
 * Anything the browser cannot answer — an unknown ``op``, a malformed input —
 * is answered ``{ error }``, which the platform reads as "the application did
 * not answer": the model gets the platform half alone, at once, rather than
 * after the platform's timeout.
 *
 * Every answer is computed when the request arrives, from whatever the
 * application has registered at that moment — page tools come and go with
 * navigation — and no tool is ever *run* for one. The platform treats every
 * answer as untrusted input and validates each entry before the model sees it.
 */

import { isClientTool } from './toolConfig';
import type { ClientSkillDefinition, ClientToolDefinition, ToolConfig } from './toolConfig';

/**
 * The reserved ``tool_slug`` of a host request.
 *
 * Reserved on the platform too — no client tool may take this name, nor a
 * meta-tool's or ``run_sub_agent`` — and checked here *before* the tool
 * registry is consulted, so an application tool registered under it can never
 * shadow the library's answer. Two leading underscores keep it out of any
 * name an application would choose by accident.
 */
export const HOST_REQUEST_SLUG = '__host_request';

/** Whether a ``client_tool_call``'s slug is a host request rather than a tool. */
export function isHostRequestSlug(slug: unknown): boolean {
    return slug === HOST_REQUEST_SLUG;
}

/**
 * One host tool's full definition, as the platform's client-tool validator
 * (``normalize_client_tools``) accepts it — the shape of an agent-bound job's
 * ``client_tools`` entry, without the deprecated ``defer_loading`` and with
 * ``loads_with``, which only a central-mode run reads.
 */
export interface ClientToolSpec {
    name: string;
    description: string;
    input_schema: Record<string, any>;
    requires_approval: boolean;
    share_with_sub_agents: boolean;
    skills: string[];
    loads_with: string[];
}

/** A host tool as a search sees it: no schema, so a catalogue stays small. */
export interface HostCatalogueTool {
    name: string;
    description: string;
    skills: string[];
    loads_with: string[];
    requires_approval: boolean;
}

/** A client skill as a search sees it: no instructions. */
export interface HostCatalogueSkill {
    slug: string;
    name: string;
    description: string;
}

/** What the platform may ask; the ``tool_input`` of a host request. */
export type HostRequest =
    | { op: 'catalogue' }
    | { op: 'definitions'; names: string[] }
    | { op: 'skill'; slug: string }
    | { op: 'all_definitions'; shared_only?: boolean };

/** What the browser answers; the ``tool_output`` it posts back. */
export type HostRequestAnswer =
    | { tools: HostCatalogueTool[]; skills: HostCatalogueSkill[] }
    | { tools: ClientToolSpec[]; missing: string[] }
    | { skill: ClientSkillDefinition | null; tools: ClientToolSpec[] }
    | { tools: ClientToolSpec[] }
    | { error: string };

/**
 * The application tools a host request can describe: client tools that carry
 * an inline ``definition``, keyed by slug.
 *
 * A tool without a ``definition`` is backend-registered — its schema lives on
 * the platform already, and offering it from here would be refused as a client
 * tool shadowing a backend name. A server tool (``preview``) is not called by
 * the browser at all. An entry registered under the reserved slug is never
 * offered: the platform refuses that name, and this browser would never route a
 * call to it.
 */
function hostTools(tools: Record<string, ToolConfig>): Array<[string, ClientToolDefinition]> {
    const found: Array<[string, ClientToolDefinition]> = [];
    for (const [slug, config] of Object.entries(tools ?? {})) {
        if (isHostRequestSlug(slug)) continue;
        if (config && isClientTool(config) && config.definition) {
            found.push([slug, config.definition]);
        }
    }
    return found;
}

/**
 * The client skills, first entry per slug.
 *
 * Duplicates are dropped here rather than sent: the platform keys skills by
 * slug, so two entries with one slug could only ever mean one of them, and
 * which one should not depend on how the platform happens to merge them.
 * Entries without a string slug cannot be named by ``load_skill`` and are left
 * out.
 */
function hostSkills(skills: readonly ClientSkillDefinition[]): ClientSkillDefinition[] {
    const seen = new Set<string>();
    const found: ClientSkillDefinition[] = [];
    for (const skill of Array.isArray(skills) ? skills : []) {
        if (!skill || typeof skill !== 'object' || typeof skill.slug !== 'string') continue;
        if (seen.has(skill.slug)) continue;
        seen.add(skill.slug);
        found.push(skill);
    }
    return found;
}

/**
 * A tool's full definition on the wire. Every flag is sent explicitly rather
 * than left to the platform's default, so a spec read in isolation states its
 * own gate.
 */
function toClientToolSpec(name: string, definition: ClientToolDefinition): ClientToolSpec {
    return {
        name,
        description: definition.description,
        input_schema: definition.input_schema,
        requires_approval: definition.requires_approval ?? false,
        share_with_sub_agents: definition.share_with_sub_agents ?? false,
        skills: [...(definition.skills ?? [])],
        loads_with: [...(definition.loads_with ?? [])],
    };
}

/** The four fields of a skill and nothing else a host object may carry. */
function toSkillAnswer(skill: ClientSkillDefinition): ClientSkillDefinition {
    return {
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
    };
}

function asRecord(value: unknown): Record<string, any> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

/**
 * Answer one host request from the application's registry as it is now.
 *
 * Pure: it reads ``tools`` and ``skills`` and runs nothing — a host request
 * asks *about* tools, it never calls one. Never throws for a bad request
 * either; the platform is waiting on whatever comes back, and ``{ error }`` is
 * how "this browser cannot say" reaches it. See the module comment for the
 * operations and their answers.
 */
export function answerHostRequest(
    request: unknown,
    tools: Record<string, ToolConfig>,
    skills: readonly ClientSkillDefinition[],
): HostRequestAnswer {
    const input = asRecord(request);
    const op = input?.op;

    switch (op) {
        case 'catalogue':
            return {
                tools: hostTools(tools).map(([name, definition]) => ({
                    name,
                    description: definition.description,
                    skills: [...(definition.skills ?? [])],
                    // What a ``load_tool`` of another tool needs to bring this
                    // one: the platform asks for its definition with that load.
                    loads_with: [...(definition.loads_with ?? [])],
                    requires_approval: definition.requires_approval ?? false,
                })),
                skills: hostSkills(skills).map(skill => ({
                    slug: skill.slug,
                    name: skill.name,
                    description: skill.description,
                })),
            };

        case 'definitions': {
            if (!Array.isArray(input!.names)) {
                return { error: 'A "definitions" host request needs a "names" list.' };
            }
            const registered = new Map(hostTools(tools));
            const answered: ClientToolSpec[] = [];
            const missing: string[] = [];
            const seen = new Set<string>();
            for (const name of input!.names) {
                if (typeof name !== 'string' || seen.has(name)) continue;
                seen.add(name);
                const definition = registered.get(name);
                if (definition) answered.push(toClientToolSpec(name, definition));
                else missing.push(name);
            }
            return { tools: answered, missing };
        }

        case 'skill': {
            const slug = input!.slug;
            if (typeof slug !== 'string' || !slug) {
                return { error: 'A "skill" host request needs a skill "slug".' };
            }
            const skill = hostSkills(skills).find(entry => entry.slug === slug);
            return {
                // ``null`` for a platform skill: the platform holds its
                // instructions and asks only for the host tools that name it.
                skill: skill ? toSkillAnswer(skill) : null,
                tools: hostTools(tools)
                    .filter(([, definition]) => (definition.skills ?? []).includes(slug))
                    .map(([name, definition]) => toClientToolSpec(name, definition)),
            };
        }

        case 'all_definitions': {
            const sharedOnly = input!.shared_only === true;
            return {
                tools: hostTools(tools)
                    .filter(([, definition]) => !sharedOnly || definition.share_with_sub_agents === true)
                    .map(([name, definition]) => toClientToolSpec(name, definition)),
            };
        }

        default:
            return {
                error: input
                    ? `Unknown host request op '${String(op)}'.`
                    : 'A host request must be an object naming an "op".',
            };
    }
}
