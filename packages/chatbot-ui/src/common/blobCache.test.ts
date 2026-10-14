import { describe, expect, it, vi } from 'vitest';
import { BlobUrlCache, MAX_BLOB_CACHE_BYTES, MAX_BLOB_CACHE_ENTRIES } from './blobCache';

/**
 * The provider's cache of fetched files' object URLs: bounded, least recently
 * used out first, every URL it lets go revoked (review of 2026-10-14 — it used
 * to keep every blob until the provider unmounted).
 */

const URL_OF = (id: string) => `https://storage.test/api/v1/attachments/jobs/job-1/files/${id}`;

function cache(maxEntries = 3, maxBytes = 1000) {
    const revoked: string[] = [];
    const store = new BlobUrlCache(maxEntries, maxBytes, objectUrl => revoked.push(objectUrl));
    return { store, revoked };
}

describe('BlobUrlCache', () => {
    it('keeps what it was given, by URL', () => {
        const { store, revoked } = cache();
        store.set(URL_OF('a'), 'blob:a', 10);
        expect(store.get(URL_OF('a'))).toBe('blob:a');
        expect(store.get(URL_OF('b'))).toBeUndefined();
        expect(store.size).toBe(1);
        expect(store.bytes).toBe(10);
        expect(revoked).toEqual([]);
    });

    it('lets the least recently used go once it holds too many files', () => {
        const { store, revoked } = cache(3);
        store.set(URL_OF('a'), 'blob:a', 1);
        store.set(URL_OF('b'), 'blob:b', 1);
        store.set(URL_OF('c'), 'blob:c', 1);
        // Using `a` makes `b` the oldest.
        store.get(URL_OF('a'));
        store.set(URL_OF('d'), 'blob:d', 1);

        expect(revoked).toEqual(['blob:b']);
        expect(store.get(URL_OF('b'))).toBeUndefined();
        expect(store.get(URL_OF('a'))).toBe('blob:a');
        expect(store.size).toBe(3);
    });

    it('lets the oldest go once it holds too many bytes, but always keeps the newest', () => {
        const { store, revoked } = cache(10, 100);
        store.set(URL_OF('a'), 'blob:a', 60);
        store.set(URL_OF('b'), 'blob:b', 30);
        store.set(URL_OF('c'), 'blob:c', 50);
        expect(revoked).toEqual(['blob:a']);
        expect(store.bytes).toBe(80);

        // Larger than the whole budget: everything older goes, it stays.
        store.set(URL_OF('huge'), 'blob:huge', 500);
        expect(revoked).toEqual(['blob:a', 'blob:b', 'blob:c']);
        expect(store.get(URL_OF('huge'))).toBe('blob:huge');
        expect(store.size).toBe(1);
    });

    it('revokes the URL an entry is replaced with', () => {
        const { store, revoked } = cache();
        store.set(URL_OF('a'), 'blob:a1', 10);
        store.set(URL_OF('a'), 'blob:a2', 20);
        expect(revoked).toEqual(['blob:a1']);
        expect(store.get(URL_OF('a'))).toBe('blob:a2');
        expect(store.bytes).toBe(20);
    });

    it("forgets a deleted file's bytes, whatever route served them", () => {
        const { store, revoked } = cache(10, 10_000);
        store.set(URL_OF('art-1'), 'blob:1', 10);
        store.set(`${URL_OF('art-1')}?inline=1`, 'blob:1-inline', 10);
        store.set(URL_OF('art-10'), 'blob:10', 10);
        store.forgetAttachment('art-1');

        expect(revoked.sort()).toEqual(['blob:1', 'blob:1-inline']);
        expect(store.get(URL_OF('art-10'))).toBe('blob:10');
        expect(store.size).toBe(1);
        expect(store.bytes).toBe(10);
        store.forgetAttachment('');
        expect(store.size).toBe(1);
    });

    it('revokes everything on clear', () => {
        const { store, revoked } = cache();
        store.set(URL_OF('a'), 'blob:a', 1);
        store.set(URL_OF('b'), 'blob:b', 1);
        store.clear();
        expect(revoked).toEqual(['blob:a', 'blob:b']);
        expect(store.size).toBe(0);
        expect(store.bytes).toBe(0);
    });

    it('revokes through URL.revokeObjectURL by default, within sensible bounds', () => {
        const revoke = vi.fn();
        const original = URL.revokeObjectURL;
        URL.revokeObjectURL = revoke;
        try {
            const store = new BlobUrlCache();
            for (let index = 0; index <= MAX_BLOB_CACHE_ENTRIES; index += 1) store.set(URL_OF(String(index)), `blob:${index}`, 1);
            expect(revoke).toHaveBeenCalledWith('blob:0');
            expect(store.size).toBe(MAX_BLOB_CACHE_ENTRIES);
        } finally {
            URL.revokeObjectURL = original;
        }
        expect(MAX_BLOB_CACHE_BYTES).toBeGreaterThanOrEqual(10 * 1024 * 1024);
    });
});
