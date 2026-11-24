// Análisis adicionales de Estadísticas: productos para el simulador de
// precios, mermas de los conteos, ventas por persona del equipo, clientes
// del menú en línea (domicilios) e informe mensual. Hora Colombia.
const FECHA_VENTA = "(v.fecha_venta AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::date";
const HOY = "(now() AT TIME ZONE 'America/Bogota')::date";
const num = (x) => (x === null || x === undefined ? 0 : Number(x));

// Productos propios con su precio, costo y lo vendido en 28 días.
async function productosParaSimulador(pool, moduloId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.nombre, p.precio_venta, p.precio_compra, p.stock_actual,
            COALESCE(SUM(dv.cantidad) FILTER (WHERE ${FECHA_VENTA} > ${HOY} - 28), 0) AS unidades_28,
            COALESCE(SUM(dv.subtotal) FILTER (WHERE ${FECHA_VENTA} > ${HOY} - 28), 0) AS ventas_28
     FROM productos p
     LEFT JOIN detalle_venta dv ON dv.producto_id = p.id AND dv.modulo_dueno_id = $1
     LEFT JOIN ventas v ON v.id = dv.venta_id AND v.es_ajuste_manual = false AND v.metodo_pago <> 'consumo_propio'
     WHERE p.modulo_id = $1 AND p.activo = true
     GROUP BY p.id
     ORDER BY ventas_28 DESC, p.nombre`,
    [moduloId]);
  return rows.map(p => ({
    id: p.id,
    nombre: p.nombre.trim(),
    precio_venta: num(p.precio_venta),
    precio_compra: num(p.precio_compra),
    stock_actual: num(p.stock_actual),
    unidades_28: num(p.unidades_28),
    ventas_28: Math.round(num(p.ventas_28))
  }));
}

// Diferencias encontradas en los conteos de inventario (últimos 90 días).
async function mermas(pool, moduloId) {
  const [{ rows: conteos }, { rows: productos }] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS conteos,
              COALESCE(SUM(valor_diferencia), 0) AS valor,
              COALESCE(SUM(unidades_diferencia), 0) AS unidades,
              MAX(fecha) AS ultimo
       FROM conteos_inventario
       WHERE modulo_id = $1 AND fecha > now() - interval '90 days'`, [moduloId]),
    pool.query(
      `SELECT p.nombre, SUM(a.diferencia)::int AS unidades,
              SUM(a.diferencia * COALESCE(a.costo_unitario, 0)) AS valor,
              COUNT(*)::int AS veces
       FROM ajustes_inventario a
       JOIN conteos_inventario c ON c.id = a.conteo_id
       JOIN productos p ON p.id = a.producto_id
       WHERE c.modulo_id = $1 AND c.fecha > now() - interval '90 days' AND a.diferencia < 0
       GROUP BY p.nombre
       ORDER BY valor ASC
       LIMIT 8`, [moduloId])
  ]);
  const { rows: [ultimoGeneral] } = await pool.query(
    'SELECT MAX(fecha) AS ultimo FROM conteos_inventario WHERE modulo_id = $1', [moduloId]);
  return {
    conteos: conteos[0].conteos,
    valor: Math.round(num(conteos[0].valor)),
    unidades: num(conteos[0].unidades),
    ultimo_conteo: ultimoGeneral.ultimo,
    faltantes: productos.map(p => ({ nombre: p.nombre.trim(), unidades: p.unidades, valor: Math.round(num(p.valor)), veces: p.veces }))
  };
}

// Ventas por persona del equipo y franjas en que vende (28 días).
async function ventasPorEquipo(pool, moduloId) {
  const filtro = `v.modulo_id = $1 AND v.es_ajuste_manual = false AND v.metodo_pago <> 'consumo_propio'
                  AND ${FECHA_VENTA} > ${HOY} - 28`;
  const [{ rows: personas }, { rows: horas }] = await Promise.all([
    pool.query(
      `SELECT u.id, u.nombre, COUNT(*)::int AS ventas, SUM(v.total) AS total,
              COUNT(DISTINCT ${FECHA_VENTA})::int AS dias
       FROM ventas v JOIN usuarios u ON u.id = v.usuario_id
       WHERE ${filtro}
       GROUP BY u.id, u.nombre ORDER BY total DESC`, [moduloId]),
    pool.query(
      `SELECT v.usuario_id,
              EXTRACT(HOUR FROM (v.fecha_venta AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota'))::int AS hora,
              COUNT(*)::int AS ventas
       FROM ventas v
       WHERE ${filtro}
       GROUP BY 1, 2`, [moduloId])
  ]);
  const total = personas.reduce((s, p) => s + num(p.total), 0);
  return personas.map(p => {
    const susHoras = horas.filter(h => h.usuario_id === p.id).sort((a, b) => a.hora - b.hora);
    return {
      id: p.id,
      nombre: p.nombre,
      ventas: p.ventas,
      total: Math.round(num(p.total)),
      ticket: p.ventas > 0 ? Math.round(num(p.total) / p.ventas) : 0,
      dias: p.dias,
      por_dia: p.dias > 0 ? Math.round(num(p.total) / p.dias) : 0,
      participacion: total > 0 ? Math.round((num(p.total) / total) * 100) : 0,
      desde: susHoras.length ? susHoras[0].hora : null,
      hasta: susHoras.length ? susHoras[susHoras.length - 1].hora : null,
      horas: susHoras.map(h => ({ hora: h.hora, ventas: h.ventas }))
    };
  });
}

// Clientes del menú en línea, identificados por su celular. Las ventas del
// mostrador no se cuentan: ahí casi nunca se registra quién compra.
async function clientesEnLinea(pool, moduloId) {
  const { rows } = await pool.query(
    `WITH pedidos AS (
       SELECT RIGHT(regexp_replace(COALESCE(telefono, ''), '[^0-9]', '', 'g'), 10) AS tel,
              mesa_nombre, total, es_domicilio,
              (fecha_creacion AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') AS fecha
       FROM pedidos_cliente
       WHERE modulo_id = $1 AND estado <> 'cancelado'
     )
     SELECT tel,
            (array_agg(mesa_nombre ORDER BY fecha DESC))[1] AS nombre,
            COUNT(*)::int AS pedidos,
            COUNT(*) FILTER (WHERE es_domicilio)::int AS domicilios,
            SUM(total) AS total,
            MIN(fecha) AS primero,
            MAX(fecha) AS ultimo
     FROM pedidos
     WHERE length(tel) = 10
     GROUP BY tel
     ORDER BY total DESC`, [moduloId]);

  const { rows: [resumen] } = await pool.query(
    `SELECT COUNT(*)::int AS pedidos_30,
            COALESCE(SUM(total), 0) AS total_30,
            COUNT(*) FILTER (WHERE es_domicilio)::int AS domicilios_30,
            COUNT(*) FILTER (WHERE telefono IS NULL OR telefono = '')::int AS sin_telefono_30
     FROM pedidos_cliente
     WHERE modulo_id = $1 AND estado <> 'cancelado' AND fecha_creacion > now() - interval '30 days'`, [moduloId]);

  const ahora = Date.now();
  const dias = (f) => Math.floor((ahora - new Date(f).getTime()) / 86400000);
  const clientes = rows.map(c => ({
    telefono: c.tel,
    nombre: c.nombre,
    pedidos: c.pedidos,
    domicilios: c.domicilios,
    total: Math.round(num(c.total)),
    promedio: Math.round(num(c.total) / c.pedidos),
    dias_desde_primero: dias(c.primero),
    dias_desde_ultimo: dias(c.ultimo),
    cada_dias: c.pedidos > 1 ? Math.round((new Date(c.ultimo) - new Date(c.primero)) / 86400000 / (c.pedidos - 1)) : null
  }));

  return {
    pedidos_30: resumen.pedidos_30,
    total_30: Math.round(num(resumen.total_30)),
    domicilios_30: resumen.domicilios_30,
    sin_telefono_30: resumen.sin_telefono_30,
    total_clientes: clientes.length,
    frecuentes: clientes.filter(c => c.pedidos >= 3 && c.dias_desde_ultimo <= 30).slice(0, 10),
    nuevos: clientes.filter(c => c.dias_desde_primero <= 30).slice(0, 10),
    // Pedían seguido y llevan más del doble de su frecuencia sin pedir.
    perdidos: clientes.filter(c => c.pedidos >= 2 && c.dias_desde_ultimo > Math.max(21, (c.cada_dias || 14) * 2)).slice(0, 10),
    mejores: clientes.slice(0, 10)
  };
}

// Lo que va del día contra un día normal, y la meta de la semana. Es
// liviano porque se pide en Ventas después de cada venta.
async function hoyRapido(pool, moduloId) {
  const lineas = `FROM detalle_venta dv JOIN ventas v ON v.id = dv.venta_id
    WHERE dv.modulo_dueno_id = $1 AND v.es_ajuste_manual = false AND v.metodo_pago <> 'consumo_propio'`;
  const [{ rows: [d] }, metasRes] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE(SUM(dv.subtotal) FILTER (WHERE ${FECHA_VENTA} = ${HOY}), 0) AS hoy,
         COALESCE(SUM(dv.subtotal) FILTER (
           WHERE ${FECHA_VENTA} IN (${HOY} - 7, ${HOY} - 14, ${HOY} - 21, ${HOY} - 28)
             AND (v.fecha_venta AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::time <= (now() AT TIME ZONE 'America/Bogota')::time
         ), 0) / 4.0 AS normal_a_esta_hora,
         COALESCE(SUM(dv.subtotal) FILTER (WHERE ${FECHA_VENTA} IN (${HOY} - 7, ${HOY} - 14, ${HOY} - 21, ${HOY} - 28)), 0) / 4.0 AS normal_dia,
         COALESCE(SUM(dv.subtotal) FILTER (WHERE ${FECHA_VENTA} >= date_trunc('week', ${HOY})::date), 0) AS semana,
         (7 - EXTRACT(ISODOW FROM ${HOY}))::int AS dias_restantes_semana,
         EXTRACT(ISODOW FROM ${HOY})::int AS dia_semana
       ${lineas}
         AND ${FECHA_VENTA} >= LEAST(${HOY} - 28, date_trunc('week', ${HOY})::date)`, [moduloId]),
    pool.query('SELECT metas FROM modulos WHERE id = $1', [moduloId]).catch(() => ({ rows: [] }))
  ]);
  const metas = metasRes.rows[0]?.metas || {};
  return {
    hoy: Math.round(num(d.hoy)),
    normal_a_esta_hora: Math.round(num(d.normal_a_esta_hora)),
    normal_dia: Math.round(num(d.normal_dia)),
    dia_semana: d.dia_semana,
    semana: Math.round(num(d.semana)),
    meta_semana: num(metas.ventas_semana) || null,
    dias_restantes_semana: d.dias_restantes_semana
  };
}

module.exports = { productosParaSimulador, mermas, ventasPorEquipo, clientesEnLinea, hoyRapido };
