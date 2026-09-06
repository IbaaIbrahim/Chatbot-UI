import React from 'react';
import type { TurnUsageSummary } from '../../common/usageSummary';
import type { UsageFigures } from '../../api/types';
import './UsageIndicator.css';

/** Where the orchestrator itself starts warning about the window. */
const NEAR_WINDOW_RATIO = 0.9;

const { useId, useState } = React;

export function formatTokens(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (count >= 10_000) return `${Math.round(count / 1000)}k`;
    if (count >= 1_000) return `${(count / 1000).toFixed(1)}k`;
    return String(count);
}

function formatPercent(ratio: number): string {
    const percent = ratio * 100;
    if (percent >= 99.5) return '100%';
    return percent < 10 ? `${percent.toFixed(1)}%` : `${Math.round(percent)}%`;
}

function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export interface UsageIndicatorProps {
    summary: TurnUsageSummary;
}

interface RingProps {
    ratio: number | null;
    warn: boolean;
    live: boolean;
}

/**
 * A small ring: the filled arc is how much of the model's window the last
 * prompt used. No window known, no arc — an empty ring is honest, a guessed one
 * is not.
 */
const Ring: React.FC<RingProps> = ({ ratio, warn, live }) => {
    const radius = 7;
    const circumference = 2 * Math.PI * radius;
    const filled = ratio === null ? 0 : Math.min(1, Math.max(0, ratio)) * circumference;
    return (
        <svg
            className={`cb-usage-ring${warn ? ' cb-usage-ring--warn' : ''}${live ? ' cb-usage-ring--live' : ''}`}
            viewBox="0 0 18 18"
            width="16"
            height="16"
            aria-hidden="true"
        >
            <circle className="cb-usage-ring-track" cx="9" cy="9" r={radius} />
            {ratio !== null && (
                <circle
                    className="cb-usage-ring-fill"
                    cx="9"
                    cy="9"
                    r={radius}
                    strokeDasharray={`${filled} ${circumference - filled}`}
                    transform="rotate(-90 9 9)"
                />
            )}
        </svg>
    );
};

interface MeterRowProps {
    label: string;
    value: string;
    ratio: number | null;
    warn?: boolean;
    note?: string;
    /** A breakdown line under the row above it: indented, quieter, no bar. */
    sub?: boolean;
}

function describeFigures(figures: UsageFigures): string {
    return `${formatTokens(figures.input_tokens)} in · ${formatTokens(figures.output_tokens)} out · ${plural(figures.steps, 'step')}`;
}

/**
 * One entry of the popover: label and figure on one line, the note on its own
 * line beneath (never squeezed between them, where it wrapped one word per
 * line), and a bar when there is a denominator.
 */
const MeterRow: React.FC<MeterRowProps> = ({ label, value, ratio, warn, note, sub }) => (
    <div className={`cb-usage-row${warn ? ' cb-usage-row--warn' : ''}${sub ? ' cb-usage-row--sub' : ''}`}>
        <div className="cb-usage-row-head">
            <span className="cb-usage-row-label">{label}</span>
            <span className="cb-usage-row-value">{value}</span>
        </div>
        {note && <div className="cb-usage-row-note">{note}</div>}
        {ratio !== null && (
            <div className="cb-usage-bar" aria-hidden="true">
                <i style={{ width: `${Math.min(100, Math.max(ratio > 0 ? 1 : 0, ratio * 100))}%` }} />
            </div>
        )}
    </div>
);

/**
 * The consumption indicator under the composer.
 *
 * At rest: a ring for the context window and the percentage beside it (or the
 * turn's credits when the model's window is not known). On hover, focus or tap:
 * a card with the context window against the model's limit, this turn's and
 * this conversation's credits, the tokens, any waived free calls, and the
 * sub-agent tree against its ceiling when one is set.
 *
 * The figures are what the orchestrator reports after every settled step — the
 * `usage` stream event, or the job's totals when the thread was loaded from
 * history. Cumulative values are replaced on each event, never summed here, so
 * a replayed stream cannot double-count.
 */
export const UsageIndicator: React.FC<UsageIndicatorProps> = ({ summary }) => {
    const [open, setOpen] = useState(false);
    const popoverId = useId();
    const {
        turn, ownRun, subAgents, subAgentContext, conversationCredits, turns, context, tree, contextPressure, live,
    } = summary;
    const subAgentRatio = subAgentContext?.context.ratio ?? null;

    const ratio = context?.ratio ?? null;
    const window = context?.max_input_tokens ?? null;
    const pressured = contextPressure || (ratio !== null && ratio >= NEAR_WINDOW_RATIO);
    const ceiling = tree?.max_tree_credits ?? null;
    const showTree = tree !== null && (ceiling !== null || Boolean(tree.ceiling_reached));
    const treeRatio = ceiling ? Math.min(1, tree!.credits_spent / ceiling) : null;

    const atRestLabel = ratio !== null
        ? formatPercent(ratio)
        : plural(turn.credits_charged, 'credit');
    const summaryForScreenReader = ratio !== null && window !== null
        ? `Context window ${formatPercent(ratio)} used; ${plural(turn.credits_charged, 'credit')} this turn; ${plural(conversationCredits, 'credit')} this conversation.`
        : `${plural(turn.credits_charged, 'credit')} this turn; ${plural(conversationCredits, 'credit')} this conversation.`;

    return (
        <div
            className="cb-usage-indicator"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            onFocus={() => setOpen(true)}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
            }}
            onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
        >
            <button
                type="button"
                className={`cb-usage-trigger${pressured ? ' cb-usage-trigger--warn' : ''}`}
                aria-label={`Consumption. ${summaryForScreenReader}`}
                aria-describedby={open ? popoverId : undefined}
                aria-expanded={open}
                onClick={() => setOpen(value => !value)}
            >
                <Ring ratio={ratio} warn={pressured} live={live} />
                <span className="cb-usage-trigger-label">{atRestLabel}</span>
            </button>

            <div id={popoverId} role="tooltip" className="cb-usage-popover" hidden={!open}>
                <MeterRow
                    label="Context window"
                    value={window !== null && ratio !== null
                        ? `${formatTokens(context!.input_tokens)} / ${formatTokens(window)} (${formatPercent(ratio)})`
                        : `${formatTokens(context?.input_tokens ?? ownRun.input_tokens)} · limit unknown`}
                    ratio={ratio}
                    warn={pressured}
                    note={subAgents ? "this agent's last prompt" : undefined}
                />
                {subAgentContext && (
                    <MeterRow
                        sub
                        label={`Sub-agent · ${subAgentContext.agentName ?? 'largest prompt'}`}
                        value={subAgentContext.context.max_input_tokens !== null && subAgentRatio !== null
                            ? `${formatTokens(subAgentContext.context.input_tokens)} / ${formatTokens(subAgentContext.context.max_input_tokens)} (${formatPercent(subAgentRatio)})`
                            : `${formatTokens(subAgentContext.context.input_tokens)} · limit unknown`}
                        ratio={null}
                        warn={subAgentRatio !== null && subAgentRatio >= NEAR_WINDOW_RATIO}
                        note="its own context; ends with the run"
                    />
                )}
                {pressured && (
                    <p className="cb-usage-hint">
                        The conversation is near the model's limit. Start a new one to keep answers reliable.
                    </p>
                )}

                <div className="cb-usage-section">
                    <span>Your usage · this conversation</span>
                    {live && <span className="cb-usage-live">updating</span>}
                </div>
                <MeterRow
                    label="This turn"
                    value={plural(turn.credits_charged, 'credit')}
                    ratio={conversationCredits > 0 ? turn.credits_charged / conversationCredits : null}
                    note={describeFigures(turn)}
                />
                {subAgents && (
                    <>
                        <MeterRow
                            sub
                            label="This agent"
                            value={plural(ownRun.credits_charged, 'credit')}
                            ratio={null}
                            note={describeFigures(ownRun)}
                        />
                        <MeterRow
                            sub
                            label={`Sub-agents (${subAgents.count})`}
                            value={plural(subAgents.figures.credits_charged, 'credit')}
                            ratio={null}
                            note={describeFigures(subAgents.figures)}
                        />
                    </>
                )}
                <MeterRow
                    label="Whole conversation"
                    value={plural(conversationCredits, 'credit')}
                    ratio={null}
                    note={plural(turns, 'turn')}
                />
                {turn.credits_waived > 0 && (
                    <MeterRow
                        label="Free calls this turn"
                        value={`${plural(turn.credits_waived, 'credit')} waived`}
                        ratio={null}
                    />
                )}
                {showTree && tree && (
                    <MeterRow
                        label="Sub-agent tree"
                        value={ceiling !== null
                            ? `${tree.credits_spent} / ${ceiling} (${formatPercent(tree.credits_spent / ceiling)})`
                            : plural(tree.credits_spent, 'credit')}
                        ratio={treeRatio}
                        warn={Boolean(tree.ceiling_reached)}
                        note={tree.ceiling_reached ? 'limit reached — no new sub-agents this turn' : undefined}
                    />
                )}

                <p className="cb-usage-foot">Updates after every step. Each step is charged once it completes.</p>
            </div>
        </div>
    );
};
