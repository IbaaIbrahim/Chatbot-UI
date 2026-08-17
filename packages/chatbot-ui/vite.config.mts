import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';
import { resolve } from 'path';

export default defineConfig({
    build: {
        lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            name: 'ChatbotUI',
            formats: ['es', 'cjs'],
            fileName: (format) => `index.${format === 'es' ? 'esm' : 'cjs'}.js`
        },
        rollupOptions: {
            external: ['react', 'react-dom'],
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
        dts({ insertTypesEntry: true })
    ]
});
