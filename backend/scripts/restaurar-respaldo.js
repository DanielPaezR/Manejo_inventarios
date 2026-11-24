#!/usr/bin/env node
// Restaura una copia de seguridad (.json.gz descargada desde la app).
//
//   node scripts/restaurar-respaldo.js respaldo.json.gz --prueba
//     Ensayo sin riesgo: copia los datos a un esquema temporal, compara
//     cuántas filas quedaron por tabla y borra el esquema. No toca nada real.
//
//   node scripts/restaurar-respaldo.js respaldo.json.gz --confirmar
//     Restauración real sobre la base de DATABASE_URL: BORRA el contenido
//     actual de cada tabla incluida en la copia y lo reemplaza por el de la
//     copia, todo en una sola transacción (si algo falla, no cambia nada).
//     La base debe tener las mismas tablas (las migraciones al día).
//
// Lee DATABASE_URL del entorno o de backend/.env.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const zlib = require('zlib');
const { Pool } = require('pg');

const [archivo, modo] = process.argv.slice(2);
if (!archivo || !['--prueba', '--confirmar'].includes(modo)) {
  console.log('Uso: node scripts/restaurar-respaldo.js <archivo.json.gz> --prueba | --confirmar');
  process.exit(1);
}

const LOTE = 500;
const ident = (n) => `"${String(n).replace(/"/g, '""')}"`;

async function insertar(client, esquema, tabla, columnas, filas) {
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    const valores = [];
    const grupos = lote.map(fila => `(${columnas.map(c => { valores.push(fila[c]); return `$${valores.length}`; }).join(', ')})`);
    await client.query(
      `INSERT INTO ${ident(esquema)}.${ident(tabla)} (${columnas.map(ident).join(', ')}) VALUES ${grupos.join(', ')}`, valores);
  }
}

(async () => {
  const contenido = JSON.parse(zlib.gunzipSync(fs.readFileSync(archivo)).toString('utf8'));
  if (contenido.formato !== 'inventario-app/respaldo') throw new Error('El archivo no es una copia de seguridad de la app');
  const tablas = Object.keys(contenido.tablas);
  console.log(`Copia del ${contenido.creado_en}: ${tablas.length} tablas`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();
  const esquema = modo === '--prueba' ? `prueba_restauracion_${Date.now()}` : 'public';
  try {
    await client.query('BEGIN');
    // Sin revisar llaves foráneas mientras se cargan (el orden no importa).
    await client.query('SET LOCAL session_replication_role = replica');

    const { rows: existentes } = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
    const enBase = new Set(existentes.map(r => r.table_name));
    const aRestaurar = tablas.filter(t => {
      if (!enBase.has(t)) console.warn(`  ⚠️  ${t}: no existe en la base, se omite`);
      return enBase.has(t);
    });

    if (modo === '--prueba') {
      await client.query(`CREATE SCHEMA ${ident(esquema)}`);
      for (const t of aRestaurar) {
        await client.query(`CREATE TABLE ${ident(esquema)}.${ident(t)} (LIKE public.${ident(t)} INCLUDING DEFAULTS)`);
      }
    } else {
      await client.query(`TRUNCATE ${aRestaurar.map(t => `public.${ident(t)}`).join(', ')}`);
    }

    let errores = 0;
    for (const t of aRestaurar) {
      const filas = contenido.tablas[t];
      const { rows: cols } = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1", [t]);
      const enTabla = new Set(cols.map(c => c.column_name));
      const columnas = filas.length ? Object.keys(filas[0]).filter(c => enTabla.has(c)) : [];
      const faltan = filas.length ? Object.keys(filas[0]).filter(c => !enTabla.has(c)) : [];
      if (faltan.length) console.warn(`  ⚠️  ${t}: columnas que ya no existen y se omiten: ${faltan.join(', ')}`);
      if (filas.length) await insertar(client, esquema, t, columnas, filas);
      const { rows: [{ total }] } = await client.query(`SELECT COUNT(*)::int AS total FROM ${ident(esquema)}.${ident(t)}`);
      const ok = total === filas.length;
      if (!ok) errores++;
      console.log(`  ${ok ? '✓' : '✗'} ${t}: ${total}/${filas.length}`);
    }

    if (modo === '--confirmar') {
      // Los contadores de id continúan después del id más alto restaurado.
      for (const t of aRestaurar) {
        const { rows: seqs } = await client.query(
          `SELECT column_name, pg_get_serial_sequence('public.' || quote_ident($1), column_name) AS seq
           FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [t]);
        for (const { column_name: col, seq } of seqs.filter(s => s.seq)) {
          await client.query(`SELECT setval($1, COALESCE((SELECT MAX(${ident(col)}) FROM public.${ident(t)}), 0) + 1, false)`, [seq]);
        }
      }
    }

    if (errores) throw new Error(`${errores} tablas no cuadraron; no se aplicó nada`);
    // El ensayo se deshace completo (el esquema temporal desaparece).
    await client.query(modo === '--prueba' ? 'ROLLBACK' : 'COMMIT');
    console.log(modo === '--prueba' ? '\nEnsayo correcto: la copia se puede restaurar completa.' : '\nRestauración completa.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
