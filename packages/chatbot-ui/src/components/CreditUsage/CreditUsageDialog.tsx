import React from 'react';
import './CreditUsageDialog.css';
import type { CreditBlock, CreditGrant, UserCredits } from '../../api/types';
import { formatLabel, type ChatLabels } from '../../common/labels';
import type { ChatFormat } from '../../common/i18n';
import { useChatActions, useChatFormat, useChatRuntime, useChatState, useIcons, useLabels } from '../../store/hooks';

const { useEffect, useRef, useState } = React;

const HTTP_NOT_FOUND = 404;

const BLOCK_LABEL = {
    user_allowance: 'creditsBlockedUser',
    organization_allowance: 'creditsBlockedOrganization',
    provider_account: 'creditsBlockedProvider',
    no_plan: 'creditsBlockedNoPlan',
} as const satisfies Record<CreditBlock, keyof ChatLabels>;

type LoadState =
    | { status: 'loading' }
    | { status: 'loaded'; credits: UserCredits }
    // `unavailable`: the Gateway has no such route, which no retry will change.
    | { status: 'failed'; unavailable: boolean };

/** Credits counted, the number written for the chat's language: "1,250 credits". */
function formatCredits(count: number, format: ChatFormat): string {
    return format.plural(format.labels.credits, count);
}

/**
 * "Credit usage": the signed-in user's own allowance, read afresh each time it
 * opens (`useChatActions().openCreditUsage()`, or the header menu's entry).
 *
 * Only the user's own figures appear. When their organisation's allowance or
 * the provider's account is what stops them, it says so in a sentence — the
 * Gateway never sends those figures.
 *
 * `ChatContainer` renders it; a host with its own layout renders it once
 * anywhere under the provider, inside a positioned element it should cover.
 */
export const CreditUsageDialog: React.FC = () => {
    const isOpen = useChatState(s => s.isCreditUsageOpen);
    // Mounted per opening, so each one starts from "loading" with fresh figures.
    return isOpen ? <CreditUsagePanel /> : null;
};

const CreditUsagePanel: React.FC = () => {
    const { services } = useChatRuntime();
    const actions = useChatActions();
    const labels = useLabels();
    const icons = useIcons();
    const [state, setState] = useState<LoadState>({ status: 'loading' });
    const [attempt, setAttempt] = useState(0);
    const closeRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        let cancelled = false;
        setState({ status: 'loading' });
        services.fetchCredits().then(
            credits => {
                if (!cancelled) setState({ status: 'loaded', credits });
            },
            (error: { status?: number }) => {
                if (!cancelled) setState({ status: 'failed', unavailable: error?.status === HTTP_NOT_FOUND });
            }
        );
        return () => {
            cancelled = true;
        };
    }, [services, attempt]);

    useEffect(() => {
        closeRef.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') actions.closeCreditUsage();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [actions]);

    return (
        <div
            className="cb-credit-overlay"
            onMouseDown={event => {
                if (event.target === event.currentTarget) actions.closeCreditUsage();
            }}
        >
            <div className="cb-credit-dialog" role="dialog" aria-modal="true" aria-labelledby="cb-credit-title">
                <div className="cb-credit-header">
                    <span className="cb-credit-header-icon" aria-hidden>{icons.creditUsage}</span>
                    <h2 id="cb-credit-title" className="cb-credit-title">{labels.creditUsage}</h2>
                    <button
                        ref={closeRef}
                        type="button"
                        className="cb-credit-close"
                        onClick={actions.closeCreditUsage}
                        aria-label={labels.close}
                        title={labels.close}
                    >
                        {icons.close}
                    </button>
                </div>

                <div className="cb-credit-body" aria-live="polite">
                    {state.status === 'loading' && <CreditSkeleton />}
                    {state.status === 'failed' && (
                        <div className="cb-credit-message">
                            <p>{state.unavailable ? labels.creditsUnavailable : labels.creditsLoadFailed}</p>
                            {!state.unavailable && (
                                <button type="button" className="cb-credit-retry" onClick={() => setAttempt(n => n + 1)}>
                                    {labels.retry}
                                </button>
                            )}
                        </div>
                    )}
                    {state.status === 'loaded' && <CreditSummary credits={state.credits} />}
                </div>
            </div>
        </div>
    );
};

const CreditSkeleton: React.FC = () => {
    const labels = useLabels();
    return (
        <div className="cb-credit-skeleton" aria-label={labels.loading}>
            <span className="cb-credit-skeleton-line is-wide" />
            <span className="cb-credit-skeleton-line" />
            <span className="cb-credit-skeleton-bar" />
        </div>
    );
};

const CreditSummary: React.FC<{ credits: UserCredits }> = ({ credits }) => {
    const format = useChatFormat();
    const { labels } = format;
    const { allowance } = credits;
    const usedThisMonth = formatLabel(labels.creditsUsedThisMonth, {
        credits: formatCredits(credits.used_this_month, format),
    });

    return (
        <>
            {allowance.limited ? (
                <LimitedAllowance allowance={allowance} />
            ) : (
                <div className="cb-credit-hero">
                    <span className="cb-credit-hero-title">{labels.creditsNoLimitTitle}</span>
                    <span className="cb-credit-caption">{labels.creditsNoLimitBody}</span>
                    <span className="cb-credit-month">{usedThisMonth}</span>
                </div>
            )}

            {!credits.can_run && credits.blocked_by && (
                <div className="cb-credit-blocked" role="status">
                    {labels[BLOCK_LABEL[credits.blocked_by]]}
                </div>
            )}
        </>
    );
};

const LimitedAllowance: React.FC<{ allowance: UserCredits['allowance'] }> = ({ allowance }) => {
    const format = useChatFormat();
    const { labels } = format;
    const exhausted = allowance.remaining === 0;
    const usedShare = allowance.credit_cap > 0 ? Math.min(1, allowance.consumed / allowance.credit_cap) : 1;
    const onlyGrant = allowance.grants.length === 1 ? allowance.grants[0] : null;

    return (
        <>
            <div className="cb-credit-hero">
                <span className={`cb-credit-number${exhausted ? ' is-exhausted' : ''}`}>
                    {format.number(allowance.remaining)}
                </span>
                <span className="cb-credit-caption">
                    {format.plural(labels.creditsLeft, allowance.remaining)}
                </span>
            </div>

            <div
                className={`cb-credit-meter${exhausted ? ' is-exhausted' : ''}`}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={allowance.credit_cap}
                aria-valuenow={Math.min(allowance.consumed, allowance.credit_cap)}
                aria-label={labels.creditUsage}
            >
                <span className="cb-credit-meter-fill" style={{ width: `${usedShare * 100}%` }} />
            </div>
            <div className="cb-credit-meter-legend">
                <span>
                    {formatLabel(labels.creditsUsedOfCap, {
                        used: format.number(allowance.consumed),
                        cap: format.number(allowance.credit_cap),
                    })}
                </span>
                {onlyGrant?.valid_until && (
                    <span>{formatLabel(labels.creditsValidUntil, { date: format.date(onlyGrant.valid_until) })}</span>
                )}
            </div>

            {allowance.grants.length > 1 && (
                <ul className="cb-credit-grants">
                    {allowance.grants.map((grant, index) => (
                        <GrantRow key={`${grant.source}-${index}`} grant={grant} />
                    ))}
                </ul>
            )}
        </>
    );
};

const GrantRow: React.FC<{ grant: CreditGrant }> = ({ grant }) => {
    const format = useChatFormat();
    const { labels } = format;
    return (
        <li className="cb-credit-grant">
            <span className="cb-credit-grant-name">
                {grant.source === 'topup' ? labels.creditGrantTopUp : labels.creditGrantPlan}
            </span>
            <span className="cb-credit-grant-left">
                {formatLabel(labels.creditGrantLeft, {
                    remaining: format.number(grant.remaining),
                    cap: format.number(grant.credit_cap),
                })}
            </span>
            {grant.valid_until && (
                <span className="cb-credit-grant-until">
                    {formatLabel(labels.creditsValidUntil, { date: format.date(grant.valid_until) })}
                </span>
            )}
        </li>
    );
};
