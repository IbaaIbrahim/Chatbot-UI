// vite.config.mts
import { defineConfig } from "file:///home/ibaa-ibrahim/Personal-Projects/AI-EcoSystem/frontend/node_modules/vite/dist/node/index.js";
import react from "file:///home/ibaa-ibrahim/Personal-Projects/AI-EcoSystem/frontend/node_modules/@vitejs/plugin-react/dist/index.js";
import dts from "file:///home/ibaa-ibrahim/Personal-Projects/AI-EcoSystem/frontend/node_modules/vite-plugin-dts/dist/index.mjs";
import cssInjectedByJsPlugin from "file:///home/ibaa-ibrahim/Personal-Projects/AI-EcoSystem/frontend/node_modules/vite-plugin-css-injected-by-js/dist/esm/index.js";
import { resolve } from "path";
var __vite_injected_original_dirname = "/home/ibaa-ibrahim/Personal-Projects/AI-EcoSystem/frontend/packages/chatbot-ui";
var vite_config_default = defineConfig({
  build: {
    lib: {
      entry: resolve(__vite_injected_original_dirname, "src/index.ts"),
      name: "ChatbotUI",
      formats: ["es", "cjs"],
      fileName: (format) => `index.${format === "es" ? "esm" : "cjs"}.js`
    },
    rollupOptions: {
      external: ["react", "react-dom"],
      output: {
        chunkFileNames: "[name].[format].js",
        globals: {
          react: "React",
          "react-dom": "ReactDOM"
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
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcubXRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiL2hvbWUvaWJhYS1pYnJhaGltL1BlcnNvbmFsLVByb2plY3RzL0FJLUVjb1N5c3RlbS9mcm9udGVuZC9wYWNrYWdlcy9jaGF0Ym90LXVpXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9pYmFhLWlicmFoaW0vUGVyc29uYWwtUHJvamVjdHMvQUktRWNvU3lzdGVtL2Zyb250ZW5kL3BhY2thZ2VzL2NoYXRib3QtdWkvdml0ZS5jb25maWcubXRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL2liYWEtaWJyYWhpbS9QZXJzb25hbC1Qcm9qZWN0cy9BSS1FY29TeXN0ZW0vZnJvbnRlbmQvcGFja2FnZXMvY2hhdGJvdC11aS92aXRlLmNvbmZpZy5tdHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgZHRzIGZyb20gJ3ZpdGUtcGx1Z2luLWR0cyc7XG5pbXBvcnQgY3NzSW5qZWN0ZWRCeUpzUGx1Z2luIGZyb20gJ3ZpdGUtcGx1Z2luLWNzcy1pbmplY3RlZC1ieS1qcyc7XG5pbXBvcnQgeyByZXNvbHZlIH0gZnJvbSAncGF0aCc7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gICAgYnVpbGQ6IHtcbiAgICAgICAgbGliOiB7XG4gICAgICAgICAgICBlbnRyeTogcmVzb2x2ZShfX2Rpcm5hbWUsICdzcmMvaW5kZXgudHMnKSxcbiAgICAgICAgICAgIG5hbWU6ICdDaGF0Ym90VUknLFxuICAgICAgICAgICAgZm9ybWF0czogWydlcycsICdjanMnXSxcbiAgICAgICAgICAgIGZpbGVOYW1lOiAoZm9ybWF0KSA9PiBgaW5kZXguJHtmb3JtYXQgPT09ICdlcycgPyAnZXNtJyA6ICdjanMnfS5qc2BcbiAgICAgICAgfSxcbiAgICAgICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgICAgICAgZXh0ZXJuYWw6IFsncmVhY3QnLCAncmVhY3QtZG9tJ10sXG4gICAgICAgICAgICBvdXRwdXQ6IHtcbiAgICAgICAgICAgICAgICBjaHVua0ZpbGVOYW1lczogJ1tuYW1lXS5bZm9ybWF0XS5qcycsXG4gICAgICAgICAgICAgICAgZ2xvYmFsczoge1xuICAgICAgICAgICAgICAgICAgICByZWFjdDogJ1JlYWN0JyxcbiAgICAgICAgICAgICAgICAgICAgJ3JlYWN0LWRvbSc6ICdSZWFjdERPTSdcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9LFxuICAgIHBsdWdpbnM6IFtcbiAgICAgICAgcmVhY3QoKSxcbiAgICAgICAgY3NzSW5qZWN0ZWRCeUpzUGx1Z2luKCksXG4gICAgICAgIGR0cyh7IGluc2VydFR5cGVzRW50cnk6IHRydWUgfSlcbiAgICBdXG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBOFosU0FBUyxvQkFBb0I7QUFDM2IsT0FBTyxXQUFXO0FBQ2xCLE9BQU8sU0FBUztBQUNoQixPQUFPLDJCQUEyQjtBQUNsQyxTQUFTLGVBQWU7QUFKeEIsSUFBTSxtQ0FBbUM7QUFNekMsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDeEIsT0FBTztBQUFBLElBQ0gsS0FBSztBQUFBLE1BQ0QsT0FBTyxRQUFRLGtDQUFXLGNBQWM7QUFBQSxNQUN4QyxNQUFNO0FBQUEsTUFDTixTQUFTLENBQUMsTUFBTSxLQUFLO0FBQUEsTUFDckIsVUFBVSxDQUFDLFdBQVcsU0FBUyxXQUFXLE9BQU8sUUFBUSxLQUFLO0FBQUEsSUFDbEU7QUFBQSxJQUNBLGVBQWU7QUFBQSxNQUNYLFVBQVUsQ0FBQyxTQUFTLFdBQVc7QUFBQSxNQUMvQixRQUFRO0FBQUEsUUFDSixnQkFBZ0I7QUFBQSxRQUNoQixTQUFTO0FBQUEsVUFDTCxPQUFPO0FBQUEsVUFDUCxhQUFhO0FBQUEsUUFDakI7QUFBQSxNQUNKO0FBQUEsSUFDSjtBQUFBLEVBQ0o7QUFBQSxFQUNBLFNBQVM7QUFBQSxJQUNMLE1BQU07QUFBQSxJQUNOLHNCQUFzQjtBQUFBLElBQ3RCLElBQUksRUFBRSxrQkFBa0IsS0FBSyxDQUFDO0FBQUEsRUFDbEM7QUFDSixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
