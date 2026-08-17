import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@chatbot-ui/core': path.resolve(__dirname, '../../packages/chatbot-ui/src/index.ts')
        }
    },
    server: {
        allowedHosts: ['localhost', '127.0.0.1', "chat.v2202503187605326384.powersrv.de"],
        port: 5174,
        host: true,
        watch: {
            // Vite only watches within the project root by default; explicitly
            // include the library source so CSS changes trigger HMR.
            ignored: (p: string) => p.includes('node_modules') && !p.includes('packages/chatbot-ui')
        }
    }
})
