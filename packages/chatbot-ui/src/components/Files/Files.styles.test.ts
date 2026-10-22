import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The files dialog's and the Artifacts view's stylesheet, read as text
 * (reviews of 2026-10-14): the rules an older browser or Chromium would drop,
 * and the colours measured against WCAG 2.x — 4.5:1 for small text, 3:1 for
 * icons, focus rings and a filter's chosen option. Each colour is the one its
 * rule in Files.css names, resolved through the theme tokens in styles.css,
 * so a rule that moves to another token is measured again. Last, the chat's
 * focus ring token on every surface (and on a message's edit box), its plain
 * light colour for a browser without color-mix(), and every focus rule in the
 * library.
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
 * The bodies of every rule whose selector list ends, on a line of its own,
 * with `selector` — at the top level or in a media query — in order.
 */
function rulesOf(selector: string): string[] {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return Array.from(filesCss.matchAll(new RegExp(`(?:^|\\n)[ \\t]*${escaped} \\{([^}]*)\\}`, 'g')), match => match[1]);
}

/** The declarations of those rules, in order. */
function declarationsOf(selector: string): string {
    const bodies = rulesOf(selector);
    if (bodies.length === 0) throw new Error(`no rule for ${selector}`);
    return bodies.join(';');
}

/** The last declaration of `property` in `declarations`, as the cascade keeps; `null` without one. */
function lastDeclared(declarations: string, property: string): string | null {
    const values = Array.from(declarations.matchAll(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`, 'g')));
    return values.length > 0 ? values[values.length - 1][1].trim() : null;
}

/** The value the rules give `property` — the last declaration of it, as the cascade keeps. */
function valueOf(selector: string, property: string): string {
    const value = lastDeclared(declarationsOf(selector), property);
    if (value === null) throw new Error(`${selector} sets no ${property}`);
    return value;
}

/**
 * The value `property` gets on an element every one of `selectors` matches,
 * listed from the weakest rule to the strongest (specificity, then source
 * order): the strongest that sets it. A selector with no rule is passed over,
 * so a rule added later, at its place in the list, is measured too.
 */
function cascadedValue(selectors: string[], property: string): string {
    for (const selector of [...selectors].reverse()) {
        const value = lastDeclared(rulesOf(selector).join(';'), property);
        if (value !== null) return value;
    }
    throw new Error(`none of ${selectors.join(' / ')} sets ${property}`);
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

    it("draws its focus rings in the chat's focus ring, not the half-transparent accent edge", () => {
        expect(filesCss).not.toContain('--cb-border-focus');
        expect(valueOf(':root .cb-files-load-more:focus-visible', 'outline')).toMatch(/^2px solid var\(--cb-focus-ring/);
        expect(valueOf(':root .cb-files-segment:focus-visible', 'outline')).toMatch(/^2px solid var\(--cb-focus-ring/);
        expect(valueOf('.cb-files-title:focus-visible', 'outline')).toMatch(/^2px solid var\(--cb-focus-ring/);
    });

    it("gives both filters one segmented control's colours: the files dialog's rules set its shape alone", () => {
        ['background', 'background-color', 'border', 'border-color', 'color', 'box-shadow', 'font-weight'].forEach(property => {
            [
                '.cb-files-panel .cb-files-segmented',
                ':root .cb-files-panel .cb-files-segment',
                ':root .cb-files-panel .cb-files-segment.is-active',
            ].forEach(selector => expect(lastDeclared(rulesOf(selector).join(';'), property), `${selector} ${property}`).toBeNull());
        });
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

/** The tokens a rule's declarations set. */
const readTokens = (block: string): Tokens => Object.fromEntries(
    Array.from(block.matchAll(/(--cb-[\w-]+):\s*([^;]+?)\s*(?:!important)?;/g)).map(match => [match[1], match[2].trim()])
);

/** One theme's tokens: the defaults (dark), or the light block over them. */
function themeTokens(theme: 'dark' | 'light'): Tokens {
    const read = readTokens;
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

/** `list` split at its top-level commas — not those inside a function's parentheses. */
function topLevelParts(list: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < list.length; i++) {
        if (list[i] === '(') depth++;
        if (list[i] === ')') depth--;
        if (list[i] === ',' && depth === 0) {
            parts.push(list.slice(start, i).trim());
            start = i + 1;
        }
    }
    return parts.concat(list.slice(start).trim());
}

/** The colours a value paints: one colour, or a `linear-gradient()`'s stops in order. */
function paints(value: string, tokens: Tokens): Rgba[] {
    const text = value.trim();
    const variable = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(text);
    if (variable) {
        const found = tokens[variable[1]] ?? variable[2];
        if (found === undefined) throw new Error(`no token ${variable[1]}`);
        return paints(found, tokens);
    }
    const gradient = /^linear-gradient\((.+)\)$/.exec(text);
    if (gradient) return topLevelParts(gradient[1]).slice(1).map(stop => colour(stop.replace(/\s+\d+%$/, ''), tokens));
    return [colour(text, tokens)];
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

/**
 * The two places the lists are drawn, and the rules each part takes its
 * colour from there, weakest first (see `cascadedValue`): the files dialog,
 * over the chat, and the Artifacts view, in the chat's column (2026-10-14).
 */
const PLACES = [
    {
        place: 'the files dialog',
        surface: ['.cb-files-panel'],
        hoveredRow: ['.cb-file-row:hover', '.cb-files-panel .cb-file-row:hover'],
        details: ['.cb-file-meta', '.cb-files-panel .cb-file-meta'],
        track: ['.cb-files-segmented', '.cb-files-panel .cb-files-segmented'],
        option: [':root .cb-files-segment', ':root .cb-files-panel .cb-files-segment'],
        // `.is-active` weighs what the dialog's option rule does, which comes later.
        chosen: [
            ':root .cb-files-segment',
            ':root .cb-files-segment.is-active',
            ':root .cb-files-panel .cb-files-segment',
            ':root .cb-files-panel .cb-files-segment.is-active',
        ],
    },
    {
        place: 'the Artifacts view',
        surface: ['.cb-artifacts-view'],
        hoveredRow: ['.cb-file-row:hover'],
        details: ['.cb-file-meta'],
        track: ['.cb-files-segmented'],
        option: [':root .cb-files-segment'],
        chosen: [':root .cb-files-segment', ':root .cb-files-segment.is-active'],
    },
];

describe.each(['dark', 'light'] as const)('the files lists in the %s theme', theme => {
    const tokens = themeTokens(theme);
    const paint = (selector: string, property: string, extra: Tokens = {}) =>
        colour(valueOf(selector, property), { ...tokens, ...extra });
    const cascaded = (selectors: string[], property: string) => colour(cascadedValue(selectors, property), tokens);

    describe.each(PLACES)('$place', place => {
        const surface = cascaded(place.surface, 'background-color');
        const hoveredRow = over(cascaded(place.hoveredRow, 'background-color'), surface);
        const track = over(cascaded(place.track, 'background-color'), surface);
        const chosen = over(cascaded(place.chosen, 'background-color'), track);

        it("draws every kind's icon at 3:1 or more on its tile, hovered or not", () => {
            KINDS.forEach(kind => {
                const kindTokens = { '--cb-file-kind': `var(--cb-kind-${kind})` };
                const icon = paint('.cb-file-thumb', 'color', kindTokens);
                const tile = paint('.cb-file-thumb', 'background-color', kindTokens);
                expect(contrast(icon, over(tile, surface)), kind).toBeGreaterThanOrEqual(3);
                expect(contrast(icon, over(tile, hoveredRow)), `${kind}, hovered`).toBeGreaterThanOrEqual(3);
            });
        });

        it('rings focus at 3:1 or more wherever it lands', () => {
            ['.cb-files-title:focus-visible', ':root .cb-files-load-more:focus-visible', ':root .cb-files-segment:focus-visible']
                .forEach(selector => {
                    const ring = colour(valueOf(selector, 'outline').replace(/^2px solid /, ''), tokens);
                    [surface, hoveredRow, track, chosen].forEach(below => expect(contrast(ring, below), selector).toBeGreaterThanOrEqual(3));
                });
            const field = over(paint(':root .cb-files-search-input', 'background-color'), surface);
            const edge = colour(valueOf(':root .cb-files-search-input:focus', 'border-color'), tokens);
            expect(contrast(edge, field), 'the search field, focused').toBeGreaterThanOrEqual(3);
            expect(contrast(edge, surface), 'the search field, focused, on the page').toBeGreaterThanOrEqual(3);
        });

        it('shows the filter: the chosen option edged at 3:1 on its track and bolder, labels and counts at 4.5:1', () => {
            const edge = /1px (var\(.+\))$/.exec(cascadedValue(place.chosen, 'box-shadow'));
            expect(edge).not.toBeNull();
            expect(contrast(colour(edge![1], tokens), track), 'the edge').toBeGreaterThanOrEqual(3);
            expect(cascadedValue(place.option, 'font-weight'), 'an option').toBe('500');
            expect(cascadedValue(place.chosen, 'font-weight'), 'the chosen option').toBe('600');
            expect(contrast(cascaded(place.option, 'color'), track), 'a label').toBeGreaterThanOrEqual(4.5);
            expect(contrast(cascaded(place.chosen, 'color'), chosen), 'the chosen label').toBeGreaterThanOrEqual(4.5);
            // The Artifacts view's filter shows no counts yet; a count it shows is drawn so.
            const pill = over(paint('.cb-files-segment-count', 'background-color'), track);
            expect(contrast(paint('.cb-files-segment-count', 'color'), pill), 'a count').toBeGreaterThanOrEqual(4.5);
            const emptyCount = '.cb-files-segment.is-empty:not(.is-active) .cb-files-segment-count';
            expect(contrast(paint(emptyCount, 'color'), over(paint(emptyCount, 'background-color'), track)), 'a count of nothing')
                .toBeGreaterThanOrEqual(4.5);
            const chosenCount = '.cb-files-segment.is-active .cb-files-segment-count';
            expect(contrast(paint(chosenCount, 'color'), over(paint(chosenCount, 'background-color'), chosen)), 'the chosen count')
                .toBeGreaterThanOrEqual(4.5);
        });

        it("keeps a row's details and its mark readable, hovered or not", () => {
            const details = cascaded(place.details, 'color');
            expect(contrast(details, surface), 'details').toBeGreaterThanOrEqual(4.5);
            expect(contrast(details, hoveredRow), 'details, hovered').toBeGreaterThanOrEqual(4.5);
            // Not saved: its word and, where the word is hidden, its dashed icon, in one colour.
            expect(contrast(paint('.cb-file-status.is-unsaved', 'color'), hoveredRow), 'Not saved').toBeGreaterThanOrEqual(4.5);
            const savedPill = over(paint('.cb-file-status.is-saved', 'background-color'), hoveredRow);
            expect(contrast(paint('.cb-file-status.is-saved', 'color'), savedPill), 'Saved').toBeGreaterThanOrEqual(4.5);
            expect(contrast(paint('.cb-file-status.is-saved .cb-file-status-icon', 'color'), savedPill), "Saved's icon")
                .toBeGreaterThanOrEqual(3);
        });
    });

    describe('the files dialog alone', () => {
        const dialog = paint('.cb-files-panel', 'background-color');

        it("draws the header's folder at 3:1 and its subtitle and the sections' counts at 4.5:1", () => {
            const folder = paint('.cb-files-panel .cb-files-header-icon', 'color');
            const folderTile = over(paint('.cb-files-panel .cb-files-header-icon', 'background-color'), dialog);
            expect(contrast(folder, folderTile), "the header's folder").toBeGreaterThanOrEqual(3);
            expect(contrast(paint(':root .cb-files-subtitle', 'color'), dialog), 'the subtitle').toBeGreaterThanOrEqual(4.5);
            const sectionPill = over(paint('.cb-files-section-count', 'background-color'), dialog);
            expect(contrast(paint('.cb-files-section-count', 'color'), sectionPill), "a section's count").toBeGreaterThanOrEqual(4.5);
        });

        it('keeps the empty state seen and its folder at 3:1', () => {
            const circle = over(paint('.cb-files-empty-icon', 'background-color'), dialog);
            // Decoration, held to no WCAG ratio — but seen: the sunken fill it had
            // was 1.05:1 on the dark dialog; the light theme's is 1.13:1.
            expect(contrast(circle, dialog), 'the empty circle is there').toBeGreaterThanOrEqual(1.1);
            expect(contrast(paint('.cb-files-empty-icon', 'color'), circle), 'the empty folder').toBeGreaterThanOrEqual(3);
        });
    });

    describe('the Artifacts view alone', () => {
        const page = paint('.cb-artifacts-view', 'background-color');

        it("draws an opened artifact's details line at 4.5:1 on the page, under a header of the page's colour", () => {
            // Nothing between the line and the page paints a colour of its own.
            ['.cb-artifact-detail', '.cb-files-header', '.cb-files-header.cb-artifact-detail-header', ':root .cb-artifact-detail-meta']
                .forEach(selector => {
                    const declarations = rulesOf(selector).join(';');
                    expect(lastDeclared(declarations, 'background'), selector).toBeNull();
                    expect(lastDeclared(declarations, 'background-color'), selector).toBeNull();
                });
            expect(contrast(paint(':root .cb-artifact-detail-meta', 'color'), page)).toBeGreaterThanOrEqual(4.5);
        });
    });
});

// --- The chat's focus ring --------------------------------------------------------

/** The library's stylesheets other than the tokens, by their path under `src/components`. */
function componentStylesheets(): Array<{ file: string; css: string }> {
    const root = new URL('../', import.meta.url);
    return readdirSync(root, { recursive: true, encoding: 'utf8' })
        .filter(file => file.endsWith('.css'))
        .sort()
        .map(file => ({ file, css: uncomment(readFileSync(new URL(file, root), 'utf8')) }));
}

/** Every rule whose selector list names a focus state, with its declarations. */
function focusRules(css: string): Array<{ selector: string; body: string }> {
    return Array.from(css.matchAll(/([^{};]+)\{([^{}]*)\}/g))
        .map(match => ({ selector: match[1].trim().replace(/\s+/g, ' '), body: match[2] }))
        .filter(rule => rule.selector.includes(':focus'));
}

/**
 * The surfaces a ring lands on (review of 2026-10-14): the four backgrounds,
 * and each under the lifts the chat draws on them — a hovered row or menu
 * item, a raised or sunken box, a chosen option, a glass header.
 */
const BACKGROUNDS = ['--cb-bg-primary', '--cb-bg-secondary', '--cb-bg-tertiary', '--cb-bg-elevated'];
const LIFTS = ['--cb-surface-hover', '--cb-surface-raised', '--cb-surface-sunken', '--cb-surface-selected', '--cb-glass-bg'];

/** The ring is solid, and 3:1 or more on every background, lifted or not. */
function expectRingOnEverySurface(tokens: Tokens) {
    const ring = colour('var(--cb-focus-ring)', tokens);
    expect(ring[3]).toBe(1);
    BACKGROUNDS.forEach(background => {
        const below = colour(`var(${background})`, tokens);
        expect(contrast(ring, below), background).toBeGreaterThanOrEqual(3);
        LIFTS.forEach(lift => {
            expect(contrast(ring, over(colour(`var(${lift})`, tokens), below)), `${lift} on ${background}`)
                .toBeGreaterThanOrEqual(3);
        });
    });
}

/**
 * The last value `property` gets from the rules of `css` whose selector list
 * is `selector`, on a line of its own; `null` without one.
 */
function declaredIn(css: string, selector: string, property: string): string | null {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bodies = Array.from(css.matchAll(new RegExp(`(?:^|\\n)[ \\t]*${escaped} \\{([^}]*)\\}`, 'g')), match => match[1]);
    return lastDeclared(bodies.join(';'), property);
}

describe.each(['dark', 'light'] as const)('the focus ring in the %s theme', theme => {
    const tokens = themeTokens(theme);
    const ring = colour('var(--cb-focus-ring)', tokens);

    it('is solid, and 3:1 or more on every surface of the chat, lifted or not', () => {
        expectRingOnEverySurface(tokens);
    });

    it('is what the half-transparent accent edge was not', () => {
        const edge = colour('var(--cb-border-focus)', tokens);
        expect(contrast(edge, colour('var(--cb-bg-primary)', tokens))).toBeLessThan(3);
    });

    it("rings a message's edit field at 3:1 on its box and on the field, and keeps the box's words readable", () => {
        // The box is drawn in place of the user's bubble, on whatever the chat's
        // background is; until 2026-10-14 its colours were dark literals.
        const sheet = componentStylesheets().find(({ file }) => file === 'MessageBubble/MessageBubble.css')!.css;
        const paintIn = (selector: string, property: string) => {
            const value = declaredIn(sheet, selector, property);
            if (value === null) throw new Error(`${selector} sets no ${property}`);
            return colour(value, tokens);
        };
        const edge = paintIn('.cb-edit-textarea:focus', 'border-color');
        const outline = colour(declaredIn(sheet, '.cb-edit-textarea:focus-visible', 'outline')!.replace(/^2px solid /, ''), tokens);
        expect(edge).toEqual(ring);
        expect(outline).toEqual(ring);
        BACKGROUNDS.forEach(background => {
            const box = over(paintIn('.cb-edit-container', 'background'), colour(`var(${background})`, tokens));
            const field = over(paintIn('.cb-edit-textarea', 'background'), box);
            const focused = over(paintIn('.cb-edit-textarea:focus', 'background'), box);
            expect(contrast(ring, box), `the ring on the box, on ${background}`).toBeGreaterThanOrEqual(3);
            expect(contrast(ring, focused), `the ring on the focused field, on ${background}`).toBeGreaterThanOrEqual(3);
            const text = paintIn('.cb-edit-textarea', 'color');
            expect(contrast(text, field), `the text, on ${background}`).toBeGreaterThanOrEqual(4.5);
            expect(contrast(text, focused), `the text, focused, on ${background}`).toBeGreaterThanOrEqual(4.5);
            expect(contrast(paintIn('.cb-edit-cancel', 'color'), box), `Cancel, on ${background}`).toBeGreaterThanOrEqual(4.5);
            const hovered = over(paintIn('.cb-edit-cancel:hover', 'background'), box);
            expect(contrast(paintIn('.cb-edit-cancel:hover', 'color'), hovered), `Cancel, hovered, on ${background}`)
                .toBeGreaterThanOrEqual(4.5);
        });
    });
});

/** Where the stylesheet gives a browser without `color-mix()` plain colours instead. */
const NO_COLOR_MIX = '@supports not (color: color-mix(in srgb, red 50%, blue))';
/** The tokens' own rule, both themes' base. */
const BASE_SELECTOR = '.cb-chat-container, .cb-chat-launcher, .cb-root';

/** The text of the block that opens at or after `start`, braces balanced, with its prelude. */
function blockFrom(css: string, start: number): string {
    let depth = 0;
    for (let i = css.indexOf('{', start); i < css.length; i++) {
        if (css[i] === '{') depth++;
        if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
    }
    throw new Error(`unbalanced block at ${start}`);
}

/** The innermost rules of `css` that set tokens, by their selector list, whitespace collapsed. */
function tokenRules(css: string): Array<{ selector: string; tokens: Tokens }> {
    return Array.from(css.matchAll(/([^{};]+)\{([^{}]*)\}/g))
        .map(match => ({ selector: match[1].trim().replace(/\s+/g, ' '), tokens: readTokens(match[2]) }))
        .filter(rule => Object.keys(rule.tokens).length > 0);
}

describe('the focus ring in a browser without color-mix()', () => {
    // A custom property that substitutes to a value the browser cannot parse
    // voids the declaration using it: `outline: 2px solid var(--cb-focus-ring)`
    // drew no outline at all in the light theme (review of 2026-10-14).
    const start = tokensCss.indexOf(NO_COLOR_MIX);
    const fallback = start === -1 ? '' : blockFrom(tokensCss, start);
    const fallbackRules = tokenRules(fallback);
    const mixedRules = tokenRules(tokensCss.replace(fallback, ''))
        .map(rule => ({ selector: rule.selector, names: Object.keys(rule.tokens).filter(name => rule.tokens[name].includes('color-mix(')) }))
        .filter(rule => rule.names.length > 0);

    it('gives every token mixed with color-mix() a plain colour there, in each block that mixes it', () => {
        expect(start).toBeGreaterThan(-1);
        // The base block (the accent's derived tokens, 2026-10-22) and the
        // light theme's two blocks, and nothing else, mix a token.
        expect(mixedRules.map(rule => rule.selector)).toEqual([
            BASE_SELECTOR,
            ".cb-chat-container[data-theme='light'], .cb-chat-launcher[data-theme='light'], .cb-root[data-theme='light']",
            ".cb-chat-container:not([data-theme='dark']), .cb-chat-launcher:not([data-theme='dark']), .cb-root:not([data-theme='dark'])",
        ]);
        // The third one, as its own, under the OS's light preference.
        expect(fallback.indexOf('@media (prefers-color-scheme: light)')).toBeGreaterThan(-1);
        expect(fallback.indexOf('@media (prefers-color-scheme: light)')).toBeLessThan(fallback.indexOf(":not([data-theme='dark'])"));
        mixedRules.forEach(({ selector, names }) => {
            const plain = fallbackRules.find(rule => rule.selector === selector);
            expect(plain, selector).toBeDefined();
            const tokens = themeTokens(selector === BASE_SELECTOR ? 'dark' : 'light');
            names.forEach(name => {
                const value = plain!.tokens[name];
                expect(value, `${name} in ${selector}`).toBeDefined();
                expect(value, `${name} in ${selector}`).not.toContain('color-mix(');
                // The colours the mix gives with no brand, to the nearest unit —
                // one, or a gradient's every stop.
                const [mixed, flat] = [paints(`var(${name})`, tokens), paints(value, {})];
                expect(flat, name).toHaveLength(mixed.length);
                mixed.forEach((paint, stop) => {
                    [0, 1, 2].forEach(i => expect(Math.abs(paint[i] - flat[stop][i]), `${name}, stop ${stop}, channel ${i}`).toBeLessThanOrEqual(1));
                    expect(paint[3], `${name}, stop ${stop}, alpha`).toBeCloseTo(flat[stop][3], 3);
                });
            });
        });
    });

    it('keeps the light ring solid and 3:1 or more on every surface, lifted or not', () => {
        const base = fallbackRules.find(rule => rule.selector === BASE_SELECTOR);
        const plain = fallbackRules.find(rule => rule.selector.includes("[data-theme='light']"));
        expect(base).toBeDefined();
        expect(plain).toBeDefined();
        const tokens = { ...themeTokens('light'), ...base!.tokens, ...plain!.tokens };
        expect(JSON.stringify(Object.values(tokens))).not.toContain('color-mix(');
        expectRingOnEverySurface(tokens);
    });
});

describe('focus across the chat', () => {
    /** Where a focus rule draws with a colour of its own, and why it may. */
    const OWN_RING: Record<string, string> = {
        // The lightbox is dark in both themes, so its colours are literals; its ring is light.
        ':root .cb-attachment-viewer-download:focus-visible, :root .cb-attachment-viewer-close:focus-visible': 'AttachmentViewer/AttachmentViewer.css',
    };

    it("draws every focus ring, and every focused field's edge, in the focus ring", () => {
        const stray: string[] = [];
        componentStylesheets().forEach(({ file, css }) => focusRules(css).forEach(({ selector, body }) => {
            ['outline', 'outline-color', 'border', 'border-color'].forEach(property => {
                const value = lastDeclared(body, property);
                if (value === null || /^(none|0|2px solid transparent)$/.test(value) || value.includes('var(--cb-focus-ring')) return;
                if (OWN_RING[selector] === file) return;
                stray.push(`${file} ${selector} { ${property}: ${value} }`);
            });
        }));
        expect(stray).toEqual([]);
    });

    it('keeps the half-transparent accent edge for states that are not focus', () => {
        const users = componentStylesheets().flatMap(({ file, css }) => Array.from(css.matchAll(/([^{};]+)\{([^{}]*)\}/g))
            .filter(match => match[2].includes('--cb-border-focus'))
            .map(match => `${file} ${match[1].trim()}`));
        expect(users).toEqual([
            'Questionnaire/QuestionnaireForm.css .cb-questionnaire-option.checked',
            'WelcomeScreen/WelcomeScreen.css .cb-quick-action-card:hover',
        ]);
    });

    it("draws the lightbox's own ring at 3:1 or more on its dark panel", () => {
        const viewer = componentStylesheets().find(sheet => sheet.file === 'AttachmentViewer/AttachmentViewer.css')!.css;
        const ruleValue = (selector: string, property: string) => {
            const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const body = new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(viewer)?.[1] ?? '';
            return lastDeclared(body, property)!;
        };
        // The panel over the scrim over a white page — the lightest it can be.
        const scrim = over(colour(ruleValue('.cb-attachment-viewer-overlay', 'background'), {}), [255, 255, 255, 1]);
        const panel = over(colour(ruleValue('.cb-attachment-viewer-inner', 'background'), {}), scrim);
        const ring = colour(ruleValue(':root .cb-attachment-viewer-close:focus-visible', 'outline').replace(/^2px solid /, ''), {});
        expect(contrast(ring, panel)).toBeGreaterThanOrEqual(3);
    });
});

describe('the brand (`--cb-brand-*`)', () => {
    // A host colours the chat with the public `--cb-brand-*` properties, read
    // in styles.css and never declared there (2026-10-22). Here: the chat
    // with none is the chat it was, one colour moves every accent token, the
    // optional inputs win, and no component paints the accent's states with a
    // colour of its own.
    const BRAND = '#1477f2';
    const dark = themeTokens('dark');
    const light = themeTokens('light');
    const branded = (tokens: Tokens, extra: Tokens = {}): Tokens => ({ ...tokens, '--cb-brand-primary': BRAND, ...extra });
    const hex = (value: string) => colour(value, {});
    const near = (actual: Rgba, expected: Rgba, label: string) => {
        [0, 1, 2].forEach(i => expect(Math.abs(actual[i] - expected[i]), `${label}, channel ${i}`).toBeLessThanOrEqual(1));
        expect(actual[3], `${label}, alpha`).toBeCloseTo(expected[3], 3);
    };
    const TINTS = [8, 12, 18, 24, 30, 45];

    it('is declared nowhere in the library, so a host value on any ancestor is inherited', () => {
        const declared = [{ file: 'styles.css', css: tokensCss }, ...componentStylesheets()]
            .flatMap(({ file, css }) => Array.from(css.matchAll(/(--cb-brand-[\w-]+)\s*:/g)).map(match => `${file} ${match[1]}`));
        expect(declared).toEqual([]);
    });

    it('leaves a chat with no brand as it was: the literals the tokens replaced', () => {
        near(colour('var(--cb-accent-primary)', dark), hex('#6390f1'), 'accent');
        near(colour('var(--cb-accent-hover)', dark), hex('#093ce3'), 'hover');
        const [start, end] = paints('var(--cb-accent-gradient)', dark);
        near(start, hex('#2d67f8'), 'gradient start');
        near(end, hex('#265bee'), 'gradient end');
        near(colour('var(--cb-on-accent)', dark), hex('#ffffff'), 'on accent');
        TINTS.forEach(tint => near(colour(`var(--cb-accent-tint-${tint})`, dark), [99, 102, 241, tint / 100], `tint ${tint}`));
        near(colour('var(--cb-border-focus)', dark), [99, 102, 241, 0.5], 'soft edge');
        expect(dark['--cb-font-family']).toBe("var(--cb-brand-font-family, 'Inter', system-ui, -apple-system, sans-serif)");
    });

    it('moves every accent token with one colour, in both themes', () => {
        const brand = hex(BRAND);
        const shade = (share: number) => mix(brand, share, [0, 0, 0, 1]);
        [dark, light].forEach((theme, index) => {
            const tokens = branded(theme);
            const label = index === 0 ? 'dark' : 'light';
            near(colour('var(--cb-accent-primary)', tokens), brand, `${label} accent`);
            near(colour('var(--cb-accent-hover)', tokens), shade(0.89), `${label} hover`);
            const [start, end] = paints('var(--cb-accent-gradient)', tokens);
            near(start, brand, `${label} gradient start`);
            near(end, shade(0.94), `${label} gradient end`);
            TINTS.forEach(tint => near(colour(`var(--cb-accent-tint-${tint})`, tokens), [...brand.slice(0, 3), tint / 100] as Rgba, `${label} tint ${tint}`));
            near(colour('var(--cb-border-focus)', tokens), [...brand.slice(0, 3), 0.5] as Rgba, `${label} soft edge`);
        });
        // The strong accent, the focus ring and a chart's tile follow it too.
        near(colour('var(--cb-focus-ring)', branded(dark)), brand, 'dark ring');
        near(colour('var(--cb-focus-ring)', branded(light)), mix(brand, 0.7, colour('var(--cb-text-primary)', light)), 'light ring');
        near(colour('var(--cb-kind-chart)', branded(light)), mix(brand, 0.7, colour('var(--cb-text-primary)', light)), 'chart tile');
    });

    it("takes the host's own hover, gradient, text on the accent and typeface over the derived ones", () => {
        const tokens = branded(dark, {
            '--cb-brand-primary-hover': '#0b3d91',
            '--cb-brand-gradient': 'linear-gradient(135deg, #111111 0%, #222222 100%)',
            '--cb-brand-on-primary': '#000000',
            '--cb-brand-font-family': "'FFMarkWebPro', Helvetica, Arial, serif",
        });
        near(colour('var(--cb-accent-hover)', tokens), hex('#0b3d91'), 'hover');
        const [start, end] = paints('var(--cb-accent-gradient)', tokens);
        near(start, hex('#111111'), 'gradient start');
        near(end, hex('#222222'), 'gradient end');
        near(colour('var(--cb-on-accent)', tokens), hex('#000000'), 'on accent');
        expect(/^var\(--cb-brand-font-family, (.+)\)$/.exec(tokens['--cb-font-family'])?.[1]).toBe("'Inter', system-ui, -apple-system, sans-serif");
    });

    it('keeps text on the default accent fills at 4.5:1 or more', () => {
        const onAccent = colour('var(--cb-on-accent)', dark);
        [...paints('var(--cb-accent-gradient)', dark), colour('var(--cb-accent-hover)', dark)]
            .forEach((fill, index) => expect(contrast(onAccent, fill), `fill ${index}`).toBeGreaterThanOrEqual(4.5));
    });

    it('draws the text and icons on every accent fill in `--cb-on-accent`', () => {
        const FILLS: Array<[string, string]> = [
            ['ChatContainer/ChatContainer.css', '.cb-launcher-btn'],
            ['Composer/Composer.css', '.cb-send-btn.active'],
            ['MessageBubble/MessageBubble.css', '.cb-avatar-assistant'],
            ['MessageBubble/MessageBubble.css', '.cb-edit-save'],
            ['Questionnaire/QuestionnaireForm.css', ':root .cb-questionnaire-submit'],
            ['AttachmentViewer/AttachmentViewer.css', '.cb-attachment-viewer-action-btn.primary'],
        ];
        const sheets = componentStylesheets();
        FILLS.forEach(([file, selector]) => {
            const css = sheets.find(sheet => sheet.file === file)!.css;
            const value = declaredIn(css, selector, 'color');
            expect(value, `${file} ${selector}`).toMatch(/^var\(--cb-on-accent[,)]/);
        });
    });

    it('paints no state of the accent with the old indigo, but for the art that is the library’s own', () => {
        // Where a literal indigo may stay, and why: these draw the library's
        // multi-hue mark and its illustrations, not the accent; or they are a
        // `var()` fallback outside the tokens' scope.
        const OWN_COLOURS: Record<string, string> = {
            '.cb-header-sparkle': 'the tile behind `icons.brand`',
            '.cb-welcome-sparkle-badge': "the welcome screen's mark",
            '.cb-suggestion-icon-badge.cb-icon-message': "a suggestion category's hue",
            '.cb-chip-secondary': "a feature card's illustration",
            '.cb-card-visual-chart-mini': "a feature card's illustration",
            '.cb-edit-save': '`var(--cb-accent-gradient, …)` fallback',
            '.cb-attachment-viewer-action-btn.primary': 'fallbacks in the lightbox, portalled outside the tokens',
        };
        const INDIGO = /rgba\(99, 102, 241|#818cf8|#ede9fe|(?<!--cb-[\w-]+, )#6366f1/i;
        const stray = componentStylesheets().flatMap(({ file, css }) => Array.from(css.matchAll(/([^{};]+)\{([^{}]*)\}/g))
            .filter(match => INDIGO.test(match[2]))
            .map(match => match[1].trim().replace(/\s+/g, ' '))
            .filter(selector => !(selector in OWN_COLOURS))
            .map(selector => `${file} ${selector}`));
        expect(stray).toEqual([]);
    });
});
