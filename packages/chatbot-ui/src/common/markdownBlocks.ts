import type { BlockDescriptor, BlockRenderer } from './chatbotConfig';

/**
 * Fenced code blocks a host draws itself ("rich blocks"), as plain text.
 *
 * Pure functions, shared by the renderer (`MarkdownContent`), the "Copy" button
 * under a message and any host that exports a message's blocks (a report that
 * gathers its sibling charts). Kept free of React so each can be tested alone
 * and so the three cannot disagree about where a fence starts or what its body
 * is — the `blockKey` a host saves a block under depends on exactly that.
 */

/** The opening line of a fence: up to three spaces, then three or more backticks or tildes. */
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/**
 * Whether React can render `value` as a component: a function or a class, or
 * the object `React.memo`, `forwardRef` or `lazy` returns (tagged with
 * `$$typeof`). Anything else — `undefined`, a plain object, an element — makes
 * React throw "Element type is invalid" while it reconciles the parent.
 */
export const isComponentType = (value: unknown): boolean => {
    if (typeof value === 'function') return true;
    if (!value || typeof value !== 'object') return false;
    const tag = (value as { $$typeof?: unknown }).$$typeof;
    // A symbol in every engine React supports; a number where Symbol is missing.
    return typeof tag === 'symbol' || typeof tag === 'number';
};

/** Whether `value` is a renderer the chat can draw: an object whose `component` React can render. */
export const isBlockRenderer = (value: unknown): value is BlockRenderer => Boolean(value)
    && typeof value === 'object'
    && isComponentType((value as { component?: unknown }).component);

/**
 * The renderer a fence's language names: the map's **own** entry, and only
 * one the chat can draw.
 *
 * A fence's language is whatever the model (or the user) wrote after the
 * backticks. A plain `renderers[language]` would find what every object
 * inherits — ` ```constructor `, ` ```toString `, ` ```__proto__ ` — and hand
 * React a function or an object with no component, which crashed the whole
 * transcript on every reload of the conversation (review of 2026-10-14). Every
 * lookup by language goes through here.
 */
export const rendererFor = (
    renderers: Record<string, BlockRenderer> | null | undefined,
    language: string | null | undefined,
): BlockRenderer | undefined => {
    if (!renderers || !language || !Object.prototype.hasOwnProperty.call(renderers, language)) return undefined;
    const renderer = renderers[language];
    return isBlockRenderer(renderer) ? renderer : undefined;
};

/**
 * A fence body as both the renderer and {@link extractBlocks} key it: line
 * endings as `\n`. The markdown parser keeps a `\r\n` answer's carriage returns
 * in the code it hands the renderer; without this the drawn block and the
 * extracted one had different bodies and different `blockKey`s.
 */
export const normalizeLineEndings = (text: string): string => text.replace(/\r\n?/g, '\n');

/**
 * Whether a fence's raw text, from its opening line to wherever the source
 * currently ends, carries its closing line yet.
 *
 * While an answer streams, the markdown parser treats an unclosed fence as
 * running to the end of the document, so the block's body grows token by
 * token. This is what tells "still being written" from "done": a renderer is
 * only handed a whole spec, never a prefix of one that would flicker or fail
 * to parse.
 */
export const isFenceClosed = (raw: string): boolean => {
    const lines = raw.replace(/\s+$/, '').split('\n');
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0] ?? '');
    if (!open || lines.length < 2) return false;
    const last = lines[lines.length - 1].trim();
    return last.length >= open[1].length && /^(`+|~+)$/.test(last) && last[0] === open[1][0];
};

/**
 * 32-bit FNV-1a, in base 36: a short, stable key for a block's text.
 *
 * Not a security hash. It only has to give the same block the same key live
 * and after a reload (both see the same fence body), so a host can remember
 * what it did with a block — saved it, say — without the library inventing
 * ids that would differ between the two.
 */
export const fnv1a = (text: string): string => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
};

/** The key a block is known by: its language and its body, hashed together. */
export const blockKeyOf = (language: string, source: string): string => fnv1a(`${language}\n${source}`);

/**
 * The `"title"` a block's JSON body declares, read without parsing it.
 *
 * A regular expression rather than `JSON.parse` because the body may be
 * incomplete (a skeleton shows the title while the rest still streams) or
 * invalid (the fallback names the block the model got wrong). `null` when
 * there is none.
 */
export const extractBlockTitle = (source: string): string | null => {
    const match = /"title"\s*:\s*"((?:[^"\\\n]|\\.){1,200})"/.exec(source);
    if (!match) return null;
    let title = match[1];
    try {
        title = JSON.parse(`"${match[1]}"`) as string;
    } catch {
        // An escape cut off mid-stream; the raw text is still a fair title.
    }
    title = title.trim();
    if (!title) return null;
    return title.length > 80 ? `${title.slice(0, 79)}…` : title;
};

/** One fenced code block found in a markdown string. */
interface ScannedFence {
    /** Index of the opening line. */
    startLine: number;
    /** Index of the closing line, or the last line when the fence never closes. */
    endLine: number;
    language: string;
    meta: string | null;
    /** The content lines, with the fence's own indentation removed — what the parser calls the value. */
    body: string;
    closed: boolean;
}

/**
 * Every fenced code block in `markdown`, in order, by the CommonMark rules the
 * renderer's parser follows: an opening run of three or more backticks or
 * tildes, indented at most three spaces; a closing run of the same character
 * at least as long; content lines lose up to the opening's indentation. A
 * fence that never closes runs to the end, as it does for the parser.
 *
 * Lines are read as if at the top level: a fence is any line that opens one
 * within three spaces of the margin. That takes in a fence inside a list item
 * whose text starts within three spaces (`- `, `1. `), which is found, and
 * replaced by `toPlainText`, as a top-level one is. A fence nested further —
 * indented four spaces or more (a sub-list, `10. `), in a quote (`> `), or
 * opened on the marker's own line (`- ```chart`) — is not looked for: the
 * skill that writes rich blocks puts them at the top level, and such a fence
 * is still drawn by the renderer; only "Copy" and `extractBlocks` leave it as
 * written.
 *
 * Two shapes are read here otherwise than the renderer draws them — known
 * divergences (review of 2026-10-14), kept because the platform's index of a
 * turn's blocks is a port of this function and must give the same keys as
 * the transcript's extraction (`MarkdownContent.test.tsx` pins both):
 *
 * - **An unclosed fence in a list item, followed by less-indented text.** The
 *   parser ends the code block where the list item ends; this runs the fence
 *   to the end of the text. The drawn body (and the `blockKey` its Save
 *   sends) is shorter than the one extracted and indexed, so such a block
 *   stays "Not saved" in the lists after it is saved, beside its artifact.
 * - **A fence inside an HTML block** (`<div>` on the line before). The parser
 *   draws the whole as raw HTML, with no block; this finds the fence, so the
 *   lists show a "Not saved" visual that was never drawn.
 *
 * Neither is a shape the skill that writes rich blocks produces.
 */
function scanFences(markdown: string): { lines: string[]; fences: ScannedFence[] } {
    const lines = normalizeLineEndings(markdown).split('\n');
    const fences: ScannedFence[] = [];
    let index = 0;
    while (index < lines.length) {
        const open = FENCE_OPEN.exec(lines[index]);
        // A backtick fence's info string may not itself contain a backtick:
        // "```js```" on one line is inline code, not a fence.
        if (!open || (open[2][0] === '`' && open[3].includes('`'))) {
            index += 1;
            continue;
        }
        const indent = open[1].length;
        const marker = open[2];
        const info = open[3].trim();
        const [language = '', ...rest] = info.split(/\s+/);
        const closing = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);

        const bodyLines: string[] = [];
        let cursor = index + 1;
        let closed = false;
        while (cursor < lines.length) {
            if (closing.test(lines[cursor])) {
                closed = true;
                break;
            }
            bodyLines.push(stripIndent(lines[cursor], indent));
            cursor += 1;
        }
        fences.push({
            startLine: index,
            endLine: closed ? cursor : lines.length - 1,
            language,
            meta: rest.length > 0 ? rest.join(' ') : null,
            body: bodyLines.join('\n'),
            closed,
        });
        index = cursor + 1;
    }
    return { lines, fences };
}

function stripIndent(line: string, indent: number): string {
    let removed = 0;
    while (removed < indent && line[removed] === ' ') removed += 1;
    return line.slice(removed);
}

/** What a claimed fence reads as in plain text when its renderer says nothing: `[chart: Title]`. */
export const defaultBlockText = (label: string, source: string): string => {
    const title = extractBlockTitle(source);
    return title ? `[${label}: ${title}]` : `[${label}]`;
};

/**
 * The message as plain text, for "Copy": each fence a renderer claims becomes
 * `renderer.toText(body)`, or `[<label>: <title>]` without one, so a copied
 * answer carries no raw JSON. Every other fence, and everything else, is
 * kept as written.
 */
export const toPlainText = (markdown: string, renderers: Record<string, BlockRenderer>): string => {
    if (!markdown) return markdown;
    const { lines, fences } = scanFences(markdown);
    // The same lookup the renderer uses, so "Copy" replaces exactly the fences drawn as blocks.
    const claimed = fences
        .map(fence => ({ fence, renderer: rendererFor(renderers, fence.language) }))
        .filter((entry): entry is { fence: ScannedFence; renderer: BlockRenderer } => entry.renderer !== undefined);
    if (claimed.length === 0) return markdown;

    const out: string[] = [];
    let next = 0;
    for (const { fence, renderer } of claimed) {
        out.push(...lines.slice(next, fence.startLine));
        let text: string;
        try {
            text = renderer.toText
                ? renderer.toText(fence.body)
                : defaultBlockText(renderer.label ?? fence.language, fence.body);
        } catch {
            text = defaultBlockText(renderer.label ?? fence.language, fence.body);
        }
        out.push(text);
        next = fence.endLine + 1;
    }
    out.push(...lines.slice(next));
    return out.join('\n');
};

/** One block {@link scanBlocks} found, and whether its fence has closed. */
export interface ScannedBlock extends BlockDescriptor {
    /**
     * The fence's closing line is in the text. An unclosed fence is drawn only
     * once its text stops arriving (the answer ended inside it); while it
     * streams it is a skeleton, and its body is a prefix of the block's.
     */
    closed: boolean;
}

/**
 * The body a renderer draws for a fence: `scanFences`' body for a closed
 * fence, and that body without the text's final line break for one that never
 * closed. The markdown parser hands an unclosed fence's code over with the
 * text's last `\n` already gone, and `MarkdownContent` drops one more trailing
 * `\n` from every code body — so for a closed fence the two agree as they
 * are, and for an unclosed one only after the same cut. Until 2026-10-14
 * `extractBlocks` kept it, and an answer that ended inside a fence followed by
 * a line break gave that block a `blockKey` other than the one it was drawn
 * (and saved, and indexed by the platform) with.
 */
function drawnBody(fence: ScannedFence): string {
    return fence.closed ? fence.body : fence.body.replace(/\n$/, '');
}

/**
 * {@link extractBlocks}, with whether each fence has closed — for a caller
 * that must leave out a block still being written (the files panel, while
 * the turn streams).
 */
export const scanBlocks = (markdown: string, languages: readonly string[], messageId = ''): ScannedBlock[] => {
    if (!markdown) return [];
    const wanted = new Set(languages);
    return scanFences(markdown).fences
        .filter(fence => wanted.has(fence.language))
        .map(fence => {
            const source = drawnBody(fence);
            return {
                language: fence.language,
                source,
                meta: fence.meta,
                blockKey: blockKeyOf(fence.language, source),
                messageId,
                closed: fence.closed,
            };
        });
};

/**
 * The blocks of the given languages in a message, in order — for a host that
 * exports a whole answer (a report's "Export Excel" gathering every chart and
 * table beside it). Each carries the same `source` and `blockKey` the rendered
 * block has, a fence the answer ended inside included.
 */
export const extractBlocks = (markdown: string, languages: string[], messageId = ''): BlockDescriptor[] =>
    scanBlocks(markdown, languages, messageId).map(({ closed: _closed, ...block }) => block);

/** What the platform takes as a block language: `block_languages` and `jobs.job_blocks.language`. */
export const BLOCK_LANGUAGE_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

/** The most languages one job may name in `block_languages`. */
export const MAX_BLOCK_LANGUAGES = 16;

/**
 * The fence languages a job tells the platform it draws as rich blocks
 * (`block_languages`): the given ones the platform takes — lower-case,
 * `^[a-z][a-z0-9_-]{0,31}$` — each once, sorted, at most 16. The platform
 * indexes those fences of the turn's answer when it ends, so a drawn block is
 * listed in the conversation's files and the user's Artifacts as "Not saved"
 * until it is saved. A language outside the pattern is still drawn; it is just
 * not indexed.
 */
export const blockLanguagesOf = (languages: Iterable<string> | null | undefined): string[] => {
    if (!languages) return [];
    const valid = new Set<string>();
    for (const language of languages) {
        if (typeof language === 'string' && BLOCK_LANGUAGE_PATTERN.test(language)) valid.add(language);
    }
    return Array.from(valid).sort().slice(0, MAX_BLOCK_LANGUAGES);
};
