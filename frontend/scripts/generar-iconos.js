// Rasteriza frontend/scripts/icono-tienda.svg a los PNG que usa el manifest
// de la PWA (frontend/public/icon-192.png y icon-512.png).
//
// Requiere sharp (devDependency temporal): npm install sharp -D
// Uso: node scripts/generar-iconos.js

import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const svgPath = path.join(__dirname, 'icono-tienda.svg');
const publicDir = path.join(__dirname, '..', 'public');

async function generarIcono(tamano, destino) {
  await sharp(svgPath)
    .resize(tamano, tamano)
    .png()
    .toFile(destino);
  const { width, height } = await sharp(destino).metadata();
  console.log(`✅ Generado ${destino} (${width}x${height})`);
}

await generarIcono(192, path.join(publicDir, 'icon-192.png'));
await generarIcono(512, path.join(publicDir, 'icon-512.png'));
