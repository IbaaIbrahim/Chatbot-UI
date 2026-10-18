import {
    ConversationDetail,
    ConversationListFilters,
    ConversationListResponse,
    ConversationSummary,
    UserCredits,
} from './types';
import { netFetch } from '../common/localNetwork';

interface ApiResponse<T> {
    code: string;
    message: string;
    data: T;
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
            const error = new Error(`Gateway ${resp.status}: ${text}`) as Error & { status?: number };
            error.status = resp.status;
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
}
