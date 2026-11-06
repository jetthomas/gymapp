import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // http://localhost:5173/api/auth/login -> http://127.0.0.1:5080/auth/login
      '/api': {
        target: 'http://127.0.0.1:5080/',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})