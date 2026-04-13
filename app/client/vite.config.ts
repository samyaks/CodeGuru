import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiTarget = process.env.API_URL || 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/auth': {
        target: apiTarget,
        changeOrigin: true,
        bypass(req) {
          if (req.url?.startsWith('/auth/callback')) return req.url;
        },
      },
      '/health': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/t.js': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
