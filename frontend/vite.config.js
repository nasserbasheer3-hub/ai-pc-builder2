import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxy = {
  '/api': { target: 'http://localhost:3001', changeOrigin: true },
  '/uploads': { target: 'http://localhost:3001', changeOrigin: true },
  '/robots.txt': { target: 'http://localhost:3001' },
  '/sitemap.xml': { target: 'http://localhost:3001' },
  '/rss.xml': { target: 'http://localhost:3001' },
  '/og-image.svg': { target: 'http://localhost:3001' },
};

// Cache long-lived, content-hashed assets immutably so browsers skip revalidation.
function previewCacheHeaders() {
  return {
    name: 'preview-cache-headers',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        if (url.includes('/assets/') && (url.includes('.js') || url.includes('.css'))) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (url.includes('/assets/')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), previewCacheHeaders()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['.monkeycode-ai.live'],
    proxy,
  },
  preview: {
    port: 5173,
    host: true,
    strictPort: true,
    allowedHosts: ['.monkeycode-ai.live'],
    proxy,
  },
  build: {
    chunkSizeWarningLimit: 1200,
    target: 'es2018',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'react-vendor';
            if (id.includes('react-router')) return 'router';
            return 'vendor';
          }
        },
      },
    },
  },
});
