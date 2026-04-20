import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Build for badria_pwa app: output to app public/pwa, base URL for assets
const outDir = path.resolve(__dirname, '../badria_pwa/public/pwa');
const base = '/assets/badria_pwa/pwa/';

export default defineConfig(({ mode }) => ({
  base,
  define: {
    'import.meta.env.VITE_APP_BASE_PATH': JSON.stringify('/assets/badria_pwa/pwa'),
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'lucide-icons': ['lucide-react'],
        },
        chunkFileNames: 'js/[name]-[hash].js',
        entryFileNames: 'js/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        compact: true,
      },
    },
    minify: 'esbuild',
    chunkSizeWarningLimit: 1000,
    sourcemap: false,
    assetsInlineLimit: 4096,
    cssCodeSplit: true,
  },
  server: mode === 'development' ? {
    host: true,
    allowedHosts: ['localhost', '127.0.0.1'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8005',
        changeOrigin: true,
      },
    },
  } : undefined,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.png', 'icon-192x192.png', 'icon-512x512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Badria',
        short_name: 'Badria',
        description: 'Complete field sales solution with customer management, invoicing, payments, and stock tracking',
        theme_color: '#3b82f6',
        background_color: '#3b82f6',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/assets/badria_pwa/pwa/icon-72x72.png', sizes: '72x72', type: 'image/png', purpose: 'any' },
          { src: '/assets/badria_pwa/pwa/icon-96x96.png', sizes: '96x96', type: 'image/png', purpose: 'any' },
          { src: '/assets/badria_pwa/pwa/icon-128x128.png', sizes: '128x128', type: 'image/png', purpose: 'any' },
          { src: '/assets/badria_pwa/pwa/icon-144x144.png', sizes: '144x144', type: 'image/png', purpose: 'any' },
          { src: '/assets/badria_pwa/pwa/icon-152x152.png', sizes: '152x152', type: 'image/png', purpose: 'any' },
          { src: '/assets/badria_pwa/pwa/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/assets/badria_pwa/pwa/icon-384x384.png', sizes: '384x384', type: 'image/png', purpose: 'any' },
          { src: '/assets/badria_pwa/pwa/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
        shortcuts: [
          { name: 'New Sale', short_name: 'Sale', description: 'Create a new sales invoice', url: '/?view=sales', icons: [{ src: '/assets/badria_pwa/pwa/icon-192x192.png', sizes: '192x192' }] },
          { name: 'Collect Payment', short_name: 'Payment', description: 'Collect a payment', url: '/?view=payments', icons: [{ src: '/assets/badria_pwa/pwa/icon-192x192.png', sizes: '192x192' }] },
          { name: 'View Stock', short_name: 'Stock', description: 'Check stock levels', url: '/?view=stock', icons: [{ src: '/assets/badria_pwa/pwa/icon-192x192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,json}'],
        globIgnores: ['**/node_modules/**/*', '**/sw.js', '**/workbox-*.js'],
        runtimeCaching: [
          { urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i, handler: 'CacheFirst', options: { cacheName: 'google-fonts-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } } },
          { urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i, handler: 'CacheFirst', options: { cacheName: 'gstatic-fonts-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } } },
          { urlPattern: /\/api\/.*/i, handler: 'NetworkFirst', options: { cacheName: 'api-cache', expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 }, cacheableResponse: { statuses: [0, 200] }, networkTimeoutSeconds: 10 } },
          { urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/, handler: 'CacheFirst', options: { cacheName: 'images-cache', expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 } } },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
}));
