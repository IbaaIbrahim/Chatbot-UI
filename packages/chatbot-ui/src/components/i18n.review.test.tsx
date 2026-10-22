// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { StreamChatClient, StreamEvent } from '../api/StreamClient';
import { StreamClient } from '../api/StreamClient';
import { StorageClient, StorageRequestError } from '../api/StorageClient';
import type { ConversationJob, ConversationStep } from '../api/types';
import type { ChatbotConfig } from '../common/chatbotConfig';
import { describeLabelledError, formatList, resolveLabels } from '../common/i18n';
import { DEFAULT_LABELS, type ChatTranslations } from '../common/labels';
import { DEFAULT_TOOL_NAMES, TOOL_NAME_LABELS, resolveToolDisplayName, type ToolConfig } from '../common/toolConfig';
import { ChatbotProvider } from '../context/ChatbotContext';
import { jobsToMessageProps } from '../hooks/useConversations';
import { useStreamChat } from '../hooks/useStreamChat';
import { useChatOverrides, useLabels } from '../store/hooks';
import { AttachmentPreview } from './AttachmentViewer/AttachmentViewer';
import { ChatContainer } from './ChatContainer/ChatContainer';
import { MarkdownContent } from './MarkdownContent/MarkdownContent';
import { MessageBubble, type MessageProps, type MessageStep } from './MessageBubble/MessageBubble';

/**
 * What a review of the first pass found still in English or still frozen
 * (2026-10-18), on screen: the platform's tool names, a host's tool names
 * after a reload, react-pdf's and remark's own words, text the chat writes
 * into a turn, and a few places a translation could break.
 */

// The PDF viewer's library, as props: what the viewer hands it is the test.
const pdf = vi.hoisted(() => ({ document: null as any, page: null as any }));
vi.mock('react-pdf', () => ({
    Document: (props: any) => {
        pdf.document = props;
        return props.children ?? null;
    },
    Page: (props: any) => {
        pdf.page = props;
        return null;
    },
    pdfjs: { GlobalWorkerOptions: {}, version: 'test' },
}));

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

function render(element: React.ReactElement): HTMLElement {
    if (!container) {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    }
    act(() => root!.render(element));
    return container;
}

async function settle(): Promise<void> {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
    });
}

/** The text of a React element a library was handed, drawn on its own. */
function textOf(element: React.ReactNode): string {
    const host = document.createElement('div');
    const own = createRoot(host);
    act(() => own.render(<>{element}</>));
    const text = host.textContent ?? '';
    act(() => own.unmount());
    return text;
}

const RUSSIAN: ChatTranslations = {
    ru: {
        toolRan: 'Выполнено',
        toolNameWebSearch: 'Поиск в интернете',
        toolNameFetchWebPage: 'Загрузка страницы',
        metaLoadedTools: 'Загружены инструменты · {names}',
        activityRanTool: 'выполнено: {name}',
        activityThoughts: { one: 'подумал {count} раз', few: 'подумал {count} раза', many: 'подумал {count} раз', other: 'подумал {count} раза' },
    },
};

const call = (id: string, toolSlug: string, extra: Partial<MessageStep> = {}): MessageStep =>
    ({ id, type: 'tool-call', toolSlug, toolStatus: 'completed', ...extra });

function bubble(steps: MessageStep[], config: ChatbotConfig, tools?: Record<string, ToolConfig>, extra: Partial<MessageProps> = {}) {
    return (
        <ChatbotProvider config={config}>
            <MessageBubble id="m" role="assistant" shouldAnimate={false} steps={steps} tools={tools} {...extra} />
        </ChatbotProvider>
    );
}

describe("the platform's tools, by name", () => {
    it('are labels, with the English they had', () => {
        Object.entries(TOOL_NAME_LABELS).forEach(([slug, key]) => {
            expect(DEFAULT_LABELS[key]).toBe(DEFAULT_TOOL_NAMES[slug]);
        });
        expect(DEFAULT_TOOL_NAMES.web_search).toBe('Web search');
        expect(DEFAULT_TOOL_NAMES.search_web).toBe('Web search');
    });

    it('are named in the chat\'s language: a row, a meta-tool row, the activity header', () => {
        const page = render(bubble([
            call('a', 'web_search', { toolName: 'Web Search' }),
            { id: 'x', type: 'text', content: 'ok' },
            call('b', 'load_tool', { toolArgs: { names: ['web_search', 'fetch_web_page'] }, toolResult: { loaded: ['web_search', 'fetch_web_page'] } }),
        ], { language: 'ru', translations: RUSSIAN }));

        expect(page.querySelector('.cb-modern-tool-code')?.textContent).toBe('Поиск в интернете');
        expect(page.querySelector('.cb-modern-tool-meta-text')?.textContent)
            .toBe(`Загружены инструменты · ${formatList(['Поиск в интернете', 'Загрузка страницы'], 'ru')}`);
        expect(page.textContent).not.toMatch(/Web search|Fetch web page/);
    });

    it('name an approval in the chat\'s language, its card and its words', () => {
        const page = render(bubble([{
            id: 'ap', type: 'confirm-request', toolCallId: 'ap', toolSlug: 'web_search', toolName: 'Web Search',
            confirmStatus: 'pending',
            localizedConfirmDescription: ({ format, toolName }) => format.label(format.labels.approvalOnServer, { tool: toolName('web_search', 'Web Search') }),
        }], { language: 'ru', translations: { ru: { ...RUSSIAN.ru, approvalOnServer: 'Ассистент хочет выполнить «{tool}» на сервере.' } } }));

        expect(page.textContent).toContain('Поиск в интернете');
        expect(page.textContent).toContain('Ассистент хочет выполнить «Поиск в интернете» на сервере.');
        expect(page.textContent).not.toContain('Web');
    });

    it("show a host's name for its tool after a reload as live, and the platform's name for a slug nothing names", () => {
        const tools: Record<string, ToolConfig> = { web_search: { displayName: 'Websuche', preview: () => undefined, show: false } };
        const reloaded = jobsToMessageProps([reloadedJob([
            stepOf({ tool_slug: 'web_search', tool_name: 'Web search' }),
            stepOf({ tool_slug: 'list_inspections', tool_name: 'List inspections' }),
            stepOf({ tool_slug: 'custom_data_fetch' }),
        ])]).find(message => message.role === 'assistant')!;
        const live: MessageStep = call('live', 'web_search');

        const page = render(bubble([...(reloaded.steps ?? []), { id: 'x', type: 'text', content: 'ok' }, live], {}, tools));
        const names = [...page.querySelectorAll('.cb-activity .cb-modern-tool-code, .cb-modern-tool-code')].map(node => node.textContent);
        // Opened, the reloaded group names its tools: the host's, the platform's, the slug in words.
        act(() => page.querySelector<HTMLButtonElement>('.cb-activity-btn')?.click());
        const opened = [...page.querySelectorAll('.cb-modern-tool-code')].map(node => node.textContent);
        expect(opened).toEqual(['Websuche', 'List inspections', 'Custom Data Fetch', 'Websuche']);
        expect(names).toContain('Websuche');
    });

    it('resolve the same outside a component, given the labels', () => {
        const labels = resolveLabels('ru', RUSSIAN);
        expect(resolveToolDisplayName('web_search', undefined, { labels })).toBe('Поиск в интернете');
        expect(resolveToolDisplayName('web_search', { web_search: { name: 'Mine', run: () => undefined } }, { labels })).toBe('Mine');
        expect(resolveToolDisplayName('list_inspections', undefined, { labels, rawName: 'List inspections' })).toBe('List inspections');
        expect(resolveToolDisplayName('', undefined, { labels })).toBe(DEFAULT_LABELS.toolName);
        // The 4.1 signature: a fallback text third.
        expect(resolveToolDisplayName('', undefined, 'Werkzeug')).toBe('Werkzeug');
    });
});

let sequence = 0;
function stepOf(overrides: Partial<ConversationStep> & { tool_name?: string }): ConversationStep {
    sequence += 1;
    return {
        uuid: `step-${sequence}`,
        step_type: 'tool_call',
        step_sequence: sequence,
        status: 'completed',
        request_message: null,
        response_payload: null,
        tool_slug: null,
        tool_input: null,
        tool_output: null,
        dispatch_mode: null,
        input_tokens: 0,
        output_tokens: 0,
        credits_charged: 0,
        started_at: '2026-10-18T10:00:00Z',
        completed_at: null,
        ...overrides,
    } as ConversationStep;
}

function reloadedJob(steps: ConversationStep[], overrides: Partial<ConversationJob> = {}): ConversationJob {
    return {
        uuid: 'job-1',
        user_prompt: 'Search',
        status: 'completed',
        total_steps: null,
        total_input_tokens: null,
        total_output_tokens: null,
        total_credits_charged: null,
        created_at: '2026-10-18T10:00:00Z',
        updated_at: '2026-10-18T10:00:00Z',
        attachments: [],
        steps,
        ...overrides,
    } as ConversationJob;
}

describe('text the chat writes into a turn', () => {
    /** A client that sends `frames`, then fails with `fail` — or, without one, stays open (a run still waiting). */
    function streamed(frames: StreamEvent[], fail?: Error): StreamChatClient {
        return {
            async sendMessage(_text, onEvent, _onComplete, onError) {
                for (const frame of frames) onEvent(frame);
                if (fail) onError(fail);
                else await new Promise(() => undefined);
            },
        };
    }

    /** The provider's chat, driven by a client, its transcript drawn. */
    const Transcript: React.FC<{ client: StreamChatClient; sendRef: { current: ((text: string) => Promise<void>) | null } }> = ({ client, sendRef }) => {
        const labels = useLabels();
        const chat = useStreamChat({ client, getLabels: () => labels });
        sendRef.current = chat.sendMessage;
        return <>{chat.messages.map(message => <MessageBubble key={message.id} {...message} shouldAnimate={false} />)}</>;
    };

    it('follows a language switched after it was written: an error, a notice, a check-in, an approval', async () => {
        vi.spyOn(console, 'debug').mockImplementation(() => undefined);
        const sendRef: { current: ((text: string) => Promise<void>) | null } = { current: null };
        const frames: StreamEvent[] = [
            { type: 'approval_request', data: { payload: { approval_uuid: 'ap', tool_slug: 'web_search', tool_input: {}, dispatch_mode: 'kafka' } } },
            { type: 'check_in_request', data: { payload: { check_in_uuid: 'ci', elapsed_seconds: 65 } } },
            { type: 'rate_limited', data: { payload: { retry_after_seconds: 0 } } },
        ];
        const client = streamed(frames);
        const translations: ChatTranslations = {
            de: {
                checkInTitle: 'Weiterarbeiten?',
                checkInBody: 'Der Agent arbeitet seit {duration}. Weiter?',
                durationMinutes: '{minutes} Min. {seconds} Sek.',
                waitingForCapacity: 'Warte auf Kapazität…',
                approvalOnServer: 'Der Assistent will {tool} auf dem Server ausführen.',
                toolNameWebSearch: 'Websuche',
            },
        };
        const page = render(<ChatbotProvider config={{ language: 'en', translations }}><Transcript client={client} sendRef={sendRef} /></ChatbotProvider>);
        // The run stays open, waiting: its notice stays on screen.
        act(() => {
            void sendRef.current!('hi');
        });
        await settle();
        expect(page.querySelector('.cb-step-notice-text')?.textContent).toBe('Waiting for capacity…');
        expect(page.textContent).toContain('Continue working?');
        expect(page.textContent).toContain('The agent has been working for 1 min 5 s. Continue?');
        expect(page.textContent).toContain('The assistant wants to run Web search on the server.');

        render(<ChatbotProvider config={{ language: 'de', translations }}><Transcript client={client} sendRef={sendRef} /></ChatbotProvider>);
        expect(page.textContent).toContain('Weiterarbeiten?');
        expect(page.textContent).toContain('Der Agent arbeitet seit 1 Min. 5 Sek.. Weiter?');
        expect(page.textContent).toContain('Der Assistent will Websuche auf dem Server ausführen.');
        expect(page.querySelector('.cb-step-notice-text')?.textContent).toBe('Warte auf Kapazität…');
    });

    it('writes a failed turn\'s error again in the language in force', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const sendRef: { current: ((text: string) => Promise<void>) | null } = { current: null };
        const client = streamed([], Object.assign(new Error('Gateway unreachable: TypeError'), { labelKey: 'errorGatewayUnreachable' }));
        const translations: ChatTranslations = { de: { errorGatewayUnreachable: 'Keine Verbindung.', errorTryAgain: 'Bitte erneut.' } };
        const page = render(<ChatbotProvider config={{ language: 'en', translations }}><Transcript client={client} sendRef={sendRef} /></ChatbotProvider>);
        await act(async () => {
            await sendRef.current!('hi');
        });
        expect(page.querySelector('.cb-error-text')?.textContent).toBe(`${DEFAULT_LABELS.errorGatewayUnreachable}\n\n${DEFAULT_LABELS.errorTryAgain}`);
        render(<ChatbotProvider config={{ language: 'de', translations }}><Transcript client={client} sendRef={sendRef} /></ChatbotProvider>);
        expect(page.querySelector('.cb-error-text')?.textContent).toBe('Keine Verbindung.\n\nBitte erneut.');
    });

    it('rebuilds a reloaded check-in and approval in the language in force', () => {
        const job = reloadedJob([], {
            status: 'running',
            pending_approvals: [
                { approval_uuid: 'ci', tool_slug: 'continue_working', tool_input: { elapsed_seconds: 30 }, dispatch_mode: 'harness' },
                { approval_uuid: 'ap', tool_slug: 'fetch_web_page', tool_input: {}, dispatch_mode: 'kafka' },
            ],
        } as Partial<ConversationJob>);
        const reloaded = jobsToMessageProps([job]).find(message => message.role === 'assistant')!;
        const translations: ChatTranslations = {
            de: {
                checkInTitle: 'Weiterarbeiten?',
                checkInRecorded: 'Pause nach {duration}.',
                durationSeconds: '{seconds} Sek.',
                approvalOnServer: '{tool} auf dem Server?',
                toolNameFetchWebPage: 'Seite laden',
            },
        };
        const page = render(bubble(reloaded.steps ?? [], { language: 'de', translations }));
        expect(page.textContent).toContain('Weiterarbeiten?');
        expect(page.textContent).toContain('Pause nach 30 Sek..');
        expect(page.textContent).toContain('Seite laden auf dem Server?');
    });
});

describe("the PDF viewer's own words", () => {
    const load = { state: 'ready' as const, blobUrl: 'blob:pdf', textContent: null, errorMsg: '' };
    const config: ChatbotConfig = {
        language: 'de',
        translations: {
            de: {
                pdfLoadFailed: 'PDF nicht geladen.',
                pdfPageLoadFailed: 'Seite nicht geladen.',
                pdfNoFile: 'Kein PDF.',
                pdfNoPage: 'Keine Seite.',
                pdfPasswordProtected: 'Mit Passwort geschützt.',
            },
        },
    };

    it('are the chat\'s labels, on the document and on each page', () => {
        render(
            <ChatbotProvider config={config}>
                <AttachmentPreview attachment={{ id: 'p', type: 'file', url: '/p', name: 'Bericht.pdf', contentType: 'application/pdf' }} load={load} />
            </ChatbotProvider>
        );
        expect(textOf(pdf.document.error)).toBe('PDF nicht geladen.');
        expect(textOf(pdf.document.noData)).toBe('Kein PDF.');
        expect(textOf(pdf.page.error)).toBe('Seite nicht geladen.');
        expect(textOf(pdf.page.noData)).toBe('Keine Seite.');
        // A spinner, not react-pdf's "Loading page…".
        expect(textOf(pdf.page.loading)).toBe('');
    });

    it('refuse a password-protected PDF without asking, and say why', () => {
        const prompt = vi.spyOn(window, 'prompt').mockImplementation(() => null);
        render(
            <ChatbotProvider config={config}>
                <AttachmentPreview attachment={{ id: 'p', type: 'file', url: '/p', name: 'Geheim.pdf', contentType: 'application/pdf' }} load={load} />
            </ChatbotProvider>
        );
        const answers: unknown[] = [];
        act(() => pdf.document.onPassword((answer: unknown) => answers.push(answer), 1));
        expect(answers).toHaveLength(1);
        expect(answers[0]).toBeInstanceOf(Error);
        expect(prompt).not.toHaveBeenCalled();
        expect(textOf(pdf.document.error)).toBe('Mit Passwort geschützt.');
    });
});

describe("an answer's footnotes", () => {
    it('are headed and linked back in the chat\'s language, the heading hidden by the chat\'s own class', () => {
        const page = render(
            <ChatbotProvider config={{ language: 'de', translations: { de: { footnotes: 'Fußnoten', footnoteBack: 'Zurück zu Verweis {reference}' } } }}>
                <MarkdownContent content={'Satz.[^1]\n\n[^1]: Quelle.'} />
            </ChatbotProvider>
        );
        const heading = page.querySelector('#footnote-label, [id$="footnote-label"]');
        expect(heading?.textContent).toBe('Fußnoten');
        expect(heading?.className).toBe('cb-visually-hidden');
        expect(page.querySelector('[data-footnote-backref]')?.getAttribute('aria-label')).toBe('Zurück zu Verweis 1');
        expect(page.textContent).not.toMatch(/Footnotes|Back to reference/);
    });
});

describe('failures a host shows', () => {
    it("name a label in the storage client's errors", async () => {
        const unconfigured = new StorageClient({ storageApiUrl: '' });
        const error = await unconfigured.listConversationFiles('c').catch((caught: unknown) => caught) as StorageRequestError;
        expect(error).toBeInstanceOf(StorageRequestError);
        expect(error.labelKey).toBe('storageNotConfigured');

        vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const offline = new StorageClient({ storageApiUrl: 'https://storage.example', token: 't' });
        const unreachable = await offline.listConversationFiles('c').catch((caught: unknown) => caught) as StorageRequestError;
        expect(unreachable.labelKey).toBe('storageUnreachable');
        const labels = resolveLabels('de', { de: { storageUnreachable: 'Speicher nicht erreichbar.' } });
        expect(describeLabelledError(unreachable, labels)).toBe('Speicher nicht erreichbar.');

        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{"message":"Forbidden"}', { status: 403 }));
        const refused = await offline.listConversationFiles('c').catch((caught: unknown) => caught) as StorageRequestError;
        expect(refused.message).toBe('Forbidden');
        expect(describeLabelledError(refused, DEFAULT_LABELS)).toBe('The file storage refused the request (403).');
    });

    it("name a label in the plain stream client's network and read failures", async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const client = new StreamClient({ baseUrl: 'https://stream.example' });
        const errors: Error[] = [];
        await client.sendMessage('hi', () => undefined, () => undefined, error => errors.push(error));
        expect((errors[0] as Error & { labelKey?: string }).labelKey).toBe('errorGatewayUnreachable');
    });
});

describe('places a translation could break', () => {
    it('keys the sidebar\'s date groups by what they are, not by their words', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const now = new Date();
        const old = new Date(now.getTime() - 40 * 24 * 3600 * 1000);
        const client = {
            sendMessage: async () => undefined,
            getConversationId: () => null,
            setConversationId: () => undefined,
            getConversations: async (_offset: number, _limit: number, options?: { starred?: boolean }) => ({
                items: options?.starred ? [] : [
                    { uuid: 'c1', title: 'Heute', created_at: now.toISOString(), updated_at: now.toISOString() },
                    { uuid: 'c2', title: 'Alt', created_at: old.toISOString(), updated_at: old.toISOString() },
                ],
                pagination: { total: options?.starred ? 0 : 2, page: 1, per_page: 20, pages: 1 },
            }),
            getConversationDetail: async (id: string) => ({ uuid: id, title: '', created_at: '', updated_at: '', jobs: [] }),
        } as unknown as StreamChatClient;
        const same = 'ЖЖЖ';
        const page = render(
            <ChatbotProvider config={{ language: 'xx', translations: { xx: { today: same, yesterday: same, previous7Days: same, older: same } } }} client={client} defaultSidebarOpen>
                <ChatContainer mode="fullscreen" />
            </ChatbotProvider>
        );
        await settle();
        expect([...page.querySelectorAll('.cb-conversation-title')].map(node => node.textContent)).toEqual(['Heute', 'Alt']);
        expect(error.mock.calls.some(args => String(args[0]).includes('same key'))).toBe(false);
    });

    it('takes a screen\'s layer written inline — plural forms, translations — as the same layer each render', () => {
        let renders = 0;
        const Screen: React.FC = () => {
            renders += 1;
            const labels = useLabels();
            useChatOverrides({
                language: 'de',
                labels: { credits: { one: '{count} Kredit', other: '{count} Kredite' } },
                translations: { de: { newChat: 'Neuer Chat', steps: { one: '{count} Schritt', other: '{count} Schritte' } } },
            });
            return <span className="probe">{labels.newChat}</span>;
        };
        const page = render(<ChatbotProvider config={{}}><Screen /></ChatbotProvider>);
        expect(page.querySelector('.probe')?.textContent).toBe('Neuer Chat');
        expect(renders).toBeLessThan(6);
    });
});
