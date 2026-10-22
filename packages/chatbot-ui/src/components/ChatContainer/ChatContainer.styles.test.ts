import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Where ChatContainer.css puts the chat, in pixels' terms: for each mode,
 * `side` and direction, the physical edge it is pinned to, the edge its border
 * is on, the way it slides and its place in the host's row. The stylesheet is
 * written in logical properties (4.2, 2026-10-18), because it is injected from
 * JavaScript and no host RTL tooling ever mirrors it; these tests resolve those
 * properties the way a browser does — `inset-inline-end` is `right` in a
 * left-to-right element and `left` in a right-to-left one — through a small
 * cascade (specificity, `!important`, source order) over the rules the
 * container's classes match. Last, the 4.1 geometry of a default chat in a
 * left-to-right page, which 4.2 must not move by a pixel.
 */

// Read from disk: vitest hands a stylesheet to a test empty, even as `?raw`.
const uncomment = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (path: string) => uncomment(readFileSync(new URL(path, import.meta.url), 'utf8'));
const containerCss = read('./ChatContainer.css');

// --- A small cascade ------------------------------------------------------------

interface Declaration { property: string; value: string; important: boolean }
interface Rule { selectors: string[]; declarations: Declaration[]; media: string | null; order: number }

function parseDeclarations(body: string): Declaration[] {
    return body.split(';').map(part => part.trim()).filter(Boolean).flatMap(part => {
        const colon = part.indexOf(':');
        if (colon < 0) return [];
        const raw = part.slice(colon + 1).trim();
        const important = /!important$/.test(raw);
        return [{ property: part.slice(0, colon).trim(), value: raw.replace(/\s*!important$/, ''), important }];
    });
}

/** Every style rule, with the `@media` prelude it sits in; other at-rules are left out. */
function parseRules(css: string): Rule[] {
    const rules: Rule[] = [];
    const walk = (text: string, media: string | null) => {
        let index = 0;
        while (index < text.length) {
            const open = text.indexOf('{', index);
            if (open < 0) break;
            const prelude = text.slice(index, open).trim();
            let depth = 1;
            let close = open + 1;
            while (depth > 0 && close < text.length) {
                if (text[close] === '{') depth += 1;
                else if (text[close] === '}') depth -= 1;
                close += 1;
            }
            const body = text.slice(open + 1, close - 1);
            if (prelude.startsWith('@media')) walk(body, prelude.slice('@media'.length).trim());
            else if (!prelude.startsWith('@')) {
                rules.push({
                    selectors: prelude.split(',').map(selector => selector.trim()),
                    declarations: parseDeclarations(body),
                    media,
                    order: rules.length,
                });
            }
            index = close;
        }
    };
    walk(css, null);
    return rules;
}

const RULES = parseRules(containerCss);
const BUBBLE_RULES = parseRules(read('../MessageBubble/MessageBubble.css'));

/** An element by its classes, with its ancestors' (nearest first). */
interface Subject { classes: string[]; ancestors?: string[][] }

/** Classes, each optionally negated: `.a.b:not(.c)`. */
const COMPOUND = /^(\.[\w-]+|:not\(\.[\w-]+\))+$/;
const classesIn = (compound: string) => compound.match(/\.[\w-]+|:not\(\.[\w-]+\)/g) ?? [];
const compoundMatches = (compound: string, classes: string[]) =>
    COMPOUND.test(compound) && classesIn(compound).every(part => (part.startsWith(':not(')
        ? !classes.includes(part.slice(6, -1))
        : classes.includes(part.slice(1))));

/**
 * Specificity (class-likes only) if `selector` matches — class compounds
 * (a `:not(.x)` counting as its class) and descendant combinators between
 * them, and a leading `:root` (always an ancestor; one pseudo-class more).
 * Anything else (attributes, other pseudo-classes) is treated as not
 * matching, which these rules never need.
 */
function match(selector: string, subject: Subject): number | null {
    const all = selector.split(/\s+/);
    const roots = all.filter(compound => compound === ':root').length;
    const compounds = all.filter(compound => compound !== ':root');
    const last = compounds.pop()!;
    if (!compoundMatches(last, subject.classes)) return null;
    let ancestors = subject.ancestors ?? [];
    for (const compound of compounds.reverse()) {
        const at = ancestors.findIndex(classes => compoundMatches(compound, classes));
        if (at < 0) return null;
        ancestors = ancestors.slice(at + 1);
    }
    return roots + [last, ...compounds].reduce((sum, compound) => sum + classesIn(compound).length, 0);
}

type Direction = 'ltr' | 'rtl';

/** A declaration as the physical properties it sets in `dir`. */
function toPhysical({ property, value }: Declaration, dir: Direction): Array<[string, string]> {
    const start = dir === 'ltr' ? 'left' : 'right';
    const end = dir === 'ltr' ? 'right' : 'left';
    const parts = value.split(/\s+/);
    switch (property) {
        case 'inset-inline-start': return [[start, value]];
        case 'inset-inline-end': return [[end, value]];
        case 'inset-inline': return [[start, parts[0]], [end, parts[1] ?? parts[0]]];
        case 'inset': {
            const [top, right = top, bottom = top, left = right] = parts;
            return [['top', top], ['right', right], ['bottom', bottom], ['left', left]];
        }
        case 'border': return ['top', 'right', 'bottom', 'left'].map(edge => [`border-${edge}`, value] as [string, string]);
        case 'padding': {
            const [top = '', right = top, bottom = top, left = right] = valuesOf(value);
            return [['padding-top', top], ['padding-right', right], ['padding-bottom', bottom], ['padding-left', left]];
        }
        case 'border-inline-start': return [[`border-${start}`, value]];
        case 'border-inline-end': return [[`border-${end}`, value]];
        case 'margin-inline-start': return [[`margin-${start}`, value]];
        case 'margin-inline-end': return [[`margin-${end}`, value]];
        case 'padding-inline-start': return [[`padding-${start}`, value]];
        case 'padding-inline-end': return [[`padding-${end}`, value]];
        default: return [[property, value]];
    }
}

/**
 * The cascaded value of every property `subject` gets in `dir`, with the
 * media queries in `media` in force: `!important` first, then specificity,
 * then source order — a logical declaration and a physical one competing for
 * the same side, as the browser has them do.
 */
function cascade(subject: Subject, dir: Direction, media: string[] = [], rules: Rule[] = RULES): Record<string, string> {
    const winners: Record<string, { value: string; rank: number[] }> = {};
    for (const rule of rules) {
        if (rule.media !== null && !media.includes(rule.media)) continue;
        const specificity = Math.max(-1, ...rule.selectors.map(selector => match(selector, subject) ?? -1));
        if (specificity < 0) continue;
        rule.declarations.forEach((declaration, index) => {
            const rank = [declaration.important ? 1 : 0, specificity, rule.order, index];
            for (const [property, value] of toPhysical(declaration, dir)) {
                const current = winners[property];
                const wins = !current || rank.some((part, at) =>
                    rank.slice(0, at).every((earlier, before) => earlier === current.rank[before]) && part > current.rank[at]);
                if (wins) winners[property] = { value, rank };
            }
        });
    }
    return Object.fromEntries(Object.entries(winners).map(([property, { value }]) => [property, value]));
}

/** `value` with each `var(--x, fallback)` replaced from `scope` (the inherited custom properties). */
function substitute(value: string, scope: Record<string, string>): string {
    return value.replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (_, name: string, fallback?: string) => scope[name] ?? fallback ?? '');
}

/** The x offset of a `translateX(…)` in percent of the element: `translateX(calc(-110% * -1))` is 110. */
function translateXPercent(transform: string): number {
    const inner = /translateX\((.*)\)/.exec(transform)?.[1];
    if (inner === undefined) throw new Error(`no translateX in ${transform}`);
    if (inner.trim() === '0') return 0;
    const calc = /^calc\((-?[\d.]+)%\s*\*\s*(-?[\d.]+)\)$/.exec(inner.trim());
    if (calc) return Number(calc[1]) * Number(calc[2]);
    const plain = /^(-?[\d.]+)%$/.exec(inner.trim());
    if (plain) return Number(plain[1]);
    throw new Error(`cannot read ${transform}`);
}

/** The x offset of a box-shadow's first layer, in px. */
function shadowXPx(shadow: string): number {
    const calc = /^calc\((-?[\d.]+)px\s*\*\s*(-?[\d.]+)\)/.exec(shadow);
    if (calc) return Number(calc[1]) * Number(calc[2]);
    return Number(/^(-?[\d.]+)px/.exec(shadow)?.[1]);
}

// --- The chat's placement ----------------------------------------------------------

type Side = 'end' | 'start';
const PHONE = '(max-width: 640px)';
const NARROW = '(max-width: 768px)';
const WIDE = '(min-width: 960px)';

const containerClasses = (mode: string, side: Side, dir: Direction, ...extra: string[]) =>
    ['cb-chat-container', `cb-mode-${mode}`, `cb-side-${side}`, `cb-dir-${dir}`, ...extra];

/** The physical edge a box is pinned to: the one of `left`/`right` set to something other than `auto`. */
function pinnedEdge(styles: Record<string, string>): 'left' | 'right' | 'both' | 'none' {
    const pinned = (edge: string) => styles[edge] !== undefined && styles[edge] !== 'auto';
    if (pinned('left') && pinned('right')) return 'both';
    if (pinned('left')) return 'left';
    if (pinned('right')) return 'right';
    return 'none';
}

const COMBINATIONS: Array<[Side, Direction, 'left' | 'right']> = [
    // side, direction → the physical edge of the page the chat attaches to.
    ['end', 'ltr', 'right'],
    ['end', 'rtl', 'left'],
    ['start', 'ltr', 'left'],
    ['start', 'rtl', 'right'],
];

const opposite = (edge: 'left' | 'right') => (edge === 'left' ? 'right' : 'left');
const sign = (edge: 'left' | 'right') => (edge === 'right' ? 1 : -1);

describe('ChatContainer.css — side × direction × mode', () => {
    describe.each(COMBINATIONS)('side %s in a %s page: the %s edge', (side, dir, edge) => {
        it('pins the floating card and its launcher in the same corner, 24px in (16px on a phone)', () => {
            const card = cascade({ classes: containerClasses('floating', side, dir, 'cb-open') }, dir);
            expect(pinnedEdge(card)).toBe(edge);
            expect(card[edge]).toBe('24px');
            expect(card.bottom).toBe('24px');

            const button = { classes: ['cb-chat-launcher', 'cb-launcher-btn', `cb-side-${side}`, `cb-dir-${dir}`] };
            const launcher = cascade(button, dir);
            expect(pinnedEdge(launcher)).toBe(edge);
            expect(launcher[edge]).toBe('24px');
            expect(launcher.bottom).toBe('24px');

            const phoneLauncher = cascade(button, dir, [PHONE, NARROW]);
            expect(pinnedEdge(phoneLauncher)).toBe(edge);
            expect(phoneLauncher[edge]).toBe('16px');
        });

        it('makes the floating card full width on a phone, whichever its side', () => {
            const card = cascade({ classes: containerClasses('floating', side, dir, 'cb-open') }, dir, [PHONE, NARROW]);
            expect(card.left).toBe('0');
            expect(card.right).toBe('0');
            expect(card.width).toBe('100%');
        });

        it('docks the overlay sidebar at that edge, its border inside, sliding out past the edge', () => {
            const closed = cascade({ classes: containerClasses('sidebar', side, dir, 'cb-closed') }, dir);
            expect(pinnedEdge(closed)).toBe(edge);
            expect(closed[edge]).toBe('0');
            expect(closed[`border-${opposite(edge)}`]).toBe('1px solid var(--cb-border-subtle)');
            expect(translateXPercent(substitute(closed.transform, closed))).toBe(100 * sign(edge));

            const open = cascade({ classes: containerClasses('sidebar', side, dir, 'cb-open') }, dir);
            expect(translateXPercent(substitute(open.transform, open))).toBe(0);
        });

        // The edge is a logical inset, which flips at once when the side or
        // the direction changes, while the transform is animated: a shut
        // panel left visible swept across the page for 0.3s.
        it('hides the shut overlay once it has slid out, so its edge can flip unseen, and shows it at once on opening', () => {
            const chat = containerClasses('sidebar', side, dir, 'cb-closed');
            const closed = cascade({ classes: chat }, dir);
            expect(closed.visibility).toBe('hidden');
            // Closing still slides: visibility waits for the transform.
            expect(closed.transition).toMatch(/, transform 0\.3s cubic-bezier\(0\.4, 0, 0\.2, 1\), visibility 0s 0\.3s$/);

            const open = cascade({ classes: containerClasses('sidebar', side, dir, 'cb-open') }, dir);
            expect(open.visibility).toBeUndefined();
            expect(open.transition).not.toMatch(/visibility/);

            // An open conversation drawer follows the panel instead of its own `visible`.
            const drawer = (wrapper: string[]) =>
                cascade({ classes: ['cb-drawer-content'], ancestors: [wrapper, ['cb-chat-body-wrapper'], chat] }, dir).visibility;
            expect(drawer(['cb-drawer-wrapper', 'open'])).toBe('inherit');
            expect(drawer(['cb-drawer-wrapper'])).toBe('hidden');

            // An embedded panel shuts to zero width and is left alone.
            const embedded = cascade({ classes: containerClasses('sidebar', side, dir, 'cb-closed', 'cb-embedded') }, dir);
            expect(embedded.visibility).toBeUndefined();
        });

        // The frame's own `border` (`.cb-chat-container`) is on every side
        // but the top, so 4.1's panel at the right had a line at the
        // viewport's edge too; a start panel is its mirror image.
        it("keeps the frame's border on the outer edge, as 4.1's panel at the end had it", () => {
            for (const extra of [[], ['cb-embedded']]) {
                const open = cascade({ classes: containerClasses('sidebar', side, dir, 'cb-open', ...extra) }, dir);
                expect(open[`border-${edge}`]).toBe('1px solid var(--cb-border-subtle)');
                expect(open[`border-${opposite(edge)}`]).toBe('1px solid var(--cb-border-subtle)');
            }
        });

        it('puts an embedded docked panel at that end of the host row, its border on the inner edge', () => {
            const open = cascade({ classes: containerClasses('sidebar', side, dir, 'cb-open', 'cb-embedded') }, dir);
            expect(open.position).toBe('relative');
            expect(pinnedEdge(open)).toBe('none');
            expect(open.transform).toBe('none');
            expect(open.order).toBe(side === 'start' ? '-1' : undefined);
            expect(open[`border-${opposite(edge)}`]).toBe('1px solid var(--cb-border-subtle)');

            const closed = cascade({ classes: containerClasses('sidebar', side, dir, 'cb-closed', 'cb-embedded') }, dir);
            expect(closed.width).toBe('0');
            expect(closed[`border-${opposite(edge)}`]).toBe('none');
        });

        it('falls back to a full-width overlay at that edge on a narrow screen', () => {
            const closed = cascade({ classes: containerClasses('sidebar', side, dir, 'cb-closed', 'cb-embedded') }, dir, [NARROW]);
            expect(closed.position).toBe('fixed');
            expect(closed[edge]).toBe('0');
            expect(translateXPercent(substitute(closed.transform, closed))).toBe(100 * sign(edge));

            const open = cascade({ classes: containerClasses('sidebar', side, dir, 'cb-open', 'cb-embedded') }, dir, [NARROW]);
            expect(translateXPercent(substitute(open.transform, open))).toBe(0);
        });

        it('puts an embedded floating card at that end of the host row too', () => {
            const card = cascade({ classes: containerClasses('floating', side, dir, 'cb-open', 'cb-embedded') }, dir);
            expect(card.order).toBe(side === 'start' ? '-1' : undefined);
            expect(pinnedEdge(card)).toBe('none');
        });

        it('leaves fullscreen where it was: the whole viewport, no order in a row', () => {
            const fixed = cascade({ classes: containerClasses('fullscreen', side, dir, 'cb-open') }, dir);
            expect(fixed.left).toBe('0');
            expect(fixed.width).toBe('100vw');
            const embedded = cascade({ classes: containerClasses('fullscreen', side, dir, 'cb-open', 'cb-embedded') }, dir);
            expect(embedded.order).toBeUndefined();
            expect(embedded.width).toBe('100%');
        });
    });

    describe.each([['ltr', 'left'], ['rtl', 'right']] as const)('the conversation drawer in a %s chat', (dir, start) => {
        // Whatever side the chat is on, the drawer opens from the inline start.
        it.each<Side>(['end', 'start'])(`opens from the ${start} — the inline start — with the chat at its %s side`, side => {
            const chat = containerClasses('floating', side, dir, 'cb-open');
            const scope = cascade({ classes: chat }, dir);
            const closedWrapper = ['cb-drawer-wrapper'];
            const content = cascade({ classes: ['cb-drawer-content'], ancestors: [closedWrapper, chat] }, dir);
            expect(pinnedEdge(content)).toBe(start);
            expect(content[`border-${start === 'left' ? 'right' : 'left'}`]).toBe('1px solid var(--cb-border-subtle)');
            expect(translateXPercent(substitute(content.transform, scope))).toBe(start === 'left' ? -110 : 110);

            const open = cascade({ classes: ['cb-drawer-content'], ancestors: [['cb-drawer-wrapper', 'open'], chat] }, dir);
            expect(translateXPercent(substitute(open.transform, scope))).toBe(0);
            // Its shadow falls on the transcript's side.
            expect(Math.sign(shadowXPx(substitute(open['box-shadow'], scope)))).toBe(start === 'left' ? 1 : -1);

            const backdrop = cascade({ classes: ['cb-drawer-backdrop'], ancestors: [closedWrapper, chat] }, dir);
            expect(backdrop[start]).toBe('0');
        });

        it("tucks fullscreen's inline column away toward the inline start on a wide screen", () => {
            const chat = containerClasses('fullscreen', 'end', dir, 'cb-open');
            const scope = cascade({ classes: chat }, dir, [WIDE]);
            const closed = cascade({ classes: ['cb-drawer-content'], ancestors: [['cb-drawer-wrapper'], ['cb-chat-body-wrapper'], chat] }, dir, [WIDE]);
            expect(translateXPercent(substitute(closed.transform, scope))).toBe(start === 'left' ? -100 : 100);
        });
    });
});

describe('ChatContainer.css — a default chat in a left-to-right page keeps its 4.1 pixels', () => {
    // The 4.1 rules, as they were written with physical properties.
    it('the floating card and the launcher: bottom 24px, right 24px', () => {
        const card = cascade({ classes: containerClasses('floating', 'end', 'ltr', 'cb-open') }, 'ltr');
        expect([card.bottom, card.right, card.left]).toEqual(['24px', '24px', undefined]);
        const launcher = cascade({ classes: ['cb-chat-launcher', 'cb-launcher-btn', 'cb-side-end', 'cb-dir-ltr'] }, 'ltr');
        expect([launcher.bottom, launcher.right, launcher.left]).toEqual(['24px', '24px', undefined]);
    });

    it('the overlay sidebar: top 0, right 0, border-left (and the frame\'s border-right), translateX(100%) closed', () => {
        const closed = cascade({ classes: containerClasses('sidebar', 'end', 'ltr', 'cb-closed') }, 'ltr');
        expect([closed.top, closed.right, closed.left]).toEqual(['0', '0', undefined]);
        expect(closed['border-left']).toBe('1px solid var(--cb-border-subtle)');
        expect(closed['border-right']).toBe('1px solid var(--cb-border-subtle)');
        expect(translateXPercent(substitute(closed.transform, closed))).toBe(100);
    });

    it('the embedded docked panel: border-left, no order, none when closed', () => {
        const open = cascade({ classes: containerClasses('sidebar', 'end', 'ltr', 'cb-open', 'cb-embedded') }, 'ltr');
        expect(open['border-left']).toBe('1px solid var(--cb-border-subtle)');
        expect(open.order).toBeUndefined();
        expect([open.top, open.right, open.bottom, open.left]).toEqual(['auto', 'auto', 'auto', 'auto']);
        const closed = cascade({ classes: containerClasses('sidebar', 'end', 'ltr', 'cb-closed', 'cb-embedded') }, 'ltr');
        expect(closed['border-left']).toBe('none');
    });

    it('the conversation drawer: left 0, border-right, translateX(-110%), a shadow 4px to the right', () => {
        const chat = containerClasses('floating', 'end', 'ltr', 'cb-open');
        const scope = cascade({ classes: chat }, 'ltr');
        const closed = cascade({ classes: ['cb-drawer-content'], ancestors: [['cb-drawer-wrapper'], chat] }, 'ltr');
        expect([closed.left, closed.right]).toEqual(['0', undefined]);
        expect(closed['border-right']).toBe('1px solid var(--cb-border-subtle)');
        expect(translateXPercent(substitute(closed.transform, scope))).toBe(-110);
        const open = cascade({ classes: ['cb-drawer-content'], ancestors: [['cb-drawer-wrapper', 'open'], chat] }, 'ltr');
        expect(shadowXPx(substitute(open['box-shadow'], scope))).toBe(4);
    });

    it("the header's new-chat button keeps its 6px before the next control", () => {
        const button = cascade({ classes: ['cb-header-new-chat-btn'] }, 'ltr');
        expect(button['margin-right']).toBe('6px');
    });

    it('an answer: flush left, 16px on the right, in either language', () => {
        // The bubble is `dir="auto"`, so its own direction is its language's.
        for (const ownDir of ['ltr', 'rtl'] as const) {
            const bubble = cascade({ classes: ['cb-message-bubble', 'assistant'], ancestors: [containerClasses('floating', 'end', 'ltr', 'cb-open')] }, ownDir, [], BUBBLE_RULES);
            expect([bubble['padding-left'], bubble['padding-right']]).toEqual(['0', 'var(--cb-space-4)']);
        }
    });
});

describe('MessageBubble.css — an answer is flush at the chat\'s inline start', () => {
    // Read from the chat's direction, as the user bubble's corner is: the
    // bubble's own (`dir="auto"`, its language's) moves nothing.
    it.each([['ltr', 'left'], ['rtl', 'right']] as const)('in a %s chat, at the %s, an answer in either language', (chatDir, flush) => {
        for (const ownDir of ['ltr', 'rtl'] as const) {
            const bubble = cascade({ classes: ['cb-message-bubble', 'assistant'], ancestors: [containerClasses('floating', 'end', chatDir, 'cb-open')] }, ownDir, [], BUBBLE_RULES);
            expect(bubble[`padding-${flush}`]).toBe('0');
            expect(bubble[`padding-${opposite(flush)}`]).toBe('var(--cb-space-4)');
        }
    });
});

// --- Nothing else in the chat's frame names a side ---------------------------------

/** A shorthand's values, a function call (`var(…)`, `calc(…)`) counted as one. */
const valuesOf = (value: string) =>
    value.match(/[\w-]+\((?:[^()]|\([^()]*\))*\)|\S+/g) ?? [];

/**
 * A `margin`/`padding` shorthand whose left differs from its right, or a
 * `border-radius` whose left corners differ from its right ones: a side
 * named by position rather than by property.
 */
function asymmetricShorthand(property: string, value: string): boolean {
    const values = valuesOf(value.replace(/\s*\/.*$/, ''));
    if (property === 'margin' || property === 'padding' || property === 'inset') {
        return values.length === 4 && values[1] !== values[3];
    }
    if (property === 'border-radius' && values.length > 1) {
        const [topLeft, topRight, bottomRight = topLeft, bottomLeft = topRight] = values;
        return topLeft !== topRight || bottomLeft !== bottomRight;
    }
    return false;
}

/**
 * Every `left`/`right`, physical margin, padding or border side,
 * `text-align: left|right`, and asymmetric shorthand.
 */
function physicalDeclarations(css: string): string[] {
    return parseRules(css).flatMap(rule => rule.declarations
        .filter(({ property, value }) =>
            /^(left|right)$/.test(property)
            || /^(margin|padding|border)-(left|right)/.test(property)
            || /^border-(top|bottom)-(left|right)-radius$/.test(property)
            || (property === 'text-align' && /^(left|right)$/.test(value))
            || asymmetricShorthand(property, value))
        .map(({ property, value }) => `${rule.selectors.join(', ')} { ${property}: ${value} }`));
}

describe('the chat frame and its inner layout name no physical side', () => {
    it('ChatContainer.css: only the fullscreen rectangle and a centred button, which are the same in either direction', () => {
        expect(physicalDeclarations(containerCss)).toEqual([
            '.cb-mode-fullscreen { left: 0 }',
            ':root .cb-scroll-bottom-btn { left: 50% }',
        ]);
    });

    it.each([
        '../ChatHeader/ChatHeader.css',
        '../ConversationSidebar/ConversationSidebar.css',
        '../ConversationDrawer/ConversationDrawer.css',
        '../MainChat/MainChat.css',
        '../Composer/Composer.css',
        '../ToolToggles/ToolToggles.css',
        '../UsageIndicator/UsageIndicator.css',
        '../CreditUsage/CreditUsageDialog.css',
        '../BlinkingIndicator/BlinkingIndicator.css',
        '../Questionnaire/QuestionnaireForm.css',
        '../Files/Files.css',
    ])('%s', path => {
        expect(physicalDeclarations(read(path))).toEqual([]);
    });

    it("MessageBubble.css: only the markdown rules its direction-aware block re-declares, and the user bubble's corner and the answer's flush side, mirrored by the chat's direction", () => {
        expect(physicalDeclarations(read('../MessageBubble/MessageBubble.css'))).toEqual([
            '.cb-message-bubble.user { border-top-right-radius: 4px }',
            '.cb-dir-rtl .cb-message-bubble.user { border-top-right-radius: var(--cb-radius-lg) }',
            '.cb-dir-rtl .cb-message-bubble.user { border-top-left-radius: 4px }',
            '.cb-message-bubble.assistant { padding-left: 0 }',
            '.cb-dir-rtl .cb-message-bubble.assistant { padding-left: var(--cb-space-4) }',
            '.cb-dir-rtl .cb-message-bubble.assistant { padding-right: 0 }',
            '.cb-markdown-content ul, .cb-markdown-content ol { padding-left: 1.5em }',
            '.cb-markdown-content blockquote { border-left: 3px solid var(--cb-accent-primary) }',
            '.cb-markdown-content blockquote { padding: 0.25em 0 0.25em 1em }',
            '.cb-markdown-content blockquote { border-left: 0 }',
            '.cb-markdown-content blockquote { padding-left: 0 }',
            '.cb-markdown-content ul, .cb-markdown-content ol { padding-left: 0 }',
        ]);
    });
});
