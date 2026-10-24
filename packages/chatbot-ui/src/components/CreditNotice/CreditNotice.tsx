import React from 'react';
import './CreditNotice.css';
import { CREDIT_BLOCK_LABEL, type CreditAlert } from '../../common/creditAlert';
import type { ChatFormat } from '../../common/i18n';
import { useChatActions, useChatFormat, useChatState, useIcons } from '../../store/hooks';

export interface CreditNoticeProps {
    /** For the send button's `aria-describedby`, while the notice is why it cannot send. */
    id?: string;
    className?: string;
}

/** The sentence for an alert, in the language in force. */
function noticeText(alert: CreditAlert, format: ChatFormat): string {
    const { labels } = format;
    if (alert.kind === 'blocked') return labels[CREDIT_BLOCK_LABEL[alert.blockedBy]];
    return format.label(labels.creditsWarning, {
        // Rounded down: 99.6% used is not "100%" while credits are left.
        percent: format.number(Math.floor(alert.usedShare * 100) / 100, { style: 'percent', maximumFractionDigits: 0 }),
        credits: format.plural(labels.credits, alert.remaining),
    });
}

/**
 * The line above the composer about the user's credits (since 4.3): a
 * warning once their allowance passes a threshold of the host's
 * (`composer.creditWarningThresholds`), which they can close until the chat is
 * next opened; or, once a request would not be admitted, why — which stays,
 * because it is why the send button is disabled.
 *
 * `Composer` renders it. A host with a composer of its own renders it above
 * that, and disables sending while `useChatState(s => s.credits?.can_run)` is
 * `false`.
 */
export const CreditNotice: React.FC<CreditNoticeProps> = ({ id, className = '' }) => {
    const alert = useChatState(s => s.creditAlert);
    const canOpenUsage = useChatState(s => s.canShowCredits && s.config.header.creditUsage);
    const actions = useChatActions();
    const format = useChatFormat();
    const icons = useIcons();
    const { labels } = format;

    if (!alert) return null;
    const blocked = alert.kind === 'blocked';

    return (
        <div
            id={id}
            className={`cb-credit-notice ${blocked ? 'is-blocked' : 'is-warning'} ${className}`.trim()}
            role={blocked ? 'alert' : 'status'}
        >
            <span className="cb-credit-notice-icon" aria-hidden>{icons.creditUsage}</span>
            <span className="cb-credit-notice-text">{noticeText(alert, format)}</span>
            {canOpenUsage && (
                <button type="button" className="cb-credit-notice-link" onClick={actions.openCreditUsage}>
                    {labels.creditsViewUsage}
                </button>
            )}
            {!blocked && (
                <button
                    type="button"
                    className="cb-credit-notice-close"
                    onClick={actions.dismissCreditAlert}
                    aria-label={labels.close}
                    title={labels.close}
                >
                    {icons.close}
                </button>
            )}
        </div>
    );
};
