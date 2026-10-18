import { defineConfig } from 'vitest/config';

/**
 * Tests run against the sources, not the build, so none of the library build's
 * plugins (declarations, CSS injection) belong here — a separate file keeps
 * vitest from loading `vite.config.mts`. Node is the default environment; a
 * suite that needs browser storage opts into jsdom with a
 * `// @vitest-environment jsdom` comment at its top.
 */
export default defineConfig({
    test: {
        include: ['src/**/*.test.{ts,tsx}'],
        environment: 'node',
    },
});
