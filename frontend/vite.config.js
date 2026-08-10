import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // injectManifest (en vez de generateSW): sw.js es nuestro, con código
      // propio para push notifications. Vite lo compila y le inyecta
      // self.__WB_MANIFEST con la lista de assets a precachear — el
      // comentario de abajo sobre no cachear /api/* sigue aplicando, solo
      // que ahora es automático porque sw.js no define ningún
      // runtimeCaching para esas rutas.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
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