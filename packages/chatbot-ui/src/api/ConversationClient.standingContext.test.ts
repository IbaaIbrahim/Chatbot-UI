import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationClient, type GatewayError } from './ConversationClient';

/**
 * The user's standing context over the Gateway (`/v1/user/standing-context`,
 * ADR-021): the routes, the bodies — `expires_on: null` sent when it clears —
 * and a refusal's `code` and `reason` kept on the error, so the panel can say
 * exactly what was refused.
 */

const GATEWAY = 'https://gateway.test';
const ENTRY = { uuid: 'e1', kind: 'memory', body: 'Prefers metric.' };

type Call = { url: string; method: string; body: unknown; auth: string | undefined };
let calls: Call[] = [];

function answer(status: number, body: unknown): void {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>;
        calls.push({
            url,
            method: init.method ?? 'GET',
            body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
            auth: headers.Authorization,
        });
        return {
            ok: status < 400,
            status,
            json: async () => body,
            text: async () => JSON.stringify(body),
        };
    }));
}

afterEach(() => {
    calls = [];
    vi.unstubAllGlobals();
});

describe('ConversationClient — standing context', () => {
    it('lists, creates, changes and deletes through the user routes with the token', async () => {
        const client = new ConversationClient(`${GATEWAY}/`, 'user-token');

        answer(200, { data: { entries: [ENTRY] } });
        expect(await client.listStandingContext()).toEqual([ENTRY]);
        answer(201, { data: { entry: ENTRY } });
        expect(await client.createStandingEntry({ kind: 'memory', body: 'Prefers metric.', expires_on: '2026-11-10' }))
            .toEqual(ENTRY);
        answer(200, { data: { entry: ENTRY } });
        await client.updateStandingEntry('e1', { body: 'Prefers imperial.', expires_on: null });
        answer(204, undefined);
        await client.deleteStandingEntry('e1');

        expect(calls.map(call => [call.method, call.url])).toEqual([
            ['GET', `${GATEWAY}/v1/user/standing-context`],
            ['POST', `${GATEWAY}/v1/user/standing-context`],
            ['PATCH', `${GATEWAY}/v1/user/standing-context/e1`],
            ['DELETE', `${GATEWAY}/v1/user/standing-context/e1`],
        ]);
        expect(calls[1].body).toEqual({ kind: 'memory', body: 'Prefers metric.', expires_on: '2026-11-10' });
        // `null` is sent, not dropped: it is what clears an end date.
        expect(calls[2].body).toEqual({ body: 'Prefers imperial.', expires_on: null });
        expect(calls.every(call => call.auth === 'Bearer user-token')).toBe(true);
    });

    it('keeps a refusal\'s code and reason on the error', async () => {
        const client = new ConversationClient(GATEWAY, 'user-token');
        answer(409, {
            code: 'STANDING_CONTEXT_FULL',
            message: 'This scope already holds 50 memories.',
            error: { reason: 'STANDING_CONTEXT_FULL' },
        });

        const error = (await client.createStandingEntry({ kind: 'memory', body: 'x' }).catch(e => e)) as GatewayError;

        expect(error.status).toBe(409);
        expect(error.code).toBe('STANDING_CONTEXT_FULL');
        expect(error.reason).toBe('STANDING_CONTEXT_FULL');
    });

    it('leaves code and reason unset when the body is not the envelope', async () => {
        const client = new ConversationClient(GATEWAY, 'user-token');
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, text: async () => '<html>Bad gateway</html>' })));

        const error = (await client.listStandingContext().catch(e => e)) as GatewayError;

        expect(error.status).toBe(502);
        expect(error.code).toBeUndefined();
        expect(error.reason).toBeUndefined();
    });
});
