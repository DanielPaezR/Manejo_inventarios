// Copias de seguridad de toda la base de datos.
//
// Cada noche (3 a. m. hora Colombia) se exportan todas las tablas a un
// JSON comprimido con gzip y se guarda en la tabla "respaldos" (se
// conservan las últimas 14). Sirve para recuperar datos borrados o dañados
// por error. Como vive en la misma base, NO protege si se pierde la base
// completa: para eso el super admin descarga copias desde la app (y
// conviene guardarlas fuera, ej. en Drive). Para restaurar una copia ver
// backend/scripts/restaurar-respaldo.js.
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const CONSERVAR = 14;
const LOTE = 5000;
const EXCLUIR = new Set(['respaldos']);
// Todos los valores salen como el texto crudo de Postgres (fechas, números,
// JSON, bytea…), igual que un COPY: así la restauración es exacta y no
// depende de la zona horaria del servidor.
const TEXTO_CRUDO = { getTypeParser: () => (valor) => valor };

async function listarTablas(db) {
  const { rows } = await db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
  return rows.map(r => r.table_name).filter(t => !EXCLUIR.has(t));
}

// Exporta todas las tablas en una sola transacción de solo lectura, para
// que la copia sea consistente aunque se esté vendiendo mientras tanto.
async function generarRespaldo(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tablas = await listarTablas(client);
    const contenido = { formato: 'inventario-app/respaldo', version: 1, creado_en: new Date().toISOString(), tablas: {} };
    let filas = 0;
    for (const tabla of tablas) {
      const { rows: [pk] } = await client.query(
        `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
         WHERE i.indrelid = $1::regclass AND i.indisprimary LIMIT 1`, [`public."${tabla}"`]);
      const orden = pk ? `ORDER BY "${pk.attname}"` : '';
      const datos = [];
      for (let desde = 0; ; desde += LOTE) {
        const { rows } = await client.query({ text: `SELECT * FROM public."${tabla}" ${orden} LIMIT ${LOTE} OFFSET ${desde}`, types: TEXTO_CRUDO });
        datos.push(...rows);
        if (rows.length < LOTE) break;
      }
      contenido.tablas[tabla] = datos;
      filas += datos.length;
    }
    await client.query('COMMIT');
    const comprimido = await gzip(Buffer.from(JSON.stringify(contenido), 'utf8'), { level: 9 });
    return { comprimido, tablas: tablas.length, filas };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function guardarRespaldo(pool, origen = 'automatico') {
  const { comprimido, tablas, filas } = await generarRespaldo(pool);
  const { rows: [r] } = await pool.query(
    `INSERT INTO respaldos (origen, tablas, filas, tamano_bytes, datos) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, creado_en, origen, tablas, filas, tamano_bytes`,
    [origen, tablas, filas, comprimido.length, comprimido]);
  await pool.query(
    'DELETE FROM respaldos WHERE id NOT IN (SELECT id FROM respaldos ORDER BY creado_en DESC LIMIT $1)', [CONSERVAR]);
  return r;
}

async function listarRespaldos(pool) {
  const { rows } = await pool.query(
    'SELECT id, creado_en, origen, tablas, filas, tamano_bytes FROM respaldos ORDER BY creado_en DESC');
  return rows;
}

async function leerRespaldo(pool, id) {
  const { rows: [r] } = await pool.query('SELECT id, creado_en, datos FROM respaldos WHERE id = $1', [id]);
  return r || null;
}

const nombreArchivo = (fecha) => `respaldo-${new Date(fecha).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json.gz`;

// Revisa cada 30 minutos; si hoy (hora Colombia) aún no hay copia
// automática y ya pasaron las 3 a. m., la genera.
function programarRespaldos(pool) {
  const revisar = async () => {
    const ahora = new Date(Date.now() - 5 * 3600 * 1000);
    if (ahora.getUTCHours() < 3) return;
    try {
      const { rows: [hoy] } = await pool.query(
        `SELECT 1 FROM respaldos WHERE origen = 'automatico'
           AND (creado_en AT TIME ZONE 'America/Bogota')::date = (now() AT TIME ZONE 'America/Bogota')::date`);
      if (hoy) return;
      const r = await guardarRespaldo(pool, 'automatico');
      console.log(`💾 Copia de seguridad: ${r.filas} filas de ${r.tablas} tablas (${Math.round(r.tamano_bytes / 1024)} KB)`);
    } catch (error) {
      if (!/relation "respaldos" does not exist/.test(error.message)) console.error('Error en la copia de seguridad:', error.message);
    }
  };
  setInterval(revisar, 30 * 60 * 1000);
  setTimeout(revisar, 2 * 60 * 1000);
}

module.exports = { generarRespaldo, guardarRespaldo, listarRespaldos, leerRespaldo, nombreArchivo, programarRespaldos, listarTablas };
