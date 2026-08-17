export interface StreamEvent {
    type: string;
    data: any;
}

export interface StreamChatClient {
    sendMessage(
        text: string,
        onEvent: (event: StreamEvent) => void,
        onComplete: () => void,
        onError: (error: Error) => void,
        fileIds?: string[]
    ): Promise<void>;
    /** Called when the user starts a new conversation. */
    reset?(): void;
}

export interface StreamClientConfig {
    baseUrl: string;
    headers?: Record<string, string>;
}

export class StreamClient {
    private config: StreamClientConfig;

    constructor(config: StreamClientConfig) {
        this.config = config;
    }

    async sendMessage(
        text: string,
        onEvent: (event: StreamEvent) => void,
        onComplete: () => void,
        onError: (error: Error) => void,
        _fileIds?: string[]
    ): Promise<void> {
        let response: Response;
        try {
            response = await fetch(this.config.baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.config.headers,
                },
                body: JSON.stringify({ message: text }),
            });
        } catch (err) {
            onError(err instanceof Error ? err : new Error(String(err)));
            return;
        }

        if (!response.ok) {
            onError(new Error(`HTTP ${response.status}: ${response.statusText}`));
            return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
            onError(new Error('No response body'));
            return;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let currentEventType = 'message';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        currentEventType = line.slice(7).trim();
                    } else if (line.startsWith('data: ')) {
                        const raw = line.slice(6).trim();
                        if (raw === '[DONE]') {
                            onComplete();
                            return;
                        }
                        try {
                            const parsed = JSON.parse(raw);
                            onEvent({ type: parsed.type ?? currentEventType, data: parsed });
                        } catch {
                            onEvent({ type: currentEventType, data: { content: raw } });
                        }
                        currentEventType = 'message';
                    } else if (line === '') {
                        currentEventType = 'message';
                    }
                }
            }
            onComplete();
        } catch (err) {
            onError(err instanceof Error ? err : new Error(String(err)));
        } finally {
            reader.releaseLock();
        }
    }
}
