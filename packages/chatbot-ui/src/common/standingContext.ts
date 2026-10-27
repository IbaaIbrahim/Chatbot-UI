import type { StandingEntry, StandingEntryKind } from '../api/types';
import type { StandingContextOptions } from './chatbotConfig';

/** The labels that explain a refused entry; each fills `{limit}` from {@link refusalLimit}. */
export type StandingRefusal =
    | 'standingErrorEmpty'
    | 'standingErrorMemoryTooLong'
    | 'standingErrorInstructionsFull'
    | 'standingErrorMemoriesFull'
    | 'standingErrorExpiry'
    | 'standingErrorGone'
    | 'standingErrorSave';

/**
 * The rules "Memory & instructions" warns with before it sends (ADR-021).
 *
 * The Gateway is authoritative — it refuses with a precise `reason`, and the
 * panel shows that — but a counter that already knows the limits saves a
 * round trip and a surprise. The numbers repeat `lib.standing_context` on the
 * platform; if they drift, the Gateway's answer still wins and the panel
 * shows it.
 */

const HTTP_NOT_FOUND = 404;

/** The parts of "Memory & instructions" a host shows. */
export interface StandingContextParts {
    personal: boolean;
    workspace: boolean;
}

/**
 * What `header.standingContext` shows (since 4.5): `true` both parts, `false`
 * neither, and `{ personal, workspace }` each part it does not turn off.
 */
export function standingContextParts(option: boolean | StandingContextOptions | undefined): StandingContextParts {
    if (option === false) return { personal: false, workspace: false };
    if (option === true || option === undefined || option === null || typeof option !== 'object') {
        return { personal: true, workspace: true };
    }
    return { personal: option.personal !== false, workspace: option.workspace !== false };
}

/** One memory, in characters. */
export const MAX_MEMORY_CHARS = 300;
/** All of the user's instructions together, in characters. */
export const MAX_INSTRUCTION_CHARS = 4000;
/** How many memories the user may keep. */
export const MAX_MEMORIES = 50;

/**
 * Python's `\s` less the line break (`[^\S\n]`, `lib/standing_context`):
 * JavaScript's `\s` differs at the edges — it has U+FEFF, lacks U+001C–U+001F
 * and U+0085 — and one character apart is enough to put a count on the wrong
 * side of a limit.
 */
const INLINE_WHITESPACE_RUN =
    /[\t\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;

/**
 * `text` as the Gateway stores it (since 4.5, the platform's amendment of
 * 2026-10-26): without `<` or `>`, its **lines kept** — `\r\n` and `\r` read as
 * `\n` — each line's whitespace one space with none at either end, runs of
 * blank lines one, none leading or trailing. A line break counts as one
 * character; the limits are measured after.
 */
export function normalizeEntry(text: string): string {
    const kept: string[] = [];
    for (const raw of text.replace(/[<>]/g, '').replace(/\r\n?/g, '\n').split('\n')) {
        const line = raw.replace(INLINE_WHITESPACE_RUN, ' ').replace(/^ | $/g, '');
        // A blank line only after a written one: leading blanks and runs go.
        if (line || (kept.length > 0 && kept[kept.length - 1])) kept.push(line);
    }
    while (kept.length > 0 && !kept[kept.length - 1]) kept.pop();
    return kept.join('\n');
}

/**
 * Characters as the platform counts them (Python's `len`): code points, so an
 * emoji is one, where `String.length` would say two.
 */
export function entryLength(text: string): number {
    return Array.from(normalizeEntry(text)).length;
}

/** Today in UTC, `YYYY-MM-DD`: the platform judges an end date against UTC. */
export function todayUtc(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10);
}

/** An end date the Gateway accepts: written `YYYY-MM-DD`, today or later (UTC). */
export function isAcceptableEndDate(date: string, today: string = todayUtc()): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today;
}

/**
 * An end date as an instant `format.date` writes as that same day everywhere.
 * `'2026-11-10'` alone parses as midnight UTC, which a browser west of
 * Greenwich would write as the 9th.
 */
export function endDateInstant(date: string): string {
    return `${date}T12:00:00Z`;
}

/** Whether `entry` is still told to the assistant: active, and not past its end date. */
export function isInForce(entry: StandingEntry): boolean {
    return entry.status === 'active' && !entry.expired;
}

/** What the user's own entries in force already take, leaving out the one being edited. */
export interface StandingBudget {
    instructionChars: number;
    memories: number;
}

export function ownBudget(entries: StandingEntry[], excludingUuid?: string): StandingBudget {
    const counted = entries.filter(entry => entry.editable && isInForce(entry) && entry.uuid !== excludingUuid);
    return {
        instructionChars: counted
            .filter(entry => entry.kind === 'instruction')
            .reduce((total, entry) => total + entryLength(entry.body), 0),
        memories: counted.filter(entry => entry.kind === 'memory').length,
    };
}

/** The most characters `text` may have here: one memory's limit, or what the user's instructions leave. */
export function characterLimit(kind: StandingEntryKind, budget: StandingBudget): number {
    return kind === 'memory' ? MAX_MEMORY_CHARS : Math.max(0, MAX_INSTRUCTION_CHARS - budget.instructionChars);
}

/**
 * The refusal the panel can see coming, as the label that explains it —
 * `null` when the Gateway should be asked. A new memory into a full set, an
 * empty text and an over-long one are all decided here.
 */
export function anticipatedRefusal(
    kind: StandingEntryKind,
    text: string,
    budget: StandingBudget,
    isNew: boolean,
): StandingRefusal | null {
    const length = entryLength(text);
    if (length === 0) return 'standingErrorEmpty';
    if (kind === 'memory') {
        if (isNew && budget.memories >= MAX_MEMORIES) return 'standingErrorMemoriesFull';
        if (length > MAX_MEMORY_CHARS) return 'standingErrorMemoryTooLong';
        return null;
    }
    return length > characterLimit(kind, budget) ? 'standingErrorInstructionsFull' : null;
}

/** What the Gateway's refusal means, as the label to show; `fallback` for anything else. */
export function refusalLabel(
    error: unknown,
    kind: StandingEntryKind,
    fallback: StandingRefusal,
): StandingRefusal {
    const refusal = error as { status?: number; reason?: string | null } | null;
    switch (refusal?.reason) {
        case 'STANDING_ENTRY_EMPTY':
            return 'standingErrorEmpty';
        case 'STANDING_ENTRY_TOO_LONG':
            return kind === 'memory' ? 'standingErrorMemoryTooLong' : 'standingErrorInstructionsFull';
        case 'STANDING_CONTEXT_FULL':
            return kind === 'memory' ? 'standingErrorMemoriesFull' : 'standingErrorInstructionsFull';
        case 'STANDING_ENTRY_INVALID_EXPIRY':
            return 'standingErrorExpiry';
        default:
            return refusal?.status === HTTP_NOT_FOUND ? 'standingErrorGone' : fallback;
    }
}

/** The limit a refusal's label names, for its `{limit}`. */
export function refusalLimit(label: StandingRefusal): number {
    if (label === 'standingErrorMemoriesFull') return MAX_MEMORIES;
    if (label === 'standingErrorMemoryTooLong') return MAX_MEMORY_CHARS;
    return MAX_INSTRUCTION_CHARS;
}
