import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ MIDDLEWARE DE LOGS DETALLADO
app.use((req, res, next) => {
  console.log(`📍 [${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log(`📍 Headers:`, req.headers);
  next();
});

// Verificar build
console.log('=== VERIFICACIÓN DE BUILD ===');
const distPath = path.join(__dirname, 'dist');
console.log('📁 Archivos en dist/:', fs.readdirSync(distPath));

// Health check
app.get('/health', (req, res) => {
  console.log('✅ Health check accedido');
  res.json({ status: 'OK', service: 'frontend', timestamp: new Date().toISOString() });
});

// Servir archivos estáticos CON CONFIGURACIÓN EXPLÍCITA
app.use('/assets', express.static(path.join(distPath, 'assets'), {
  maxAge: '1y',
  etag: true
}));

app.use(express.static(distPath, {
  maxAge: '1y',
  etag: true,
  index: 'index.html'
}));

// Ruta catch-all MEJORADA
app.get('*', (req, res) => {
  console.log(`🔄 Catch-all route: ${req.url}`);
  const indexPath = path.join(distPath, 'index.html');
  
  if (fs.existsSync(indexPath)) {
    console.log(`✅ Sirviendo index.html`);
    res.setHeader('Content-Type', 'text/html');
    res.sendFile(indexPath);
  } else {
    console.log(`❌ index.html no encontrado`);
    res.status(404).send('Build no encontrado');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Frontend funcionando en puerto ${PORT}`);
  console.log(`📍 Ruta dist: ${distPath}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
});