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

    /**
     * Stop reading this conversation's stream without giving up the ability to
     * re-open it.
     *
     * Called when the user switches away from a conversation. Aborting outright
     * would be wrong — the job keeps running and billing on the server either
     * way, so the reader is parked rather than discarded, and switching back
     * re-opens it.
     */
    parkStream?(conversationId: string): void;

    /**
     * Whether this conversation's turn can still be re-opened.
     *
     * The answer is about the *credential*, not about the job: a stream token
     * expires long before a job row does, so a client that no longer holds a
     * usable one cannot resume however live the run is. Callers use this to
     * decide whether to raise a spinner at all.
     */
    hasLiveTurn?(conversationId: string): boolean;

    /**
     * Re-open this conversation's stream from the turn's own boundary, which
     * replays the whole turn.
     *
     * Returns why the read ended rather than taking a completion callback,
     * because the caller has to tell the cases apart: ``expired`` means the
     * token died and no amount of retrying helps, while ``errored`` is a
     * failure worth reporting as one.
     */
    resumeStream?(
        conversationId: string,
        onEvent: (event: StreamEvent) => void,
        onError: (error: Error) => void,
    ): Promise<StreamOutcome>;

    /**
     * Ask the server to stop the turn in progress.
     *
     * Distinct from aborting the stream: that stops watching, this stops the
     * run. A client that only aborted locally left the job executing and
     * billing with nobody listening.
     */
    cancelTurn?(conversationId?: string): Promise<void>;

    /** The conversation this client is currently in, if any. */
    getConversationId?(): string | null;

    /** The job whose turn is re-openable in this conversation, if any. */
    getLiveJobId?(conversationId: string): string | null;

    /**
     * Answer a client tool call recovered from the transcript rather than from a
     * stream — the only path that works in a browser which did not start the run.
     */
    submitClientToolResult?(
        jobId: string,
        stepUuid: string,
        toolOutput: any,
    ): Promise<void>;
}

/**
 * Why a stream read ended.
 *
 * ``dropped`` is absent on purpose: it is an internal outcome the reconnect
 * loop consumes itself, never something a caller sees.
 */
export type StreamOutcome =
    | 'completed'
    | 'errored'
    | 'expired'
    | 'stalled'
    | 'aborted';

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
