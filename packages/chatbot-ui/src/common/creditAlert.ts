import type { CreditBlock, UserCredits } from '../api/types';
import type { ChatLabels } from './labels';

/**
 * What the composer's credit notice says, worked out from the user's own
 * allowance (`GET /v1/user/credits`, the figures the "Credit usage" dialog
 * shows). Since 4.3.
 *
 * - `blocked`: a request submitted now would not be admitted (`can_run` is
 *   false). The composer cannot send, and the notice says whose limit stops
 *   it — the same sentence as the dialog's.
 * - `warning`: the user's personal allowance has passed one of the host's
 *   thresholds (`composer.creditWarningThresholds`, percentages of it used).
 *   A user with no personal limit is never warned: the Gateway does not send
 *   the organisation's figures, so there is nothing to measure against.
 */
export type CreditAlert =
    | { kind: 'blocked'; blockedBy: CreditBlock }
    | {
        kind: 'warning';
        /** The highest threshold passed, as configured: `90`. */
        threshold: number;
        /** The share of the allowance used, 0–1. */
        usedShare: number;
        /** Credits left in the allowance. */
        remaining: number;
    };

/** The dialog's and the notice's sentence for whose limit stops the user. */
export const CREDIT_BLOCK_LABEL = {
    user_allowance: 'creditsBlockedUser',
    organization_allowance: 'creditsBlockedOrganization',
    provider_account: 'creditsBlockedProvider',
    no_plan: 'creditsBlockedNoPlan',
} as const satisfies Record<CreditBlock, keyof ChatLabels>;

/**
 * The thresholds a host gave, as the notice reads them: percentages above 0
 * and at most 100, ascending, each once. Anything else is dropped rather than
 * thrown on: a bad value in a host's settings must not break the composer.
 */
export function normalizeCreditThresholds(thresholds: readonly number[] | null | undefined): number[] {
    if (!Array.isArray(thresholds)) return [];
    const valid = thresholds.filter(value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100);
    return Array.from(new Set(valid)).sort((a, b) => a - b);
}

/** What the notice should say for these figures, or `null` when there is nothing to say. */
export function creditAlertFor(
    credits: UserCredits | null | undefined,
    thresholds: readonly number[]
): CreditAlert | null {
    if (!credits) return null;
    if (!credits.can_run) {
        // The Gateway always names the party when it refuses; a refusal it
        // does not explain is most likely the user's own allowance.
        return { kind: 'blocked', blockedBy: credits.blocked_by ?? 'user_allowance' };
    }
    const { allowance } = credits;
    if (!allowance.limited || allowance.credit_cap <= 0) return null;
    const usedShare = Math.min(1, Math.max(0, allowance.consumed / allowance.credit_cap));
    const passed = normalizeCreditThresholds(thresholds).filter(threshold => usedShare * 100 >= threshold);
    if (passed.length === 0) return null;
    return {
        kind: 'warning',
        threshold: passed[passed.length - 1],
        usedShare,
        remaining: Math.max(0, allowance.remaining),
    };
}

/**
 * The alert's identity for dismissal: closing the 80% warning keeps it closed
 * while the user stays between 80% and 90%, and the 90% warning still shows
 * when they pass it.
 */
export function creditAlertKey(alert: CreditAlert): string {
    return alert.kind === 'blocked' ? `blocked:${alert.blockedBy}` : `warning:${alert.threshold}`;
}
