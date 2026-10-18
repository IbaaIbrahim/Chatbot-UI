/**
 * Keeping Tab inside a modal dialog: the expanded block's overlay and the
 * conversation files and artifacts panels share it.
 */

/** What Tab can reach: enabled controls, links, anything with a tabindex of 0 or more. */
export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
    + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The elements Tab visits inside `container`, in document order. */
export function focusablesIn(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/** The part of a key event the trap needs — a DOM `KeyboardEvent` and React's both fit. */
export interface TabKeyEvent {
    key: string;
    shiftKey: boolean;
    preventDefault(): void;
}

/**
 * Keep Tab inside `container`: Tab on its last element goes to its first, and
 * Shift+Tab on its first to its last. With focus outside it — nothing focused
 * (the button the user pressed was removed), or the container itself — Tab
 * enters at the first element and Shift+Tab at the last. Returns whether it
 * moved focus.
 *
 * The caller decides that the key is the dialog's to handle. Pass only a key
 * pressed inside the container's DOM, or with nothing focused: React bubbles
 * a key from a portal of the dialog's own (a host's menu, the attachment
 * viewer) to the dialog's `onKeyDown`, and that portal keeps its own order.
 */
export function trapTab(event: TabKeyEvent, container: HTMLElement | null): boolean {
    if (event.key !== 'Tab' || !container || typeof document === 'undefined') return false;
    const focusables = focusablesIn(container);
    if (focusables.length === 0) return false;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    const inside = active !== null && active !== container && container.contains(active);
    const wrapTo = event.shiftKey
        ? (!inside || active === first ? last : null)
        : (!inside || active === last ? first : null);
    if (!wrapTo) return false;
    event.preventDefault();
    wrapTo.focus();
    return true;
}

/** No element has focus: the document's body, or nothing at all. */
export function isNothingFocused(target: EventTarget | null): boolean {
    return !target
        || typeof document === 'undefined'
        || target === document.body
        || target === document.documentElement
        || target === document;
}
