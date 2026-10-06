import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: the API runs on 127.0.0.1:8000 (uvicorn). In the stack, Caddy serves both on one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: { '/api': { target: 'http://127.0.0.1:8000', ws: true } },
  },
  build: { chunkSizeWarningLimit: 1500 },
})
