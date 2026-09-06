import type { MessageProps } from '../components/MessageBubble/MessageBubble';
import type { ContextFigures, TreeFigures, UsageFigures } from '../api/types';

/**
 * What the composer's consumption indicator shows: the latest turn's cost, the
 * conversation's running total, and where the last prompt sat against the
 * model's window.
 *
 * Derived from the messages rather than kept separately, because the messages
 * are already where the `usage` stream event and the history hydration put the
 * figures (see useStreamChat / useConversations). One source, two views.
 *
 * A turn is everything the user's message caused: the root agent's run *and*
 * every sub-agent run it started. The first version summed only the root run
 * and read "3 credits" on a turn whose sub-agents had spent 19 more.
 */
export interface TurnUsageSummary {
    /** The whole turn: root run plus every sub-agent run. */
    turn: UsageFigures;
    /** The root agent's own run — what `turn` is when nothing was delegated. */
    ownRun: UsageFigures;
    /** The sub-agents' share, or null when the turn started none. */
    subAgents: { count: number; figures: UsageFigures } | null;
    /**
     * The sub-agent run whose last prompt sat highest in its window. Each
     * sub-agent has its own context, which ends with it; the root agent's
     * context (``context`` below) is what carries into the next turn.
     */
    subAgentContext: { agentName: string | null; context: ContextFigures } | null;
    /** Sum of every turn's credits in this conversation. */
    conversationCredits: number;
    /** How many turns contributed to that sum. */
    turns: number;
    context: ContextFigures | null;
    tree: TreeFigures | null;
    /** The orchestrator warned that the prompt reached 90% of the window. */
    contextPressure: boolean;
    /** Whether the turn the figures describe is still running. */
    live: boolean;
}

const NO_USAGE: UsageFigures = {
    steps: 0, input_tokens: 0, output_tokens: 0, credits_charged: 0, credits_waived: 0,
};

function add(a: UsageFigures, b: UsageFigures): UsageFigures {
    return {
        steps: a.steps + b.steps,
        input_tokens: a.input_tokens + b.input_tokens,
        output_tokens: a.output_tokens + b.output_tokens,
        credits_charged: a.credits_charged + b.credits_charged,
        credits_waived: a.credits_waived + b.credits_waived,
    };
}

/**
 * One turn's cost. Tokens and steps are the sum over the runs; credits take
 * the tree counter when the orchestrator reported one, because it also counts
 * a run whose events this client never saw, and never less than the sum.
 */
export function turnUsage(message: MessageProps): {
    turn: UsageFigures;
    ownRun: UsageFigures;
    subAgents: TurnUsageSummary['subAgents'];
} {
    const ownRun = message.usage ?? NO_USAGE;
    const runs = Object.values(message.subAgentRuns ?? {});
    const subAgentFigures = runs.reduce((sum, run) => add(sum, run.figures), NO_USAGE);
    const summed = add(ownRun, subAgentFigures);
    const treeCredits = message.tree?.credits_spent;
    const turn: UsageFigures = {
        ...summed,
        credits_charged: typeof treeCredits === 'number'
            ? Math.max(treeCredits, summed.credits_charged)
            : summed.credits_charged,
    };
    return {
        turn,
        ownRun,
        subAgents: runs.length > 0 ? { count: runs.length, figures: subAgentFigures } : null,
    };
}

function largestSubAgentContext(message: MessageProps): TurnUsageSummary['subAgentContext'] {
    let largest: TurnUsageSummary['subAgentContext'] = null;
    for (const run of Object.values(message.subAgentRuns ?? {})) {
        if (!run.context) continue;
        const current = largest?.context;
        const bigger = current === undefined
            || (run.context.ratio ?? 0) > (current.ratio ?? 0)
            || ((run.context.ratio ?? 0) === (current.ratio ?? 0)
                && run.context.input_tokens > current.input_tokens);
        if (bigger) largest = { agentName: run.agentName ?? null, context: run.context };
    }
    return largest;
}

export function summarizeUsage(messages: MessageProps[], live: boolean): TurnUsageSummary | null {
    const metered = messages.filter(m => m.role === 'assistant' && (m.usage || m.subAgentRuns));
    if (metered.length === 0) return null;
    const latest = metered[metered.length - 1];
    const lastWithContext = [...metered].reverse().find(m => m.context);
    const lastWithTree = [...metered].reverse().find(m => m.tree);
    const { turn, ownRun, subAgents } = turnUsage(latest);
    return {
        turn,
        ownRun,
        subAgents,
        subAgentContext: largestSubAgentContext(latest),
        conversationCredits: metered.reduce((sum, m) => sum + turnUsage(m).turn.credits_charged, 0),
        turns: metered.length,
        context: lastWithContext?.context ?? null,
        tree: lastWithTree?.tree ?? null,
        contextPressure: Boolean(latest.contextPressure),
        live,
    };
}
