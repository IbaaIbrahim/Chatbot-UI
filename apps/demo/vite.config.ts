import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const DEFAULT_ALLOWED_HOSTS = ['localhost', '127.0.0.1']

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    // Dev-server-only setting, so it is read here instead of via import.meta.env —
    // the missing VITE_ prefix keeps it out of the client bundle.
    const env = loadEnv(mode, __dirname, '')
    const configuredHosts = (env.DEV_ALLOWED_HOSTS ?? '')
        .split(',')
        .map((host) => host.trim())
        .filter(Boolean)

    return {
        plugins: [react()],
        resolve: {
            alias: {
                '@chatbot-ui/core': path.resolve(__dirname, '../../packages/chatbot-ui/src/index.ts')
            }
        },
        server: {
            allowedHosts: [...DEFAULT_ALLOWED_HOSTS, ...configuredHosts],
            port: 5174,
            host: true,
            watch: {
                // Vite only watches within the project root by default; explicitly
                // include the library source so CSS changes trigger HMR.
                ignored: (p: string) => p.includes('node_modules') && !p.includes('packages/chatbot-ui')
            }
        }
    }
})
