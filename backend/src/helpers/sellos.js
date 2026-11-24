// Tarjeta de sellos digital: el cliente se identifica con su celular.
// Cada pedido del menú en línea completado (desde un monto mínimo) le suma
// un sello; en el negocio también se puede sellar a mano (compras en el
// local). Al llegar a la meta, el negocio entrega el premio y se descuentan
// los sellos. La configuración vive en modulos.sellos y los movimientos en
// sellos_movimientos (saldo = suma de cantidad).
const { moduloIncluye } = require('./planes');

// El teléfono se guarda como los últimos 10 dígitos (celular colombiano
// sin indicativo), así "300 123 4567" y "+57 3001234567" son el mismo.
const normalizarTelefono = (t) => {
  const d = String(t || '').replace(/\D/g, '');
  return d.length >= 7 ? d.slice(-10) : null;
};

function leerConfig(valor) {
  const c = valor || {};
  const meta = Number(c.meta);
  const minimo = Number(c.minimo);
  const premio = String(c.premio || '').trim().slice(0, 120);
  return {
    activo: c.activo === true && !!premio,
    meta: Number.isInteger(meta) && meta >= 3 && meta <= 30 ? meta : 10,
    premio,
    minimo: Number.isFinite(minimo) && minimo >= 0 ? Math.round(minimo) : 0
  };
}

async function configDe(db, moduloId) {
  const { rows: [m] } = await db.query('SELECT sellos FROM modulos WHERE id = $1', [moduloId]);
  const config = leerConfig(m?.sellos);
  // Si el plan del negocio no incluye sellos, la tarjeta queda apagada.
  if (config.activo && !(await moduloIncluye(db, moduloId, 'sellos'))) config.activo = false;
  return config;
}

async function saldoDe(db, moduloId, telefono) {
  const { rows: [r] } = await db.query(
    `SELECT COALESCE(SUM(cantidad), 0)::int AS saldo,
            COUNT(*) FILTER (WHERE tipo = 'canje')::int AS canjes
     FROM sellos_movimientos WHERE modulo_id = $1 AND telefono = $2`,
    [moduloId, telefono]);
  return { saldo: r.saldo, canjes: r.canjes };
}

// Estado de la tarjeta para mostrar (cliente o negocio).
async function tarjeta(db, moduloId, telefonoCrudo) {
  const config = await configDe(db, moduloId);
  const telefono = normalizarTelefono(telefonoCrudo);
  if (!telefono) return { config, telefono: null, sellos: 0, premios: 0, canjes: 0 };
  const { saldo, canjes } = await saldoDe(db, moduloId, telefono);
  return {
    config,
    telefono,
    sellos: saldo % config.meta,
    premios: Math.floor(saldo / config.meta), // premios listos para reclamar
    canjes
  };
}

// Al completar un pedido del menú: un sello si aplica. Usa un SAVEPOINT
// para que un problema con los sellos nunca impida completar el pedido.
async function sellarPedido(client, pedido) {
  try {
    await client.query('SAVEPOINT sellos');
    const config = await configDe(client, pedido.modulo_id);
    const telefono = normalizarTelefono(pedido.telefono);
    let resultado = null;
    if (config.activo && telefono && Number(pedido.total) >= config.minimo) {
      const { rowCount } = await client.query(
        `INSERT INTO sellos_movimientos (modulo_id, telefono, cantidad, tipo, pedido_cliente_id, nombre)
         VALUES ($1, $2, 1, 'pedido', $3, $4) ON CONFLICT (pedido_cliente_id) DO NOTHING`,
        [pedido.modulo_id, telefono, pedido.id, pedido.mesa_nombre || null]);
      resultado = rowCount > 0;
    }
    await client.query('RELEASE SAVEPOINT sellos');
    return resultado;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT sellos').catch(() => {});
    console.error('No se pudo sumar el sello del pedido:', error.message);
    return null;
  }
}

async function sellarManual(pool, moduloId, telefonoCrudo, { nombre, usuarioId, cantidad = 1 }) {
  const config = await configDe(pool, moduloId);
  if (!config.activo) return { status: 400, error: 'Activa primero la tarjeta de sellos' };
  const telefono = normalizarTelefono(telefonoCrudo);
  if (!telefono) return { status: 400, error: 'Escribe un número de celular válido' };
  const n = Math.round(Number(cantidad));
  if (!Number.isInteger(n) || n < 1 || n > 5) return { status: 400, error: 'Se pueden sumar de 1 a 5 sellos a la vez' };
  await pool.query(
    `INSERT INTO sellos_movimientos (modulo_id, telefono, cantidad, tipo, nombre, usuario_id) VALUES ($1, $2, $3, 'manual', $4, $5)`,
    [moduloId, telefono, n, String(nombre || '').trim().slice(0, 120) || null, usuarioId]);
  return { status: 201, datos: await tarjeta(pool, moduloId, telefono) };
}

async function canjear(pool, moduloId, telefonoCrudo, usuarioId) {
  const telefono = normalizarTelefono(telefonoCrudo);
  if (!telefono) return { status: 400, error: 'Escribe un número de celular válido' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [880000 + Number(moduloId), Number(telefono.slice(-9))]);
    const config = await configDe(client, moduloId);
    const { saldo } = await saldoDe(client, moduloId, telefono);
    if (saldo < config.meta) {
      await client.query('ROLLBACK');
      return { status: 409, error: `Le faltan ${config.meta - saldo} sellos para el premio` };
    }
    await client.query(
      `INSERT INTO sellos_movimientos (modulo_id, telefono, cantidad, tipo, usuario_id) VALUES ($1, $2, $3, 'canje', $4)`,
      [moduloId, telefono, -config.meta, usuarioId]);
    await client.query('COMMIT');
    return { status: 200, datos: await tarjeta(pool, moduloId, telefono) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Para el negocio: clientes con sellos, los más cerca del premio primero.
async function clientesConSellos(pool, moduloId) {
  const config = await configDe(pool, moduloId);
  const { rows } = await pool.query(
    `SELECT telefono,
            SUM(cantidad)::int AS saldo,
            COUNT(*) FILTER (WHERE tipo = 'canje')::int AS canjes,
            MAX(creado_en) AS ultimo,
            (ARRAY_AGG(nombre ORDER BY creado_en DESC) FILTER (WHERE nombre IS NOT NULL))[1] AS nombre
     FROM sellos_movimientos WHERE modulo_id = $1
     GROUP BY telefono
     ORDER BY SUM(cantidad) DESC, MAX(creado_en) DESC
     LIMIT 100`,
    [moduloId]);
  return {
    config,
    clientes: rows.map(r => ({
      telefono: r.telefono,
      nombre: r.nombre,
      sellos: r.saldo % config.meta,
      premios: Math.floor(r.saldo / config.meta),
      canjes: r.canjes,
      ultimo: r.ultimo
    }))
  };
}

module.exports = { normalizarTelefono, leerConfig, configDe, tarjeta, sellarPedido, sellarManual, canjear, clientesConSellos };
