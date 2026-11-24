// Zona de juegos del menú público: puntajes y podio por negocio (módulo).
// Es público y sin cuentas, así que se valida todo: juego conocido, nombre
// limpio, avatar de la lista, puntaje dentro de lo posible y un límite de
// envíos por persona (IP).
const crypto = require('crypto');

// Puntaje máximo razonable de cada juego (más alto = trampa).
const JUEGOS = {
  memoria: { max: 2000 },
  culebrita: { max: 3000 },
  toque: { max: 600 },
  calculo: { max: 3000 },
  fruta: { max: 5000 }
};

const AVATARES = ['🦊', '🐼', '🐯', '🦁', '🐸', '🐵', '🐙', '🦄', '🐲', '🦖', '🐧', '🦉', '🐝', '🐞', '🐬', '🦈', '👾', '🤖', '👻', '🎃', '⚽', '🎸', '🚀', '⭐'];

// Palabras que no se aceptan en el nombre (en minúsculas y sin tildes).
const PROHIBIDAS = ['puta', 'puto', 'mierda', 'hijueputa', 'malparid', 'gonorrea', 'marica', 'pirob', 'verga', 'culo', 'chimba', 'pene', 'sexo', 'nazi', 'idiota', 'estupid', 'imbecil', 'fuck', 'shit', 'bitch'];

const normalizar = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function limpiarNombre(nombre) {
  const limpio = String(nombre || '').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 18);
  if (limpio.length < 2) return { error: 'Escribe un nombre de al menos 2 letras' };
  const plano = normalizar(limpio).replace(/[^a-z0-9]/g, '');
  if (PROHIBIDAS.some(p => plano.includes(p))) return { error: 'Ese nombre no se puede usar. Prueba con otro 🙂' };
  return { nombre: limpio };
}

// Límite de envíos por IP: 20 cada 10 minutos.
const usoPorIp = new Map();
function permitidoParaIp(ip) {
  const ahora = Date.now();
  const recientes = (usoPorIp.get(ip) || []).filter(t => ahora - t < 10 * 60 * 1000);
  if (recientes.length >= 20) return false;
  recientes.push(ahora);
  usoPorIp.set(ip, recientes);
  if (usoPorIp.size > 5000) usoPorIp.clear();
  return true;
}

const hashIp = (ip) => crypto.createHash('sha256').update(`juegos:${ip}`).digest('hex').slice(0, 32);

async function guardarPuntaje(pool, moduloId, ip, body) {
  const juego = String(body.juego || '');
  if (!JUEGOS[juego]) return { status: 400, error: 'Juego no válido' };
  const { nombre, error } = limpiarNombre(body.nombre);
  if (error) return { status: 400, error };
  const avatar = AVATARES.includes(body.avatar) ? body.avatar : AVATARES[0];
  const puntaje = Math.round(Number(body.puntaje));
  if (!Number.isFinite(puntaje) || puntaje <= 0) return { status: 400, error: 'Puntaje no válido' };
  if (puntaje > JUEGOS[juego].max) return { status: 400, error: 'Ese puntaje no parece real 🤔' };
  const duracion = Math.max(0, Math.min(3600, Math.round(Number(body.duracion) || 0)));
  if (!permitidoParaIp(ip)) return { status: 429, error: 'Has guardado muchos puntajes seguidos. Espera unos minutos.' };

  const { rows: [modulo] } = await pool.query('SELECT id FROM modulos WHERE id = $1 AND activo = true', [moduloId]);
  if (!modulo) return { status: 404, error: 'Juegos no disponibles' };

  const { rows: [fila] } = await pool.query(
    `INSERT INTO juego_puntajes (modulo_id, juego, nombre, avatar, puntaje, duracion_seg, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [moduloId, juego, nombre, avatar, puntaje, duracion, hashIp(ip)]);

  // Puesto en el podio de la semana y de siempre.
  const { rows: [puestos] } = await pool.query(
    `SELECT
       (SELECT COUNT(*) + 1 FROM juego_puntajes WHERE modulo_id = $1 AND juego = $2 AND puntaje > $3
          AND creado_en >= date_trunc('week', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota')::int AS semana,
       (SELECT COUNT(*) + 1 FROM juego_puntajes WHERE modulo_id = $1 AND juego = $2 AND puntaje > $3)::int AS siempre`,
    [moduloId, juego, puntaje]);
  return { status: 201, datos: { id: fila.id, puesto_semana: puestos.semana, puesto_siempre: puestos.siempre } };
}

// Top 10 de un juego: cada persona (nombre + avatar) aparece con su mejor puntaje.
async function podio(pool, moduloId, juego, periodo) {
  if (!JUEGOS[juego]) return [];
  const desde = periodo === 'semana'
    ? "AND creado_en >= date_trunc('week', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota'"
    : '';
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (lower(nombre), avatar) nombre, avatar, puntaje, creado_en
     FROM juego_puntajes
     WHERE modulo_id = $1 AND juego = $2 ${desde}
     ORDER BY lower(nombre), avatar, puntaje DESC, creado_en ASC`,
    [moduloId, juego]);
  return rows
    .sort((a, b) => b.puntaje - a.puntaje || new Date(a.creado_en) - new Date(b.creado_en))
    .slice(0, 10)
    .map(r => ({ nombre: r.nombre, avatar: r.avatar, puntaje: r.puntaje, fecha: r.creado_en }));
}

// Campeón de la semana de cada juego (para la portada de Juegos).
async function campeones(pool, moduloId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (juego) juego, nombre, avatar, puntaje
     FROM juego_puntajes
     WHERE modulo_id = $1
       AND creado_en >= date_trunc('week', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota'
     ORDER BY juego, puntaje DESC, creado_en ASC`,
    [moduloId]);
  return Object.fromEntries(rows.map(r => [r.juego, { nombre: r.nombre, avatar: r.avatar, puntaje: r.puntaje }]));
}

module.exports = { JUEGOS, AVATARES, guardarPuntaje, podio, campeones };
