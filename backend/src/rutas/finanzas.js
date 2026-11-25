// Rutas: Gastos, finanzas del módulo, bolsillos, cierre de caja y pagos fijos.
// Movidas desde server.js (secciones: RUTAS DE CATEGORÍAS DE GASTO · RUTAS DE FINANZAS · BOLSILLOS Y CUADRE DE CAJA · PAGOS FIJOS).
// Reciben ctx con lo que server.js prepara (app, pool, middlewares, helpers)
// y lo que exportan los grupos registrados antes; devuelven lo que otros usan.
module.exports = function registrarRutas(ctx) {
  const {
    ahoraColombia, authenticateToken, requireAdmin, checkAccess, BOLSILLOS_MANUALES, app, pool,
    esModuloPorDefecto, marcarPagoCruzadas, rangoCruzadas, planes, requirePermiso
  } = ctx;

  // ==================== RUTAS DE CATEGORÍAS DE GASTO ====================
  // Clasificación propia para egresos manuales (distinta del campo de texto
  // libre movimientos_caja.categoria, que sigue usándose tal cual, incluyendo
  // el marcador 'abono_credito').

  app.get('/api/categorias-gasto', authenticateToken, checkAccess, requirePermiso('finanzas'), async (req, res) => {
    try {
      const moduloId = req.moduloId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const result = await pool.query(
        'SELECT * FROM categorias_gasto WHERE modulo_id = $1 AND activo = true ORDER BY nombre',
        [moduloId]
      );

      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo categorías de gasto:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  const TIPOS_CATEGORIA_GASTO = ['mercancia', 'servicios', 'fijo', 'personal', 'ahorro', 'reinversion', 'otro'];

  app.post('/api/categorias-gasto', authenticateToken, checkAccess, requirePermiso('finanzas'), async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const { nombre, tipo } = req.body;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'El nombre es requerido' });
      }

      // tipo clasifica el gasto para el estado de resultados consolidado
      // (Finanzas del negocio) — 'otro' por defecto para no romper categorías
      // creadas antes de que existiera este campo.
      const tipoValor = tipo || 'otro';
      if (!TIPOS_CATEGORIA_GASTO.includes(tipoValor)) {
        return res.status(400).json({ error: `tipo debe ser uno de: ${TIPOS_CATEGORIA_GASTO.join(', ')}` });
      }

      // El UNIQUE(modulo_id, nombre) de la tabla incluye las inactivas, así
      // que validamos antes para responder con un mensaje claro en vez del
      // error crudo del constraint.
      const existente = await pool.query(
        'SELECT id FROM categorias_gasto WHERE modulo_id = $1 AND nombre = $2',
        [moduloId, nombre.trim()]
      );
      if (existente.rows.length > 0) {
        return res.status(400).json({ error: 'Ya existe una categoría de gasto con ese nombre' });
      }

      const result = await pool.query(
        'INSERT INTO categorias_gasto (negocio_id, modulo_id, nombre, tipo) VALUES ($1, $2, $3, $4) RETURNING *',
        [req.negocioId, moduloId, nombre.trim(), tipoValor]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error creando categoría de gasto:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.put('/api/categorias-gasto/:id', authenticateToken, checkAccess, requirePermiso('finanzas'), async (req, res) => {
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;
      const { nombre, tipo } = req.body;

      if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'El nombre es requerido' });
      }

      const tipoValor = tipo || 'otro';
      if (!TIPOS_CATEGORIA_GASTO.includes(tipoValor)) {
        return res.status(400).json({ error: `tipo debe ser uno de: ${TIPOS_CATEGORIA_GASTO.join(', ')}` });
      }

      const existente = await pool.query(
        'SELECT id FROM categorias_gasto WHERE modulo_id = $1 AND nombre = $2 AND id != $3',
        [moduloId, nombre.trim(), id]
      );
      if (existente.rows.length > 0) {
        return res.status(400).json({ error: 'Ya existe una categoría de gasto con ese nombre' });
      }

      const result = await pool.query(
        'UPDATE categorias_gasto SET nombre = $1, tipo = $2 WHERE id = $3 AND modulo_id = $4 RETURNING *',
        [nombre.trim(), tipoValor, id, moduloId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Categoría de gasto no encontrada' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error actualizando categoría de gasto:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Soft delete: los movimientos_caja que ya la usan conservan su
  // categoria_gasto_id, solo deja de ofrecerse para nuevos registros.
  app.delete('/api/categorias-gasto/:id', authenticateToken, checkAccess, requirePermiso('finanzas'), async (req, res) => {
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;

      await pool.query(
        'UPDATE categorias_gasto SET activo = false WHERE id = $1 AND modulo_id = $2',
        [id, moduloId]
      );

      res.json({ message: 'Categoría de gasto eliminada correctamente' });
    } catch (error) {
      console.error('Error eliminando categoría de gasto:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ==================== RUTAS DE FINANZAS ====================
  // Caja independiente por módulo (antes era del negocio completo). Los
  // ingresos por venta se insertan automáticamente dentro de la transacción
  // de POST /api/ventas (ahí no hay ambigüedad de precio ni de módulo). Los
  // egresos por pedido a proveedor YA NO se insertan solos al crear el
  // pedido: el precio calculado puede no coincidir con lo que realmente se
  // paga, y algunos proveedores entregan sin pedido formal previo. El
  // egreso se registra a mano desde POST /api/finanzas/movimientos cuando
  // efectivamente se paga, opcionalmente vinculado a un pedido existente
  // (pedido_id) para trazabilidad.

  // Registrar un movimiento manual (saldo inicial, ingreso o egreso)
  app.post('/api/finanzas/movimientos', authenticateToken, checkAccess, requirePermiso('finanzas'), async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const negocioId = req.negocioId;
      const usuarioId = req.user.id;
      const { tipo, monto, concepto, categoria, pedido_id, categoria_gasto_id, bolsillo } = req.body;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      // De qué bolsillo sale / a cuál entra. Opcional para no romper clientes
      // viejos; sin bolsillo queda "sin asignar".
      const bolsilloMov = bolsillo === undefined || bolsillo === null || bolsillo === '' ? null : bolsillo;
      if (bolsilloMov !== null && !BOLSILLOS_MANUALES.includes(bolsilloMov)) {
        return res.status(400).json({ error: 'bolsillo inválido' });
      }

      if (!['saldo_inicial', 'ingreso', 'egreso'].includes(tipo)) {
        return res.status(400).json({ error: "tipo debe ser 'saldo_inicial', 'ingreso' o 'egreso'" });
      }

      const montoNum = Number(monto);
      if (!Number.isFinite(montoNum) || montoNum <= 0) {
        return res.status(400).json({ error: 'monto debe ser un número mayor a cero' });
      }

      if (!concepto || !concepto.trim()) {
        return res.status(400).json({ error: 'El concepto es requerido' });
      }

      if (tipo === 'saldo_inicial') {
        const existente = await pool.query(
          "SELECT id FROM movimientos_caja WHERE modulo_id = $1 AND tipo = 'saldo_inicial'",
          [moduloId]
        );
        if (existente.rows.length > 0) {
          return res.status(400).json({ error: "Ya existe un saldo inicial registrado para este módulo, usa 'ingreso' o 'egreso' para ajustes" });
        }
      }

      // Vincular el egreso a un pedido existente es opcional, solo para
      // trazabilidad — el monto real lo decide el usuario, no tiene que
      // coincidir con el total calculado del pedido.
      let origen = 'manual';
      if (pedido_id !== undefined && pedido_id !== null && pedido_id !== '') {
        if (tipo !== 'egreso') {
          return res.status(400).json({ error: 'pedido_id solo puede vincularse a un movimiento de tipo egreso' });
        }

        const pedidoResult = await pool.query(
          'SELECT id FROM pedidos_proveedor WHERE id = $1 AND modulo_id = $2',
          [pedido_id, moduloId]
        );
        if (pedidoResult.rows.length === 0) {
          return res.status(404).json({ error: 'Pedido no encontrado' });
        }

        const yaRegistrado = await pool.query(
          "SELECT id FROM movimientos_caja WHERE pedido_id = $1 AND origen = 'pedido'",
          [pedido_id]
        );
        if (yaRegistrado.rows.length > 0) {
          return res.status(400).json({ error: 'Este pedido ya tiene un egreso registrado' });
        }

        origen = 'pedido';
      }

      // categoria_gasto_id es independiente de pedido_id: un egreso puede
      // tener uno, otro, ambos o ninguno.
      let categoriaGastoIdValida = null;
      if (categoria_gasto_id !== undefined && categoria_gasto_id !== null && categoria_gasto_id !== '') {
        if (tipo !== 'egreso') {
          return res.status(400).json({ error: 'categoria_gasto_id solo puede vincularse a un movimiento de tipo egreso' });
        }

        const categoriaResult = await pool.query(
          'SELECT id FROM categorias_gasto WHERE id = $1 AND modulo_id = $2',
          [categoria_gasto_id, moduloId]
        );
        if (categoriaResult.rows.length === 0) {
          return res.status(404).json({ error: 'Categoría de gasto no encontrada' });
        }

        categoriaGastoIdValida = categoria_gasto_id;
      }

      const result = await pool.query(
        `INSERT INTO movimientos_caja
       (negocio_id, modulo_id, tipo, origen, monto, concepto, categoria, pedido_id, usuario_id, categoria_gasto_id, bolsillo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
        [negocioId, moduloId, tipo, origen, montoNum, concepto.trim(), categoria || null, origen === 'pedido' ? pedido_id : null, usuarioId, categoriaGastoIdValida, bolsilloMov]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error registrando movimiento de caja:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Pedidos del módulo activo que aún no tienen un egreso registrado en
  // movimientos_caja (para vincular al pagarlos)
  app.get('/api/finanzas/pedidos-sin-registrar', authenticateToken, checkAccess, requirePermiso('finanzas'), async (req, res) => {
    try {
      const moduloId = req.moduloId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const result = await pool.query(
        `SELECT p.id, p.total, p.fecha_pedido, p.estado,
              pr.nombre as proveedor_nombre
       FROM pedidos_proveedor p
       JOIN proveedores pr ON p.proveedor_id = pr.id
       LEFT JOIN movimientos_caja mc ON mc.pedido_id = p.id AND mc.origen = 'pedido'
       WHERE p.modulo_id = $1 AND mc.id IS NULL
       ORDER BY p.fecha_pedido DESC`,
        [moduloId]
      );

      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo pedidos sin registrar:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Listar movimientos (automáticos de ventas + manuales, incluyendo egresos de pedido vinculados)
  app.get('/api/finanzas/movimientos', authenticateToken, checkAccess, requirePermiso('finanzas'), async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const { limit } = req.query;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      let limitNum = 50;
      if (limit !== undefined) {
        const limitStr = String(limit).trim();
        if (!/^\d+$/.test(limitStr) || parseInt(limitStr, 10) <= 0) {
          return res.status(400).json({ error: 'limit debe ser un entero positivo' });
        }
        limitNum = parseInt(limitStr, 10);
      }

      const result = await pool.query(
        `SELECT mc.*, u.nombre as usuario_nombre, cg.nombre as categoria_gasto_nombre
       FROM movimientos_caja mc
       LEFT JOIN usuarios u ON mc.usuario_id = u.id
       LEFT JOIN categorias_gasto cg ON mc.categoria_gasto_id = cg.id
       WHERE mc.modulo_id = $1
       ORDER BY mc.fecha DESC
       LIMIT $2`,
        [moduloId, limitNum]
      );

      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo movimientos de caja:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Balance actual y desglose
  app.get('/api/finanzas/balance', authenticateToken, checkAccess, requirePermiso('finanzas'), async (req, res) => {
    try {
      const moduloId = req.moduloId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      // Los ajustes del cuadre de caja (categoria = 'ajuste_cuadre') van en su
      // propia línea del desglose en vez de sumarse a ingresos/egresos
      // manuales, para que se vea cuánto se ha corregido por faltantes o
      // sobrantes de dinero.
      const result = await pool.query(
        `SELECT
          COALESCE(SUM(monto) FILTER (WHERE tipo IN ('saldo_inicial','ingreso')), 0)
          - COALESCE(SUM(monto) FILTER (WHERE tipo = 'egreso'), 0) as balance_actual,
          COALESCE(SUM(monto) FILTER (WHERE tipo = 'saldo_inicial'), 0) as saldo_inicial,
          COALESCE(SUM(monto) FILTER (WHERE tipo = 'ingreso' AND origen = 'manual' AND (categoria IS DISTINCT FROM 'abono_credito') AND (categoria IS DISTINCT FROM 'ajuste_cuadre')), 0) as ingresos_manuales,
          COALESCE(SUM(monto) FILTER (WHERE tipo = 'ingreso' AND origen = 'venta'), 0) as total_ventas,
          COALESCE(SUM(monto) FILTER (WHERE tipo = 'egreso' AND origen = 'pedido'), 0) as total_pedidos,
          COALESCE(SUM(monto) FILTER (WHERE tipo = 'egreso' AND origen = 'manual' AND (categoria IS DISTINCT FROM 'ajuste_cuadre')), 0) as egresos_manuales,
          COALESCE(SUM(monto) FILTER (WHERE origen = 'manual' AND categoria = 'abono_credito'), 0) as total_abonos_credito,
          COALESCE(SUM(monto) FILTER (WHERE categoria = 'ajuste_cuadre' AND tipo = 'ingreso'), 0)
          - COALESCE(SUM(monto) FILTER (WHERE categoria = 'ajuste_cuadre' AND tipo = 'egreso'), 0) as ajustes_cuadre
       FROM movimientos_caja
       WHERE modulo_id = $1`,
        [moduloId]
      );

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error obteniendo balance de caja:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ==================== BOLSILLOS Y CUADRE DE CAJA ====================
  // El dinero de cada módulo se lleva repartido en bolsillos (ver
  // BOLSILLOS arriba). Saldo de un bolsillo = sus movimientos_caja con signo
  // + traslados que le entran − traslados que le salen. Los traslados solo
  // mueven dinero de un bolsillo a otro: no son ingresos ni egresos, por eso
  // viven en su propia tabla y no tocan ningún reporte. Lo que no tiene
  // bolsillo (historia de antes de esto) queda como "sin asignar" hasta la
  // apertura, que lo reparte según el dinero contado de verdad.

  const calcularSaldosBolsillos = async (db, moduloId) => {
    const result = await db.query(
      `SELECT b AS bolsillo, SUM(m) AS saldo FROM (
       SELECT bolsillo AS b, CASE WHEN tipo = 'egreso' THEN -monto ELSE monto END AS m
       FROM movimientos_caja WHERE modulo_id = $1
       UNION ALL
       SELECT destino, monto FROM traslados_bolsillo WHERE modulo_id = $1
       UNION ALL
       SELECT origen, -monto FROM traslados_bolsillo WHERE modulo_id = $1
     ) x
     GROUP BY b`,
      [moduloId]
    );
    const saldos = { caja: 0, cartera: 0, nequi: 0, otros_modulos: 0, sin_asignar: 0 };
    for (const fila of result.rows) {
      saldos[fila.bolsillo ?? 'sin_asignar'] = Math.round(Number(fila.saldo) * 100) / 100;
    }
    return saldos;
  };

  const calcularSaldoModulo = async (db, moduloId) => {
    const result = await db.query(
      `SELECT COALESCE(SUM(monto) FILTER (WHERE tipo IN ('saldo_inicial','ingreso')), 0)
            - COALESCE(SUM(monto) FILTER (WHERE tipo = 'egreso'), 0) AS saldo
     FROM movimientos_caja WHERE modulo_id = $1`,
      [moduloId]
    );
    return Number(result.rows[0].saldo);
  };

  // La apertura se marca con una fila de cuadres_caja con bolsillo='apertura'.
  const bolsillosActivos = async (db, moduloId) => {
    const result = await db.query(
      `SELECT fecha FROM cuadres_caja WHERE modulo_id = $1 AND bolsillo = 'apertura' LIMIT 1`,
      [moduloId]
    );
    return result.rows[0]?.fecha || null;
  };

  // Lo vendido en el día de productos de otros módulos (lo que hay que
  // entregarles en el cierre). Solo aplica al módulo por defecto, que es el
  // único que puede marcar "pagado" en ventas cruzadas.
  const cruzadasDelDia = async (db, { negocioId, moduloId, fecha }) => {
    if (!(await esModuloPorDefecto(db, negocioId, moduloId))) return null;
    const apertura = await bolsillosActivos(db, moduloId);
    const detalle = await db.query(
      `SELECT m.nombre, SUM(dv.subtotal) AS monto
     FROM detalle_venta dv
     JOIN ventas v ON dv.venta_id = v.id
     JOIN modulos m ON m.id = dv.modulo_dueno_id
     WHERE v.modulo_id = $1 AND dv.modulo_dueno_id != $1
     AND v.fecha_venta BETWEEN $2 AND $3
     AND v.es_ajuste_manual = false AND v.metodo_pago != 'consumo_propio'
     GROUP BY m.nombre ORDER BY m.nombre`,
      [moduloId, ...rangoCruzadas(fecha, apertura)]
    );
    const pagado = await db.query(
      'SELECT pagado FROM ventas_cruzadas_pagos WHERE negocio_id = $1 AND fecha = $2',
      [negocioId, fecha]
    );
    const entregado = await db.query(
      `SELECT COALESCE(SUM(monto), 0) AS monto FROM traslados_bolsillo
     WHERE modulo_id = $1 AND tipo = 'pago_cruzada' AND ref_fecha = $2 AND destino = 'otros_modulos'`,
      [moduloId, fecha]
    );
    const modulos = detalle.rows.map(r => ({ nombre: r.nombre, monto: Number(r.monto) }));
    const total = modulos.reduce((s, m) => s + m.monto, 0);
    const yaEntregado = Number(entregado.rows[0].monto);
    const estaPagado = pagado.rows[0]?.pagado ?? false;
    return {
      fecha,
      modulos,
      total,
      pagado: estaPagado,
      entregado: yaEntregado,
      // Lo que falta entregar hoy, incluidas ventas hechas después de
      // marcar el día como pagado. Sin bolsillos abiertos, todo o nada.
      pendiente: apertura ? Math.max(0, total - yaEntregado) : (estaPagado ? 0 : total)
    };
  };

  const leerMonto = (valor, { permitirCero = false } = {}) => {
    if (valor === '' || valor === null || valor === undefined) return null;
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 0 || (!permitirCero && n === 0)) return null;
    return Math.round(n * 100) / 100;
  };

  app.get('/api/finanzas/bolsillos', authenticateToken, checkAccess, requirePermiso('finanzas'), planes.requierePlan(pool, 'finanzas'), async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const negocioId = req.negocioId;
      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const hoy = ahoraColombia().format('YYYY-MM-DD');
      const [saldos, apertura, cruzadas, ultimoCierre] = await Promise.all([
        calcularSaldosBolsillos(pool, moduloId),
        bolsillosActivos(pool, moduloId),
        cruzadasDelDia(pool, { negocioId, moduloId, fecha: hoy }),
        pool.query(
          `SELECT monto, concepto, fecha FROM traslados_bolsillo
         WHERE modulo_id = $1 AND tipo = 'cierre' ORDER BY fecha DESC LIMIT 1`,
          [moduloId]
        )
      ]);

      res.json({
        activo: !!apertura,
        fecha_apertura: apertura,
        saldos,
        total: Math.round(Object.values(saldos).reduce((s, v) => s + v, 0) * 100) / 100,
        cruzadas_hoy: cruzadas,
        ultimo_cierre: ultimoCierre.rows[0]
          ? { ...ultimoCierre.rows[0], monto: Number(ultimoCierre.rows[0].monto) }
          : null
      });
    } catch (error) {
      console.error('Error obteniendo bolsillos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Apertura (una sola vez por módulo): el dueño cuenta lo que hay de verdad
  // en caja (billetes + monedas), cartera y Nequi. La diferencia entre ese
  // total y lo que la app tenía queda como ajuste de cuadre, y luego todo
  // se reparte en los bolsillos.
  app.post('/api/finanzas/bolsillos/apertura', authenticateToken, checkAccess, requirePermiso('finanzas'), planes.requierePlan(pool, 'finanzas'), async (req, res) => {
    let client;
    try {
      const moduloId = req.moduloId;
      const negocioId = req.negocioId;
      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const reales = {};
      for (const b of BOLSILLOS_MANUALES) {
        const monto = leerMonto(req.body[b], { permitirCero: true });
        if (monto === null) {
          return res.status(400).json({ error: `Escribe cuánto hay en ${b} (puede ser 0)` });
        }
        reales[b] = monto;
      }

      client = await pool.connect();
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [700000 + Number(moduloId)]);

      if (await bolsillosActivos(client, moduloId)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Los bolsillos de este módulo ya fueron abiertos' });
      }

      // Se cuenta después de entregar lo de los otros módulos: lo de hoy
      // queda marcado como pagado y la cuenta con ellos arranca en cero.
      const hoy = ahoraColombia().format('YYYY-MM-DD');
      const cruzadas = await cruzadasDelDia(client, { negocioId, moduloId, fecha: hoy });
      if (cruzadas && !cruzadas.pagado && cruzadas.total > 0) {
        await marcarPagoCruzadas(client, { negocioId, moduloVendedorId: moduloId, fecha: hoy, pagado: true, usuarioId: req.user.id });
      }

      const saldos = await calcularSaldosBolsillos(client, moduloId);
      if (saldos.otros_modulos !== 0) {
        await client.query(
          `INSERT INTO traslados_bolsillo (negocio_id, modulo_id, origen, destino, monto, tipo, concepto, usuario_id)
         VALUES ($1, $2, $3, $4, $5, 'apertura', 'Apertura de bolsillos: cuenta con otros módulos en cero', $6)`,
          [negocioId, moduloId, saldos.otros_modulos > 0 ? 'otros_modulos' : null, saldos.otros_modulos > 0 ? null : 'otros_modulos',
            Math.abs(saldos.otros_modulos), req.user.id]
        );
        saldos.sin_asignar += saldos.otros_modulos;
        saldos.otros_modulos = 0;
      }
      const totalReal = BOLSILLOS_MANUALES.reduce((s, b) => s + reales[b], 0);
      const saldoARepartir = saldos.sin_asignar + BOLSILLOS_MANUALES.reduce((s, b) => s + saldos[b], 0);
      const ajuste = Math.round((totalReal - saldoARepartir) * 100) / 100;

      let movimientoId = null;
      if (ajuste !== 0) {
        const mov = await client.query(
          `INSERT INTO movimientos_caja (negocio_id, modulo_id, tipo, origen, monto, concepto, categoria, usuario_id)
         VALUES ($1, $2, $3, 'manual', $4, $5, 'ajuste_cuadre', $6)
         RETURNING id`,
          [negocioId, moduloId, ajuste > 0 ? 'ingreso' : 'egreso', Math.abs(ajuste),
            ajuste > 0 ? 'Apertura de bolsillos: sobrante' : 'Apertura de bolsillos: faltante', req.user.id]
        );
        movimientoId = mov.rows[0].id;
      }

      for (const b of BOLSILLOS_MANUALES) {
        const diferencia = Math.round((reales[b] - saldos[b]) * 100) / 100;
        if (diferencia === 0) continue;
        await client.query(
          `INSERT INTO traslados_bolsillo (negocio_id, modulo_id, origen, destino, monto, tipo, concepto, usuario_id)
         VALUES ($1, $2, $3, $4, $5, 'apertura', 'Apertura de bolsillos', $6)`,
          [negocioId, moduloId, diferencia > 0 ? null : b, diferencia > 0 ? b : null, Math.abs(diferencia), req.user.id]
        );
      }

      await client.query(
        `INSERT INTO cuadres_caja (negocio_id, modulo_id, saldo_app, saldo_real, diferencia, nota, movimiento_id, usuario_id, bolsillo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'apertura')`,
        [negocioId, moduloId, saldoARepartir, totalReal, ajuste,
          `Apertura: caja ${reales.caja}, cartera ${reales.cartera}, nequi ${reales.nequi}`, movimientoId, req.user.id]
      );

      await client.query('COMMIT');
      res.status(201).json({ ajuste, saldos: await calcularSaldosBolsillos(pool, moduloId) });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('Error en apertura de bolsillos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  // Cierre de la noche: se cuentan solo los billetes de la caja; lo que pasa
  // de la base se guarda en la cartera. Opcionalmente, en el mismo paso, se
  // entrega a los otros módulos lo vendido hoy de sus productos (y se marca
  // el día como pagado en ventas cruzadas).
  app.post('/api/finanzas/bolsillos/cierre', authenticateToken, checkAccess, requirePermiso('finanzas'), planes.requierePlan(pool, 'finanzas'), async (req, res) => {
    let client;
    try {
      const moduloId = req.moduloId;
      const negocioId = req.negocioId;
      const { entregar_cruzadas } = req.body;
      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const billetes = leerMonto(req.body.billetes, { permitirCero: true });
      const base = leerMonto(req.body.base, { permitirCero: true });
      if (billetes === null || base === null) {
        return res.status(400).json({ error: 'Escribe los billetes contados y la base' });
      }

      client = await pool.connect();
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [700000 + Number(moduloId)]);

      const hoy = ahoraColombia().format('YYYY-MM-DD');
      let entregado = 0;
      if (entregar_cruzadas) {
        const cruzadas = await cruzadasDelDia(client, { negocioId, moduloId, fecha: hoy });
        if (cruzadas && cruzadas.pendiente > 0) {
          const totalEntregado = await marcarPagoCruzadas(client, {
            negocioId, moduloVendedorId: moduloId, fecha: hoy, pagado: true, usuarioId: req.user.id, origenPago: 'caja'
          });
          entregado = totalEntregado - cruzadas.entregado;
        }
      }

      // Los billetes se cuentan después de sacar lo de los otros módulos.
      const excedente = Math.max(0, Math.round((billetes - base) * 100) / 100);
      if (excedente > 0) {
        await client.query(
          `INSERT INTO traslados_bolsillo (negocio_id, modulo_id, origen, destino, monto, tipo, concepto, ref_fecha, usuario_id)
         VALUES ($1, $2, 'caja', 'cartera', $3, 'cierre', $4, $5, $6)`,
          [negocioId, moduloId, excedente, `Cierre: billetes contados ${billetes}, base ${base}`, hoy, req.user.id]
        );
      }

      await client.query(
        'INSERT INTO cierres_caja_dia (modulo_id, fecha) VALUES ($1, $2) ON CONFLICT (modulo_id, fecha) DO UPDATE SET hecho_en = now()',
        [moduloId, hoy]
      );

      const saldos = await calcularSaldosBolsillos(client, moduloId);
      await client.query('COMMIT');

      res.status(201).json({
        excedente,
        entregado_otros_modulos: entregado,
        falta_para_base: Math.max(0, Math.round((base - billetes) * 100) / 100),
        // Lo que queda en caja fuera de los billetes de la base: si nada se
        // perdió, son las monedas.
        monedas_estimadas: Math.round((saldos.caja - Math.min(billetes, base)) * 100) / 100,
        saldos
      });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('Error en cierre de caja:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  // Mover dinero entre bolsillos: favores (me transfieren y entrego efectivo,
  // me dan efectivo y hago una recarga/transferencia), cambio de monedas,
  // guardar o sacar de Nequi... Si el favor deja una ganancia, entra como
  // ingreso real al bolsillo que recibe.
  const TIPOS_TRASLADO = ['traslado', 'favor', 'monedas'];

  app.post('/api/finanzas/bolsillos/traslados', authenticateToken, checkAccess, requirePermiso('finanzas'), planes.requierePlan(pool, 'finanzas'), async (req, res) => {
    let client;
    try {
      const moduloId = req.moduloId;
      const negocioId = req.negocioId;
      const { origen, destino, concepto } = req.body;
      const tipo = req.body.tipo || 'traslado';
      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }
      if (!BOLSILLOS_MANUALES.includes(origen) || !BOLSILLOS_MANUALES.includes(destino) || origen === destino) {
        return res.status(400).json({ error: 'Elige dos bolsillos distintos' });
      }
      if (!TIPOS_TRASLADO.includes(tipo)) {
        return res.status(400).json({ error: 'tipo inválido' });
      }
      const monto = leerMonto(req.body.monto);
      if (monto === null) {
        return res.status(400).json({ error: 'El monto debe ser mayor a cero' });
      }
      const ganancia = leerMonto(req.body.ganancia, { permitirCero: true }) || 0;

      client = await pool.connect();
      await client.query('BEGIN');

      let movimientoId = null;
      if (ganancia > 0) {
        const mov = await client.query(
          `INSERT INTO movimientos_caja (negocio_id, modulo_id, tipo, origen, monto, concepto, categoria, usuario_id, bolsillo)
         VALUES ($1, $2, 'ingreso', 'manual', $3, $4, 'comision_favor', $5, $6)
         RETURNING id`,
          [negocioId, moduloId, ganancia, `Ganancia: ${concepto?.trim() || 'favor'}`, req.user.id, destino]
        );
        movimientoId = mov.rows[0].id;
      }

      const result = await client.query(
        `INSERT INTO traslados_bolsillo (negocio_id, modulo_id, origen, destino, monto, tipo, concepto, usuario_id, movimiento_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
        [negocioId, moduloId, origen, destino, monto, tipo, concepto?.trim() || null, req.user.id, movimientoId]
      );

      await client.query('COMMIT');
      res.status(201).json({ ...result.rows[0], monto: Number(result.rows[0].monto) });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('Error registrando traslado:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  app.get('/api/finanzas/bolsillos/traslados', authenticateToken, checkAccess, requirePermiso('finanzas'), planes.requierePlan(pool, 'finanzas'), async (req, res) => {
    try {
      const moduloId = req.moduloId;
      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }
      // Los traslados de cada venta cruzada se omiten: son uno por venta y
      // ya se ven en Ventas cruzadas.
      const result = await pool.query(
        `SELECT t.id, t.origen, t.destino, t.monto, t.tipo, t.concepto, t.fecha,
              mc.monto AS ganancia, u.nombre AS usuario_nombre
       FROM traslados_bolsillo t
       LEFT JOIN movimientos_caja mc ON mc.id = t.movimiento_id
       LEFT JOIN usuarios u ON u.id = t.usuario_id
       WHERE t.modulo_id = $1 AND t.tipo != 'venta_cruzada'
       ORDER BY t.fecha DESC
       LIMIT 30`,
        [moduloId]
      );
      res.json(result.rows.map(r => ({
        ...r,
        monto: Number(r.monto),
        ganancia: r.ganancia === null ? null : Number(r.ganancia)
      })));
    } catch (error) {
      console.error('Error obteniendo traslados:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Deshacer un traslado hecho a mano (por si se registró mal). Los de
  // apertura, ventas cruzadas y pagos cruzados no se borran desde aquí.
  app.delete('/api/finanzas/bolsillos/traslados/:id', authenticateToken, checkAccess, requirePermiso('finanzas'), planes.requierePlan(pool, 'finanzas'), async (req, res) => {
    let client;
    try {
      const moduloId = req.moduloId;
      client = await pool.connect();
      await client.query('BEGIN');
      const result = await client.query(
        `DELETE FROM traslados_bolsillo
       WHERE id = $1 AND modulo_id = $2 AND tipo IN ('traslado','favor','monedas','cierre')
       RETURNING movimiento_id`,
        [req.params.id, moduloId]
      );
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Movimiento no encontrado o no se puede deshacer' });
      }
      if (result.rows[0].movimiento_id) {
        await client.query('DELETE FROM movimientos_caja WHERE id = $1 AND modulo_id = $2', [result.rows[0].movimiento_id, moduloId]);
      }
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('Error deshaciendo traslado:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  app.get('/api/finanzas/cuadres', authenticateToken, checkAccess, requirePermiso('finanzas'), planes.requierePlan(pool, 'finanzas'), async (req, res) => {
    try {
      const moduloId = req.moduloId;
      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const result = await pool.query(
        `SELECT c.id, c.saldo_app, c.saldo_real, c.diferencia, c.nota, c.fecha, c.bolsillo, u.nombre AS usuario_nombre
       FROM cuadres_caja c
       LEFT JOIN usuarios u ON u.id = c.usuario_id
       WHERE c.modulo_id = $1
       ORDER BY c.fecha DESC
       LIMIT 20`,
        [moduloId]
      );

      res.json(result.rows.map(r => ({
        ...r,
        saldo_app: Number(r.saldo_app),
        saldo_real: Number(r.saldo_real),
        diferencia: Number(r.diferencia)
      })));
    } catch (error) {
      console.error('Error obteniendo cuadres de caja:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Cuadre: se cuenta el dinero real y la diferencia con la app queda como
  // ajuste (faltante/sobrante). Con bolsillo, cuadra solo ese bolsillo; sin
  // él, el saldo total del módulo (antes de abrir bolsillos).
  app.post('/api/finanzas/cuadres', authenticateToken, checkAccess, requirePermiso('finanzas'), planes.requierePlan(pool, 'finanzas'), async (req, res) => {
    let client;
    try {
      const moduloId = req.moduloId;
      const negocioId = req.negocioId;
      const { saldo_real, nota } = req.body;
      const bolsillo = req.body.bolsillo || null;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }
      if (bolsillo !== null && !BOLSILLOS_MANUALES.includes(bolsillo)) {
        return res.status(400).json({ error: 'bolsillo inválido' });
      }

      const saldoReal = Number(saldo_real);
      if (saldo_real === '' || saldo_real === null || saldo_real === undefined || !Number.isFinite(saldoReal) || saldoReal < 0) {
        return res.status(400).json({ error: 'El dinero contado debe ser un número mayor o igual a cero' });
      }

      client = await pool.connect();
      await client.query('BEGIN');
      // Serializa cuadres simultáneos del mismo módulo: el saldo que se
      // compara debe ser el del momento exacto del registro.
      await client.query('SELECT pg_advisory_xact_lock($1)', [700000 + Number(moduloId)]);

      const saldoApp = bolsillo
        ? (await calcularSaldosBolsillos(client, moduloId))[bolsillo]
        : await calcularSaldoModulo(client, moduloId);
      const diferencia = Math.round((saldoReal - saldoApp) * 100) / 100;

      let movimientoId = null;
      if (diferencia !== 0) {
        const sobrante = diferencia > 0;
        const mov = await client.query(
          `INSERT INTO movimientos_caja (negocio_id, modulo_id, tipo, origen, monto, concepto, categoria, usuario_id, bolsillo)
         VALUES ($1, $2, $3, 'manual', $4, $5, 'ajuste_cuadre', $6, $7)
         RETURNING id`,
          [
            negocioId,
            moduloId,
            sobrante ? 'ingreso' : 'egreso',
            Math.abs(diferencia),
            `Cuadre${bolsillo ? ` de ${bolsillo}` : ' de caja'}: ${sobrante ? 'sobrante' : 'faltante'}`,
            req.user.id,
            bolsillo
          ]
        );
        movimientoId = mov.rows[0].id;
      }

      const cuadre = await client.query(
        `INSERT INTO cuadres_caja (negocio_id, modulo_id, saldo_app, saldo_real, diferencia, nota, movimiento_id, usuario_id, bolsillo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
        [negocioId, moduloId, saldoApp, saldoReal, diferencia, nota?.trim() || null, movimientoId, req.user.id, bolsillo]
      );

      await client.query('COMMIT');
      const c = cuadre.rows[0];
      res.status(201).json({
        ...c,
        saldo_app: Number(c.saldo_app),
        saldo_real: Number(c.saldo_real),
        diferencia: Number(c.diferencia)
      });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('Error registrando cuadre de caja:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  // ==================== PAGOS FIJOS ====================
  // Suscripciones y pagos que se repiten cada mes (Claude, Railway, Spotify,
  // plan de datos...). "Pagar" registra el egreso en su bolsillo y categoría;
  // el listado dice si ya se pagó este mes.

  app.get('/api/finanzas/pagos-fijos', authenticateToken, checkAccess, requirePermiso('finanzas'), planes.requierePlan(pool, 'finanzas'), async (req, res) => {
    try {
      const moduloId = req.moduloId;
      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }
      // Mismo criterio de fechas que el resto de filtros de Finanzas.
      const inicioMes = ahoraColombia().startOf('month').toDate();
      const result = await pool.query(
        `SELECT pf.id, pf.nombre, pf.monto, pf.dia_mes, pf.bolsillo, pf.categoria_gasto_id,
              cg.nombre AS categoria_nombre,
              ult.fecha AS ultimo_pago, ult.monto AS ultimo_monto,
              (ult.fecha >= $2) AS pagado_este_mes
       FROM pagos_fijos pf
       LEFT JOIN categorias_gasto cg ON cg.id = pf.categoria_gasto_id
       LEFT JOIN LATERAL (
         SELECT fecha, monto FROM movimientos_caja
         WHERE pago_fijo_id = pf.id ORDER BY fecha DESC LIMIT 1
       ) ult ON true
       WHERE pf.modulo_id = $1 AND pf.activo = true
       ORDER BY pf.dia_mes, pf.nombre`,
        [moduloId, inicioMes]
      );
      res.json(result.rows.map(r => ({
        ...r,
        monto: Number(r.monto),
        ultimo_monto: r.ultimo_monto === null ? null : Number(r.ultimo_monto),
        pagado_este_mes: r.pagado_este_mes === true
      })));
    } catch (error) {
      console.error('Error obteniendo pagos fijos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  const validarPagoFijo = async (body, moduloId) => {
    const nombre = body.nombre?.trim();
    if (!nombre) return { error: 'El nombre es requerido' };
    const monto = leerMonto(body.monto);
    if (monto === null) return { error: 'El monto debe ser mayor a cero' };
    const dia = Number(body.dia_mes);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) return { error: 'El día debe estar entre 1 y 31' };
    if (!BOLSILLOS_MANUALES.includes(body.bolsillo)) return { error: 'bolsillo inválido' };
    let categoria = null;
    if (body.categoria_gasto_id) {
      const cat = await pool.query('SELECT id FROM categorias_gasto WHERE id = $1 AND modulo_id = $2', [body.categoria_gasto_id, moduloId]);
      if (cat.rows.length === 0) return { error: 'Categoría de gasto no encontrada' };
      categoria = cat.rows[0].id;
    }
    return { valores: [nombre, monto, dia, body.bolsillo, categoria] };
  };

  app.post('/api/finanzas/pagos-fijos', authenticateToken, checkAccess, requirePermiso('finanzas'), planes.requierePlan(pool, 'finanzas'), async (req, res) => {
    try {
      const moduloId = req.moduloId;
      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }
      const { error, valores } = await validarPagoFijo(req.body, moduloId);
      if (error) return res.status(400).json({ error });
      const result = await pool.query(
        `INSERT INTO pagos_fijos (negocio_id, modulo_id, nombre, monto, dia_mes, bolsillo, categoria_gasto_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [req.negocioId, moduloId, ...valores]
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error creando pago fijo:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.put('/api/finanzas/pagos-fijos/:id', authenticateToken, checkAccess, requirePermiso('finanzas'), planes.requierePlan(pool, 'finanzas'), async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const { error, valores } = await validarPagoFijo(req.body, moduloId);
      if (error) return res.status(400).json({ error });
      const result = await pool.query(
        `UPDATE pagos_fijos SET nombre = $1, monto = $2, dia_mes = $3, bolsillo = $4, categoria_gasto_id = $5
       WHERE id = $6 AND modulo_id = $7 AND activo = true RETURNING *`,
        [...valores, req.params.id, moduloId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Pago fijo no encontrado' });
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error actualizando pago fijo:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.delete('/api/finanzas/pagos-fijos/:id', authenticateToken, checkAccess, requirePermiso('finanzas'), planes.requierePlan(pool, 'finanzas'), async (req, res) => {
    try {
      const result = await pool.query(
        'UPDATE pagos_fijos SET activo = false WHERE id = $1 AND modulo_id = $2 RETURNING id',
        [req.params.id, req.moduloId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Pago fijo no encontrado' });
      res.json({ ok: true });
    } catch (error) {
      console.error('Error eliminando pago fijo:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // El monto puede variar (ej. el dólar movió el precio de Claude): si viene
  // en el body se usa ese, si no el configurado.
  app.post('/api/finanzas/pagos-fijos/:id/pagar', authenticateToken, checkAccess, requirePermiso('finanzas'), planes.requierePlan(pool, 'finanzas'), async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const fijo = await pool.query(
        'SELECT * FROM pagos_fijos WHERE id = $1 AND modulo_id = $2 AND activo = true',
        [req.params.id, moduloId]
      );
      if (fijo.rows.length === 0) return res.status(404).json({ error: 'Pago fijo no encontrado' });
      const pf = fijo.rows[0];
      const monto = req.body.monto === undefined || req.body.monto === '' ? Number(pf.monto) : leerMonto(req.body.monto);
      if (monto === null) return res.status(400).json({ error: 'El monto debe ser mayor a cero' });

      const result = await pool.query(
        `INSERT INTO movimientos_caja
       (negocio_id, modulo_id, tipo, origen, monto, concepto, usuario_id, categoria_gasto_id, bolsillo, pago_fijo_id)
       VALUES ($1, $2, 'egreso', 'manual', $3, $4, $5, $6, $7, $8)
       RETURNING *`,
        [req.negocioId, moduloId, monto, pf.nombre, req.user.id, pf.categoria_gasto_id, pf.bolsillo, pf.id]
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error pagando pago fijo:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  return { bolsillosActivos };
};
