import { defineConfig } from 'vite';
import type { LibraryFormats } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
    /**
     * `yarn dev` (`vite build --watch --mode watch`) rebuilds the library for a host
     * app that consumes it through `yarn link`. Two things a one-off build gets right
     * go wrong under the watcher, so a watch build differs in exactly two ways:
     *
     * - **One format.** Rollup's watcher writes every output format in parallel, and
     *   Vite emits a library's CSS once per build, so only one format — whichever
     *   finished first — got the injected styles; the other rendered unstyled. A watch
     *   build emits `es` alone, the format a bundler resolves through `module`.
     * - **Overwrite, don't empty.** Vite empties `outDir` at the start of every
     *   rebuild, and vite-plugin-dts re-emits declarations only when a `.ts` file
     *   changed. The host then saw no module while a rebuild ran, and no type
     *   declarations at all after a CSS-only edit (TS2307). A watch build overwrites
     *   its files in place instead.
     */
    const watching = mode === 'watch';
    const formats: LibraryFormats[] = watching ? ['es'] : ['es', 'cjs'];

    return {
        build: {
            emptyOutDir: !watching,
            lib: {
                entry: resolve(__dirname, 'src/index.ts'),
                name: 'ChatbotUI',
                formats,
                fileName: (format) => `index.${format === 'es' ? 'esm' : 'cjs'}.js`
            },
            rollupOptions: {
                /**
                 * Regexes, not the bare names: Rollup matches a string `external`
                 * against the **exact** module id, so `'react'` left
                 * `react/jsx-runtime` to be bundled. The automatic JSX runtime
                 * imports it from every component, so React's own jsx-runtime
                 * source — which reads
                 * `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED` — was
                 * inlined into dist at the version built against. React 19
                 * removed that object, so the inlined copy read
                 * `ReactCurrentDispatcher` (dev) / `ReactCurrentOwner` (prod) off
                 * `undefined` and the package threw on import, before any
                 * component rendered. Keeping every `react` and `react-dom`
                 * subpath external leaves the host's React to answer them, which
                 * is also what makes one React instance per app possible.
                 */
                external: [/^react($|\/)/, /^react-dom($|\/)/],
                output: {
                    chunkFileNames: '[name].[format].js',
                    globals: {
                        react: 'React',
                        'react-dom': 'ReactDOM'
                    }
                }
            }
        },
        plugins: [
            react(),
            cssInjectedByJsPlugin(),
            // The tests are in `src` for tsc's sake, not part of the package:
            // without this every suite lands in `dist` as a declaration file.
            dts({
                insertTypesEntry: true,
                exclude: ['node_modules/**', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
            })
        ]
    };
});
