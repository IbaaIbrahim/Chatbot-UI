/**
 * The platform's meta-tools, and the compact text their steps render as.
 *
 * A job sent without an agent runs the platform's central mode: the model
 * starts with these four tools only and loads what the turn needs while it
 * runs — a tool by name, or a skill (instructions, plus the tools it needs).
 * Drawn like any other tool call they read "Ran Search tools", "Ran Load
 * tools", one row per step, which says nothing a user wants to know and
 * buries the call that answered. Drawn as what they did — "Loaded skill ·
 * Audit planning", "Loaded tools · Web search" — they say which specialist and
 * which tools the answer came from, in the words of the step itself.
 *
 * The result shapes are the Orchestrator's harness tools (ADR-018 and
 * `app/services/harness_tools.py` under `services/orchestrator` in the
 * platform repo):
 *
 * - `load_tool` → `{ loaded: string[], refused: [{ name, reason }],
 *   evicted?: string[], note? }`
 * - `load_skill` → `{ skill: { slug, name, source, uuid? }, instructions,
 *   tools_loaded: string[], tools_unavailable: string[], evicted?,
 *   evicted_skills?, note? }` — `source` is `platform` or `host`; a host
 *   (client) skill has no `uuid`, which is why the name, then the slug, is
 *   what the row reads.
 * - `search_tools` / `search_skills` → a ranked list; only the call's query is
 *   shown, since the model reads the list and the user does not need to.
 *
 * Since the host catalogue these cover the application's own tools and skills
 * too, read from the browser while the step runs (`common/hostCatalogue.ts`):
 * the request rides on the meta-tool's own step, so it adds no row of its
 * own. `evicted` names what a load pushed out past the run's caps (least
 * recently used first), and `note` says when the application did not answer;
 * neither changes the row, whose details show both.
 *
 * A call that failed gets no summary: the generic row says "Failed" and its
 * details hold the reason, which a summary line would only hide. (The
 * harness's own refusals — `tool_not_loaded` for a tool the run has not
 * loaded, `unknown_tool` for a name that does not exist — land on the step of
 * the tool that was called, so they render as that tool's failed row.)
 */

import { parseToolOutput } from '../api/toolOutput';
import { DEFAULT_LABELS, formatLabel, formatPlural } from './labels';
import type { ChatLabels, LabelValue } from './labels';
import { formatList } from './i18n';

export const META_TOOL_SLUGS = ['search_tools', 'load_tool', 'search_skills', 'load_skill'] as const;

export type MetaToolSlug = typeof META_TOOL_SLUGS[number];

/** A step's state, as `MessageStep.toolStatus` and `ToolInvocation` carry it. */
export type MetaToolStatus = 'running' | 'completed' | 'failed';

/** The labels a meta-tool row is written in; `DEFAULT_LABELS` or a host's set. */
export type MetaToolLabels = Pick<
    ChatLabels,
    | 'metaSearchingTools'
    | 'metaSearchedTools'
    | 'metaLoadingTools'
    | 'metaLoadedTools'
    | 'metaSearchingSkills'
    | 'metaSearchedSkills'
    | 'metaLoadingSkill'
    | 'metaLoadedSkill'
> & {
    /** A plain text (every form) or plural forms. */
    metaRefused: LabelValue;
    /** Since 4.2; the library's English when left out. */
    quotedText?: string;
    /** Since 4.2; the library's English when left out. */
    parenthetical?: string;
};

export interface MetaToolDescription {
    /** The row's text, in place of the verb and tool name: "Loaded tools · a, b". */
    text: string;
    /**
     * Something of the call's own beside the text, drawn muted: a search's
     * query, or what a load in progress asked for. Never a label — it is the
     * model's words or the platform's names, so it needs no translation.
     */
    detail?: string;
}

const META_TOOL_SET: ReadonlySet<string> = new Set(META_TOOL_SLUGS);

/** Whether a step's slug is one of the platform's four meta-tools. */
export function isMetaTool(slug: string | null | undefined): slug is MetaToolSlug {
    return typeof slug === 'string' && META_TOOL_SET.has(slug);
}

function stringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
        : [];
}

function nonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, any> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

/**
 * The compact text a meta-tool step renders as, or `null` for the generic row.
 *
 * `null` for anything that is not a meta-tool, for a failed call (see the
 * module comment), and for a completed load that cannot say what it loaded —
 * "Loaded tools · " with nothing after it would claim a load the details may
 * contradict. `result` may be the raw `tool_output` string or already parsed.
 *
 * `toolName` turns the tool names a load reports into what the user should
 * read — the chat passes `resolveToolDisplayName` with the host's tools, so
 * `web_search` reads "Web search". Without it the names are shown as sent.
 */
export function describeMetaTool(
    slug: string,
    status: MetaToolStatus,
    args: unknown,
    result: unknown,
    labels: MetaToolLabels,
    toolName: (name: string) => string = name => name,
    language?: string,
): MetaToolDescription | null {
    if (!isMetaTool(slug) || status === 'failed') return null;
    const running = status === 'running';
    const input = asRecord(args);

    switch (slug) {
        case 'search_tools':
        case 'search_skills': {
            const tools = slug === 'search_tools';
            const text = running
                ? (tools ? labels.metaSearchingTools : labels.metaSearchingSkills)
                : (tools ? labels.metaSearchedTools : labels.metaSearchedSkills);
            const query = nonEmptyString(input?.query);
            return query
                ? { text, detail: formatLabel(labels.quotedText ?? DEFAULT_LABELS.quotedText, { text: query }) }
                : { text };
        }

        case 'load_tool': {
            const requested = stringList(input?.names).map(toolName);
            if (running) {
                return requested.length > 0
                    ? { text: labels.metaLoadingTools, detail: formatList(requested, language) }
                    : { text: labels.metaLoadingTools };
            }
            const output = asRecord(parseToolOutput(result));
            // Without an output (a history row written before the output was,
            // or text that is not JSON) the call still completed, so what it
            // asked for is the best account there is; refusals are unknowable
            // then, and none are claimed.
            const loaded = output && Array.isArray(output.loaded)
                ? stringList(output.loaded).map(toolName)
                : requested;
            if (loaded.length === 0) return null;
            const refusedCount = Array.isArray(output?.refused) ? output!.refused.length : 0;
            const text = formatLabel(labels.metaLoadedTools, { names: formatList(loaded, language) });
            return {
                text: refusedCount > 0
                    ? formatLabel(labels.parenthetical ?? DEFAULT_LABELS.parenthetical, {
                        text,
                        detail: formatPlural(labels.metaRefused, refusedCount, {}, language),
                    })
                    : text,
            };
        }

        case 'load_skill': {
            const requested = nonEmptyString(input?.skill);
            if (running) {
                return requested ? { text: labels.metaLoadingSkill, detail: requested } : { text: labels.metaLoadingSkill };
            }
            const skill = asRecord(asRecord(parseToolOutput(result))?.skill);
            const name = nonEmptyString(skill?.name) ?? nonEmptyString(skill?.slug) ?? requested;
            return name ? { text: formatLabel(labels.metaLoadedSkill, { name }) } : null;
        }

        default:
            return null;
    }
}
