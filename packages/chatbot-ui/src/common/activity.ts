import type { MessageStep } from '../components/MessageBubble/MessageBubble';
import {
    canonicalLanguage,
    formatLabel,
    formatPlural,
    withCurrentNames,
    type ChatLabels,
    type DeprecatedLabelInputs,
    type LabelKey,
    type LabelValue,
    type PluralLabel,
} from './labels';
import { describeMetaTool, isMetaTool, type MetaToolDescription, type MetaToolLabels } from './metaTools';
import { resolveToolDisplayName } from './toolConfig';

/**
 * The agent's working between two pieces of its answer, as one section.
 *
 * A turn in central mode is a chain of small steps — think, search the skills,
 * load one, think, run a tool, think — and drawn one row each, the working
 * pushed the answer a screen down (2026-10-13: nine rows before the first word of
 * a five-row table). A run of consecutive **activity** steps — thinking, tool
 * calls, sub-agent runs — is now one collapsible section:
 *
 * - **while it runs**, its header is the latest step in words ("Running List
 *   Inspections", the last line of the current thought);
 * - **once done**, the header counts what happened ("Thought 4 times · searched
 *   2 times · loaded a skill · ran List Inspections");
 * - **opened**, it shows every step as before.
 *
 * Anything else ends a run and stays in view: the answer's text, an approval
 * waiting for the user, an error with its button, a notice. A run of one step is
 * drawn as that step — a section around a single row says nothing more.
 */

export type ActivityItem =
    | { type: 'single'; step: MessageStep; index: number }
    | { type: 'activity'; steps: MessageStep[]; index: number };

/** What a header says: the words, and an optional lighter detail after them. */
export interface ActivityLine {
    text: string;
    detail?: string;
}

/** Labels as a helper takes them: a counting one may be a plain text (every form) as well as plural forms. */
type Given<Labels> = { [Key in keyof Labels]: Labels[Key] extends PluralLabel ? LabelValue : Labels[Key] };

/** The activity labels 4.2 renamed: a hand-made 4.1 object gives them by their old names. */
const RENAMED_ACTIVITY_KEYS = [
    'activityThoughts',
    'activitySearches',
    'activitySkillLoads',
    'activityToolLoads',
    'activityRanTool',
    'activityRanToolTimes',
    'activityRanTools',
    'activityUsedAgent',
    'activityUsedAgents',
] as const satisfies readonly LabelKey[];

type RenamedActivityKey = typeof RENAMED_ACTIVITY_KEYS[number];

/** The 4.1 names of {@link RENAMED_ACTIVITY_KEYS}. */
type DeprecatedActivityKey =
    | 'activityThoughtOne' | 'activityThoughtOther'
    | 'activitySearchedOne' | 'activitySearchedOther'
    | 'activityLoadedSkillOne' | 'activityLoadedSkillOther'
    | 'activityLoadedToolsOne' | 'activityLoadedToolsOther'
    | 'activityRanOne' | 'activityRanRepeated' | 'activityRanOther'
    | 'activityAgentOne' | 'activityAgentOther';

/**
 * The labels the activity header is written in — `useLabels()` has them all.
 * The counts are plural labels since 4.2 (`activityThoughts`, …). A host that
 * calls these helpers with a hand-made 4.1 object, by the 4.1 one/other
 * names (`activityThoughtOne` / `activityThoughtOther`, …), still may: each
 * renamed label it leaves out is read from its 4.1 names, else the library's
 * English.
 */
export type ActivityLabels = Given<Pick<
    ChatLabels,
    | 'thinking'
    | 'thoughtBriefly'
    | 'toolRunning'
    | 'toolRan'
    | 'toolFailed'
    | 'toolName'
    | 'subAgentName'
    | 'activityAgentWorking'
    | 'activityFailed'
    | 'activitySeparator'
>> & Partial<Given<Pick<ChatLabels, RenamedActivityKey>>>
    & Pick<DeprecatedLabelInputs, DeprecatedActivityKey>
    & MetaToolLabels;

/** How a helper names a tool: by its slug, with the platform's own name for it as the last resort. */
export type ToolNamer = (slugOrName: string, rawName?: string) => string;

/** {@link ActivityLabels} with every renamed label present by its current name. */
function current(labels: ActivityLabels): ActivityLabels & Given<Pick<ChatLabels, RenamedActivityKey>> {
    return withCurrentNames(labels, RENAMED_ACTIVITY_KEYS) as ActivityLabels & Given<Pick<ChatLabels, RenamedActivityKey>>;
}

/** Without a namer of the host's: the platform tool's label, else the platform's name, else the slug in words. */
function defaultNamer(labels: ActivityLabels): ToolNamer {
    return (slugOrName, rawName) => resolveToolDisplayName(slugOrName, undefined, { labels: labels as Pick<ChatLabels, 'toolName'>, rawName });
}

/** Longest a live thought is shown in a header before it is cut. */
export const LIVE_THOUGHT_CHARS = 120;

const ACTIVITY_TYPES = new Set<MessageStep['type']>(['thinking', 'tool-call', 'sub-agent']);

export function isActivityStep(step: MessageStep): boolean {
    return ACTIVITY_TYPES.has(step.type);
}

/** Whether a step is still going: a thought being written, a call not answered. */
export function isStepRunning(step: MessageStep): boolean {
    if (step.type === 'thinking') return !step.isFinished;
    return step.toolStatus === 'running';
}

/** The steps as drawn: runs of two or more activity steps become one section. */
export function groupActivity(steps: MessageStep[]): ActivityItem[] {
    const items: ActivityItem[] = [];
    let run: MessageStep[] = [];
    let runStart = 0;

    const flush = () => {
        if (run.length === 1) items.push({ type: 'single', step: run[0], index: runStart });
        else if (run.length > 1) items.push({ type: 'activity', steps: run, index: runStart });
        run = [];
    };

    steps.forEach((step, index) => {
        if (isActivityStep(step)) {
            if (run.length === 0) runStart = index;
            run.push(step);
            return;
        }
        flush();
        items.push({ type: 'single', step, index });
    });
    flush();
    return items;
}

function slugOf(step: MessageStep): string {
    return step.toolSlug || step.toolName || '';
}

function capitalise(text: string, language?: string): string {
    if (!text) return text;
    try {
        return text.charAt(0).toLocaleUpperCase(canonicalLanguage(language)) + text.slice(1);
    } catch {
        return text.charAt(0).toLocaleUpperCase() + text.slice(1);
    }
}

/**
 * The finished section's header: what happened, counted, in a fixed order —
 * thinking, searches, loads, tools, sub-agents — then how many failed. Each
 * count's form is the one `language`'s plural rules choose (see `formatPlural`).
 */
export function summarizeActivity(
    steps: MessageStep[],
    given: ActivityLabels,
    toolName: ToolNamer = defaultNamer(given),
    language?: string,
): string {
    const labels = current(given);
    const count = (label: LabelValue, n: number, values: Record<string, string | number> = {}) =>
        formatPlural(label, n, values, language);
    let thoughts = 0;
    let searches = 0;
    let skillLoads = 0;
    let toolLoads = 0;
    let failed = 0;
    const toolCalls: string[] = [];
    const agents: string[] = [];

    for (const step of steps) {
        if (step.type === 'thinking') {
            thoughts += 1;
            continue;
        }
        if (step.toolStatus === 'failed') failed += 1;
        if (step.type === 'sub-agent') {
            agents.push(step.agentName || labels.subAgentName);
            continue;
        }
        const slug = slugOf(step);
        if (slug === 'search_tools' || slug === 'search_skills') searches += 1;
        else if (slug === 'load_skill') skillLoads += 1;
        else if (slug === 'load_tool') toolLoads += 1;
        else if (isMetaTool(slug)) continue;
        else toolCalls.push(slug ? toolName(slug, step.toolName) : labels.toolName);
    }

    const parts: string[] = [];
    if (thoughts) parts.push(count(labels.activityThoughts, thoughts));
    if (searches) parts.push(count(labels.activitySearches, searches));
    if (skillLoads) parts.push(count(labels.activitySkillLoads, skillLoads));
    if (toolLoads) parts.push(count(labels.activityToolLoads, toolLoads));
    if (toolCalls.length) {
        // One call names its tool; several calls to one tool name it and count
        // them; calls to several tools are counted.
        const distinct = [...new Set(toolCalls)];
        parts.push(
            toolCalls.length === 1
                ? formatLabel(labels.activityRanTool, { name: distinct[0] })
                : distinct.length === 1
                    ? count(labels.activityRanToolTimes, toolCalls.length, { name: distinct[0] })
                    : count(labels.activityRanTools, toolCalls.length, { name: distinct[0] }),
        );
    }
    if (agents.length) {
        parts.push(
            agents.length === 1
                ? formatLabel(labels.activityUsedAgent, { name: agents[0] })
                : count(labels.activityUsedAgents, agents.length, { name: agents[0] }),
        );
    }
    if (failed) parts.push(count(labels.activityFailed, failed));
    return capitalise(parts.join(labels.activitySeparator), language);
}

/** The last non-empty line of a thought, cut to {@link LIVE_THOUGHT_CHARS}. */
export function latestThoughtLine(content: string | undefined): string | null {
    const lines = (content ?? '')
        .split('\n')
        // Markdown's emphasis and code marks go; a lone `_` stays — it is
        // usually part of a name (`updated_at`).
        .map(line => line.replace(/^[#>*\-\s]+/, '').replace(/\*+|__|`/g, '').trim())
        .filter(Boolean);
    const last = lines[lines.length - 1];
    if (!last) return null;
    return last.length > LIVE_THOUGHT_CHARS ? `${last.slice(0, LIVE_THOUGHT_CHARS - 1).trimEnd()}…` : last;
}

/**
 * The running section's header: the newest step in words.
 *
 * The step still running wins over a later finished one (calls run in parallel);
 * otherwise the last step, which is what was just done while the next is awaited.
 */
export function describeLatestActivity(
    steps: MessageStep[],
    given: ActivityLabels,
    toolName: ToolNamer = defaultNamer(given),
    language?: string,
): ActivityLine {
    const labels = current(given);
    const running = [...steps].reverse().find(isStepRunning);
    const step = running ?? steps[steps.length - 1];
    if (!step) return { text: labels.thinking };

    if (step.type === 'thinking') {
        if (!step.isFinished) return { text: latestThoughtLine(step.content) ?? labels.thinking };
        return { text: labels.thoughtBriefly };
    }

    if (step.type === 'sub-agent') {
        const name = step.agentName || labels.subAgentName;
        return {
            text: capitalise(
                step.toolStatus === 'running'
                    ? formatLabel(labels.activityAgentWorking, { name })
                    : formatLabel(labels.activityUsedAgent, { name }),
                language,
            ),
        };
    }

    const slug = slugOf(step);
    const status = step.toolStatus ?? 'completed';
    const meta: MetaToolDescription | null = isMetaTool(slug)
        ? describeMetaTool(slug, status, step.toolArgs, step.toolResult, labels, name => toolName(name), language)
        : null;
    if (meta) return meta.detail ? { text: meta.text, detail: meta.detail } : { text: meta.text };

    const verb = status === 'running' ? labels.toolRunning : status === 'failed' ? labels.toolFailed : labels.toolRan;
    return { text: verb, detail: slug ? toolName(slug, step.toolName) : labels.toolName };
}
