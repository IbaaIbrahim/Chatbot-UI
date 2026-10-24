// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { StreamChatClient } from '../../api/StreamClient';
import type { StandingEntry, StandingEntryChanges, StandingEntryDraft } from '../../api/types';
import { DEFAULT_LABELS } from '../../common/labels';
import { ChatbotProvider } from '../../context/ChatbotContext';
import { useChatActions, useChatState } from '../../store/hooks';
import type { ChatActions } from '../../store/types';
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

async function open(client: object): Promise<HTMLElement> {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root!.render(
            <ChatbotProvider client={client as unknown as StreamChatClient} open onOpenChange={() => undefined}>
                <Probe />
                <StandingContextDialog />
            </ChatbotProvider>
        );
    });
    await act(async () => {
        actions!.openStandingContext();
    });
    return container;
}

const byText = (text: string, selector = 'button'): HTMLElement => {
    const found = Array.from(container!.querySelectorAll<HTMLElement>(selector)).find(el => el.textContent === text);
    if (!found) throw new Error(`no ${selector} reading "${text}"`);
    return found;
};

const sectionOf = (title: string): HTMLElement => byText(title, 'h3').closest('section')!;

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
    it('lists the user\'s own entries by kind, and the organisation\'s read-only', async () => {
        await open(standingClient(WORLD()));

        expect(sectionOf(L.standingInstructions).textContent).toContain('Answer in German.');
        const memories = sectionOf(L.standingMemories);
        expect(memories.textContent).toContain('Manages the Hamburg site.');
        expect(memories.textContent).toContain(L.standingSavedByAssistant);
        expect(memories.textContent).toContain(L.standingExpired);
        const organization = sectionOf(L.standingOrganization);
        expect(organization.textContent).toContain('Cite the ISO clause.');
        expect(organization.querySelectorAll('button')).toHaveLength(0);
        // Only what is in force counts: one memory of two.
        expect(memories.textContent).toContain('1 of 50 memories');
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

    it('is offered only by a client that can reach the standing context', async () => {
        const { listStandingContext: _list, ...without } = standingClient([]);
        await open(without);

        expect(container!.querySelector('.probe')!.textContent).toBe('cannot');
        expect(container!.querySelector('[role="dialog"]')).toBeNull();
    });
});
