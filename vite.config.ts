import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'Personal AI Studio',
        short_name: 'AI Studio',
        description: 'Your Models. Your Intelligence. Your Workspace.',
        theme_color: '#0b0f17',
        background_color: '#0b0f17',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^api/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => ['api.openai.com', 'generativelanguage.googleapis.com'].includes(url.hostname),
            handler: 'NetworkOnly'
          }
        ]
      }
    })
  ],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: { chunkSizeWarningLimit: 1200 }
})
