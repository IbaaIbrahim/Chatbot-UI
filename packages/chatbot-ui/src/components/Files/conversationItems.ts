import type { ArtifactKind, BlockRecord, ConversationFile } from '../../api/types';
import { extractBlockTitle, scanBlocks } from '../../common/markdownBlocks';
import type { MessageProps, MessageStep } from '../MessageBubble/MessageBubble';

/**
 * What the conversation files panel lists (2026-10-14): everything of the
 * conversation in one list — the user's uploads, generated files, saved
 * artifacts, and every block the answers drew — each artifact marked Saved
 * or Not saved. Pure functions, so the merge can be tested on its own.
 *
 * Blocks come from two places that overlap:
 *
 * - the **server** (`listConversationFiles(…).blocks`), which indexes a turn's
 *   blocks when the turn ends — every turn sent with `block_languages`, and
 *   older ones only once backfilled;
 * - the **transcript**: the blocks of the loaded messages, found the way the
 *   renderer finds them (`scanBlocks`), so the turn under way and old
 *   conversations the platform never indexed show at once.
 *
 * One block is one entry per `(turn job, blockKey)` — the same chart drawn
 * twice in a turn, or by the turn's agent and a sub-agent, is one visual.
 * A saved block's artifact is folded into the block's row (it is that block,
 * kept), and a generated file's saved copy into the file's row.
 */

/** The kinds a block can be: its language, when it is one of these. */
const BLOCK_KINDS: readonly ArtifactKind[] = ['chart', 'table', 'kpi', 'report'];

/** The artifact kinds drawn as visuals; `file` (and a file without a kind) is a file. */
const VISUAL_KINDS: readonly ArtifactKind[] = BLOCK_KINDS;

/** A block found in a message of the transcript. */
export interface TranscriptBlock {
    /** The message's job: the turn's (a sub-agent's text is drawn under its turn's job). `null` before the stream names it. */
    turnJobUuid: string | null;
    messageId: string;
    language: string;
    source: string;
    meta: string | null;
    blockKey: string;
    /** The message's text, for a block that exports its siblings (a report). */
    messageText: string;
    /** When the message was written, ISO; `''` when it does not say (a turn sent since the conversation was loaded). */
    createdAt: string;
    /** The message's place in the transcript: what orders blocks without a date, the newest first. */
    messageIndex: number;
}

/** One visual of the conversation, as the panel shows it. */
export interface ConversationBlock {
    /** `(turn, blockKey)`, as one string — what makes it one entry. */
    id: string;
    turnJobUuid: string | null;
    blockKey: string;
    language: string;
    kind: ArtifactKind | null;
    title: string | null;
    /** The body to draw it with; `null` for a block the transcript does not hold (fetch it: `getBlock(serverUuid)`). */
    source: string | null;
    meta: string | null;
    /** The platform's record of it, when indexed. */
    serverUuid: string | null;
    /** The message it is drawn in, when that is in the loaded transcript — what "Show in chat" goes to. */
    messageId: string | null;
    messageText: string | null;
    saved: boolean;
    /** The artifact it was saved as, when the list has it — what its download is. */
    artifact: ConversationFile | null;
    createdAt: string;
}

export type ConversationItem =
    | { type: 'file'; id: string; file: ConversationFile; visual: boolean }
    | { type: 'block'; id: string; block: ConversationBlock; visual: true };

/** The text parts of a message the transcript draws as markdown, sub-agents' included. */
function textsOf(message: MessageProps): string[] {
    if (!message.steps || message.steps.length === 0) return message.content ? [message.content] : [];
    const texts: string[] = [];
    const walk = (steps: MessageStep[]) => {
        for (const step of steps) {
            if (step.type === 'text' && step.content) texts.push(step.content);
            if (step.type === 'sub-agent') {
                if (step.subSteps) walk(step.subSteps);
                if (step.content) texts.push(step.content);
            }
        }
    };
    walk(message.steps);
    return texts.length > 0 ? texts : message.content ? [message.content] : [];
}

/** The message's whole text, as `getMessageSource` reads it in the transcript. */
export function messageTextOf(message: MessageProps): string {
    const steps = message.steps ?? [];
    const fromSteps = steps.filter(step => step.type === 'text').map(step => step.content || '').join('\n\n');
    return fromSteps || message.content || '';
}

function isoOf(date: Date | string | undefined): string {
    if (!date) return '';
    const time = date instanceof Date ? date.getTime() : Date.parse(date);
    return Number.isNaN(time) ? '' : new Date(time).toISOString();
}

/** One message's blocks, cached by the message object: a streamed token replaces only the last message. */
const cache = new WeakMap<MessageProps, { key: string; blocks: TranscriptBlock[] }>();

/**
 * Every block the loaded transcript draws for these languages, in reading
 * order: the assistant's answers only (a user's own fence is text they
 * wrote). In the message still being written (`liveMessageId`), a fence that
 * has not closed is left out — it is a skeleton, not a block, until it does.
 */
export function blocksInMessages(
    messages: readonly MessageProps[],
    languages: readonly string[],
    liveMessageId: string | null = null,
): TranscriptBlock[] {
    if (languages.length === 0) return [];
    const languagesKey = languages.join('\u0001');
    const found: TranscriptBlock[] = [];
    messages.forEach((message, messageIndex) => {
        if (message.role !== 'assistant') return;
        const live = message.id === liveMessageId;
        const cacheKey = `${languagesKey}\u0002${live ? 'live' : 'done'}\u0002${message.jobUuid ?? ''}\u0002${messageIndex}`;
        const cached = cache.get(message);
        if (cached && cached.key === cacheKey) {
            found.push(...cached.blocks);
            return;
        }
        const messageText = messageTextOf(message);
        const createdAt = isoOf(message.timestamp);
        const blocks: TranscriptBlock[] = [];
        for (const text of textsOf(message)) {
            for (const block of scanBlocks(text, languages, message.id)) {
                if (live && !block.closed) continue;
                blocks.push({
                    turnJobUuid: message.jobUuid ?? null,
                    messageId: message.id,
                    language: block.language,
                    source: block.source,
                    meta: block.meta,
                    blockKey: block.blockKey,
                    messageText,
                    createdAt,
                    messageIndex,
                });
            }
        }
        cache.set(message, { key: cacheKey, blocks });
        found.push(...blocks);
    });
    return found;
}

/** The entry a block is one of. A block of a turn not named yet is its message's. */
export function blockIdOf(turnJobUuid: string | null, blockKey: string, messageId?: string | null): string {
    return `${turnJobUuid ?? `message:${messageId ?? ''}`}\u0001${blockKey}`;
}

function kindOfLanguage(language: string): ArtifactKind | null {
    return (BLOCK_KINDS as readonly string[]).includes(language) ? language as ArtifactKind : null;
}

function timeOf(iso: string): number {
    const time = Date.parse(iso);
    // A block of a turn sent since the conversation was loaded (the one under
    // way among them) has no date: it is among the newest.
    return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

type Ranked = { item: ConversationItem; time: number; messageIndex: number; order: number };

/** Newest first; blocks without a date by their message, newest first; a turn's blocks in reading order. */
function byRank(left: Ranked, right: Ranked): number {
    // `Infinity - Infinity` is NaN, which falls through to the next rule.
    return (right.time - left.time) || (right.messageIndex - left.messageIndex) || (left.order - right.order);
}

/**
 * The panel's list: the files and the blocks of one conversation, newest
 * first — a turn's blocks in the order they were drawn — with every artifact
 * that is a saved block or a saved copy of a generated file folded into that
 * block's or that file's row.
 */
export function mergeConversation(
    files: readonly ConversationFile[],
    serverBlocks: readonly BlockRecord[],
    transcriptBlocks: readonly TranscriptBlock[],
): ConversationItem[] {
    type Gathered = ConversationBlock & { jobs: Set<string>; artifactUuids: Set<string>; messageIndex: number };
    const blocks = new Map<string, Gathered>();

    // A job the platform names as part of another turn (a sub-agent's, a
    // handoff child's): a transcript block keyed by it belongs to that turn.
    // The history keys a handoff child's answer by its turn's job since
    // 2026-10-14 (`jobsToMessageProps`); this covers a history that does not
    // name the child's parent, so one visual is still one row.
    const turnOfJob = new Map<string, string>();
    for (const record of serverBlocks) {
        if (record.job_uuid && record.turn_job_uuid && record.job_uuid !== record.turn_job_uuid) {
            turnOfJob.set(record.job_uuid, record.turn_job_uuid);
        }
    }

    for (const found of transcriptBlocks) {
        const turnJobUuid = found.turnJobUuid ? turnOfJob.get(found.turnJobUuid) ?? found.turnJobUuid : null;
        const id = blockIdOf(turnJobUuid, found.blockKey, found.messageId);
        if (blocks.has(id)) continue;
        blocks.set(id, {
            id,
            turnJobUuid,
            blockKey: found.blockKey,
            language: found.language,
            kind: kindOfLanguage(found.language),
            title: extractBlockTitle(found.source),
            source: found.source,
            meta: found.meta,
            serverUuid: null,
            messageId: found.messageId,
            messageText: found.messageText,
            saved: false,
            artifact: null,
            createdAt: found.createdAt,
            jobs: new Set([turnJobUuid, found.turnJobUuid].filter((job): job is string => Boolean(job))),
            artifactUuids: new Set(),
            messageIndex: found.messageIndex,
        });
    }

    for (const record of serverBlocks) {
        const id = blockIdOf(record.turn_job_uuid, record.block_key);
        const known = blocks.get(id);
        if (known) {
            known.serverUuid = known.serverUuid ?? record.uuid;
            known.title = record.title ?? known.title;
            known.kind = record.kind ?? known.kind;
            known.saved = known.saved || record.saved;
            if (record.created_at) known.createdAt = record.created_at;
            known.jobs.add(record.job_uuid);
            record.artifact_uuids.forEach(uuid => known.artifactUuids.add(uuid));
            continue;
        }
        blocks.set(id, {
            id,
            turnJobUuid: record.turn_job_uuid,
            blockKey: record.block_key,
            language: record.language,
            kind: record.kind ?? kindOfLanguage(record.language),
            title: record.title,
            source: null,
            meta: null,
            serverUuid: record.uuid,
            messageId: null,
            messageText: null,
            saved: record.saved,
            artifact: null,
            createdAt: record.created_at,
            jobs: new Set([record.turn_job_uuid, record.job_uuid]),
            artifactUuids: new Set(record.artifact_uuids),
            messageIndex: -1,
        });
    }

    // A saved block's artifact: the block's row, kept. Matched by the uuids
    // the platform lists for the block, else by its key on a job of its turn.
    const folded = new Set<string>();
    const byKey = new Map<string, Gathered[]>();
    blocks.forEach(block => {
        const list = byKey.get(block.blockKey) ?? [];
        list.push(block);
        byKey.set(block.blockKey, list);
    });
    for (const file of files) {
        if (!file.is_artifact || !file.block_key) continue;
        const owner = (byKey.get(file.block_key) ?? []).find(block =>
            block.artifactUuids.has(file.attachment_uuid) || block.jobs.has(file.job_uuid)
        );
        if (!owner) continue;
        owner.saved = true;
        // The oldest artifact is the one the platform names first; any will do to download.
        if (!owner.artifact) owner.artifact = file;
        folded.add(file.attachment_uuid);
    }

    // A generated file's saved copy: the file's row, kept.
    const generated = new Map(files.filter(file => file.source === 'generated').map(file => [file.attachment_uuid, file]));
    const copied = new Set<string>();
    for (const file of files) {
        if (file.is_artifact && file.saved_from_uuid && generated.has(file.saved_from_uuid)) {
            copied.add(file.saved_from_uuid);
            folded.add(file.attachment_uuid);
        }
    }

    const items: Ranked[] = [];
    files.forEach(file => {
        if (folded.has(file.attachment_uuid)) return;
        const shown = copied.has(file.attachment_uuid) && !file.saved ? { ...file, saved: true } : file;
        items.push({
            item: { type: 'file', id: `file:${file.attachment_uuid}`, file: shown, visual: isVisualFile(file) },
            time: timeOf(file.created_at),
            messageIndex: -1,
            order: items.length,
        });
    });
    blocks.forEach(({ jobs: _jobs, artifactUuids: _uuids, messageIndex, ...block }) => {
        items.push({
            item: { type: 'block', id: `block:${block.id}`, block, visual: true },
            time: timeOf(block.createdAt),
            messageIndex,
            order: items.length,
        });
    });
    return items.sort(byRank).map(entry => entry.item);
}

/** A saved chart, table, KPI card or report is a visual; everything else — uploads, exports, plain files — a file. */
export function isVisualFile(file: ConversationFile): boolean {
    return file.is_artifact && file.artifact_kind !== null && (VISUAL_KINDS as readonly string[]).includes(file.artifact_kind);
}
