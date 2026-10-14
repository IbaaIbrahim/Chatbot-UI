import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The files dialog's stylesheet, read as text (review of 2026-10-14): the
 * rules an older browser or Chromium would drop, and the dialog's colours
 * measured against WCAG 2.x — 4.5:1 for its small text, 3:1 for icons, focus
 * rings and the filter's chosen option. Each colour is the one its rule in
 * Files.css names, resolved through the theme tokens in styles.css, so a rule
 * that moves to another token is measured again.
 */

// Read from disk: vitest hands a stylesheet to a test empty, even as `?raw`.
const uncomment = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const filesCss = uncomment(readFileSync(new URL('./Files.css', import.meta.url), 'utf8'));
const tokensCss = uncomment(readFileSync(new URL('../../styles.css', import.meta.url), 'utf8'));

/** Every rule's selector list (at-rule preludes and keyframe steps left out). */
function selectorLists(css: string): string[] {
    return Array.from(css.matchAll(/([^{};]+)\{/g))
        .map(match => match[1].trim())
        .filter(selector => selector && !selector.startsWith('@') && !/^(from|to|\d+%)/.test(selector));
}

/**
 * The declarations of every rule whose selector list ends, on a line of its
 * own, with `selector` — at the top level or in a media query — in order.
 */
function declarationsOf(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bodies = Array.from(filesCss.matchAll(new RegExp(`(?:^|\\n)[ \\t]*${escaped} \\{([^}]*)\\}`, 'g')), match => match[1]);
    if (bodies.length === 0) throw new Error(`no rule for ${selector}`);
    return bodies.join(';');
}

/** The value the rules give `property` — the last declaration of it, as the cascade keeps. */
function valueOf(selector: string, property: string): string {
    const values = Array.from(declarationsOf(selector).matchAll(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`, 'g')));
    if (values.length === 0) throw new Error(`${selector} sets no ${property}`);
    return values[values.length - 1][1].trim();
}

describe('Files.css', () => {
    it('keeps every :has() selector in a rule of its own, so a browser without it drops nothing else', () => {
        const mixed = selectorLists(filesCss).filter(list => list.includes(':has(') && list.split(',').length > 1);
        expect(mixed).toEqual([]);
    });

    it('gives every match-parent its -webkit- spelling first, the one Chromium reads', () => {
        const unprefixed = Array.from(filesCss.matchAll(/text-align:\s*match-parent/g));
        const prefixed = Array.from(filesCss.matchAll(/text-align:\s*-webkit-match-parent;\s*text-align:\s*match-parent/g));
        expect(unprefixed.length).toBeGreaterThan(0);
        expect(prefixed.length).toBe(unprefixed.length);
    });

    it('draws its focus rings in the strong accent, not the half-transparent focus token', () => {
        expect(filesCss).not.toContain('--cb-border-focus');
        expect(valueOf(':root .cb-files-load-more:focus-visible', 'outline')).toMatch(/^2px solid var\(--cb-accent-strong/);
        expect(valueOf(':root .cb-files-segment:focus-visible', 'outline')).toMatch(/^2px solid var\(--cb-accent-strong/);
    });

    it('pads the error box and the filter options by logical sides', () => {
        expect(declarationsOf('.cb-files-panel .cb-files-error')).not.toMatch(/(^|\s)padding:/);
        expect(valueOf('.cb-files-panel .cb-files-error', 'padding-inline')).toBe('var(--cb-space-4) var(--cb-space-3)');
        expect(valueOf(':root .cb-files-panel .cb-files-segment', 'padding-inline')).toBe('12px 10px');
    });

    it('fades the scrim without moving it; the dialog alone rises', () => {
        expect(valueOf('.cb-files-overlay', 'animation')).toMatch(/^cb-files-scrim-in /);
        const scrimIn = /@keyframes cb-files-scrim-in\s*\{([\s\S]*?)\n\}/.exec(filesCss);
        expect(scrimIn?.[1]).toContain('opacity');
        expect(scrimIn?.[1]).not.toContain('transform');
    });
});

// --- Contrast ------------------------------------------------------------------

type Rgba = [number, number, number, number];
type Tokens = Record<string, string>;

/** One theme's tokens: the defaults (dark), or the light block over them. */
function themeTokens(theme: 'dark' | 'light'): Tokens {
    const read = (block: string): Tokens => Object.fromEntries(
        Array.from(block.matchAll(/(--cb-[\w-]+):\s*([^;]+?)\s*(?:!important)?;/g)).map(match => [match[1], match[2].trim()])
    );
    const blockAfter = (marker: string) => {
        const start = tokensCss.indexOf('{', tokensCss.indexOf(marker));
        return tokensCss.slice(start + 1, tokensCss.indexOf('}', start));
    };
    const dark = read(blockAfter('.cb-chat-container,'));
    return theme === 'dark' ? dark : { ...dark, ...read(blockAfter(".cb-chat-container[data-theme='light'],")) };
}

const TRANSPARENT: Rgba = [0, 0, 0, 0];

/** A colour as the stylesheets write one: hex, rgba(), var() and color-mix(in srgb, …). */
function colour(value: string, tokens: Tokens): Rgba {
    const text = value.trim();
    if (text === 'transparent') return TRANSPARENT;
    const variable = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(text);
    if (variable) {
        const found = tokens[variable[1]] ?? variable[2];
        if (found === undefined) throw new Error(`no token ${variable[1]}`);
        return colour(found, tokens);
    }
    const hex = /^#([0-9a-f]{6})$/i.exec(text);
    if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as Rgba;
    const rgba = /^rgba?\(([^)]+)\)$/.exec(text);
    if (rgba) {
        const [r, g, b, a = '1'] = rgba[1].split(',').map(part => part.trim());
        return [Number(r), Number(g), Number(b), Number(a)];
    }
    const mixed = /^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)$/.exec(text);
    if (mixed) return mix(colour(mixed[1], tokens), Number(mixed[2]) / 100, colour(mixed[3], tokens));
    throw new Error(`not a colour: ${text}`);
}

/** color-mix in sRGB, with premultiplied alpha, as CSS mixes. */
function mix(first: Rgba, share: number, second: Rgba): Rgba {
    const alpha = first[3] * share + second[3] * (1 - share);
    if (alpha === 0) return TRANSPARENT;
    const channel = (i: number) => (first[i] * first[3] * share + second[i] * second[3] * (1 - share)) / alpha;
    return [channel(0), channel(1), channel(2), alpha];
}

/** `top` painted over an opaque `below`. */
function over(top: Rgba, below: Rgba): Rgba {
    return [0, 1, 2].map(i => top[i] * top[3] + below[i] * (1 - top[3])).concat(1) as Rgba;
}

function luminance([r, g, b]: Rgba): number {
    const linear = (value: number) => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2.x contrast of `foreground` painted on the opaque `background`. */
function contrast(foreground: Rgba, background: Rgba): number {
    const [high, low] = [luminance(over(foreground, background)), luminance(background)].sort((a, b) => b - a);
    return (high + 0.05) / (low + 0.05);
}

const KINDS = ['chart', 'table', 'kpi', 'report', 'image', 'pdf', 'spreadsheet', 'file'];

describe.each(['dark', 'light'] as const)('the files dialog in the %s theme', theme => {
    const tokens = themeTokens(theme);
    const paint = (selector: string, property: string, extra: Tokens = {}) =>
        colour(valueOf(selector, property), { ...tokens, ...extra });
    const dialog = colour(valueOf('.cb-files-panel', 'background-color'), tokens);
    const hoveredRow = over(paint('.cb-files-panel .cb-file-row:hover', 'background-color'), dialog);
    const track = over(paint('.cb-files-panel .cb-files-segmented', 'background-color'), dialog);
    const chosen = over(paint(':root .cb-files-panel .cb-files-segment.is-active', 'background-color'), track);

    it("draws every kind's icon at 3:1 or more on its tile, hovered or not", () => {
        KINDS.forEach(kind => {
            const kindTokens = { '--cb-file-kind': `var(--cb-kind-${kind})` };
            const icon = paint('.cb-file-thumb', 'color', kindTokens);
            const tile = paint('.cb-file-thumb', 'background-color', kindTokens);
            expect(contrast(icon, over(tile, dialog)), kind).toBeGreaterThanOrEqual(3);
            expect(contrast(icon, over(tile, hoveredRow)), `${kind}, hovered`).toBeGreaterThanOrEqual(3);
        });
        const folder = paint('.cb-files-panel .cb-files-header-icon', 'color');
        const folderTile = over(paint('.cb-files-panel .cb-files-header-icon', 'background-color'), dialog);
        expect(contrast(folder, folderTile), "the header's folder").toBeGreaterThanOrEqual(3);
    });

    it('rings focus at 3:1 or more wherever it lands', () => {
        const ring = colour(valueOf(':root .cb-files-load-more:focus-visible', 'outline').replace(/^2px solid /, ''), tokens);
        [dialog, hoveredRow, track, chosen].forEach(below => expect(contrast(ring, below)).toBeGreaterThanOrEqual(3));
    });

    it('shows the filter: the chosen option edged at 3:1 on its track, labels and counts at 4.5:1', () => {
        const edge = /1px (var\(.+\))$/.exec(valueOf(':root .cb-files-panel .cb-files-segment.is-active', 'box-shadow'));
        expect(edge).not.toBeNull();
        expect(contrast(colour(edge![1], tokens), track), 'the edge').toBeGreaterThanOrEqual(3);
        expect(contrast(paint(':root .cb-files-segment', 'color'), track), 'a label').toBeGreaterThanOrEqual(4.5);
        expect(contrast(paint(':root .cb-files-segment.is-active', 'color'), chosen), 'the chosen label').toBeGreaterThanOrEqual(4.5);
        const pill = over(paint('.cb-files-segment-count', 'background-color'), track);
        expect(contrast(paint('.cb-files-segment-count', 'color'), pill), 'a count').toBeGreaterThanOrEqual(4.5);
        const emptyCount = '.cb-files-segment.is-empty:not(.is-active) .cb-files-segment-count';
        expect(contrast(paint(emptyCount, 'color'), over(paint(emptyCount, 'background-color'), track)), 'a count of nothing')
            .toBeGreaterThanOrEqual(4.5);
        const chosenCount = '.cb-files-segment.is-active .cb-files-segment-count';
        expect(contrast(paint(chosenCount, 'color'), over(paint(chosenCount, 'background-color'), chosen)), 'the chosen count')
            .toBeGreaterThanOrEqual(4.5);
        const sectionPill = over(paint('.cb-files-section-count', 'background-color'), dialog);
        expect(contrast(paint('.cb-files-section-count', 'color'), sectionPill), "a section's count").toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the details, the marks and the empty state readable', () => {
        expect(contrast(paint('.cb-files-panel .cb-file-meta', 'color'), hoveredRow), 'details').toBeGreaterThanOrEqual(4.5);
        expect(contrast(paint(':root .cb-files-subtitle', 'color'), dialog), 'the subtitle').toBeGreaterThanOrEqual(4.5);
        // Not saved: its word and, where the word is hidden, its dashed icon, in one colour.
        expect(contrast(paint('.cb-file-status.is-unsaved', 'color'), hoveredRow), 'Not saved').toBeGreaterThanOrEqual(4.5);
        const savedPill = over(paint('.cb-file-status.is-saved', 'background-color'), hoveredRow);
        expect(contrast(paint('.cb-file-status.is-saved', 'color'), savedPill), 'Saved').toBeGreaterThanOrEqual(4.5);
        expect(contrast(paint('.cb-file-status.is-saved .cb-file-status-icon', 'color'), savedPill), "Saved's icon")
            .toBeGreaterThanOrEqual(3);
        const circle = over(paint('.cb-files-empty-icon', 'background-color'), dialog);
        // Decoration, held to no WCAG ratio — but seen: the sunken fill it had
        // was 1.05:1 on the dark dialog; the light theme's is 1.13:1.
        expect(contrast(circle, dialog), 'the empty circle is there').toBeGreaterThanOrEqual(1.1);
        expect(contrast(paint('.cb-files-empty-icon', 'color'), circle), 'the empty folder').toBeGreaterThanOrEqual(3);
    });
});
