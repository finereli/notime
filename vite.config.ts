// pwa-kit: shell/vite.config.ts v9
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'
import { buildNumber, pwaOptions } from './shared/build/pwa-build'

// Seams: MAJOR, the manifest, includeAssets.
const MAJOR = 1

export default defineConfig({
  define: {
    __BUILD__: JSON.stringify(buildNumber(MAJOR)),
  },
  resolve: {
    alias: { $shared: fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  plugins: [
    svelte(),
    VitePWA(
      pwaOptions({
        includeAssets: ['icons/*.png', 'icons/*.svg'],
        manifest: {
          name: 'notime',
          short_name: 'notime',
          description: 'Post to X and answer your notifications. No timeline.',
          lang: 'en',
          dir: 'ltr',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#f4f6f3',
          theme_color: '#1f4a41',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        // Push lives in a small static file the generated worker imports. The
        // browser byte-checks imported scripts on every update check, so a
        // change to it rides the same update flow as everything else.
        workbox: { importScripts: ['/push-sw.js'], globIgnores: ['**/node_modules/**/*', '**/reset.html', '**/push-sw.js'] },
        // The OAuth pages agents send the owner to are the server's, not the
        // app's: the worker must not answer them with the cached app.
        navigateFallbackDenylist: [/^\/api\//, /^\/icons\//, /^\/fonts\//, /^\/reset(\.html)?$/, /^\/oauth\//, /^\/mcp$/, /^\/\.well-known\//],
      })
    ),
  ],
  test: { include: ['test/**/*.test.ts'] },
})
