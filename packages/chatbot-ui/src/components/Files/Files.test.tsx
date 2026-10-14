// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatbotProvider } from '../../context/ChatbotContext';
import { ChatContainer } from '../ChatContainer/ChatContainer';
import type { ChatMode } from '../ChatContainer/presentation';
import { ChatHeader } from '../ChatHeader/ChatHeader';
import { Composer } from '../Composer/Composer';
import { ConversationSidebar } from '../ConversationSidebar/ConversationSidebar';
import { ConversationFilesPanel } from './ConversationFilesPanel';
import { ArtifactsPanel } from './ArtifactsPanel';
import { useChatActions, useChatEvent, useChatState } from '../../store/hooks';
import type { ChatActions, FilesChangedPayload } from '../../store/types';
import type { BlockRenderer, BlockRenderProps, ChatbotConfig } from '../../common/chatbotConfig';
import type { StreamChatClient } from '../../api/StreamClient';
import { blockKeyOf } from '../../common/markdownBlocks';
import type { BlockRecord } from '../../api/types';
import { mergeConversation } from './conversationItems';
import { formatRelativeDate } from './FilesShared';

// The attachment viewer's PDF library needs DOMMatrix, which jsdom lacks. The
// stand-in draws the document's pages and notes the width each was asked for.
const pdf = vi.hoisted(() => ({ pageWidths: [] as Array<number | undefined> }));
vi.mock('react-pdf', () => ({
    Document: ({ children }: { children?: unknown }) => children ?? null,
    Page: ({ width }: { width?: number }) => {
        pdf.pageWidths.push(width);
        return null;
    },
    pdfjs: { GlobalWorkerOptions: {}, version: 'test' },
}));

/**
 * A conversation's files and the user's artifacts: the header's files button,
 * the sidebar's Artifacts entry, the two panels, and the provider's save and
 * delete actions — against a storage API answering as ADR-020 specifies.
 */

const STORAGE = 'https://storage.test';
const BASE = `${STORAGE}/api/v1/attachments`;
const CONVERSATION = 'conv-1';
const JOB = 'job-1';

function wireFile(uuid: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        uuid,
        job_uuid: JOB,
        conversation_uuid: CONVERSATION,
        conversation_title: 'Inspection trends',
        filename: `${uuid}.png`,
        content_type: 'image/png',
        size_bytes: 2048,
        source: 'artifact',
        is_artifact: true,
        kind: 'chart',
        title: `Title ${uuid}`,
        has_spec: true,
        created_at: '2026-10-13T10:00:00Z',
        download_path: `/api/v1/attachments/jobs/${JOB}/files/${uuid}`,
        download_url: `${BASE}/jobs/${JOB}/files/${uuid}`,
        ...overrides,
    };
}

function respond(status: number, body?: unknown): Response {
    const text = body === undefined ? '' : JSON.stringify(body);
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        json: async () => JSON.parse(text),
        text: async () => text,
        blob: async () => new Blob(['bytes'], { type: 'image/png' }),
    } as unknown as Response;
}

/** A block the platform indexed, as the storage API answers it (`BlockRecord`). */
function wireBlock(uuid: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        uuid,
        job_uuid: JOB,
        turn_job_uuid: JOB,
        conversation_uuid: CONVERSATION,
        conversation_title: 'Inspection trends',
        language: 'chart',
        kind: 'chart',
        block_key: blockKeyOf('chart', `{"title":"${uuid}"}`),
        title: uuid,
        position: 0,
        created_at: '2026-10-13T11:00:00Z',
        saved: false,
        artifact_uuids: [],
        ...overrides,
    };
}

/** An Artifacts entry for a stored file, as `/artifact-entries` lists it. */
function fileEntry(file: Record<string, unknown>): Record<string, unknown> {
    return {
        id: `file:${file.uuid}`,
        type: 'file',
        saved: file.is_artifact === true,
        kind: file.kind ?? 'file',
        title: file.title ?? file.filename,
        created_at: file.created_at,
        job_uuid: file.job_uuid,
        conversation_uuid: file.conversation_uuid,
        conversation_title: file.conversation_title,
        file,
        block: null,
    };
}

/** An Artifacts entry for a block nobody saved. */
function blockEntry(block: Record<string, unknown>): Record<string, unknown> {
    return {
        id: `block:${block.uuid}`,
        type: 'block',
        saved: false,
        kind: block.kind,
        title: block.title,
        created_at: block.created_at,
        job_uuid: block.turn_job_uuid,
        conversation_uuid: block.conversation_uuid,
        conversation_title: block.conversation_title,
        file: null,
        block,
    };
}

/** What the storage API holds for the test, and every request it was sent. */
interface FakeStorage {
    conversationFiles: Record<string, unknown>[] | 'missing' | 'broken';
    /** The blocks the platform indexed for the conversation. */
    conversationBlocks?: Record<string, unknown>[];
    /** The saved artifacts, newest first. */
    artifacts: Record<string, unknown>[];
    /** What is listed as not saved, after the artifacts: blocks (`blockEntry`) and generated files (`fileEntry`). */
    unsavedEntries?: Record<string, unknown>[];
    /** The bodies `GET /blocks/{uuid}` answers with; a block missing here is a 404. */
    blockSources?: Record<string, string>;
    requests: Array<{ url: string; method: string; body?: BodyInit | null; authorization?: string }>;
    /** File downloads wait here, each released by calling it, while set. */
    heldDownloads: Array<() => void> | null;
    /** The artifacts list answers 500 while set. */
    artifactsBroken?: boolean;
    /**
     * Artifact lists wait here while set — answered as the storage API stood
     * when asked, sent when released — so a test can order a "Load more"
     * and a read again.
     */
    heldArtifactLists?: Array<{ url: string; release: () => void }> | null;
    /** Files (by uuid) whose download answers 500. */
    brokenFiles?: Set<string>;
    /** What a fetched file's object URL reads as text: a CSV's rows, say. */
    blobText?: string;
}

let storage: FakeStorage;
/** Numbers the files the fake storage API saves: `saved-1`, `saved-2`… */
let savedCount = 0;

function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const url = String(input);
    const method = init.method ?? 'GET';
    const authorization = (init.headers as Record<string, string> | undefined)?.Authorization;
    storage.requests.push({ url, method, body: init.body, authorization });
    const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;

    if (path.startsWith('/conversations/')) {
        if (storage.conversationFiles === 'missing') {
            return Promise.resolve(respond(404, { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found.' }));
        }
        if (storage.conversationFiles === 'broken') return Promise.resolve(respond(500, { message: 'boom' }));
        return Promise.resolve(respond(200, {
            code: 'CONVERSATION_FILES_LISTED',
            data: { conversation_uuid: CONVERSATION, files: storage.conversationFiles, blocks: storage.conversationBlocks ?? [] },
        }));
    }
    if (path.startsWith('/artifact-entries?')) {
        if (storage.artifactsBroken) return Promise.resolve(respond(500, { message: 'down' }));
        const params = new URL(url).searchParams;
        const limit = Number(params.get('limit'));
        const offset = Number(params.get('offset'));
        const status = params.get('status') ?? 'all';
        const kind = params.get('kind');
        const q = params.get('q');
        const matching = [...storage.artifacts.map(fileEntry), ...(storage.unsavedEntries ?? [])]
            .filter(item => status === 'all' || (status === 'saved') === (item.saved === true))
            .filter(item => !kind || item.kind === kind)
            .filter(item => !q || String(item.title).toLowerCase().includes(q.toLowerCase()));
        const answer = respond(200, {
            code: 'ARTIFACT_ENTRIES_LISTED',
            data: {
                artifact_entries: {
                    items: matching.slice(offset, offset + limit),
                    pagination: { total: matching.length, page: offset / limit + 1, per_page: limit, pages: 1 },
                },
            },
        });
        const held = storage.heldArtifactLists;
        if (held) return new Promise(resolve => held.push({ url, release: () => resolve(answer) }));
        return Promise.resolve(answer);
    }
    if (path.startsWith('/blocks/')) {
        const id = path.slice('/blocks/'.length);
        const source = storage.blockSources?.[id];
        const record = [...(storage.conversationBlocks ?? []), ...(storage.unsavedEntries ?? []).map(entry => entry.block)]
            .find(block => block && (block as Record<string, unknown>).uuid === id);
        if (source === undefined || !record) {
            return Promise.resolve(respond(404, { code: 'BLOCK_NOT_FOUND', message: 'Block not found.' }));
        }
        return Promise.resolve(respond(200, { code: 'BLOCK_LOADED', data: { block: { ...record, source } } }));
    }
    if (path.startsWith('/files/') && path.endsWith('/save') && method === 'POST') {
        const id = path.slice('/files/'.length, -'/save'.length);
        const all = Array.isArray(storage.conversationFiles) ? storage.conversationFiles : [];
        const generated = [...all, ...(storage.unsavedEntries ?? []).map(entry => entry.file)]
            .find(file => file && (file as Record<string, unknown>).uuid === id) as Record<string, unknown> | undefined;
        if (!generated) return Promise.resolve(respond(404, { code: 'ATTACHMENT_NOT_FOUND', message: 'Not found.' }));
        if (generated.source !== 'generated') {
            return Promise.resolve(respond(409, { code: 'NOT_GENERATED', message: 'Only a generated file can be saved.' }));
        }
        const copy = wireFile(`copy-${id}`, {
            source: 'artifact', is_artifact: true, saved: true, kind: 'file',
            title: generated.title, filename: generated.filename, content_type: generated.content_type,
            saved_from_uuid: id,
        });
        generated.saved = true;
        storage.artifacts.unshift(copy);
        storage.unsavedEntries = (storage.unsavedEntries ?? []).filter(entry => entry.id !== `file:${id}`);
        if (Array.isArray(storage.conversationFiles)) storage.conversationFiles.unshift(copy);
        return Promise.resolve(respond(201, { code: 'ARTIFACT_SAVED', data: { file: copy } }));
    }
    if (path.startsWith('/artifacts/') && method === 'DELETE') {
        const id = path.slice('/artifacts/'.length);
        storage.artifacts = storage.artifacts.filter(item => item.uuid !== id);
        return Promise.resolve(respond(204));
    }
    if (path === `/jobs/${JOB}/files` && method === 'POST') {
        const form = init.body as FormData;
        const isArtifact = form.get('is_artifact') === 'true';
        const blockKey = form.get('block_key');
        const saved = wireFile(`saved-${++savedCount}`, {
            title: form.get('title'),
            kind: form.get('kind'),
            is_artifact: isArtifact,
            source: isArtifact ? 'artifact' : 'generated',
            block_key: blockKey,
        });
        if (Array.isArray(storage.conversationFiles)) storage.conversationFiles.unshift(saved);
        if (isArtifact) storage.artifacts.unshift(saved);
        if (blockKey) {
            // The block is saved now: off the not-saved list, marked in the conversation's.
            storage.unsavedEntries = (storage.unsavedEntries ?? [])
                .filter(entry => (entry.block as Record<string, unknown> | null)?.block_key !== blockKey);
            (storage.conversationBlocks ?? [])
                .filter(block => block.block_key === blockKey)
                .forEach(block => {
                    block.saved = true;
                    block.artifact_uuids = [saved.uuid];
                });
        }
        return Promise.resolve(respond(201, { data: { file: saved } }));
    }
    if (path.startsWith(`/jobs/${JOB}/files/`)) {
        if (storage.brokenFiles?.has(path.slice(`/jobs/${JOB}/files/`.length))) {
            return Promise.resolve(respond(500, { message: 'gone' }));
        }
        const held = storage.heldDownloads;
        if (held) return new Promise(resolve => held.push(() => resolve(respond(200))));
        return Promise.resolve(respond(200));
    }
    // A text file's text, read back from the object URL its bytes were given.
    if (url.startsWith('blob:')) {
        const text = storage.blobText ?? '';
        return Promise.resolve({ ok: true, status: 200, text: async () => text } as unknown as Response);
    }
    return Promise.resolve(respond(404, {}));
}

/**
 * A client whose only job here is to say which conversation is open, and to
 * load it (empty) when the provider reopens it on mount — one that could not
 * would make the provider start a new chat, closing the files panel.
 */
const conversationClient = (conversationId: string | null, jobs: unknown[] = []) => ({
    sendMessage: async () => undefined,
    getConversationId: () => conversationId,
    setConversationId: () => undefined,
    getConversations: async () => ({ items: [], pagination: { total: 0, page: 1, per_page: 20, pages: 0 } }),
    getConversationDetail: async (id: string) => ({
        uuid: id, title: 'Inspection trends', created_at: '', updated_at: '', jobs,
    }),
}) as StreamChatClient;

let root: Root | null = null;
let container: HTMLElement | null = null;
let actions: ChatActions | null = null;
let events: FilesChangedPayload[] = [];
let selectedConversations: string[] = [];

const Probe: React.FC = () => {
    actions = useChatActions();
    useChatEvent('chat.files.changed', payload => {
        events.push(payload);
    });
    useChatEvent('conversation.selected', payload => {
        selectedConversations.push(payload.conversationId);
    });
    return null;
};

/** The open conversation, and the transcript's length and whether a turn is under way. */
const ChatProbe: React.FC = () => {
    const active = useChatState(s => s.activeConversationId);
    const count = useChatState(s => s.messages.length);
    const thinking = useChatState(s => s.isThinking);
    return <span className="chat-state">{`${active ?? '-'}/${count}/${thinking ? 'thinking' : 'idle'}`}</span>;
};

const PanelsState: React.FC = () => {
    const files = useChatState(s => s.isFilesPanelOpen);
    const artifacts = useChatState(s => s.isArtifactsPanelOpen);
    return <span className="panels-state">{`${files ? 'files' : '-'}/${artifacts ? 'artifacts' : '-'}`}</span>;
};

interface RenderOptions {
    conversationId?: string | null;
    storageApiUrl?: string;
    accessToken?: string | null;
    config?: ChatbotConfig;
    /** The conversation's turns, as the Gateway answers them: the transcript the provider loads. */
    jobs?: unknown[];
}

// One client per test, so a render again with a new token is the same chat.
let chatClient: StreamChatClient | null = null;
const DEFAULT_CONFIG: ChatbotConfig = { composer: { tools: false } };

function tree(options: RenderOptions): React.ReactElement {
    const {
        storageApiUrl = STORAGE,
        accessToken = 'user-token',
        config = DEFAULT_CONFIG,
    } = options;
    return (
        <ChatbotProvider
            client={chatClient!}
            storageApiUrl={storageApiUrl}
            accessToken={accessToken}
            config={config}
        >
            <Probe />
            <PanelsState />
            {/* The chat a panel belongs to: Escape anywhere in it closes the panel. */}
            <div className="cb-root">
                <ChatHeader />
                <ConversationSidebar embedded />
                <div style={{ position: 'relative' }}>
                    <ConversationFilesPanel />
                    <ArtifactsPanel />
                </div>
            </div>
        </ChatbotProvider>
    );
}

function render(options: RenderOptions = {}): HTMLElement {
    chatClient = conversationClient(options.conversationId === undefined ? CONVERSATION : options.conversationId, options.jobs);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root!.render(tree(options));
    });
    return container;
}

/** The same chat, rendered again with other props — a refreshed token, say. */
function rerender(options: RenderOptions): void {
    act(() => {
        root!.render(tree(options));
    });
}

/** Let the fetches resolve and React commit what they set. */
async function settle(ms = 0): Promise<void> {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, ms));
    });
}

const button = (page: HTMLElement, label: string) =>
    page.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

/** A key pressed where `target` is, as the browser sends it; the event, to see whether it was taken. */
function press(target: EventTarget, key: string, options: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
    act(() => {
        target.dispatchEvent(event);
    });
    return event;
}

beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    sessionStorage.clear();
    storage = {
        conversationFiles: [
            wireFile('art-1'),
            wireFile('gen-1', { source: 'generated', is_artifact: false, kind: null, title: null, filename: 'rows.xlsx', content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
            wireFile('up-1', { source: 'upload', is_artifact: false, kind: null, title: null, filename: 'photo.jpg', content_type: 'image/jpeg' }),
        ],
        artifacts: Array.from({ length: 25 }, (_, index) => wireFile(`a-${index}`, {
            kind: index % 5 === 0 ? 'table' : 'chart',
            title: index === 3 ? 'Pump failures' : `Artifact ${index}`,
        })),
        requests: [],
        heldDownloads: null,
        heldArtifactLists: null,
    };
    events = [];
    savedCount = 0;
    selectedConversations = [];
    pdf.pageWidths = [];
    actions = null;
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    (URL as any).createObjectURL = vi.fn(() => 'blob:test');
    (URL as any).revokeObjectURL = vi.fn();
});

afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("the header's files button", () => {
    it('shows when a conversation is open and the storage API can be reached', () => {
        expect(button(render(), 'Conversation files')).not.toBeNull();
    });

    it('hides without a conversation, a token, a storage URL, or when the host turns it off', () => {
        expect(button(render({ conversationId: null }), 'Conversation files')).toBeNull();
        act(() => root?.unmount());
        expect(button(render({ accessToken: null }), 'Conversation files')).toBeNull();
        act(() => root?.unmount());
        expect(button(render({ storageApiUrl: '' }), 'Conversation files')).toBeNull();
        act(() => root?.unmount());
        expect(button(render({ config: { header: { files: false } } }), 'Conversation files')).toBeNull();
    });
});

describe('the conversation files panel', () => {
    it("lists every file of the conversation, marking artifacts and the app's own", async () => {
        const page = render();
        await settle();
        act(() => button(page, 'Conversation files')!.click());
        await settle();

        expect(storage.requests.some(request => request.url === `${BASE}/conversations/${CONVERSATION}`)).toBe(true);
        const panel = page.querySelector('[role="dialog"]')!;
        expect(panel.querySelector('h2')?.textContent).toBe('Conversation files');
        const rows = Array.from(panel.querySelectorAll('.cb-file-item'));
        expect(rows.map(row => row.querySelector('.cb-file-title')?.textContent)).toEqual(['Title art-1', 'rows.xlsx', 'photo.jpg']);
        // Every artifact-like row is marked Saved or Not saved; the user's upload is neither.
        expect(rows[0].querySelector('.cb-file-status')?.textContent).toBe('Saved');
        expect(rows[1].querySelector('.cb-file-status')?.textContent).toBe('Not saved');
        expect(rows[1].querySelector('.cb-file-meta-text')?.textContent).toContain('Generated');
        expect(rows[2].querySelector('.cb-file-status')).toBeNull();
        expect(rows[0].querySelector('.cb-file-meta')?.textContent).toContain('2.0 KB');
    });

    it('downloads with the token', async () => {
        const page = render();
        await settle();
        act(() => button(page, 'Conversation files')!.click());
        await settle();

        act(() => button(page, 'Download: rows.xlsx')!.click());
        await settle();

        const download = storage.requests.find(request => request.url === `${BASE}/jobs/${JOB}/files/gen-1`);
        expect(download).toBeDefined();
        const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
            .find(([url]) => String(url) === `${BASE}/jobs/${JOB}/files/gen-1`)![1] as RequestInit;
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer user-token');
        expect(URL.createObjectURL).toHaveBeenCalled();
        expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    });

    it('opens a file in the viewer', async () => {
        const page = render();
        await settle();
        act(() => button(page, 'Conversation files')!.click());
        await settle();

        act(() => page.querySelector<HTMLButtonElement>('.cb-file-main')!.click());
        await settle();

        const viewer = document.body.querySelector('.cb-attachment-viewer-inner[role="dialog"]');
        expect(viewer?.getAttribute('aria-label')).toBe('art-1.png');
        // Escape closes the viewer first, and leaves the panel open.
        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(document.body.querySelector('.cb-attachment-viewer-inner')).toBeNull();
        expect(page.querySelector('.cb-files-panel')).not.toBeNull();
    });

    it("shows a conversation the storage API does not know yet as empty, and a failure with a retry", async () => {
        storage.conversationFiles = 'missing';
        const page = render();
        await settle();
        act(() => button(page, 'Conversation files')!.click());
        await settle();
        // The empty state (2026-10-14): the folder, a heading, and what will appear —
        // and nothing else: no filter, no list, no counts under the title.
        const empty = page.querySelector('.cb-files-panel .cb-files-empty')!;
        expect(empty.querySelector('.cb-files-empty-icon svg')).not.toBeNull();
        expect(empty.querySelector('.cb-files-empty-icon')?.getAttribute('aria-hidden')).toBe('true');
        expect(empty.querySelector('h3')?.textContent).toBe('No files yet');
        expect(empty.querySelector('.cb-files-empty-hint')?.textContent)
            .toBe('Charts, tables and files the assistant creates here — and files you attach — will appear in this list.');
        expect(page.querySelector('.cb-files-panel [role="group"]')).toBeNull();
        expect(page.querySelector('.cb-files-panel .cb-files-list')).toBeNull();
        expect(page.querySelector('.cb-files-panel .cb-files-state')).toBeNull();
        expect(page.querySelector('.cb-files-panel .cb-files-subtitle')).toBeNull();

        act(() => button(page, 'Close')!.click());
        storage.conversationFiles = 'broken';
        act(() => button(page, 'Conversation files')!.click());
        await settle();
        expect(page.querySelector('.cb-files-state')?.textContent).toContain("Couldn't load the files.");

        storage.conversationFiles = [wireFile('art-1')];
        act(() => page.querySelector<HTMLButtonElement>('.cb-files-text-btn')!.click());
        await settle();
        expect(page.querySelectorAll('.cb-file-item')).toHaveLength(1);
    });

    it('reads again when a file is saved, and closes on Escape', async () => {
        const page = render();
        await settle();
        act(() => button(page, 'Conversation files')!.click());
        await settle();
        expect(page.querySelectorAll('.cb-file-item')).toHaveLength(3);

        await act(async () => {
            await actions!.saveFile(JOB, new Blob(['a,b'], { type: 'text/csv' }), { title: 'Rows' });
        });
        await settle();

        expect(page.querySelectorAll('.cb-file-item')).toHaveLength(4);
        press(document.activeElement!, 'Escape');
        expect(page.querySelector('.cb-files-panel')).toBeNull();
    });
});

describe('saving and deleting through the chat', () => {
    it('saves an artifact against the turn, and says so', async () => {
        render();

        let saved: unknown = null;
        await act(async () => {
            saved = await actions!.saveArtifact(JOB, new Blob(['png'], { type: 'image/png' }), {
                title: 'Average score per month',
                kind: 'chart',
                spec: '{"type":"line"}',
            });
        });

        const post = storage.requests.find(request => request.method === 'POST')!;
        expect(post.url).toBe(`${BASE}/jobs/${JOB}/files`);
        const form = post.body as FormData;
        expect(form.get('is_artifact')).toBe('true');
        expect(form.get('kind')).toBe('chart');
        expect(form.get('spec')).toBe('{"type":"line"}');
        expect((form.get('file') as File).name).toBe('Average score per month.png');
        expect(saved).toMatchObject({ attachment_uuid: 'saved-1', is_artifact: true });
        expect(events).toEqual([expect.objectContaining({
            change: 'saved',
            attachmentUuid: 'saved-1',
            conversationId: CONVERSATION,
            jobUuid: JOB,
        })]);
    });

    it('deletes an artifact, and says so', async () => {
        render();
        await act(async () => {
            await actions!.deleteArtifact('a-1');
        });
        expect(storage.requests.find(request => request.method === 'DELETE')?.url).toBe(`${BASE}/artifacts/a-1`);
        expect(events).toEqual([{
            change: 'deleted', attachmentUuid: 'a-1', file: null, conversationId: null, jobUuid: null, blockKey: null, savedFromUuid: null,
        }]);
    });

    it('refuses without the storage API, and fires nothing', async () => {
        render({ accessToken: null });
        await expect(actions!.saveArtifact(JOB, new Blob(['x']))).rejects.toThrow(/storageApiUrl and accessToken/);
        await expect(actions!.deleteArtifact('a-1')).rejects.toThrow(/storageApiUrl and accessToken/);
        expect(storage.requests.filter(request => request.url.startsWith(BASE))).toEqual([]);
        expect(events).toEqual([]);
    });

    it('waits for a turn the storage API has not stored yet, and says so once', async () => {
        // Review of 2026-10-14: Save is clickable once the stream names the
        // turn; the platform writes the turn's row a moment after.
        (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () =>
            respond(404, { code: 'JOB_NOT_FOUND', message: 'Job not found or not owned by user.' })
        );
        render();

        let saved: unknown = null;
        await act(async () => {
            saved = await actions!.saveArtifact(JOB, new Blob(['png'], { type: 'image/png' }), { title: 'Scores', kind: 'chart' });
        });

        const posts = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
            .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
        expect(posts.map(([url]) => String(url))).toEqual([`${BASE}/jobs/${JOB}/files`, `${BASE}/jobs/${JOB}/files`]);
        expect(saved).toMatchObject({ attachment_uuid: 'saved-1' });
        expect(events.map(event => event.change)).toEqual(['saved']);
    });

    it("reports the server's refusal, and fires nothing", async () => {
        (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () =>
            respond(422, { code: 'ATTACHMENT_VALIDATION_FAILED', message: 'Unsupported content type: image/svg+xml' })
        );
        render({ conversationId: null });
        await expect(actions!.saveArtifact(JOB, new Blob(['<svg/>'], { type: 'image/svg+xml' })))
            .rejects.toMatchObject({ status: 422 });
        expect(events).toEqual([]);
    });
});

describe('the Artifacts entry and panel', () => {
    async function openArtifacts(): Promise<HTMLElement> {
        const page = render();
        await settle();
        const entry = Array.from(page.querySelectorAll<HTMLButtonElement>('.cb-sidebar-nav-item'))
            .find(item => item.textContent === 'Artifacts');
        expect(entry).toBeDefined();
        act(() => entry!.click());
        await settle();
        return page;
    }

    const titles = (page: HTMLElement) =>
        Array.from(page.querySelectorAll('.cb-artifacts-panel .cb-file-title')).map(node => node.textContent);

    it('is under "New chat", and hidden without the storage API or when turned off', () => {
        const page = render();
        const labels = Array.from(page.querySelectorAll('.cb-sidebar-nav-item')).map(item => item.textContent);
        expect(labels.slice(0, 2)).toEqual(['New chat', 'Artifacts']);
        act(() => root?.unmount());

        const anonymous = render({ accessToken: null });
        expect(Array.from(anonymous.querySelectorAll('.cb-sidebar-nav-item')).map(item => item.textContent)).toEqual(['New chat']);
        act(() => root?.unmount());

        const off = render({ config: { sidebar: { artifacts: false } } });
        expect(Array.from(off.querySelectorAll('.cb-sidebar-nav-item')).map(item => item.textContent)).toEqual(['New chat']);
    });

    it("lists the user's artifacts a page at a time, with each one's conversation", async () => {
        const page = await openArtifacts();

        expect(page.querySelector('.panels-state')?.textContent).toBe('-/artifacts');
        expect(document.activeElement?.getAttribute('aria-label')).toBe('Search artifacts');
        expect(titles(page)).toHaveLength(20);
        expect(page.querySelector('.cb-artifacts-panel .cb-file-meta')?.textContent).toContain('Inspection trends');

        act(() => page.querySelector<HTMLButtonElement>('.cb-files-load-more')!.click());
        await settle();

        expect(titles(page)).toHaveLength(25);
        expect(page.querySelector('.cb-files-load-more')).toBeNull();
        const second = new URL(storage.requests.filter(request => request.url.includes('/artifact-entries?')).pop()!.url);
        expect(second.searchParams.get('offset')).toBe('20');
    });

    it('searches and filters on the server', async () => {
        const page = await openArtifacts();

        const input = page.querySelector<HTMLInputElement>('.cb-files-search-input')!;
        act(() => {
            const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            setValue.call(input, 'pump');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await settle(350);
        expect(titles(page)).toEqual(['Pump failures']);
        expect(new URL(storage.requests.filter(request => request.url.includes('/artifact-entries?')).pop()!.url).searchParams.get('q')).toBe('pump');

        act(() => {
            const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            setValue.call(input, 'nothing like it');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await settle(350);
        expect(page.querySelector('.cb-files-state')?.textContent).toBe('No artifacts match your search.');

        act(() => {
            const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            setValue.call(input, '');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await settle(350);
        const tables = Array.from(page.querySelectorAll<HTMLButtonElement>('.cb-files-chip')).find(chip => chip.textContent === 'Tables')!;
        act(() => tables.click());
        await settle();
        expect(tables.getAttribute('aria-pressed')).toBe('true');
        expect(titles(page)).toEqual(['Artifact 0', 'Artifact 5', 'Artifact 10', 'Artifact 15', 'Artifact 20']);
        expect(new URL(storage.requests.filter(request => request.url.includes('/artifact-entries?')).pop()!.url).searchParams.get('kind')).toBe('table');
    });

    it('deletes on the second click only', async () => {
        const page = await openArtifacts();

        act(() => button(page, 'Delete: Artifact 0')!.click());
        expect(storage.requests.some(request => request.method === 'DELETE')).toBe(false);
        const confirm = button(page, 'Click again to delete')!;
        expect(confirm.textContent).toBe('Click again to delete');

        act(() => confirm.click());
        await settle();

        expect(storage.requests.find(request => request.method === 'DELETE')?.url).toBe(`${BASE}/artifacts/a-0`);
        expect(titles(page)).not.toContain('Artifact 0');
        expect(events.map(event => event.change)).toEqual(['deleted']);
    });

    it('shows where a delete failed, and keeps the row', async () => {
        const page = await openArtifacts();
        (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => respond(500, { message: 'down' }));

        act(() => button(page, 'Delete: Artifact 0')!.click());
        act(() => button(page, 'Click again to delete')!.click());
        await settle();

        expect(titles(page)).toContain('Artifact 0');
        expect(page.querySelector('.cb-file-error')?.textContent).toBe("Couldn't delete the artifact.");
    });

    it('adds an artifact saved meanwhile at the top', async () => {
        const page = await openArtifacts();
        await act(async () => {
            await actions!.saveArtifact(JOB, new Blob(['png'], { type: 'image/png' }), { title: 'Fresh chart', kind: 'chart' });
        });
        await settle();
        expect(titles(page)[0]).toBe('Fresh chart');
    });

    // Review of 2026-10-14: a read again fetched the first page alone and
    // replaced the list, so the pages loaded with "Load more" vanished.
    it('keeps the pages loaded with "Load more" when a save reads the list again', async () => {
        storage.artifacts.push(...Array.from({ length: 10 }, (_, index) => wireFile(`b-${index}`, { title: `Older ${index}` })));
        const page = await openArtifacts();
        act(() => page.querySelector<HTMLButtonElement>('.cb-files-load-more')!.click());
        await settle();
        expect(titles(page)).toHaveLength(35);

        await act(async () => {
            await actions!.saveArtifact(JOB, new Blob(['png'], { type: 'image/png' }), { title: 'Fresh chart', kind: 'chart' });
        });
        await settle();

        expect(titles(page)).toHaveLength(36);
        expect(titles(page)[0]).toBe('Fresh chart');
        expect(titles(page)[35]).toBe('Older 9');
        const reread = new URL(storage.requests.filter(request => request.url.includes('/artifact-entries?')).pop()!.url);
        expect(Object.fromEntries(reread.searchParams)).toEqual({ status: 'all', limit: '40', offset: '0' });
    });

    it('keeps the list on screen when a refreshed token reads it again, and reads with the new token', async () => {
        const page = await openArtifacts();
        act(() => page.querySelector<HTMLButtonElement>('.cb-files-load-more')!.click());
        await settle();
        expect(titles(page)).toHaveLength(25);

        rerender({ accessToken: 'refreshed-token' });
        // While the read is under way, the list stays.
        expect(titles(page)).toHaveLength(25);
        await settle();

        expect(titles(page)).toHaveLength(25);
        const reread = storage.requests.filter(request => request.url.includes('/artifact-entries?')).pop()!;
        expect(reread.authorization).toBe('Bearer refreshed-token');
        expect(new URL(reread.url).searchParams.get('limit')).toBe('40');
    });

    it('keeps the list on screen when a read again in the background fails', async () => {
        const page = await openArtifacts();
        storage.artifactsBroken = true;
        await act(async () => {
            await actions!.saveArtifact(JOB, new Blob(['png'], { type: 'image/png' }), { title: 'Fresh chart', kind: 'chart' });
        });
        await settle();
        expect(titles(page)).toHaveLength(20);
        expect(page.querySelector('.cb-files-state')).toBeNull();
    });

    describe('a "Load more" under way when the list is read again', () => {
        // Review of 2026-10-14: a "Load more" overtaken by a read again was
        // dropped — lost outright when that read failed, or when it had been
        // clicked after the read started and the read replaced the list
        // with the span it set out to read.
        const artifactLists = () => storage.requests.filter(request => request.url.includes('/artifact-entries?'));
        const paramsOf = (url: string) => Object.fromEntries(new URL(url).searchParams);
        const isPage = (url: string, offset: number, limit: number) =>
            paramsOf(url).offset === String(offset) && paramsOf(url).limit === String(limit);

        /** Send the held answer for that page — as the storage API stood when it was asked. */
        async function release(offset: number, limit: number): Promise<void> {
            const held = storage.heldArtifactLists!;
            const index = held.findIndex(entry => isPage(entry.url, offset, limit));
            expect(index, `a held read of ${limit} from ${offset}`).toBeGreaterThanOrEqual(0);
            held.splice(index, 1)[0].release();
            await settle();
        }

        const saveFreshChart = () => act(async () => {
            await actions!.saveArtifact(JOB, new Blob(['png'], { type: 'image/png' }), { title: 'Fresh chart', kind: 'chart' });
        });

        const expectNoDuplicates = (page: HTMLElement) => expect(new Set(titles(page)).size).toBe(titles(page).length);

        beforeEach(() => {
            storage.artifacts.push(...Array.from({ length: 20 }, (_, index) => wireFile(`b-${index}`, { title: `Older ${index}` })));
        });

        it('lands once when it arrives before the read again', async () => {
            const page = await openArtifacts();
            storage.heldArtifactLists = [];
            act(() => page.querySelector<HTMLButtonElement>('.cb-files-load-more')!.click());
            await saveFreshChart();
            // The read again reads the page "Load more" asked for too.
            expect(storage.heldArtifactLists.some(entry => isPage(entry.url, 0, 40))).toBe(true);

            await release(20, 20);
            expect(titles(page)).toHaveLength(40);
            await release(0, 40);

            expect(titles(page)).toHaveLength(40);
            expect(titles(page)[0]).toBe('Fresh chart');
            expect(titles(page)[39]).toBe('Older 13');
            expectNoDuplicates(page);
        });

        it('is not added twice when it arrives after the read again', async () => {
            const page = await openArtifacts();
            storage.heldArtifactLists = [];
            act(() => page.querySelector<HTMLButtonElement>('.cb-files-load-more')!.click());
            await saveFreshChart();

            await release(0, 40);
            expect(titles(page)).toHaveLength(40);
            await release(20, 20);

            expect(titles(page)).toHaveLength(40);
            expect(titles(page)[0]).toBe('Fresh chart');
            expectNoDuplicates(page);
            expect(page.querySelector<HTMLButtonElement>('.cb-files-load-more')?.disabled).toBe(false);
        });

        it('is kept when the read again fails', async () => {
            const page = await openArtifacts();
            storage.heldArtifactLists = [];
            act(() => page.querySelector<HTMLButtonElement>('.cb-files-load-more')!.click());
            storage.artifactsBroken = true;
            await saveFreshChart();
            await settle();
            expect(titles(page)).toHaveLength(20);

            storage.artifactsBroken = false;
            await release(20, 20);

            expect(titles(page)).toHaveLength(40);
            expect(titles(page)[39]).toBe('Older 14');
            expect(page.querySelector('.cb-files-state')).toBeNull();
        });

        it('clicked while a read again is under way, is read by it as well', async () => {
            const page = await openArtifacts();
            storage.heldArtifactLists = [];
            await saveFreshChart();
            // The list stays on screen, and can still be extended.
            act(() => page.querySelector<HTMLButtonElement>('.cb-files-load-more')!.click());

            await release(20, 20);
            await release(0, 20);
            // Its first page in, the read again goes on to the span now wanted.
            await release(20, 20);

            expect(titles(page)).toHaveLength(40);
            expect(titles(page)[0]).toBe('Fresh chart');
            expect(titles(page)[39]).toBe('Older 13');
            expectNoDuplicates(page);
        });

        it('reads a span of more than 100 in pages of at most 100', async () => {
            storage.artifacts.push(...Array.from({ length: 110 }, (_, index) => wireFile(`c-${index}`, { title: `Oldest ${index}` })));
            const page = await openArtifacts();
            for (let click = 0; click < 6; click += 1) {
                act(() => page.querySelector<HTMLButtonElement>('.cb-files-load-more')!.click());
                await settle();
            }
            expect(titles(page)).toHaveLength(140);

            const before = artifactLists().length;
            await saveFreshChart();
            await settle();

            expect(artifactLists().slice(before).map(request => paramsOf(request.url))).toEqual([
                { status: 'all', limit: '100', offset: '0' },
                { status: 'all', limit: '40', offset: '100' },
            ]);
            expect(titles(page)).toHaveLength(140);
            expect(titles(page)[0]).toBe('Fresh chart');
            expectNoDuplicates(page);
        });
    });

    it('takes at most the 200 characters of search the storage API does', async () => {
        const page = await openArtifacts();
        expect(page.querySelector<HTMLInputElement>('.cb-files-search-input')!.maxLength).toBe(200);
    });

    it('closes to open the conversation an artifact came from', async () => {
        const page = await openArtifacts();
        act(() => button(page, 'Open conversation: Inspection trends')!.click());
        expect(page.querySelector('.cb-artifacts-panel')).toBeNull();
        expect(page.querySelector('.panels-state')?.textContent).toBe('-/-');
    });

    it('is one panel at a time with the files panel', async () => {
        const page = await openArtifacts();
        act(() => actions!.openFiles());
        expect(page.querySelector('.panels-state')?.textContent).toBe('files/-');
        act(() => actions!.openArtifacts());
        expect(page.querySelector('.panels-state')?.textContent).toBe('-/artifacts');
        act(() => actions!.closeArtifacts());
        expect(page.querySelector('.panels-state')?.textContent).toBe('-/-');
    });
});

/** The sidebar's entries, by their text. */
const navEntry = (page: ParentNode, text: string) =>
    Array.from(page.querySelectorAll<HTMLButtonElement>('.cb-sidebar-nav-item')).find(item => item.textContent === text)!;

/** Type into an input as a user would: React sees the change. */
function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    act(() => {
        const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

const SidebarState: React.FC = () => {
    const open = useChatState(s => s.isSidebarOpen);
    return <span className="sidebar-state">{open ? 'sidebar' : '-'}</span>;
};

/** The conversations (by id) the client was asked to load, in order. */
let loadedConversations: string[] = [];

/**
 * The ready-made frame — header, sidebar, transcript and composer — in
 * `mode`, with two conversations in the sidebar: the open one ("Inspection
 * trends") and another to pick ("Pump report"). `client` replaces parts of
 * the chat client (a turn that never ends, the credit allowance).
 */
function renderInContainer(
    mode: ChatMode = 'fullscreen',
    client: Record<string, unknown> = {},
    config: ChatbotConfig = DEFAULT_CONFIG,
    jobs: unknown[] = [],
): HTMLElement {
    const now = new Date().toISOString();
    const open = { uuid: CONVERSATION, title: 'Inspection trends', created_at: now, updated_at: now };
    const other = { uuid: 'conv-2', title: 'Pump report', created_at: now, updated_at: now };
    const base = conversationClient(CONVERSATION);
    loadedConversations = [];
    chatClient = {
        ...base,
        getConversations: async (_offset: number, _limit: number, options?: { starred?: boolean }) => ({
            items: options?.starred ? [] : [open, other],
            pagination: { total: options?.starred ? 0 : 2, page: 1, per_page: 20, pages: 1 },
        }),
        getConversationDetail: async (id: string) => {
            loadedConversations.push(id);
            return {
                uuid: id, title: id === 'conv-2' ? 'Pump report' : 'Inspection trends', created_at: '', updated_at: '',
                jobs: id === CONVERSATION ? jobs : [],
            };
        },
        ...client,
    } as unknown as StreamChatClient;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root!.render(
            <ChatbotProvider client={chatClient!} storageApiUrl={STORAGE} accessToken="user-token" config={config}>
                <Probe />
                <PanelsState />
                <SidebarState />
                <ChatProbe />
                <ChatContainer mode={mode} embedded footer={<Composer />} />
            </ChatbotProvider>
        );
    });
    return container;
}

/** The sidebar's row for a conversation, by its title. */
const conversationRow = (page: HTMLElement, title: string) =>
    Array.from(page.querySelectorAll<HTMLElement>('.cb-conversation-item'))
        .find(item => item.textContent?.includes(title))!;

const isActiveRow = (row: HTMLElement) => row.classList.contains('active') || row.hasAttribute('aria-current');

describe('the Artifacts view, in place of the chat', () => {
    // The user's request of 2026-10-14: "artifacts tab should open the full
    // content not a modal on top of the chat".
    it('stands where the transcript and the composer were, under the header, with nothing over the chat', async () => {
        const page = renderInContainer('fullscreen');
        await settle();
        const stage = page.querySelector<HTMLElement>('.cb-chat-content > .cb-chat-stage')!;
        const chat = stage.querySelector<HTMLElement>(':scope > .cb-chat-view')!;
        const composer = chat.querySelector<HTMLTextAreaElement>('textarea')!;
        expect(chat.querySelector('.cb-main-chat')).not.toBeNull();
        expect(chat.getAttribute('aria-hidden')).toBeNull();
        typeInto(composer, 'A draft about pumps');
        // The open conversation is the sidebar's current entry until the view opens.
        expect(isActiveRow(conversationRow(page, 'Inspection trends'))).toBe(true);
        expect(button(page, 'Conversation files')).not.toBeNull();

        act(() => navEntry(page, 'Artifacts').click());
        await settle();

        const view = stage.querySelector<HTMLElement>(':scope > [role="region"][aria-label="Artifacts"]');
        expect(view).not.toBeNull();
        expect(stage.classList.contains('is-showing-artifacts')).toBe(true);
        // The chat is out of sight and out of reach of assistive technology —
        // still mounted, so the draft is there to come back to.
        expect(chat.getAttribute('aria-hidden')).toBe('true');
        expect(view!.contains(composer)).toBe(false);
        // No scrim, no dialog: the view is not over the chat.
        expect(document.querySelector('[role="dialog"], [aria-modal], .cb-files-overlay')).toBeNull();
        // The header stays above it, and the sidebar beside it shows where the user is.
        expect(page.querySelector('.cb-chat-content > .cb-chat-header')).not.toBeNull();
        expect(navEntry(page, 'Artifacts').getAttribute('aria-current')).toBe('page');
        expect(isActiveRow(conversationRow(page, 'Inspection trends'))).toBe(false);
        expect(page.querySelector('.cb-conversation-item.active, .cb-conversation-item[aria-current]')).toBeNull();
        // The header's files button describes the conversation, which is not on screen.
        expect(button(page, 'Conversation files')).toBeNull();
        expect(document.activeElement?.getAttribute('aria-label')).toBe('Search artifacts');
        expect(view!.querySelectorAll('.cb-file-item')).toHaveLength(20);

        act(() => button(view!, 'Close')!.click());
        await settle();
        expect(stage.querySelector('[role="region"]')).toBeNull();
        expect(stage.classList.contains('is-showing-artifacts')).toBe(false);
        expect(chat.getAttribute('aria-hidden')).toBeNull();
        expect(composer.value).toBe('A draft about pumps');
        expect(navEntry(page, 'Artifacts').getAttribute('aria-current')).toBeNull();
        expect(isActiveRow(conversationRow(page, 'Inspection trends'))).toBe(true);
        expect(button(page, 'Conversation files')).not.toBeNull();
    });

    it('closes the drawer it was chosen in, and fills the floating card below its header', async () => {
        const page = renderInContainer('floating');
        await settle();
        act(() => actions!.openSidebar());
        expect(page.querySelector('.sidebar-state')?.textContent).toBe('sidebar');

        act(() => navEntry(page, 'Artifacts').click());
        await settle();

        expect(page.querySelector('.sidebar-state')?.textContent).toBe('-');
        expect(page.querySelector('.cb-mode-floating .cb-chat-stage > .cb-artifacts-view')).not.toBeNull();
        expect(page.querySelector('.cb-chat-view')?.getAttribute('aria-hidden')).toBe('true');

        // The drawer opened again over the view closes on its own Escape; the
        // view stays — wherever focus is: in the drawer, on the header's
        // toggle that opened it, or nowhere.
        act(() => actions!.openSidebar());
        const entry = navEntry(page, 'Artifacts');
        act(() => entry.focus());
        press(entry, 'Escape');
        expect(page.querySelector('.sidebar-state')?.textContent).toBe('-');
        expect(page.querySelector('.cb-artifacts-view')).not.toBeNull();

        const toggle = button(page, 'Open sidebar')!;
        act(() => toggle.focus());
        act(() => toggle.click());
        expect(page.querySelector('.sidebar-state')?.textContent).toBe('sidebar');
        press(document.activeElement!, 'Escape');
        expect(page.querySelector('.sidebar-state')?.textContent).toBe('-');
        expect(page.querySelector('.cb-artifacts-view')).not.toBeNull();

        act(() => actions!.openSidebar());
        const drawer = page.querySelector<HTMLElement>('.cb-drawer-wrapper.open .cb-drawer-content')!;
        act(() => {
            drawer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            (document.activeElement as HTMLElement | null)?.blur();
        });
        press(document.body, 'Escape');
        expect(page.querySelector('.sidebar-state')?.textContent).toBe('-');
        expect(page.querySelector('.cb-artifacts-view')).not.toBeNull();
    });

    it('goes back to its list when "Artifacts" is chosen again, with focus out of the drawer', async () => {
        const page = renderInContainer('floating');
        await settle();
        act(() => actions!.openSidebar());
        act(() => navEntry(page, 'Artifacts').click());
        await settle();
        const main = page.querySelector<HTMLButtonElement>('.cb-artifacts-view .cb-file-main')!;
        act(() => main.focus());
        act(() => main.click());
        await settle();
        expect(page.querySelector('.cb-artifact-detail')).not.toBeNull();

        act(() => actions!.openSidebar());
        const entry = navEntry(page, 'Artifacts');
        act(() => entry.focus());
        act(() => entry.click());
        await settle();

        expect(page.querySelector('.sidebar-state')?.textContent).toBe('-');
        expect(page.querySelector('.cb-artifact-detail')).toBeNull();
        expect(page.querySelector<HTMLElement>('.cb-artifacts-list-pane')!.hidden).toBe(false);
        expect(document.activeElement?.getAttribute('aria-label')).toBe('Search artifacts');

        // On the list already: focus comes into it all the same.
        act(() => actions!.openSidebar());
        act(() => navEntry(page, 'Artifacts').focus());
        act(() => navEntry(page, 'Artifacts').click());
        await settle();
        expect(document.activeElement?.getAttribute('aria-label')).toBe('Search artifacts');
    });

    it('gives the column back to a conversation picked in the sidebar, and to "New chat"', async () => {
        const page = renderInContainer('fullscreen');
        await settle();
        act(() => navEntry(page, 'Artifacts').click());
        await settle();

        const row = Array.from(page.querySelectorAll<HTMLElement>('.cb-conversation-item'))
            .find(item => item.textContent?.includes('Pump report'))!;
        act(() => row.click());
        await settle();
        expect(page.querySelector('.panels-state')?.textContent).toBe('-/-');
        expect(page.querySelector('.cb-artifacts-view')).toBeNull();
        expect(page.querySelector('.cb-chat-view')?.getAttribute('aria-hidden')).toBeNull();

        act(() => navEntry(page, 'Artifacts').click());
        await settle();
        expect(page.querySelector('.cb-artifacts-view')).not.toBeNull();
        act(() => navEntry(page, 'New chat').click());
        await settle();
        expect(page.querySelector('.panels-state')?.textContent).toBe('-/-');
        expect(page.querySelector('.cb-artifacts-view')).toBeNull();
    });

    it('goes back to the conversation behind it as it was, not loaded again, when that one is picked', async () => {
        // The transcript follows its content's size; jsdom has no ResizeObserver.
        vi.stubGlobal('ResizeObserver', class {
            observe() { /* nothing resizes here */ }
            unobserve() { /* nor here */ }
            disconnect() { /* nor here */ }
        });
        // A turn that is still being answered when the user looks at Artifacts.
        const page = renderInContainer('fullscreen', { sendMessage: () => new Promise(() => undefined) });
        await settle();
        await act(async () => {
            void actions!.sendMessage('How are the pumps?');
        });
        await settle();
        expect(page.querySelector('.chat-state')?.textContent).toBe(`${CONVERSATION}/2/thinking`);
        const loadsBefore = loadedConversations.length;

        act(() => navEntry(page, 'Artifacts').click());
        await settle();
        act(() => conversationRow(page, 'Inspection trends').click());
        await settle();
        await settle();

        expect(page.querySelector('.cb-artifacts-view')).toBeNull();
        expect(page.querySelector('.chat-state')?.textContent).toBe(`${CONVERSATION}/2/thinking`);
        expect(loadedConversations).toHaveLength(loadsBefore);
        expect(isActiveRow(conversationRow(page, 'Inspection trends'))).toBe(true);
    });

    it('opens the conversation an artifact came from, from the list and from the artifact', async () => {
        storage.artifacts.unshift(
            wireFile('pump-chart', { conversation_uuid: 'conv-2', conversation_title: 'Pump report', title: 'Pump pressure' })
        );
        const page = renderInContainer('fullscreen');
        await settle();
        act(() => navEntry(page, 'Artifacts').click());
        await settle();

        act(() => button(page, 'Open conversation: Pump report')!.click());
        await settle();
        await settle();
        expect(page.querySelector('.cb-artifacts-view')).toBeNull();
        expect(loadedConversations[loadedConversations.length - 1]).toBe('conv-2');
        expect(page.querySelector('.chat-state')?.textContent).toMatch(/^conv-2\//);
        expect(selectedConversations).toEqual(['conv-2']);
        expect(isActiveRow(conversationRow(page, 'Pump report'))).toBe(true);

        // Now from an artifact of the first conversation, opened in full.
        act(() => navEntry(page, 'Artifacts').click());
        await settle();
        const row = Array.from(page.querySelectorAll<HTMLElement>('.cb-artifacts-view .cb-file-item'))
            .find(item => item.querySelector('.cb-file-title')?.textContent === 'Artifact 1')!;
        act(() => row.querySelector<HTMLButtonElement>('.cb-file-main')!.click());
        await settle();
        act(() => button(page.querySelector('.cb-artifact-detail')!, 'Open conversation: Inspection trends')!.click());
        await settle();
        await settle();
        expect(page.querySelector('.cb-artifacts-view')).toBeNull();
        expect(loadedConversations[loadedConversations.length - 1]).toBe(CONVERSATION);
        expect(page.querySelector('.chat-state')?.textContent).toMatch(new RegExp(`^${CONVERSATION}/`));
        expect(selectedConversations).toEqual(['conv-2', CONVERSATION]);
    });

    it('gives the column back to a prompt put in the composer, with focus there', async () => {
        const page = renderInContainer('fullscreen');
        await settle();
        act(() => navEntry(page, 'Artifacts').click());
        await settle();

        act(() => actions!.setComposerText('Show the pump failures'));
        await settle();
        await settle();

        expect(page.querySelector('.cb-artifacts-view')).toBeNull();
        expect(page.querySelector('.cb-chat-view')?.getAttribute('aria-hidden')).toBeNull();
        const composer = page.querySelector<HTMLTextAreaElement>('.cb-chat-view textarea')!;
        expect(composer.value).toBe('Show the pump failures');
        expect(document.activeElement).toBe(composer);
    });

    it('leaves focus in the files panel a host opens over it', async () => {
        const page = renderInContainer('fullscreen');
        await settle();
        act(() => navEntry(page, 'Artifacts').click());
        await settle();
        expect(document.activeElement?.getAttribute('aria-label')).toBe('Search artifacts');

        act(() => actions!.openFiles());
        await settle();
        await settle();

        const panel = page.querySelector<HTMLElement>('.cb-files-panel')!;
        expect(panel).not.toBeNull();
        expect(page.querySelector('.cb-artifacts-view')).toBeNull();
        expect(panel.contains(document.activeElement)).toBe(true);
    });

    it("leaves Escape to a dialog open over it — the credit usage — wherever focus is", async () => {
        const page = renderInContainer('fullscreen', {
            // The allowance never arrives: the dialog stays as it opened.
            getCredits: () => new Promise(() => undefined),
        });
        await settle();
        act(() => navEntry(page, 'Artifacts').click());
        await settle();
        act(() => page.querySelector<HTMLButtonElement>('.cb-artifacts-view .cb-file-main')!.click());
        await settle();
        const detail = () => page.querySelector('.cb-artifact-detail');
        expect(detail()).not.toBeNull();

        // Focus in the dialog (on its close button).
        act(() => actions!.openCreditUsage());
        await settle();
        const dialog = page.querySelector<HTMLElement>('.cb-credit-dialog')!;
        expect(dialog.contains(document.activeElement)).toBe(true);
        press(document.activeElement!, 'Escape');
        expect(page.querySelector('.cb-credit-dialog')).toBeNull();
        expect(detail()).not.toBeNull();

        // Nothing focused, after a click on the dialog's title.
        act(() => actions!.openCreditUsage());
        await settle();
        const title = page.querySelector<HTMLElement>('.cb-credit-dialog h2')!;
        act(() => {
            title.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            (document.activeElement as HTMLElement | null)?.blur();
        });
        press(document.body, 'Escape');
        expect(page.querySelector('.cb-credit-dialog')).toBeNull();
        expect(detail()).not.toBeNull();

        // The dialog gone, Escape is the view's again.
        press(document.body, 'Escape');
        expect(detail()).toBeNull();
        expect(page.querySelector('.cb-artifacts-view')).not.toBeNull();
    });

    it("leaves Escape to the header's menu, which closes alone", async () => {
        const page = renderInContainer('fullscreen');
        await settle();
        act(() => navEntry(page, 'Artifacts').click());
        await settle();
        const more = button(page, 'More options')!;

        act(() => more.focus());
        act(() => more.click());
        expect(page.querySelector('.cb-header-dropdown-menu')).not.toBeNull();
        expect(press(more, 'Escape').defaultPrevented).toBe(true);
        expect(page.querySelector('.cb-header-dropdown-menu')).toBeNull();
        expect(page.querySelector('.cb-artifacts-view')).not.toBeNull();
        expect(document.activeElement).toBe(more);

        // Opened by a click that did not focus it (Safari, Firefox on macOS).
        act(() => more.click());
        act(() => more.blur());
        press(document.body, 'Escape');
        expect(page.querySelector('.cb-header-dropdown-menu')).toBeNull();
        expect(page.querySelector('.cb-artifacts-view')).not.toBeNull();
    });

    describe('an artifact opened from it', () => {
        async function openArtifacts(): Promise<HTMLElement> {
            const page = render();
            await settle();
            act(() => navEntry(page, 'Artifacts').click());
            await settle();
            return page;
        }

        const rowOf = (page: HTMLElement, title: string) =>
            Array.from(page.querySelectorAll<HTMLElement>('.cb-artifacts-panel .cb-file-item'))
                .find(item => item.querySelector('.cb-file-title')?.textContent === title)!;
        const detailOf = (page: HTMLElement) => page.querySelector<HTMLElement>('.cb-artifact-detail');
        const listPaneOf = (page: HTMLElement) => page.querySelector<HTMLElement>('.cb-artifacts-list-pane')!;

        async function openRow(page: HTMLElement, title: string): Promise<HTMLButtonElement> {
            const main = rowOf(page, title).querySelector<HTMLButtonElement>('.cb-file-main')!;
            act(() => main.focus());
            act(() => main.click());
            await settle();
            return main;
        }

        it('shows in full in the same column — no dialog, no lightbox — with Back first and the close button last', async () => {
            const page = await openArtifacts();
            await openRow(page, 'Artifact 2');

            const detail = detailOf(page)!;
            expect(page.querySelector('.cb-artifacts-panel')!.contains(detail)).toBe(true);
            expect(listPaneOf(page).hidden).toBe(true);
            expect(document.querySelector('[role="dialog"], [aria-modal], .cb-attachment-viewer-overlay')).toBeNull();

            const title = detail.querySelector('h2')!;
            expect(title.textContent).toBe('Artifact 2');
            expect(document.activeElement).toBe(title);
            expect(detail.querySelector('.cb-artifact-detail-meta')?.textContent).toContain('Inspection trends');
            const header = detail.querySelector('.cb-files-header')!;
            expect(Array.from(header.querySelectorAll('button')).map(control => control.getAttribute('aria-label'))).toEqual([
                'Back to artifacts',
                'Download: Artifact 2',
                'Open conversation: Inspection trends',
                'Delete: Artifact 2',
                'Close',
            ]);
            expect(header.lastElementChild?.getAttribute('aria-label')).toBe('Close');

            // The file itself, fetched with the user's token, drawn in place.
            const image = detail.querySelector<HTMLImageElement>('.cb-attachment-preview.is-inline img');
            expect(image?.getAttribute('src')).toBe('blob:test');
            const fetched = storage.requests.filter(request => request.url === `${BASE}/jobs/${JOB}/files/a-2`);
            expect(fetched.length).toBeGreaterThan(0);
            expect(fetched.every(request => request.authorization === 'Bearer user-token')).toBe(true);
        });

        it('goes Back to the list as it was left: search, filter, pages, scroll and the row', async () => {
            // More charts called "Artifact …" than a page holds, so "Load more" has a page to add.
            storage.artifacts.push(...Array.from({ length: 10 }, (_, index) => wireFile(`x-${index}`, { title: `Artifact extra ${index}` })));
            const page = await openArtifacts();
            const search = page.querySelector<HTMLInputElement>('.cb-files-search-input')!;
            typeInto(search, 'artifact');
            await settle(350);
            const charts = Array.from(page.querySelectorAll<HTMLButtonElement>('.cb-files-chip')).find(chip => chip.textContent === 'Charts')!;
            act(() => charts.click());
            await settle();
            expect(page.querySelectorAll('.cb-artifacts-panel .cb-file-item')).toHaveLength(20);
            act(() => page.querySelector<HTMLButtonElement>('.cb-files-load-more')!.click());
            await settle();
            const shown = page.querySelectorAll('.cb-artifacts-panel .cb-file-item').length;
            expect(shown).toBe(29);
            const body = page.querySelector<HTMLElement>('.cb-artifacts-panel .cb-files-body')!;
            body.scrollTop = 120;
            const requestsBefore = storage.requests.filter(request => request.url.includes('/artifact-entries?')).length;

            const main = await openRow(page, 'Artifact 7');
            expect(detailOf(page)?.querySelector('h2')?.textContent).toBe('Artifact 7');
            // A browser forgets the scroll position of a box it does not
            // display, as the hidden list is now; jsdom keeps it.
            expect(listPaneOf(page).hidden).toBe(true);
            body.scrollTop = 0;

            act(() => button(page, 'Back to artifacts')!.click());

            expect(detailOf(page)).toBeNull();
            expect(listPaneOf(page).hidden).toBe(false);
            expect(search.value).toBe('artifact');
            expect(charts.getAttribute('aria-pressed')).toBe('true');
            expect(page.querySelectorAll('.cb-artifacts-panel .cb-file-item')).toHaveLength(shown);
            expect(body.scrollTop).toBe(120);
            expect(document.activeElement).toBe(main);
            // Nothing read again: it is the same list.
            expect(storage.requests.filter(request => request.url.includes('/artifact-entries?'))).toHaveLength(requestsBefore);
        });

        it('steps back on Escape — to the list, then to the chat — only from inside the chat', async () => {
            const page = await openArtifacts();
            await openRow(page, 'Artifact 1');
            const hostInput = document.createElement('input');
            document.body.appendChild(hostInput);

            act(() => hostInput.focus());
            press(hostInput, 'Escape');
            expect(detailOf(page)).not.toBeNull();

            press(detailOf(page)!.querySelector('h2')!, 'Escape');
            expect(detailOf(page)).toBeNull();
            expect(page.querySelector('.cb-artifacts-panel')).not.toBeNull();

            press(document.activeElement!, 'Escape');
            expect(page.querySelector('.cb-artifacts-panel')).toBeNull();
            await settle();
            // Back to where the user chose "Artifacts".
            expect(document.activeElement).toBe(navEntry(page, 'Artifacts'));
        });

        it('leaves for its conversation with "Open conversation"', async () => {
            const page = await openArtifacts();
            await openRow(page, 'Artifact 1');
            act(() => button(detailOf(page)!, 'Open conversation: Inspection trends')!.click());
            expect(page.querySelector('.cb-artifacts-panel')).toBeNull();
            expect(page.querySelector('.panels-state')?.textContent).toBe('-/-');
        });

        it('is deleted with two clicks, and the list comes back without it', async () => {
            const page = await openArtifacts();
            await openRow(page, 'Artifact 1');
            act(() => button(detailOf(page)!, 'Delete: Artifact 1')!.click());
            expect(storage.requests.some(request => request.method === 'DELETE')).toBe(false);
            act(() => button(detailOf(page)!, 'Click again to delete')!.click());
            await settle();

            expect(storage.requests.find(request => request.method === 'DELETE')?.url).toBe(`${BASE}/artifacts/a-1`);
            expect(detailOf(page)).toBeNull();
            expect(rowOf(page, 'Artifact 1')).toBeUndefined();
            expect(document.activeElement?.getAttribute('aria-label')).toBe('Search artifacts');
        });

        it('draws a PDF at the width of the column, once it has loaded', async () => {
            storage.artifacts.unshift(wireFile('manual', {
                title: 'Pump manual', kind: 'report', filename: 'manual.pdf', content_type: 'application/pdf',
            }));
            // jsdom lays nothing out: the PDF's box is 366px wide, as in a narrow card.
            vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
                return this.classList.contains('cb-pdf-viewer') ? 366 : 0;
            });
            const page = await openArtifacts();
            await openRow(page, 'Pump manual');
            await settle();

            expect(detailOf(page)!.querySelector('.cb-attachment-preview.is-inline .cb-pdf-viewer')).not.toBeNull();
            expect(pdf.pageWidths.length).toBeGreaterThan(0);
            expect(pdf.pageWidths[pdf.pageWidths.length - 1]).toBe(366);
        });

        it('draws a CSV as a table, in place', async () => {
            storage.artifacts.unshift(wireFile('rows', {
                title: 'Issues by site', kind: 'table', filename: 'issues.csv', content_type: 'text/csv',
            }));
            storage.blobText = 'Site,Issues\nNorth,4\nSouth,7\n';
            const page = await openArtifacts();
            await openRow(page, 'Issues by site');
            await settle();

            const table = detailOf(page)!.querySelector('.cb-artifact-detail-body table')!;
            expect(Array.from(table.querySelectorAll('th')).map(cell => cell.textContent)).toEqual(['Site', 'Issues']);
            expect(Array.from(table.querySelectorAll('tbody tr')).map(row => row.textContent)).toEqual(['North4', 'South7']);
        });

        it('shows a file it cannot draw as a card whose button downloads it', async () => {
            storage.artifacts.unshift(wireFile('sheet', {
                title: 'Monthly export', kind: 'file', filename: 'export.xlsx',
                content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            }));
            const page = await openArtifacts();
            await openRow(page, 'Monthly export');
            await settle();

            const card = detailOf(page)!.querySelector('.cb-artifact-detail-body .cb-attachment-viewer-fallback')!;
            expect(card.querySelector('.cb-attachment-viewer-fallback-name')?.textContent).toBe('export.xlsx');
            const fetched = storage.requests.filter(request => request.url === `${BASE}/jobs/${JOB}/files/sheet`);
            expect(fetched.length).toBeGreaterThan(0);
            expect(fetched.every(request => request.authorization === 'Bearer user-token')).toBe(true);

            act(() => Array.from(card.querySelectorAll<HTMLButtonElement>('button')).find(control => control.textContent === 'Download')!.click());
            expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
        });

        it('says when the file could not be fetched, and stays open', async () => {
            storage.artifacts.unshift(wireFile('lost', {
                title: 'Lost export', kind: 'file', filename: 'lost.xlsx',
                content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            }));
            storage.brokenFiles = new Set(['lost']);
            const page = await openArtifacts();
            await openRow(page, 'Lost export');
            await settle();

            expect(detailOf(page)).not.toBeNull();
            const alert = detailOf(page)!.querySelector('.cb-artifact-detail-body [role="alert"]');
            expect(alert?.textContent).toContain('500');
            expect(button(detailOf(page)!, 'Back to artifacts')).not.toBeNull();
        });

        it('says where a delete failed, and stays open', async () => {
            const page = await openArtifacts();
            await openRow(page, 'Artifact 1');
            (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => respond(500, { message: 'down' }));
            act(() => button(detailOf(page)!, 'Delete: Artifact 1')!.click());
            act(() => button(detailOf(page)!, 'Click again to delete')!.click());
            await settle();

            expect(detailOf(page)).not.toBeNull();
            expect(detailOf(page)!.querySelector('[role="alert"]')?.textContent).toBe("Couldn't delete the artifact.");
        });
    });
});

describe('headers end with their close button', () => {
    // The user's report of 2026-10-14 was of the expanded block's header (see
    // MarkdownContent.test.tsx); every header of the chat with a close button
    // keeps it last.
    it('in the conversation files panel', async () => {
        const page = render();
        await settle();
        act(() => button(page, 'Conversation files')!.click());
        await settle();
        const header = page.querySelector('.cb-files-panel .cb-files-header')!;
        expect(header.querySelector('h2')?.textContent).toBe('Conversation files');
        expect(header.lastElementChild?.getAttribute('aria-label')).toBe('Close');
    });

    it('in the attachment viewer, after its download button', async () => {
        const page = render();
        await settle();
        act(() => button(page, 'Conversation files')!.click());
        await settle();
        act(() => page.querySelector<HTMLButtonElement>('.cb-file-main')!.click());
        await settle();

        const toolbar = document.body.querySelector('.cb-attachment-viewer-toolbar')!;
        const controls = Array.from(toolbar.querySelectorAll('button'));
        expect(controls.map(control => control.textContent || control.getAttribute('aria-label'))).toEqual(['Download', 'Close attachment']);
        expect(controls[controls.length - 1].classList.contains('cb-attachment-viewer-close')).toBe(true);
    });

    it('in the Artifacts list', async () => {
        const page = render();
        await settle();
        act(() => navEntry(page, 'Artifacts').click());
        await settle();
        const header = page.querySelector('.cb-artifacts-list-pane .cb-files-header')!;
        expect(header.querySelector('h2')?.textContent).toBe('Artifacts');
        expect(header.lastElementChild?.getAttribute('aria-label')).toBe('Close');
    });
});

describe('the panels and the view, and the keys', () => {
    // Review of 2026-10-14: the panel claimed aria-modal without keeping Tab
    // inside it, and an Escape anywhere on the host's page closed it. The
    // files panel is still a modal dialog; Artifacts has since become a view
    // in place of the chat (the user's request of 2026-10-14), with no trap.
    async function openArtifacts(): Promise<HTMLElement> {
        const page = render();
        await settle();
        act(() => Array.from(page.querySelectorAll<HTMLButtonElement>('.cb-sidebar-nav-item'))
            .find(item => item.textContent === 'Artifacts')!.click());
        await settle();
        return page;
    }

    const panelOf = (page: HTMLElement) => page.querySelector<HTMLElement>('.cb-artifacts-panel');

    it('keeps Tab inside the files panel: from the last control to the first, and Shift+Tab back', async () => {
        const page = render();
        await settle();
        act(() => button(page, 'Conversation files')!.click());
        await settle();
        const panel = page.querySelector<HTMLElement>('.cb-files-panel')!;
        const close = button(page, 'Close')!;
        const last = button(page, 'Download: photo.jpg')!;
        expect(panel.contains(close) && panel.contains(last)).toBe(true);

        act(() => last.focus());
        expect(press(last, 'Tab').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(close);

        expect(press(close, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(last);

        // In between, Tab is the browser's.
        const row = panel.querySelector<HTMLButtonElement>('.cb-file-main')!;
        act(() => row.focus());
        expect(press(row, 'Tab').defaultPrevented).toBe(false);
        expect(press(row, 'Tab', { shiftKey: true }).defaultPrevented).toBe(false);
    });

    it('leaves Tab to the browser in the Artifacts view: it is no dialog', async () => {
        const page = await openArtifacts();
        const view = panelOf(page)!;
        expect(view.getAttribute('role')).toBe('region');
        expect(view.getAttribute('aria-label')).toBe('Artifacts');
        expect(view.hasAttribute('aria-modal')).toBe(false);
        expect(document.querySelector('[role="dialog"], [aria-modal]')).toBeNull();

        const close = button(page, 'Close')!;
        const loadMore = page.querySelector<HTMLButtonElement>('.cb-files-load-more')!;
        act(() => loadMore.focus());
        expect(press(loadMore, 'Tab').defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(loadMore);
        act(() => close.focus());
        expect(press(close, 'Tab', { shiftKey: true }).defaultPrevented).toBe(false);
    });

    it("takes Escape back when the row the user was on is deleted, and leaves Tab alone", async () => {
        const page = await openArtifacts();
        const remove = button(page, 'Delete: Artifact 0')!;
        act(() => remove.focus());
        act(() => remove.click());
        act(() => button(page, 'Click again to delete')!.click());
        await settle();
        expect(document.activeElement).toBe(document.body);

        expect(press(document.body, 'Tab').defaultPrevented).toBe(false);
        press(document.body, 'Escape');
        expect(panelOf(page)).toBeNull();
    });

    it('closes on Escape from anywhere in the chat, and not from the page around it', async () => {
        const page = await openArtifacts();
        const hostInput = document.createElement('input');
        document.body.appendChild(hostInput);

        act(() => hostInput.focus());
        press(hostInput, 'Escape');
        expect(panelOf(page)).not.toBeNull();
        // Nor once the host's control has let focus go: the user was last on the page.
        act(() => hostInput.blur());
        press(document.body, 'Escape');
        expect(panelOf(page)).not.toBeNull();
        // Tab there is the page's too.
        expect(press(document.body, 'Tab').defaultPrevented).toBe(false);

        // The sidebar beside the panel is the chat.
        const newChat = Array.from(page.querySelectorAll<HTMLButtonElement>('.cb-sidebar-nav-item'))
            .find(item => item.textContent === 'New chat')!;
        act(() => newChat.focus());
        press(newChat, 'Escape');
        expect(panelOf(page)).toBeNull();
    });

    it('closes the files panel on Escape from anywhere in the chat, and not from the page around it', async () => {
        const page = render();
        await settle();
        act(() => button(page, 'Conversation files')!.click());
        await settle();
        const panel = () => page.querySelector('.cb-files-panel');
        const hostInput = document.createElement('input');
        document.body.appendChild(hostInput);

        act(() => hostInput.focus());
        press(hostInput, 'Escape');
        expect(panel()).not.toBeNull();
        // Nor once the host's control has let focus go: the user was last on the page.
        act(() => hostInput.blur());
        press(document.body, 'Escape');
        expect(panel()).not.toBeNull();
        // Tab there is the page's too.
        expect(press(document.body, 'Tab').defaultPrevented).toBe(false);

        // The sidebar beside the panel is the chat.
        const newChat = navEntry(page, 'New chat');
        act(() => newChat.focus());
        press(newChat, 'Escape');
        expect(panel()).toBeNull();
    });

    it("takes the files panel's Tab and Escape back with nothing focused, after a click in it", async () => {
        const page = render();
        await settle();
        act(() => button(page, 'Conversation files')!.click());
        await settle();
        const panel = page.querySelector<HTMLElement>('.cb-files-panel')!;
        act(() => {
            panel.querySelector('h2')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            (document.activeElement as HTMLElement | null)?.blur();
        });
        expect(document.activeElement).toBe(document.body);

        // Tab enters the panel at its first control.
        expect(press(document.body, 'Tab').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(button(panel, 'Close'));

        act(() => (document.activeElement as HTMLElement).blur());
        press(document.body, 'Escape');
        expect(page.querySelector('.cb-files-panel')).toBeNull();
    });

    it('leaves an Escape a control inside has taken', async () => {
        const page = await openArtifacts();
        const search = page.querySelector<HTMLInputElement>('.cb-files-search-input')!;
        search.addEventListener('keydown', event => event.preventDefault());
        press(search, 'Escape');
        expect(panelOf(page)).not.toBeNull();
    });

    it('puts focus back on the row a preview was opened from', async () => {
        const page = render();
        await settle();
        act(() => button(page, 'Conversation files')!.click());
        await settle();

        const row = page.querySelector<HTMLButtonElement>('.cb-file-main')!;
        act(() => row.focus());
        act(() => row.click());
        await settle();
        const viewer = document.body.querySelector<HTMLElement>('.cb-attachment-viewer-inner')!;
        expect(viewer.contains(document.activeElement)).toBe(true);

        // The viewer's Escape is its own; then the panel's again.
        press(document.activeElement!, 'Escape');
        expect(document.body.querySelector('.cb-attachment-viewer-inner')).toBeNull();
        expect(document.activeElement).toBe(row);
        expect(page.querySelector('.cb-files-panel')).not.toBeNull();

        press(row, 'Escape');
        expect(page.querySelector('.cb-files-panel')).toBeNull();
    });
});

describe('thumbnails in the files lists', () => {
    // Review of 2026-10-14: every image row fetched its whole file as soon as
    // the list mounted, all at once, and the provider kept every blob.
    const thumbnailRequests = () => storage.requests.filter(request => request.url.startsWith(`${BASE}/jobs/${JOB}/files/`));

    /** An IntersectionObserver the test drives: nothing is visible until it says so. */
    function stubIntersectionObserver() {
        const observers: Array<{ callback: IntersectionObserverCallback; elements: Element[] }> = [];
        vi.stubGlobal('IntersectionObserver', class {
            record: { callback: IntersectionObserverCallback; elements: Element[] };
            constructor(callback: IntersectionObserverCallback) {
                this.record = { callback, elements: [] };
                observers.push(this.record);
            }
            observe(element: Element) { this.record.elements.push(element); }
            unobserve() { /* not used */ }
            disconnect() { this.record.elements = []; }
            takeRecords() { return []; }
        });
        const show = (count: number) => act(() => {
            for (const observer of observers.filter(entry => entry.elements.length > 0).slice(0, count)) {
                observer.callback(
                    observer.elements.map(target => ({ target, isIntersecting: true }) as unknown as IntersectionObserverEntry),
                    {} as IntersectionObserver
                );
            }
        });
        return { show };
    }

    async function openArtifacts(): Promise<HTMLElement> {
        const page = render();
        await settle();
        act(() => Array.from(page.querySelectorAll<HTMLButtonElement>('.cb-sidebar-nav-item'))
            .find(item => item.textContent === 'Artifacts')!.click());
        await settle();
        return page;
    }

    it('fetches an image only once its row comes near the visible list', async () => {
        const { show } = stubIntersectionObserver();
        const page = await openArtifacts();
        expect(page.querySelectorAll('.cb-artifacts-panel .cb-file-item')).toHaveLength(20);
        expect(thumbnailRequests()).toHaveLength(0);
        // The kind's icon stands in meanwhile.
        expect(page.querySelector('.cb-file-thumb img')).toBeNull();
        expect(page.querySelector('.cb-file-thumb-image svg')).not.toBeNull();

        show(2);
        await settle();
        expect(thumbnailRequests().map(request => request.url)).toEqual([
            `${BASE}/jobs/${JOB}/files/a-0`,
            `${BASE}/jobs/${JOB}/files/a-1`,
        ]);
        expect(page.querySelectorAll('.cb-file-thumb img')).toHaveLength(2);
    });

    it('fetches a few at a time, however many are visible', async () => {
        storage.heldDownloads = [];
        const page = await openArtifacts();
        // No IntersectionObserver in jsdom: every row counts as visible.
        await settle();
        expect(thumbnailRequests()).toHaveLength(3);

        const release = async () => {
            const held = storage.heldDownloads!.splice(0);
            held.forEach(resume => resume());
            await settle();
        };
        await release();
        expect(thumbnailRequests()).toHaveLength(6);
        while (storage.heldDownloads!.length > 0) await release();
        expect(thumbnailRequests()).toHaveLength(20);
        expect(page.querySelectorAll('.cb-file-thumb img')).toHaveLength(20);
    });

    it('draws a large image as its icon, without fetching it', async () => {
        storage.conversationFiles = [
            wireFile('photo', { size_bytes: 6 * 1024 * 1024, source: 'upload', is_artifact: false, kind: null }),
            wireFile('chart', { size_bytes: 40 * 1024 }),
        ];
        const page = render();
        await settle();
        act(() => button(page, 'Conversation files')!.click());
        await settle();
        await settle();

        expect(thumbnailRequests().map(request => request.url)).toEqual([`${BASE}/jobs/${JOB}/files/chart`]);
        // By title: "All" lists the chart under Visuals, before the photo under Files.
        const rowOf = (title: string) => Array.from(page.querySelectorAll('.cb-file-item'))
            .find(row => row.querySelector('.cb-file-title')?.textContent === title)!;
        expect(rowOf('Title photo').querySelector('.cb-file-thumb img')).toBeNull();
        expect(rowOf('Title photo').querySelector('.cb-file-thumb svg')).not.toBeNull();
        expect(rowOf('Title chart').querySelector('.cb-file-thumb img')).not.toBeNull();
    });

    it("lets a deleted artifact's bytes go at once", async () => {
        let made = 0;
        (URL as any).createObjectURL = vi.fn(() => `blob:${++made}`);
        const page = await openArtifacts();
        for (let round = 0; round < 10 && page.querySelectorAll('.cb-file-thumb img').length < 20; round += 1) await settle();
        const firstRow = page.querySelector('.cb-artifacts-panel .cb-file-item')!;
        const objectUrl = firstRow.querySelector('img')!.getAttribute('src');
        expect(objectUrl).toMatch(/^blob:/);

        act(() => button(page, 'Delete: Artifact 0')!.click());
        act(() => button(page, 'Click again to delete')!.click());
        await settle();

        expect(URL.revokeObjectURL).toHaveBeenCalledWith(objectUrl);
        expect((URL.revokeObjectURL as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });
});

// --- Saved and not saved (2026-10-14) ----------------------------------------
//
// The user's words: "the folder icon in the chat should show all the
// artifacts in the conversation, not only the saved ones, but the artifacts
// tab should differentiate between saved and not saved".

const SCORES = '{"type":"line","title":"Scores"}';
const PUMPS = '{"type":"bar","title":"Pumps"}';
const SCORES_KEY = blockKeyOf('chart', SCORES);
const PUMPS_KEY = blockKeyOf('chart', PUMPS);
const chartFence = (body: string) => `\`\`\`chart\n${body}\n\`\`\``;

/** One turn as the Gateway answers it: the question, and an answer of one text. */
function wireJob(uuid: string, text: string, createdAt = '2026-10-13T09:00:00Z'): Record<string, unknown> {
    return {
        uuid,
        user_prompt: 'Show me the scores',
        status: 'completed',
        total_steps: 1,
        total_input_tokens: 1,
        total_output_tokens: 1,
        total_credits_charged: 0,
        created_at: createdAt,
        updated_at: createdAt,
        attachments: [],
        steps: [{
            uuid: `${uuid}-step`,
            step_type: 'llm_call',
            step_sequence: 1,
            status: 'completed',
            request_message: null,
            response_payload: { content_blocks: [{ type: 'text', text }] },
            tool_slug: null,
            tool_input: null,
            tool_output: null,
            input_tokens: 1,
            output_tokens: 1,
            credits_charged: 0,
            started_at: createdAt,
            completed_at: createdAt,
        }],
    };
}

/** The answer of turn `JOB`: Scores, Pumps, and Scores again (the same visual). */
const ANSWER = `Here are two charts.\n\n${chartFence(SCORES)}\n\nAnd pumps:\n\n${chartFence(PUMPS)}\n\nAgain:\n\n${chartFence(SCORES)}\n`;

/** What the chart renderer was last given, every time it rendered. */
let chartProps: BlockRenderProps[] = [];

/** A host's chart: draws its body, and saves itself as its toolbar's Save — against its turn, with its key. */
const TestChart: React.FC<BlockRenderProps> = props => {
    chartProps.push(props);
    const { saveArtifact } = useChatActions();
    const { setActions, jobUuid, blockKey, source } = props;
    React.useEffect(() => {
        setActions([{
            id: 'save',
            label: 'Save chart',
            placement: 'toolbar',
            disabled: !jobUuid,
            run: async () => {
                await saveArtifact(jobUuid!, new Blob(['png'], { type: 'image/png' }), {
                    title: 'Saved chart', kind: 'chart', spec: source, blockKey,
                });
            },
        }]);
    });
    return <div className="host-chart">{source}</div>;
};

const RENDERERS: Record<string, BlockRenderer> = { chart: { component: TestChart, label: 'chart' } };
const BLOCK_CONFIG: ChatbotConfig = { composer: { tools: false }, markdown: { blockRenderers: RENDERERS } };

const lastChart = () => chartProps[chartProps.length - 1];
const rowTitled = (page: ParentNode, title: string) =>
    Array.from(page.querySelectorAll<HTMLElement>('.cb-file-item'))
        .find(item => item.querySelector('.cb-file-title')?.textContent === title);
const markOf = (row: Element | undefined) => row?.querySelector('.cb-file-status')?.textContent ?? null;
const panelTitles = (page: ParentNode) =>
    Array.from(page.querySelectorAll('.cb-files-panel .cb-file-title')).map(node => node.textContent);
const chip = (page: ParentNode, text: string) =>
    Array.from(page.querySelectorAll<HTMLButtonElement>('.cb-files-chip')).find(node => node.textContent === text)!;
/** The files panel's filter, by its word (each segment also shows its count). */
const filterOf = (page: ParentNode, text: string) =>
    Array.from(page.querySelectorAll<HTMLButtonElement>('.cb-files-panel .cb-files-segment'))
        .find(node => node.querySelector('.cb-files-segment-label')?.textContent === text)!;
/** The titles under one of "All"'s section headings ("Visuals", "Files"), and the heading's count. */
const sectionOf = (page: ParentNode, heading: string) => {
    const section = Array.from(page.querySelectorAll('.cb-files-panel .cb-files-section'))
        .find(node => node.querySelector('.cb-files-section-label')?.textContent === heading);
    return section ? {
        count: section.querySelector('.cb-files-section-count')?.textContent ?? null,
        titles: Array.from(section.querySelectorAll('.cb-file-title')).map(node => node.textContent),
    } : null;
};
const segment = (page: ParentNode, text: string) =>
    Array.from(page.querySelectorAll<HTMLButtonElement>('.cb-files-segment')).find(node => node.textContent === text)!;

/** The transcript follows its content's size; jsdom has no ResizeObserver. */
function stubResizeObserver(): void {
    vi.stubGlobal('ResizeObserver', class {
        observe() { /* nothing resizes here */ }
        unobserve() { /* nor here */ }
        disconnect() { /* nor here */ }
    });
}

describe('the conversation files panel — everything of the conversation', () => {
    beforeEach(() => {
        chartProps = [];
    });

    async function openPanel(options: RenderOptions = {}): Promise<HTMLElement> {
        const page = render({ config: BLOCK_CONFIG, jobs: [wireJob(JOB, ANSWER)], ...options });
        await settle();
        act(() => button(page, 'Conversation files')!.click());
        await settle();
        return page;
    }

    it("lists the answers' blocks beside the files — one per turn and key, the server's and the transcript's together", async () => {
        storage.conversationBlocks = [
            // Indexed: the turn's Scores, listed twice (it was drawn twice), and a
            // sub-agent's Pumps under the same turn — all already in the transcript.
            wireBlock('srv-scores', { block_key: SCORES_KEY, title: 'Scores', position: 0 }),
            wireBlock('srv-scores-again', { block_key: SCORES_KEY, title: 'Scores', position: 2 }),
            wireBlock('srv-pumps', { job_uuid: 'job-sub', block_key: PUMPS_KEY, title: 'Pumps', position: 1 }),
            // An older turn the transcript does not hold.
            wireBlock('srv-old', { job_uuid: 'job-0', turn_job_uuid: 'job-0', block_key: 'old1', title: 'Last week', created_at: '2026-10-01T09:00:00Z' }),
        ];
        const page = await openPanel();

        // "All" in two sections, Visuals then Files, each newest first: the
        // turn's blocks (indexed when it ended, at 11:00) in the order they were
        // drawn, the saved chart (10:00), the older turn's block; then the files.
        expect(sectionOf(page, 'Visuals')).toEqual({ count: '4', titles: ['Scores', 'Pumps', 'Title art-1', 'Last week'] });
        expect(sectionOf(page, 'Files')).toEqual({ count: '2', titles: ['rows.xlsx', 'photo.jpg'] });
        expect(panelTitles(page)).toEqual(['Scores', 'Pumps', 'Title art-1', 'Last week', 'rows.xlsx', 'photo.jpg']);
        // Each section's list is named by its heading.
        for (const section of Array.from(page.querySelectorAll('.cb-files-section'))) {
            const heading = section.querySelector('h3')!;
            expect(section.querySelector('ul')?.getAttribute('aria-labelledby')).toBe(heading.id);
        }
        expect(page.querySelectorAll('.cb-file-item-block')).toHaveLength(3);
        for (const title of ['Scores', 'Pumps', 'Last week']) {
            const row = rowTitled(page, title)!;
            expect(markOf(row)).toBe('Not saved');
            // Its kind's icon: a block has no stored picture.
            expect(row.querySelector('.cb-file-thumb img')).toBeNull();
            expect(row.querySelector('.cb-file-meta-text')?.textContent).toContain('chart');
        }
        // The mark is the icon and the word, read as part of the row.
        expect(rowTitled(page, 'Scores')!.querySelector('.cb-file-status svg')?.getAttribute('aria-hidden')).toBe('true');
        expect(markOf(rowTitled(page, 'Title art-1'))).toBe('Saved');
        expect(markOf(rowTitled(page, 'rows.xlsx'))).toBe('Not saved');
        expect(markOf(rowTitled(page, 'photo.jpg'))).toBeNull();
    });

    it("shows the transcript's blocks of a turn the platform has not indexed, and none of another language", async () => {
        const page = await openPanel({
            jobs: [wireJob(JOB, `${ANSWER}\n\`\`\`bash\nls\n\`\`\`\n\`\`\`gauge\n{"title":"Gauge"}\n\`\`\`\n`)],
        });
        // The transcript's blocks (09:00) after the saved chart (10:00); no bash, no gauge.
        expect(sectionOf(page, 'Visuals')).toEqual({ count: '3', titles: ['Title art-1', 'Scores', 'Pumps'] });
        expect(sectionOf(page, 'Files')).toEqual({ count: '2', titles: ['rows.xlsx', 'photo.jpg'] });
        expect(panelTitles(page)).toHaveLength(5);
    });

    it('filters: All · Visuals · Files, a segmented control with counts', async () => {
        storage.conversationFiles = [
            ...(storage.conversationFiles as Record<string, unknown>[]),
            wireFile('art-file', { kind: 'file', title: 'Kept export', filename: 'kept.xlsx', content_type: 'text/csv' }),
        ];
        const page = await openPanel();
        const group = page.querySelector('.cb-files-panel [role="group"]')!;
        expect(group.getAttribute('aria-label')).toBe('Show');
        expect(Array.from(group.querySelectorAll('button')).map(node => [
            node.querySelector('.cb-files-segment-label')?.textContent,
            node.querySelector('.cb-files-segment-count')?.textContent,
            node.getAttribute('aria-pressed'),
        ])).toEqual([
            ['All', '6', 'true'], ['Visuals', '3', 'false'], ['Files', '3', 'false'],
        ]);
        // Its name is the word and the count, apart: "Visuals 3".
        expect(filterOf(page, 'Visuals').textContent).toBe('Visuals 3');

        act(() => filterOf(page, 'Visuals').click());
        expect(panelTitles(page)).toEqual(['Title art-1', 'Scores', 'Pumps']);
        expect(filterOf(page, 'Visuals').getAttribute('aria-pressed')).toBe('true');
        expect(filterOf(page, 'All').getAttribute('aria-pressed')).toBe('false');
        // One list under a filter: no section headings.
        expect(page.querySelector('.cb-files-panel .cb-files-section')).toBeNull();

        act(() => filterOf(page, 'Files').click());
        expect(panelTitles(page)).toEqual(['rows.xlsx', 'photo.jpg', 'Kept export']);

        storage.conversationFiles = [];
        act(() => filterOf(page, 'Visuals').click());
        await act(async () => {
            await actions!.deleteArtifact('art-1');
        });
        await settle();
        expect(panelTitles(page)).toEqual(['Scores', 'Pumps']);
        // The counts follow the list.
        expect(filterOf(page, 'All').querySelector('.cb-files-segment-count')?.textContent).toBe('2');
        expect(filterOf(page, 'Files').querySelector('.cb-files-segment-count')?.textContent).toBe('0');
    });

    it('says when a filter has nothing', async () => {
        storage.conversationFiles = [wireFile('up-1', { source: 'upload', is_artifact: false, kind: null, title: null, filename: 'photo.jpg' })];
        const page = await openPanel({ jobs: [] });
        expect(filterOf(page, 'Visuals').querySelector('.cb-files-segment-count')?.textContent).toBe('0');
        expect(filterOf(page, 'Visuals').classList.contains('is-empty')).toBe(true);
        act(() => filterOf(page, 'Visuals').click());
        expect(page.querySelector('.cb-files-state')?.textContent).toBe('No charts, tables or reports in this conversation yet.');
        // A filter's own short line, not the empty conversation's.
        expect(page.querySelector('.cb-files-empty')).toBeNull();
    });

    it("says under its title which conversation it is and how many items it has, and how many are saved", async () => {
        stubResizeObserver();
        storage.conversationFiles = [
            wireFile('saved-scores', { title: 'Scores PNG', block_key: SCORES_KEY }),
            ...(storage.conversationFiles as Record<string, unknown>[]),
        ];
        const page = renderInContainer('fullscreen', {}, BLOCK_CONFIG, [wireJob(JOB, ANSWER)]);
        await settle();
        await settle();
        act(() => button(page, 'Conversation files')!.click());
        await settle();

        // Scores (saved, with its artifact), Pumps, the chart, the export and the photo.
        const dialog = page.querySelector<HTMLElement>('.cb-files-panel[role="dialog"]')!;
        const subtitle = dialog.querySelector('.cb-files-header .cb-files-subtitle')!;
        expect(subtitle.querySelector('.cb-files-subtitle-title')?.textContent).toBe('Inspection trends');
        expect(subtitle.querySelector('.cb-files-subtitle-title')?.getAttribute('dir')).toBe('auto');
        expect(subtitle.querySelector('.cb-files-subtitle-counts')?.textContent).toBe('5 items · 2 saved');
        // It describes the dialog; the title still names it.
        expect(dialog.getAttribute('aria-describedby')).toBe(subtitle.id);
        expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Conversation files');
        // The close button is still last in the header.
        expect(dialog.querySelector('.cb-files-header')!.lastElementChild?.getAttribute('aria-label')).toBe('Close');
    });

    it('says what each row is, when, and how big; the mark is a pill', async () => {
        storage.conversationFiles = [
            ...(storage.conversationFiles as Record<string, unknown>[]),
            wireFile('report-pdf', { source: 'upload', is_artifact: false, kind: null, title: null, filename: 'audit.pdf', content_type: 'application/pdf' }),
        ];
        const page = await openPanel();
        const meta = (title: string) => rowTitled(page, title)!.querySelector('.cb-file-meta-text')!;
        const kindOf = (title: string) => rowTitled(page, title)!.querySelector('.cb-file-thumb')!.getAttribute('data-kind');

        // Kind first, then who made it, when, and the size; the full date is the tooltip.
        expect(meta('rows.xlsx').textContent).toMatch(/^Spreadsheet · Generated · .+ · 2\.0 KB$/);
        expect(meta('photo.jpg').textContent).toMatch(/^Image · .+ · 2\.0 KB$/);
        expect(meta('audit.pdf').textContent).toMatch(/^PDF · /);
        expect(meta('Title art-1').textContent).toMatch(/^Chart · /);
        expect(meta('rows.xlsx').getAttribute('title')).toBeTruthy();
        // A block: its renderer's word.
        expect(meta('Scores').textContent).toMatch(/^chart( · |$)/);
        // Each detail is one unbroken piece with the dot after it, so where a
        // narrow dialog wraps the line it breaks between details — the date and
        // the size are never cut off (review of 2026-10-14).
        const parts = Array.from(meta('rows.xlsx').querySelectorAll('.cb-file-meta-part'), part => part.textContent);
        expect(parts).toHaveLength(4);
        expect(parts.slice(0, 2)).toEqual(['Spreadsheet ·', 'Generated ·']);
        expect(parts[2]).toMatch(/ ·$/);
        expect(parts[3]).toBe('2.0 KB');

        // Each tile is tinted by its kind.
        expect(kindOf('rows.xlsx')).toBe('spreadsheet');
        expect(kindOf('photo.jpg')).toBe('image');
        expect(kindOf('audit.pdf')).toBe('pdf');
        expect(kindOf('Title art-1')).toBe('chart');
        expect(kindOf('Scores')).toBe('chart');

        // Saved: a filled bookmark; Not saved: the outline. The word is there either way.
        const saved = rowTitled(page, 'Title art-1')!.querySelector('.cb-file-status')!;
        const unsaved = rowTitled(page, 'Scores')!.querySelector('.cb-file-status')!;
        expect(saved.classList.contains('is-saved')).toBe(true);
        expect(unsaved.classList.contains('is-unsaved')).toBe(true);
        expect(saved.querySelector('.cb-file-status-text')?.textContent).toBe('Saved');
        expect(unsaved.querySelector('.cb-file-status-text')?.textContent).toBe('Not saved');
        expect(saved.querySelector('svg path')?.getAttribute('stroke-dasharray')).toBeNull();
        expect(unsaved.querySelector('svg')?.getAttribute('stroke-dasharray')).toBe('3 3');
        // The word is part of the row's name, where a narrow dialog shows the icon alone.
        expect(rowTitled(page, 'Scores')!.querySelector('.cb-file-main')?.textContent).toContain('Not saved');
    });

    it('shows rows\' skeletons while it loads', async () => {
        // The conversation's list waits until the test answers it.
        let answer: () => void = () => undefined;
        (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input).startsWith(`${BASE}/conversations/`)) {
                return new Promise<Response>(resolve => {
                    answer = () => resolve(fakeFetch(input, init));
                });
            }
            return fakeFetch(input, init);
        });
        const page = await openPanel();
        const skeleton = page.querySelector('.cb-files-panel .cb-files-skeleton.is-rows')!;
        expect(skeleton.getAttribute('role')).toBe('status');
        expect(skeleton.getAttribute('aria-label')).toBe('Loading…');
        expect(skeleton.querySelectorAll('.cb-files-skeleton-item')).toHaveLength(4);
        expect(page.querySelector('.cb-files-panel [role="group"]')).toBeNull();

        await act(async () => {
            answer();
        });
        await settle();
        expect(page.querySelector('.cb-files-panel .cb-files-skeleton')).toBeNull();
        expect(panelTitles(page)).toContain('rows.xlsx');
    });

    it("marks a saved block Saved, as one row with its artifact, which it downloads", async () => {
        storage.conversationFiles = [
            wireFile('saved-scores', { title: 'Scores PNG', block_key: SCORES_KEY }),
            ...(storage.conversationFiles as Record<string, unknown>[]),
        ];
        const page = await openPanel();

        expect(panelTitles(page)).not.toContain('Scores PNG');
        const row = rowTitled(page, 'Scores')!;
        expect(markOf(row)).toBe('Saved');
        expect(markOf(rowTitled(page, 'Pumps'))).toBe('Not saved');
        act(() => button(row, 'Download: Scores PNG')!.click());
        await settle();
        expect(storage.requests.some(request => request.url === `${BASE}/jobs/${JOB}/files/saved-scores`)).toBe(true);
    });

    it("opens a block drawn live by its renderer in the expanded overlay; its own Save saves it against the turn, and it shows Saved", async () => {
        const page = await openPanel();
        const main = rowTitled(page, 'Scores')!.querySelector<HTMLButtonElement>('.cb-file-main')!;
        act(() => main.focus());
        act(() => main.click());
        await settle();

        const dialog = document.body.querySelector<HTMLElement>('.cb-md-block-overlay [role="dialog"]')!;
        expect(dialog).not.toBeNull();
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-label')).toBe('Scores');
        expect(dialog.querySelector('.host-chart')?.textContent).toBe(SCORES);
        expect(lastChart()).toMatchObject({
            language: 'chart',
            source: SCORES,
            blockKey: SCORES_KEY,
            jobUuid: JOB,
            conversationId: CONVERSATION,
            expanded: true,
            streaming: false,
        });
        // Its whole answer, for a block that exports its siblings.
        expect(lastChart().getMessageSource()).toContain('And pumps:');
        // Close last in its header, as in every header of the chat.
        const header = dialog.querySelector('.cb-md-block-header .cb-md-block-toolbar')!;
        expect(header.lastElementChild?.getAttribute('aria-label')).toBe('Close');
        // Only the transcript was read: the body was there.
        expect(storage.requests.some(request => request.url.includes('/blocks/'))).toBe(false);

        act(() => button(dialog, 'Save chart')!.click());
        await settle();
        await settle();

        const post = storage.requests.find(request => request.method === 'POST')!;
        expect(post.url).toBe(`${BASE}/jobs/${JOB}/files`);
        expect((post.body as FormData).get('block_key')).toBe(SCORES_KEY);
        expect((post.body as FormData).get('is_artifact')).toBe('true');
        expect(events).toEqual([expect.objectContaining({ change: 'saved', jobUuid: JOB, blockKey: SCORES_KEY })]);
        expect(markOf(rowTitled(page, 'Scores'))).toBe('Saved');
        // One row still: the saved artifact is that block.
        expect(panelTitles(page).filter(title => title === 'Saved chart')).toEqual([]);
        expect(document.body.querySelector('.cb-md-block-overlay')).not.toBeNull();

        // Escape closes the overlay alone, and focus goes back to the row.
        press(document.activeElement ?? dialog, 'Escape');
        expect(document.body.querySelector('.cb-md-block-overlay')).toBeNull();
        expect(page.querySelector('.cb-files-panel')).not.toBeNull();
        expect(document.activeElement).toBe(rowTitled(page, 'Scores')!.querySelector('.cb-file-main'));
    });

    it("fetches a block the transcript does not hold before drawing it, and says when it cannot", async () => {
        storage.conversationBlocks = [
            wireBlock('srv-old', { job_uuid: 'job-0', turn_job_uuid: 'job-0', block_key: 'old1', title: 'Last week', created_at: '2026-10-01T09:00:00Z' }),
            wireBlock('srv-gone', { job_uuid: 'job-0', turn_job_uuid: 'job-0', block_key: 'gone1', title: 'Gone', created_at: '2026-10-01T08:00:00Z' }),
        ];
        storage.blockSources = { 'srv-old': '{"type":"line","title":"Last week"}' };
        const page = await openPanel();

        act(() => rowTitled(page, 'Last week')!.querySelector<HTMLButtonElement>('.cb-file-main')!.click());
        await settle();
        expect(storage.requests.some(request => request.url === `${BASE}/blocks/srv-old`)).toBe(true);
        expect(lastChart()).toMatchObject({ source: '{"type":"line","title":"Last week"}', jobUuid: 'job-0', expanded: true });
        press(document.activeElement!, 'Escape');

        act(() => rowTitled(page, 'Gone')!.querySelector<HTMLButtonElement>('.cb-file-main')!.click());
        await settle();
        expect(document.body.querySelector('.cb-md-block-overlay')).toBeNull();
        expect(rowTitled(page, 'Gone')!.querySelector('.cb-file-error')?.textContent).toBe("Couldn't load this visual.");
    });

    it("shows a block of a language this page cannot draw as a row with its language, opening nothing", async () => {
        storage.conversationBlocks = [
            wireBlock('srv-gauge', { language: 'gauge', kind: null, block_key: 'g1', title: 'Pressure' }),
        ];
        const page = await openPanel({ jobs: [] });
        const row = rowTitled(page, 'Pressure')!;
        expect(row.querySelector('button.cb-file-main')).toBeNull();
        expect(row.querySelector('.cb-file-main.is-static')).not.toBeNull();
        expect(row.querySelector('.cb-file-meta-text')?.textContent).toContain('gauge');
        expect(markOf(row)).toBe('Not saved');
        // Not in the transcript on screen: "Show in chat" says why it is off.
        const locate = row.querySelector<HTMLButtonElement>('.cb-file-action-locate')!;
        expect(locate.getAttribute('aria-disabled')).toBe('true');
        expect(locate.getAttribute('title')).toBe("This answer isn't in the chat on screen.");
        act(() => locate.click());
        expect(page.querySelector('.cb-files-panel')).not.toBeNull();
    });

    it("saves a generated file nobody saved, and marks it Saved", async () => {
        const page = await openPanel();
        const row = rowTitled(page, 'rows.xlsx')!;
        expect(button(rowTitled(page, 'Title art-1')!, 'Save: Title art-1')).toBeNull();
        expect(button(rowTitled(page, 'photo.jpg')!, 'Save: photo.jpg')).toBeNull();
        const announcer = page.querySelector('.cb-files-panel .cb-files-announce')!;
        expect(announcer.getAttribute('role')).toBe('status');
        expect(announcer.textContent).toBe('');

        act(() => button(row, 'Save: rows.xlsx')!.focus());
        act(() => button(row, 'Save: rows.xlsx')!.click());
        await settle();
        await settle();

        // The Save button is gone: focus is on its row, and the save is said
        // aloud (review of 2026-10-14: focus fell to the page).
        expect(document.activeElement).toBe(rowTitled(page, 'rows.xlsx')!.querySelector('.cb-file-main'));
        expect(announcer.textContent).toBe('Saved: rows.xlsx');

        const post = storage.requests.find(request => request.method === 'POST')!;
        expect(post.url).toBe(`${BASE}/files/gen-1/save`);
        expect(events).toEqual([expect.objectContaining({
            change: 'saved', attachmentUuid: 'copy-gen-1', savedFromUuid: 'gen-1', blockKey: null,
        })]);
        expect(markOf(rowTitled(page, 'rows.xlsx'))).toBe('Saved');
        expect(button(rowTitled(page, 'rows.xlsx')!, 'Save: rows.xlsx')).toBeNull();
        // The copy is that file, kept: one row.
        expect(panelTitles(page).filter(title => title === 'rows.xlsx')).toHaveLength(1);
    });

    it('says where a Save failed, and keeps the row unsaved', async () => {
        const page = await openPanel();
        (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () =>
            respond(409, { code: 'NOT_GENERATED', message: 'Only a generated file can be saved.' })
        );
        act(() => button(rowTitled(page, 'rows.xlsx')!, 'Save: rows.xlsx')!.click());
        await settle();
        expect(rowTitled(page, 'rows.xlsx')!.querySelector('.cb-file-error')?.textContent).toBe("Couldn't save the file.");
        expect(markOf(rowTitled(page, 'rows.xlsx'))).toBe('Not saved');
        expect(events).toEqual([]);
    });

    it('goes to a block in the transcript with "Show in chat", closing the panel', async () => {
        stubResizeObserver();
        const scrolls: Array<{ element: Element; options: unknown }> = [];
        (HTMLElement.prototype as any).scrollTo = function (this: Element, options: unknown) {
            scrolls.push({ element: this, options });
        };
        storage.conversationBlocks = [
            wireBlock('srv-old', { job_uuid: 'job-0', turn_job_uuid: 'job-0', block_key: 'old1', title: 'Last week', created_at: '2026-10-01T09:00:00Z' }),
        ];
        const page = renderInContainer('fullscreen', {}, BLOCK_CONFIG, [wireJob(JOB, ANSWER)]);
        await settle();
        await settle();
        const drawn = page.querySelector<HTMLElement>(`.cb-main-chat figure.cb-md-block[data-block-key="${PUMPS_KEY}"]`)!;
        expect(drawn).not.toBeNull();
        expect(drawn.dataset.jobUuid).toBe(JOB);

        act(() => button(page, 'Conversation files')!.click());
        await settle();
        const locate = button(page, 'Show in chat: Pumps')!;
        expect(locate.getAttribute('aria-disabled')).toBeNull();
        expect(button(page, "Show in chat: Last week — This answer isn't in the chat on screen.")).not.toBeNull();

        act(() => locate.click());
        await settle();

        expect(page.querySelector('.cb-files-panel')).toBeNull();
        expect(document.activeElement).toBe(drawn);
        expect(drawn.classList.contains('is-located')).toBe(true);
        // The transcript's own scroll view moved — not the host's page.
        expect(scrolls.map(entry => (entry.element as HTMLElement).className)).toEqual(['cb-scroll-view']);
        delete (HTMLElement.prototype as any).scrollTo;
    });

    it("shows the turn under way's finished blocks at once, and reads again after it ends", async () => {
        stubResizeObserver();
        let finish: () => void = () => undefined;
        const page = renderInContainer('fullscreen', {
            sendMessage: (_text: string, onEvent: (event: unknown) => void, onComplete: () => void) => {
                const token = (text: string) => onEvent({ type: 'token', data: { type: 'token', job_uuid: 'job-live', content: text } });
                token(`Live:\n\n${chartFence('{"title":"Live one"}')}\n\nNext:\n\n\`\`\`chart\n{"title":"Half`);
                return new Promise<void>(resolve => {
                    finish = () => {
                        onComplete();
                        resolve();
                    };
                });
            },
        }, BLOCK_CONFIG, [wireJob(JOB, ANSWER)]);
        await settle();
        await act(async () => {
            void actions!.sendMessage('And now?');
        });
        await settle();
        act(() => button(page, 'Conversation files')!.click());
        await settle();

        // The finished fence of the turn under way is there; the one still being written is not.
        const titles = panelTitles(page);
        expect(titles).toContain('Live one');
        expect(titles).not.toContain('Half');
        expect(titles.indexOf('Live one')).toBeLessThan(titles.indexOf('Scores'));
        const reads = () => storage.requests.filter(request => request.url === `${BASE}/conversations/${CONVERSATION}`).length;
        const readsBefore = reads();

        await act(async () => {
            finish();
        });
        await settle();
        expect(reads()).toBe(readsBefore);
        // The platform has indexed the turn by now.
        storage.conversationBlocks = [
            wireBlock('srv-live', { job_uuid: 'job-live', turn_job_uuid: 'job-live', block_key: blockKeyOf('chart', '{"title":"Live one"}'), title: 'Live one, indexed' }),
        ];
        await settle(1600);
        expect(reads()).toBe(readsBefore + 1);
        expect(panelTitles(page)).toContain('Live one, indexed');
        expect(panelTitles(page)).not.toContain('Live one');
    });

    // Review of 2026-10-14: opened from the panel, a block of the turn under
    // way was drawn as finished, with a copy of its answer taken on the
    // click — a report saved half an answer as its artifact.
    it('draws a block of the turn under way as still streaming, reading its answer as it grows, until the turn ends', async () => {
        stubResizeObserver();
        let finish: () => void = () => undefined;
        let emit: (text: string) => void = () => undefined;
        const page = renderInContainer('fullscreen', {
            sendMessage: (_text: string, onEvent: (event: unknown) => void, onComplete: () => void) => {
                emit = text => onEvent({ type: 'token', data: { type: 'token', job_uuid: 'job-live', content: text } });
                emit(`Live:\n\n${chartFence('{"title":"Live one"}')}\n\nThe rest`);
                return new Promise<void>(resolve => {
                    finish = () => {
                        onComplete();
                        resolve();
                    };
                });
            },
        }, BLOCK_CONFIG, [wireJob(JOB, ANSWER)]);
        await settle();
        await act(async () => {
            void actions!.sendMessage('And now?');
        });
        await settle();
        act(() => button(page, 'Conversation files')!.click());
        await settle();
        act(() => rowTitled(page, 'Live one')!.querySelector<HTMLButtonElement>('.cb-file-main')!.click());
        await settle();

        expect(lastChart()).toMatchObject({ source: '{"title":"Live one"}', jobUuid: 'job-live', expanded: true, streaming: true });
        expect(lastChart().getMessageSource()).toContain('The rest');
        expect(lastChart().getMessageSource()).not.toContain('of the answer');

        await act(async () => {
            emit(' of the answer.');
        });
        await settle();
        // The message as it is now, not as it was when the row was clicked.
        expect(lastChart().getMessageSource()).toContain('The rest of the answer.');
        expect(lastChart().streaming).toBe(true);

        await act(async () => {
            finish();
        });
        await settle();
        expect(document.body.querySelector('.cb-md-block-overlay')).not.toBeNull();
        expect(lastChart().streaming).toBe(false);
        expect(lastChart().getMessageSource()).toContain('The rest of the answer.');
    });

    // Review of 2026-10-14: the inline sidebar stays usable beside the panel
    // in fullscreen; a conversation picked there kept the previous one's
    // list until its own read landed — and for good when that read failed.
    it("never shows another conversation's list: it waits for the one picked, and a failed read keeps none", async () => {
        stubResizeObserver();
        const page = renderInContainer('fullscreen', {}, BLOCK_CONFIG, [wireJob(JOB, ANSWER)]);
        await settle();
        await settle();
        act(() => button(page, 'Conversation files')!.click());
        await settle();
        expect(panelTitles(page)).toContain('rows.xlsx');

        let fail: () => void = () => undefined;
        (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input) === `${BASE}/conversations/conv-2`) {
                return new Promise<Response>(resolve => {
                    fail = () => resolve(respond(503, { code: 'MINIO_NOT_CONFIGURED', message: 'Storage is not configured.' }));
                });
            }
            return fakeFetch(input, init);
        });
        await act(async () => {
            await actions!.selectConversation('conv-2');
        });
        await settle();

        expect(page.querySelector('.chat-state')?.textContent).toMatch(/^conv-2\//);
        expect(page.querySelector('.cb-files-panel')).not.toBeNull();
        expect(panelTitles(page)).toEqual([]);
        expect(page.querySelector('.cb-files-panel .cb-files-skeleton')).not.toBeNull();
        expect(button(page, 'Save: rows.xlsx')).toBeNull();

        await act(async () => {
            fail();
        });
        await settle();
        expect(panelTitles(page)).toEqual([]);
        expect(page.querySelector('.cb-files-panel .cb-files-error')?.textContent).toContain("Couldn't load the files.");
    });

    it("lists a handoff child's block once, under the turn that handed over, after a reload", async () => {
        const handoff = {
            ...wireJob('job-child', `Analyst here.\n\n${chartFence(PUMPS)}\n`, '2026-10-13T09:01:00Z'),
            triggered_by_job_uuid: JOB,
            handoff: true,
        };
        // The platform's turn of the child's block is the parent's job.
        storage.conversationBlocks = [
            wireBlock('srv-pumps', { job_uuid: 'job-child', turn_job_uuid: JOB, block_key: PUMPS_KEY, title: 'Pumps', position: 0 }),
        ];
        const page = await openPanel({ jobs: [wireJob(JOB, 'Over to the analyst.'), handoff] });

        expect(panelTitles(page).filter(title => title === 'Pumps')).toHaveLength(1);
        const row = rowTitled(page, 'Pumps')!;
        // From the transcript too: "Show in chat" can go to it.
        expect(row.querySelector('.cb-file-action-locate')?.getAttribute('aria-disabled')).toBeNull();

        act(() => row.querySelector<HTMLButtonElement>('.cb-file-main')!.click());
        await settle();
        // Saved against the turn, as the platform indexed it.
        expect(lastChart()).toMatchObject({ source: PUMPS, jobUuid: JOB, blockKey: PUMPS_KEY });
    });
});

describe('mergeConversation', () => {
    it("files a transcript block keyed by a sub-agent's or handoff child's job under the turn the platform names", () => {
        const block = {
            turnJobUuid: 'job-child',
            messageId: 'job-child-assistant',
            language: 'chart',
            source: PUMPS,
            meta: null,
            blockKey: PUMPS_KEY,
            messageText: chartFence(PUMPS),
            createdAt: '2026-10-13T09:00:00.000Z',
            messageIndex: 1,
        };
        const record = {
            uuid: 'srv-pumps', job_uuid: 'job-child', turn_job_uuid: 'job-parent', conversation_uuid: CONVERSATION,
            conversation_title: null, language: 'chart', kind: 'chart', block_key: PUMPS_KEY, title: 'Pumps',
            position: 0, created_at: '2026-10-13T09:00:00Z', saved: false, artifact_uuids: [],
        } as BlockRecord;
        const items = mergeConversation([], [record], [block]);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            type: 'block',
            block: { turnJobUuid: 'job-parent', serverUuid: 'srv-pumps', messageId: 'job-child-assistant', source: PUMPS },
        });
    });
});

describe('saving through the chat — blocks and generated files', () => {
    it("sends a block's key with its artifact, and says which block was saved", async () => {
        render();
        await act(async () => {
            await actions!.saveArtifact(JOB, new Blob(['png'], { type: 'image/png' }), { kind: 'chart', blockKey: SCORES_KEY });
        });
        const post = storage.requests.find(request => request.method === 'POST')!;
        expect((post.body as FormData).get('block_key')).toBe(SCORES_KEY);
        expect(events).toEqual([expect.objectContaining({ change: 'saved', jobUuid: JOB, blockKey: SCORES_KEY, savedFromUuid: null })]);
    });

    it('saves a generated file, says so, and refuses without the storage API', async () => {
        render();
        let copy: unknown = null;
        await act(async () => {
            copy = await actions!.saveGeneratedFile('gen-1');
        });
        expect(copy).toMatchObject({ attachment_uuid: 'copy-gen-1', is_artifact: true, saved_from_uuid: 'gen-1' });
        expect(events).toEqual([expect.objectContaining({
            change: 'saved', attachmentUuid: 'copy-gen-1', conversationId: CONVERSATION, jobUuid: JOB, savedFromUuid: 'gen-1', blockKey: null,
        })]);
        act(() => root?.unmount());

        render({ accessToken: null });
        await expect(actions!.saveGeneratedFile('gen-1')).rejects.toThrow(/storageApiUrl and accessToken/);
    });
});

describe('the Artifacts view — saved and not saved', () => {
    const generated = () => wireFile('gen-9', {
        source: 'generated', is_artifact: false, kind: null, title: null, filename: 'rows.xlsx',
        content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', created_at: '2026-10-14T08:00:00Z',
    });

    beforeEach(() => {
        chartProps = [];
        // Three saved, then two not saved: all on the first page.
        storage.artifacts = storage.artifacts.slice(0, 3);
        storage.unsavedEntries = [
            blockEntry(wireBlock('blk-1', { block_key: SCORES_KEY, title: 'Unsaved scores', created_at: '2026-10-14T09:00:00Z' })),
            fileEntry(generated()),
        ];
        storage.blockSources = { 'blk-1': SCORES };
    });

    async function openArtifacts(config: ChatbotConfig = BLOCK_CONFIG): Promise<HTMLElement> {
        const page = render({ config });
        await settle();
        act(() => navEntry(page, 'Artifacts').click());
        await settle();
        return page;
    }

    const viewOf = (page: HTMLElement) => page.querySelector<HTMLElement>('.cb-artifacts-view')!;
    const detailOf = (page: HTMLElement) => page.querySelector<HTMLElement>('.cb-artifact-detail');
    const lastEntriesQuery = () => Object.fromEntries(new URL(
        storage.requests.filter(request => request.url.includes('/artifact-entries?')).pop()!.url
    ).searchParams);

    it('tells them apart: All · Saved · Not saved above the kind chips, and a mark on every row', async () => {
        const page = await openArtifacts();
        const view = viewOf(page);

        const control = view.querySelector<HTMLElement>('.cb-files-segmented')!;
        expect(control.getAttribute('role')).toBe('group');
        expect(control.getAttribute('aria-label')).toBe('Saved or not');
        expect(Array.from(control.querySelectorAll('button')).map(node => [node.textContent, node.getAttribute('aria-pressed')])).toEqual([
            ['All', 'true'], ['Saved', 'false'], ['Not saved', 'false'],
        ]);
        // Above the kind chips.
        const chips = view.querySelector('.cb-files-chips')!;
        expect(control.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(lastEntriesQuery()).toMatchObject({ status: 'all' });

        const rows = Array.from(view.querySelectorAll<HTMLElement>('.cb-file-item'));
        expect(rows.map(row => [row.querySelector('.cb-file-title')?.textContent, markOf(row)])).toEqual([
            ['Artifact 0', 'Saved'],
            ['Artifact 1', 'Saved'],
            ['Artifact 2', 'Saved'],
            ['Unsaved scores', 'Not saved'],
            ['rows.xlsx', 'Not saved'],
        ]);
        // A block nobody saved: its kind's icon and its conversation.
        const block = rowTitled(view, 'Unsaved scores')!;
        expect(block.querySelector('.cb-file-thumb svg')).not.toBeNull();
        expect(block.querySelector('.cb-file-meta-text')?.textContent).toContain('Inspection trends');
        // Only an artifact can be deleted; a generated file nobody saved has Save.
        expect(button(block, 'Delete: Unsaved scores')).toBeNull();
        expect(button(rowTitled(view, 'rows.xlsx')!, 'Delete: rows.xlsx')).toBeNull();
        expect(button(rowTitled(view, 'rows.xlsx')!, 'Save: rows.xlsx')).not.toBeNull();
        expect(button(rowTitled(view, 'Artifact 0')!, 'Delete: Artifact 0')).not.toBeNull();

        act(() => segment(view, 'Not saved').click());
        await settle();
        expect(lastEntriesQuery()).toMatchObject({ status: 'unsaved' });
        expect(Array.from(view.querySelectorAll('.cb-file-title')).map(node => node.textContent)).toEqual(['Unsaved scores', 'rows.xlsx']);
        expect(segment(view, 'Not saved').getAttribute('aria-pressed')).toBe('true');

        // With a kind, on the server too.
        act(() => chip(view, 'Charts').click());
        await settle();
        expect(lastEntriesQuery()).toMatchObject({ status: 'unsaved', kind: 'chart' });
        expect(Array.from(view.querySelectorAll('.cb-file-title')).map(node => node.textContent)).toEqual(['Unsaved scores']);

        act(() => chip(view, 'All').click());
        act(() => segment(view, 'Saved').click());
        await settle();
        expect(lastEntriesQuery()).toMatchObject({ status: 'saved' });
        expect(Array.from(view.querySelectorAll('.cb-file-title')).map(node => node.textContent)).toEqual(['Artifact 0', 'Artifact 1', 'Artifact 2']);
    });

    it('says what each filter has nothing of', async () => {
        storage.artifacts = [];
        storage.unsavedEntries = [];
        const page = await openArtifacts();
        const view = viewOf(page);
        expect(view.querySelector('.cb-files-state')?.textContent).toBe('Nothing here yet. Charts, tables, reports and files from your answers appear here.');
        act(() => segment(view, 'Saved').click());
        await settle();
        expect(view.querySelector('.cb-files-state')?.textContent).toBe('Nothing saved yet. Save a chart, table or report from an answer and it appears here.');
        act(() => segment(view, 'Not saved').click());
        await settle();
        // Not a claim that everything is saved: a turn's visuals are listed
        // only once it has ended, and older turns may never have been indexed.
        expect(view.querySelector('.cb-files-state')?.textContent)
            .toBe("Nothing unsaved to show. Charts, tables and files you haven't saved appear here.");
        // A kind chip, nothing typed: the filters, not "your search".
        act(() => chip(view, 'Charts').click());
        await settle();
        expect(view.querySelector('.cb-files-state')?.textContent).toBe('Nothing matches these filters.');
        // Something typed: the search.
        typeInto(view.querySelector<HTMLInputElement>('.cb-files-search-input')!, 'pumps');
        await settle(350);
        expect(view.querySelector('.cb-files-state')?.textContent).toBe('No artifacts match your search.');
    });

    it('names the kind chips for what they filter, apart from the view and the saved filter', async () => {
        const page = await openArtifacts();
        const view = viewOf(page);
        expect(view.getAttribute('aria-label')).toBe('Artifacts');
        expect(view.querySelector('.cb-files-chips')?.getAttribute('aria-label')).toBe('Kind');
        expect(view.querySelector('.cb-files-segmented')?.getAttribute('aria-label')).toBe('Saved or not');
    });

    it('opens a block nobody saved drawn live in the column; its own Save makes it Saved', async () => {
        const page = await openArtifacts();
        const main = rowTitled(viewOf(page), 'Unsaved scores')!.querySelector<HTMLButtonElement>('.cb-file-main')!;
        act(() => main.focus());
        act(() => main.click());
        await settle();

        const detail = detailOf(page)!;
        expect(viewOf(page).contains(detail)).toBe(true);
        expect(document.querySelector('[role="dialog"], [aria-modal], .cb-md-block-overlay')).toBeNull();
        expect(storage.requests.some(request => request.url === `${BASE}/blocks/blk-1`)).toBe(true);
        expect(detail.querySelector('.cb-artifact-detail-body .host-chart')?.textContent).toBe(SCORES);
        expect(lastChart()).toMatchObject({
            language: 'chart', source: SCORES, blockKey: SCORES_KEY, jobUuid: JOB, conversationId: CONVERSATION,
            expanded: true, streaming: false,
        });
        const header = detail.querySelector('.cb-artifact-detail-header')!;
        expect(header.querySelector('h2')?.textContent).toBe('Unsaved scores');
        expect(document.activeElement).toBe(header.querySelector('h2'));
        expect(markOf(header)).toBe('Not saved');
        // Back first, the view's close last; the drawn frame has no close of its own.
        const controls = Array.from(header.querySelectorAll('button')).map(node => node.getAttribute('aria-label'));
        expect(controls[0]).toBe('Back to artifacts');
        expect(controls[controls.length - 1]).toBe('Close');
        expect(detail.querySelector('.cb-md-block-close')).toBeNull();
        expect(detail.querySelector('.cb-md-block-expand')).toBeNull();

        act(() => button(detail, 'Save chart')!.click());
        await settle();
        await settle();

        const post = storage.requests.find(request => request.method === 'POST')!;
        expect(post.url).toBe(`${BASE}/jobs/${JOB}/files`);
        expect((post.body as FormData).get('block_key')).toBe(SCORES_KEY);
        expect(markOf(detailOf(page)!.querySelector('.cb-artifact-detail-header')!)).toBe('Saved');
        // Still drawn live: the same visual, kept — and downloadable now.
        expect(detailOf(page)!.querySelector('.host-chart')).not.toBeNull();
        expect(button(detailOf(page)!, 'Download: Saved chart')).not.toBeNull();

        // Back: the list, read again, has the saved artifact where the block was.
        act(() => button(page, 'Back to artifacts')!.click());
        await settle();
        const view = viewOf(page);
        expect(rowTitled(view, 'Unsaved scores')).toBeUndefined();
        expect(markOf(rowTitled(view, 'Saved chart'))).toBe('Saved');
        expect(document.activeElement).toBe(rowTitled(view, 'Saved chart')!.querySelector('.cb-file-main'));
    });

    it("says when a block cannot be fetched, with a retry; and shows the source of one this page cannot draw", async () => {
        storage.blockSources = {};
        const page = await openArtifacts();
        act(() => rowTitled(viewOf(page), 'Unsaved scores')!.querySelector<HTMLButtonElement>('.cb-file-main')!.click());
        await settle();
        const alert = detailOf(page)!.querySelector('.cb-artifact-detail-body [role="alert"]')!;
        expect(alert.textContent).toContain("Couldn't load this visual.");

        storage.blockSources = { 'blk-1': SCORES };
        act(() => alert.querySelector<HTMLButtonElement>('button')!.click());
        await settle();
        expect(detailOf(page)!.querySelector('.host-chart')).not.toBeNull();

        act(() => button(page, 'Back to artifacts')!.click());
        act(() => root?.unmount());
        container?.remove();

        const plain = await openArtifacts({ composer: { tools: false } });
        act(() => rowTitled(viewOf(plain), 'Untitled chart')?.querySelector<HTMLButtonElement>('.cb-file-main')?.click());
        // Without a renderer, the server's title still names it.
        act(() => rowTitled(viewOf(plain), 'Unsaved scores')!.querySelector<HTMLButtonElement>('.cb-file-main')!.click());
        await settle();
        const detail = detailOf(plain)!;
        expect(detail.querySelector('.cb-files-state')?.textContent).toBe("This chart can't be drawn here.");
        expect(detail.querySelector('pre code')?.textContent).toBe(SCORES);
    });

    it('opens a generated file nobody saved as the file, with Save; saved, it is the artifact', async () => {
        const page = await openArtifacts();
        const main = rowTitled(viewOf(page), 'rows.xlsx')!.querySelector<HTMLButtonElement>('.cb-file-main')!;
        act(() => main.focus());
        act(() => main.click());
        await settle();

        const detail = detailOf(page)!;
        expect(detail.querySelector('.cb-attachment-viewer-fallback-name')?.textContent).toBe('rows.xlsx');
        const header = detail.querySelector('.cb-artifact-detail-header')!;
        expect(markOf(header)).toBe('Not saved');
        expect(Array.from(header.querySelectorAll('button')).map(node => node.getAttribute('aria-label'))).toEqual([
            'Back to artifacts',
            'Save: rows.xlsx',
            'Download: rows.xlsx',
            'Open conversation: Inspection trends',
            'Close',
        ]);

        act(() => button(header as HTMLElement, 'Save: rows.xlsx')!.click());
        await settle();
        await settle();

        expect(storage.requests.find(request => request.method === 'POST')?.url).toBe(`${BASE}/files/gen-9/save`);
        const savedHeader = detailOf(page)!.querySelector<HTMLElement>('.cb-artifact-detail-header')!;
        expect(markOf(savedHeader)).toBe('Saved');
        expect(button(savedHeader, 'Save: rows.xlsx')).toBeNull();
        expect(button(savedHeader, 'Delete: rows.xlsx')).not.toBeNull();

        act(() => button(page, 'Back to artifacts')!.click());
        await settle();
        const view = viewOf(page);
        expect(markOf(rowTitled(view, 'rows.xlsx'))).toBe('Saved');
        expect(document.activeElement).toBe(rowTitled(view, 'rows.xlsx')!.querySelector('.cb-file-main'));
    });

    it('saves a generated file from its row too', async () => {
        const page = await openArtifacts();
        act(() => button(rowTitled(viewOf(page), 'rows.xlsx')!, 'Save: rows.xlsx')!.click());
        await settle();
        await settle();
        expect(markOf(rowTitled(viewOf(page), 'rows.xlsx'))).toBe('Saved');
        expect(events.map(event => event.savedFromUuid)).toEqual(['gen-9']);
    });

    // Review of 2026-10-14: the row's Save button went, focus fell to the
    // page — and the next Escape closed the whole view.
    it("follows a row's Save with focus to the saved copy, wherever the list puts it, and says so", async () => {
        const scrolled: Element[] = [];
        (HTMLElement.prototype as any).scrollIntoView = function (this: Element) {
            scrolled.push(this);
        };
        const page = await openArtifacts();
        const view = viewOf(page);
        const announcer = view.querySelector('.cb-files-announce')!;
        const save = button(rowTitled(view, 'rows.xlsx')!, 'Save: rows.xlsx')!;
        act(() => save.focus());
        act(() => save.click());
        await settle();
        await settle();

        // Read again: the copy is a new entry, at the top; focus went with it.
        const titles = Array.from(view.querySelectorAll('.cb-file-title')).map(node => node.textContent);
        expect(titles[0]).toBe('rows.xlsx');
        expect(titles.filter(title => title === 'rows.xlsx')).toHaveLength(1);
        const main = rowTitled(view, 'rows.xlsx')!.querySelector('.cb-file-main');
        expect(document.activeElement).toBe(main);
        expect(scrolled).toContain(main);
        expect(announcer.textContent).toBe('Saved: rows.xlsx');

        // Focus is in the view: Escape steps back as it should, and only once.
        press(document.activeElement!, 'Escape');
        expect(page.querySelector('.cb-artifacts-view')).toBeNull();
        delete (HTMLElement.prototype as any).scrollIntoView;
    });

    // Review of 2026-10-14: the save remounted the detail — the file
    // downloaded again, focus jumped to the title — and Back focused the
    // saved copy where the old row had been scrolled to, off screen.
    it("keeps a saved file's detail on screen, focus on its first action, and brings the saved row into view on Back", async () => {
        const scrolled: Element[] = [];
        (HTMLElement.prototype as any).scrollIntoView = function (this: Element) {
            scrolled.push(this);
        };
        const page = await openArtifacts();
        act(() => rowTitled(viewOf(page), 'rows.xlsx')!.querySelector<HTMLButtonElement>('.cb-file-main')!.click());
        await settle();
        const detail = detailOf(page)!;
        const preview = detail.querySelector('.cb-artifact-detail-body')!.firstElementChild;
        const save = button(detail, 'Save: rows.xlsx')!;
        act(() => save.focus());
        act(() => save.click());
        await settle();
        await settle();

        expect(detailOf(page)).toBe(detail);
        expect(detail.querySelector('.cb-artifact-detail-body')!.firstElementChild).toBe(preview);
        expect(markOf(detail.querySelector('.cb-artifact-detail-header')!)).toBe('Saved');
        expect(document.activeElement).toBe(button(detail, 'Download: rows.xlsx'));
        expect(viewOf(page).querySelector('.cb-files-announce')?.textContent).toBe('Saved: rows.xlsx');

        act(() => button(page, 'Back to artifacts')!.click());
        await settle();
        const main = rowTitled(viewOf(page), 'rows.xlsx')!.querySelector('.cb-file-main');
        expect(document.activeElement).toBe(main);
        expect(scrolled).toContain(main);
        delete (HTMLElement.prototype as any).scrollIntoView;
    });

    // Review of 2026-10-14: its words pushed the close button out of a
    // 320px column. Files.css shows the icon in a red ring there instead.
    it('arms Delete with its question in words, and an icon a narrow header shows in their place', async () => {
        const page = await openArtifacts();
        act(() => rowTitled(viewOf(page), 'Artifact 0')!.querySelector<HTMLButtonElement>('.cb-file-main')!.click());
        await settle();
        const header = detailOf(page)!.querySelector<HTMLElement>('.cb-artifact-detail-header')!;
        act(() => button(header, 'Delete: Artifact 0')!.click());
        const armed = button(header, 'Click again to delete')!;
        expect(armed.classList.contains('is-confirming')).toBe(true);
        expect(armed.getAttribute('title')).toBe('Click again to delete');
        expect(armed.querySelector('.cb-file-action-text')?.textContent).toBe('Click again to delete');
        expect(armed.querySelector('.cb-file-action-confirm-icon svg')).not.toBeNull();
        expect(armed.querySelector('.cb-file-action-confirm-icon')?.getAttribute('aria-hidden')).toBe('true');
        // The close button is still last.
        expect(header.lastElementChild?.getAttribute('aria-label')).toBe('Close');
    });

    it('reads the list again a moment after a turn ends', async () => {
        stubResizeObserver();
        let finish: () => void = () => undefined;
        const page = renderInContainer('fullscreen', {
            sendMessage: (_text: string, _onEvent: unknown, onComplete: () => void) => new Promise<void>(resolve => {
                finish = () => {
                    onComplete();
                    resolve();
                };
            }),
        }, BLOCK_CONFIG);
        await settle();
        await act(async () => {
            void actions!.sendMessage('Chart it');
        });
        act(() => navEntry(page, 'Artifacts').click());
        await settle();
        const reads = () => storage.requests.filter(request => request.url.includes('/artifact-entries?')).length;
        const before = reads();
        await act(async () => {
            finish();
        });
        await settle(1600);
        expect(reads()).toBe(before + 1);
    });
});

describe('formatRelativeDate', () => {
    const NOW = Date.parse('2026-10-14T12:00:00Z');
    const ago = (ms: number) => formatRelativeDate(new Date(NOW - ms).toISOString(), NOW);
    const MINUTE = 60 * 1000;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    let lang = '';
    beforeEach(() => {
        lang = document.documentElement.lang;
        document.documentElement.lang = 'en';
    });
    afterEach(() => {
        document.documentElement.lang = lang;
    });

    it('counts whole units elapsed, never rounding up to the next unit (review of 2026-10-14)', () => {
        expect(ago(30 * 1000)).toBe('now');
        expect(ago(59.6 * MINUTE)).toBe('59 minutes ago');
        expect(ago(60 * MINUTE)).toBe('1 hour ago');
        expect(ago(90 * MINUTE)).toBe('1 hour ago');
        expect(ago(23.7 * HOUR)).toBe('23 hours ago');
        expect(ago(24 * HOUR)).toBe('yesterday');
        expect(ago(6.8 * DAY)).toBe('6 days ago');
    });

    it('gives a short date from a week on, and reads a date ahead of the clock as now', () => {
        expect(ago(7 * DAY)).toBe('Oct 7');
        expect(ago(-5 * MINUTE)).toBe('now');
        expect(formatRelativeDate('not a date', NOW)).toBe('');
    });
});
