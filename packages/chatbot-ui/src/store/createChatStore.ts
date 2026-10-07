/**
 * A minimal external store: one value, replaced by patches, observed by
 * subscribers.
 *
 * It exists so a component can subscribe to *one slice* of the chat — whether
 * the sidebar is open, the active conversation — and re-render only when that
 * slice changes. A React context cannot do that: every consumer of a context
 * re-renders whenever its value changes, and the chat's value changes on every
 * streamed token. The subscription itself, and the selector comparison, are
 * `use-sync-external-store`'s job (see ./hooks.ts); this file only holds the
 * value.
 *
 * One store per `ChatbotProvider`, never a module-level singleton, so two
 * providers on one page are two independent chats.
 */
export type StoreListener = () => void;

export interface ChatStore<State extends object> {
    getState: () => State;
    /**
     * Merge a patch into the state. Listeners are notified only when at least
     * one key's value actually changed (by `Object.is`), so pushing an unchanged
     * snapshot costs nothing downstream.
     */
    setState: (patch: Partial<State>) => void;
    subscribe: (listener: StoreListener) => () => void;
}

export function createChatStore<State extends object>(initialState: State): ChatStore<State> {
    let state = initialState;
    const listeners = new Set<StoreListener>();

    const hasChanges = (patch: Partial<State>): boolean =>
        (Object.keys(patch) as Array<keyof State>).some(key => !Object.is(state[key], patch[key]));

    return {
        getState: () => state,
        setState: (patch) => {
            if (!hasChanges(patch)) return;
            state = { ...state, ...patch };
            listeners.forEach(listener => listener());
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

/**
 * Equality for selectors that return a fresh object or array of stable parts,
 * e.g. `useChatState(s => ({ open: s.isOpen, mode: s.mode }), shallowEqual)`.
 */
export function shallowEqual<Value>(left: Value, right: Value): boolean {
    if (Object.is(left, right)) return true;
    if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
        return false;
    }
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) return false;
    return leftKeys.every(key =>
        Object.prototype.hasOwnProperty.call(right, key)
        && Object.is((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])
    );
}
