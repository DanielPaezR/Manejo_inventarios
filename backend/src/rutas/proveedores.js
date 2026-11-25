// Rutas: Proveedores, su calendario, productos por proveedor y pedidos.
// Movidas desde server.js (secciones: RUTAS DE PROVEEDORES · CALENDARIO DE PROVEEDORES · RUTAS DE PRODUCTO-PROVEEDOR · RUTAS DE PEDIDOS).
// Reciben ctx con lo que server.js prepara (app, pool, middlewares, helpers)
// y lo que exportan los grupos registrados antes; devuelven lo que otros usan.
module.exports = function registrarRutas(ctx) {
  const {
    ahoraColombia, authenticateToken, checkAccess, app, pool, requirePermiso, planes
  } = ctx;

  // ==================== RUTAS DE PROVEEDORES ====================

  // Obtener todos los proveedores del módulo. Los proveedores son por
  // módulo (no por negocio): cada módulo tiene su propia lista, igual
  // criterio que se aplicó a clientes.
  app.get('/api/proveedores', authenticateToken, checkAccess, async (req, res) => {
    try {
      const moduloId = req.moduloId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const result = await pool.query(
        `SELECT p.*,
              array_agg(pp.producto_id) as productos_asociados
       FROM proveedores p
       LEFT JOIN producto_proveedor pp ON p.id = pp.proveedor_id AND pp.activo = true
       WHERE p.modulo_id = $1 AND p.activo = true
       GROUP BY p.id
       ORDER BY p.nombre`,
        [moduloId]
      );

      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo proveedores:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Crear nuevo proveedor
  app.post('/api/proveedores', authenticateToken, checkAccess, requirePermiso('proveedores'), async (req, res) => {
    let client;
    try {
      const negocioId = req.negocioId;
      const moduloId = req.moduloId;
      const { nombre, contacto, telefono, email, direccion, dias_entrega } = req.body;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      if (!nombre) {
        return res.status(400).json({ error: 'El nombre es requerido' });
      }

      // dias_entrega es opcional: null/'' es valido, pero si viene debe ser
      // un entero positivo (cada cuantos dias trae pedido el proveedor).
      let diasEntregaValor = null;
      if (dias_entrega !== undefined && dias_entrega !== null && dias_entrega !== '') {
        const diasEntregaStr = String(dias_entrega).trim();
        if (!/^\d+$/.test(diasEntregaStr) || parseInt(diasEntregaStr, 10) <= 0) {
          return res.status(400).json({ error: 'dias_entrega debe ser un entero positivo' });
        }
        diasEntregaValor = parseInt(diasEntregaStr, 10);
      }

      const calendario = validarCalendarioProveedor(req.body);
      if (calendario.error) {
        return res.status(400).json({ error: calendario.error });
      }

      // En una transacción: si falla el calendario, no queda el proveedor
      // creado a medias (y el usuario no lo crea repetido al reintentar).
      client = await pool.connect();
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO proveedores (negocio_id, modulo_id, nombre, contacto, telefono, email, direccion, dias_entrega)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
        [negocioId, moduloId, nombre, contacto, telefono, email, direccion, diasEntregaValor]
      );
      await guardarCalendarioProveedor(client, result.rows[0].id, moduloId, calendario.valores);
      await client.query('COMMIT');

      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('Error creando proveedor:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  // Actualizar proveedor
  app.put('/api/proveedores/:id', authenticateToken, checkAccess, requirePermiso('proveedores'), async (req, res) => {
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;
      const { nombre, contacto, telefono, email, direccion, activo, dias_entrega } = req.body;

      let diasEntregaValor = null;
      if (dias_entrega !== undefined && dias_entrega !== null && dias_entrega !== '') {
        const diasEntregaStr = String(dias_entrega).trim();
        if (!/^\d+$/.test(diasEntregaStr) || parseInt(diasEntregaStr, 10) <= 0) {
          return res.status(400).json({ error: 'dias_entrega debe ser un entero positivo' });
        }
        diasEntregaValor = parseInt(diasEntregaStr, 10);
      }

      // El calendario solo se toca si el formulario lo envía.
      const traeCalendario = 'calendario_modo' in req.body;
      const calendario = traeCalendario ? validarCalendarioProveedor(req.body) : null;
      if (calendario?.error) {
        return res.status(400).json({ error: calendario.error });
      }

      // Proveedores.jsx nunca envía `activo` en este formulario (solo existe
      // para desactivar vía DELETE, que usa otra ruta). Si no viene, pg lo
      // manda como NULL, y `activo = $6` directo dejaba el proveedor con
      // activo = NULL en cada edición — como GET /api/proveedores filtra
      // `activo = true`, el proveedor desaparecía de la lista sin borrarse.
      // COALESCE conserva el valor actual cuando no se envía nada.
      const result = await pool.query(
        `UPDATE proveedores
       SET nombre = $1,
           contacto = $2,
           telefono = $3,
           email = $4,
           direccion = $5,
           activo = COALESCE($6, activo),
           dias_entrega = $7
       WHERE id = $8 AND modulo_id = $9
       RETURNING *`,
        [nombre, contacto, telefono, email, direccion, activo, diasEntregaValor, id, moduloId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Proveedor no encontrado' });
      }
      if (traeCalendario) {
        await guardarCalendarioProveedor(pool, id, moduloId, calendario.valores);
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error actualizando proveedor:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Eliminar proveedor (desactivar)
  app.delete('/api/proveedores/:id', authenticateToken, checkAccess, requirePermiso('proveedores'), async (req, res) => {
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;

      await pool.query(
        'UPDATE proveedores SET activo = false WHERE id = $1 AND modulo_id = $2',
        [id, moduloId]
      );

      res.json({ message: 'Proveedor eliminado correctamente' });
    } catch (error) {
      console.error('Error eliminando proveedor:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ==================== CALENDARIO DE PROVEEDORES ====================
  // Cada proveedor tiene su forma real de pedir:
  // - 'fijo': se pide un día de la semana (dia_pedido, 1=lunes..7=domingo)
  //   cada frecuencia_semanas semanas y llega dias_hasta_llegada después.
  //   Con frecuencia > 1, fecha_ancla es un día de pedido conocido del ciclo.
  //   pide_en_sitio = no se manda pedido antes, se pide cuando llega.
  // - 'avisa': el proveedor avisa cuándo viene (proxima_visita); el pedido se
  //   manda antes de esa fecha. frecuencia_semanas es cada cuánto viene más o
  //   menos, para estimar cuánto debe durar el pedido.
  // - 'pausado': no se le pide por ahora.
  // Las fechas se manejan como 'YYYY-MM-DD' en hora de Colombia.

  const MODOS_CALENDARIO = ['fijo', 'avisa', 'pausado'];
  // Un pedido registrado hasta 2 días antes del día de pedido cuenta para ese ciclo.
  const MARGEN_PEDIDO_ANTICIPADO = 2;

  const sumarDiasFecha = (fecha, dias) => {
    const d = new Date(`${fecha}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  };
  const diasEntreFechas = (desde, hasta) =>
    Math.round((new Date(`${hasta}T00:00:00Z`) - new Date(`${desde}T00:00:00Z`)) / 86400000);
  const diaSemanaIso = (fecha) => new Date(`${fecha}T00:00:00Z`).getUTCDay() || 7;

  // fechasPedidos: fechas (Colombia) de pedidos no cancelados del proveedor.
  const calcularCalendarioProveedor = (prov, hoy, fechasPedidos) => {
    const pedidoDesde = (fecha) => fechasPedidos.some(f => f >= fecha);
    const ciclo = 7 * (prov.frecuencia_semanas || 1);

    if (!prov.calendario_modo) return { estado: 'sin_configurar' };
    if (prov.calendario_modo === 'pausado') return { estado: 'pausado' };

    if (prov.calendario_modo === 'avisa') {
      const visita = prov.proxima_visita && prov.proxima_visita >= hoy ? prov.proxima_visita : null;
      if (!visita) return { estado: 'esperando_aviso', dias_cobertura: ciclo };
      const hecho = pedidoDesde(prov.aviso_registrado || sumarDiasFecha(visita, -7));
      const pedirAntesDe = sumarDiasFecha(visita, -1) < hoy ? hoy : sumarDiasFecha(visita, -1);
      return {
        estado: hecho ? 'hecho' : (pedirAntesDe === hoy ? 'hoy' : 'proximo'),
        proximo_pedido: pedirAntesDe,
        llegada: visita,
        siguiente_llegada: sumarDiasFecha(visita, ciclo),
        dias_cobertura: Math.max(1, diasEntreFechas(hoy, visita) + ciclo)
      };
    }

    // 'fijo': día de pedido más reciente que ya llegó (c0) y el siguiente (c1).
    const espera = prov.dias_hasta_llegada || 0;
    const conObjetivo = (objetivo, estado) => {
      const siguienteLlegada = sumarDiasFecha(objetivo, ciclo + espera);
      return {
        estado,
        proximo_pedido: objetivo,
        llegada: sumarDiasFecha(objetivo, espera),
        siguiente_llegada: siguienteLlegada,
        // Días que debe durar lo que hay más lo que se pida ahora: hasta que
        // llegue el pedido del ciclo siguiente.
        dias_cobertura: Math.max(1, diasEntreFechas(hoy, siguienteLlegada))
      };
    };
    let c0;
    if (ciclo > 7 && prov.fecha_ancla) {
      const desdeAncla = diasEntreFechas(prov.fecha_ancla, hoy);
      // La fecha ancla es el primer pedido del calendario: antes de ella no
      // hay ciclos anteriores que se puedan haber pasado.
      if (desdeAncla < 0) {
        return conObjetivo(prov.fecha_ancla, pedidoDesde(sumarDiasFecha(prov.fecha_ancla, -MARGEN_PEDIDO_ANTICIPADO))
          ? 'hecho' : (desdeAncla === -1 ? 'manana' : 'proximo'));
      }
      c0 = sumarDiasFecha(prov.fecha_ancla, Math.floor(desdeAncla / ciclo) * ciclo);
    } else {
      c0 = sumarDiasFecha(hoy, -((diaSemanaIso(hoy) - prov.dia_pedido + 7) % 7));
    }
    const c1 = sumarDiasFecha(c0, ciclo);
    const hecho0 = pedidoDesde(sumarDiasFecha(c0, -MARGEN_PEDIDO_ANTICIPADO));
    const diasDesdeC0 = diasEntreFechas(c0, hoy);

    let objetivo;
    let estado;
    if (diasDesdeC0 <= espera && (hecho0 || diasDesdeC0 > 0)) {
      // El pedido del ciclo actual está en camino o se pasó el día de pedirlo
      // pero todavía no ha llegado (aún se puede pedir tarde).
      objetivo = c0;
      estado = hecho0 ? 'hecho' : 'atrasado';
    } else if (c0 === hoy) {
      objetivo = c0;
      estado = hecho0 ? 'hecho' : 'hoy';
    } else {
      objetivo = c1;
      const faltan = diasEntreFechas(hoy, c1);
      estado = pedidoDesde(sumarDiasFecha(c1, -MARGEN_PEDIDO_ANTICIPADO)) ? 'hecho' : (faltan === 1 ? 'manana' : 'proximo');
    }

    return conObjetivo(objetivo, estado);
  };

  const COLUMNAS_CALENDARIO = `p.calendario_modo, p.dia_pedido, p.dias_hasta_llegada, p.frecuencia_semanas, p.pide_en_sitio,
  to_char(p.fecha_ancla, 'YYYY-MM-DD') AS fecha_ancla,
  to_char(p.proxima_visita, 'YYYY-MM-DD') AS proxima_visita,
  to_char(p.aviso_registrado, 'YYYY-MM-DD') AS aviso_registrado`;

  // Fechas (en Colombia) de pedidos recientes no cancelados, por proveedor.
  const fechasPedidosPorProveedor = async (db, moduloId, proveedorId = null) => {
    const result = await db.query(
      `SELECT proveedor_id,
            to_char((fecha_pedido AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::date, 'YYYY-MM-DD') AS fecha
     FROM pedidos_proveedor
     WHERE modulo_id = $1 AND estado != 'cancelado'
     AND fecha_pedido > now() - interval '90 days'
     AND ($2::int IS NULL OR proveedor_id = $2)`,
      [moduloId, proveedorId]
    );
    const mapa = new Map();
    for (const fila of result.rows) {
      if (!mapa.has(fila.proveedor_id)) mapa.set(fila.proveedor_id, []);
      mapa.get(fila.proveedor_id).push(fila.fecha);
    }
    return mapa;
  };

  const calendarioDeProveedor = async (db, moduloId, proveedorId) => {
    const result = await db.query(
      `SELECT p.id, ${COLUMNAS_CALENDARIO} FROM proveedores p WHERE p.id = $1 AND p.modulo_id = $2`,
      [proveedorId, moduloId]
    );
    if (result.rows.length === 0) return null;
    const fechas = await fechasPedidosPorProveedor(db, moduloId, Number(proveedorId));
    return calcularCalendarioProveedor(result.rows[0], ahoraColombia().format('YYYY-MM-DD'), fechas.get(Number(proveedorId)) || []);
  };

  // Calendario de todos los proveedores activos de un módulo (lo usan los recordatorios).
  const calendarioDelModulo = async (moduloId) => {
    const hoy = ahoraColombia().format('YYYY-MM-DD');
    const [proveedores, fechas] = await Promise.all([
      pool.query(`SELECT p.id, p.nombre, ${COLUMNAS_CALENDARIO} FROM proveedores p WHERE p.modulo_id = $1 AND p.activo = true`, [moduloId]),
      fechasPedidosPorProveedor(pool, moduloId)
    ]);
    return proveedores.rows.map(p => ({ ...p, ...calcularCalendarioProveedor(p, hoy, fechas.get(p.id) || []) }));
  };

  const ORDEN_ESTADO_CALENDARIO = { atrasado: 0, hoy: 1, manana: 2, proximo: 3, esperando_aviso: 4, hecho: 5, sin_configurar: 6, pausado: 7 };

  app.get('/api/proveedores/calendario', authenticateToken, checkAccess, requirePermiso('proveedores'), planes.requierePlan(pool, 'proveedores'), async (req, res) => {
    try {
      const moduloId = req.moduloId;
      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const hoy = ahoraColombia().format('YYYY-MM-DD');
      const [proveedores, fechas] = await Promise.all([
        pool.query(
          `SELECT p.id, p.nombre, p.telefono, ${COLUMNAS_CALENDARIO}
         FROM proveedores p WHERE p.modulo_id = $1 AND p.activo = true`,
          [moduloId]
        ),
        fechasPedidosPorProveedor(pool, moduloId)
      ]);

      const calendario = proveedores.rows
        .map(p => ({ ...p, ...calcularCalendarioProveedor(p, hoy, fechas.get(p.id) || []) }))
        .sort((a, b) =>
          ORDEN_ESTADO_CALENDARIO[a.estado] - ORDEN_ESTADO_CALENDARIO[b.estado]
          || (a.proximo_pedido || '9').localeCompare(b.proximo_pedido || '9')
          || a.nombre.localeCompare(b.nombre));

      res.json({ hoy, proveedores: calendario });
    } catch (error) {
      console.error('Error obteniendo calendario de proveedores:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Valida los campos de calendario que vienen en el body del proveedor.
  const validarCalendarioProveedor = (body) => {
    const modo = body.calendario_modo || null;
    if (modo !== null && !MODOS_CALENDARIO.includes(modo)) return { error: 'Modo de calendario inválido' };
    const entero = (v, def) => (v === undefined || v === null || v === '' ? def : Number(v));
    const diaPedido = entero(body.dia_pedido, null);
    const espera = entero(body.dias_hasta_llegada, 0);
    const frecuencia = entero(body.frecuencia_semanas, 1);
    const fecha = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const ancla = fecha(body.fecha_ancla);

    if (!Number.isInteger(espera) || espera < 0 || espera > 60) return { error: 'Los días hasta que llega deben estar entre 0 y 60' };
    if (!Number.isInteger(frecuencia) || frecuencia < 1 || frecuencia > 8) return { error: 'La frecuencia debe estar entre 1 y 8 semanas' };
    if (modo === 'fijo') {
      if (!Number.isInteger(diaPedido) || diaPedido < 1 || diaPedido > 7) return { error: 'Elige el día de pedido' };
      if (frecuencia > 1 && !ancla) return { error: 'Indica la fecha del próximo pedido para saber en qué semana toca' };
      if (ancla && diaSemanaIso(ancla) !== diaPedido) return { error: 'La fecha del próximo pedido debe caer en el día de pedido elegido' };
    }
    return {
      valores: [modo, modo === 'fijo' ? diaPedido : null, espera, frecuencia, modo === 'fijo' && !!body.pide_en_sitio, modo === 'fijo' && frecuencia > 1 ? ancla : null]
    };
  };

  const guardarCalendarioProveedor = async (db, proveedorId, moduloId, valores) => {
    await db.query(
      `UPDATE proveedores
     SET calendario_modo = $1::varchar, dia_pedido = $2, dias_hasta_llegada = $3, frecuencia_semanas = $4,
         pide_en_sitio = $5, fecha_ancla = $6,
         proxima_visita = CASE WHEN $1::varchar = 'avisa' THEN proxima_visita ELSE NULL END
     WHERE id = $7 AND modulo_id = $8`,
      [...valores, proveedorId, moduloId]
    );
  };

  // Para proveedores que avisan cuándo vienen: registrar (o borrar) la fecha.
  app.put('/api/proveedores/:id/proxima-visita', authenticateToken, checkAccess, requirePermiso('proveedores'), planes.requierePlan(pool, 'proveedores'), async (req, res) => {
    try {
      const { fecha } = req.body;
      if (fecha !== null && fecha !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) {
        return res.status(400).json({ error: 'Fecha inválida' });
      }
      const result = await pool.query(
        `UPDATE proveedores SET proxima_visita = $1, aviso_registrado = CASE WHEN $1::date IS NULL THEN NULL ELSE $2::date END
       WHERE id = $3 AND modulo_id = $4 AND calendario_modo = 'avisa' RETURNING id`,
        [fecha || null, ahoraColombia().format('YYYY-MM-DD'), req.params.id, req.moduloId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Proveedor no encontrado o no es de los que avisan' });
      }
      res.json({ ok: true });
    } catch (error) {
      console.error('Error registrando próxima visita:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Sugerencia de cantidad a pedir por proveedor, basada en ventas históricas
  // y tiempo de entrega (producto_proveedor.tiempo_entrega_dias tiene
  // prioridad sobre proveedores.dias_entrega, que a su vez tiene prioridad
  // sobre el default de 3 días).
  // Cuánto se vendió de un producto en 4 semanas (burbuja del formulario de
  // productos). Disponible para quien pueda editar productos.
  app.get('/api/productos/:id/contexto', authenticateToken, checkAccess, requirePermiso('productos'), async (req, res) => {
    try {
      if (!/^\d+$/.test(req.params.id)) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }
      const { rows: [d] } = await pool.query(
        `SELECT COALESCE(SUM(dv.cantidad), 0) AS unidades_28
       FROM detalle_venta dv JOIN ventas v ON v.id = dv.venta_id
       JOIN productos p ON p.id = dv.producto_id AND p.modulo_id = $2
       WHERE dv.producto_id = $1 AND v.es_ajuste_manual = false
         AND v.fecha_venta >= NOW() - interval '28 days'`,
        [req.params.id, req.moduloId]);
      res.json({ unidades_28: Number(d.unidades_28) });
    } catch (error) {
      console.error('Error obteniendo contexto del producto:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Datos de contexto de un proveedor para las burbujas de Mis pedidos:
  // cuánto se le pide normalmente, cada cuánto y si hay pedidos en camino.
  app.get('/api/proveedores/:id/contexto', authenticateToken, checkAccess, requirePermiso('proveedores'), async (req, res) => {
    try {
      const { id } = req.params;
      if (!/^\d+$/.test(id)) {
        return res.status(404).json({ error: 'Proveedor no encontrado' });
      }
      const { rows: [datos] } = await pool.query(
        `WITH recibidos AS (
         SELECT pe.id, pe.total, pe.fecha_pedido,
                (SELECT COUNT(*) FROM pedido_detalle pd WHERE pd.pedido_id = pe.id) AS productos
         FROM pedidos_proveedor pe
         WHERE pe.proveedor_id = $1 AND pe.modulo_id = $2 AND pe.estado = 'recibido'
           AND pe.fecha_pedido >= NOW() - interval '90 days'
       )
       SELECT COUNT(*)::int AS pedidos,
              AVG(total) AS total_promedio,
              AVG(productos) AS productos_promedio,
              MIN(fecha_pedido) AS primero,
              MAX(fecha_pedido) AS ultimo,
              (SELECT total FROM recibidos ORDER BY fecha_pedido DESC LIMIT 1) AS ultimo_total,
              (SELECT COUNT(*)::int FROM pedidos_proveedor
               WHERE proveedor_id = $1 AND modulo_id = $2 AND estado IN ('pendiente', 'enviado')) AS en_camino
       FROM recibidos`,
        [id, req.moduloId]);
      const pedidos = datos.pedidos;
      res.json({
        pedidos_90: pedidos,
        total_promedio: Math.round(Number(datos.total_promedio) || 0),
        productos_promedio: Math.round(Number(datos.productos_promedio) || 0),
        cada_dias: pedidos > 1 ? Math.round((new Date(datos.ultimo) - new Date(datos.primero)) / 86400000 / (pedidos - 1)) : null,
        dias_desde_ultimo: datos.ultimo ? Math.floor((Date.now() - new Date(datos.ultimo).getTime()) / 86400000) : null,
        ultimo_total: Math.round(Number(datos.ultimo_total) || 0),
        en_camino: datos.en_camino
      });
    } catch (error) {
      console.error('Error obteniendo contexto del proveedor:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.get('/api/proveedores/:id/sugerencia-pedido', authenticateToken, checkAccess, requirePermiso('proveedores'), planes.requierePlan(pool, 'proveedores'), async (req, res) => {
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;
      const { dias_historial } = req.query;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const proveedorResult = await pool.query(
        'SELECT id, nombre, dias_entrega FROM proveedores WHERE id = $1 AND modulo_id = $2 AND activo = true',
        [id, moduloId]
      );

      if (proveedorResult.rows.length === 0) {
        return res.status(404).json({ error: 'Proveedor no encontrado' });
      }

      const proveedor = proveedorResult.rows[0];
      // Con calendario, el pedido debe alcanzar hasta que llegue el del ciclo
      // siguiente (no solo el tiempo de entrega).
      const calendario = await calendarioDeProveedor(pool, moduloId, id);
      const diasCobertura = calendario?.dias_cobertura || null;

      let diasHistorial = 30;
      if (dias_historial !== undefined) {
        const diasHistorialStr = String(dias_historial).trim();
        if (!/^\d+$/.test(diasHistorialStr) || parseInt(diasHistorialStr, 10) <= 0) {
          return res.status(400).json({ error: 'dias_historial debe ser un entero positivo' });
        }
        diasHistorial = parseInt(diasHistorialStr, 10);
      }

      const productosResult = await pool.query(
        `SELECT
          p.id, p.nombre, p.codigo_ean, p.stock_actual, p.stock_minimo,
          pp.tiempo_entrega_dias, pp.cantidad_minima_pedido, pp.precio_compra,
          pp.unidades_por_paquete, p.precio_compra AS precio_compra_producto
       FROM productos p
       JOIN producto_proveedor pp ON pp.producto_id = p.id
       WHERE pp.proveedor_id = $1
       AND pp.activo = true
       AND p.activo = true
       AND p.modulo_id = $2`,
        [id, moduloId]
      );

      // Cuánto se vende de cada producto (en cualquier módulo: el stock es uno
      // solo) en el periodo base y en las últimas 2 semanas, y cuánto se le
      // suele comprar a este proveedor. La sugerencia combina el ritmo base con
      // el reciente para seguir la tendencia sin exagerar una semana rara.
      const ids = productosResult.rows.map(p => p.id);
      const [ventasRows, comprasRows] = ids.length === 0 ? [[], []] : await Promise.all([
        pool.query(
          `SELECT dv.producto_id,
                COALESCE(SUM(dv.cantidad) FILTER (WHERE v.fecha_venta >= NOW() - ($2 || ' days')::interval), 0) AS base,
                COALESCE(SUM(dv.cantidad) FILTER (WHERE v.fecha_venta >= NOW() - interval '14 days'), 0) AS reciente
         FROM detalle_venta dv JOIN ventas v ON v.id = dv.venta_id
         WHERE dv.producto_id = ANY($1::int[])
           AND v.fecha_venta >= NOW() - (GREATEST($2::int, 14) || ' days')::interval
         GROUP BY dv.producto_id`,
          [ids, diasHistorial]).then(r => r.rows),
        pool.query(
          `SELECT pd.producto_id,
                COALESCE(SUM(pd.cantidad) FILTER (WHERE pe.fecha_pedido >= NOW() - interval '56 days'), 0) AS compradas_56,
                COUNT(*) FILTER (WHERE pe.fecha_pedido >= NOW() - interval '56 days')::int AS veces_56,
                (array_agg(pd.cantidad ORDER BY pe.fecha_pedido DESC))[1] AS ultima_cantidad,
                (array_agg(pd.precio_unitario ORDER BY pe.fecha_pedido DESC))[1] AS ultimo_precio
         FROM pedido_detalle pd JOIN pedidos_proveedor pe ON pe.id = pd.pedido_id
         WHERE pe.proveedor_id = $1 AND pe.estado = 'recibido' AND pd.producto_id = ANY($2::int[])
         GROUP BY pd.producto_id`,
          [id, ids]).then(r => r.rows)
      ]);
      const ventasPorProducto = new Map(ventasRows.map(r => [r.producto_id, r]));
      const comprasPorProducto = new Map(comprasRows.map(r => [r.producto_id, r]));

      const sugerencias = [];

      for (const producto of productosResult.rows) {
        const ventas = ventasPorProducto.get(producto.id) || { base: 0, reciente: 0 };
        const compras = comprasPorProducto.get(producto.id) || {};
        const ventasBaseSemana = Number(ventas.base) / (diasHistorial / 7);
        const ventasRecientesSemana = Number(ventas.reciente) / 2;
        // Ritmo esperado: 60% lo de las últimas 2 semanas, 40% lo habitual.
        const ritmoSemanal = ventasBaseSemana > 0 || ventasRecientesSemana > 0
          ? 0.6 * ventasRecientesSemana + 0.4 * ventasBaseSemana
          : 0;
        const tendencia = ventasBaseSemana > 0
          ? Math.round(((ventasRecientesSemana - ventasBaseSemana) / ventasBaseSemana) * 100)
          : null;

        const tiempoEntrega = diasCobertura || producto.tiempo_entrega_dias || proveedor.dias_entrega || 3;
        const consumoEsperado = ritmoSemanal * (tiempoEntrega / 7);
        const stockActual = Number(producto.stock_actual) || 0;
        let cantidadSugerida = Math.ceil(Math.max(0, consumoEsperado + (Number(producto.stock_minimo) || 0) - stockActual));

        // Respeta el mínimo de pedido del proveedor si existe
        if (producto.cantidad_minima_pedido && cantidadSugerida > 0 && cantidadSugerida < producto.cantidad_minima_pedido) {
          cantidadSugerida = producto.cantidad_minima_pedido;
        }

        const unidadesPorPaquete = producto.unidades_por_paquete || 1;
        const cantidadSugeridaPaquetes = Math.ceil(cantidadSugerida / unidadesPorPaquete);
        const costoUnitario = Number(producto.precio_compra) || Number(compras.ultimo_precio) || Number(producto.precio_compra_producto) || 0;

        sugerencias.push({
          producto_id: producto.id,
          nombre: producto.nombre,
          codigo_ean: producto.codigo_ean,
          stock_actual: producto.stock_actual,
          stock_minimo: producto.stock_minimo,
          ventas_por_semana: Math.round(ritmoSemanal * 10) / 10,
          ventas_base_semana: Math.round(ventasBaseSemana * 10) / 10,
          ventas_recientes_semana: Math.round(ventasRecientesSemana * 10) / 10,
          tendencia,
          compra_semanal_habitual: Math.round((Number(compras.compradas_56 || 0) / 8) * 10) / 10,
          ultima_cantidad: compras.ultima_cantidad !== undefined && compras.ultima_cantidad !== null ? Number(compras.ultima_cantidad) : null,
          dias_stock: ritmoSemanal > 0 ? Math.floor(stockActual / (ritmoSemanal / 7)) : null,
          costo_unitario: costoUnitario,
          tiempoEntrega,
          cantidad_sugerida: cantidadSugerida,
          cantidad_sugerida_paquetes: cantidadSugeridaPaquetes,
          unidades_por_paquete: unidadesPorPaquete
        });
      }

      sugerencias.sort((a, b) => b.cantidad_sugerida - a.cantidad_sugerida);

      res.json(sugerencias);
    } catch (error) {
      console.error('Error calculando sugerencia de pedido:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Detalle completo de los productos activos asociados a un proveedor
  // (nombre, EAN, precio del producto y los datos propios de la asociación).
  app.get('/api/proveedores/:id/productos-asociados', authenticateToken, checkAccess, async (req, res) => {
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const proveedorResult = await pool.query(
        'SELECT id FROM proveedores WHERE id = $1 AND modulo_id = $2 AND activo = true',
        [id, moduloId]
      );

      if (proveedorResult.rows.length === 0) {
        return res.status(404).json({ error: 'Proveedor no encontrado' });
      }

      const result = await pool.query(
        `SELECT p.id, p.nombre, p.codigo_ean, p.precio_compra as precio_compra_producto,
              pp.precio_compra, pp.tiempo_entrega_dias, pp.cantidad_minima_pedido,
              pp.unidades_por_paquete
       FROM producto_proveedor pp
       JOIN productos p ON pp.producto_id = p.id
       WHERE pp.proveedor_id = $1 AND pp.activo = true AND p.modulo_id = $2
       ORDER BY p.nombre`,
        [id, moduloId]
      );

      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo productos asociados al proveedor:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Asociar varios productos de una sola vez con un proveedor. Mismo upsert
  // que la ruta individual de abajo, pero en lote y dentro de una única
  // transacción: si algo falla, no queda la mitad asociada.
  app.post('/api/proveedores/:id/productos-bulk', authenticateToken, checkAccess, requirePermiso('proveedores'), async (req, res) => {
    // pool.connect() dentro del try: si la conexión falla, no debe quedar
    // como una promesa rechazada sin atrapar que tumbe todo el proceso.
    let client;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const { id } = req.params;
      const moduloId = req.moduloId;
      const { productos } = req.body;

      if (!moduloId) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      if (!Array.isArray(productos) || productos.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Se requiere un arreglo de productos' });
      }

      const proveedorResult = await client.query(
        'SELECT id, dias_entrega FROM proveedores WHERE id = $1 AND modulo_id = $2 AND activo = true',
        [id, moduloId]
      );

      if (proveedorResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Proveedor no encontrado' });
      }

      const proveedor = proveedorResult.rows[0];

      for (const item of productos) {
        const { producto_id } = item;

        if (!producto_id) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Cada producto requiere producto_id' });
        }

        // Cada producto debe pertenecer al mismo módulo/negocio que está
        // gestionando el proveedor (evita asociar productos ajenos).
        const productoResult = await client.query(
          'SELECT id, precio_compra FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true',
          [producto_id, moduloId]
        );

        if (productoResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: `Producto ${producto_id} no encontrado` });
        }

        const producto = productoResult.rows[0];

        let precioCompra = Number(item.precio_compra);
        if (!Number.isFinite(precioCompra) || precioCompra < 0) {
          precioCompra = producto.precio_compra;
        }

        let tiempoEntregaDias = parseInt(item.tiempo_entrega_dias, 10);
        if (!Number.isFinite(tiempoEntregaDias) || tiempoEntregaDias <= 0) {
          tiempoEntregaDias = proveedor.dias_entrega || 3;
        }

        let cantidadMinimaPedido = parseInt(item.cantidad_minima_pedido, 10);
        if (!Number.isFinite(cantidadMinimaPedido) || cantidadMinimaPedido <= 0) {
          cantidadMinimaPedido = 1;
        }

        let unidadesPorPaquete = parseInt(item.unidades_por_paquete, 10);
        if (!Number.isFinite(unidadesPorPaquete) || unidadesPorPaquete <= 0) {
          unidadesPorPaquete = 1;
        }

        await client.query(
          `INSERT INTO producto_proveedor (producto_id, proveedor_id, precio_compra, tiempo_entrega_dias, cantidad_minima_pedido, unidades_por_paquete)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (producto_id, proveedor_id)
         DO UPDATE SET precio_compra = $3, tiempo_entrega_dias = $4, cantidad_minima_pedido = $5, unidades_por_paquete = $6, activo = true`,
          [producto_id, id, precioCompra, tiempoEntregaDias, cantidadMinimaPedido, unidadesPorPaquete]
        );
      }

      await client.query('COMMIT');
      res.json({ asociados: productos.length });
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }
      console.error('Error asociando productos en lote:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  // ==================== RUTAS DE PRODUCTO-PROVEEDOR ====================

  // Asociar producto con proveedor
  app.post('/api/productos/:productoId/proveedores/:proveedorId', authenticateToken, checkAccess, requirePermiso('productos'), async (req, res) => {
    try {
      const { productoId, proveedorId } = req.params;
      const { precio_compra, tiempo_entrega_dias, cantidad_minima_pedido, unidades_por_paquete } = req.body;
      const moduloId = req.moduloId;

      // Verificar que el producto existe y pertenece al módulo
      const productoResult = await pool.query(
        'SELECT id FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true',
        [productoId, moduloId]
      );

      if (productoResult.rows.length === 0) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      // Verificar que el proveedor existe Y pertenece al mismo módulo (evita
      // asociar productos propios con proveedores de otro módulo/negocio)
      const proveedorResult = await pool.query(
        'SELECT id FROM proveedores WHERE id = $1 AND modulo_id = $2 AND activo = true',
        [proveedorId, moduloId]
      );

      if (proveedorResult.rows.length === 0) {
        return res.status(404).json({ error: 'Proveedor no encontrado' });
      }

      const unidadesPorPaquete = parseInt(unidades_por_paquete, 10) || 1;

      const result = await pool.query(
        `INSERT INTO producto_proveedor (producto_id, proveedor_id, precio_compra, tiempo_entrega_dias, cantidad_minima_pedido, unidades_por_paquete)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (producto_id, proveedor_id)
       DO UPDATE SET precio_compra = $3, tiempo_entrega_dias = $4, cantidad_minima_pedido = $5, unidades_por_paquete = $6, activo = true
       RETURNING *`,
        [productoId, proveedorId, precio_compra, tiempo_entrega_dias, cantidad_minima_pedido, unidadesPorPaquete]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error asociando producto con proveedor:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Desasociar producto de proveedor (soft delete, igual que el resto de la app)
  app.delete('/api/productos/:productoId/proveedores/:proveedorId', authenticateToken, checkAccess, requirePermiso('productos'), async (req, res) => {
    try {
      const { productoId, proveedorId } = req.params;
      const moduloId = req.moduloId;

      // Mismo chequeo que la asociación (POST), ahora también aquí: antes
      // esta ruta solo validaba el proveedor, no que productoId perteneciera
      // al módulo del usuario.
      const productoResult = await pool.query(
        'SELECT id FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true',
        [productoId, moduloId]
      );

      if (productoResult.rows.length === 0) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      const proveedorResult = await pool.query(
        'SELECT id FROM proveedores WHERE id = $1 AND modulo_id = $2 AND activo = true',
        [proveedorId, moduloId]
      );

      if (proveedorResult.rows.length === 0) {
        return res.status(404).json({ error: 'Proveedor no encontrado' });
      }

      await pool.query(
        'UPDATE producto_proveedor SET activo = false WHERE producto_id = $1 AND proveedor_id = $2',
        [productoId, proveedorId]
      );

      res.json({ message: 'Producto desasociado correctamente' });
    } catch (error) {
      console.error('Error desasociando producto de proveedor:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Obtener proveedores de un producto
  app.get('/api/productos/:productoId/proveedores', authenticateToken, checkAccess, async (req, res) => {
    try {
      const { productoId } = req.params;
      const moduloId = req.moduloId;

      // Verificar que el producto pertenece al módulo del usuario antes de
      // exponer sus proveedores (evita fuga de datos entre negocios)
      const productoResult = await pool.query(
        'SELECT id FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true',
        [productoId, moduloId]
      );

      if (productoResult.rows.length === 0) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      const result = await pool.query(
        `SELECT p.*,
              pp.precio_compra,
              pp.tiempo_entrega_dias,
              pp.cantidad_minima_pedido
       FROM proveedores p
       JOIN producto_proveedor pp ON p.id = pp.proveedor_id
       WHERE pp.producto_id = $1 AND pp.activo = true AND p.activo = true`,
        [productoId]
      );

      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo proveedores del producto:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ==================== RUTAS DE PEDIDOS ====================

  // Crear pedido a proveedor
  app.post('/api/pedidos', authenticateToken, checkAccess, requirePermiso('proveedores'), planes.requierePlan(pool, 'proveedores'), async (req, res) => {
    // pool.connect() dentro del try: si la conexión falla, no debe quedar
    // como una promesa rechazada sin atrapar que tumbe todo el proceso.
    let client;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const { proveedor_id, detalles, observaciones } = req.body;
      const moduloId = req.moduloId;
      const negocioId = req.negocioId;
      const usuarioId = req.user.id;

      if (!proveedor_id || !detalles || detalles.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Proveedor y detalles son requeridos' });
      }

      // Verificar que el proveedor existe y pertenece al mismo módulo
      const proveedorResult = await client.query(
        'SELECT id FROM proveedores WHERE id = $1 AND modulo_id = $2 AND activo = true',
        [proveedor_id, moduloId]
      );

      if (proveedorResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Proveedor no encontrado' });
      }

      // Calcular total
      let total = 0;
      for (const detalle of detalles) {
        const productoResult = await client.query(
          'SELECT precio_compra FROM productos WHERE id = $1 AND modulo_id = $2',
          [detalle.producto_id, moduloId]
        );
        
        if (productoResult.rows.length === 0) {
          throw new Error(`Producto ${detalle.producto_id} no encontrado`);
        }
        
        const precio = detalle.precio_unitario || productoResult.rows[0].precio_compra;
        total += precio * detalle.cantidad;
      }

      // Crear pedido
      const pedidoResult = await client.query(
        `INSERT INTO pedidos_proveedor 
       (negocio_id, modulo_id, proveedor_id, total, observaciones, usuario_id) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
        [negocioId, moduloId, proveedor_id, total, observaciones, usuarioId]
      );

      const pedido = pedidoResult.rows[0];

      // Crear detalles del pedido
      for (const detalle of detalles) {
        const productoResult = await client.query(
          'SELECT precio_compra FROM productos WHERE id = $1',
          [detalle.producto_id]
        );
        
        const precio = detalle.precio_unitario || productoResult.rows[0].precio_compra;
        const subtotal = precio * detalle.cantidad;
        
        await client.query(
          `INSERT INTO pedido_detalle (pedido_id, producto_id, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
          [pedido.id, detalle.producto_id, detalle.cantidad, precio, subtotal]
        );
      }

      await client.query('COMMIT');

      // Obtener el pedido completo con detalles
      const pedidoCompleto = await client.query(
        `SELECT p.*, 
              pr.nombre as proveedor_nombre,
              pr.telefono as proveedor_telefono,
              pr.contacto as proveedor_contacto,
              json_agg(
                json_build_object(
                  'producto_id', pd.producto_id,
                  'producto_nombre', prod.nombre,
                  'cantidad', pd.cantidad,
                  'precio_unitario', pd.precio_unitario,
                  'subtotal', pd.subtotal
                )
              ) as detalles
       FROM pedidos_proveedor p
       JOIN proveedores pr ON p.proveedor_id = pr.id
       LEFT JOIN pedido_detalle pd ON p.id = pd.pedido_id
       LEFT JOIN productos prod ON pd.producto_id = prod.id
       WHERE p.id = $1
       GROUP BY p.id, pr.id`,
        [pedido.id]
      );

      res.status(201).json(pedidoCompleto.rows[0]);

    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }
      console.error('Error creando pedido:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  // Cuántos pedidos hay en cada estado (para las pestañas de Mis pedidos).
  // Va antes de /api/pedidos/:id para que "conteos" no se tome como un id.
  app.get('/api/pedidos/conteos', authenticateToken, checkAccess, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT estado, COUNT(*)::int AS total FROM pedidos_proveedor WHERE modulo_id = $1 GROUP BY estado',
        [req.moduloId]
      );
      const conteos = { pendiente: 0, enviado: 0, recibido: 0, cancelado: 0 };
      for (const fila of result.rows) conteos[fila.estado] = fila.total;
      res.json(conteos);
    } catch (error) {
      console.error('Error contando pedidos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Obtener pedidos del módulo. ?estado=activos trae los que faltan por llegar
  // (pendientes y enviados). Cada pedido trae cuántos productos tiene y un
  // resumen corto para la lista.
  app.get('/api/pedidos', authenticateToken, checkAccess, async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const { estado } = req.query;
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);

      let query = `
      SELECT p.*,
             pr.nombre as proveedor_nombre,
             pr.telefono as proveedor_telefono,
             (SELECT COUNT(*)::int FROM pedido_detalle pd WHERE pd.pedido_id = p.id) AS num_productos,
             (SELECT string_agg(prod.nombre || ' x' || pd.cantidad, ', ' ORDER BY pd.id)
              FROM pedido_detalle pd JOIN productos prod ON prod.id = pd.producto_id
              WHERE pd.pedido_id = p.id) AS productos_resumen
      FROM pedidos_proveedor p
      JOIN proveedores pr ON p.proveedor_id = pr.id
      WHERE p.modulo_id = $1
    `;
      const params = [moduloId];

      if (estado === 'activos') {
        query += ` AND p.estado IN ('pendiente', 'enviado')`;
      } else if (estado) {
        params.push(estado);
        query += ` AND p.estado = $${params.length}`;
      }

      params.push(limit);
      query += ` ORDER BY p.fecha_pedido DESC LIMIT $${params.length}`;

      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo pedidos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Obtener pedido específico con detalles
  app.get('/api/pedidos/:id', authenticateToken, checkAccess, async (req, res) => {
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;

      const result = await pool.query(
        `SELECT p.*, 
              pr.nombre as proveedor_nombre,
              pr.telefono as proveedor_telefono,
              pr.contacto as proveedor_contacto,
              json_agg(
                json_build_object(
                  'producto_id', pd.producto_id,
                  'producto_nombre', prod.nombre,
                  'cantidad', pd.cantidad,
                  'precio_unitario', pd.precio_unitario,
                  'subtotal', pd.subtotal
                )
              ) as detalles
       FROM pedidos_proveedor p
       JOIN proveedores pr ON p.proveedor_id = pr.id
       LEFT JOIN pedido_detalle pd ON p.id = pd.pedido_id
       LEFT JOIN productos prod ON pd.producto_id = prod.id
       WHERE p.id = $1 AND p.modulo_id = $2
       GROUP BY p.id, pr.id`,
        [id, moduloId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error obteniendo pedido:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Editar los productos de un pedido antes de recibirlo (p. ej. el proveedor
  // no trajo algo): cambia cantidades o quita productos para que al marcarlo
  // "recibido" solo se sume al inventario lo que de verdad llegó.
  // Body: { detalles: [{ producto_id, cantidad }] } con la lista completa que
  // queda; los productos que no vengan (o con cantidad 0) se quitan.
  app.put('/api/pedidos/:id/detalles', authenticateToken, checkAccess, requirePermiso('proveedores'), planes.requierePlan(pool, 'proveedores'), async (req, res) => {
    let client;
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;
      const detalles = Array.isArray(req.body.detalles) ? req.body.detalles : null;
      if (!detalles) {
        return res.status(400).json({ error: 'Se requiere la lista de productos' });
      }
      const quedan = new Map();
      for (const d of detalles) {
        const productoId = Number(d.producto_id);
        const cantidad = Number(d.cantidad);
        if (!Number.isInteger(productoId) || !Number.isInteger(cantidad) || cantidad < 0) {
          return res.status(400).json({ error: 'Cantidad inválida' });
        }
        if (cantidad > 0) quedan.set(productoId, cantidad);
      }
      if (quedan.size === 0) {
        return res.status(400).json({ error: 'El pedido debe tener al menos un producto. Si no llegó nada, cancélalo.' });
      }

      client = await pool.connect();
      await client.query('BEGIN');
      const pedido = await client.query(
        'SELECT estado FROM pedidos_proveedor WHERE id = $1 AND modulo_id = $2 FOR UPDATE',
        [id, moduloId]
      );
      if (pedido.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }
      if (!['pendiente', 'enviado'].includes(pedido.rows[0].estado)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Solo se pueden editar pedidos que aún no se han recibido' });
      }

      // Solo se ajustan o quitan productos que ya estaban en el pedido.
      const actuales = await client.query('SELECT id, producto_id FROM pedido_detalle WHERE pedido_id = $1', [id]);
      for (const fila of actuales.rows) {
        const cantidad = quedan.get(fila.producto_id);
        if (cantidad) {
          await client.query(
            'UPDATE pedido_detalle SET cantidad = $1::int, subtotal = precio_unitario * $1::int WHERE id = $2',
            [cantidad, fila.id]
          );
        } else {
          await client.query('DELETE FROM pedido_detalle WHERE id = $1', [fila.id]);
        }
      }
      const restantes = await client.query('SELECT COUNT(*)::int AS n FROM pedido_detalle WHERE pedido_id = $1', [id]);
      if (restantes.rows[0].n === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'El pedido debe tener al menos un producto. Si no llegó nada, cancélalo.' });
      }
      await client.query(
        `UPDATE pedidos_proveedor
       SET total = (SELECT COALESCE(SUM(subtotal), 0) FROM pedido_detalle WHERE pedido_id = $1)
       WHERE id = $1`,
        [id]
      );
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('Error editando productos del pedido:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  // Burbuja al revisar un pedido: productos cuyo precio cambió frente al
  // último pedido recibido del mismo proveedor, y el total frente a lo normal.
  app.get('/api/pedidos/:id/comparacion', authenticateToken, checkAccess, requirePermiso('proveedores'), async (req, res) => {
    try {
      if (!/^\d+$/.test(req.params.id)) {
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }
      const { rows: [pedido] } = await pool.query(
        'SELECT id, proveedor_id, total, fecha_pedido FROM pedidos_proveedor WHERE id = $1 AND modulo_id = $2',
        [req.params.id, req.moduloId]);
      if (!pedido) {
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }
      const [{ rows: cambios }, { rows: [normal] }] = await Promise.all([
        pool.query(
          `SELECT p.nombre, pd.precio_unitario AS precio, anterior.precio_unitario AS precio_anterior
         FROM pedido_detalle pd
         JOIN productos p ON p.id = pd.producto_id
         JOIN LATERAL (
           SELECT pd2.precio_unitario
           FROM pedido_detalle pd2 JOIN pedidos_proveedor pe2 ON pe2.id = pd2.pedido_id
           WHERE pd2.producto_id = pd.producto_id AND pe2.proveedor_id = $2 AND pe2.estado = 'recibido'
             AND pe2.id <> $1 AND pe2.fecha_pedido < $3
           ORDER BY pe2.fecha_pedido DESC LIMIT 1
         ) anterior ON true
         WHERE pd.pedido_id = $1 AND anterior.precio_unitario > 0
           AND ABS(pd.precio_unitario - anterior.precio_unitario) >= 1
         ORDER BY (pd.precio_unitario - anterior.precio_unitario) DESC`,
          [pedido.id, pedido.proveedor_id, pedido.fecha_pedido]),
        pool.query(
          `SELECT AVG(total) AS promedio, COUNT(*)::int AS pedidos FROM pedidos_proveedor
         WHERE proveedor_id = $1 AND modulo_id = $2 AND estado = 'recibido' AND id <> $3
           AND fecha_pedido >= NOW() - interval '90 days'`,
          [pedido.proveedor_id, req.moduloId, pedido.id])
      ]);
      res.json({
        total: Math.round(Number(pedido.total)),
        total_promedio: normal.pedidos > 0 ? Math.round(Number(normal.promedio)) : null,
        cambios_precio: cambios.map(c => ({
          nombre: c.nombre.trim(),
          precio: Math.round(Number(c.precio)),
          precio_anterior: Math.round(Number(c.precio_anterior))
        }))
      });
    } catch (error) {
      console.error('Error comparando el pedido:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Actualizar estado del pedido. Al pasar a "recibido" suma al inventario lo
  // que tenga el pedido en ese momento, una sola vez (si ya estaba recibido no
  // vuelve a sumar), todo en una transacción.
  app.put('/api/pedidos/:id/estado', authenticateToken, checkAccess, requirePermiso('proveedores'), planes.requierePlan(pool, 'proveedores'), async (req, res) => {
    let client;
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;
      const { estado, fecha_entrega_estimada } = req.body;

      const estadosValidos = ['pendiente', 'enviado', 'recibido', 'cancelado'];
      if (!estadosValidos.includes(estado)) {
        return res.status(400).json({ error: 'Estado inválido' });
      }

      client = await pool.connect();
      await client.query('BEGIN');
      const anterior = await client.query(
        'SELECT estado FROM pedidos_proveedor WHERE id = $1 AND modulo_id = $2 FOR UPDATE',
        [id, moduloId]
      );
      if (anterior.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }
      if (anterior.rows[0].estado === 'recibido' && estado !== 'recibido') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Este pedido ya se recibió y su mercancía ya está en el inventario' });
      }

      const result = await client.query(
        `UPDATE pedidos_proveedor
       SET estado = $1,
           fecha_entrega_estimada = COALESCE($2, fecha_entrega_estimada)
       WHERE id = $3 AND modulo_id = $4
       RETURNING *`,
        [estado, fecha_entrega_estimada, id, moduloId]
      );

      if (estado === 'recibido' && anterior.rows[0].estado !== 'recibido') {
        const detalles = await client.query(
          'SELECT producto_id, cantidad FROM pedido_detalle WHERE pedido_id = $1',
          [id]
        );
        for (const detalle of detalles.rows) {
          await client.query(
            'UPDATE productos SET stock_actual = stock_actual + $1, fecha_actualizacion = NOW() WHERE id = $2',
            [detalle.cantidad, detalle.producto_id]
          );
        }
      }

      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('Error actualizando estado del pedido:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  return { calendarioDelModulo };
};
