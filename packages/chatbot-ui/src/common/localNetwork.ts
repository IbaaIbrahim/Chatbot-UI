/**
 * Local Network Access (LNA) — Chromium 142+.
 *
 * A request from a **public** page to a **loopback** (``localhost``,
 * ``127.0.0.1``, ``[::1]``) or **private** (``10.*``, ``192.168.*``,
 * ``172.16–31.*``, ``*.local``) address is "local network access" and is gated
 * behind a user permission. On Android the prompt reads *"Access other apps and
 * services on this device"*.
 *
 * Two separate things have to be true before that prompt can even appear, and
 * neither of them is something this library can grant itself:
 *
 * 1. **The request must not be pre-blocked as mixed content.** An ``https:``
 *    page fetching ``http://192.168.1.10`` is killed by the mixed-content
 *    checker before LNA is consulted, so the user never sees a prompt — only a
 *    CORS-shaped console error. ``targetAddressSpace`` on the request opts out
 *    of that check; that is what {@link netFetch} adds, and the only part of
 *    this problem that is configurable from here.
 * 2. **The permission must be delegated to this frame.** The Permissions Policy
 *    default allowlist is ``self``, so a cross-origin iframe gets the
 *    permission only if *every* frame in the chain carries it on its
 *    ``allow`` attribute:
 *
 *    ```html
 *    <iframe src="https://chat.example.com"
 *            allow="local-network-access; loopback-network; local-network">
 *    ```
 *
 *    (Chromium renamed the token in 145 — listing all three is safe, unknown
 *    tokens are ignored.) Without it the request fails with no prompt at all.
 *
 * The way to *avoid* the permission entirely is to give the chat UI public,
 * same-scheme URLs — see {@link warnIfLocalNetworkUrl}, which says so on the
 * console when it spots a private base URL.
 */

/** Address space a request is destined for, per the LNA spec. */
export type TargetAddressSpace = 'loopback' | 'local' | 'public';

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

let localNetworkAccessEnabled = false;

/**
 * Opt in to local-network requests.
 *
 * Call once during host-application start-up, before the chat UI mounts, from
 * whatever configuration the host already has (``REACT_APP_*``, ``VITE_*``, a
 * runtime config endpoint). Deliberately **not** read from ``import.meta.env``
 * here: this package is published pre-bundled, so a ``VITE_`` variable would be
 * frozen at *library* publish time rather than picked up from the consuming
 * app's environment.
 */
export function configureLocalNetworkAccess(options: { enabled: boolean }): void {
    localNetworkAccessEnabled = options.enabled;
}

/** Whether local-network requests have been opted into. */
export function isLocalNetworkAccessEnabled(): boolean {
    return localNetworkAccessEnabled;
}

/**
 * Address space ``url`` resolves into, judged from its hostname alone.
 *
 * A public hostname that resolves to a private address via DNS reads as
 * ``public`` here — the browser classifies by the resolved address, so such a
 * URL needs {@link configureLocalNetworkAccess} even though this returns
 * ``public``.
 */
export function addressSpaceOf(url: string): TargetAddressSpace {
    let hostname: string;
    try {
        hostname = new URL(url, typeof window === 'undefined' ? undefined : window.location.href).hostname;
    } catch {
        return 'public';
    }

    const host = hostname.toLowerCase();
    if (LOOPBACK_HOSTNAMES.has(host)) {
        return 'loopback';
    }
    if (host.endsWith('.local') || host.endsWith('.localhost')) {
        return 'local';
    }
    if (host.startsWith('10.') || host.startsWith('192.168.')) {
        return 'local';
    }
    const privateClassB = /^172\.(1[6-9]|2\d|3[01])\./;
    if (privateClassB.test(host)) {
        return 'local';
    }
    // Link-local, both families.
    if (host.startsWith('169.254.') || host.startsWith('fe80:') || host.startsWith('[fe80:')) {
        return 'local';
    }
    return 'public';
}

/** True when ``url`` points at a loopback or private-network address. */
export function isLocalNetworkUrl(url: string): boolean {
    return addressSpaceOf(url) !== 'public';
}

const warnedLabels = new Set<string>();

/**
 * Log, once per ``label``, that a configured base URL will trip the LNA
 * permission — with the two ways out. A silent failure here looks like a CORS
 * bug and costs an afternoon; naming the setting that produced the URL does not.
 */
export function warnIfLocalNetworkUrl(label: string, url: string | undefined | null): void {
    if (!url || warnedLabels.has(label) || !isLocalNetworkUrl(url)) {
        return;
    }
    warnedLabels.add(label);
    // eslint-disable-next-line no-console
    console.warn(
        `[chatbot-ui] ${label} points at a local-network address (${url}). ` +
        'Chromium 142+ gates such requests behind the Local Network Access permission ' +
        '("Access other apps and services on this device"), and an embedded iframe is ' +
        'refused outright unless every parent frame delegates it via ' +
        'allow="local-network-access; loopback-network; local-network". ' +
        'Point this at a public, same-scheme URL, or call ' +
        'configureLocalNetworkAccess({ enabled: true }) and add that allow attribute.'
    );
}

/**
 * ``fetch`` that annotates local-network destinations with
 * ``targetAddressSpace`` once {@link configureLocalNetworkAccess} has opted in.
 *
 * The annotation exempts the request from the mixed-content check, which is what
 * lets the LNA permission prompt be reached at all from an ``https:`` page. It
 * does **not** grant the permission — the user still decides, and an iframe
 * still needs the ``allow`` delegation.
 *
 * ``targetAddressSpace`` is not in every browser's ``RequestInit``, so it is
 * spread in through a widened local type rather than asserted away.
 */
export function netFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (!localNetworkAccessEnabled) {
        return fetch(input, init);
    }

    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const addressSpace = addressSpaceOf(url);
    if (addressSpace === 'public') {
        return fetch(input, init);
    }

    const annotated: RequestInit & { targetAddressSpace?: TargetAddressSpace } = {
        ...init,
        targetAddressSpace: addressSpace,
    };
    return fetch(input, annotated);
}
