// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { StreamChatClient } from '../../api/StreamClient';
import type { UserCredits } from '../../api/types';
import type { ChatbotConfig } from '../../common/chatbotConfig';
import { DEFAULT_LABELS } from '../../common/labels';
import { ChatbotProvider } from '../../context/ChatbotContext';
import { useChatActions, useChatState } from '../../store/hooks';
import type { ChatActions } from '../../store/types';
import { Composer } from '../Composer/Composer';

/**
 * The credit notice above the composer (since 4.3): a warning once the user's
 * allowance passes a threshold, closed until the chat is next opened; and,
 * once a request would not be admitted, why — with the send button disabled.
 */

let root: Root | null = null;
let container: HTMLElement | null = null;
let actions: ChatActions | null = null;

/** What the next `getCredits()` returns, and how many times it was called. */
let nextCredits: UserCredits;
let creditReads = 0;
let sentTexts: string[] = [];

beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    actions = null;
    creditReads = 0;
    sentTexts = [];
    vi.restoreAllMocks();
});

const credits = (consumed: number, extra: Partial<UserCredits> = {}): UserCredits => ({
    allowance: { limited: true, credit_cap: 100, consumed, remaining: Math.max(0, 100 - consumed), grants: [] },
    used_this_month: consumed,
    month_started_at: '2026-10-01T00:00:00Z',
    can_run: true,
    blocked_by: null,
    ...extra,
});

/** A client that reads the allowance and answers every message at once. */
const client = {
    sendMessage: async (text: string, _onEvent: unknown, onComplete: () => void) => {
        sentTexts.push(text);
        await Promise.resolve();
        onComplete();
    },
    getConversationId: () => null,
    setConversationId: () => undefined,
    reset: () => undefined,
    getConversations: async () => ({ items: [], pagination: { total: 0, page: 1, per_page: 20, pages: 0 } }),
    getCredits: async () => {
        creditReads += 1;
        return nextCredits;
    },
} as unknown as StreamChatClient;

const Probe: React.FC = () => {
    actions = useChatActions();
    const dialog = useChatState(s => s.isCreditUsageOpen);
    return <span className="dialog-state">{dialog ? 'dialog' : '-'}</span>;
};

function render(open: boolean, config: ChatbotConfig = {}): HTMLElement {
    if (!container) {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    }
    act(() => {
        root!.render(
            <ChatbotProvider client={client} open={open} onOpenChange={() => undefined} config={config}>
                <Probe />
                {open && <Composer />}
            </ChatbotProvider>
        );
    });
    return container;
}

async function settle(): Promise<void> {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
    });
}

const notice = (page: HTMLElement) => page.querySelector<HTMLElement>('.cb-credit-notice');
const sendButton = (page: HTMLElement) => page.querySelector<HTMLButtonElement>('.cb-send-btn')!;
const closeButton = (page: HTMLElement) => page.querySelector<HTMLButtonElement>('.cb-credit-notice-close');
const textarea = (page: HTMLElement) => page.querySelector<HTMLTextAreaElement>('.cb-composer-textarea')!;

function typeInto(input: HTMLTextAreaElement, value: string): void {
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

describe('the credit notice', () => {
    it('warns once the allowance passes 90%, with what is left, and leaves sending alone', async () => {
        nextCredits = credits(92);
        const page = render(true);
        await settle();

        expect(creditReads).toBe(1);
        expect(notice(page)?.classList.contains('is-warning')).toBe(true);
        expect(notice(page)?.getAttribute('role')).toBe('status');
        expect(notice(page)?.textContent).toContain("You've used 92% of your credits — 8 credits left.");

        typeInto(textarea(page), 'Summarize my last inspection');
        expect(sendButton(page).disabled).toBe(false);
    });

    it('says nothing below the threshold', async () => {
        nextCredits = credits(89);
        const page = render(true);
        await settle();
        expect(notice(page)).toBeNull();
    });

    it('stays closed until the chat is next opened, and then reads the allowance again', async () => {
        nextCredits = credits(95);
        const page = render(true);
        await settle();
        act(() => closeButton(page)!.click());
        expect(notice(page)).toBeNull();

        render(false);
        await settle();
        render(true);
        await settle();

        expect(creditReads).toBe(2);
        expect(notice(page)).not.toBeNull();
    });

    it('shows the next threshold once passed, though the last one was closed', async () => {
        nextCredits = credits(80);
        const config: ChatbotConfig = { composer: { creditWarningThresholds: [75, 90] } };
        const page = render(true, config);
        await settle();
        expect(notice(page)?.textContent).toContain('80%');
        act(() => closeButton(page)!.click());
        expect(notice(page)).toBeNull();

        // A turn spends credits; the allowance is read again when it ends.
        nextCredits = credits(91);
        typeInto(textarea(page), 'Show trends across my inspections');
        act(() => sendButton(page).click());
        await settle();
        await settle();

        expect(sentTexts).toEqual(['Show trends across my inspections']);
        expect(creditReads).toBe(2);
        expect(notice(page)?.textContent).toContain('91%');
    });

    it('stays closed after a turn while the same threshold holds', async () => {
        nextCredits = credits(91);
        const page = render(true);
        await settle();
        act(() => closeButton(page)!.click());

        nextCredits = credits(93);
        typeInto(textarea(page), 'What changed this week?');
        act(() => sendButton(page).click());
        await settle();
        await settle();

        expect(creditReads).toBe(2);
        expect(notice(page)).toBeNull();
    });

    it('takes the thresholds from the configuration: none warns only once the user is out', async () => {
        nextCredits = credits(99);
        const page = render(true, { composer: { creditWarningThresholds: [] } });
        await settle();
        expect(notice(page)).toBeNull();
    });

    it('opens the credit usage dialog from its button', async () => {
        nextCredits = credits(95);
        const page = render(true);
        await settle();
        act(() => page.querySelector<HTMLButtonElement>('.cb-credit-notice-link')!.click());
        expect(page.querySelector('.dialog-state')?.textContent).toBe('dialog');
    });

    it('has no button for a dialog the header does not offer', async () => {
        nextCredits = credits(95);
        const page = render(true, { header: { creditUsage: false } });
        await settle();
        expect(notice(page)).not.toBeNull();
        expect(page.querySelector('.cb-credit-notice-link')).toBeNull();
    });
});

describe('out of credits', () => {
    it('says whose limit stops the user, cannot be closed, and disables sending', async () => {
        nextCredits = credits(100, { can_run: false, blocked_by: 'user_allowance' });
        const page = render(true);
        await settle();

        expect(notice(page)?.classList.contains('is-blocked')).toBe(true);
        expect(notice(page)?.getAttribute('role')).toBe('alert');
        expect(notice(page)?.textContent).toContain(DEFAULT_LABELS.creditsBlockedUser);
        expect(closeButton(page)).toBeNull();

        typeInto(textarea(page), 'Catch me up on recent updates');
        expect(sendButton(page).disabled).toBe(true);
        expect(sendButton(page).getAttribute('aria-describedby')).toBe(notice(page)!.id);

        // Enter does not send either.
        act(() => {
            textarea(page).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await settle();
        expect(sentTexts).toEqual([]);
        expect(textarea(page).value).toBe('Catch me up on recent updates');
    });

    it("names the organisation's limit when that is what stops the user", async () => {
        nextCredits = credits(0, {
            allowance: { limited: false, credit_cap: 0, consumed: 0, remaining: 0, grants: [] },
            can_run: false,
            blocked_by: 'organization_allowance',
        });
        const page = render(true);
        await settle();
        expect(notice(page)?.textContent).toContain(DEFAULT_LABELS.creditsBlockedOrganization);
    });

    it('lets the user send again once the allowance is raised and read again', async () => {
        nextCredits = credits(100, { can_run: false, blocked_by: 'user_allowance' });
        const page = render(true);
        await settle();
        typeInto(textarea(page), 'Which actions are overdue?');
        expect(sendButton(page).disabled).toBe(true);

        nextCredits = credits(10);
        await act(async () => {
            await actions!.refreshCredits();
        });

        expect(notice(page)).toBeNull();
        expect(sendButton(page).disabled).toBe(false);
    });
});

describe('composer.creditAlerts: false', () => {
    it('neither reads the allowance nor disables sending', async () => {
        nextCredits = credits(100, { can_run: false, blocked_by: 'user_allowance' });
        const page = render(true, { composer: { creditAlerts: false } });
        await settle();

        expect(creditReads).toBe(0);
        expect(notice(page)).toBeNull();
        typeInto(textarea(page), 'What needs my attention?');
        expect(sendButton(page).disabled).toBe(false);
    });
});
