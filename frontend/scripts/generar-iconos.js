// Genera los íconos placeholder de la PWA (frontend/public/icon-192.png y
// icon-512.png): un cuadrado sólido color #4299e1, sin texto ni nada cerca
// de los bordes, para que también sirva como ícono "maskable" sin recortes
// raros. Reemplazar cuando haya un logo real — basta con volver a correr
// este script (o borrar los PNG y poner los definitivos con el mismo
// nombre).
//
// Uso: node scripts/generar-iconos.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COLOR = { r: 0x42, g: 0x99, b: 0xe1 }; // #4299e1

function generarIcono(tamano, destino) {
  const png = new PNG({ width: tamano, height: tamano });

  for (let y = 0; y < tamano; y++) {
    for (let x = 0; x < tamano; x++) {
      const idx = (tamano * y + x) << 2;
      png.data[idx] = COLOR.r;
      png.data[idx + 1] = COLOR.g;
      png.data[idx + 2] = COLOR.b;
      png.data[idx + 3] = 255;
    }
  }

  const buffer = PNG.sync.write(png);
  fs.writeFileSync(destino, buffer);
  console.log(`✅ Generado ${destino} (${tamano}x${tamano})`);
}

const publicDir = path.join(__dirname, '..', 'public');
generarIcono(192, path.join(publicDir, 'icon-192.png'));
generarIcono(512, path.join(publicDir, 'icon-512.png'));
