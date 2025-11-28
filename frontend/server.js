import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ VERIFICACIÓN COMPLETA DEL BUILD
console.log('=== VERIFICANDO BUILD ===');
const distPath = path.join(__dirname, 'dist');

try {
  const files = fs.readdirSync(distPath);
  console.log('📁 Archivos en dist/:', files);
  
  // Verificar archivos críticos
  const criticalFiles = ['index.html', 'assets'];
  criticalFiles.forEach(file => {
    const filePath = path.join(distPath, file);
    if (fs.existsSync(filePath)) {
      console.log(`✅ ${file} encontrado`);
    } else {
      console.log(`❌ ${file} NO encontrado`);
    }
  });
} catch (error) {
  console.log('❌ ERROR accediendo a dist/:', error.message);
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'frontend' });
});

// Servir archivos estáticos
app.use(express.static(distPath));

// ✅ RUTA CATCH-ALL MEJORADA
app.get('*', (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    console.log(`🔄 Sirviendo index.html para: ${req.url}`);
    res.sendFile(indexPath);
  } else {
    console.log(`❌ index.html no encontrado en: ${indexPath}`);
    res.status(404).send('Archivo de build no encontrado');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Frontend funcionando en puerto ${PORT}`);
});