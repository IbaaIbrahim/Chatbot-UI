// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatbotProvider } from './ChatbotContext';
import { GatewayStreamClient } from '../api/GatewayStreamClient';
import type { ClientSkillDefinition } from '../common/toolConfig';

/**
 * The provider's `skills` prop: handed to the client, before anything can make
 * the client answer a host request with an empty list.
 *
 * The one thing that can is the restore effect — reopening the tab's
 * conversation replays its live turn, and a replayed host request is answered
 * from whatever the client holds at that moment — so the order is tested
 * against it directly.
 */

const GATEWAY_URL = 'https://gateway.test';
const CONFIG = { composer: { tools: false } };

const SKILLS: ClientSkillDefinition[] = [
    { slug: 'manage_assets', name: 'Manage assets', description: 'Assets.', instructions: 'List first.' },
];

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    sessionStorage.clear();
    // The conversation list the provider reads on mount is empty; nothing else
    // it asks for matters here.
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (
        String(input).startsWith(`${GATEWAY_URL}/v1/user/conversations?`)
            ? {
                ok: true,
                status: 200,
                json: async () => ({ data: { conversations: { items: [], pagination: { total: 0 } } } }),
            }
            : { ok: false, status: 500, headers: { get: () => null }, json: async () => ({}), text: async () => '' }
    )));
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function render(element: React.ReactElement): void {
    if (!container) {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    }
    act(() => root!.render(element));
}

describe('ChatbotProvider — skills', () => {
    it('hands the skills to the client', () => {
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });

        render(<ChatbotProvider client={client} config={CONFIG} skills={SKILLS}>{null}</ChatbotProvider>);

        expect(client.getSkills()).toEqual(SKILLS);
    });

    it('hands them over before the tab\'s conversation is reopened', async () => {
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });
        client.setConversationId('conv-1');
        const order: string[] = [];
        vi.spyOn(client, 'setSkills').mockImplementation(function (this: GatewayStreamClient, skills) {
            order.push(`setSkills:${skills.length}`);
            GatewayStreamClient.prototype.setSkills.call(client, skills);
        });
        vi.spyOn(client, 'getConversationDetail').mockImplementation(async () => {
            order.push(`reopen:${client.getSkills().length}`);
            throw new Error('not in this test');
        });

        render(<ChatbotProvider client={client} config={CONFIG} skills={SKILLS}>{null}</ChatbotProvider>);
        await act(async () => { await Promise.resolve(); });

        expect(order[0]).toBe('setSkills:1');
        expect(order).toContain('reopen:1');
    });

    it('follows a new list, and [] clears it', () => {
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });
        const more = [...SKILLS, { slug: 'review_inspections', name: 'Review', description: 'Review.', instructions: 'Read.' }];

        render(<ChatbotProvider client={client} config={CONFIG} skills={SKILLS}>{null}</ChatbotProvider>);
        render(<ChatbotProvider client={client} config={CONFIG} skills={more}>{null}</ChatbotProvider>);
        expect(client.getSkills().map(skill => skill.slug)).toEqual(['manage_assets', 'review_inspections']);

        render(<ChatbotProvider client={client} config={CONFIG} skills={[]}>{null}</ChatbotProvider>);
        expect(client.getSkills()).toEqual([]);
    });

    it('leaves skills set on the client alone when the prop is omitted', () => {
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });
        client.setSkills(SKILLS);

        render(<ChatbotProvider client={client} config={CONFIG}>{null}</ChatbotProvider>);

        expect(client.getSkills()).toEqual(SKILLS);
    });

    it('is harmless with a client that serves no skills', () => {
        const client = { sendMessage: vi.fn(async () => {}) };

        expect(() => render(<ChatbotProvider client={client} config={CONFIG} skills={SKILLS}>{null}</ChatbotProvider>))
            .not.toThrow();
    });
});

describe('ChatbotProvider — block languages', () => {
    // 2026-10-14: every job names the fence languages the page draws, so the
    // platform indexes those blocks (the files panel and Artifacts list them).
    const Chart: React.FC = () => null;

    it('hands the client the languages of the merged renderers, and follows a screen that adds or removes one', () => {
        const client = new GatewayStreamClient({ gatewayUrl: GATEWAY_URL });
        const base = { ...CONFIG, markdown: { blockRenderers: { table: { component: Chart }, chart: { component: Chart } } } };

        render(<ChatbotProvider client={client} config={base}>{null}</ChatbotProvider>);
        expect(client.getBlockLanguages()).toEqual(['chart', 'table']);

        const fewer = { ...CONFIG, markdown: { blockRenderers: { chart: { component: Chart }, Weird: { component: Chart } } } };
        render(<ChatbotProvider client={client} config={fewer}>{null}</ChatbotProvider>);
        expect(client.getBlockLanguages()).toEqual(['chart']);

        render(<ChatbotProvider client={client} config={CONFIG}>{null}</ChatbotProvider>);
        expect(client.getBlockLanguages()).toEqual([]);
    });
});
