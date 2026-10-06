import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: proxies /api to ARGUS_API (default: uvicorn on 127.0.0.1:8000; or https://localhost for the
// real stack in WSL, whose certificate comes from the private ARGUS CA). In production Caddy serves both.
const API = process.env.ARGUS_API || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: { '/api': { target: API, ws: true, secure: false, changeOrigin: true } },
  },
  build: { chunkSizeWarningLimit: 1500 },
})
