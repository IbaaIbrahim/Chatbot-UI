import * as React from 'react';

/** The direction text runs in: left-to-right or right-to-left. */
export type TextDirection = 'ltr' | 'rtl';

/**
 * The direction the browser resolved for `element`: its computed `direction`,
 * which it inherits from the nearest `dir` (or from a host stylesheet's
 * `direction`). The library's CSS is injected from JavaScript and never passes
 * through a host's RTL tooling, so this — read, not assumed — is how the chat
 * learns which way the page around it runs.
 *
 * Where no style engine resolves `direction` (a test DOM such as jsdom reports
 * an empty string), the nearest `dir="ltr"` or `dir="rtl"` ancestor decides,
 * which is the browser's own rule for an unstyled document.
 */
export function readDirection(element: Element): TextDirection {
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        const computed = window.getComputedStyle(element).direction;
        if (computed === 'rtl' || computed === 'ltr') return computed;
    }
    const marked = element.closest('[dir="rtl"], [dir="ltr"]');
    return marked?.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
}

/** The document's own direction — the best guess before the chat has an element to read. */
function documentDirection(): TextDirection {
    return typeof document === 'undefined' || !document.documentElement
        ? 'ltr'
        : readDirection(document.documentElement);
}

// Layout effects warn outside a browser; the chat renders nothing there anyway.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

/**
 * The direction `element` inherits, kept current.
 *
 * Read after every commit, before paint, so the first frame is already
 * placed for the page's direction and a host that re-renders the chat after
 * switching language is followed at once. A `dir` attribute changed anywhere
 * in the document — Flowdit sets it on `<html>` — is followed without a
 * render. A direction a host switches through a stylesheet class alone is
 * picked up on the chat's next render.
 *
 * `element` is a state-held node (a callback ref), not a ref object, so the
 * hook knows when the chat swaps one root for another — the launcher button
 * for the open panel.
 */
export function useInheritedDirection(element: Element | null): TextDirection {
    const [direction, setDirection] = React.useState<TextDirection>(documentDirection);

    // No dependency list on purpose: one `getComputedStyle` per commit of the
    // frame, which re-renders on open, close and placement — not per token.
    useIsomorphicLayoutEffect(() => {
        if (element) setDirection(readDirection(element));
    });

    React.useEffect(() => {
        if (!element || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return undefined;
        // `dir` alone across the document: rare, so the observer costs nothing,
        // and it does not miss the chat being moved under another ancestor.
        const observer = new MutationObserver(() => setDirection(readDirection(element)));
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['dir'], subtree: true });
        return () => observer.disconnect();
    }, [element]);

    return direction;
}
