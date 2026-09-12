import * as React from 'react';

/**
 * A DOM id that is unique per component instance and stable across renders —
 * on React 17 as well as React 18.
 *
 * ``React.useId`` arrived in React 18. This package declares ``react ^18.0.0``
 * as a peer, but it is consumed by at least one React 17 host (the Flowdit
 * dashboard), and there the hook is simply **absent**: destructuring it yields
 * ``undefined`` and calling it throws ``useId is not a function`` during render.
 * A throw in render has no local blast radius — it unmounts whatever tree the
 * component sits in, so a host without an error boundary goes blank. That is
 * worth a shim rather than a peer-range bump alone.
 *
 * Both hooks below are called on every render, in the same order, so the Rules
 * of Hooks hold. ``reactUseId`` is resolved once at module load: on React 18 it
 * is the real hook, and on 17 a plain function returning ``undefined``, which is
 * not a hook at all. The count of *actual* hooks therefore differs between React
 * versions but never between renders — which is the only thing React requires.
 *
 * The fallback ids are process-local and monotonic, so they are not stable
 * across a server render and a client hydration. This package renders
 * client-side only, so there is nothing to mismatch; were that to change,
 * React 18's own ``useId`` already handles it and the fallback would only be in
 * play on 17.
 */

/** React 18's hook where it exists, and a stub that opts out where it does not. */
const reactUseId: () => string | undefined =
    (React as { useId?: () => string }).useId ?? (() => undefined);

let counter = 0;

export function useStableId(prefix = 'cb-id'): string {
    const reactId = reactUseId();
    // Lazy initial state: evaluated once per instance, not on every render.
    const [fallbackId] = React.useState(() => `${prefix}-${++counter}`);
    return reactId ?? fallbackId;
}
