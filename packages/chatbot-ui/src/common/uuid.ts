/**
 * RFC 4122 version-4 UUID generation that survives an insecure browsing context.
 *
 * ``crypto.randomUUID`` is exposed on secure origins only — HTTPS, ``localhost``
 * or ``127.0.0.1``. Served over plain HTTP on any other hostname (a LAN IP, a
 * dev domain such as ``chat.primebridge.space``) the method is simply absent and
 * the call fails with ``crypto.randomUUID is not a function``.
 *
 * The gateway parses every id the client sends as a UUID, so the fallback has to
 * produce a well-formed v4 string rather than an arbitrary random token.
 * ``crypto.getRandomValues`` carries no secure-context restriction, so the
 * entropy source stays the same and only the formatting moves into JavaScript.
 */
export function createUuid(): string {
    const webCrypto = globalThis.crypto;

    if (typeof webCrypto?.randomUUID === 'function') {
        return webCrypto.randomUUID();
    }

    if (typeof webCrypto?.getRandomValues !== 'function') {
        throw new Error(
            'No Web Crypto random source is available, so a conversation id cannot ' +
            'be generated. Serve the application over HTTPS or from localhost.'
        );
    }

    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    // The two bytes RFC 4122 pins: the high nibble of byte 6 is the version and
    // the two high bits of byte 8 are the variant. Everything else stays random.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
    return [
        hex.slice(0, 4).join(''),
        hex.slice(4, 6).join(''),
        hex.slice(6, 8).join(''),
        hex.slice(8, 10).join(''),
        hex.slice(10, 16).join(''),
    ].join('-');
}
