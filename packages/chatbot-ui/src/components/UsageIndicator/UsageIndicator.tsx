import React from 'react';
import type { TurnUsageSummary } from '../../common/usageSummary';
import type { UsageFigures } from '../../api/types';
import { useStableId } from '../../common/useStableId';
import { formatCount, formatLabel } from '../../common/labels';
import type { ChatLabels } from '../../common/labels';
import { useLabels } from '../../store/hooks';
import './UsageIndicator.css';

/** Where the orchestrator itself starts warning about the window. */
const NEAR_WINDOW_RATIO = 0.9;

const { useEffect, useRef, useState } = React;

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

function describeFigures(figures: UsageFigures, labels: ChatLabels): string {
    return formatLabel(labels.usageTokens, {
        input: formatTokens(figures.input_tokens),
        output: formatTokens(figures.output_tokens),
        steps: formatCount(figures.steps, labels.stepsOne, labels.stepsOther),
    });
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
 * turn's credits when the model's window is not known). On click — and closed
 * only by a second click on the trigger, a click outside, or Escape — a card
 * with the context window against the model's limit, this turn's and
 * this conversation's credits, the tokens, any waived free calls, and the
 * sub-agent tree against its ceiling when one is set.
 *
 * The figures are what the orchestrator reports after every settled step — the
 * `usage` stream event, or the job's totals when the thread was loaded from
 * history. Cumulative values are replaced on each event, never summed here, so
 * a replayed stream cannot double-count.
 */
export const UsageIndicator: React.FC<UsageIndicatorProps> = ({ summary }) => {
    const labels = useLabels();
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const popoverId = useStableId('cb-usage');

    // The card opens on a click on the trigger and closes only on a second
    // click on it, a click outside the indicator, or Escape — never because
    // the pointer left, so the figures stay readable while the turn updates.
    useEffect(() => {
        if (!open) return;

        const handlePointerDown = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);
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

    const credits = (count: number) => formatCount(count, labels.creditsOne, labels.creditsOther);
    const limitUnknown = (tokens: number) => formatLabel(labels.usageLimitUnknown, { tokens: formatTokens(tokens) });

    const atRestLabel = ratio !== null ? formatPercent(ratio) : credits(turn.credits_charged);
    const summaryForScreenReader = formatLabel(
        ratio !== null && window !== null ? labels.usageSummaryWithWindow : labels.usageSummary,
        {
            percent: ratio !== null ? formatPercent(ratio) : '',
            turnCredits: credits(turn.credits_charged),
            conversationCredits: credits(conversationCredits),
        }
    );

    return (
        <div className="cb-usage-indicator" ref={containerRef}>
            <button
                type="button"
                className={`cb-usage-trigger${pressured ? ' cb-usage-trigger--warn' : ''}`}
                aria-label={formatLabel(labels.usageTrigger, { summary: summaryForScreenReader })}
                aria-describedby={open ? popoverId : undefined}
                aria-expanded={open}
                onClick={() => setOpen(value => !value)}
            >
                <Ring ratio={ratio} warn={pressured} live={live} />
                <span className="cb-usage-trigger-label">{atRestLabel}</span>
            </button>

            <div id={popoverId} role="tooltip" className="cb-usage-popover" hidden={!open}>
                <MeterRow
                    label={labels.usageContextWindow}
                    value={window !== null && ratio !== null
                        ? `${formatTokens(context!.input_tokens)} / ${formatTokens(window)} (${formatPercent(ratio)})`
                        : limitUnknown(context?.input_tokens ?? ownRun.input_tokens)}
                    ratio={ratio}
                    warn={pressured}
                    note={subAgents ? labels.usageLastPromptNote : undefined}
                />
                {subAgentContext && (
                    <MeterRow
                        sub
                        label={formatLabel(labels.usageSubAgentContext, { name: subAgentContext.agentName ?? labels.usageLargestPrompt })}
                        value={subAgentContext.context.max_input_tokens !== null && subAgentRatio !== null
                            ? `${formatTokens(subAgentContext.context.input_tokens)} / ${formatTokens(subAgentContext.context.max_input_tokens)} (${formatPercent(subAgentRatio)})`
                            : limitUnknown(subAgentContext.context.input_tokens)}
                        ratio={null}
                        warn={subAgentRatio !== null && subAgentRatio >= NEAR_WINDOW_RATIO}
                        note={labels.usageOwnContextNote}
                    />
                )}
                {pressured && (
                    <p className="cb-usage-hint">{labels.usageNearLimit}</p>
                )}

                <div className="cb-usage-section">
                    <span>{labels.usageTitle}</span>
                    {live && <span className="cb-usage-live">{labels.usageUpdating}</span>}
                </div>
                <MeterRow
                    label={labels.usageThisTurn}
                    value={credits(turn.credits_charged)}
                    ratio={conversationCredits > 0 ? turn.credits_charged / conversationCredits : null}
                    note={describeFigures(turn, labels)}
                />
                {subAgents && (
                    <>
                        <MeterRow
                            sub
                            label={labels.usageThisAgent}
                            value={credits(ownRun.credits_charged)}
                            ratio={null}
                            note={describeFigures(ownRun, labels)}
                        />
                        <MeterRow
                            sub
                            label={formatLabel(labels.usageSubAgents, { count: subAgents.count })}
                            value={credits(subAgents.figures.credits_charged)}
                            ratio={null}
                            note={describeFigures(subAgents.figures, labels)}
                        />
                    </>
                )}
                <MeterRow
                    label={labels.usageWholeConversation}
                    value={credits(conversationCredits)}
                    ratio={null}
                    note={formatCount(turns, labels.turnsOne, labels.turnsOther)}
                />
                {turn.credits_waived > 0 && (
                    <MeterRow
                        label={labels.usageFreeCalls}
                        value={formatLabel(labels.usageWaived, { credits: credits(turn.credits_waived) })}
                        ratio={null}
                    />
                )}
                {showTree && tree && (
                    <MeterRow
                        label={labels.usageSubAgentTree}
                        value={ceiling !== null
                            ? `${tree.credits_spent} / ${ceiling} (${formatPercent(tree.credits_spent / ceiling)})`
                            : credits(tree.credits_spent)}
                        ratio={treeRatio}
                        warn={Boolean(tree.ceiling_reached)}
                        note={tree.ceiling_reached ? labels.usageTreeLimitReached : undefined}
                    />
                )}

                <p className="cb-usage-foot">{labels.usageFootnote}</p>
            </div>
        </div>
    );
};
