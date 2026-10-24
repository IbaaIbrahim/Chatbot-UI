import { netFetch } from '../common/localNetwork';
import type { LabelKey } from '../common/labels';
import type { LabelledError } from '../common/i18n';
import { resolveStorageAttachmentsBase } from '../common/attachmentUtils';
import type {
    ArtifactEntry,
    ArtifactEntryPage,
    ArtifactEntryQuery,
    ArtifactKind,
    ArtifactListQuery,
    ArtifactPage,
    ArtifactStatus,
    BlockRecord,
    BlockWithSource,
    ConversationContents,
    ConversationFile,
    ConversationFileSource,
    SaveFileOptions,
} from './types';

/** The kinds the library draws an icon and a filter chip for; any other is shown as `file`. */
export const ARTIFACT_KINDS: readonly ArtifactKind[] = ['chart', 'table', 'kpi', 'report', 'file'];

/** The saved states the Artifacts list filters by (`listArtifactEntries`' `status`). */
export const ARTIFACT_STATUSES: readonly ArtifactStatus[] = ['all', 'saved', 'unsaved'];

/** The kinds a block can be: a block's kind is its language, when it is one of these. */
const BLOCK_KINDS: readonly ArtifactKind[] = ['chart', 'table', 'kpi', 'report'];

/** A `blockKey` as the storage API takes it: base 36, at most seven characters (a 32-bit hash). */
const BLOCK_KEY_PATTERN = /^[0-9a-z]{1,7}$/;

const FILE_SOURCES: readonly ConversationFileSource[] = ['upload', 'generated', 'artifact'];

const DEFAULT_PAGE_SIZE = 20;

/** The most artifacts the storage API returns per page (`limit` is `1..100`). */
export const MAX_ARTIFACT_PAGE_SIZE = 100;

/** The longest search the storage API takes (`q`, 200 characters); a longer one is a 422. */
export const MAX_ARTIFACT_SEARCH_CHARS = 200;

/**
 * The furthest `offset` the storage API pages to (`0..1,000,000`); past it a
 * listing is a 422. A page asked for beyond it is answered empty, here.
 */
export const MAX_ARTIFACT_OFFSET = 1_000_000;

/** The largest `spec` the storage API keeps: 256 KiB of UTF-8 JSON. */
export const MAX_SPEC_BYTES = 256 * 1024;

/** How deeply a `spec` may nest objects and arrays before the storage API refuses it. */
const MAX_SPEC_DEPTH = 64;

/** `job_attachments.title` is VARCHAR(255). */
const MAX_TITLE_CHARS = 255;

/**
 * How long `saveFile` waits before each new try while the storage API does
 * not know the turn yet (404 `JOB_NOT_FOUND`): three more tries, 3 s in all.
 */
export const SAVE_RETRY_DELAYS_MS: readonly number[] = [500, 1000, 1500];

export interface StorageClientConfig {
    /**
     * The storage API — its base URL (`https://storage.example`), its
     * attachments root (`…/api/v1/attachments`) or the upload URL; all three
     * resolve to the same routes.
     */
    storageApiUrl: string;
    /** The user's bearer token, the same one the composer uploads with. */
    token?: string | null;
}

/**
 * A refused or failed storage request. `status` is 0 when it never reached the
 * server.
 *
 * `message` is for a developer — the storage API's own words, or "Storage API
 * unreachable: TypeError: Failed to fetch". What a person should read is the
 * label it names (`labelKey`, a `LabelledError` since 4.2): show it with
 * `describeLabelledError(error, useLabels(), useChatLanguage())`, in the
 * chat's language.
 */
export class StorageRequestError extends Error implements LabelledError {
    status: number;
    code: string | null;
    labelKey: LabelKey;
    labelValues?: Record<string, string | number>;

    constructor(
        message: string,
        status: number,
        code: string | null = null,
        labelKey: LabelKey = 'storageRequestFailed',
        labelValues: Record<string, string | number> = { status },
    ) {
        super(message);
        this.name = 'StorageRequestError';
        this.status = status;
        this.code = code;
        this.labelKey = labelKey;
        this.labelValues = labelValues;
    }
}

/**
 * The storage API's conversation files and artifacts, for the signed-in user.
 *
 * Every file here is stored against a **turn** (`job_attachments`): the user's
 * uploads arrive with the message they were sent with, and a host saves a file
 * against the turn whose answer produced it (`saveFile(jobUuid, …)`). That is
 * what makes ownership checkable on the server — a turn belongs to one user's
 * conversation — and what lets the conversation's files panel list them all.
 *
 * Built by the provider from its `storageApiUrl` and `accessToken`
 * (`useStorageClient()`), the same pair the composer uploads with; a host can
 * also build its own. Every read needs the token: the routes are
 * authenticated, so a file is fetched (`fetchFile`) or downloaded
 * (`downloadFile`) through here, never opened as a plain link.
 *
 * The response bodies are read leniently: field names are the platform's
 * (`attachment_uuid`, `artifact_kind`, `size_bytes`), with the obvious
 * alternatives (`uuid`, `kind`, `size`) accepted, and the download URL is
 * always built here from the configured base rather than taken from the
 * response, which names the service as it sees itself behind a proxy.
 */
export class StorageClient {
    private base: string;
    private token: string | null;

    constructor(config: StorageClientConfig) {
        this.base = resolveStorageAttachmentsBase(config.storageApiUrl);
        this.token = config.token ?? null;
    }

    setToken(token: string | null): void {
        this.token = token;
    }

    /** The attachments root every route below hangs off. */
    get attachmentsBase(): string {
        return this.base;
    }

    /** The authenticated download route for one file. */
    fileDownloadUrl(jobUuid: string, attachmentUuid: string): string {
        return `${this.base}/jobs/${encodeURIComponent(jobUuid)}/files/${encodeURIComponent(attachmentUuid)}`;
    }

    /**
     * Everything one of the user's conversations holds: its files — uploads,
     * generated files and artifacts, from all its turns — newest first, and
     * the blocks its answers drew (indexed when each turn ended), oldest turn
     * first and in order within a turn, sub-agents' included. Rejects with
     * status 404 (`CONVERSATION_NOT_FOUND`) for a conversation that is not the
     * user's, or that they deleted.
     *
     * The same block drawn twice is listed twice, and a turn still under way
     * has none yet: a caller showing blocks dedupes them by
     * `(turn_job_uuid, block_key)`, as the files panel does with the blocks it
     * finds in the transcript. Until 2026-10-14 this resolved to the files alone.
     */
    async listConversationFiles(conversationId: string): Promise<ConversationContents> {
        const data = unwrap(await this.requestJson(`/conversations/${encodeURIComponent(conversationId)}`));
        const files = newestFirst(this.normalizeList(listOf(data)));
        const rawBlocks = data && typeof data === 'object' ? (data as Record<string, unknown>).blocks : undefined;
        const blocks = Array.isArray(rawBlocks)
            ? rawBlocks.map(normalizeBlockRecord).filter((block): block is BlockRecord => block !== null)
            : [];
        const ownId = data && typeof data === 'object' ? text((data as Record<string, unknown>).conversation_uuid) : '';
        return { conversation_uuid: ownId || conversationId, files, blocks };
    }

    /**
     * One page of the user's artifacts, from every conversation, newest first.
     *
     * The query is brought within what the storage API takes rather than sent
     * as given, because it answers anything outside with a 422 that would read
     * as "couldn't load": `limit` to `1..100`, `offset` to `0` or more — a
     * page past {@link MAX_ARTIFACT_OFFSET} is empty, without a request — and
     * the search without NUL characters, to its first 200 characters. The page
     * reports the `limit` sent.
     */
    async listArtifacts(query: ArtifactListQuery = {}): Promise<ArtifactPage> {
        const limit = clampInteger(query.limit, 1, MAX_ARTIFACT_PAGE_SIZE, DEFAULT_PAGE_SIZE);
        const offset = clampInteger(query.offset, 0, Number.MAX_SAFE_INTEGER, 0);
        if (offset > MAX_ARTIFACT_OFFSET) return { items: [], total: null, limit, offset, hasMore: false };
        const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
        const search = clipSearch(query.q);
        if (search) params.set('q', search);
        if (query.kind) params.set('kind', query.kind);

        // `{ data: { artifacts: { items, pagination } } }` — the page is nested
        // under its name, as the Gateway nests its conversation list.
        const data = unwrap(await this.requestJson(`/artifacts?${params.toString()}`));
        const page = pickObject(data, ['artifacts', 'page']) ?? data;
        const items = this.normalizeList(listOf(page));
        const total = totalOf(page);
        return {
            items,
            total,
            limit,
            offset,
            hasMore: total !== null ? offset + items.length < total : items.length >= limit,
        };
    }

    /**
     * One page of the user's artifacts across conversations, **saved and not**,
     * newest first (2026-10-14): `status` `saved` — what the user saved (the
     * artifact rows); `unsaved` — the blocks the agent drew and the files it
     * generated that nobody saved; `all` (the default) — both. A saved block
     * is listed as its artifact file; a not-saved one as the block, which a
     * host's renderer draws again from `getBlock(uuid).source`.
     *
     * Brought within what the storage API takes, as {@link listArtifacts} is:
     * `limit` to `1..100`, `offset` to `0` or more (a page past
     * {@link MAX_ARTIFACT_OFFSET} empty, without a request), the search
     * without NUL characters and to its first 200 characters, and an unknown
     * `status` read as `all`.
     */
    async listArtifactEntries(query: ArtifactEntryQuery = {}): Promise<ArtifactEntryPage> {
        const limit = clampInteger(query.limit, 1, MAX_ARTIFACT_PAGE_SIZE, DEFAULT_PAGE_SIZE);
        const offset = clampInteger(query.offset, 0, Number.MAX_SAFE_INTEGER, 0);
        if (offset > MAX_ARTIFACT_OFFSET) return { items: [], total: null, limit, offset, hasMore: false };
        const status: ArtifactStatus = query.status && ARTIFACT_STATUSES.includes(query.status) ? query.status : 'all';
        const params = new URLSearchParams({ status, limit: String(limit), offset: String(offset) });
        const search = clipSearch(query.q);
        if (search) params.set('q', search);
        if (query.kind) params.set('kind', query.kind);

        // `{ data: { artifact_entries: { items, pagination } } }`.
        const data = unwrap(await this.requestJson(`/artifact-entries?${params.toString()}`));
        const page = pickObject(data, ['artifact_entries', 'entries', 'page']) ?? data;
        const items = listOf(page)
            .map(item => normalizeArtifactEntry(item, (job, attachment) => this.fileDownloadUrl(job, attachment)))
            .filter((item): item is ArtifactEntry => item !== null);
        const total = totalOf(page);
        return {
            items,
            total,
            limit,
            offset,
            hasMore: total !== null ? offset + items.length < total : items.length >= limit,
        };
    }

    /**
     * One block the platform indexed, with its body — to draw it again with
     * the host's renderer (the Artifacts view, the files panel). Rejects with
     * status 404 (`BLOCK_NOT_FOUND`) for a block that is not the user's, or
     * whose conversation they deleted.
     */
    async getBlock(blockUuid: string): Promise<BlockWithSource> {
        const data = unwrap(await this.requestJson(`/blocks/${encodeURIComponent(blockUuid)}`));
        const raw = pickObject(data, ['block']) ?? data;
        const block = normalizeBlockRecord(raw);
        const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).source : undefined;
        if (!block || typeof source !== 'string') {
            throw new StorageRequestError('The storage API did not describe the block.', 200, null, 'storageBadResponse');
        }
        return { ...block, source: normalizeLineBreaks(source) };
    }

    /**
     * Save a **generated** file (an export) as an artifact: the storage API
     * copies it, server-side, into an artifact of its own (`saved_from_uuid`
     * names the file), listed under "Artifacts". Resolves to that artifact —
     * the one already made, when the file was saved before (200
     * `ARTIFACT_ALREADY_SAVED`). Rejects with 409 `NOT_GENERATED` for an
     * upload or an artifact, and 404 `ATTACHMENT_NOT_FOUND` for a file that is
     * not the user's.
     */
    async saveGeneratedFile(attachmentUuid: string): Promise<ConversationFile> {
        if (!attachmentUuid) {
            throw new StorageRequestError('No file was named to save.', 0, null, 'saveFileFailed');
        }
        const data = unwrap(await this.requestJson(`/files/${encodeURIComponent(attachmentUuid)}/save`, { method: 'POST' }));
        const stored = this.normalize(pickObject(data, ['file', 'artifact', 'attachment']) ?? data);
        if (!stored) {
            throw new StorageRequestError('The storage API saved the file but did not describe it.', 200, null, 'storageBadResponse');
        }
        return stored;
    }

    /**
     * Store a file in the conversation, against the turn `jobUuid`.
     *
     * With `isArtifact: true` it is an artifact — the user chose to keep it,
     * and it is listed under "Artifacts" as well as in the conversation's files.
     * Without, it is a generated file of the conversation (an export). Resolves
     * to the stored file; rejects with the server's reason (a type it does not
     * take, a size over its limit, a turn that is not the user's).
     *
     * The `spec` is sent the way the storage API keeps it — one JSON object —
     * and never costs the file: see {@link prepareSpec}. An artifact saved from
     * a drawn block carries the block's key (`blockKey`, sent as `block_key`),
     * which marks the block "Saved"; a key the storage API would refuse is left
     * out with a console warning rather than costing the save.
     *
     * A turn the storage API does not know yet is asked about again: a block's
     * Save is clickable as soon as the stream names the turn, and the platform
     * writes the turn's row a moment after. A 404 `JOB_NOT_FOUND` is tried
     * again after 0.5, 1 and 1.5 s ({@link SAVE_RETRY_DELAYS_MS}) before the
     * save rejects with it; every other refusal rejects at once. A turn that
     * really is not the user's is therefore refused 3 s later than it was.
     */
    async saveFile(jobUuid: string, file: Blob, options: SaveFileOptions = {}): Promise<ConversationFile> {
        if (!jobUuid) {
            throw new StorageRequestError('A file is saved against a turn of the conversation: no job uuid was given.', 0, null, 'saveFileFailed');
        }
        const body = new FormData();
        body.append('file', file, fileNameFor(file, options));
        // The platform keeps titles of up to 255 characters; one line.
        const title = options.title?.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS);
        if (title) body.append('title', title);
        if (options.kind) body.append('kind', options.kind);
        const spec = prepareSpec(options.spec);
        if (spec !== null) body.append('spec', spec);
        body.append('is_artifact', options.isArtifact ? 'true' : 'false');
        const blockKey = prepareBlockKey(options);
        if (blockKey) body.append('block_key', blockKey);

        const data = unwrap(await this.postFile(`/jobs/${encodeURIComponent(jobUuid)}/files`, body));
        const stored = this.normalize(
            pickObject(data, ['attachment', 'file', 'artifact']) ?? data
        );
        if (!stored) {
            throw new StorageRequestError('The storage API stored the file but did not describe it.', 200, null, 'storageBadResponse');
        }
        return stored;
    }

    /**
     * One of the user's artifacts with the source it was made from (`spec`, the
     * block's body as saved), so a host can draw it again; `null` when none
     * was saved with it. No listing carries the spec.
     */
    async getArtifact(attachmentUuid: string): Promise<ConversationFile & { spec: unknown }> {
        const data = unwrap(await this.requestJson(`/artifacts/${encodeURIComponent(attachmentUuid)}`));
        const raw = pickObject(data, ['artifact', 'file']) ?? data;
        const stored = this.normalize(raw);
        if (!stored) {
            throw new StorageRequestError('The storage API did not describe the artifact.', 200, null, 'storageBadResponse');
        }
        const spec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).spec : undefined;
        return { ...stored, spec: spec ?? null };
    }

    /** Remove one of the user's artifacts, its file with it. Only artifacts can be removed. */
    async deleteArtifact(attachmentUuid: string): Promise<void> {
        await this.request(`/artifacts/${encodeURIComponent(attachmentUuid)}`, { method: 'DELETE' });
    }

    /** The file's bytes, fetched with the user's token. */
    async fetchFile(fileOrUrl: ConversationFile | string): Promise<Blob> {
        const url = typeof fileOrUrl === 'string' ? fileOrUrl : fileOrUrl.download_url;
        const response = await this.request(url);
        return response.blob();
    }

    /**
     * Save the file to the user's device under its own name — the browser's
     * download, after an authenticated fetch.
     */
    async downloadFile(file: ConversationFile, filename?: string): Promise<void> {
        const blob = await this.fetchFile(file);
        saveBlob(blob, filename ?? file.filename);
    }

    /** `path` is relative to the attachments root, or an absolute URL. */
    private async request(path: string, init: { method?: string; body?: BodyInit } = {}): Promise<Response> {
        if (!this.base) throw new StorageRequestError('No storage API URL is configured.', 0, null, 'storageNotConfigured');
        if (!this.token) throw new StorageRequestError('No access token is configured.', 401, null, 'storageNotConfigured');
        const url = /^https?:\/\//i.test(path) ? path : `${this.base}${path}`;
        let response: Response;
        try {
            response = await netFetch(url, {
                method: init.method ?? 'GET',
                headers: { Authorization: `Bearer ${this.token}` },
                body: init.body,
            });
        } catch (error) {
            throw new StorageRequestError(`Storage API unreachable: ${String(error)}`, 0, null, 'storageUnreachable');
        }
        if (!response.ok) {
            const { message, code } = await describeFailure(response);
            throw new StorageRequestError(message, response.status, code);
        }
        return response;
    }

    /**
     * POST a file to a turn, trying again while the turn is not stored yet.
     * Until 2026-10-14 a Save pressed in the moment between the stream naming
     * the turn and the platform writing its row failed outright.
     */
    private async postFile(path: string, body: FormData): Promise<unknown> {
        for (let attempt = 0; ; attempt += 1) {
            try {
                return await this.requestJson(path, { method: 'POST', body });
            } catch (error) {
                const delay = SAVE_RETRY_DELAYS_MS[attempt];
                if (delay === undefined || !isJobNotFound(error)) throw error;
                await wait(delay);
            }
        }
    }

    private async requestJson(path: string, init?: { method?: string; body?: BodyInit }): Promise<unknown> {
        const response = await this.request(path, init);
        if (response.status === 204) return null;
        return response.json();
    }

    private normalizeList(raw: unknown[]): ConversationFile[] {
        return raw.map(item => this.normalize(item)).filter((item): item is ConversationFile => item !== null);
    }

    /** One file in the library's shape, or `null` for an entry with no identity. */
    private normalize(raw: unknown): ConversationFile | null {
        return normalizeConversationFile(raw, (job, attachment) => this.fileDownloadUrl(job, attachment));
    }
}

/**
 * Read one file from a storage API response. Exported for tests and for a host
 * that calls a route of its own and wants the same shape.
 */
export function normalizeConversationFile(
    raw: unknown,
    downloadUrlFor: (jobUuid: string, attachmentUuid: string) => string,
): ConversationFile | null {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const attachmentUuid = text(record.attachment_uuid ?? record.uuid ?? record.id);
    const jobUuid = text(record.job_uuid);
    if (!attachmentUuid || !jobUuid) return null;

    const isArtifact = record.is_artifact === true || record.is_artifact === 'true';
    const rawKind = text(record.artifact_kind ?? record.kind);
    const kind: ArtifactKind | null = rawKind
        ? ((ARTIFACT_KINDS as readonly string[]).includes(rawKind) ? rawKind as ArtifactKind : 'file')
        : (isArtifact ? 'file' : null);
    const rawSource = text(record.source);
    const source: ConversationFileSource = (FILE_SOURCES as readonly string[]).includes(rawSource)
        ? rawSource as ConversationFileSource
        : isArtifact ? 'artifact' : 'upload';
    const size = Number(record.size_bytes ?? record.size ?? 0);

    return {
        attachment_uuid: attachmentUuid,
        job_uuid: jobUuid,
        conversation_uuid: text(record.conversation_uuid ?? record.conversation_id) || null,
        conversation_title: text(record.conversation_title) || null,
        filename: text(record.filename ?? record.name) || 'file',
        content_type: text(record.content_type) || null,
        size_bytes: Number.isFinite(size) && size > 0 ? size : 0,
        is_artifact: isArtifact,
        artifact_kind: kind,
        title: text(record.title).trim() || null,
        has_spec: record.has_spec === true,
        source,
        created_at: text(record.created_at),
        download_url: downloadUrlFor(jobUuid, attachmentUuid),
        // An artifact is saved by definition; a generated file when the
        // server says a copy of it was; an upload never.
        saved: isArtifact || (source === 'generated' && (record.saved === true || record.saved === 'true')),
        block_key: text(record.block_key) || null,
        saved_from_uuid: text(record.saved_from_uuid) || null,
    };
}

/**
 * Read one block record from a storage API response (`BlockRecord`), or
 * `null` for one with no identity. Exported for tests and for a host that
 * calls a route of its own.
 */
export function normalizeBlockRecord(raw: unknown): BlockRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const uuid = text(record.uuid ?? record.block_uuid ?? record.id);
    const jobUuid = text(record.job_uuid);
    const turnJobUuid = text(record.turn_job_uuid) || jobUuid;
    const language = text(record.language);
    const blockKey = text(record.block_key);
    if (!uuid || !turnJobUuid || !language || !blockKey) return null;
    const rawKind = text(record.kind) || language;
    const position = Number(record.position);
    const artifactUuids = Array.isArray(record.artifact_uuids)
        ? record.artifact_uuids.map(text).filter(Boolean)
        : [];
    return {
        uuid,
        job_uuid: jobUuid || turnJobUuid,
        turn_job_uuid: turnJobUuid,
        conversation_uuid: text(record.conversation_uuid) || null,
        conversation_title: text(record.conversation_title) || null,
        language,
        kind: (BLOCK_KINDS as readonly string[]).includes(rawKind) ? rawKind as ArtifactKind : null,
        block_key: blockKey,
        title: text(record.title).trim() || null,
        position: Number.isFinite(position) ? position : 0,
        created_at: text(record.created_at),
        saved: record.saved === true || record.saved === 'true' || artifactUuids.length > 0,
        artifact_uuids: artifactUuids,
    };
}

/**
 * Read one entry of the Artifacts list (`ArtifactEntry`), or `null` for one
 * without the file or the block it names. Exported for tests and for a host
 * that calls a route of its own.
 */
export function normalizeArtifactEntry(
    raw: unknown,
    downloadUrlFor: (jobUuid: string, attachmentUuid: string) => string,
): ArtifactEntry | null {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const id = text(record.id);
    const type = text(record.type) || (id.startsWith('block:') ? 'block' : 'file');
    const file = type === 'file' ? normalizeConversationFile(record.file, downloadUrlFor) : null;
    const block = type === 'block' ? normalizeBlockRecord(record.block) : null;
    if (!file && !block) return null;

    const rawKind = text(record.kind);
    const kind: ArtifactKind | null = (ARTIFACT_KINDS as readonly string[]).includes(rawKind)
        ? rawKind as ArtifactKind
        : file ? (file.artifact_kind ?? 'file') : (block?.kind ?? null);
    const saved = typeof record.saved === 'boolean' ? record.saved : file ? file.saved : Boolean(block?.saved);
    return {
        id: id || (file ? `file:${file.attachment_uuid}` : `block:${block!.uuid}`),
        type: file ? 'file' : 'block',
        saved,
        kind,
        title: text(record.title).trim() || (file ? (file.title ?? file.filename) : (block?.title ?? null)),
        created_at: text(record.created_at) || (file?.created_at ?? block?.created_at ?? ''),
        job_uuid: text(record.job_uuid) || (file?.job_uuid ?? block?.turn_job_uuid ?? ''),
        conversation_uuid: text(record.conversation_uuid) || (file?.conversation_uuid ?? block?.conversation_uuid ?? null),
        conversation_title: text(record.conversation_title) || (file?.conversation_title ?? block?.conversation_title ?? null),
        file,
        block,
    };
}

/** `\r\n` and `\r` as `\n`, as the renderer reads a block's body. */
function normalizeLineBreaks(value: string): string {
    return value.replace(/\r\n?/g, '\n');
}

/**
 * The `block_key` a save sends, or `null`. Only an artifact carries one — the
 * storage API refuses it on anything else — and only one it takes; a key it
 * would refuse is dropped with a warning, so the save still happens.
 */
function prepareBlockKey(options: SaveFileOptions): string | null {
    const key = options.blockKey;
    if (key === undefined || key === null || key === '') return null;
    if (!options.isArtifact) {
        console.warn('[chatbot-ui] saveFile: a blockKey is kept only with an artifact (isArtifact: true); it is left out.');
        return null;
    }
    if (typeof key !== 'string' || !BLOCK_KEY_PATTERN.test(key)) {
        console.warn(`[chatbot-ui] saveFile: "${String(key)}" is not a block key (blockKeyOf gives one); it is left out.`);
        return null;
    }
    return key;
}

function text(value: unknown): string {
    return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

/** The storage API's answer for a turn it has no row for (or one that is not the caller's). */
function isJobNotFound(error: unknown): boolean {
    return error instanceof StorageRequestError && error.status === 404 && error.code === 'JOB_NOT_FOUND';
}

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * A `saveFile` spec as the storage API keeps it, or `null` to save the file
 * without one.
 *
 * The storage API stores the spec as JSONB and takes **one JSON object of at
 * most 256 KiB** — no deeper than 64 levels, no NUL character, no unpaired
 * surrogate — and refuses the *whole save* with a 422 otherwise. A block's
 * fence body is not always that: a host's renderer may repair loosely written
 * JSON before drawing it, or the body may be an array. So, rather than lose
 * the PNG or the workbook over its spec:
 *
 * - a JSON object (or a string holding one) is sent as that object,
 *   re-serialised compactly;
 * - anything else is kept as its text under `source` — `{"source": "…"}` —
 *   which a host draws again by handing `spec.source` back to its renderer;
 * - a spec still outside the limits is left out, with a console warning, and
 *   the file is saved without it.
 *
 * Exported for a host that wants to know beforehand what will be kept.
 */
export function prepareSpec(spec: unknown): string | null {
    if (spec === undefined || spec === null) return null;
    if (typeof spec === 'string' && !spec.trim()) return null;

    let value: unknown = spec;
    if (typeof spec === 'string') {
        try {
            value = JSON.parse(spec);
        } catch {
            value = undefined;
        }
    }
    if (!isPlainObject(value)) {
        let source: string | undefined;
        try {
            source = typeof spec === 'string' ? spec : JSON.stringify(spec);
        } catch {
            source = undefined;
        }
        if (typeof source !== 'string') return dropSpec('it cannot be written as JSON');
        value = { source };
    }

    let json: string;
    try {
        json = JSON.stringify(value);
    } catch {
        return dropSpec('it cannot be written as JSON');
    }
    const problem = specProblem(value);
    if (problem) return dropSpec(problem);
    const bytes = utf8Length(json);
    if (bytes > MAX_SPEC_BYTES) return dropSpec(`it is ${bytes} bytes, over the ${MAX_SPEC_BYTES} the storage API keeps`);
    return json;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dropSpec(reason: string): null {
    console.warn(`[chatbot-ui] saveFile: the spec is left out because ${reason}; the file is saved without it.`);
    return null;
}

/** NUL, or a UTF-16 surrogate without its pair — what Postgres refuses in JSONB text. */
// eslint-disable-next-line no-control-regex
const UNSTORABLE_TEXT = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Why the storage API would refuse this spec's values, or `null`: nesting
 * deeper than it takes, or a key or string it cannot store. Walked with a
 * stack, as the server walks it, so a deep spec cannot overflow this one.
 */
function specProblem(spec: unknown): string | null {
    const stack: Array<[unknown, number]> = [[spec, 1]];
    while (stack.length > 0) {
        const [value, depth] = stack.pop()!;
        if (typeof value === 'string') {
            if (UNSTORABLE_TEXT.test(value)) return 'it holds a NUL character or an unpaired surrogate';
            continue;
        }
        if (!value || typeof value !== 'object') continue;
        if (depth > MAX_SPEC_DEPTH) return `it nests deeper than ${MAX_SPEC_DEPTH} levels`;
        if (Array.isArray(value)) {
            for (const child of value) stack.push([child, depth + 1]);
        } else {
            for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
                if (UNSTORABLE_TEXT.test(key)) return 'it holds a NUL character or an unpaired surrogate';
                stack.push([child, depth + 1]);
            }
        }
    }
    return null;
}

function utf8Length(value: string): number {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
    return new Blob([value]).size;
}

/** A whole number within `[min, max]`; `fallback` for anything that is not a finite number. */
function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * The search, trimmed, and cut at the storage API's 200 characters — whole
 * characters, not halves of a pair. A NUL, which the storage API refuses
 * (422), is dropped: it cannot be in a title or a file name anyway.
 */
function clipSearch(query: string | undefined): string {
    const trimmed = query?.replace(/\u0000/g, '').trim() ?? '';
    const characters = Array.from(trimmed);
    return characters.length > MAX_ARTIFACT_SEARCH_CHARS
        ? characters.slice(0, MAX_ARTIFACT_SEARCH_CHARS).join('').trim()
        : trimmed;
}

/** The platform's `{ code, message, data }` envelope, or the body itself. */
function unwrap(json: unknown): unknown {
    if (json && typeof json === 'object' && 'data' in (json as Record<string, unknown>)) {
        return (json as Record<string, unknown>).data;
    }
    return json;
}

function pickObject(data: unknown, keys: string[]): unknown {
    if (!data || typeof data !== 'object') return undefined;
    for (const key of keys) {
        const value = (data as Record<string, unknown>)[key];
        if (value && typeof value === 'object') return value;
    }
    return undefined;
}

function listOf(data: unknown): unknown[] {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const key of ['items', 'attachments', 'files', 'artifacts']) {
        const value = (data as Record<string, unknown>)[key];
        if (Array.isArray(value)) return value;
    }
    return [];
}

function totalOf(data: unknown): number | null {
    if (!data || typeof data !== 'object') return null;
    const record = data as Record<string, unknown>;
    const pagination = record.pagination as Record<string, unknown> | undefined;
    const total = Number(pagination?.total ?? record.total);
    return Number.isFinite(total) && (pagination?.total !== undefined || record.total !== undefined) ? total : null;
}

/** Newest first, by `created_at`; entries without one keep their order at the end. */
function newestFirst(files: ConversationFile[]): ConversationFile[] {
    return files
        .map((file, index) => ({ file, index, time: Date.parse(file.created_at) }))
        .sort((left, right) => {
            const l = Number.isNaN(left.time) ? -Infinity : left.time;
            const r = Number.isNaN(right.time) ? -Infinity : right.time;
            return r - l || left.index - right.index;
        })
        .map(entry => entry.file);
}

async function describeFailure(response: Response): Promise<{ message: string; code: string | null }> {
    const fallback = `Storage API ${response.status}`;
    const body = await response.text().catch(() => '');
    if (!body) return { message: fallback, code: null };
    try {
        const json = JSON.parse(body) as Record<string, unknown>;
        const detail = json.detail;
        const message = text(json.message)
            || (typeof detail === 'string' ? detail : '')
            || (Array.isArray(detail) ? text((detail[0] as Record<string, unknown> | undefined)?.msg) : '')
            || fallback;
        return { message, code: text(json.code) || null };
    } catch {
        return { message: body.length > 200 ? fallback : body, code: null };
    }
}

const EXTENSIONS: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'text/csv': 'csv',
    'text/plain': 'txt',
    'application/json': 'json',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

/** A `File`'s own name, or one made from the title and the type for a bare `Blob`. */
function fileNameFor(file: Blob, options: SaveFileOptions): string {
    if (options.filename) return options.filename;
    const own = typeof File !== 'undefined' && file instanceof File ? file.name : '';
    if (own) return own;
    const stem = (options.title ?? '')
        .trim()
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 80)
        .trim() || 'file';
    const extension = EXTENSIONS[(file.type || '').split(';')[0].trim()];
    return extension ? `${stem}.${extension}` : stem;
}

/**
 * Hand a blob to the browser as a download. The object URL is released a
 * moment later rather than at once: revoking it in the same task cancels the
 * download in some browsers.
 */
export function saveBlob(blob: Blob, filename: string): void {
    if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'download';
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
