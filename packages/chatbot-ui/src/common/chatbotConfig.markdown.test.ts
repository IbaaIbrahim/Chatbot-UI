import { describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_CHATBOT_CONFIG,
    mergeChatbotConfig,
    resolveChatbotConfig,
    type BlockRenderer,
} from './chatbotConfig';

/**
 * `config.markdown` layers like every other group, with one difference that
 * matters for performance: a layer that says nothing about renderers keeps the
 * map beneath it as the same object, because every block in the transcript is
 * memoised on its renderer.
 */

const Noop = () => null;
const chart: BlockRenderer = { component: Noop };
const table: BlockRenderer = { component: Noop };
const otherChart: BlockRenderer = { component: Noop, label: 'graph' };

describe('config.markdown', () => {
    it('has no renderers by default', () => {
        expect(DEFAULT_CHATBOT_CONFIG.markdown).toEqual({ blockRenderers: {} });
    });

    it('merges renderers by language across layers', () => {
        const resolved = resolveChatbotConfig([
            { markdown: { blockRenderers: { chart, table } } },
            { markdown: { blockRenderers: { chart: otherChart } } },
        ]);
        expect(resolved.markdown.blockRenderers).toEqual({ chart: otherChart, table });
    });

    it('removes a language a layer sets to null', () => {
        const resolved = resolveChatbotConfig([
            { markdown: { blockRenderers: { chart, table } } },
            { markdown: { blockRenderers: { chart: null } } },
        ]);
        expect(resolved.markdown.blockRenderers).toEqual({ table });
    });

    it('keeps the map beneath as the same object when a layer has no renderers', () => {
        const base = resolveChatbotConfig([{ markdown: { blockRenderers: { chart } } }]);
        const layered = mergeChatbotConfig(base, { labels: { newChat: 'Neu' } });
        expect(layered.markdown).toBe(base.markdown);

        const onExpandBlock = () => true;
        const withExpand = mergeChatbotConfig(base, { markdown: { onExpandBlock } });
        expect(withExpand.markdown.blockRenderers).toBe(base.markdown.blockRenderers);
        expect(withExpand.markdown.onExpandBlock).toBe(onExpandBlock);
    });

    it('keeps an expand handler set beneath', () => {
        const onExpandBlock = () => true;
        const resolved = resolveChatbotConfig([
            { markdown: { onExpandBlock } },
            { markdown: { blockRenderers: { chart } } },
        ]);
        expect(resolved.markdown.onExpandBlock).toBe(onExpandBlock);
        expect(resolved.markdown.blockRenderers).toEqual({ chart });
    });
});

describe('config.markdown — what a fence language can find', () => {
    it('resolves to maps without a prototype, so no language finds an inherited member', () => {
        expect(Object.getPrototypeOf(DEFAULT_CHATBOT_CONFIG.markdown.blockRenderers)).toBeNull();
        const resolved = resolveChatbotConfig([{ markdown: { blockRenderers: { chart } } }]);
        expect(Object.getPrototypeOf(resolved.markdown.blockRenderers)).toBeNull();
        expect(resolved.markdown.blockRenderers.constructor).toBeUndefined();
        expect(resolved.markdown.blockRenderers.toString).toBeUndefined();
        expect(Object.keys(resolved.markdown.blockRenderers)).toEqual(['chart']);
    });

    it('ignores a renderer React could not draw, with a warning, and keeps the one beneath', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const resolved = resolveChatbotConfig([
            { markdown: { blockRenderers: { chart } } },
            {
                markdown: {
                    blockRenderers: {
                        chart: { component: undefined } as unknown as BlockRenderer,
                        table: { label: 'table' } as unknown as BlockRenderer,
                    },
                },
            },
        ]);
        expect(resolved.markdown.blockRenderers.chart).toBe(chart);
        expect(Object.keys(resolved.markdown.blockRenderers)).toEqual(['chart']);
        expect(warn).toHaveBeenCalledTimes(2);
        expect(String(warn.mock.calls[1][0])).toContain("blockRenderers['table']");
        warn.mockRestore();
    });
});

describe('the files button and the Artifacts entry', () => {
    it('are on by default, and a layer can hide them', () => {
        expect(DEFAULT_CHATBOT_CONFIG.header.files).toBe(true);
        expect(DEFAULT_CHATBOT_CONFIG.sidebar.artifacts).toBe(true);

        const resolved = resolveChatbotConfig([{ header: { files: false }, sidebar: { artifacts: false } }]);
        expect(resolved.header.files).toBe(false);
        expect(resolved.sidebar.artifacts).toBe(false);
    });
});
