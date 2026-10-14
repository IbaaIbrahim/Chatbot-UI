/**
 * Object URLs of files the provider fetched with the user's token — attachment
 * chips, the viewer's previews, the files panels' thumbnails — keyed by the
 * file's URL, so a file drawn twice is fetched once.
 *
 * Bounded, least recently used first out. Until 2026-10-14 the provider kept
 * every object URL until it unmounted, which in a host like Flowdit is the
 * whole session: paging through the Artifacts list (saved charts are PNGs) or
 * opening a conversation with many saved files held every blob in memory. Now
 * the oldest entries are revoked once the cache holds more than
 * {@link MAX_BLOB_CACHE_ENTRIES} files or {@link MAX_BLOB_CACHE_BYTES} bytes,
 * and a deleted artifact's entry is revoked at once (`forgetAttachment`).
 *
 * Revoking an object URL does not blank an image that has already loaded it;
 * a component that needs the file again asks for it again and fetches it anew.
 * The newest entry is always kept, however large, so the file just asked for
 * is still there when its caller uses the URL.
 */

/** At most this many files' bytes are kept. */
export const MAX_BLOB_CACHE_ENTRIES = 60;

/** At most this many bytes are kept, all files together (a file is up to 10 MB). */
export const MAX_BLOB_CACHE_BYTES = 48 * 1024 * 1024;

interface Entry {
    objectUrl: string;
    bytes: number;
}

export class BlobUrlCache {
    // A Map iterates in insertion order: re-inserting on use keeps the least
    // recently used entry first.
    private entries = new Map<string, Entry>();
    private totalBytes = 0;
    private readonly maxEntries: number;
    private readonly maxBytes: number;
    private readonly revoke: (objectUrl: string) => void;

    constructor(
        maxEntries: number = MAX_BLOB_CACHE_ENTRIES,
        maxBytes: number = MAX_BLOB_CACHE_BYTES,
        revoke: (objectUrl: string) => void = revokeObjectUrl,
    ) {
        this.maxEntries = maxEntries;
        this.maxBytes = maxBytes;
        this.revoke = revoke;
    }

    get size(): number {
        return this.entries.size;
    }

    get bytes(): number {
        return this.totalBytes;
    }

    /** The object URL for `url`, now the most recently used; `undefined` when not kept. */
    get(url: string): string | undefined {
        const entry = this.entries.get(url);
        if (!entry) return undefined;
        this.entries.delete(url);
        this.entries.set(url, entry);
        return entry.objectUrl;
    }

    /** Keep `objectUrl` for `url`, revoking whatever it replaces and whatever no longer fits. */
    set(url: string, objectUrl: string, bytes: number): void {
        const previous = this.entries.get(url);
        if (previous) {
            this.entries.delete(url);
            this.totalBytes -= previous.bytes;
            if (previous.objectUrl !== objectUrl) this.revoke(previous.objectUrl);
        }
        const size = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
        this.entries.set(url, { objectUrl, bytes: size });
        this.totalBytes += size;
        this.evict();
    }

    /** Revoke and drop every entry whose URL matches. */
    forget(matches: (url: string) => boolean): void {
        for (const [url, entry] of Array.from(this.entries)) {
            if (!matches(url)) continue;
            this.entries.delete(url);
            this.totalBytes -= entry.bytes;
            this.revoke(entry.objectUrl);
        }
    }

    /**
     * Revoke the bytes of one stored file, by its attachment uuid: every
     * storage route that serves it ends in `/files/{uuid}`, with or without a
     * query.
     */
    forgetAttachment(attachmentUuid: string): void {
        if (!attachmentUuid) return;
        const tails = [`/files/${attachmentUuid}`, `/files/${encodeURIComponent(attachmentUuid)}`];
        this.forget(url => {
            const path = url.split(/[?#]/, 1)[0];
            return tails.some(tail => path.endsWith(tail));
        });
    }

    /** Revoke everything — the provider unmounting. */
    clear(): void {
        this.entries.forEach(entry => this.revoke(entry.objectUrl));
        this.entries.clear();
        this.totalBytes = 0;
    }

    private evict(): void {
        while (this.entries.size > 1 && (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes)) {
            const [oldestUrl, oldest] = this.entries.entries().next().value as [string, Entry];
            this.entries.delete(oldestUrl);
            this.totalBytes -= oldest.bytes;
            this.revoke(oldest.objectUrl);
        }
    }
}

function revokeObjectUrl(objectUrl: string): void {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(objectUrl);
}
