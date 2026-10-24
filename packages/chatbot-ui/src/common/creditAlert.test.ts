import { describe, expect, it } from 'vitest';
import type { UserCredits } from '../api/types';
import { creditAlertFor, creditAlertKey, normalizeCreditThresholds } from './creditAlert';

/** The composer's credit notice, from the figures `GET /v1/user/credits` returns (since 4.3). */

const allowance = (consumed: number, credit_cap = 100, extra: Partial<UserCredits> = {}): UserCredits => ({
    allowance: { limited: true, credit_cap, consumed, remaining: Math.max(0, credit_cap - consumed), grants: [] },
    used_this_month: consumed,
    month_started_at: '2026-10-01T00:00:00Z',
    can_run: true,
    blocked_by: null,
    ...extra,
});

describe('normalizeCreditThresholds', () => {
    it('keeps percentages above 0 and at most 100, ascending, each once', () => {
        expect(normalizeCreditThresholds([90, 75, 90, 100])).toEqual([75, 90, 100]);
    });

    it('drops what is not a percentage of the allowance', () => {
        expect(normalizeCreditThresholds([0, -5, 101, Number.NaN, Infinity, '80' as unknown as number, 80]))
            .toEqual([80]);
        expect(normalizeCreditThresholds(undefined)).toEqual([]);
        expect(normalizeCreditThresholds(null)).toEqual([]);
    });
});

describe('creditAlertFor', () => {
    it('says nothing before the figures are read', () => {
        expect(creditAlertFor(null, [90])).toBeNull();
    });

    it('says nothing below every threshold', () => {
        expect(creditAlertFor(allowance(89), [90])).toBeNull();
    });

    it('warns at a threshold, with the share used and the credits left', () => {
        expect(creditAlertFor(allowance(90), [90])).toEqual({ kind: 'warning', threshold: 90, usedShare: 0.9, remaining: 10 });
    });

    it('names the highest threshold passed', () => {
        expect(creditAlertFor(allowance(92), [75, 90])).toMatchObject({ threshold: 90 });
        expect(creditAlertFor(allowance(80), [90, 75])).toMatchObject({ threshold: 75 });
    });

    it('warns at no threshold when the host gives none', () => {
        expect(creditAlertFor(allowance(99), [])).toBeNull();
    });

    it('caps the share at the whole allowance', () => {
        expect(creditAlertFor(allowance(130), [90])).toMatchObject({ usedShare: 1, remaining: 0 });
    });

    it('never warns a user with no personal limit: there is nothing to measure against', () => {
        const unlimited = allowance(0, 0, {
            allowance: { limited: false, credit_cap: 0, consumed: 0, remaining: 0, grants: [] },
        });
        expect(creditAlertFor(unlimited, [1])).toBeNull();
    });

    it('says the user is blocked, and by whom, whatever the figures', () => {
        expect(creditAlertFor(allowance(100, 100, { can_run: false, blocked_by: 'user_allowance' }), [90]))
            .toEqual({ kind: 'blocked', blockedBy: 'user_allowance' });
        const organisation = allowance(0, 0, {
            allowance: { limited: false, credit_cap: 0, consumed: 0, remaining: 0, grants: [] },
            can_run: false,
            blocked_by: 'organization_allowance',
        });
        expect(creditAlertFor(organisation, [])).toEqual({ kind: 'blocked', blockedBy: 'organization_allowance' });
    });

    it("reads a refusal the Gateway does not explain as the user's own allowance", () => {
        expect(creditAlertFor(allowance(100, 100, { can_run: false, blocked_by: null }), [90]))
            .toEqual({ kind: 'blocked', blockedBy: 'user_allowance' });
    });
});

describe('creditAlertKey', () => {
    it('tells the thresholds apart, so closing one does not close the next', () => {
        const at75 = creditAlertFor(allowance(80), [75, 90])!;
        const at90 = creditAlertFor(allowance(95), [75, 90])!;
        expect(creditAlertKey(at75)).not.toBe(creditAlertKey(at90));
        expect(creditAlertKey(at90)).toBe(creditAlertKey(creditAlertFor(allowance(99), [75, 90])!));
    });
});
