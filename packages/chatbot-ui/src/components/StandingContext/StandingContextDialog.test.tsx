// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { StreamChatClient } from '../../api/StreamClient';
import type { StandingEntry, StandingEntryChanges, StandingEntryDraft } from '../../api/types';
import type { ChatbotConfig } from '../../common/chatbotConfig';
import { DEFAULT_LABELS } from '../../common/labels';
import { ChatbotProvider } from '../../context/ChatbotContext';
import { useChatActions, useChatState } from '../../store/hooks';
import type { ChatActions } from '../../store/types';
import { ChatHeader } from '../ChatHeader/ChatHeader';
import { StandingContextDialog } from './StandingContextDialog';

/**
 * "Memory & instructions" (since 4.4, ADR-021): the user's own instructions
 * and memories — added, changed, deleted with a second click — and their
 * organisation's, read-only; the panel offered only by a client that can reach
 * them, and every refusal said in words.
 */

const L = DEFAULT_LABELS;

let root: Root | null = null;
let container: HTMLElement | null = null;
let actions: ChatActions | null = null;

beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    actions = null;
    vi.restoreAllMocks();
});

const entry = (overrides: Partial<StandingEntry>): StandingEntry => ({
    uuid: 'e-' + Math.random().toString(36).slice(2),
    scope: 'user',
    kind: 'memory',
    body: 'A fact.',
    status: 'active',
    expires_on: null,
    expired: false,
    source: 'api',
    source_job_uuid: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    editable: true,
    ...overrides,
});

function standingClient(entries: StandingEntry[]) {
    const client = {
        sendMessage: async (_text: string, _onEvent: unknown, onComplete: () => void) => onComplete(),
        getConversationId: () => null,
        setConversationId: () => undefined,
        reset: () => undefined,
        getConversations: async () => ({ items: [], pagination: { total: 0, page: 1, per_page: 20, pages: 0 } }),
        listStandingContext: vi.fn(async () => entries),
        createStandingEntry: vi.fn(async (draft: StandingEntryDraft) =>
            entry({ uuid: 'created', kind: draft.kind, body: draft.body.trim(), expires_on: draft.expires_on ?? null })),
        updateStandingEntry: vi.fn(async (uuid: string, changes: StandingEntryChanges) => {
            const current = entries.find(existing => existing.uuid === uuid)!;
            return { ...current, body: changes.body ?? current.body, expires_on: changes.expires_on ?? null };
        }),
        deleteStandingEntry: vi.fn(async (_uuid: string) => undefined),
    };
    return client;
}

const Probe: React.FC = () => {
    actions = useChatActions();
    const can = useChatState(s => s.canManageStandingContext);
    return <span className="probe">{can ? 'can' : 'cannot'}</span>;
};

function mount(client: object, config: ChatbotConfig | undefined, withHeader = false): HTMLElement {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root!.render(
            <ChatbotProvider client={client as unknown as StreamChatClient} open onOpenChange={() => undefined} config={config}>
                <Probe />
                {withHeader && <ChatHeader />}
                <StandingContextDialog />
            </ChatbotProvider>
        );
    });
    return container;
}

async function open(client: object, config?: ChatbotConfig): Promise<HTMLElement> {
    mount(client, config);
    await act(async () => {
        actions!.openStandingContext();
    });
    return container!;
}

/** The header menu's entries, as their text, once "More options" is open. */
async function menuEntries(config: ChatbotConfig): Promise<string[]> {
    mount(standingClient([]), config, true);
    // Let the provider's own requests settle before reading the header.
    await act(async () => undefined);
    // No entry at all: the header draws no "More options" to open.
    const more = container!.querySelector<HTMLButtonElement>(`button[aria-label="${L.moreOptions}"]`);
    if (!more) return [];
    act(() => more.click());
    return Array.from(container!.querySelectorAll('.cb-header-dropdown-menu button')).map(item => item.textContent ?? '');
}

const byText = (text: string, selector = 'button'): HTMLElement => {
    const found = Array.from(container!.querySelectorAll<HTMLElement>(selector)).find(el => el.textContent === text);
    if (!found) throw new Error(`no ${selector} reading "${text}"`);
    return found;
};

const sectionOf = (title: string): HTMLElement => byText(title, 'h3').closest('section')!;

const tab = (label: string): HTMLElement => byText(label, '[role="tab"]');

function setValue(element: HTMLTextAreaElement | HTMLInputElement, value: string): void {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

async function click(element: HTMLElement): Promise<void> {
    await act(async () => {
        element.click();
    });
}

const WORLD = () => [
    entry({ uuid: 'i1', kind: 'instruction', body: 'Answer in German.' }),
    entry({ uuid: 'm1', body: 'Manages the Hamburg site.', source: 'agent' }),
    entry({ uuid: 'm2', body: 'On leave last week.', expires_on: '2026-10-20', expired: true }),
    entry({ uuid: 't1', scope: 'tenant', kind: 'instruction', body: 'Cite the ISO clause.', editable: false }),
];

describe('StandingContextDialog', () => {
    it('lists the user\'s own entries by kind, and the organisation\'s read-only in a tab of its own', async () => {
        await open(standingClient(WORLD()));

        expect(tab(L.standingTabPersonal).getAttribute('aria-selected')).toBe('true');
        expect(sectionOf(L.standingInstructions).textContent).toContain('Answer in German.');
        const memories = sectionOf(L.standingMemories);
        expect(memories.textContent).toContain('Manages the Hamburg site.');
        expect(memories.textContent).toContain(L.standingSavedByAssistant);
        expect(memories.textContent).toContain(L.standingExpired);
        // Only what is in force counts: one memory of two.
        expect(memories.textContent).toContain('1 of 50 memories');
        expect(container!.textContent).not.toContain('Cite the ISO clause.');

        await click(tab(L.standingTabOrganization));

        expect(tab(L.standingTabOrganization).getAttribute('aria-selected')).toBe('true');
        const organization = sectionOf(L.standingOrganization);
        expect(organization.textContent).toContain('Cite the ISO clause.');
        expect(organization.querySelectorAll('button')).toHaveLength(0);
        expect(container!.textContent).not.toContain('Answer in German.');
        const panel = container!.querySelector('[role="tabpanel"]')!;
        expect(panel.getAttribute('aria-labelledby')).toBe(tab(L.standingTabOrganization).id);
    });

    it('moves between the tabs with the arrow keys', async () => {
        await open(standingClient(WORLD()));

        act(() => {
            tab(L.standingTabPersonal).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        });

        expect(tab(L.standingTabOrganization).getAttribute('aria-selected')).toBe('true');
        expect(document.activeElement).toBe(tab(L.standingTabOrganization));
        expect(tab(L.standingTabPersonal).getAttribute('tabindex')).toBe('-1');
    });

    it('adds a memory with an end date and shows it', async () => {
        const client = standingClient(WORLD());
        await open(client);

        await click(byText(L.standingAddMemory));
        const form = container!.querySelector('form')!;
        act(() => {
            setValue(form.querySelector('textarea')!, ' Prefers metric units. ');
            setValue(form.querySelector('input[type="date"]')!, '2099-01-31');
        });
        await click(byText(L.standingSave));

        expect(client.createStandingEntry).toHaveBeenCalledWith({
            kind: 'memory', body: ' Prefers metric units. ', expires_on: '2099-01-31',
        });
        expect(sectionOf(L.standingMemories).textContent).toContain('Prefers metric units.');
        expect(container!.querySelector('form')).toBeNull();
    });

    it('says what the Gateway refused, in words', async () => {
        const client = standingClient(WORLD());
        client.createStandingEntry.mockRejectedValueOnce(
            Object.assign(new Error('Gateway 409'), { status: 409, reason: 'STANDING_CONTEXT_FULL' })
        );
        await open(client);

        await click(byText(L.standingAddMemory));
        act(() => setValue(container!.querySelector('textarea')!, 'One more.'));
        await click(byText(L.standingSave));

        expect(container!.querySelector('[role="alert"]')!.textContent).toBe('You already have 50 memories. Remove one first.');
        expect(container!.querySelector('form')).not.toBeNull();
    });

    it('refuses an empty entry without asking the Gateway', async () => {
        const client = standingClient([]);
        await open(client);

        await click(byText(L.standingAddInstruction));
        await click(byText(L.standingSave));

        expect(container!.querySelector('[role="alert"]')!.textContent).toBe(L.standingErrorEmpty);
        expect(client.createStandingEntry).not.toHaveBeenCalled();
    });

    it('changes an entry and clears its end date', async () => {
        const client = standingClient([entry({ uuid: 'm2', body: 'On leave.', expires_on: '2099-01-01' })]);
        await open(client);

        await click(container!.querySelector<HTMLElement>(`button[title="${L.edit}"]`)!);
        act(() => setValue(container!.querySelector('textarea')!, 'Back from leave.'));
        await click(byText(L.standingNoEndDate));
        await click(byText(L.standingSave));

        expect(client.updateStandingEntry).toHaveBeenCalledWith('m2', { body: 'Back from leave.', expires_on: null });
        expect(container!.textContent).toContain('Back from leave.');
    });

    it('deletes only on the second click', async () => {
        const client = standingClient([entry({ uuid: 'm1', body: 'Manages the Hamburg site.' })]);
        await open(client);
        const remove = () => container!.querySelector<HTMLElement>('.cb-standing-icon-button.is-danger')!;

        await click(remove());
        expect(client.deleteStandingEntry).not.toHaveBeenCalled();
        expect(remove().textContent).toBe(L.standingConfirmDelete);
        await click(remove());

        expect(client.deleteStandingEntry).toHaveBeenCalledWith('m1');
        expect(container!.textContent).not.toContain('Manages the Hamburg site.');
    });

    it('shows only the user\'s own when `header.standingContext` turns the workspace off (since 4.5)', async () => {
        await open(standingClient(WORLD()), { header: { standingContext: { workspace: false } } });

        expect(container!.querySelector('[role="tablist"]')).toBeNull();
        expect(sectionOf(L.standingInstructions).textContent).toContain('Answer in German.');
        expect(sectionOf(L.standingMemories).textContent).toContain('Manages the Hamburg site.');
        expect(container!.textContent).not.toContain(L.standingOrganization);
        expect(container!.textContent).not.toContain('Cite the ISO clause.');
    });

    it('shows only the organisation\'s, read-only, when it turns the personal part off', async () => {
        await open(standingClient(WORLD()), { header: { standingContext: { personal: false } } });

        expect(container!.querySelector('[role="tablist"]')).toBeNull();
        const organization = sectionOf(L.standingOrganization);
        expect(organization.textContent).toContain('Cite the ISO clause.');
        expect(container!.querySelectorAll('[role="dialog"] button:not(.cb-standing-close)')).toHaveLength(0);
        expect(container!.textContent).not.toContain('Answer in German.');
        expect(container!.textContent).not.toContain(L.standingAddMemory);
    });

    it('says the organisation has nothing when that is all it shows', async () => {
        await open(standingClient([entry({ uuid: 'm1', body: 'Manages the Hamburg site.' })]), {
            header: { standingContext: { personal: false, workspace: true } },
        });

        expect(sectionOf(L.standingOrganization).textContent).toContain(L.standingNoOrganization);
        expect(container!.textContent).not.toContain('Manages the Hamburg site.');
    });

    it('says so in the organisation\'s tab when it has nothing', async () => {
        await open(standingClient([entry({ uuid: 'm1' })]));
        await click(tab(L.standingTabOrganization));

        expect(sectionOf(L.standingOrganization).textContent).toContain(L.standingNoOrganization);
    });

    it('opens nothing, and offers no entry, with both parts off', async () => {
        const off = { header: { standingContext: { personal: false, workspace: false } } };
        expect(await menuEntries(off)).not.toContain(L.standingContext);
        act(() => root!.unmount());
        container!.remove();
        root = null;

        await open(standingClient(WORLD()), off);
        expect(container!.querySelector('[role="dialog"]')).toBeNull();
    });

    it('offers the menu entry while either part is on', async () => {
        expect(await menuEntries({})).toContain(L.standingContext);
        act(() => root!.unmount());
        container!.remove();
        root = null;
        expect(await menuEntries({ header: { standingContext: { personal: false } } })).toContain(L.standingContext);
        act(() => root!.unmount());
        container!.remove();
        root = null;
        expect(await menuEntries({ header: { standingContext: false } })).not.toContain(L.standingContext);
    });

    it('draws an entry\'s Markdown — marks, lists, links in a new tab — and names it plainly', async () => {
        await open(standingClient([
            entry({ uuid: 'i1', kind: 'instruction', body: 'For every finding:\n- **cite** the *clause*\n- see [ISO](https://iso.org/9001)' }),
            entry({ uuid: 't1', scope: 'tenant', kind: 'instruction', body: '~~Old~~ rule', editable: false }),
        ]));

        const own = sectionOf(L.standingInstructions);
        expect(own.querySelector('.cb-standing-text strong')!.textContent).toBe('cite');
        expect(own.querySelector('.cb-standing-text em')!.textContent).toBe('clause');
        expect(own.querySelectorAll('.cb-standing-text li')).toHaveLength(2);
        const link = own.querySelector<HTMLAnchorElement>('.cb-standing-text a')!;
        expect([link.textContent, link.getAttribute('href'), link.target, link.rel]).toEqual([
            'ISO', 'https://iso.org/9001', '_blank', 'noopener noreferrer',
        ]);
        expect(own.textContent).not.toContain('**');
        expect(own.querySelector(`button[title="${L.edit}"]`)!.getAttribute('aria-label'))
            .toBe(`${L.edit}: For every finding: cite the clause see ISO`);

        await click(tab(L.standingTabOrganization));
        expect(sectionOf(L.standingOrganization).querySelector('.cb-standing-text del')!.textContent).toBe('Old');
    });

    it('draws nothing it was not written with: a heading or an image is its text', async () => {
        await open(standingClient([entry({ uuid: 'i1', kind: 'instruction', body: '# Title\n![x](https://e.com/x.png)' })]));

        const text = sectionOf(L.standingInstructions).querySelector('.cb-standing-text')!;
        expect(text.querySelector('h1, img')).toBeNull();
        expect(text.textContent).toContain('Title');
    });

    it('is offered only by a client that can reach the standing context', async () => {
        const { listStandingContext: _list, ...without } = standingClient([]);
        await open(without);

        expect(container!.querySelector('.probe')!.textContent).toBe('cannot');
        expect(container!.querySelector('[role="dialog"]')).toBeNull();
    });
});
