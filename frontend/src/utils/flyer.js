// Motor de flyers para redes sociales. Dibuja en un <canvas> a resolución
// real (post 1080x1350, historia 1080x1920) con 4 plantillas:
//   editorial · vibrante · noche · fresco
// y 3 tipos de contenido: menú completo, un producto, una promoción.

export const FORMATOS = {
  post: { ancho: 1080, alto: 1350, nombre: 'Post (4:5)' },
  historia: { ancho: 1080, alto: 1920, nombre: 'Historia (9:16)' }
};

export const PLANTILLAS = [
  { id: 'editorial', nombre: 'Editorial', descripcion: 'Limpia, tipo revista' },
  { id: 'vibrante', nombre: 'Vibrante', descripcion: 'Colores fuertes y sello de precio' },
  { id: 'noche', nombre: 'Noche', descripcion: 'Oscura y elegante, con dorado' },
  { id: 'fresco', nombre: 'Fresco', descripcion: 'Polaroid y letra a mano' }
];

const FUENTES_URL = 'https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800;900&family=Playfair+Display:ital,wght@0,700;1,600&family=Caveat:wght@700&display=swap';

let fuentesListas = null;
export const cargarFuentes = () => {
  if (fuentesListas) return fuentesListas;
  if (!document.querySelector(`link[href="${FUENTES_URL}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = FUENTES_URL;
    document.head.appendChild(link);
  }
  fuentesListas = Promise.all([
    '900 80px Archivo', '800 40px Archivo', '700 40px Archivo', '500 30px Archivo',
    '700 80px "Playfair Display"', 'italic 600 80px "Playfair Display"', '700 80px Caveat'
  ].map(f => document.fonts.load(f).catch(() => null))).then(() => document.fonts.ready);
  return fuentesListas;
};

const cacheImagenes = new Map();

// Para el lienzo se pide a Cloudinary una versión de máximo 1200 px: carga
// más rápido y, al ser otra dirección, no choca con la copia que el
// navegador ya guardó sin permiso CORS (las miniaturas normales).
const urlParaLienzo = (url) => (
  /res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(url) && !/\/upload\/(w_|c_|q_)/.test(url)
    ? url.replace('/image/upload/', '/image/upload/w_1200,c_limit,q_auto/')
    : url
);

const intentarCarga = (url) => new Promise((resolve) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = url;
});

export const cargarImagen = (url) => {
  if (!url) return Promise.resolve(null);
  if (cacheImagenes.has(url)) return cacheImagenes.get(url);
  const promesa = (async () => {
    if (url.startsWith('data:')) return intentarCarga(url);
    const img = await intentarCarga(urlParaLienzo(url));
    if (img) return img;
    // Segundo intento con otra dirección para saltar la caché del navegador.
    return intentarCarga(`${url}${url.includes('?') ? '&' : '?'}flyer=1`);
  })();
  cacheImagenes.set(url, promesa);
  // Si falló, no se guarda: se puede volver a intentar más tarde.
  promesa.then(img => { if (!img) cacheImagenes.delete(url); });
  return promesa;
};

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;

// ---------- Utilidades de dibujo ----------
const caminoRedondeado = (ctx, x, y, w, h, r) => {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
};

// Dibuja la imagen llenando el recuadro (como object-fit: cover).
const imagenCubrir = (ctx, img, x, y, w, h, radio = 0) => {
  ctx.save();
  if (radio) { caminoRedondeado(ctx, x, y, w, h, radio); ctx.clip(); }
  if (img) {
    const escala = Math.max(w / img.width, h / img.height);
    const iw = img.width * escala;
    const ih = img.height * escala;
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  }
  ctx.restore();
};

// Varias fotos en un recuadro (collage), o un bloque de color si no hay.
const collage = (ctx, imgs, x, y, w, h, radio, colorVacio, separacion = 8) => {
  const validas = imgs.filter(Boolean).slice(0, 4);
  ctx.save();
  caminoRedondeado(ctx, x, y, w, h, radio);
  ctx.clip();
  ctx.fillStyle = colorVacio;
  ctx.fillRect(x, y, w, h);
  const s = separacion;
  if (validas.length === 1) imagenCubrir(ctx, validas[0], x, y, w, h);
  else if (validas.length === 2) {
    imagenCubrir(ctx, validas[0], x, y, w / 2 - s / 2, h);
    imagenCubrir(ctx, validas[1], x + w / 2 + s / 2, y, w / 2 - s / 2, h);
  } else if (validas.length === 3) {
    imagenCubrir(ctx, validas[0], x, y, w * 0.6 - s / 2, h);
    imagenCubrir(ctx, validas[1], x + w * 0.6 + s / 2, y, w * 0.4 - s / 2, h / 2 - s / 2);
    imagenCubrir(ctx, validas[2], x + w * 0.6 + s / 2, y + h / 2 + s / 2, w * 0.4 - s / 2, h / 2 - s / 2);
  } else if (validas.length === 4) {
    const cw = w / 2 - s / 2;
    const ch = h / 2 - s / 2;
    imagenCubrir(ctx, validas[0], x, y, cw, ch);
    imagenCubrir(ctx, validas[1], x + cw + s, y, cw, ch);
    imagenCubrir(ctx, validas[2], x, y + ch + s, cw, ch);
    imagenCubrir(ctx, validas[3], x + cw + s, y + ch + s, cw, ch);
  }
  ctx.restore();
};

// Parte un texto en líneas que quepan en el ancho; corta con "…" si sobra.
const lineasDeTexto = (ctx, texto, ancho, maxLineas) => {
  const palabras = String(texto || '').split(/\s+/).filter(Boolean);
  const lineas = [];
  let actual = '';
  for (const p of palabras) {
    const prueba = actual ? `${actual} ${p}` : p;
    if (ctx.measureText(prueba).width <= ancho || !actual) actual = prueba;
    else { lineas.push(actual); actual = p; }
  }
  if (actual) lineas.push(actual);
  if (lineas.length > maxLineas) {
    const cortadas = lineas.slice(0, maxLineas);
    let ultima = cortadas[maxLineas - 1];
    while (ctx.measureText(`${ultima}…`).width > ancho && ultima.length > 1) ultima = ultima.slice(0, -1);
    cortadas[maxLineas - 1] = `${ultima}…`;
    return cortadas;
  }
  return lineas;
};

// Ajusta el tamaño de letra para que el título quepa en N líneas.
const tituloAjustado = (ctx, texto, { fuente, maximo, minimo, ancho, maxLineas }) => {
  let tam = maximo;
  let lineas;
  do {
    ctx.font = fuente(tam);
    lineas = lineasDeTexto(ctx, texto, ancho, 99);
    // Cabe si no pasa de N líneas y ninguna palabra larga se sale del ancho.
    if (lineas.length <= maxLineas && lineas.every(l => ctx.measureText(l).width <= ancho)) break;
    tam -= 4;
  } while (tam > minimo);
  ctx.font = fuente(tam);
  return { tam, lineas: lineasDeTexto(ctx, texto, ancho, maxLineas) };
};

const escribirLineas = (ctx, lineas, x, y, altoLinea) => {
  lineas.forEach((l, i) => ctx.fillText(l, x, y + i * altoLinea));
  return y + lineas.length * altoLinea;
};

const mezclar = (hex, otro, t) => {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(otro.slice(1), 16);
  const c = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return `#${[16, 8, 0].map(s => c(s).toString(16).padStart(2, '0')).join('')}`;
};

const bloqueQR = (ctx, qr, x, y, tam, { fondo = '#fff', radio = 18, texto, colorTexto = '#141312', fuente = '700 26px Archivo', alinear = 'left' } = {}) => {
  if (!qr) return;
  ctx.save();
  ctx.fillStyle = fondo;
  caminoRedondeado(ctx, x, y, tam, tam, radio);
  ctx.fill();
  const m = tam * 0.08;
  ctx.drawImage(qr, x + m, y + m, tam - 2 * m, tam - 2 * m);
  if (texto) {
    ctx.fillStyle = colorTexto;
    ctx.font = fuente;
    ctx.textAlign = alinear;
    ctx.textBaseline = 'top';
    ctx.fillText(texto, alinear === 'left' ? x : x + tam, y + tam + 14);
  }
  ctx.restore();
};

// Sello estrellado con el precio o el descuento (plantilla vibrante).
const sello = (ctx, cx, cy, radio, puntas, color, angulo = -0.2) => {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angulo);
  ctx.beginPath();
  for (let i = 0; i < puntas * 2; i++) {
    const r = i % 2 === 0 ? radio : radio * 0.86;
    const a = (Math.PI * i) / puntas;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fill();
  ctx.restore();
};

// Lista de productos para el flyer del menú o de la promoción.
const listaPrecios = (ctx, items, x, y, ancho, { fuente, fuentePrecio, color, colorPrecio, colorPunteado, alto = 64, max = 5, limiteY = Infinity }) => {
  // Solo las líneas que caben antes del pie (precio, QR).
  const caben = Math.max(0, Math.min(max, Math.floor((limiteY - y) / alto) + 1));
  items.slice(0, caben).forEach((it, i) => {
    const yy = y + i * alto;
    ctx.font = fuente;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const precio = it.precio !== undefined && it.precio !== null ? pesos(it.precio) : '';
    ctx.font = fuentePrecio;
    const anchoPrecio = precio ? ctx.measureText(precio).width : 0;
    ctx.font = fuente;
    const nombre = lineasDeTexto(ctx, it.nombre, ancho - anchoPrecio - 60, 1)[0] || '';
    ctx.fillText(nombre, x, yy);
    const finNombre = x + ctx.measureText(nombre).width + 16;
    if (precio) {
      ctx.save();
      ctx.strokeStyle = colorPunteado;
      ctx.lineWidth = 3;
      ctx.setLineDash([3, 10]);
      ctx.beginPath();
      ctx.moveTo(finNombre, yy - 8);
      ctx.lineTo(x + ancho - anchoPrecio - 16, yy - 8);
      ctx.stroke();
      ctx.restore();
      ctx.font = fuentePrecio;
      ctx.fillStyle = colorPrecio;
      ctx.textAlign = 'right';
      ctx.fillText(precio, x + ancho, yy);
    }
  });
  return y + Math.min(items.length, caben) * alto;
};

// ======================================================================
// Plantillas
// datos: { tipo, negocio, titulo, mensaje, cta, url, precio, precioAntes,
//          ahorroPct, items, imgs (fotos ya cargadas), qr (imagen), color,
//          mostrarPrecio, mostrarQR, extras: [textos cortos] }
// ======================================================================

function editorial(ctx, W, H, d) {
  const historia = H > 1500;
  const acento = d.color;
  ctx.fillStyle = '#f7f3ee';
  ctx.fillRect(0, 0, W, H);
  const M = 72;

  // Cabecera: nombre del negocio y etiqueta
  ctx.fillStyle = '#141312';
  ctx.font = '800 30px Archivo';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.letterSpacing = '6px';
  ctx.fillText(d.negocio.toUpperCase(), M, M);
  ctx.textAlign = 'right';
  ctx.fillStyle = acento;
  const etiqueta = d.tipo === 'promo' ? 'PROMOCIÓN' : d.tipo === 'menu' ? 'MENÚ' : 'DESTACADO';
  ctx.fillText(etiqueta, W - M, M);
  ctx.letterSpacing = '0px';
  ctx.fillStyle = '#141312';
  ctx.fillRect(M, M + 52, W - 2 * M, 3);

  // Foto grande
  const fotoY = M + 88;
  const fotoH = historia ? (d.tipo === 'menu' ? 820 : 1000) : (d.tipo === 'menu' ? 470 : 600);
  collage(ctx, d.imgs, M, fotoY, W - 2 * M, fotoH, 28, mezclar(acento, '#ffffff', 0.75));

  if (d.mostrarPrecio && d.ahorroPct > 0) {
    ctx.save();
    ctx.fillStyle = acento;
    caminoRedondeado(ctx, M + 28, fotoY + 28, 190, 80, 40);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '900 44px Archivo';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`-${d.ahorroPct}%`, M + 123, fotoY + 70);
    ctx.restore();
  }

  // Título
  let y = fotoY + fotoH + 54;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#141312';
  const t = tituloAjustado(ctx, d.titulo.toUpperCase(), { fuente: (s) => `900 ${s}px Archivo`, maximo: historia ? 128 : 112, minimo: 56, ancho: W - 2 * M, maxLineas: 2 });
  y = escribirLineas(ctx, t.lineas, M, y, t.tam * 0.95) + 18;

  if (d.mensaje) {
    ctx.font = '500 34px Archivo';
    ctx.fillStyle = '#5b5550';
    y = escribirLineas(ctx, lineasDeTexto(ctx, d.mensaje, W - 2 * M, 2), M, y, 46) + 16;
  }

  if (d.tipo === 'menu' && d.items.length) {
    y = listaPrecios(ctx, d.items, M, y + 48, W - 2 * M, {
      fuente: '700 36px Archivo', fuentePrecio: '900 36px Archivo', color: '#141312', colorPrecio: acento,
      colorPunteado: '#c9c1b8', alto: 62, max: historia ? 7 : 3, limiteY: H - M - 150 - 24
    });
  } else if (d.tipo === 'promo' && d.items.length) {
    ctx.font = '700 32px Archivo';
    ctx.fillStyle = '#141312';
    y = escribirLineas(ctx, lineasDeTexto(ctx, d.items.map(i => `${i.cantidad > 1 ? `${i.cantidad} × ` : ''}${i.nombre}`).join('  +  '), W - 2 * M, 2), M, y, 44);
  }

  // Precio y pie
  const pieY = H - M - 150;
  if (d.mostrarPrecio && d.precio) {
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = acento;
    ctx.font = '900 110px Archivo';
    ctx.fillText(pesos(d.precio), M, pieY + 100);
    if (d.precioAntes) {
      const ancho = ctx.measureText(pesos(d.precio)).width;
      ctx.font = '700 40px Archivo';
      ctx.fillStyle = '#9a928a';
      const antes = pesos(d.precioAntes);
      ctx.fillText(antes, M + ancho + 24, pieY + 96);
      const aw = ctx.measureText(antes).width;
      ctx.fillRect(M + ancho + 24, pieY + 82, aw, 4);
    }
  }
  if (d.mostrarQR) {
    bloqueQR(ctx, d.qr, W - M - 150, pieY, 150, { fondo: '#ffffff', texto: d.cta, alinear: 'right', fuente: '800 24px Archivo' });
  } else if (d.cta) {
    ctx.textAlign = 'right';
    ctx.font = '800 34px Archivo';
    ctx.fillStyle = '#141312';
    ctx.fillText(`${d.cta} →`, W - M, pieY + 100);
  }
  ctx.fillStyle = '#141312';
  ctx.fillRect(M, H - M - 18, W - 2 * M, 3);
  if (d.extras.length) {
    ctx.font = '700 24px Archivo';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#5b5550';
    ctx.fillText(d.extras.join('   ·   '), M, H - M);
  }
}

function vibrante(ctx, W, H, d) {
  const historia = H > 1500;
  const acento = d.color;
  const oscuro = mezclar(acento, '#000000', 0.45);
  // Fondo con degradado y franjas diagonales
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, mezclar(acento, '#ffffff', 0.08));
  g.addColorStop(1, oscuro);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#fff';
  for (let i = -H; i < W + H; i += 120) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 50, 0);
    ctx.lineTo(i + 50 - H, H);
    ctx.lineTo(i - H, H);
    ctx.fill();
  }
  ctx.restore();

  const M = 70;
  // Etiqueta superior
  ctx.fillStyle = '#ffe14d';
  const etiqueta = d.tipo === 'promo' ? '¡PROMO!' : d.tipo === 'menu' ? '¡PIDE YA!' : '¡NUEVO!';
  ctx.font = '900 34px Archivo';
  const ew = ctx.measureText(etiqueta).width + 56;
  caminoRedondeado(ctx, M, M, ew, 68, 34);
  ctx.fill();
  ctx.fillStyle = '#141312';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(etiqueta, M + ew / 2, M + 35);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#fff';
  ctx.font = '800 30px Archivo';
  ctx.fillText(d.negocio.toUpperCase(), W - M, M + 35);

  // Título gigante
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#fff';
  const t = tituloAjustado(ctx, d.titulo.toUpperCase(), { fuente: (s) => `900 ${s}px Archivo`, maximo: historia ? 150 : 128, minimo: 60, ancho: W - 2 * M, maxLineas: 3 });
  let y = escribirLineas(ctx, t.lineas, M, M + 120, t.tam * 0.92) + 8;
  if (d.mensaje) {
    ctx.font = '700 36px Archivo';
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    y = escribirLineas(ctx, lineasDeTexto(ctx, d.mensaje, W - 2 * M, 2), M, y + 10, 48);
  }

  // Foto inclinada con marco blanco
  const fotoW = W - 2 * M - 40;
  const fotoH = historia ? 820 : Math.min(560, H - y - 330);
  const fotoX = M + 20;
  const fotoY = y + 50;
  ctx.save();
  ctx.translate(fotoX + fotoW / 2, fotoY + fotoH / 2);
  ctx.rotate(-0.035);
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 24;
  ctx.fillStyle = '#fff';
  caminoRedondeado(ctx, -fotoW / 2 - 14, -fotoH / 2 - 14, fotoW + 28, fotoH + 28, 40);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  collage(ctx, d.imgs, -fotoW / 2, -fotoH / 2, fotoW, fotoH, 30, mezclar(acento, '#ffffff', 0.6));
  ctx.restore();

  // Sello con precio
  if (d.mostrarPrecio && d.precio) {
    const cx = W - M - 110;
    const cy = fotoY + 30;
    sello(ctx, cx, cy, 165, 14, '#ffe14d');
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.2);
    ctx.fillStyle = '#141312';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (d.ahorroPct > 0) {
      ctx.font = '900 34px Archivo';
      ctx.fillText(`-${d.ahorroPct}%`, 0, -52);
    } else {
      ctx.font = '800 28px Archivo';
      ctx.fillText('SOLO', 0, -50);
    }
    const precio = pesos(d.precio);
    let tam = 64;
    ctx.font = `900 ${tam}px Archivo`;
    while (ctx.measureText(precio).width > 250 && tam > 36) { tam -= 4; ctx.font = `900 ${tam}px Archivo`; }
    ctx.fillText(precio, 0, 10);
    if (d.precioAntes) {
      ctx.font = '700 28px Archivo';
      const antes = `antes ${pesos(d.precioAntes)}`;
      ctx.fillText(antes, 0, 62);
    }
    ctx.restore();
  }

  // Lista (menú) o componentes (promo)
  let yLista = fotoY + fotoH + 70;
  if (d.tipo === 'menu' && d.items.length && historia) {
    yLista = listaPrecios(ctx, d.items, M, yLista + 40, W - 2 * M, {
      fuente: '800 38px Archivo', fuentePrecio: '900 38px Archivo', color: '#fff', colorPrecio: '#ffe14d',
      colorPunteado: 'rgba(255,255,255,0.4)', alto: 64, max: 5, limiteY: H - M - 230
    });
  } else if (d.tipo === 'promo' && d.items.length) {
    ctx.font = '800 32px Archivo';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    escribirLineas(ctx, lineasDeTexto(ctx, d.items.map(i => `${i.cantidad > 1 ? `${i.cantidad} × ` : ''}${i.nombre}`).join('  +  '), W - 2 * M - (d.mostrarQR ? 200 : 0), 2), M, yLista, 44);
  }

  // Pie
  if (d.mostrarQR) {
    bloqueQR(ctx, d.qr, W - M - 160, H - M - 200, 160, { fondo: '#fff', texto: d.cta, colorTexto: '#fff', alinear: 'right', fuente: '800 26px Archivo' });
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.font = '900 44px Archivo';
  if (!d.mostrarQR && d.cta) ctx.fillText(`${d.cta} →`, M, H - M - 40);
  if (d.extras.length) {
    ctx.font = '700 26px Archivo';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(d.extras.join('  ·  '), M, H - M);
  }
}

function noche(ctx, W, H, d) {
  const historia = H > 1500;
  const dorado = '#d8b56a';
  ctx.fillStyle = '#0e0d0c';
  ctx.fillRect(0, 0, W, H);

  // Foto de fondo arriba con degradado hacia negro
  const fotoH = historia ? H * 0.58 : H * 0.6;
  collage(ctx, d.imgs, 0, 0, W, fotoH, 0, '#2a2622', 4);
  const g = ctx.createLinearGradient(0, fotoH * 0.35, 0, fotoH);
  g.addColorStop(0, 'rgba(14,13,12,0)');
  g.addColorStop(1, 'rgba(14,13,12,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, fotoH + 2);
  const g2 = ctx.createLinearGradient(0, 0, 0, 220);
  g2.addColorStop(0, 'rgba(14,13,12,0.75)');
  g2.addColorStop(1, 'rgba(14,13,12,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, 220);

  // Marco dorado fino
  const M = 48;
  ctx.strokeStyle = dorado;
  ctx.lineWidth = 2;
  ctx.strokeRect(M, M, W - 2 * M, H - 2 * M);

  // Nombre del negocio arriba al centro
  ctx.fillStyle = dorado;
  ctx.font = '700 28px Archivo';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.letterSpacing = '10px';
  ctx.fillText(d.negocio.toUpperCase(), W / 2, M + 40);
  ctx.letterSpacing = '0px';

  // Bloque de texto
  let y = fotoH - (historia ? 40 : 90);
  ctx.fillStyle = dorado;
  ctx.font = '700 26px Archivo';
  ctx.letterSpacing = '8px';
  const etiqueta = d.tipo === 'promo' ? 'PROMOCIÓN ESPECIAL' : d.tipo === 'menu' ? 'NUESTRA CARTA' : 'RECOMENDADO';
  ctx.fillText(etiqueta, W / 2, y);
  ctx.letterSpacing = '0px';
  y += 56;
  ctx.fillStyle = '#f5efe6';
  const t = tituloAjustado(ctx, d.titulo, { fuente: (s) => `italic 600 ${s}px "Playfair Display"`, maximo: historia ? 120 : 104, minimo: 54, ancho: W - 2 * M - 80, maxLineas: 2 });
  y = escribirLineas(ctx, t.lineas, W / 2, y, t.tam * 1.08) + 10;

  // Separador dorado con rombo
  ctx.fillStyle = dorado;
  ctx.fillRect(W / 2 - 160, y + 14, 120, 2);
  ctx.fillRect(W / 2 + 40, y + 14, 120, 2);
  ctx.save();
  ctx.translate(W / 2, y + 15);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-8, -8, 16, 16);
  ctx.restore();
  y += 56;

  if (d.mensaje) {
    ctx.font = '500 32px Archivo';
    ctx.fillStyle = 'rgba(245,239,230,0.75)';
    y = escribirLineas(ctx, lineasDeTexto(ctx, d.mensaje, W - 2 * M - 120, 2), W / 2, y, 44) + 12;
  }

  if (d.tipo === 'menu' && d.items.length) {
    y = listaPrecios(ctx, d.items, M + 70, y + 30, W - 2 * M - 140, {
      fuente: '600 34px "Playfair Display"', fuentePrecio: '700 34px Archivo', color: '#f5efe6', colorPrecio: dorado,
      colorPunteado: 'rgba(216,181,106,0.45)', alto: 60, max: historia ? 6 : 3, limiteY: H - M - 190 - 20
    });
  } else if (d.tipo === 'promo' && d.items.length) {
    ctx.font = '600 32px "Playfair Display"';
    ctx.fillStyle = '#f5efe6';
    ctx.textAlign = 'center';
    y = escribirLineas(ctx, lineasDeTexto(ctx, d.items.map(i => `${i.cantidad > 1 ? `${i.cantidad} × ` : ''}${i.nombre}`).join('  ·  '), W - 2 * M - 120, 2), W / 2, y, 44);
  }

  // Precio y QR al pie
  const pieY = H - M - 190;
  ctx.textAlign = 'center';
  if (d.mostrarPrecio && d.precio) {
    const xPrecio = d.mostrarQR ? M + 70 : W / 2;
    ctx.textAlign = d.mostrarQR ? 'left' : 'center';
    ctx.textBaseline = 'alphabetic';
    if (d.precioAntes) {
      ctx.font = '500 34px Archivo';
      ctx.fillStyle = 'rgba(245,239,230,0.5)';
      const antes = pesos(d.precioAntes);
      ctx.fillText(antes, xPrecio, pieY + 40);
      const aw = ctx.measureText(antes).width;
      ctx.fillRect(d.mostrarQR ? xPrecio : xPrecio - aw / 2, pieY + 28, aw, 2);
    }
    ctx.font = '700 96px "Playfair Display"';
    ctx.fillStyle = dorado;
    ctx.fillText(pesos(d.precio), xPrecio, pieY + 140);
  }
  if (d.mostrarQR) {
    bloqueQR(ctx, d.qr, W - M - 70 - 150, pieY, 150, { fondo: '#f5efe6', radio: 6, texto: d.cta, colorTexto: dorado, alinear: 'right', fuente: '700 22px Archivo' });
  } else if (d.cta) {
    ctx.textAlign = 'center';
    ctx.font = '700 30px Archivo';
    ctx.fillStyle = dorado;
    ctx.letterSpacing = '6px';
    ctx.fillText(d.cta.toUpperCase(), W / 2, H - M - 40);
    ctx.letterSpacing = '0px';
  }
  if (d.extras.length) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '500 22px Archivo';
    ctx.fillStyle = 'rgba(245,239,230,0.6)';
    ctx.fillText(d.extras.join('   ·   '), W / 2, H - M - 14);
  }
}

function fresco(ctx, W, H, d) {
  const historia = H > 1500;
  const acento = d.color;
  ctx.fillStyle = mezclar(acento, '#ffffff', 0.86);
  ctx.fillRect(0, 0, W, H);
  // Puntos decorativos
  ctx.fillStyle = mezclar(acento, '#ffffff', 0.7);
  for (let x = 30; x < W; x += 60) {
    for (let y = 30; y < H; y += 60) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Mancha de color
  ctx.fillStyle = mezclar(acento, '#ffffff', 0.45);
  ctx.beginPath();
  ctx.ellipse(W * 0.82, H * 0.12, 300, 240, 0.4, 0, Math.PI * 2);
  ctx.fill();

  const M = 70;
  ctx.fillStyle = '#141312';
  ctx.font = '800 30px Archivo';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(d.negocio, M, M);

  // Título a mano
  ctx.fillStyle = mezclar(acento, '#000000', 0.35);
  const t = tituloAjustado(ctx, d.titulo, { fuente: (s) => `700 ${s}px Caveat`, maximo: historia ? 150 : 130, minimo: 64, ancho: W - 2 * M, maxLineas: 2 });
  let y = escribirLineas(ctx, t.lineas, M, M + 60, t.tam * 0.9);

  // Polaroid inclinada con cinta
  const pw = W - 2 * M - 60;
  const ph = historia ? (d.tipo === 'menu' ? 820 : 1020) : Math.min(600, H - y - 380);
  const px = M + 30;
  const py = y + 40;
  ctx.save();
  ctx.translate(px + pw / 2, py + (ph + 120) / 2);
  ctx.rotate(0.03);
  ctx.shadowColor = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = '#fff';
  ctx.fillRect(-pw / 2 - 26, -(ph + 120) / 2, pw + 52, ph + 120);
  ctx.shadowColor = 'transparent';
  collage(ctx, d.imgs, -pw / 2, -(ph + 120) / 2 + 26, pw, ph, 4, mezclar(acento, '#ffffff', 0.6), 6);
  if (d.mensaje) {
    ctx.fillStyle = '#3d3935';
    ctx.font = '700 46px Caveat';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(lineasDeTexto(ctx, d.mensaje, pw - 40, 1)[0] || '', 0, (ph + 120) / 2 - 48);
  }
  // Cinta
  ctx.fillStyle = 'rgba(255, 236, 170, 0.85)';
  ctx.rotate(-0.12);
  ctx.fillRect(-90, -(ph + 120) / 2 - 30, 180, 56);
  ctx.restore();
  y = py + ph + 150;

  // Etiqueta de precio
  if (d.mostrarPrecio && d.precio) {
    const precio = pesos(d.precio);
    ctx.font = '900 64px Archivo';
    const w = ctx.measureText(precio).width + 90;
    const ty = py + ph + 20;
    const tx = W - M - w;
    ctx.save();
    ctx.translate(tx + w / 2, ty);
    ctx.rotate(-0.06);
    ctx.fillStyle = acento;
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 20;
    caminoRedondeado(ctx, -w / 2, -54, w, 108, 54);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(precio, 0, 4);
    if (d.ahorroPct > 0) {
      ctx.fillStyle = '#ffe14d';
      ctx.beginPath();
      ctx.arc(w / 2 - 6, -54, 46, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#141312';
      ctx.font = '900 26px Archivo';
      ctx.fillText(`-${d.ahorroPct}%`, w / 2 - 6, -52);
    }
    ctx.restore();
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  if (d.tipo === 'menu' && d.items.length && historia) {
    listaPrecios(ctx, d.items, M, y + 40, W - 2 * M, {
      fuente: '700 36px Archivo', fuentePrecio: '900 36px Archivo', color: '#141312', colorPrecio: mezclar(acento, '#000000', 0.25),
      colorPunteado: mezclar(acento, '#ffffff', 0.4), alto: 62, max: 5, limiteY: H - M - 220
    });
  } else if (d.tipo === 'promo' && d.items.length) {
    ctx.font = '700 32px Archivo';
    ctx.fillStyle = '#141312';
    escribirLineas(ctx, lineasDeTexto(ctx, d.items.map(i => `${i.cantidad > 1 ? `${i.cantidad} × ` : ''}${i.nombre}`).join('  +  '), W - 2 * M - (d.mostrarQR ? 190 : 0), 2), M, y + 10, 44);
  }

  if (d.mostrarQR) {
    bloqueQR(ctx, d.qr, W - M - 150, H - M - 190, 150, { fondo: '#fff', texto: d.cta, alinear: 'right', fuente: '700 34px Caveat' });
  } else if (d.cta) {
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 56px Caveat';
    ctx.fillStyle = '#141312';
    ctx.fillText(`${d.cta} →`, M, H - M - 40);
  }
  if (d.extras.length) {
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = '700 26px Archivo';
    ctx.fillStyle = '#5b5550';
    ctx.fillText(d.extras.join('  ·  '), M, H - M);
  }
}

const DIBUJAR = { editorial, vibrante, noche, fresco };

// Dibuja el flyer en el canvas. `datos.fotos` son URLs; se cargan aquí.
export async function dibujarFlyer(canvas, { plantilla, formato, datos }) {
  await cargarFuentes();
  const { ancho, alto } = FORMATOS[formato] || FORMATOS.post;
  const [imgs, qr] = await Promise.all([
    Promise.all((datos.fotos || []).slice(0, 4).map(cargarImagen)),
    datos.qrUrl ? cargarImagen(datos.qrUrl) : Promise.resolve(null)
  ]);
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, ancho, alto);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  (DIBUJAR[plantilla] || editorial)(ctx, ancho, alto, {
    tipo: datos.tipo,
    negocio: datos.negocio || '',
    titulo: datos.titulo || '',
    mensaje: datos.mensaje || '',
    cta: datos.cta || '',
    precio: datos.precio,
    precioAntes: datos.precioAntes,
    ahorroPct: datos.ahorroPct || 0,
    items: datos.items || [],
    imgs: imgs.filter(Boolean),
    qr,
    color: /^#[0-9a-f]{6}$/i.test(datos.color || '') ? datos.color : '#b5533c',
    mostrarPrecio: datos.mostrarPrecio !== false,
    mostrarQR: datos.mostrarQR !== false && !!qr,
    extras: datos.extras || []
  });
}
