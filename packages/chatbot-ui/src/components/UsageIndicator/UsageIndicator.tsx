import React from 'react';
import type { TurnUsageSummary } from '../../common/usageSummary';
import type { UsageFigures } from '../../api/types';
import { useStableId } from '../../common/useStableId';
import { DEFAULT_LABELS, formatLabel } from '../../common/labels';
import type { ChatLabels } from '../../common/labels';
import { formatTokenCount, type ChatFormat } from '../../common/i18n';
import { useChatFormat } from '../../store/hooks';
import './UsageIndicator.css';

/** Where the orchestrator itself starts warning about the window. */
const NEAR_WINDOW_RATIO = 0.9;

const { useEffect, useRef, useState } = React;

/**
 * A token count, short: "999", "1.2k", "12k", "1.5M". Since 4.2 the number is
 * written for `language` and the "k" and "M" are labels (`tokensThousands`,
 * `tokensMillions`); without them, English.
 */
export function formatTokens(
    count: number,
    language?: string,
    labels: Pick<ChatLabels, 'tokensThousands' | 'tokensMillions'> = DEFAULT_LABELS,
): string {
    return formatTokenCount(count, labels, language);
}

export interface UsageIndicatorProps {
    summary: TurnUsageSummary;
    /**
     * Whether a click opens the breakdown card. `false` draws the ring and the
     * total alone, as a figure rather than a button (`config.composer.usageDetails`).
     */
    details?: boolean;
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

function describeFigures(figures: UsageFigures, format: ChatFormat): string {
    return formatLabel(format.labels.usageTokens, {
        input: format.tokens(figures.input_tokens),
        output: format.tokens(figures.output_tokens),
        steps: format.plural(format.labels.steps, figures.steps),
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
 * At rest: a ring for the context window and, beside it, the conversation's
 * total credits — the number that only grows, rather than the latest turn's,
 * which read as the whole cost and dropped back with every new turn. On click —
 * and closed only by a second click on the trigger, a click outside, or Escape —
 * a card with the context window against the model's limit, this turn's and
 * this conversation's credits, the tokens, any waived free calls, and the
 * sub-agent tree against its ceiling when one is set. With `details` off there
 * is no card and nothing to click: the ring and the total are the whole of it.
 * *Until 3.1 the number was the window's percentage when the model's window was
 * known, and the latest turn's credits otherwise.*
 *
 * The figures are what the orchestrator reports after every settled step — the
 * `usage` stream event, or the job's totals when the thread was loaded from
 * history. Cumulative values are replaced on each event, never summed here, so
 * a replayed stream cannot double-count.
 */
export const UsageIndicator: React.FC<UsageIndicatorProps> = ({ summary, details = true }) => {
    const format = useChatFormat();
    const { labels } = format;
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const popoverId = useStableId('cb-usage');

    // The card opens on a click on the trigger and closes only on a second
    // click on it, a click outside the indicator, or Escape — never because
    // the pointer left, so the figures stay readable while the turn updates.
    useEffect(() => {
        if (!open || !details) return;

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

    const credits = (count: number) => format.plural(labels.credits, count);
    const limitUnknown = (tokens: number) => formatLabel(labels.usageLimitUnknown, { tokens: format.tokens(tokens) });
    const ofLimit = (used: string, limit: string, share: number) =>
        formatLabel(labels.usageOfLimit, { used, limit, percent: format.percent(share) });

    const atRestLabel = credits(conversationCredits);
    const summaryForScreenReader = formatLabel(
        ratio !== null && window !== null ? labels.usageSummaryWithWindow : labels.usageSummary,
        {
            percent: ratio !== null ? format.percent(ratio) : '',
            turnCredits: credits(turn.credits_charged),
            conversationCredits: credits(conversationCredits),
        }
    );

    if (!details) {
        return (
            <div className="cb-usage-indicator">
                {/* A figure, not a control: the summary is its accessible name, and
                    there is nothing to press. */}
                <span
                    role="img"
                    className={`cb-usage-trigger cb-usage-trigger--static${pressured ? ' cb-usage-trigger--warn' : ''}`}
                    aria-label={summaryForScreenReader}
                >
                    <Ring ratio={ratio} warn={pressured} live={live} />
                    <span className="cb-usage-trigger-label">{atRestLabel}</span>
                </span>
            </div>
        );
    }

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
                        ? ofLimit(format.tokens(context!.input_tokens), format.tokens(window), ratio)
                        : limitUnknown(context?.input_tokens ?? ownRun.input_tokens)}
                    ratio={ratio}
                    warn={pressured}
                    note={subAgents ? labels.usageLastPromptNote : undefined}
                />
                {subAgentContext && (
                    <MeterRow
                        sub
                        label={formatLabel(labels.usageSubAgentContext, { name: subAgentContext.agentName || labels.usageLargestPrompt })}
                        value={subAgentContext.context.max_input_tokens !== null && subAgentRatio !== null
                            ? ofLimit(
                                format.tokens(subAgentContext.context.input_tokens),
                                format.tokens(subAgentContext.context.max_input_tokens),
                                subAgentRatio,
                            )
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
                    note={describeFigures(turn, format)}
                />
                {subAgents && (
                    <>
                        <MeterRow
                            sub
                            label={labels.usageThisAgent}
                            value={credits(ownRun.credits_charged)}
                            ratio={null}
                            note={describeFigures(ownRun, format)}
                        />
                        <MeterRow
                            sub
                            label={format.plural(labels.usageSubAgents, subAgents.count)}
                            value={credits(subAgents.figures.credits_charged)}
                            ratio={null}
                            note={describeFigures(subAgents.figures, format)}
                        />
                    </>
                )}
                <MeterRow
                    label={labels.usageWholeConversation}
                    value={credits(conversationCredits)}
                    ratio={null}
                    note={format.plural(labels.turns, turns)}
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
                            ? ofLimit(format.number(tree.credits_spent), format.number(ceiling), tree.credits_spent / ceiling)
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
