import { ConversationDetail, ConversationListResponse } from './types';
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

    private async _fetch<T>(path: string): Promise<T> {
        const resp = await netFetch(`${this.gatewayUrl}${path}`, {
            headers: {
                'Authorization': `Bearer ${this.token ?? ''}`,
                'Content-Type': 'application/json',
            },
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error(`Gateway ${resp.status}: ${text}`);
        }

        const envelope: ApiResponse<T> = await resp.json();
        return envelope.data;
    }

    async getConversations(limit?: number, offset?: number): Promise<ConversationListResponse> {
        const params = new URLSearchParams();
        if (limit !== undefined) params.set('limit', String(limit));
        if (offset !== undefined) params.set('offset', String(offset));
        const qs = params.toString();
        const data = await this._fetch<{ conversations: ConversationListResponse }>(`/v1/user/conversations${qs ? '?' + qs : ''}`);
        return data.conversations;
    }

    async getConversationDetail(id: string): Promise<ConversationDetail> {
        const data = await this._fetch<{ conversation: ConversationDetail }>(`/v1/user/conversations/${id}`);
        return data.conversation;
    }
}
