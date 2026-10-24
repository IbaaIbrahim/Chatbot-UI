import {
    ConversationDetail,
    ConversationListFilters,
    ConversationListResponse,
    ConversationSummary,
    StandingEntry,
    StandingEntryChanges,
    StandingEntryDraft,
    UserCredits,
} from './types';
import { netFetch } from '../common/localNetwork';

interface ApiResponse<T> {
    code: string;
    message: string;
    data: T;
}

/**
 * A refused Gateway call: its HTTP `status`, and — when the body is the
 * Gateway's error envelope — its `code` and the precise `reason` beside it
 * (`STANDING_CONTEXT_FULL`, `STANDING_ENTRY_TOO_LONG`, …), so a caller can say
 * what went wrong rather than that something did.
 */
export type GatewayError = Error & { status?: number; code?: string; reason?: string | null };

/** The envelope's `code` and `error.reason`, when `text` is one; nothing otherwise. */
function refusalOf(text: string): { code?: string; reason?: string | null } {
    try {
        const body = JSON.parse(text) as { code?: unknown; error?: { reason?: unknown } | null };
        return {
            code: typeof body.code === 'string' ? body.code : undefined,
            reason: typeof body.error?.reason === 'string' ? body.error.reason : null,
        };
    } catch {
        return {};
    }
}

export class ConversationClient {
    private gatewayUrl: string;
    private token: string | null;

    constructor(gatewayUrl: string, token?: string | null) {
        this.gatewayUrl = gatewayUrl.replace(/\/$/, '');
        this.token = token ?? null;
    }

    setToken(token: string | null) {
        this.token = token;
    }

    /**
     * Call the Gateway and unwrap its envelope, or throw.
     *
     * Every method goes through here, writes included. A write that swallowed a
     * refused response used to report success: deleting a conversation the
     * Gateway has no route for removed the row on screen, and it came back on
     * the next reload.
     */
    private async _request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
        const resp = await netFetch(`${this.gatewayUrl}${path}`, {
            method: init.method ?? 'GET',
            headers: {
                'Authorization': `Bearer ${this.token ?? ''}`,
                'Content-Type': 'application/json',
            },
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            const error = new Error(`Gateway ${resp.status}: ${text}`) as GatewayError;
            error.status = resp.status;
            Object.assign(error, refusalOf(text));
            throw error;
        }

        const NO_CONTENT = 204;
        if (resp.status === NO_CONTENT) return undefined as T;

        const envelope: ApiResponse<T> = await resp.json();
        return envelope.data;
    }

    async getConversations(
        limit?: number,
        offset?: number,
        filters: ConversationListFilters = {}
    ): Promise<ConversationListResponse> {
        const params = new URLSearchParams();
        if (limit !== undefined) params.set('limit', String(limit));
        if (offset !== undefined) params.set('offset', String(offset));
        if (filters.query?.trim()) params.set('q', filters.query.trim());
        if (filters.starred !== undefined) params.set('starred', String(filters.starred));
        const qs = params.toString();
        const data = await this._request<{ conversations: ConversationListResponse }>(
            `/v1/user/conversations${qs ? '?' + qs : ''}`
        );
        return data.conversations;
    }

    async getConversationDetail(id: string): Promise<ConversationDetail> {
        const data = await this._request<{ conversation: ConversationDetail }>(`/v1/user/conversations/${id}`);
        return data.conversation;
    }

    async setConversationStarred(id: string, starred: boolean): Promise<ConversationSummary> {
        const data = await this._request<{ conversation: ConversationSummary }>(
            `/v1/user/conversations/${id}`,
            { method: 'PATCH', body: { starred } }
        );
        return data.conversation;
    }

    /** Give the conversation a title of the user's own; resolves to the updated summary. */
    async renameConversation(id: string, title: string): Promise<ConversationSummary> {
        const data = await this._request<{ conversation: ConversationSummary }>(
            `/v1/user/conversations/${id}`,
            { method: 'PATCH', body: { title } }
        );
        return data.conversation;
    }

    /** The signed-in user's own allowance. Rejects with `status` 404 on a Gateway without the route. */
    async getCredits(): Promise<UserCredits> {
        const data = await this._request<{ credits: UserCredits }>('/v1/user/credits');
        return data.credits;
    }

    async deleteConversation(id: string): Promise<void> {
        await this._request<unknown>(`/v1/user/conversations/${id}`, { method: 'DELETE' });
    }

    // --- Standing context (ADR-021): what every conversation of the user is told ---

    /** The user's own entries (active and expired), then their organisation's in force now. */
    async listStandingContext(): Promise<StandingEntry[]> {
        const data = await this._request<{ entries: StandingEntry[] }>('/v1/user/standing-context');
        return data.entries;
    }

    /** Rejects with the Gateway's `reason` — `STANDING_CONTEXT_FULL`, `STANDING_ENTRY_TOO_LONG`, … */
    async createStandingEntry(draft: StandingEntryDraft): Promise<StandingEntry> {
        const data = await this._request<{ entry: StandingEntry }>('/v1/user/standing-context', {
            method: 'POST',
            body: draft,
        });
        return data.entry;
    }

    async updateStandingEntry(uuid: string, changes: StandingEntryChanges): Promise<StandingEntry> {
        const data = await this._request<{ entry: StandingEntry }>(`/v1/user/standing-context/${uuid}`, {
            method: 'PATCH',
            body: changes,
        });
        return data.entry;
    }

    /** Removes the entry for good: no later conversation is told it. */
    async deleteStandingEntry(uuid: string): Promise<void> {
        await this._request<unknown>(`/v1/user/standing-context/${uuid}`, { method: 'DELETE' });
    }
}
