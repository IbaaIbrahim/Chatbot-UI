import type { MessageStep } from '../components/MessageBubble/MessageBubble';
import { formatLabel, type ChatLabels } from './labels';
import { describeMetaTool, isMetaTool, type MetaToolDescription } from './metaTools';

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

export type ActivityLabels = Pick<
    ChatLabels,
    | 'thinking'
    | 'thoughtBriefly'
    | 'toolRunning'
    | 'toolRan'
    | 'toolFailed'
    | 'activityThoughtOne'
    | 'activityThoughtOther'
    | 'activitySearchedOne'
    | 'activitySearchedOther'
    | 'activityLoadedSkillOne'
    | 'activityLoadedSkillOther'
    | 'activityLoadedToolsOne'
    | 'activityLoadedToolsOther'
    | 'activityRanOne'
    | 'activityRanRepeated'
    | 'activityRanOther'
    | 'activityAgentOne'
    | 'activityAgentOther'
    | 'activityAgentWorking'
    | 'activityFailed'
    | 'activitySeparator'
    | 'metaSearchingTools'
    | 'metaSearchedTools'
    | 'metaLoadingTools'
    | 'metaLoadedTools'
    | 'metaSearchingSkills'
    | 'metaSearchedSkills'
    | 'metaLoadingSkill'
    | 'metaLoadedSkill'
    | 'metaRefused'
>;

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

function capitalise(text: string): string {
    return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}

function count(n: number, one: string, other: string, values: Record<string, string | number> = {}): string {
    return formatLabel(n === 1 ? one : other, { count: n, ...values });
}

/**
 * The finished section's header: what happened, counted, in a fixed order —
 * thinking, searches, loads, tools, sub-agents — then how many failed.
 */
export function summarizeActivity(
    steps: MessageStep[],
    labels: ActivityLabels,
    toolName: (name: string) => string = name => name,
): string {
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
            agents.push(step.agentName || 'Sub-agent');
            continue;
        }
        const slug = slugOf(step);
        if (slug === 'search_tools' || slug === 'search_skills') searches += 1;
        else if (slug === 'load_skill') skillLoads += 1;
        else if (slug === 'load_tool') toolLoads += 1;
        else if (isMetaTool(slug)) continue;
        else toolCalls.push(toolName(step.toolName || slug || 'tool'));
    }

    const parts: string[] = [];
    if (thoughts) parts.push(count(thoughts, labels.activityThoughtOne, labels.activityThoughtOther));
    if (searches) parts.push(count(searches, labels.activitySearchedOne, labels.activitySearchedOther));
    if (skillLoads) parts.push(count(skillLoads, labels.activityLoadedSkillOne, labels.activityLoadedSkillOther));
    if (toolLoads) parts.push(count(toolLoads, labels.activityLoadedToolsOne, labels.activityLoadedToolsOther));
    if (toolCalls.length) {
        const distinct = [...new Set(toolCalls)];
        parts.push(
            distinct.length === 1
                ? count(toolCalls.length, labels.activityRanOne, labels.activityRanRepeated, { name: distinct[0] })
                : count(toolCalls.length, labels.activityRanOne, labels.activityRanOther, { name: distinct[0] }),
        );
    }
    if (agents.length) {
        parts.push(count(agents.length, labels.activityAgentOne, labels.activityAgentOther, { name: agents[0] }));
    }
    if (failed) parts.push(formatLabel(labels.activityFailed, { count: failed }));
    return capitalise(parts.join(labels.activitySeparator));
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
    labels: ActivityLabels,
    toolName: (name: string) => string = name => name,
): ActivityLine {
    const running = [...steps].reverse().find(isStepRunning);
    const step = running ?? steps[steps.length - 1];
    if (!step) return { text: labels.thinking };

    if (step.type === 'thinking') {
        if (!step.isFinished) return { text: latestThoughtLine(step.content) ?? labels.thinking };
        return { text: labels.thoughtBriefly };
    }

    if (step.type === 'sub-agent') {
        const name = step.agentName || 'Sub-agent';
        return {
            text: capitalise(
                step.toolStatus === 'running'
                    ? formatLabel(labels.activityAgentWorking, { name })
                    : formatLabel(labels.activityAgentOne, { name }),
            ),
        };
    }

    const slug = slugOf(step);
    const status = step.toolStatus ?? 'completed';
    const meta: MetaToolDescription | null = isMetaTool(slug)
        ? describeMetaTool(slug, status, step.toolArgs, step.toolResult, labels, toolName)
        : null;
    if (meta) return meta.detail ? { text: meta.text, detail: meta.detail } : { text: meta.text };

    const verb = status === 'running' ? labels.toolRunning : status === 'failed' ? labels.toolFailed : labels.toolRan;
    return { text: verb, detail: toolName(step.toolName || slug || 'tool') };
}
