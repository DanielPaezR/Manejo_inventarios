import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ✅ USAR EL PUERTO DE RAILWAY SIN FALLBACK
const PORT = process.env.PORT || 3000;

console.log('=== INICIANDO FRONTEND ===');
console.log('🔧 Puerto:', PORT);
console.log('📁 Ruta dist:', path.join(__dirname, 'dist'));

// Middleware de logs
app.use((req, res, next) => {
  console.log(`📍 [${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Health check
app.get('/health', (req, res) => {
  console.log('✅ Health check accedido');
  res.json({ 
    status: 'OK', 
    service: 'frontend', 
    port: PORT,
    timestamp: new Date().toISOString() 
  });
});

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'dist'), {
  setHeaders: (res, filePath) => {
    // Algunos servidores sirven .webmanifest como application/octet-stream
    // si el mime-db no lo reconoce; el estándar es application/manifest+json.
    if (filePath.endsWith('.webmanifest')) {
      res.setHeader('Content-Type', 'application/manifest+json');
    }

    // El service worker (generateSW de vite-plugin-pwa genera sw.js) debe
    // revisarse siempre: este proyecto se despliega varias veces al día, y
    // si el navegador lo cachea puede quedarse pegado a una versión vieja.
    if (path.basename(filePath) === 'sw.js') {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }

    // Los JS/CSS que genera Vite dentro de dist/assets/ llevan un hash de
    // contenido en el nombre (ej. index-8f87bdd6.js) — un build nuevo
    // siempre produce un nombre distinto, así que cachearlos por mucho
    // tiempo es seguro y acelera la carga. index.html, el manifest y los
    // íconos (sin hash) se quedan con el comportamiento por defecto.
    const relativePath = path.relative(path.join(__dirname, 'dist'), filePath);
    if (relativePath.startsWith('assets' + path.sep)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// Ruta catch-all
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ✅ ESCUCHAR EN 0.0.0.0 (IMPORTANTE PARA DOCKER/RAILWAY)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Frontend funcionando en puerto ${PORT}`);
  console.log(`🌐 URL externa: https://agile-trust-production-eae8.up.railway.app`);
});