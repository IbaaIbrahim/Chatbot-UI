import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    MAX_ARTIFACT_OFFSET,
    MAX_SPEC_BYTES,
    SAVE_RETRY_DELAYS_MS,
    StorageClient,
    StorageRequestError,
    normalizeArtifactEntry,
    normalizeBlockRecord,
    normalizeConversationFile,
    prepareSpec,
} from './StorageClient';
import { resolveStorageAttachmentsBase } from '../common/attachmentUtils';

/**
 * The storage API's conversation files and artifacts (platform ADR-020), as
 * the chat reads and writes them. The response bodies below are the shapes
 * the storage API answers with: `ConversationFileResponse` under `data.file`,
 * `data.files` and `data.artifacts.{items, pagination}`.
 */

const STORAGE = 'https://storage.test';
const BASE = `${STORAGE}/api/v1/attachments`;
const JOB = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '22222222-2222-4222-8222-222222222222';

function wireFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const uuid = (overrides.uuid as string) ?? '33333333-3333-4333-8333-333333333333';
    return {
        uuid,
        job_uuid: JOB,
        conversation_uuid: CONVERSATION,
        conversation_title: 'Inspection trends',
        filename: 'scores.png',
        content_type: 'image/png',
        size_bytes: 2048,
        source: 'artifact',
        is_artifact: true,
        kind: 'chart',
        title: 'Average score per month',
        has_spec: true,
        created_at: '2026-10-13T10:00:00Z',
        download_path: `/api/v1/attachments/jobs/${JOB}/files/${uuid}`,
        download_url: `http://internal:8005/api/v1/attachments/jobs/${JOB}/files/${uuid}`,
        ...overrides,
    };
}

function respond(status: number, body?: unknown): Response {
    const text = body === undefined ? '' : JSON.stringify(body);
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => JSON.parse(text),
        text: async () => text,
        blob: async () => new Blob(['bytes'], { type: 'image/png' }),
    } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const client = () => new StorageClient({ storageApiUrl: STORAGE, token: 'user-token' });
const lastCall = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];

describe('the attachments root', () => {
    it('resolves from the base URL, the root or the upload URL', () => {
        expect(resolveStorageAttachmentsBase(STORAGE)).toBe(BASE);
        expect(resolveStorageAttachmentsBase(`${STORAGE}/`)).toBe(BASE);
        expect(resolveStorageAttachmentsBase(BASE)).toBe(BASE);
        expect(resolveStorageAttachmentsBase(`${BASE}/upload`)).toBe(BASE);
        expect(resolveStorageAttachmentsBase('')).toBe('');
    });

    it('builds the download route', () => {
        expect(client().fileDownloadUrl(JOB, 'att')).toBe(`${BASE}/jobs/${JOB}/files/att`);
    });
});

describe('listConversationFiles', () => {
    it("reads the conversation's files with the user's token, newest first", async () => {
        fetchMock.mockResolvedValue(respond(200, {
            code: 'CONVERSATION_FILES_LISTED',
            data: {
                conversation_uuid: CONVERSATION,
                files: [
                    wireFile({ uuid: 'old', created_at: '2026-10-01T00:00:00Z', source: 'upload', is_artifact: false, kind: null, title: null }),
                    wireFile({ uuid: 'new', created_at: '2026-10-13T00:00:00Z' }),
                ],
            },
        }));

        const { files, blocks } = await client().listConversationFiles(CONVERSATION);

        expect(blocks).toEqual([]);
        const [url, init] = lastCall();
        expect(url).toBe(`${BASE}/conversations/${CONVERSATION}`);
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer user-token');
        expect(files.map(file => file.attachment_uuid)).toEqual(['new', 'old']);
        expect(files[0]).toMatchObject({
            job_uuid: JOB,
            conversation_uuid: CONVERSATION,
            conversation_title: 'Inspection trends',
            is_artifact: true,
            artifact_kind: 'chart',
            title: 'Average score per month',
            has_spec: true,
            source: 'artifact',
            size_bytes: 2048,
            // Built from the configured URL, not the one the service saw itself as.
            download_url: `${BASE}/jobs/${JOB}/files/new`,
        });
        expect(files[1]).toMatchObject({ source: 'upload', is_artifact: false, artifact_kind: null, title: null });
    });

    it("rejects with the server's status and reason", async () => {
        fetchMock.mockResolvedValue(respond(404, { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found.' }));

        const failure = await client().listConversationFiles(CONVERSATION).catch(error => error);

        expect(failure).toBeInstanceOf(StorageRequestError);
        expect(failure).toMatchObject({ status: 404, code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found.' });
    });
});

describe('listArtifacts', () => {
    it('sends the page, the search and the kind, and reads the nested page', async () => {
        fetchMock.mockResolvedValue(respond(200, {
            data: {
                artifacts: {
                    items: [wireFile({ uuid: 'a1' }), wireFile({ uuid: 'a2', kind: 'table' })],
                    pagination: { total: 45, page: 2, per_page: 20, pages: 3 },
                },
            },
        }));

        const page = await client().listArtifacts({ limit: 20, offset: 20, q: '  scores ', kind: 'chart' });

        const url = new URL(lastCall()[0]);
        expect(`${url.origin}${url.pathname}`).toBe(`${BASE}/artifacts`);
        expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '20', offset: '20', q: 'scores', kind: 'chart' });
        expect(page.items.map(item => item.attachment_uuid)).toEqual(['a1', 'a2']);
        expect(page).toMatchObject({ total: 45, limit: 20, offset: 20, hasMore: true });
    });

    it('knows the last page from the total', async () => {
        fetchMock.mockResolvedValue(respond(200, {
            data: { artifacts: { items: [wireFile()], pagination: { total: 41 } } },
        }));
        const page = await client().listArtifacts({ limit: 20, offset: 40 });
        expect(page).toMatchObject({ total: 41, hasMore: false });
    });

    it('sends no search or kind it was not given, and guesses more from a full page without a total', async () => {
        fetchMock.mockResolvedValue(respond(200, { data: { items: [wireFile({ uuid: 'x' }), wireFile({ uuid: 'y' })] } }));
        const page = await client().listArtifacts({ limit: 2 });
        expect(Object.fromEntries(new URL(lastCall()[0]).searchParams)).toEqual({ limit: '2', offset: '0' });
        expect(page).toMatchObject({ total: null, hasMore: true });
    });
});

describe('listArtifacts — within what the storage API takes', () => {
    // It answers a limit over 100, a negative offset or a search over 200
    // characters with a 422, which the panel would show as "couldn't load".
    const page = () => respond(200, { data: { artifacts: { items: [], pagination: { total: 0 } } } });

    it('keeps the limit within 1..100 and the offset at 0 or more', async () => {
        fetchMock.mockResolvedValue(page());
        const result = await client().listArtifacts({ limit: 500, offset: -5 });
        expect(Object.fromEntries(new URL(lastCall()[0]).searchParams)).toEqual({ limit: '100', offset: '0' });
        expect(result.limit).toBe(100);

        await client().listArtifacts({ limit: 0, offset: 12.7 });
        expect(Object.fromEntries(new URL(lastCall()[0]).searchParams)).toEqual({ limit: '1', offset: '12' });

        await client().listArtifacts({ limit: Number.NaN });
        expect(new URL(lastCall()[0]).searchParams.get('limit')).toBe('20');
    });

    it('cuts the search at 200 characters, whole characters only', async () => {
        fetchMock.mockResolvedValue(page());
        await client().listArtifacts({ q: `  ${'a'.repeat(300)}  ` });
        expect(new URL(lastCall()[0]).searchParams.get('q')).toBe('a'.repeat(200));

        // 199 letters and an emoji (two UTF-16 units) are 200 characters: kept whole.
        await client().listArtifacts({ q: `${'b'.repeat(199)}😀tail` });
        expect(new URL(lastCall()[0]).searchParams.get('q')).toBe(`${'b'.repeat(199)}😀`);
    });
});

describe('prepareSpec — a spec the storage API keeps', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        warn.mockRestore();
    });

    it('sends an object, or a string holding one, compactly', () => {
        expect(prepareSpec({ type: 'bar', series: [1, 2] })).toBe('{"type":"bar","series":[1,2]}');
        expect(prepareSpec('{\n  "type": "bar"\n}')).toBe('{"type":"bar"}');
        expect(warn).not.toHaveBeenCalled();
    });

    it('keeps anything else as its text under `source`', () => {
        // Loosely written JSON a host's renderer repairs before drawing it.
        expect(JSON.parse(prepareSpec("{type: 'bar', title: 'T',}")!)).toEqual({ source: "{type: 'bar', title: 'T',}" });
        expect(JSON.parse(prepareSpec('[{"x":1}]')!)).toEqual({ source: '[{"x":1}]' });
        expect(JSON.parse(prepareSpec([1, 2])!)).toEqual({ source: '[1,2]' });
        expect(JSON.parse(prepareSpec(42)!)).toEqual({ source: '42' });
    });

    it('has nothing to send for nothing', () => {
        expect(prepareSpec(undefined)).toBeNull();
        expect(prepareSpec(null)).toBeNull();
        expect(prepareSpec('   ')).toBeNull();
    });

    it('leaves out, with a warning, a spec the storage API would refuse', () => {
        expect(prepareSpec({ data: 'x'.repeat(MAX_SPEC_BYTES) })).toBeNull();
        expect(prepareSpec({ label: 'a\u0000b' })).toBeNull();
        expect(prepareSpec({ ['k\uD800']: 1 })).toBeNull();
        let deep: Record<string, unknown> = { leaf: true };
        for (let level = 0; level < 70; level += 1) deep = { child: deep };
        expect(prepareSpec(deep)).toBeNull();
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(prepareSpec(circular)).toBeNull();
        expect(warn).toHaveBeenCalledTimes(5);
    });

    it('keeps text the storage API stores: an escaped backslash, a whole surrogate pair', () => {
        expect(prepareSpec({ label: 'a\\u0000b 😀' })).toBe(JSON.stringify({ label: 'a\\u0000b 😀' }));
    });
});

describe('saveFile', () => {
    it('posts the file and its description against the turn', async () => {
        fetchMock.mockResolvedValue(respond(201, {
            code: 'ARTIFACT_SAVED',
            data: { file: wireFile({ uuid: 'saved' }) },
        }));
        const png = new Blob(['png-bytes'], { type: 'image/png' });

        const saved = await client().saveFile(JOB, png, {
            title: '  Average\nscore per month ',
            kind: 'chart',
            spec: { type: 'line', title: 'Average score per month' },
            isArtifact: true,
        });

        const [url, init] = lastCall();
        expect(url).toBe(`${BASE}/jobs/${JOB}/files`);
        expect(init.method).toBe('POST');
        const form = init.body as FormData;
        expect((form.get('file') as File).name).toBe('Average score per month.png');
        expect(form.get('title')).toBe('Average score per month');
        expect(form.get('kind')).toBe('chart');
        expect(JSON.parse(form.get('spec') as string)).toEqual({ type: 'line', title: 'Average score per month' });
        expect(form.get('is_artifact')).toBe('true');
        expect(saved).toMatchObject({ attachment_uuid: 'saved', is_artifact: true, artifact_kind: 'chart' });
    });

    it('sends a string spec holding an object as that object, a file under its own name, and a generated file by default', async () => {
        fetchMock.mockResolvedValue(respond(201, {
            data: { file: wireFile({ source: 'generated', is_artifact: false, kind: null }) },
        }));
        const file = new File(['a,b'], 'rows.csv', { type: 'text/csv' });

        const saved = await client().saveFile(JOB, file, { spec: '{"type":"table"}' });

        const form = lastCall()[1].body as FormData;
        expect((form.get('file') as File).name).toBe('rows.csv');
        expect(form.get('spec')).toBe('{"type":"table"}');
        expect(form.get('is_artifact')).toBe('false');
        expect(form.get('title')).toBeNull();
        expect(saved).toMatchObject({ source: 'generated', is_artifact: false });
    });

    it('saves the file without a spec the storage API would refuse, rather than not at all', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        fetchMock.mockResolvedValue(respond(201, { data: { file: wireFile() } }));
        await client().saveFile(JOB, new Blob(['png'], { type: 'image/png' }), {
            spec: { rows: 'x'.repeat(MAX_SPEC_BYTES) },
            isArtifact: true,
        });
        const form = lastCall()[1].body as FormData;
        expect(form.get('spec')).toBeNull();
        expect(form.get('file')).not.toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('sends a fence body that is not a JSON object under `source`', async () => {
        fetchMock.mockResolvedValue(respond(201, { data: { file: wireFile() } }));
        await client().saveFile(JOB, new Blob(['png'], { type: 'image/png' }), { spec: "{type:'bar'}", isArtifact: true });
        expect(JSON.parse((lastCall()[1].body as FormData).get('spec') as string)).toEqual({ source: "{type:'bar'}" });
    });

    it('caps the title at the 255 characters the platform keeps', async () => {
        fetchMock.mockResolvedValue(respond(201, { data: { file: wireFile() } }));
        await client().saveFile(JOB, new Blob(['x'], { type: 'text/plain' }), { title: 'x'.repeat(300) });
        expect((lastCall()[1].body as FormData).get('title')).toHaveLength(255);
    });

    it('needs a turn to save against', async () => {
        await expect(client().saveFile('', new Blob(['x']))).rejects.toBeInstanceOf(StorageRequestError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects with the server's validation message", async () => {
        fetchMock.mockResolvedValue(respond(422, {
            code: 'ATTACHMENT_VALIDATION_FAILED',
            message: 'Unsupported content type: image/svg+xml',
        }));
        await expect(client().saveFile(JOB, new Blob(['<svg/>'], { type: 'image/svg+xml' })))
            .rejects.toMatchObject({ status: 422, message: 'Unsupported content type: image/svg+xml' });
    });

    it("reads FastAPI's own validation detail too", async () => {
        fetchMock.mockResolvedValue(respond(422, { detail: [{ msg: 'Field required' }] }));
        await expect(client().saveFile(JOB, new Blob(['x']))).rejects.toMatchObject({ message: 'Field required' });
    });
});

describe('saveFile — a turn the storage API does not know yet', () => {
    // Review of 2026-10-14: Save is clickable as soon as the stream names the
    // turn, and the platform writes the turn's row a moment later. A save in
    // between was answered 404 JOB_NOT_FOUND and failed outright.
    const notStoredYet = () => respond(404, { code: 'JOB_NOT_FOUND', message: 'Job not found or not owned by user.' });

    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('waits 3 s in all, over three more tries', () => {
        expect(SAVE_RETRY_DELAYS_MS).toEqual([500, 1000, 1500]);
    });

    it('tries again while the turn is not stored, and saves the same file once it is', async () => {
        fetchMock
            .mockResolvedValueOnce(notStoredYet())
            .mockResolvedValueOnce(notStoredYet())
            .mockResolvedValueOnce(respond(201, { data: { file: wireFile({ uuid: 'late' }) } }));

        const saving = client().saveFile(JOB, new Blob(['png'], { type: 'image/png' }), { title: 'Scores', isArtifact: true });
        await vi.advanceTimersByTimeAsync(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(499);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1000);
        expect(fetchMock).toHaveBeenCalledTimes(3);

        await expect(saving).resolves.toMatchObject({ attachment_uuid: 'late' });
        for (const [url, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
            expect(url).toBe(`${BASE}/jobs/${JOB}/files`);
            const form = init.body as FormData;
            expect((form.get('file') as File).name).toBe('Scores.png');
            expect(form.get('is_artifact')).toBe('true');
        }
    });

    it('rejects with the 404 when the turn is still unknown after the last try', async () => {
        fetchMock.mockImplementation(async () => notStoredYet());
        const saving = client().saveFile(JOB, new Blob(['x'], { type: 'text/plain' }));
        const outcome = expect(saving).rejects.toMatchObject({ status: 404, code: 'JOB_NOT_FOUND' });

        await vi.advanceTimersByTimeAsync(2999);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(1);
        await outcome;
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('rejects at once on any other refusal, a 404 of another kind included', async () => {
        fetchMock
            .mockResolvedValueOnce(respond(404, { detail: 'Not Found' }))
            .mockResolvedValueOnce(respond(422, { code: 'ATTACHMENT_VALIDATION_FAILED', message: 'File is empty.' }))
            .mockResolvedValueOnce(respond(503, { code: 'ATTACHMENT_STORAGE_UNAVAILABLE', message: 'Attachment storage is temporarily unavailable.' }));

        await expect(client().saveFile(JOB, new Blob(['x']))).rejects.toMatchObject({ status: 404, code: null });
        await expect(client().saveFile(JOB, new Blob(['x']))).rejects.toMatchObject({ status: 422 });
        await expect(client().saveFile(JOB, new Blob(['x']))).rejects.toMatchObject({ status: 503 });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});

describe('getArtifact and deleteArtifact', () => {
    it('reads one artifact with the source it was drawn from', async () => {
        fetchMock.mockResolvedValue(respond(200, {
            data: { artifact: { ...wireFile({ uuid: 'one' }), spec: { type: 'line' } } },
        }));
        const artifact = await client().getArtifact('one');
        expect(lastCall()[0]).toBe(`${BASE}/artifacts/one`);
        expect(artifact).toMatchObject({ attachment_uuid: 'one', spec: { type: 'line' } });
    });

    it('deletes, taking the empty 204 as success', async () => {
        fetchMock.mockResolvedValue(respond(204));
        await client().deleteArtifact('one');
        const [url, init] = lastCall();
        expect(url).toBe(`${BASE}/artifacts/one`);
        expect(init.method).toBe('DELETE');
    });

    it('rejects a refused delete', async () => {
        fetchMock.mockResolvedValue(respond(404, { code: 'ARTIFACT_NOT_FOUND', message: 'Artifact not found.' }));
        await expect(client().deleteArtifact('upload')).rejects.toMatchObject({ status: 404, code: 'ARTIFACT_NOT_FOUND' });
    });
});

describe('fetchFile', () => {
    it("fetches a file's bytes with the token", async () => {
        fetchMock.mockResolvedValue(respond(200));
        const file = normalizeConversationFile(wireFile({ uuid: 'f' }), (job, id) => `${BASE}/jobs/${job}/files/${id}`)!;
        const blob = await client().fetchFile(file);
        expect(lastCall()[0]).toBe(`${BASE}/jobs/${JOB}/files/f`);
        expect((lastCall()[1].headers as Record<string, string>).Authorization).toBe('Bearer user-token');
        expect(blob).toBeInstanceOf(Blob);
    });
});

describe('without credentials', () => {
    it('refuses before asking the server', async () => {
        const anonymous = new StorageClient({ storageApiUrl: STORAGE, token: null });
        await expect(anonymous.listConversationFiles(CONVERSATION)).rejects.toMatchObject({ status: 401 });
        const nowhere = new StorageClient({ storageApiUrl: '', token: 'user-token' });
        await expect(nowhere.listArtifacts()).rejects.toMatchObject({ status: 0 });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports an unreachable service as status 0', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(client().listArtifacts()).rejects.toMatchObject({ status: 0 });
    });
});

describe('normalizeConversationFile', () => {
    const url = (job: string, id: string) => `${job}/${id}`;

    it('takes the platform names and the obvious alternatives', () => {
        expect(normalizeConversationFile({
            attachment_uuid: 'a', job_uuid: 'j', artifact_kind: 'kpi', is_artifact: true, size: 10, filename: 'k.png',
        }, url)).toMatchObject({ attachment_uuid: 'a', artifact_kind: 'kpi', size_bytes: 10, source: 'artifact', download_url: 'j/a' });
    });

    it('shows an unknown kind as a file, and an artifact without one as a file', () => {
        expect(normalizeConversationFile({ uuid: 'a', job_uuid: 'j', kind: 'gauge', is_artifact: true }, url)!.artifact_kind).toBe('file');
        expect(normalizeConversationFile({ uuid: 'a', job_uuid: 'j', is_artifact: true }, url)!.artifact_kind).toBe('file');
        expect(normalizeConversationFile({ uuid: 'a', job_uuid: 'j' }, url)).toMatchObject({ artifact_kind: null, source: 'upload', filename: 'file' });
    });

    it('drops an entry that cannot be downloaded', () => {
        expect(normalizeConversationFile({ uuid: 'a' }, url)).toBeNull();
        expect(normalizeConversationFile({ job_uuid: 'j' }, url)).toBeNull();
        expect(normalizeConversationFile(null, url)).toBeNull();
    });
});

// --- Saved and not saved (2026-10-14) -----------------------------------------

const TURN = '44444444-4444-4444-8444-444444444444';
const SUB_JOB = '55555555-5555-4555-8555-555555555555';

function wireBlock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        uuid: '66666666-6666-4666-8666-666666666666',
        job_uuid: TURN,
        turn_job_uuid: TURN,
        conversation_uuid: CONVERSATION,
        conversation_title: 'Inspection trends',
        language: 'chart',
        kind: 'chart',
        block_key: '1abc2de',
        title: 'Average score per month',
        position: 0,
        created_at: '2026-10-14T09:00:00Z',
        saved: false,
        artifact_uuids: [],
        ...overrides,
    };
}

describe('listConversationFiles — files and blocks', () => {
    it('reads the blocks the platform indexed beside the files, with the new file fields', async () => {
        fetchMock.mockResolvedValue(respond(200, {
            code: 'CONVERSATION_FILES_LISTED',
            data: {
                conversation_uuid: CONVERSATION,
                files: [
                    wireFile({ uuid: 'art', block_key: '1abc2de' }),
                    wireFile({ uuid: 'gen', source: 'generated', is_artifact: false, kind: null, saved: true }),
                    wireFile({ uuid: 'copy', saved_from_uuid: 'gen', kind: 'file' }),
                    wireFile({ uuid: 'up', source: 'upload', is_artifact: false, kind: null, saved: true }),
                ],
                blocks: [
                    wireBlock({ saved: true, artifact_uuids: ['art'] }),
                    wireBlock({ uuid: 'sub', job_uuid: SUB_JOB, language: 'gauge', kind: null, block_key: 'zz', title: null, position: 1 }),
                    { uuid: 'broken' },
                ],
            },
        }));

        const { conversation_uuid, files, blocks } = await client().listConversationFiles(CONVERSATION);

        expect(conversation_uuid).toBe(CONVERSATION);
        const byId = Object.fromEntries(files.map(file => [file.attachment_uuid, file]));
        expect(byId.art).toMatchObject({ saved: true, block_key: '1abc2de', saved_from_uuid: null });
        expect(byId.gen).toMatchObject({ source: 'generated', saved: true });
        expect(byId.copy).toMatchObject({ saved: true, saved_from_uuid: 'gen' });
        // An upload is never saved, whatever the server says.
        expect(byId.up).toMatchObject({ source: 'upload', saved: false });

        expect(blocks).toHaveLength(2);
        expect(blocks[0]).toEqual({
            uuid: '66666666-6666-4666-8666-666666666666',
            job_uuid: TURN,
            turn_job_uuid: TURN,
            conversation_uuid: CONVERSATION,
            conversation_title: 'Inspection trends',
            language: 'chart',
            kind: 'chart',
            block_key: '1abc2de',
            title: 'Average score per month',
            position: 0,
            created_at: '2026-10-14T09:00:00Z',
            saved: true,
            artifact_uuids: ['art'],
        });
        // A sub-agent's block: its own job, its turn's; a language that is no kind has none.
        expect(blocks[1]).toMatchObject({ job_uuid: SUB_JOB, turn_job_uuid: TURN, kind: null, title: null, position: 1 });
    });

    it('reads a conversation without blocks, from a platform before them, as having none', async () => {
        fetchMock.mockResolvedValue(respond(200, { data: { files: [wireFile()] } }));
        const contents = await client().listConversationFiles(CONVERSATION);
        expect(contents.blocks).toEqual([]);
        expect(contents.conversation_uuid).toBe(CONVERSATION);
        expect(contents.files).toHaveLength(1);
    });
});

describe('listArtifactEntries', () => {
    const page = (items: unknown[], total: number) => respond(200, {
        code: 'ARTIFACT_ENTRIES_LISTED',
        data: { artifact_entries: { items, pagination: { total, page: 1, per_page: 20, pages: 1 } } },
    });

    it('asks for one status, kind and search, and reads saved files, not-saved blocks and generated files', async () => {
        const block = wireBlock();
        const generated = wireFile({ uuid: 'gen', source: 'generated', is_artifact: false, kind: null, title: null, filename: 'rows.xlsx' });
        fetchMock.mockResolvedValue(page([
            {
                id: 'file:art', type: 'file', saved: true, kind: 'chart', title: 'Scores', created_at: '2026-10-14T10:00:00Z',
                job_uuid: JOB, conversation_uuid: CONVERSATION, conversation_title: 'Inspection trends',
                file: wireFile({ uuid: 'art' }), block: null,
            },
            {
                id: `block:${block.uuid}`, type: 'block', saved: false, kind: 'chart', title: 'Average score per month',
                created_at: '2026-10-14T09:00:00Z', job_uuid: TURN, conversation_uuid: CONVERSATION,
                conversation_title: 'Inspection trends', file: null, block,
            },
            {
                id: 'file:gen', type: 'file', saved: false, kind: 'file', title: 'rows.xlsx', created_at: '2026-10-14T08:00:00Z',
                job_uuid: JOB, conversation_uuid: CONVERSATION, conversation_title: 'Inspection trends', file: generated, block: null,
            },
        ], 3));

        const result = await client().listArtifactEntries({ status: 'all', kind: 'chart', q: '  scores ', limit: 20, offset: 0 });

        const url = new URL(lastCall()[0]);
        expect(url.pathname).toBe('/api/v1/attachments/artifact-entries');
        expect(Object.fromEntries(url.searchParams)).toEqual({ status: 'all', limit: '20', offset: '0', q: 'scores', kind: 'chart' });
        expect((lastCall()[1].headers as Record<string, string>).Authorization).toBe('Bearer user-token');
        expect(result).toMatchObject({ total: 3, limit: 20, offset: 0, hasMore: false });
        expect(result.items.map(item => [item.id, item.type, item.saved, item.kind])).toEqual([
            ['file:art', 'file', true, 'chart'],
            [`block:${block.uuid}`, 'block', false, 'chart'],
            ['file:gen', 'file', false, 'file'],
        ]);
        expect(result.items[0].file).toMatchObject({ attachment_uuid: 'art', download_url: `${BASE}/jobs/${JOB}/files/art` });
        expect(result.items[1]).toMatchObject({ job_uuid: TURN, file: null, block: { uuid: block.uuid, turn_job_uuid: TURN } });
        expect(result.items[2].file).toMatchObject({ source: 'generated', saved: false });
    });

    it('defaults to every status, and keeps the query within what the storage API takes', async () => {
        fetchMock.mockResolvedValue(page([], 0));

        await client().listArtifactEntries();
        expect(Object.fromEntries(new URL(lastCall()[0]).searchParams)).toEqual({ status: 'all', limit: '20', offset: '0' });

        await client().listArtifactEntries({ status: 'unsaved', limit: 500, offset: -3, q: 'x'.repeat(250) });
        const params = new URL(lastCall()[0]).searchParams;
        expect(params.get('status')).toBe('unsaved');
        expect(params.get('limit')).toBe('100');
        expect(params.get('offset')).toBe('0');
        expect(params.get('q')).toHaveLength(200);

        await client().listArtifactEntries({ status: 'archived' as never, limit: 0 });
        expect(new URL(lastCall()[0]).searchParams.get('status')).toBe('all');
        expect(new URL(lastCall()[0]).searchParams.get('limit')).toBe('1');
    });

    // Review of 2026-10-14: both are a 422 VALIDATION_ERROR from the storage
    // API, which the Artifacts view would show as "couldn't load".
    it('drops a NUL from the search, and answers a page past the furthest offset empty without asking', async () => {
        fetchMock.mockResolvedValue(page([], 0));

        await client().listArtifactEntries({ q: 'pu\u0000mps\u0000' });
        expect(new URL(lastCall()[0]).searchParams.get('q')).toBe('pumps');
        await client().listArtifacts({ q: '\u0000' });
        expect(new URL(lastCall()[0]).searchParams.has('q')).toBe(false);

        await client().listArtifactEntries({ offset: MAX_ARTIFACT_OFFSET });
        expect(new URL(lastCall()[0]).searchParams.get('offset')).toBe(String(MAX_ARTIFACT_OFFSET));
        const calls = fetchMock.mock.calls.length;
        expect(await client().listArtifactEntries({ offset: MAX_ARTIFACT_OFFSET + 1, limit: 10 }))
            .toEqual({ items: [], total: null, limit: 10, offset: MAX_ARTIFACT_OFFSET + 1, hasMore: false });
        expect(await client().listArtifacts({ offset: Number.MAX_SAFE_INTEGER }))
            .toMatchObject({ items: [], hasMore: false });
        expect(fetchMock.mock.calls.length).toBe(calls);
    });

    it('knows there is more from the total, or from a full page without one', async () => {
        fetchMock.mockResolvedValue(page([{ id: 'file:a', type: 'file', saved: true, file: wireFile({ uuid: 'a' }) }], 5));
        expect((await client().listArtifactEntries({ limit: 1 })).hasMore).toBe(true);

        fetchMock.mockResolvedValue(respond(200, { data: { artifact_entries: { items: [
            { id: 'file:a', type: 'file', saved: true, file: wireFile({ uuid: 'a' }) },
        ] } } }));
        const guessed = await client().listArtifactEntries({ limit: 1 });
        expect(guessed).toMatchObject({ total: null, hasMore: true });
    });

    it("rejects with the server's status, code and reason", async () => {
        fetchMock.mockResolvedValue(respond(422, {
            code: 'VALIDATION_ERROR', message: 'q may not contain NUL.', error: { fields: { q: 'invalid' } },
        }));
        await expect(client().listArtifactEntries({ q: 'a' })).rejects.toMatchObject({
            status: 422, code: 'VALIDATION_ERROR', message: 'q may not contain NUL.',
        });
    });
});

describe('getBlock', () => {
    it('reads one block with the body to draw it from', async () => {
        fetchMock.mockResolvedValue(respond(200, {
            code: 'BLOCK_LOADED',
            data: { block: { ...wireBlock(), source: '{"type":"line",\r\n"title":"Scores"}' } },
        }));

        const block = await client().getBlock('66666666-6666-4666-8666-666666666666');

        expect(lastCall()[0]).toBe(`${BASE}/blocks/66666666-6666-4666-8666-666666666666`);
        expect(block).toMatchObject({ turn_job_uuid: TURN, language: 'chart', block_key: '1abc2de' });
        // As the renderer reads a body: `\n` line endings.
        expect(block.source).toBe('{"type":"line",\n"title":"Scores"}');
    });

    it("rejects with 404 BLOCK_NOT_FOUND for another user's block, and when there is no body", async () => {
        fetchMock.mockResolvedValue(respond(404, { code: 'BLOCK_NOT_FOUND', message: 'Block not found.' }));
        await expect(client().getBlock('x')).rejects.toMatchObject({ status: 404, code: 'BLOCK_NOT_FOUND' });

        fetchMock.mockResolvedValue(respond(200, { data: { block: wireBlock() } }));
        await expect(client().getBlock('x')).rejects.toBeInstanceOf(StorageRequestError);
    });
});

describe('saveGeneratedFile', () => {
    it('asks the storage API to copy the file into an artifact, and reads the copy', async () => {
        fetchMock.mockResolvedValue(respond(201, {
            code: 'ARTIFACT_SAVED',
            data: { file: wireFile({ uuid: 'copy', kind: 'file', saved_from_uuid: 'gen', filename: 'rows.xlsx' }) },
        }));

        const copy = await client().saveGeneratedFile('gen');

        const [url, init] = lastCall();
        expect(url).toBe(`${BASE}/files/gen/save`);
        expect(init.method).toBe('POST');
        expect(init.body).toBeUndefined();
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer user-token');
        expect(copy).toMatchObject({ attachment_uuid: 'copy', is_artifact: true, saved: true, saved_from_uuid: 'gen' });
    });

    it('resolves to the existing copy of a file saved before', async () => {
        fetchMock.mockResolvedValue(respond(200, {
            code: 'ARTIFACT_ALREADY_SAVED',
            data: { file: wireFile({ uuid: 'copy', saved_from_uuid: 'gen' }) },
        }));
        await expect(client().saveGeneratedFile('gen')).resolves.toMatchObject({ attachment_uuid: 'copy' });
    });

    it('rejects an upload or an artifact (409 NOT_GENERATED) and a file that is not the user\'s (404) at once', async () => {
        fetchMock.mockResolvedValueOnce(respond(409, { code: 'NOT_GENERATED', message: 'Only a generated file can be saved.' }));
        await expect(client().saveGeneratedFile('up')).rejects.toMatchObject({ status: 409, code: 'NOT_GENERATED' });

        fetchMock.mockResolvedValueOnce(respond(404, { code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found.' }));
        await expect(client().saveGeneratedFile('theirs')).rejects.toMatchObject({ status: 404, code: 'ATTACHMENT_NOT_FOUND' });
        expect(fetchMock).toHaveBeenCalledTimes(2);

        await expect(client().saveGeneratedFile('')).rejects.toMatchObject({ status: 0 });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('saveFile — a drawn block saved as an artifact', () => {
    const saved = () => respond(201, { code: 'ARTIFACT_SAVED', data: { file: wireFile({ block_key: '1abc2de' }) } });

    it("sends the block's key with an artifact", async () => {
        fetchMock.mockResolvedValue(saved());

        const stored = await client().saveFile(TURN, new Blob(['png'], { type: 'image/png' }), {
            isArtifact: true, kind: 'chart', blockKey: '1abc2de',
        });

        const form = lastCall()[1].body as FormData;
        expect(lastCall()[0]).toBe(`${BASE}/jobs/${TURN}/files`);
        expect(form.get('block_key')).toBe('1abc2de');
        expect(form.get('is_artifact')).toBe('true');
        expect(stored.block_key).toBe('1abc2de');
    });

    it('leaves out, with a warning, a key on a file that is no artifact, or one the storage API would refuse', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        fetchMock.mockResolvedValue(saved());

        await client().saveFile(TURN, new Blob(['a']), { blockKey: '1abc2de' });
        expect((lastCall()[1].body as FormData).has('block_key')).toBe(false);

        await client().saveFile(TURN, new Blob(['a']), { isArtifact: true, blockKey: 'NOT-A-KEY' });
        expect((lastCall()[1].body as FormData).has('block_key')).toBe(false);
        expect(warn).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });
});

describe('normalizeBlockRecord and normalizeArtifactEntry', () => {
    const url = (job: string, id: string) => `${job}/${id}`;

    it("takes a block without a turn as its job's own, and drops one without its identity", () => {
        expect(normalizeBlockRecord({ uuid: 'b', job_uuid: 'j', language: 'table', block_key: 'k' }))
            .toMatchObject({ job_uuid: 'j', turn_job_uuid: 'j', kind: 'table', saved: false, artifact_uuids: [], title: null });
        expect(normalizeBlockRecord({ uuid: 'b', job_uuid: 'j', language: 'chart' })).toBeNull();
        expect(normalizeBlockRecord({ uuid: 'b', block_key: 'k', language: 'chart' })).toBeNull();
        expect(normalizeBlockRecord(null)).toBeNull();
    });

    it('takes a block whose artifacts are named as saved', () => {
        expect(normalizeBlockRecord({ uuid: 'b', job_uuid: 'j', language: 'kpi', block_key: 'k', artifact_uuids: ['a'] })!.saved).toBe(true);
    });

    it('reads an entry by its id when it names no type, and drops one without its record', () => {
        expect(normalizeArtifactEntry({ id: 'block:b', block: { uuid: 'b', job_uuid: 'j', language: 'chart', block_key: 'k' } }, url))
            .toMatchObject({ type: 'block', saved: false, kind: 'chart', job_uuid: 'j' });
        expect(normalizeArtifactEntry({ id: 'file:f', type: 'file', file: { uuid: 'f', job_uuid: 'j', is_artifact: true } }, url))
            .toMatchObject({ type: 'file', saved: true, kind: 'file', title: 'file' });
        expect(normalizeArtifactEntry({ id: 'file:f', type: 'file', file: null }, url)).toBeNull();
        expect(normalizeArtifactEntry('nonsense', url)).toBeNull();
    });
});
