// Migraciones automáticas de la base de datos.
//
// Cada archivo de backend/migrations (001_algo.sql, 002_otra.sql…) se
// ejecuta UNA sola vez, en orden, al arrancar el servidor. Las ya aplicadas
// quedan registradas en la tabla schema_migraciones. Cada migración corre en
// su propia transacción: si falla, se revierte, se registra el error en el
// log y el servidor sigue funcionando con lo que ya había.
//
// Para cambiar la base: crea un archivo nuevo con el número siguiente.
// Nunca edites una migración que ya se aplicó en producción.
const fs = require('fs');
const path = require('path');

const CARPETA = path.join(__dirname, '..', '..', 'migrations');
const CANDADO = 727201; // evita que dos servidores migren al mismo tiempo

async function aplicarMigraciones(pool) {
  if (!fs.existsSync(CARPETA)) return { aplicadas: [] };
  const archivos = fs.readdirSync(CARPETA).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
  const client = await pool.connect();
  const aplicadas = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [CANDADO]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migraciones (
      nombre VARCHAR(200) PRIMARY KEY,
      aplicado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query('SELECT nombre FROM schema_migraciones');
    const hechas = new Set(rows.map(r => r.nombre));

    for (const archivo of archivos) {
      if (hechas.has(archivo)) continue;
      const sql = fs.readFileSync(path.join(CARPETA, archivo), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migraciones (nombre) VALUES ($1)', [archivo]);
        await client.query('COMMIT');
        aplicadas.push(archivo);
        console.log(`🗄️  Migración aplicada: ${archivo}`);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`❌ Falló la migración ${archivo}: ${error.message}`);
        break; // las siguientes pueden depender de esta
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [CANDADO]).catch(() => {});
    client.release();
  }
  if (aplicadas.length === 0) console.log('🗄️  Base de datos al día');
  return { aplicadas };
}

module.exports = { aplicarMigraciones };
