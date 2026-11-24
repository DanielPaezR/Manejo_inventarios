// Rutas: Finanzas consolidadas del negocio y simulador.
// Movidas desde server.js (secciones: RUTAS DE FINANZAS DEL NEGOCIO (CONSOLIDADO)).
// Reciben ctx con lo que server.js prepara (app, pool, middlewares, helpers)
// y lo que exportan los grupos registrados antes; devuelven lo que otros usan.
module.exports = function registrarRutas(ctx) {
  const {
    moment, ahoraColombia, authenticateToken, requireAdmin, checkAccess, app, pool,
    claveBucketColombia, generarClavesBucket
  } = ctx;

  // ==================== RUTAS DE FINANZAS DEL NEGOCIO (CONSOLIDADO) ====================
  // A diferencia de /api/finanzas/* (por módulo, para el día a día operativo
  // de cada módulo: "cómo le fue a Empanadas el domingo"), esto es una vista
  // CONSOLIDADA de todo el negocio — suma movimientos_caja/ventas de TODOS
  // los módulos, para planeación financiera familiar/del dueño. No reemplaza
  // ni migra nada de lo existente, solo agrega sobre lo mismo.

  // Resuelve negocioId directo del usuario (admin) o por query param
  // (super_admin) — a propósito NO pasa por checkAccess/moduloId: esta vista
  // es del negocio completo, no de un módulo puntual.
  const resolverNegocioAdmin = async (req, res, next) => {
    try {
      if (req.user.rol === 'super_admin') {
        const negocioId = parseInt(req.query.negocio_id, 10);
        if (!negocioId) {
          return res.status(400).json({ error: 'Se requiere negocio_id' });
        }
        req.negocioId = negocioId;
        return next();
      }

      const result = await pool.query(
        'SELECT negocio_id FROM usuarios WHERE id = $1 AND activo = true',
        [req.user.id]
      );

      if (!result.rows[0]?.negocio_id) {
        return res.status(400).json({ error: 'Usuario sin negocio asignado' });
      }

      req.negocioId = result.rows[0].negocio_id;
      next();
    } catch (error) {
      console.error('Error resolviendo negocio:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  };

  // ---- Configuración (valor del bloque, reserva de seguridad, gastos personales mínimos) ----

  app.get('/api/finanzas-negocio/configuracion', authenticateToken, requireAdmin, resolverNegocioAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT valor_bloque, reserva_seguridad_pct, gastos_personales_minimos FROM negocios WHERE id = $1',
        [req.negocioId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Negocio no encontrado' });
      }
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error obteniendo configuración financiera:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.put('/api/finanzas-negocio/configuracion', authenticateToken, requireAdmin, resolverNegocioAdmin, async (req, res) => {
    try {
      const { valor_bloque, reserva_seguridad_pct, gastos_personales_minimos } = req.body;

      if (valor_bloque !== undefined && (!Number.isFinite(Number(valor_bloque)) || Number(valor_bloque) <= 0)) {
        return res.status(400).json({ error: 'valor_bloque debe ser un número mayor a cero' });
      }
      if (reserva_seguridad_pct !== undefined && (!Number.isFinite(Number(reserva_seguridad_pct)) || Number(reserva_seguridad_pct) < 0 || Number(reserva_seguridad_pct) > 100)) {
        return res.status(400).json({ error: 'reserva_seguridad_pct debe ser un número entre 0 y 100' });
      }
      if (gastos_personales_minimos !== undefined && (!Number.isFinite(Number(gastos_personales_minimos)) || Number(gastos_personales_minimos) < 0)) {
        return res.status(400).json({ error: 'gastos_personales_minimos debe ser un número mayor o igual a cero' });
      }

      const result = await pool.query(
        `UPDATE negocios SET
         valor_bloque = COALESCE($1, valor_bloque),
         reserva_seguridad_pct = COALESCE($2, reserva_seguridad_pct),
         gastos_personales_minimos = COALESCE($3, gastos_personales_minimos)
       WHERE id = $4
       RETURNING valor_bloque, reserva_seguridad_pct, gastos_personales_minimos`,
        [valor_bloque ?? null, reserva_seguridad_pct ?? null, gastos_personales_minimos ?? null, req.negocioId]
      );

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error actualizando configuración financiera:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ---- Activos fijos ----

  app.get('/api/finanzas-negocio/activos-fijos', authenticateToken, requireAdmin, resolverNegocioAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM activos_fijos WHERE negocio_id = $1 AND activo = true ORDER BY fecha_adquisicion DESC NULLS LAST, id DESC',
        [req.negocioId]
      );
      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo activos fijos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.post('/api/finanzas-negocio/activos-fijos', authenticateToken, requireAdmin, resolverNegocioAdmin, async (req, res) => {
    try {
      const { nombre, valor, fecha_adquisicion } = req.body;

      if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'El nombre es requerido' });
      }
      const valorNum = Number(valor);
      if (!Number.isFinite(valorNum) || valorNum <= 0) {
        return res.status(400).json({ error: 'valor debe ser un número mayor a cero' });
      }

      const result = await pool.query(
        'INSERT INTO activos_fijos (negocio_id, nombre, valor, fecha_adquisicion) VALUES ($1, $2, $3, $4) RETURNING *',
        [req.negocioId, nombre.trim(), valorNum, fecha_adquisicion || null]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error creando activo fijo:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.put('/api/finanzas-negocio/activos-fijos/:id', authenticateToken, requireAdmin, resolverNegocioAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { nombre, valor, fecha_adquisicion } = req.body;

      if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'El nombre es requerido' });
      }
      const valorNum = Number(valor);
      if (!Number.isFinite(valorNum) || valorNum <= 0) {
        return res.status(400).json({ error: 'valor debe ser un número mayor a cero' });
      }

      const result = await pool.query(
        'UPDATE activos_fijos SET nombre = $1, valor = $2, fecha_adquisicion = $3 WHERE id = $4 AND negocio_id = $5 RETURNING *',
        [nombre.trim(), valorNum, fecha_adquisicion || null, id, req.negocioId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Activo no encontrado' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error actualizando activo fijo:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.delete('/api/finanzas-negocio/activos-fijos/:id', authenticateToken, requireAdmin, resolverNegocioAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await pool.query('UPDATE activos_fijos SET activo = false WHERE id = $1 AND negocio_id = $2', [id, req.negocioId]);
      res.json({ message: 'Activo eliminado correctamente' });
    } catch (error) {
      console.error('Error eliminando activo fijo:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ---- Deudas ----

  app.get('/api/finanzas-negocio/deudas', authenticateToken, requireAdmin, resolverNegocioAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM deudas WHERE negocio_id = $1 AND activo = true ORDER BY id DESC',
        [req.negocioId]
      );
      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo deudas:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.post('/api/finanzas-negocio/deudas', authenticateToken, requireAdmin, resolverNegocioAdmin, async (req, res) => {
    try {
      const { nombre, monto_total, saldo_pendiente, cuota_mensual } = req.body;

      if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'El nombre es requerido' });
      }
      const montoTotalNum = Number(monto_total);
      if (!Number.isFinite(montoTotalNum) || montoTotalNum <= 0) {
        return res.status(400).json({ error: 'monto_total debe ser un número mayor a cero' });
      }
      const saldoPendienteNum = saldo_pendiente !== undefined && saldo_pendiente !== '' ? Number(saldo_pendiente) : montoTotalNum;
      if (!Number.isFinite(saldoPendienteNum) || saldoPendienteNum < 0) {
        return res.status(400).json({ error: 'saldo_pendiente debe ser un número mayor o igual a cero' });
      }
      const cuotaMensualNum = cuota_mensual !== undefined && cuota_mensual !== '' ? Number(cuota_mensual) : null;
      if (cuotaMensualNum !== null && (!Number.isFinite(cuotaMensualNum) || cuotaMensualNum < 0)) {
        return res.status(400).json({ error: 'cuota_mensual debe ser un número mayor o igual a cero' });
      }

      const result = await pool.query(
        'INSERT INTO deudas (negocio_id, nombre, monto_total, saldo_pendiente, cuota_mensual) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [req.negocioId, nombre.trim(), montoTotalNum, saldoPendienteNum, cuotaMensualNum]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error creando deuda:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.put('/api/finanzas-negocio/deudas/:id', authenticateToken, requireAdmin, resolverNegocioAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { nombre, monto_total, saldo_pendiente, cuota_mensual } = req.body;

      if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'El nombre es requerido' });
      }
      const montoTotalNum = Number(monto_total);
      const saldoPendienteNum = Number(saldo_pendiente);
      if (!Number.isFinite(montoTotalNum) || montoTotalNum <= 0) {
        return res.status(400).json({ error: 'monto_total debe ser un número mayor a cero' });
      }
      if (!Number.isFinite(saldoPendienteNum) || saldoPendienteNum < 0) {
        return res.status(400).json({ error: 'saldo_pendiente debe ser un número mayor o igual a cero' });
      }
      const cuotaMensualNum = cuota_mensual !== undefined && cuota_mensual !== '' ? Number(cuota_mensual) : null;

      const result = await pool.query(
        'UPDATE deudas SET nombre = $1, monto_total = $2, saldo_pendiente = $3, cuota_mensual = $4 WHERE id = $5 AND negocio_id = $6 RETURNING *',
        [nombre.trim(), montoTotalNum, saldoPendienteNum, cuotaMensualNum, id, req.negocioId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Deuda no encontrada' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error actualizando deuda:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.delete('/api/finanzas-negocio/deudas/:id', authenticateToken, requireAdmin, resolverNegocioAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await pool.query('UPDATE deudas SET activo = false WHERE id = $1 AND negocio_id = $2', [id, req.negocioId]);
      res.json({ message: 'Deuda eliminada correctamente' });
    } catch (error) {
      console.error('Error eliminando deuda:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ---- Categorías de gasto disponibles para el simulador (son las MISMAS
  // categorias_gasto que se usan en Finanzas por módulo para etiquetar
  // movimientos_caja; aquí solo se listan a nivel negocio y se marca cuáles
  // se muestran como columna del ábaco) ----

  app.get('/api/finanzas-negocio/categorias-gasto', authenticateToken, requireAdmin, resolverNegocioAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT cg.id, cg.nombre, cg.tipo, cg.mostrar_en_simulador, cg.modulo_id, m.nombre AS modulo_nombre
       FROM categorias_gasto cg
       JOIN modulos m ON m.id = cg.modulo_id
       WHERE cg.negocio_id = $1 AND cg.activo = true
       ORDER BY m.nombre, cg.nombre`,
        [req.negocioId]
      );
      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo categorías de gasto:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.put('/api/finanzas-negocio/categorias-gasto/:id/mostrar-en-simulador', authenticateToken, requireAdmin, resolverNegocioAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { mostrar_en_simulador } = req.body;

      if (typeof mostrar_en_simulador !== 'boolean') {
        return res.status(400).json({ error: 'mostrar_en_simulador debe ser true o false' });
      }

      const result = await pool.query(
        'UPDATE categorias_gasto SET mostrar_en_simulador = $1 WHERE id = $2 AND negocio_id = $3 RETURNING id, nombre, tipo, mostrar_en_simulador, modulo_id',
        [mostrar_en_simulador, id, req.negocioId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Categoría no encontrada' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error actualizando mostrar_en_simulador:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ---- Resumen financiero mensual (balance general + estado de resultados) ----
  // gastos_fijos = tipo 'fijo' + tipo 'servicios' (ambos son costos fijos
  // recurrentes); 'ahorro'/'reinversion'/'mercancia' se muestran aparte, como
  // informativos — son usos de la utilidad, no gastos que la reduzcan (el
  // costo de mercancía vendida ya se calculó del lado de las ventas, no del
  // lado de las compras).
  app.get('/api/finanzas-negocio/resumen-mensual', authenticateToken, requireAdmin, resolverNegocioAdmin, async (req, res) => {
    try {
      const negocioId = req.negocioId;
      const anio = parseInt(req.query.anio, 10);
      const mes = parseInt(req.query.mes, 10);

      if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
        return res.status(400).json({ error: 'anio y mes son requeridos (mes entre 1 y 12)' });
      }

      const mesStr = String(mes).padStart(2, '0');
      const startDate = moment(`${anio}-${mesStr}-01 00:00:00-05:00`);
      const endDate = startDate.clone().endOf('month');
      const startDateAnterior = startDate.clone().subtract(1, 'month');
      const endDateAnterior = startDateAnterior.clone().endOf('month');

      const modulosResult = await pool.query('SELECT id FROM modulos WHERE negocio_id = $1', [negocioId]);
      const moduloIds = modulosResult.rows.map(r => r.id);
      if (moduloIds.length === 0) {
        return res.status(400).json({ error: 'El negocio no tiene módulos' });
      }

      // Balance general: saldo de caja ACUMULADO hasta el fin del mes elegido
      // (es un balance, no un flujo de un solo mes).
      const cajaResult = await pool.query(
        `SELECT COALESCE(SUM(monto) FILTER (WHERE tipo IN ('saldo_inicial','ingreso')), 0)
              - COALESCE(SUM(monto) FILTER (WHERE tipo = 'egreso'), 0) as efectivo
       FROM movimientos_caja
       WHERE negocio_id = $1 AND fecha <= $2`,
        [negocioId, endDate.toDate()]
      );

      // Inventario a costo: snapshot ACTUAL — no hay historial de stock por
      // fecha, así que para cualquier mes consultado se usa el mismo valor de
      // hoy (limitación conocida de Fase 1).
      const inventarioResult = await pool.query(
        'SELECT COALESCE(SUM(stock_actual * precio_compra), 0) as total FROM productos WHERE modulo_id = ANY($1) AND activo = true',
        [moduloIds]
      );

      // Activos adquiridos hasta el fin del mes (los comprados después no cuentan)
      const activosResult = await pool.query(
        'SELECT COALESCE(SUM(valor), 0) as total FROM activos_fijos WHERE negocio_id = $1 AND activo = true AND (fecha_adquisicion IS NULL OR fecha_adquisicion <= $2)',
        [negocioId, endDate.format('YYYY-MM-DD')]
      );

      // Deudas: saldo pendiente ACTUAL — no hay historial de abonos por fecha,
      // misma limitación que inventario.
      const deudasResult = await pool.query(
        'SELECT COALESCE(SUM(saldo_pendiente), 0) as total FROM deudas WHERE negocio_id = $1 AND activo = true',
        [negocioId]
      );

      const ventasEnRango = async (desde, hasta) => {
        const r = await pool.query(
          `SELECT COALESCE(SUM(total), 0) as total
         FROM ventas
         WHERE modulo_id = ANY($1) AND fecha_venta BETWEEN $2 AND $3
         AND es_ajuste_manual = false AND metodo_pago != 'consumo_propio'`,
          [moduloIds, desde, hasta]
        );
        return Number(r.rows[0].total);
      };

      const ventasDelMes = await ventasEnRango(startDate.toDate(), endDate.toDate());
      const ventasMesAnterior = await ventasEnRango(startDateAnterior.toDate(), endDateAnterior.toDate());

      // Costo de mercancía vendida: costo_unitario si la venta lo guardó (a
      // partir de este cambio), si no, precio_compra ACTUAL del producto como
      // aproximación — ventas viejas no tienen el costo histórico real.
      const cogsResult = await pool.query(
        `SELECT COALESCE(SUM(dv.cantidad * COALESCE(dv.costo_unitario, p.precio_compra, 0)), 0) as total
       FROM detalle_venta dv
       JOIN ventas v ON dv.venta_id = v.id
       LEFT JOIN productos p ON dv.producto_id = p.id
       WHERE v.modulo_id = ANY($1) AND v.fecha_venta BETWEEN $2 AND $3
       AND v.es_ajuste_manual = false AND v.metodo_pago != 'consumo_propio'`,
        [moduloIds, startDate.toDate(), endDate.toDate()]
      );

      const gastosResult = await pool.query(
        `SELECT cg.tipo, COALESCE(SUM(mc.monto), 0) as total
       FROM movimientos_caja mc
       JOIN categorias_gasto cg ON mc.categoria_gasto_id = cg.id
       WHERE mc.negocio_id = $1 AND mc.tipo = 'egreso' AND mc.fecha BETWEEN $2 AND $3
       GROUP BY cg.tipo`,
        [negocioId, startDate.toDate(), endDate.toDate()]
      );
      const gastosPorTipo = Object.fromEntries(gastosResult.rows.map(r => [r.tipo, Number(r.total)]));

      const efectivo = Number(cajaResult.rows[0].efectivo);
      const inventarioACosto = Number(inventarioResult.rows[0].total);
      const activosFijos = Number(activosResult.rows[0].total);
      const deudas = Number(deudasResult.rows[0].total);
      const patrimonio = efectivo + inventarioACosto + activosFijos - deudas;

      const costoMercanciaVendida = Number(cogsResult.rows[0].total);
      const gastosFijos = (gastosPorTipo.fijo || 0) + (gastosPorTipo.servicios || 0);
      const gastosPersonales = gastosPorTipo.personal || 0;
      const utilidadNeta = ventasDelMes - costoMercanciaVendida - gastosFijos - gastosPersonales;

      const config = await pool.query(
        'SELECT reserva_seguridad_pct, gastos_personales_minimos FROM negocios WHERE id = $1',
        [negocioId]
      );
      const reservaPct = Number(config.rows[0]?.reserva_seguridad_pct || 0);
      const gastosPersonalesMinimos = Number(config.rows[0]?.gastos_personales_minimos || 0);
      const reservaSeguridad = gastosFijos * (reservaPct / 100);
      const disponibleParaReinvertir = utilidadNeta - reservaSeguridad - gastosPersonalesMinimos;

      const margenBrutoPct = ventasDelMes > 0 ? ((ventasDelMes - costoMercanciaVendida) / ventasDelMes) * 100 : null;
      const crecimientoVentasPct = ventasMesAnterior > 0 ? ((ventasDelMes - ventasMesAnterior) / ventasMesAnterior) * 100 : null;
      const rotacionInventario = inventarioACosto > 0 ? costoMercanciaVendida / inventarioACosto : null;

      res.json({
        periodo: { anio, mes, fecha_inicio: startDate.format('YYYY-MM-DD'), fecha_fin: endDate.format('YYYY-MM-DD') },
        balance_general: {
          efectivo_en_caja: efectivo,
          inventario_a_costo: inventarioACosto,
          activos_fijos: activosFijos,
          deudas,
          patrimonio
        },
        estado_resultados: {
          ventas_del_mes: ventasDelMes,
          costo_mercancia_vendida: costoMercanciaVendida,
          gastos_fijos: gastosFijos,
          gastos_personales: gastosPersonales,
          utilidad_neta: utilidadNeta
        },
        informativo: {
          gastos_mercancia_comprada: gastosPorTipo.mercancia || 0,
          gastos_ahorro: gastosPorTipo.ahorro || 0,
          gastos_reinversion: gastosPorTipo.reinversion || 0
        },
        indicadores: {
          margen_bruto_pct: margenBrutoPct,
          crecimiento_ventas_pct: crecimientoVentasPct,
          rotacion_inventario: rotacionInventario
        },
        reserva_seguridad: reservaSeguridad,
        disponible_para_reinvertir: disponibleParaReinvertir
      });
    } catch (error) {
      console.error('Error obteniendo resumen financiero mensual:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ---- Simulador ("ábaco invertido"): planeación de bloques por categoría,
  // comparada contra lo real, por día/semana/mes navegable ----

  const rangoPeriodoSimulador = (granularidad, periodoInicioStr) => {
    const inicio = moment(`${periodoInicioStr} 00:00:00-05:00`);
    let fin;
    if (granularidad === 'dia') {
      fin = inicio.clone().endOf('day');
    } else if (granularidad === 'semana') {
      fin = inicio.clone().add(6, 'days').endOf('day');
    } else {
      fin = inicio.clone().endOf('month');
    }
    return { inicio, fin };
  };

  // Fecha de inicio del período INMEDIATAMENTE anterior, misma granularidad
  // (un día antes / la semana antes / el mes calendario anterior) — para la
  // barra gris de referencia (mismo período pero anterior).
  const periodoAnteriorInicioSimulador = (granularidad, periodoInicioStr) => {
    const m = moment(periodoInicioStr, 'YYYY-MM-DD');
    if (granularidad === 'dia') return m.subtract(1, 'day').format('YYYY-MM-DD');
    if (granularidad === 'semana') return m.subtract(7, 'days').format('YYYY-MM-DD');
    return m.subtract(1, 'month').format('YYYY-MM-DD'); // ya es día 1, sigue siendo día 1
  };

  // 'semana' exige que periodo_inicio sea lunes (mismo criterio que
  // metas_reinversion.semana_inicio); 'mes' exige que sea el día 1.
  const validarPeriodoInicioSimulador = (granularidad, periodoInicioStr) => {
    if (typeof periodoInicioStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(periodoInicioStr)) return false;
    const m = moment(periodoInicioStr, 'YYYY-MM-DD', true);
    if (!m.isValid()) return false;
    if (granularidad === 'semana') return m.isoWeekday() === 1;
    if (granularidad === 'mes') return m.date() === 1;
    return true;
  };

  app.get('/api/finanzas-negocio/simulador', authenticateToken, requireAdmin, resolverNegocioAdmin, async (req, res) => {
    try {
      const negocioId = req.negocioId;
      const { granularidad, periodo_inicio } = req.query;

      if (!['dia', 'semana', 'mes'].includes(granularidad)) {
        return res.status(400).json({ error: "granularidad debe ser 'dia', 'semana' o 'mes'" });
      }
      if (!validarPeriodoInicioSimulador(granularidad, periodo_inicio)) {
        return res.status(400).json({
          error: granularidad === 'semana'
            ? 'periodo_inicio debe ser un lunes (YYYY-MM-DD)'
            : granularidad === 'mes'
              ? 'periodo_inicio debe ser el día 1 del mes (YYYY-MM-DD)'
              : 'periodo_inicio inválido'
        });
      }

      const { inicio, fin } = rangoPeriodoSimulador(granularidad, periodo_inicio);
      const periodoAnteriorInicio = periodoAnteriorInicioSimulador(granularidad, periodo_inicio);
      const { inicio: inicioAnterior, fin: finAnterior } = rangoPeriodoSimulador(granularidad, periodoAnteriorInicio);

      const configResult = await pool.query('SELECT valor_bloque FROM negocios WHERE id = $1', [negocioId]);
      const valorBloque = Number(configResult.rows[0]?.valor_bloque);
      if (!Number.isFinite(valorBloque) || valorBloque <= 0) {
        return res.status(400).json({ error: 'Configura primero el valor del bloque en Configuración' });
      }

      const modulosResult = await pool.query('SELECT id FROM modulos WHERE negocio_id = $1', [negocioId]);
      const moduloIds = modulosResult.rows.map(r => r.id);

      const categoriasResult = await pool.query(
        `SELECT id, nombre, tipo FROM categorias_gasto
       WHERE negocio_id = $1 AND activo = true AND mostrar_en_simulador = true
       ORDER BY nombre`,
        [negocioId]
      );

      const asignacionesResult = await pool.query(
        'SELECT categoria_gasto_id, bloques_asignados FROM simulador_asignaciones WHERE negocio_id = $1 AND granularidad = $2 AND periodo_inicio = $3',
        [negocioId, granularidad, periodo_inicio]
      );
      const asignacionesPorCategoria = Object.fromEntries(asignacionesResult.rows.map(r => [r.categoria_gasto_id, r.bloques_asignados]));

      // Ingresos reales + egresos reales por categoría de gasto EXACTA (mismo
      // id que etiqueta movimientos_caja en Finanzas por módulo), de un rango
      // de fechas puntual — se llama dos veces (período actual y el
      // inmediatamente anterior, misma granularidad) para la comparación
      // gris/verde-rojo/azul del ábaco.
      const montosRealesPeriodo = async (desde, hasta) => {
        const ingresosResult = await pool.query(
          `SELECT COALESCE(SUM(total), 0) as total FROM ventas
         WHERE modulo_id = ANY($1) AND fecha_venta BETWEEN $2 AND $3
         AND es_ajuste_manual = false AND metodo_pago != 'consumo_propio'`,
          [moduloIds, desde, hasta]
        );

        const egresosResult = await pool.query(
          `SELECT categoria_gasto_id, COALESCE(SUM(monto), 0) as total
         FROM movimientos_caja
         WHERE negocio_id = $1 AND tipo = 'egreso' AND categoria_gasto_id IS NOT NULL AND fecha BETWEEN $2 AND $3
         GROUP BY categoria_gasto_id`,
          [negocioId, desde, hasta]
        );

        return {
          ingresos: Number(ingresosResult.rows[0].total),
          egresosPorCategoriaId: Object.fromEntries(egresosResult.rows.map(r => [r.categoria_gasto_id, Number(r.total)]))
        };
      };

      const [actual, anterior] = await Promise.all([
        montosRealesPeriodo(inicio.toDate(), fin.toDate()),
        montosRealesPeriodo(inicioAnterior.toDate(), finAnterior.toDate())
      ]);

      // "Ventas" no es una categoria_gasto real (nada que etiquetar: es el
      // ingreso, no un egreso) — se sigue representando como una categoría
      // virtual de tipo 'ingreso' para que el ábaco (frontend) la muestre
      // arriba del eje X igual que antes.
      const categoriaIngresoVirtual = {
        id: 'ingreso',
        nombre: 'Ventas',
        tipo: 'ingreso',
        bloques_asignados: 0,
        monto_real: actual.ingresos,
        bloques_reales: actual.ingresos / valorBloque,
        monto_periodo_anterior: anterior.ingresos,
        bloques_periodo_anterior: anterior.ingresos / valorBloque
      };

      const categoriasGasto = categoriasResult.rows.map(cat => {
        const montoReal = actual.egresosPorCategoriaId[cat.id] || 0;
        const montoAnterior = anterior.egresosPorCategoriaId[cat.id] || 0;
        const bloquesAsignados = asignacionesPorCategoria[cat.id] || 0;
        return {
          id: cat.id,
          nombre: cat.nombre,
          tipo: cat.tipo,
          bloques_asignados: bloquesAsignados,
          monto_real: montoReal,
          bloques_reales: montoReal / valorBloque,
          monto_periodo_anterior: montoAnterior,
          bloques_periodo_anterior: montoAnterior / valorBloque
        };
      });

      const categorias = [categoriaIngresoVirtual, ...categoriasGasto];

      // El presupuesto de bloques para simular se basa en las ventas del
      // período ANTERIOR (ya cerrado), no en las del período actual — este
      // último todavía está en curso y sube en vivo, así que no sirve como
      // "cuánto tengo para planear" (mismo monto que ya se muestra en la
      // franja gris de referencia del ábaco).
      const totalBloquesIngresos = Math.round(anterior.ingresos / valorBloque);
      const totalBloquesAsignados = categoriasGasto.reduce((sum, c) => sum + c.bloques_asignados, 0);

      res.json({
        periodo: {
          granularidad,
          periodo_inicio,
          fecha_fin: fin.format('YYYY-MM-DD'),
          periodo_anterior_inicio: periodoAnteriorInicio,
          periodo_anterior_fin: finAnterior.format('YYYY-MM-DD')
        },
        valor_bloque: valorBloque,
        ingresos_reales: actual.ingresos,
        ingresos_periodo_anterior: anterior.ingresos,
        total_bloques_ingresos: totalBloquesIngresos,
        bloques_sin_asignar: totalBloquesIngresos - totalBloquesAsignados,
        categorias
      });
    } catch (error) {
      console.error('Error obteniendo simulador:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.put('/api/finanzas-negocio/simulador', authenticateToken, requireAdmin, resolverNegocioAdmin, async (req, res) => {
    try {
      const negocioId = req.negocioId;
      const { granularidad, periodo_inicio, asignaciones } = req.body;

      if (!['dia', 'semana', 'mes'].includes(granularidad)) {
        return res.status(400).json({ error: "granularidad debe ser 'dia', 'semana' o 'mes'" });
      }
      if (!validarPeriodoInicioSimulador(granularidad, periodo_inicio)) {
        return res.status(400).json({ error: 'periodo_inicio inválido para esa granularidad' });
      }
      if (!Array.isArray(asignaciones)) {
        return res.status(400).json({ error: 'asignaciones debe ser un arreglo' });
      }

      for (const a of asignaciones) {
        const categoriaId = parseInt(a.categoria_gasto_id, 10);
        const bloques = parseInt(a.bloques_asignados, 10);
        if (!Number.isInteger(categoriaId) || !Number.isInteger(bloques) || bloques < 0) {
          return res.status(400).json({ error: 'Cada asignación necesita categoria_gasto_id y bloques_asignados (entero >= 0)' });
        }

        const catCheck = await pool.query(
          'SELECT id FROM categorias_gasto WHERE id = $1 AND negocio_id = $2',
          [categoriaId, negocioId]
        );
        if (catCheck.rows.length === 0) {
          return res.status(400).json({ error: `La categoría ${categoriaId} no pertenece a este negocio` });
        }

        await pool.query(
          `INSERT INTO simulador_asignaciones (negocio_id, granularidad, periodo_inicio, categoria_gasto_id, bloques_asignados)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (negocio_id, granularidad, periodo_inicio, categoria_gasto_id)
         DO UPDATE SET bloques_asignados = $5`,
          [negocioId, granularidad, periodo_inicio, categoriaId, bloques]
        );
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error guardando asignaciones del simulador:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.post('/api/finanzas-negocio/simulador/reset', authenticateToken, requireAdmin, resolverNegocioAdmin, async (req, res) => {
    try {
      const negocioId = req.negocioId;
      const { granularidad, periodo_inicio } = req.body;

      if (!['dia', 'semana', 'mes'].includes(granularidad)) {
        return res.status(400).json({ error: "granularidad debe ser 'dia', 'semana' o 'mes'" });
      }
      if (!validarPeriodoInicioSimulador(granularidad, periodo_inicio)) {
        return res.status(400).json({ error: 'periodo_inicio inválido para esa granularidad' });
      }

      await pool.query(
        'DELETE FROM simulador_asignaciones WHERE negocio_id = $1 AND granularidad = $2 AND periodo_inicio = $3',
        [negocioId, granularidad, periodo_inicio]
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Error reiniciando el simulador:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Tendencia general del negocio (módulo activo): compara los últimos 30
  // días contra los 30 días inmediatamente anteriores en 3 factores —
  // ventas totales, margen bruto (ventas menos el costo de la mercancía
  // realmente vendida, usando productos.precio_compra) y ticket promedio —
  // y da una conclusión de si el negocio está creciendo, estable o
  // empeorando. Vive como card en la pestaña "Evolución" de
  // Estadisticas.jsx. El stock crítico se informa aparte, sin contar para
  // el puntaje: no hay snapshot histórico de stock_actual, así que no se
  // puede saber si estaba mejor o peor hace 30 días.
  app.get('/api/estadisticas/tendencia-negocio', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      const moduloId = req.moduloId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const finActual = ahoraColombia().endOf('day').toDate();
      const inicioActual = ahoraColombia().subtract(29, 'days').startOf('day').toDate();
      const duracionMs = finActual.getTime() - inicioActual.getTime();
      const finAnterior = new Date(inicioActual.getTime() - 1);
      const inicioAnterior = new Date(inicioActual.getTime() - duracionMs);

      const calcularPeriodo = async (inicio, fin) => {
        const ventasResult = await pool.query(
          `SELECT COUNT(*) as cantidad, COALESCE(SUM(total), 0) as monto
         FROM ventas
         WHERE modulo_id = $1 AND fecha_venta BETWEEN $2 AND $3
         AND es_ajuste_manual = false AND metodo_pago != 'consumo_propio'`,
          [moduloId, inicio, fin]
        );

        const margenResult = await pool.query(
          `SELECT COALESCE(SUM(dv.subtotal - dv.cantidad * COALESCE(p.precio_compra, 0)), 0) as margen
         FROM detalle_venta dv
         JOIN ventas v ON dv.venta_id = v.id
         JOIN productos p ON dv.producto_id = p.id
         WHERE v.modulo_id = $1 AND v.fecha_venta BETWEEN $2 AND $3
         AND v.es_ajuste_manual = false AND v.metodo_pago != 'consumo_propio'`,
          [moduloId, inicio, fin]
        );

        const ventasMonto = Number(ventasResult.rows[0].monto);
        const ventasCantidad = Number(ventasResult.rows[0].cantidad);

        return {
          ventasMonto,
          ventasCantidad,
          margen: Number(margenResult.rows[0].margen),
          ticketPromedio: ventasCantidad > 0 ? ventasMonto / ventasCantidad : null
        };
      };

      const actual = await calcularPeriodo(inicioActual, finActual);
      const anterior = await calcularPeriodo(inicioAnterior, finAnterior);

      const stockCriticoResult = await pool.query(
        `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE stock_actual = 0) as agotados
       FROM productos
       WHERE modulo_id = $1 AND activo = true AND ignora_stock = false AND stock_actual <= stock_minimo`,
        [moduloId]
      );

      // Cada factor compara % de cambio contra el período anterior. Sin
      // datos del período anterior (negocio nuevo, o módulo recién creado)
      // el % no tiene sentido — se marca null y ese factor no participa del
      // puntaje, en vez de mostrar un falso "+infinito%".
      const compararFactor = (actualVal, anteriorVal) => {
        if (anteriorVal === null || actualVal === null) return { cambioPorcentaje: null, puntaje: 0 };
        if (anteriorVal === 0) {
          // 0 en ambos períodos no es "0% de cambio" real — es que no hubo
          // actividad en ninguno de los dos, no hay tendencia que calcular.
          if (actualVal === 0) return { cambioPorcentaje: null, puntaje: 0 };
          return { cambioPorcentaje: null, puntaje: 1 }; // pasó de 0 a algo: mejora, pero no hay % real que mostrar
        }
        const cambioPorcentaje = ((actualVal - anteriorVal) / anteriorVal) * 100;
        let puntaje = 0;
        if (cambioPorcentaje > 5) puntaje = 1;
        else if (cambioPorcentaje < -5) puntaje = -1;
        return { cambioPorcentaje, puntaje };
      };

      const factorVentas = compararFactor(actual.ventasMonto, anterior.ventasMonto);
      const factorMargen = compararFactor(actual.margen, anterior.margen);
      const factorTicket = compararFactor(actual.ticketPromedio, anterior.ticketPromedio);

      const factoresConDatos = [factorVentas, factorMargen, factorTicket].filter(f => f.cambioPorcentaje !== null || f.puntaje !== 0);
      const puntajeTotal = factorVentas.puntaje + factorMargen.puntaje + factorTicket.puntaje;

      let conclusion = 'sin_datos';
      if (anterior.ventasCantidad > 0 || actual.ventasCantidad > 0) {
        if (puntajeTotal >= 2) conclusion = 'creciendo';
        else if (puntajeTotal <= -2) conclusion = 'empeorando';
        else conclusion = 'estable';
      }

      res.json({
        periodo: {
          inicio_actual: moment(inicioActual).utcOffset(-300).format('YYYY-MM-DD'),
          fin_actual: moment(finActual).utcOffset(-300).format('YYYY-MM-DD'),
          inicio_anterior: moment(inicioAnterior).utcOffset(-300).format('YYYY-MM-DD'),
          fin_anterior: moment(finAnterior).utcOffset(-300).format('YYYY-MM-DD')
        },
        conclusion,
        tieneDatosSuficientes: factoresConDatos.length > 0,
        factores: {
          ventas: { actual: actual.ventasMonto, anterior: anterior.ventasMonto, ...factorVentas },
          margen: { actual: actual.margen, anterior: anterior.margen, ...factorMargen },
          ticketPromedio: { actual: actual.ticketPromedio, anterior: anterior.ticketPromedio, ...factorTicket }
        },
        stockCritico: {
          total: Number(stockCriticoResult.rows[0].total),
          agotados: Number(stockCriticoResult.rows[0].agotados)
        }
      });
    } catch (error) {
      console.error('Error calculando tendencia del negocio:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Evolución de ventas período a período, SIN acumular — cada punto es lo
  // vendido EN ese bucket. A diferencia de evolucion-balance/egresos (que son
  // de todo el negocio, vía movimientos_caja), esta es del módulo activo
  // (req.moduloId), igual que el resto de las estadísticas de Estadísticas.jsx.
  app.get('/api/estadisticas/evolucion-ventas', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const { granularidad = 'semana', fecha_inicio, fecha_fin } = req.query;

      if (!moduloId) {
        return res.status(400).json({ error: 'Módulo no identificado' });
      }

      if (!['dia', 'semana', 'mes'].includes(granularidad)) {
        return res.status(400).json({ error: "granularidad debe ser 'dia', 'semana' o 'mes'" });
      }

      if ((fecha_inicio && !fecha_fin) || (!fecha_inicio && fecha_fin)) {
        return res.status(400).json({ error: 'fecha_inicio y fecha_fin deben venir juntas' });
      }

      let startDate, endDate;
      if (fecha_inicio && fecha_fin) {
        // Mismo anclaje explícito a -05:00 que el resto de Finanzas/Estadísticas.
        startDate = moment(`${fecha_inicio} 00:00:00-05:00`).toDate();
        endDate = moment(`${fecha_fin} 23:59:59-05:00`).toDate();
      } else {
        // Por defecto, "desde la venta más antigua de este módulo" hasta hoy
        // (mismo criterio que evolución-balance/egresos, pero a nivel módulo).
        const minResult = await pool.query(
          'SELECT MIN(fecha_venta) as min_fecha FROM ventas WHERE modulo_id = $1',
          [moduloId]
        );
        const minFecha = minResult.rows[0]?.min_fecha;
        if (!minFecha) {
          return res.json({ puntos: [] });
        }
        startDate = minFecha;
        endDate = ahoraColombia().endOf('day').toDate();
      }

      const ventasResult = await pool.query(
        `SELECT fecha_venta as fecha, total
       FROM ventas
       WHERE modulo_id = $1
       AND fecha_venta BETWEEN $2 AND $3
       AND es_ajuste_manual = false
       AND metodo_pago != 'consumo_propio'`,
        [moduloId, startDate, endDate]
      );

      const buckets = new Map();
      for (const venta of ventasResult.rows) {
        const clave = claveBucketColombia(venta.fecha, granularidad);
        const actual = buckets.get(clave) || { monto: 0, total_ventas: 0 };
        actual.monto += Number(venta.total);
        actual.total_ventas += 1;
        buckets.set(clave, actual);
      }

      const claves = generarClavesBucket(startDate, endDate, granularidad);
      const puntos = claves.map(clave => ({
        fecha: clave,
        ...(buckets.get(clave) || { monto: 0, total_ventas: 0 })
      }));

      res.json({ puntos });
    } catch (error) {
      console.error('Error obteniendo evolución de ventas:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  return {};
};
