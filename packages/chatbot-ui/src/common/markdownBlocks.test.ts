import { describe, expect, it } from 'vitest';
import * as React from 'react';
import type { BlockRenderer } from './chatbotConfig';
import {
    blockKeyOf,
    defaultBlockText,
    extractBlockTitle,
    blockLanguagesOf,
    extractBlocks,
    fnv1a,
    isBlockRenderer,
    isComponentType,
    isFenceClosed,
    normalizeLineEndings,
    rendererFor,
    scanBlocks,
    toPlainText,
} from './markdownBlocks';

/**
 * The pure half of rich blocks: where a fence starts and ends, what its body
 * is, and what it reads as in plain text. The renderer, "Copy" and a host's
 * export all lean on these agreeing.
 */

const Noop = () => null;
const chart: BlockRenderer = { component: Noop, label: 'chart' };

const CHART_BODY = '{"type":"line","title":"Average score per month","data":{"ref":"1899af24"}}';

describe('isFenceClosed', () => {
    it('is closed by a run of the same character at least as long', () => {
        expect(isFenceClosed('```chart\n{}\n```')).toBe(true);
        expect(isFenceClosed('```chart\n{}\n````')).toBe(true);
        expect(isFenceClosed('~~~chart\n{}\n~~~')).toBe(true);
        expect(isFenceClosed('````chart\n{}\n````\n\n')).toBe(true);
    });

    it('is open while the closing run has not arrived', () => {
        expect(isFenceClosed('```chart\n{"type":"li')).toBe(false);
        expect(isFenceClosed('```chart')).toBe(false);
        expect(isFenceClosed('```chart\n{}\n``')).toBe(false);
        expect(isFenceClosed('````chart\n{}\n```')).toBe(false);
    });

    it('is not closed by the other fence character', () => {
        expect(isFenceClosed('```chart\n{}\n~~~')).toBe(false);
        expect(isFenceClosed('~~~chart\n{}\n```')).toBe(false);
    });

    it('needs an opening fence', () => {
        expect(isFenceClosed('')).toBe(false);
        expect(isFenceClosed('text\n```')).toBe(false);
    });
});

describe('fnv1a', () => {
    it('is 32-bit FNV-1a in base 36', () => {
        expect(fnv1a('')).toBe((0x811c9dc5).toString(36));
        expect(fnv1a('a')).toBe((0xe40c292c).toString(36));
    });

    it('is stable, and differs for a different text', () => {
        expect(fnv1a(CHART_BODY)).toBe(fnv1a(CHART_BODY));
        expect(fnv1a(CHART_BODY)).not.toBe(fnv1a(`${CHART_BODY} `));
    });

    it('keys a block on its language and its body together', () => {
        expect(blockKeyOf('chart', '{}')).toBe(fnv1a('chart\n{}'));
        expect(blockKeyOf('chart', '{}')).not.toBe(blockKeyOf('table', '{}'));
    });
});

describe('extractBlockTitle', () => {
    it('reads the title without parsing the body', () => {
        expect(extractBlockTitle(CHART_BODY)).toBe('Average score per month');
        expect(extractBlockTitle('{"type":"bar", "title" : "Ränge \\"A\\"", "x":')).toBe('Ränge "A"');
    });

    it('has none until the title string has closed', () => {
        expect(extractBlockTitle('{"type":"line","title":"Average sc')).toBeNull();
        expect(extractBlockTitle('{"type":"line"}')).toBeNull();
        expect(extractBlockTitle('{"title":"   "}')).toBeNull();
    });

    it('shortens a long title', () => {
        const title = extractBlockTitle(`{"title":"${'x'.repeat(120)}"}`);
        expect(title).toHaveLength(80);
        expect(title!.endsWith('…')).toBe(true);
    });
});

describe('toPlainText', () => {
    it('replaces a claimed fence with its label and title', () => {
        const markdown = `Scores rose.\n\n\`\`\`chart\n${CHART_BODY}\n\`\`\`\n\nMostly in March.`;
        expect(toPlainText(markdown, { chart })).toBe(
            'Scores rose.\n\n[chart: Average score per month]\n\nMostly in March.'
        );
    });

    it("uses the renderer's own text when it has one", () => {
        const withText: BlockRenderer = { component: Noop, toText: source => `<<${JSON.parse(source).type}>>` };
        expect(toPlainText(`\`\`\`chart\n${CHART_BODY}\n\`\`\``, { chart: withText })).toBe('<<line>>');
    });

    it('falls back to the label when the renderer\'s text throws', () => {
        const throwing: BlockRenderer = { component: Noop, label: 'table', toText: () => { throw new Error('x'); } };
        expect(toPlainText('```table\n{"title":"Inspectors"}\n```', { table: throwing })).toBe('[table: Inspectors]');
    });

    it('keeps unclaimed fences and everything else as written', () => {
        const markdown = 'Run:\n\n```bash\nnpm test\n```\n\n```chart\n{}\n```';
        expect(toPlainText(markdown, { chart })).toBe('Run:\n\n```bash\nnpm test\n```\n\n[chart]');
        expect(toPlainText(markdown, {})).toBe(markdown);
    });

    it('replaces a fence the answer never closed', () => {
        expect(toPlainText(`Here:\n\n\`\`\`chart\n${CHART_BODY}`, { chart })).toBe(
            'Here:\n\n[chart: Average score per month]'
        );
    });

    it('handles tilde fences, several blocks and a label from the language', () => {
        const kpi: BlockRenderer = { component: Noop };
        const markdown = `~~~kpi\n{"title":"This month"}\n~~~\ntext\n\`\`\`chart\n${CHART_BODY}\n\`\`\``;
        expect(toPlainText(markdown, { chart, kpi })).toBe(
            '[kpi: This month]\ntext\n[chart: Average score per month]'
        );
    });

    it('is the default text a block reads as', () => {
        expect(defaultBlockText('chart', CHART_BODY)).toBe('[chart: Average score per month]');
        expect(defaultBlockText('chart', 'not json')).toBe('[chart]');
    });

    // Review of 2026-10-14: the scanner's comment said fences in a list were
    // not looked for. One within three spaces of the margin is.
    it('replaces a fence in a list item within three spaces, and leaves deeper or quoted ones', () => {
        const inItem = `- Scores:\n\n  \`\`\`chart\n  ${CHART_BODY}\n  \`\`\`\n- Next`;
        expect(toPlainText(inItem, { chart })).toBe('- Scores:\n\n[chart: Average score per month]\n- Next');
        const numbered = `1. Scores:\n\n   \`\`\`chart\n   ${CHART_BODY}\n   \`\`\``;
        expect(toPlainText(numbered, { chart })).toBe('1. Scores:\n\n[chart: Average score per month]');

        const nested = `- Scores:\n  - March:\n\n    \`\`\`chart\n    ${CHART_BODY}\n    \`\`\``;
        const quoted = `> \`\`\`chart\n> ${CHART_BODY}\n> \`\`\``;
        const onTheMarker = `- \`\`\`chart\n  ${CHART_BODY}\n  \`\`\``;
        expect(toPlainText(nested, { chart })).toBe(nested);
        expect(toPlainText(quoted, { chart })).toBe(quoted);
        expect(toPlainText(onTheMarker, { chart })).toBe(onTheMarker);
    });
});

describe('extractBlocks', () => {
    it('lists the blocks of the given languages, keyed as the renderer keys them', () => {
        const markdown = [
            '```report',
            '{"title":"Q3"}',
            '```',
            'Intro',
            '```chart wide',
            CHART_BODY,
            '```',
            '```bash',
            'ls',
            '```',
        ].join('\n');

        const blocks = extractBlocks(markdown, ['chart', 'table'], 'm-1');

        expect(blocks).toEqual([{
            language: 'chart',
            source: CHART_BODY,
            meta: 'wide',
            blockKey: blockKeyOf('chart', CHART_BODY),
            messageId: 'm-1',
        }]);
    });

    it("removes the fence's own indentation from its body, as the parser does", () => {
        const [block] = extractBlocks('  ```table\n  {"a":1}\n    {"b":2}\n  ```', ['table']);
        expect(block.source).toBe('{"a":1}\n  {"b":2}');
    });

    it('reads Windows line endings', () => {
        const [block] = extractBlocks('```chart\r\n{}\r\n```\r\n', ['chart']);
        expect(block.source).toBe('{}');
    });

    it('finds nothing in nothing', () => {
        expect(extractBlocks('', ['chart'])).toEqual([]);
        expect(extractBlocks('no fences here', ['chart'])).toEqual([]);
    });

    // 2026-10-14: the renderer draws a fence the answer ended inside without
    // the text's final line break; the extracted body (and so the key a block
    // is saved and indexed under) kept it.
    it('reads a fence the answer ended inside as the renderer draws it: without the final line break', () => {
        expect(extractBlocks('```chart\n{"a":1}', ['chart'])[0].source).toBe('{"a":1}');
        expect(extractBlocks('```chart\n{"a":1}\n', ['chart'])[0].source).toBe('{"a":1}');
        // One line break only: a blank line before the end stays a line of the body.
        expect(extractBlocks('```chart\n{"a":1}\n\n', ['chart'])[0].source).toBe('{"a":1}\n');
        expect(extractBlocks('```chart\r\n{"a":1}\r\n', ['chart'])[0]).toMatchObject({
            source: '{"a":1}',
            blockKey: blockKeyOf('chart', '{"a":1}'),
        });
        // A closed fence is as it was: its body never ends in its closing line's break.
        expect(extractBlocks('```chart\n{"a":1}\n\n```\n', ['chart'])[0].source).toBe('{"a":1}\n');
    });
});

describe('scanBlocks', () => {
    it('says which fences have closed', () => {
        const blocks = scanBlocks('```chart\n{"a":1}\n```\n\n```table\n{"b":', ['chart', 'table'], 'm-1');
        expect(blocks.map(block => [block.language, block.closed, block.source, block.messageId])).toEqual([
            ['chart', true, '{"a":1}', 'm-1'],
            ['table', false, '{"b":', 'm-1'],
        ]);
    });
});

describe('blockLanguagesOf', () => {
    it('keeps what the platform takes, once each, sorted, at most 16', () => {
        expect(blockLanguagesOf(['table', 'chart', 'chart', 'KPI', 'report_v2', 'a-b', '9x', '', 'x'.repeat(33)]))
            .toEqual(['a-b', 'chart', 'report_v2', 'table']);
        const many = Array.from({ length: 20 }, (_, index) => `l${String(index).padStart(2, '0')}`);
        expect(blockLanguagesOf(many)).toEqual(many.slice(0, 16));
        expect(blockLanguagesOf(null)).toEqual([]);
        expect(blockLanguagesOf(new Set(['kpi']))).toEqual(['kpi']);
    });
});

describe('rendererFor', () => {
    it("finds a map's own renderer for a language", () => {
        expect(rendererFor({ chart }, 'chart')).toBe(chart);
        expect(rendererFor({ chart }, 'table')).toBeUndefined();
        expect(rendererFor({ chart }, '')).toBeUndefined();
        expect(rendererFor(null, 'chart')).toBeUndefined();
    });

    it('finds nothing a plain object inherits, whatever language a fence names', () => {
        // ```constructor found Object.prototype.constructor and crashed the transcript (review, 2026-10-14).
        for (const language of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', '__defineGetter__']) {
            expect(rendererFor({ chart }, language)).toBeUndefined();
        }
    });

    it('skips an own entry the chat cannot draw', () => {
        const broken = { chart: { label: 'chart' } } as unknown as Record<string, BlockRenderer>;
        expect(rendererFor(broken, 'chart')).toBeUndefined();
        expect(rendererFor({ chart: null } as unknown as Record<string, BlockRenderer>, 'chart')).toBeUndefined();
    });
});

describe('isComponentType and isBlockRenderer', () => {
    it('take what React renders as a component', () => {
        class Klass extends React.Component { render() { return null; } }
        expect(isComponentType(Noop)).toBe(true);
        expect(isComponentType(Klass)).toBe(true);
        expect(isComponentType(React.memo(Noop))).toBe(true);
        expect(isComponentType(React.forwardRef(() => null))).toBe(true);
        expect(isComponentType(React.lazy(async () => ({ default: Noop })))).toBe(true);
    });

    it('refuse what React would throw on', () => {
        for (const value of [undefined, null, 'chart', 42, {}, { render: Noop }]) {
            expect(isComponentType(value)).toBe(false);
        }
        expect(isBlockRenderer({ component: Noop })).toBe(true);
        expect(isBlockRenderer({ component: undefined })).toBe(false);
        expect(isBlockRenderer({})).toBe(false);
        expect(isBlockRenderer(Noop)).toBe(false);
    });
});

describe('toPlainText and inherited names', () => {
    it('leaves a fence named after an inherited member as written', () => {
        const markdown = '```constructor\nnew Foo()\n```\n\n```toString\nx\n```';
        expect(toPlainText(markdown, { chart })).toBe(markdown);
        expect(toPlainText(markdown, {})).toBe(markdown);
    });
});

describe('normalizeLineEndings', () => {
    it('writes every line ending as \\n', () => {
        expect(normalizeLineEndings('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
    });
});
