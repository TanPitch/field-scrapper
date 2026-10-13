import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    proxy: {
      /* The API runs as a separate process on 8787. Proxying through Vite means
         the browser sees one origin in development: no CORS, and cookies are
         same-origin so the session cookie just works without SameSite or
         Secure juggling. The catch-all preserves the /api and /img prefixes,
         which is why it is not using a bare rewrite. */
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/img': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
});
