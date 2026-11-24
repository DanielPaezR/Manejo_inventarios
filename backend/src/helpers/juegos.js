// Zona de juegos del menú público: puntajes, podio por negocio (módulo),
// moderación y premio semanal para el campeón de cada juego.
// Es público y sin cuentas, así que se valida todo: juego conocido, nombre
// limpio, avatar de la lista, puntaje dentro de lo posible y un límite de
// envíos por persona (IP).
const crypto = require('crypto');

// Puntaje máximo razonable de cada juego (más alto = trampa).
const JUEGOS = {
  memoria: { max: 2000, nombre: 'Memoria' },
  culebrita: { max: 3000, nombre: 'Culebrita' },
  toque: { max: 600, nombre: 'Toque rápido' },
  calculo: { max: 3000, nombre: 'Cálculo veloz' },
  fruta: { max: 5000, nombre: 'Atrapa la fruta' }
};

const AVATARES = ['🦊', '🐼', '🐯', '🦁', '🐸', '🐵', '🐙', '🦄', '🐲', '🦖', '🐧', '🦉', '🐝', '🐞', '🐬', '🦈', '👾', '🤖', '👻', '🎃', '⚽', '🎸', '🚀', '⭐'];

// Palabras que no se aceptan en el nombre (en minúsculas y sin tildes).
const PROHIBIDAS = ['puta', 'puto', 'mierda', 'hijueputa', 'malparid', 'gonorrea', 'marica', 'pirob', 'verga', 'culo', 'chimba', 'pene', 'sexo', 'nazi', 'idiota', 'estupid', 'imbecil', 'fuck', 'shit', 'bitch'];

const DIAS_PARA_RECLAMAR = 7;

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

// Código para reclamar el premio (sin letras que se confundan: 0/O, 1/I).
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const nuevoCodigo = () => Array.from(crypto.randomBytes(6), b => ALFABETO[b % ALFABETO.length]).join('');

// Inicio de la semana (lunes) en hora Colombia, como timestamptz.
const SEMANA_ACTUAL = "date_trunc('week', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota'";

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

  const codigo = nuevoCodigo();
  const { rows: [fila] } = await pool.query(
    `INSERT INTO juego_puntajes (modulo_id, juego, nombre, avatar, puntaje, duracion_seg, ip_hash, codigo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [moduloId, juego, nombre, avatar, puntaje, duracion, hashIp(ip), codigo]);

  // Puesto en el podio de la semana y de siempre.
  const { rows: [puestos] } = await pool.query(
    `SELECT
       (SELECT COUNT(*) + 1 FROM juego_puntajes WHERE modulo_id = $1 AND juego = $2 AND puntaje > $3 AND NOT oculto
          AND creado_en >= ${SEMANA_ACTUAL})::int AS semana,
       (SELECT COUNT(*) + 1 FROM juego_puntajes WHERE modulo_id = $1 AND juego = $2 AND puntaje > $3 AND NOT oculto)::int AS siempre`,
    [moduloId, juego, puntaje]);
  return { status: 201, datos: { id: fila.id, codigo, puesto_semana: puestos.semana, puesto_siempre: puestos.siempre } };
}

// Top 10 de un juego: cada persona (nombre + avatar) aparece con su mejor puntaje.
async function podio(pool, moduloId, juego, periodo) {
  if (!JUEGOS[juego]) return [];
  const desde = periodo === 'semana' ? `AND creado_en >= ${SEMANA_ACTUAL}` : '';
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (lower(nombre), avatar) nombre, avatar, puntaje, creado_en
     FROM juego_puntajes
     WHERE modulo_id = $1 AND juego = $2 AND NOT oculto ${desde}
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
     WHERE modulo_id = $1 AND NOT oculto AND creado_en >= ${SEMANA_ACTUAL}
     ORDER BY juego, puntaje DESC, creado_en ASC`,
    [moduloId]);
  return Object.fromEntries(rows.map(r => [r.juego, { nombre: r.nombre, avatar: r.avatar, puntaje: r.puntaje }]));
}

// ---------- Premio semanal ----------
const leerPremio = async (pool, moduloId) => {
  const { rows: [m] } = await pool.query('SELECT premio_juegos FROM modulos WHERE id = $1', [moduloId]);
  const p = m?.premio_juegos || {};
  return { activo: p.activo === true && !!p.descripcion, descripcion: p.descripcion || '' };
};

// Puntajes ganadores: el mejor de cada juego en cada semana ya cerrada,
// dentro del plazo para reclamar. Si se pasan códigos, solo esos.
async function ganadores(pool, moduloId, codigos = null) {
  const params = [moduloId, DIAS_PARA_RECLAMAR];
  let filtroCodigos = '';
  if (codigos) {
    params.push(codigos);
    filtroCodigos = 'AND g.codigo = ANY($3::text[])';
  }
  const { rows } = await pool.query(
    `WITH semanas AS (
       SELECT id, juego, nombre, avatar, puntaje, codigo, premio_canjeado_en, creado_en,
              date_trunc('week', creado_en AT TIME ZONE 'America/Bogota') AS semana
       FROM juego_puntajes
       WHERE modulo_id = $1 AND NOT oculto
         AND creado_en >= ${SEMANA_ACTUAL} - (($2 + 7) || ' days')::interval
         AND creado_en < ${SEMANA_ACTUAL}
     ), g AS (
       SELECT DISTINCT ON (juego, semana) * FROM semanas ORDER BY juego, semana, puntaje DESC, creado_en ASC
     )
     SELECT g.id, g.juego, g.nombre, g.avatar, g.puntaje, g.codigo, g.premio_canjeado_en,
            to_char(g.semana, 'YYYY-MM-DD') AS semana,
            (g.semana + interval '7 days' + ($2 || ' days')::interval) AT TIME ZONE 'America/Bogota' AS vence
     FROM g
     WHERE (g.semana + interval '7 days' + ($2 || ' days')::interval) AT TIME ZONE 'America/Bogota' > now()
       ${filtroCodigos}
     ORDER BY g.semana DESC, g.juego`,
    params);
  return rows.map(r => ({ ...r, juego_nombre: JUEGOS[r.juego]?.nombre || r.juego }));
}

// Para el celular del cliente: ¿alguno de mis códigos ganó?
async function misPremios(pool, moduloId, codigos) {
  const premio = await leerPremio(pool, moduloId);
  if (!premio.activo || codigos.length === 0) return { premio, ganados: [] };
  const lista = await ganadores(pool, moduloId, codigos);
  return {
    premio,
    ganados: lista.filter(g => !g.premio_canjeado_en).map(g => ({
      codigo: g.codigo, juego: g.juego_nombre, nombre: g.nombre, avatar: g.avatar, puntaje: g.puntaje, vence: g.vence
    }))
  };
}

// En caja: valida y marca el código como canjeado.
async function canjear(pool, moduloId, codigo) {
  const limpio = String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (limpio.length < 4) return { status: 400, error: 'Escribe el código del premio' };
  const [g] = await ganadores(pool, moduloId, [limpio]);
  if (!g) {
    const { rows: [existe] } = await pool.query('SELECT id FROM juego_puntajes WHERE modulo_id = $1 AND codigo = $2', [moduloId, limpio]);
    return { status: 404, error: existe ? 'Ese código no es de un campeón o ya venció' : 'Ese código no existe' };
  }
  if (g.premio_canjeado_en) return { status: 409, error: `Ese premio ya se entregó el ${new Date(g.premio_canjeado_en).toLocaleDateString('es-CO')}` };
  await pool.query('UPDATE juego_puntajes SET premio_canjeado_en = now() WHERE id = $1', [g.id]);
  return { status: 200, datos: { nombre: g.nombre, avatar: g.avatar, juego: g.juego_nombre, puntaje: g.puntaje } };
}

// ---------- Moderación ----------
async function puntajesRecientes(pool, moduloId) {
  const { rows } = await pool.query(
    `SELECT id, juego, nombre, avatar, puntaje, oculto, creado_en
     FROM juego_puntajes WHERE modulo_id = $1
     ORDER BY creado_en DESC LIMIT 60`,
    [moduloId]);
  return rows.map(r => ({ ...r, juego_nombre: JUEGOS[r.juego]?.nombre || r.juego }));
}

module.exports = { JUEGOS, AVATARES, guardarPuntaje, podio, campeones, leerPremio, ganadores, misPremios, canjear, puntajesRecientes };
