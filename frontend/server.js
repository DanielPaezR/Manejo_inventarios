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
app.use(express.static(path.join(__dirname, 'dist')));

// Ruta catch-all
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ✅ ESCUCHAR EN 0.0.0.0 (IMPORTANTE PARA DOCKER/RAILWAY)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Frontend funcionando en puerto ${PORT}`);
  console.log(`🌐 URL externa: https://agile-trust-production-eae8.up.railway.app`);
});