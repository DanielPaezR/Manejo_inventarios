// Resumen del negocio para la pestaña "Resumen" de Estadísticas: los datos
// que un dueño con poco tiempo necesita para entender cómo va y qué decidir.
// Todo en hora Colombia. Las ventas se atribuyen al dueño real del producto
// (detalle_venta.modulo_dueno_id), igual que /api/estadisticas, sin ajustes
// manuales ni consumo propio.

const FECHA_VENTA = "(v.fecha_venta AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::date";
const HOY = "(now() AT TIME ZONE 'America/Bogota')::date";
const LINEAS_PROPIAS = `
  FROM detalle_venta dv
  JOIN ventas v ON v.id = dv.venta_id
  WHERE dv.modulo_dueno_id = $1
    AND v.es_ajuste_manual = false
    AND v.metodo_pago <> 'consumo_propio'`;

const LINEAS_COMPARABLES = `
  FROM detalle_venta dv
  JOIN ventas v ON v.id = dv.venta_id
  JOIN productos p ON p.id = dv.producto_id
  WHERE dv.modulo_dueno_id = $1
    AND p.modulo_id = $1
    AND v.es_ajuste_manual = false
    AND v.metodo_pago <> 'consumo_propio'`;

const num = (x) => (x === null || x === undefined ? 0 : Number(x));

async function construirResumen(pool, moduloId) {
  const q = (sql, params = [moduloId]) => pool.query(sql, params).then(r => r.rows);

  const [
    [ventas],
    productosTop,
    porAgotarse,
    plataQuieta,
    sinCosto,
    fiado,
    proveedores,
    [comprasVentas],
    dias,
    horas,
    [hoy],
    [avance]
  ] = await Promise.all([
    // 1. Cómo te fue: últimos 7 días contra el promedio semanal de las 4
    //    semanas anteriores; ganancia y margen de los últimos 28 días.
    q(`SELECT
         COALESCE(SUM(dv.subtotal) FILTER (WHERE ${FECHA_VENTA} > ${HOY} - 7), 0) AS ventas_7,
         COUNT(DISTINCT v.id) FILTER (WHERE ${FECHA_VENTA} > ${HOY} - 7) AS num_ventas_7,
         COALESCE(SUM(dv.subtotal) FILTER (WHERE ${FECHA_VENTA} <= ${HOY} - 7 AND ${FECHA_VENTA} > ${HOY} - 35), 0) / 4.0 AS ventas_semana_prom,
         COUNT(DISTINCT v.id) FILTER (WHERE ${FECHA_VENTA} <= ${HOY} - 7 AND ${FECHA_VENTA} > ${HOY} - 35) / 4.0 AS num_ventas_semana_prom,
         COALESCE(SUM(dv.subtotal) FILTER (WHERE ${FECHA_VENTA} > ${HOY} - 28), 0) AS ventas_28,
         COALESCE(SUM(dv.subtotal) FILTER (WHERE ${FECHA_VENTA} > ${HOY} - 28 AND dv.costo_unitario > 0), 0) AS ventas_28_con_costo,
         COALESCE(SUM(dv.subtotal - dv.cantidad * dv.costo_unitario) FILTER (WHERE ${FECHA_VENTA} > ${HOY} - 28 AND dv.costo_unitario > 0), 0) AS ganancia_28,
         MIN(${FECHA_VENTA}) AS primera_venta
       ${LINEAS_PROPIAS}`),

    // 2. Qué te deja plata (28 días), con margen cuando hay costo.
    q(`SELECT p.id, p.nombre,
              SUM(dv.cantidad)::int AS unidades,
              SUM(dv.subtotal) AS ventas,
              SUM(dv.subtotal - dv.cantidad * dv.costo_unitario) FILTER (WHERE dv.costo_unitario > 0) AS ganancia,
              SUM(dv.subtotal) FILTER (WHERE dv.costo_unitario > 0) AS ventas_con_costo
       ${LINEAS_PROPIAS}
         AND ${FECHA_VENTA} > ${HOY} - 28
       GROUP BY p.id, p.nombre
       ORDER BY ventas DESC
       LIMIT 30`.replace('JOIN ventas v ON v.id = dv.venta_id', 'JOIN ventas v ON v.id = dv.venta_id JOIN productos p ON p.id = dv.producto_id')),

    // 3. Por agotarse: lo que se vende y alcanza para menos de 4 días.
    q(`WITH ritmo AS (
         SELECT dv.producto_id, SUM(dv.cantidad) / 14.0 AS por_dia
         ${LINEAS_PROPIAS}
           AND ${FECHA_VENTA} > ${HOY} - 14
         GROUP BY dv.producto_id
       )
       SELECT p.id, p.nombre, p.stock_actual, ROUND(r.por_dia, 1) AS por_dia,
              FLOOR(p.stock_actual / r.por_dia) AS dias_cobertura
       FROM productos p JOIN ritmo r ON r.producto_id = p.id
       WHERE p.modulo_id = $1 AND p.activo = true AND p.ignora_stock = false
         AND r.por_dia > 0 AND p.stock_actual / r.por_dia < 4
       ORDER BY p.stock_actual / r.por_dia, r.por_dia DESC
       LIMIT 8`),

    // 4. Plata quieta: inventario que no se ha vendido en 30 días.
    q(`SELECT p.id, p.nombre, p.stock_actual, p.precio_compra,
              (p.stock_actual * COALESCE(p.precio_compra, 0)) AS valor
       FROM productos p
       WHERE p.modulo_id = $1 AND p.activo = true AND p.ignora_stock = false
         AND p.stock_actual > 0
         AND p.fecha_creacion < now() - interval '30 days'
         AND NOT EXISTS (
           SELECT 1 FROM detalle_venta dv JOIN ventas v ON v.id = dv.venta_id
           WHERE dv.producto_id = p.id AND ${FECHA_VENTA} > ${HOY} - 30
         )
       ORDER BY valor DESC`),

    // 5. Productos vendidos sin costo registrado (la ganancia no se puede calcular).
    q(`SELECT p.id, p.nombre, SUM(dv.subtotal) AS ventas
       ${LINEAS_PROPIAS}
         AND ${FECHA_VENTA} > ${HOY} - 28
         AND (dv.costo_unitario IS NULL OR dv.costo_unitario = 0)
       GROUP BY p.id, p.nombre
       ORDER BY ventas DESC`.replace('JOIN ventas v ON v.id = dv.venta_id', 'JOIN ventas v ON v.id = dv.venta_id JOIN productos p ON p.id = dv.producto_id')),

    // 6. Fiado: quién debe y desde cuándo no se mueve su cuenta.
    q(`WITH cuentas AS (
         SELECT c.id, c.nombre,
           (SELECT COALESCE(SUM(v.total), 0) FROM ventas v
            WHERE v.modulo_id = c.modulo_id AND v.cliente_id = c.id AND v.metodo_pago = 'credito')
           -
           (SELECT COALESCE(SUM(mc.monto), 0) FROM movimientos_caja mc
            WHERE mc.cliente_id = c.id AND mc.origen = 'manual' AND mc.categoria = 'abono_credito') AS deuda,
           GREATEST(
             (SELECT MAX(v.fecha_venta) FROM ventas v WHERE v.modulo_id = c.modulo_id AND v.cliente_id = c.id AND v.metodo_pago = 'credito'),
             (SELECT MAX(mc.fecha) FROM movimientos_caja mc WHERE mc.cliente_id = c.id AND mc.categoria = 'abono_credito')
           ) AS ultimo_movimiento
         FROM clientes c
         WHERE c.modulo_id = $1 AND c.activo = true
       )
       SELECT id, nombre, deuda,
              EXTRACT(DAY FROM now() - ultimo_movimiento)::int AS dias_sin_movimiento
       FROM cuentas WHERE deuda > 0
       ORDER BY deuda DESC`),

    // 7. Proveedores: pedidos recibidos en las últimas 8 semanas.
    q(`SELECT pr.id, pr.nombre,
              COUNT(*)::int AS pedidos,
              SUM(p.total) AS total,
              AVG(p.total) AS pedido_promedio,
              MIN(p.fecha_pedido) AS primero,
              MAX(p.fecha_pedido) AS ultimo,
              COALESCE(SUM(p.total) FILTER (WHERE p.fecha_pedido > now() - interval '28 days'), 0) AS total_ultimas_4,
              COALESCE(SUM(p.total) FILTER (WHERE p.fecha_pedido <= now() - interval '28 days'), 0) AS total_previas_4
       FROM pedidos_proveedor p
       JOIN proveedores pr ON pr.id = p.proveedor_id
       WHERE p.modulo_id = $1 AND p.estado = 'recibido'
         AND p.fecha_pedido > now() - interval '56 days'
       GROUP BY pr.id, pr.nombre
       ORDER BY total DESC`),

    // Ventas propias de las mismas 8 semanas, para comparar con las compras.
    q(`SELECT COALESCE(SUM(dv.subtotal), 0) AS ventas_56
       ${LINEAS_PROPIAS}
         AND ${FECHA_VENTA} > ${HOY} - 56`),

    // 8. Cuándo te compran: por día de la semana (8 semanas, en caja de este módulo).
    q(`SELECT EXTRACT(ISODOW FROM ${FECHA_VENTA})::int AS dia,
              COUNT(*)::int AS ventas,
              SUM(v.total) / 8.0 AS promedio
       FROM ventas v
       WHERE v.modulo_id = $1 AND v.es_ajuste_manual = false AND v.metodo_pago <> 'consumo_propio'
         AND ${FECHA_VENTA} > ${HOY} - 56
       GROUP BY 1 ORDER BY 1`),

    q(`SELECT EXTRACT(HOUR FROM (v.fecha_venta AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota'))::int AS hora,
              COUNT(*)::int AS ventas,
              SUM(v.total) AS total
       FROM ventas v
       WHERE v.modulo_id = $1 AND v.es_ajuste_manual = false AND v.metodo_pago <> 'consumo_propio'
         AND ${FECHA_VENTA} > ${HOY} - 56
       GROUP BY 1 ORDER BY 1`),

    // 9. Hoy contra un día normal: lo que va del día comparado con el mismo
    //    día de la semana de las 4 semanas anteriores, hasta la misma hora.
    q(`SELECT
         COALESCE(SUM(dv.subtotal) FILTER (WHERE ${FECHA_VENTA} = ${HOY}), 0) AS hoy,
         COALESCE(SUM(dv.subtotal) FILTER (
           WHERE ${FECHA_VENTA} IN (${HOY} - 7, ${HOY} - 14, ${HOY} - 21, ${HOY} - 28)
             AND (v.fecha_venta AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::time <= (now() AT TIME ZONE 'America/Bogota')::time
         ), 0) / 4.0 AS normal_a_esta_hora,
         COALESCE(SUM(dv.subtotal) FILTER (
           WHERE ${FECHA_VENTA} IN (${HOY} - 7, ${HOY} - 14, ${HOY} - 21, ${HOY} - 28)
         ), 0) / 4.0 AS normal_dia_completo,
         EXTRACT(ISODOW FROM ${HOY})::int AS dia_semana,
         to_char(now() AT TIME ZONE 'America/Bogota', 'HH24:MI') AS hora_actual
       ${LINEAS_PROPIAS}
         AND ${FECHA_VENTA} >= ${HOY} - 28`),

    // 10. Lo que va de la semana (desde el lunes) y del mes, para las metas.
    q(`SELECT
         COALESCE(SUM(dv.subtotal) FILTER (WHERE ${FECHA_VENTA} >= date_trunc('week', ${HOY})::date), 0) AS ventas_semana,
         COALESCE(SUM(dv.subtotal) FILTER (WHERE ${FECHA_VENTA} >= date_trunc('month', ${HOY})::date), 0) AS ventas_mes,
         COALESCE(SUM(dv.subtotal - dv.cantidad * dv.costo_unitario) FILTER (
           WHERE ${FECHA_VENTA} >= date_trunc('month', ${HOY})::date AND dv.costo_unitario > 0
         ), 0) AS ganancia_mes,
         (7 - EXTRACT(ISODOW FROM ${HOY}))::int AS dias_restantes_semana,
         ((date_trunc('month', ${HOY}) + interval '1 month')::date - ${HOY} - 1)::int AS dias_restantes_mes
       ${LINEAS_PROPIAS}
         AND ${FECHA_VENTA} >= LEAST(date_trunc('week', ${HOY})::date, date_trunc('month', ${HOY})::date)`)
  ]);

  // Metas configuradas por el dueño (modulos.metas). Si la columna todavía
  // no existe en la base, el resumen sigue funcionando sin metas.
  let metasConfig = {};
  try {
    const r = await pool.query('SELECT metas FROM modulos WHERE id = $1', [moduloId]);
    metasConfig = r.rows[0]?.metas || {};
  } catch {
    metasConfig = {};
  }

  // ---- Proveedores: promedios semanales y frecuencia ----
  const gastoTotal56 = proveedores.reduce((s, p) => s + num(p.total), 0);
  const listaProveedores = proveedores.map(p => {
    const diasEntrePedidos = p.pedidos > 1
      ? Math.round((new Date(p.ultimo) - new Date(p.primero)) / 86400000 / (p.pedidos - 1))
      : null;
    return {
      id: p.id,
      nombre: p.nombre,
      pedidos: p.pedidos,
      pedido_promedio: Math.round(num(p.pedido_promedio)),
      gasto_semanal: Math.round(num(p.total) / 8),
      participacion: gastoTotal56 > 0 ? Math.round((num(p.total) / gastoTotal56) * 100) : 0,
      cada_dias: diasEntrePedidos,
      total_ultimas_4: Math.round(num(p.total_ultimas_4)),
      total_previas_4: Math.round(num(p.total_previas_4)),
      ultimo_pedido: p.ultimo
    };
  });

  // ---- Productos: los que más dejan y los que se venden mucho con poco margen ----
  const productos = productosTop.map(p => ({
    id: p.id,
    nombre: p.nombre,
    unidades: p.unidades,
    ventas: Math.round(num(p.ventas)),
    ganancia: p.ganancia === null ? null : Math.round(num(p.ganancia)),
    margen: num(p.ventas_con_costo) > 0 ? Math.round((num(p.ganancia) / num(p.ventas_con_costo)) * 100) : null
  }));
  const masGanancia = productos.filter(p => p.ganancia !== null)
    .sort((a, b) => b.ganancia - a.ganancia).slice(0, 5);
  const margenBajo = productos.slice(0, 15).filter(p => p.margen !== null && p.margen < 20).slice(0, 5);

  const deudores = fiado.map(f => ({ ...f, deuda: Math.round(num(f.deuda)) }));

  return {
    generado: new Date().toISOString(),
    ventas: {
      ultimos_7: Math.round(num(ventas.ventas_7)),
      num_ventas_7: Number(ventas.num_ventas_7),
      semana_promedio: Math.round(num(ventas.ventas_semana_prom)),
      num_ventas_semana_promedio: Math.round(num(ventas.num_ventas_semana_prom)),
      ultimos_28: Math.round(num(ventas.ventas_28)),
      ganancia_28: Math.round(num(ventas.ganancia_28)),
      margen_28: num(ventas.ventas_28_con_costo) > 0
        ? Math.round((num(ventas.ganancia_28) / num(ventas.ventas_28_con_costo)) * 100) : null,
      porcentaje_sin_costo: num(ventas.ventas_28) > 0
        ? Math.round(((num(ventas.ventas_28) - num(ventas.ventas_28_con_costo)) / num(ventas.ventas_28)) * 100) : 0,
      primera_venta: ventas.primera_venta
    },
    productos: { mas_ganancia: masGanancia, margen_bajo: margenBajo, mas_vendidos: productos.slice(0, 5) },
    atencion: {
      por_agotarse: porAgotarse.map(p => ({ ...p, stock_actual: num(p.stock_actual), por_dia: num(p.por_dia), dias_cobertura: num(p.dias_cobertura) })),
      plata_quieta: {
        total: Math.round(plataQuieta.reduce((s, p) => s + num(p.valor), 0)),
        cantidad: plataQuieta.length,
        productos: plataQuieta.slice(0, 5).map(p => ({ id: p.id, nombre: p.nombre, stock_actual: num(p.stock_actual), valor: Math.round(num(p.valor)) }))
      },
      sin_costo: {
        cantidad: sinCosto.length,
        productos: sinCosto.slice(0, 5).map(p => ({ id: p.id, nombre: p.nombre, ventas: Math.round(num(p.ventas)) }))
      },
      fiado: {
        total: deudores.reduce((s, d) => s + d.deuda, 0),
        clientes: deudores.length,
        quietos: deudores.filter(d => d.dias_sin_movimiento === null || d.dias_sin_movimiento >= 30).slice(0, 5)
      }
    },
    proveedores: {
      gasto_semanal: Math.round(gastoTotal56 / 8),
      ventas_semanal: Math.round(num(comprasVentas.ventas_56) / 8),
      lista: listaProveedores
    },
    hoy: {
      ventas: Math.round(num(hoy.ventas_hoy ?? hoy.hoy)),
      normal_a_esta_hora: Math.round(num(hoy.normal_a_esta_hora)),
      normal_dia_completo: Math.round(num(hoy.normal_dia_completo)),
      dia_semana: hoy.dia_semana,
      hora: hoy.hora_actual
    },
    metas: {
      ventas_semana: num(metasConfig.ventas_semana) || null,
      ventas_mes: num(metasConfig.ventas_mes) || null,
      ganancia_mes: num(metasConfig.ganancia_mes) || null,
      avance: {
        ventas_semana: Math.round(num(avance.ventas_semana)),
        ventas_mes: Math.round(num(avance.ventas_mes)),
        ganancia_mes: Math.round(num(avance.ganancia_mes)),
        dias_restantes_semana: avance.dias_restantes_semana,
        dias_restantes_mes: avance.dias_restantes_mes
      }
    },
    tiempo: {
      dias: dias.map(d => ({ dia: d.dia, ventas: d.ventas, promedio: Math.round(num(d.promedio)) })),
      horas: horas.map(h => ({ hora: h.hora, ventas: h.ventas, total: Math.round(num(h.total)) }))
    }
  };
}

// ---------------------------------------------------------------------------
// "Antes y ahora": los primeros 30 días con ventas contra los últimos 30, con
// el mismo largo para que la comparación sea justa, más la serie mes a mes.
// ---------------------------------------------------------------------------
async function metricasPeriodo(pool, moduloId, desde, hasta) {
  const params = [moduloId, desde, hasta];
  const rango = `${FECHA_VENTA} BETWEEN $2::date AND $3::date`;
  const q = (sql) => pool.query(sql, params).then(r => r.rows);
  const ventasCaja = `FROM ventas v
       WHERE v.modulo_id = $1 AND v.es_ajuste_manual = false AND v.metodo_pago <> 'consumo_propio' AND ${rango}`;

  const [[v], top, movidos, [dia], [hora], metodos, [compras], [pedidosCliente]] = await Promise.all([
    q(`SELECT COALESCE(SUM(dv.subtotal), 0) AS ventas,
              COUNT(DISTINCT v.id) AS num_ventas,
              COUNT(DISTINCT ${FECHA_VENTA}) AS dias_con_ventas,
              COALESCE(SUM(dv.cantidad), 0) AS unidades,
              COUNT(DISTINCT dv.producto_id) AS productos_distintos,
              COALESCE(SUM(dv.subtotal) FILTER (WHERE dv.costo_unitario > 0), 0) AS ventas_con_costo,
              COALESCE(SUM(dv.subtotal - dv.cantidad * dv.costo_unitario) FILTER (WHERE dv.costo_unitario > 0), 0) AS ganancia
       ${LINEAS_COMPARABLES} AND ${rango}`),
    q(`SELECT p.nombre, SUM(dv.cantidad)::int AS unidades, SUM(dv.subtotal) AS ventas
       FROM detalle_venta dv JOIN ventas v ON v.id = dv.venta_id JOIN productos p ON p.id = dv.producto_id
       WHERE dv.modulo_dueno_id = $1 AND p.modulo_id = $1 AND v.es_ajuste_manual = false AND v.metodo_pago <> 'consumo_propio' AND ${rango}
       GROUP BY p.nombre ORDER BY ventas DESC LIMIT 5`),
    q(`SELECT m.nombre AS modulo, SUM(dv.subtotal) AS ventas,
              string_agg(DISTINCT p.nombre, ', ') AS productos
       FROM detalle_venta dv JOIN ventas v ON v.id = dv.venta_id
       JOIN productos p ON p.id = dv.producto_id JOIN modulos m ON m.id = p.modulo_id
       WHERE dv.modulo_dueno_id = $1 AND p.modulo_id <> $1
         AND v.es_ajuste_manual = false AND v.metodo_pago <> 'consumo_propio' AND ${rango}
       GROUP BY m.nombre ORDER BY ventas DESC`),
    q(`SELECT EXTRACT(ISODOW FROM ${FECHA_VENTA})::int AS dia, SUM(v.total) AS total
       ${ventasCaja}
       GROUP BY 1 ORDER BY total DESC LIMIT 1`),
    q(`SELECT EXTRACT(HOUR FROM (v.fecha_venta AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota'))::int AS hora, COUNT(*) AS n
       ${ventasCaja}
       GROUP BY 1 ORDER BY n DESC LIMIT 1`),
    q(`SELECT v.metodo_pago, SUM(v.total) AS total
       ${ventasCaja}
       GROUP BY 1`),
    q(`SELECT COALESCE(SUM(total), 0) AS total, COUNT(*)::int AS pedidos
       FROM pedidos_proveedor
       WHERE modulo_id = $1 AND estado = 'recibido'
         AND (fecha_pedido AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::date BETWEEN $2::date AND $3::date`),
    q(`SELECT COUNT(*)::int AS pedidos, COUNT(*) FILTER (WHERE es_domicilio)::int AS domicilios
       FROM pedidos_cliente
       WHERE modulo_id = $1 AND estado <> 'cancelado'
         AND (fecha_creacion AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::date BETWEEN $2::date AND $3::date`)
  ]);

  const ventas = num(v.ventas);
  const numVentas = Number(v.num_ventas);
  const totalMetodos = metodos.reduce((s, m) => s + num(m.total), 0);
  const porMetodo = Object.fromEntries(metodos.map(m => [m.metodo_pago, totalMetodos > 0 ? Math.round((num(m.total) / totalMetodos) * 100) : 0]));
  const dias = Math.round((new Date(`${hasta}T12:00:00Z`) - new Date(`${desde}T12:00:00Z`)) / 86400000) + 1;

  return {
    desde, hasta, dias,
    ventas: Math.round(ventas),
    ventas_por_dia: Math.round(ventas / dias),
    num_ventas: numVentas,
    ventas_diarias: Math.round((numVentas / dias) * 10) / 10,
    ticket: numVentas > 0 ? Math.round(ventas / numVentas) : 0,
    dias_con_ventas: Number(v.dias_con_ventas),
    unidades: Math.round(num(v.unidades)),
    productos_distintos: Number(v.productos_distintos),
    ganancia: Math.round(num(v.ganancia)),
    margen: num(v.ventas_con_costo) > 0 ? Math.round((num(v.ganancia) / num(v.ventas_con_costo)) * 100) : null,
    porcentaje_sin_costo: ventas > 0 ? Math.round(((ventas - num(v.ventas_con_costo)) / ventas) * 100) : 0,
    top: top.map(t => ({ nombre: t.nombre.trim(), unidades: t.unidades, ventas: Math.round(num(t.ventas)) })),
    movidos: movidos.map(m => ({ modulo: m.modulo, ventas: Math.round(num(m.ventas)), productos: m.productos })),
    mejor_dia: dia ? dia.dia : null,
    hora_pico: hora ? hora.hora : null,
    metodos: porMetodo,
    compras: Math.round(num(compras.total)),
    pedidos_proveedor: compras.pedidos,
    pedidos_cliente: pedidosCliente.pedidos,
    domicilios: pedidosCliente.domicilios
  };
}

const sumarDias = (fecha, n) => {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function construirAntesYAhora(pool, moduloId) {
  const [inicio] = (await pool.query(
    `SELECT MIN(${FECHA_VENTA})::text AS primera, ${HOY}::text AS hoy
     ${LINEAS_PROPIAS}`, [moduloId])).rows;

  if (!inicio.primera) {
    return { suficiente: false, dias_con_datos: 0 };
  }
  const diasConDatos = Math.round((new Date(`${inicio.hoy}T12:00:00Z`) - new Date(`${inicio.primera}T12:00:00Z`)) / 86400000) + 1;
  // Hacen falta al menos dos periodos de 30 días que no se crucen.
  if (diasConDatos < 60) {
    return { suficiente: false, dias_con_datos: diasConDatos, primera_venta: inicio.primera };
  }

  const [antes, ahora, mensual] = await Promise.all([
    metricasPeriodo(pool, moduloId, inicio.primera, sumarDias(inicio.primera, 29)),
    metricasPeriodo(pool, moduloId, sumarDias(inicio.hoy, -29), inicio.hoy),
    pool.query(
      `SELECT to_char(${FECHA_VENTA}, 'YYYY-MM') AS mes,
              COALESCE(SUM(dv.subtotal), 0) AS ventas,
              COUNT(DISTINCT v.id)::int AS num_ventas,
              COUNT(DISTINCT ${FECHA_VENTA})::int AS dias,
              COALESCE(SUM(dv.subtotal - dv.cantidad * dv.costo_unitario) FILTER (WHERE dv.costo_unitario > 0), 0) AS ganancia
       ${LINEAS_COMPARABLES}
       GROUP BY 1 ORDER BY 1`, [moduloId]).then(r => r.rows)
  ]);

  return {
    suficiente: true,
    dias_con_datos: diasConDatos,
    primera_venta: inicio.primera,
    antes,
    ahora,
    mensual: mensual.map(m => ({
      mes: m.mes,
      ventas: Math.round(num(m.ventas)),
      num_ventas: m.num_ventas,
      dias: m.dias,
      ganancia: Math.round(num(m.ganancia))
    }))
  };
}

module.exports = { construirResumen, construirAntesYAhora, metricasPeriodo };
