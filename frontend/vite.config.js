import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true
        // IMPORTANTE: no agregar runtimeCaching para rutas /api/*. Este POS
        // depende de datos en vivo (stock, precios, ventas) — el service
        // worker solo debe cachear los assets estáticos del build, nunca
        // las respuestas de la API.
      },
      manifest: {
        name: 'Mi Negocio',
        short_name: 'Mi Negocio',
        description: 'Sistema de inventario y ventas',
        lang: 'es',
        theme_color: '#4299e1',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ],
  build: {
    outDir: 'dist'
  }
})