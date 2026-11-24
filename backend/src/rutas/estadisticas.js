// Rutas: Alertas, estadísticas, metas, resumen semanal, recordatorios, planes, bienvenida y copias de seguridad.
// Movidas desde server.js (secciones: RUTAS DE ALERTAS · RUTAS DE ESTADÍSTICAS).
// Reciben ctx con lo que server.js prepara (app, pool, middlewares, helpers)
// y lo que exportan los grupos registrados antes; devuelven lo que otros usan.
module.exports = function registrarRutas(ctx) {
  const {
    moment, ahoraColombia, authenticateToken, requireAdmin, requireSuperAdmin, checkAccess,
    construirResumen, construirAntesYAhora, metricasPeriodo, productosParaSimulador, mermas,
    ventasPorEquipo, clientesEnLinea, hoyRapido, miDia, enviarResumenModulo, planes, respaldos,
    estadoBienvenida, guardarBienvenida, TIPOS_RECORDATORIO, leerConfigRecordatorios, construirAviso,
    enviarRecordatorio, canalesDisponibles, normalizarTelefono, BOLSILLOS_MANUALES, app, pool
  } = ctx;
  // Definidos en grupos que se registran después: se buscan al usarlos.
  const bolsillosActivos = (...args) => ctx.bolsillosActivos(...args);
  const calendarioDelModulo = (...args) => ctx.calendarioDelModulo(...args);

  // ==================== RUTAS DE ALERTAS ====================

  app.get('/api/alertas/stock-bajo', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      const moduloId = req.moduloId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const result = await pool.query(
        `SELECT p.*, 
              (p.stock_actual <= p.stock_minimo) as necesita_reponer,
              CASE 
                WHEN p.stock_actual = 0 THEN 'Agotado'
                WHEN p.stock_actual <= p.stock_minimo THEN 'Bajo'
                ELSE 'Normal'
              END as estado_stock
       FROM productos p 
       WHERE p.stock_actual <= p.stock_minimo 
       AND p.activo = true 
       AND p.modulo_id = $1
       ORDER BY p.stock_actual ASC`,
        [moduloId]
      );
      
      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo alertas:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ==================== RUTAS DE ESTADÍSTICAS ====================

  // Resumen "contado" del negocio (pestaña Resumen de Estadísticas): cómo va,
  // qué requiere atención, proveedores, productos y horarios.
  app.get('/api/estadisticas/resumen', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      if (!req.moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }
      res.json(await construirResumen(pool, req.moduloId));
    } catch (error) {
      console.error('Error armando el resumen del negocio:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ---- Resumen semanal (lunes en la mañana, por push y luego WhatsApp) ----
  const verificarModuloPropio = (req, res) => {
    if (String(req.params.id) !== String(req.moduloId)) {
      res.status(403).json({ error: 'No tienes acceso a este módulo' });
      return false;
    }
    return true;
  };

  app.get('/api/modulos/:id/resumen-semanal', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      if (!verificarModuloPropio(req, res)) return;
      const [{ rows: [modulo] }, { rows: [push] }, { rows: envios }] = await Promise.all([
        pool.query('SELECT resumen_semanal FROM modulos WHERE id = $1', [req.moduloId]),
        pool.query(
          `SELECT COUNT(*)::int AS total FROM push_suscripciones ps
         JOIN usuarios u ON u.id = ps.usuario_id AND u.rol = 'admin' AND u.activo = true
         JOIN usuario_modulos um ON um.usuario_id = u.id AND um.modulo_id = $1`, [req.moduloId]),
        pool.query(
          'SELECT canal, ok, detalle, fecha FROM resumen_envios WHERE modulo_id = $1 ORDER BY fecha DESC LIMIT 5', [req.moduloId])
      ]);
      const config = modulo?.resumen_semanal || {};
      res.json({
        activo: config.activo !== false,
        push: config.push !== false,
        whatsapp: config.whatsapp || '',
        canales: canalesDisponibles(),
        dispositivos_push: push.total,
        envios
      });
    } catch (error) {
      console.error('Error leyendo el resumen semanal:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.put('/api/modulos/:id/resumen-semanal', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      if (!verificarModuloPropio(req, res)) return;
      const config = { activo: req.body.activo !== false, push: req.body.push !== false };
      if (req.body.whatsapp) {
        const telefono = normalizarTelefono(req.body.whatsapp);
        if (!telefono) {
          return res.status(400).json({ error: 'Escribe un celular colombiano válido, por ejemplo 3001234567' });
        }
        config.whatsapp = telefono;
      }
      await pool.query('UPDATE modulos SET resumen_semanal = $1::jsonb WHERE id = $2', [JSON.stringify(config), req.moduloId]);
      res.json(config);
    } catch (error) {
      console.error('Error guardando el resumen semanal:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Manda el resumen ya, para probar (aunque esta semana ya se haya enviado).
  app.post('/api/modulos/:id/resumen-semanal/probar', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      if (!verificarModuloPropio(req, res)) return;
      res.json(await enviarResumenModulo(pool, req.moduloId, { forzar: true }));
    } catch (error) {
      console.error('Error enviando resumen de prueba:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Metas de ventas/ganancia del módulo (las muestra el Resumen). Un valor
  // vacío o 0 quita esa meta.
  // ---- Copias de seguridad (solo super admin) ----
  app.get('/api/respaldos', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      res.json(await respaldos.listarRespaldos(pool));
    } catch (error) {
      console.error('Error listando copias:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.post('/api/respaldos', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      res.status(201).json(await respaldos.guardarRespaldo(pool, 'manual'));
    } catch (error) {
      console.error('Error creando copia:', error);
      res.status(500).json({ error: 'No se pudo crear la copia' });
    }
  });

  app.get('/api/respaldos/:id/descargar', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Copia no encontrada' });
      const r = await respaldos.leerRespaldo(pool, req.params.id);
      if (!r) return res.status(404).json({ error: 'Copia no encontrada' });
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', `attachment; filename="${respaldos.nombreArchivo(r.creado_en)}"`);
      res.send(r.datos);
    } catch (error) {
      console.error('Error descargando copia:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ---- Plan del negocio ----
  app.get('/api/mi-plan', authenticateToken, checkAccess, async (req, res) => {
    try {
      const { plan, uso } = await planes.usoDelNegocio(pool, req.negocioId);
      res.json({ plan, uso, funciones: planes.FUNCIONES });
    } catch (error) {
      console.error('Error leyendo el plan:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.get('/api/planes', authenticateToken, requireSuperAdmin, (req, res) => {
    res.json({ planes: planes.PLANES, funciones: planes.FUNCIONES });
  });

  app.put('/api/negocios/:id/plan', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const plan = req.body?.plan || null;
      if (plan !== null && !planes.PLANES[plan]) return res.status(400).json({ error: 'Plan no válido' });
      const { rows: [n] } = await pool.query('UPDATE negocios SET plan = $1 WHERE id = $2 RETURNING id, plan', [plan, req.params.id]);
      if (!n) return res.status(404).json({ error: 'Negocio no encontrado' });
      res.json(await planes.usoDelNegocio(pool, n.id));
    } catch (error) {
      console.error('Error cambiando el plan:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ---- Asistente de bienvenida (primeros pasos de un negocio nuevo) ----
  app.get('/api/bienvenida', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      const estado = await estadoBienvenida(pool, req.moduloId);
      if (!estado) return res.status(404).json({ error: 'Módulo no encontrado' });
      res.json(estado);
    } catch (error) {
      console.error('Error leyendo primeros pasos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.put('/api/bienvenida', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      await guardarBienvenida(pool, req.moduloId, req.body || {});
      res.json(await estadoBienvenida(pool, req.moduloId));
    } catch (error) {
      console.error('Error guardando primeros pasos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ---- Recordatorios (cierre de caja, pedidos a proveedores, pagos fijos) ----
  app.get('/api/modulos/:id/recordatorios', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      if (!verificarModuloPropio(req, res)) return;
      const [{ rows: [modulo] }, { rows: [push] }, { rows: envios }] = await Promise.all([
        pool.query('SELECT recordatorios FROM modulos WHERE id = $1', [req.moduloId]),
        pool.query(
          `SELECT COUNT(*)::int AS total FROM push_suscripciones ps
         JOIN usuarios u ON u.id = ps.usuario_id AND u.rol = 'admin' AND u.activo = true
         JOIN usuario_modulos um ON um.usuario_id = u.id AND um.modulo_id = $1`, [req.moduloId]),
        pool.query(
          `SELECT canal, ok, fecha FROM resumen_envios
         WHERE modulo_id = $1 AND canal LIKE 'recordatorio_%' ORDER BY fecha DESC LIMIT 5`, [req.moduloId])
      ]);
      res.json({
        ...leerConfigRecordatorios(modulo?.recordatorios),
        push_disponible: canalesDisponibles().push,
        dispositivos_push: push.total,
        envios
      });
    } catch (error) {
      console.error('Error leyendo recordatorios:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.put('/api/modulos/:id/recordatorios', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      if (!verificarModuloPropio(req, res)) return;
      const config = leerConfigRecordatorios(req.body);
      await pool.query('UPDATE modulos SET recordatorios = $1 WHERE id = $2', [JSON.stringify(config), req.moduloId]);
      res.json(config);
    } catch (error) {
      console.error('Error guardando recordatorios:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Vista previa / prueba: dice qué llegaría hoy y lo manda a los dispositivos.
  app.post('/api/modulos/:id/recordatorios/probar', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      if (!verificarModuloPropio(req, res)) return;
      const tipo = req.body?.tipo;
      if (!TIPOS_RECORDATORIO.includes(tipo)) return res.status(400).json({ error: 'Tipo de recordatorio no válido' });
      const aviso = await construirAviso(pool, req.moduloId, tipo, calendarioDelModulo);
      if (!aviso.titulo) return res.json({ enviado: false, motivo: aviso.motivo });
      res.json(await enviarRecordatorio(pool, req.moduloId, tipo, calendarioDelModulo, { forzar: true }));
    } catch (error) {
      console.error('Error probando recordatorio:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.put('/api/modulos/:id/metas', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      if (!verificarModuloPropio(req, res)) return;
      const metas = {};
      for (const clave of ['ventas_semana', 'ventas_mes', 'ganancia_mes']) {
        const valor = Math.round(Number(req.body[clave]));
        if (Number.isFinite(valor) && valor > 0 && valor < 1e12) metas[clave] = valor;
      }
      await pool.query('UPDATE modulos SET metas = $1::jsonb WHERE id = $2', [JSON.stringify(metas), req.moduloId]);
      res.json(metas);
    } catch (error) {
      console.error('Error guardando metas:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ---- Análisis adicionales de Estadísticas ----
  const rutaAnalisis = (ruta, construir) => {
    app.get(ruta, authenticateToken, checkAccess, requireAdmin, async (req, res) => {
      try {
        if (!req.moduloId) {
          return res.status(400).json({ error: 'Se requiere un módulo' });
        }
        res.json(await construir(req));
      } catch (error) {
        console.error(`Error en ${ruta}:`, error);
        res.status(500).json({ error: 'Error interno del servidor' });
      }
    });
  };

  rutaAnalisis('/api/estadisticas/productos-simulador', (req) => productosParaSimulador(pool, req.moduloId));
  rutaAnalisis('/api/estadisticas/mermas', (req) => mermas(pool, req.moduloId));
  rutaAnalisis('/api/estadisticas/equipo', (req) => ventasPorEquipo(pool, req.moduloId));
  rutaAnalisis('/api/estadisticas/clientes-en-linea', (req) => clientesEnLinea(pool, req.moduloId));
  rutaAnalisis('/api/estadisticas/hoy', (req) => hoyRapido(pool, req.moduloId));

  // Para todos (también trabajadores): mis ventas, podio y avance del equipo.
  app.get('/api/ventas/mi-dia', authenticateToken, checkAccess, async (req, res) => {
    try {
      if (!req.moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }
      res.json(await miDia(pool, req.moduloId, req.user.id));
    } catch (error) {
      console.error('Error en mi día de ventas:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Informe de un mes (para imprimir o guardar en PDF) comparado con el anterior.
  rutaAnalisis('/api/estadisticas/informe-mes', async (req) => {
    const hoy = ahoraColombia().format('YYYY-MM-DD');
    const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : hoy.slice(0, 7);
    const inicio = moment(`${mes}-01`, 'YYYY-MM-DD');
    const finMes = inicio.clone().endOf('month').format('YYYY-MM-DD');
    const fin = finMes < hoy ? finMes : hoy;
    const anteriorInicio = inicio.clone().subtract(1, 'month');
    const [actual, anterior, { rows: proveedores }] = await Promise.all([
      metricasPeriodo(pool, req.moduloId, inicio.format('YYYY-MM-DD'), fin),
      // Si el mes va en curso, se compara con los mismos días del mes anterior.
      metricasPeriodo(pool, req.moduloId, anteriorInicio.format('YYYY-MM-DD'),
        moment.min(anteriorInicio.clone().endOf('month'), anteriorInicio.clone().add(moment(fin).date() - 1, 'days')).format('YYYY-MM-DD')),
      pool.query(
        `SELECT pr.nombre, COUNT(*)::int AS pedidos, SUM(p.total) AS total
       FROM pedidos_proveedor p JOIN proveedores pr ON pr.id = p.proveedor_id
       WHERE p.modulo_id = $1 AND p.estado = 'recibido'
         AND (p.fecha_pedido AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::date BETWEEN $2::date AND $3::date
       GROUP BY pr.nombre ORDER BY total DESC`,
        [req.moduloId, inicio.format('YYYY-MM-DD'), fin])
    ]);
    return {
      mes,
      completo: finMes < hoy,
      actual,
      anterior,
      proveedores: proveedores.map(p => ({ nombre: p.nombre, pedidos: p.pedidos, total: Math.round(Number(p.total)) }))
    };
  });

  // Primeros 30 días con ventas contra los últimos 30 (pestaña "Antes y ahora").
  app.get('/api/estadisticas/antes-y-ahora', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      if (!req.moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }
      res.json(await construirAntesYAhora(pool, req.moduloId));
    } catch (error) {
      console.error('Error armando antes y ahora:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.get('/api/estadisticas', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const { periodo, fecha_inicio, fecha_fin } = req.query;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      let startDate, endDate;
      
      switch (periodo) {
        case 'hoy':
          startDate = ahoraColombia().startOf('day').toDate();
          endDate = ahoraColombia().endOf('day').toDate();
          break;
        case 'semana':
          startDate = ahoraColombia().subtract(7, 'days').startOf('day').toDate();
          endDate = ahoraColombia().endOf('day').toDate();
          break;
        case 'mes':
          startDate = ahoraColombia().subtract(30, 'days').startOf('day').toDate();
          endDate = ahoraColombia().endOf('day').toDate();
          break;
        case 'personalizado':
          if (!fecha_inicio || !fecha_fin) {
            return res.status(400).json({ error: 'Para período personalizado se requieren fecha_inicio y fecha_fin' });
          }
          // fecha_inicio/fecha_fin llegan como 'YYYY-MM-DD' sin hora ni zona;
          // se ancla explícitamente a -05:00 para que "el día completo" sea
          // el día completo en Colombia, sin importar la zona del proceso.
          startDate = moment(`${fecha_inicio} 00:00:00-05:00`).toDate();
          endDate = moment(`${fecha_fin} 23:59:59-05:00`).toDate();
          break;
        default:
          startDate = ahoraColombia().startOf('day').toDate();
          endDate = ahoraColombia().endOf('day').toDate();
      }

      // Período anterior equivalente (misma duración, inmediatamente antes
      // de startDate) para comparar el monto de ventas.
      const duracionMs = endDate.getTime() - startDate.getTime();
      const startDateAnterior = new Date(startDate.getTime() - duracionMs);
      const endDateAnterior = new Date(startDate.getTime() - 1);

      // Atribuido por dueño real del producto (dv.modulo_dueno_id), no por
      // quién hizo la venta (v.modulo_id) — si otro módulo vendió un
      // producto compartido tuyo, ese ingreso es tuyo, no de quien lo vendió
      // (ver GET /api/estadisticas/ventas-cruzadas para ese otro reporte).
      // "total" cuenta la venta como propia si tiene AL MENOS una línea tuya,
      // aunque la venta completa mezcle productos de varios dueños.
      const ventasPeriodo = await pool.query(
        `SELECT COUNT(DISTINCT v.id) as total, COALESCE(SUM(dv.subtotal), 0) as monto
       FROM detalle_venta dv
       JOIN ventas v ON dv.venta_id = v.id
       WHERE dv.modulo_dueno_id = $1
       AND v.fecha_venta BETWEEN $2 AND $3
       AND v.es_ajuste_manual = false
       AND v.metodo_pago != 'consumo_propio'`,
        [moduloId, startDate, endDate]
      );

      const productosStockBajo = await pool.query(
        `SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE stock_actual = 0) as agotados
       FROM productos
       WHERE stock_actual <= stock_minimo
       AND activo = true
       AND modulo_id = $1`,
        [moduloId]
      );

      const topProductos = await pool.query(
        `SELECT
          p.id,
          p.nombre,
          SUM(dv.cantidad) as total_vendido,
          SUM(dv.subtotal) as monto_total
       FROM detalle_venta dv
       JOIN productos p ON dv.producto_id = p.id
       JOIN ventas v ON dv.venta_id = v.id
       WHERE dv.modulo_dueno_id = $1
       AND v.fecha_venta BETWEEN $2 AND $3
       AND v.es_ajuste_manual = false
       AND v.metodo_pago != 'consumo_propio'
       GROUP BY p.id, p.nombre
       ORDER BY total_vendido DESC
       LIMIT 10`,
        [moduloId, startDate, endDate]
      );

      // Mismo ajuste UTC -> America/Bogota que ventasPorHora/ventasPorDiaSemana
      // (ver comentario debajo): sin esto, DATE(fecha_venta) trunca sobre el
      // día calendario UTC, no el de Colombia, y las ventas entre las 7pm y
      // medianoche en Bogotá (que en UTC ya caen en el día siguiente) se
      // contaban en el bucket del día equivocado. 'fecha' se devuelve como
      // texto 'YYYY-MM-DD' (no como date de Postgres) para que el frontend no
      // tenga que volver a interpretar una zona horaria al parsearla.
      const ventasPorDia = await pool.query(
        `SELECT
          to_char(v.fecha_venta AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') as fecha,
          COUNT(DISTINCT v.id) as cantidad,
          SUM(dv.subtotal) as total
       FROM detalle_venta dv
       JOIN ventas v ON dv.venta_id = v.id
       WHERE dv.modulo_dueno_id = $1
       AND v.fecha_venta BETWEEN $2 AND $3
       AND v.es_ajuste_manual = false
       AND v.metodo_pago != 'consumo_propio'
       GROUP BY 1
       ORDER BY fecha ASC`,
        [moduloId, startDate, endDate]
      );

      // fecha_venta se guarda como "timestamp without time zone" y la sesión
      // de Postgres está en UTC (confirmado con current_setting('TIMEZONE')),
      // así que para reportar hora/día del negocio en Colombia hay que
      // convertir explícitamente UTC -> America/Bogota antes de extraer.
      // El bucket por hora/dueño se arma en una subconsulta aparte (no un
      // LEFT JOIN directo a generate_series) para que una venta sin ninguna
      // línea de este dueño no cuente igual: si el LEFT JOIN a detalle_venta
      // fuera directo, v.id seguiría sin ser NULL aunque dv.modulo_dueno_id
      // no coincida, e inflaría total_ventas.
      const ventasPorHora = await pool.query(
        `SELECT h.hora,
              COALESCE(bucket.total_ventas, 0) as total_ventas,
              COALESCE(bucket.monto, 0) as monto
       FROM generate_series(0, 23) as h(hora)
       LEFT JOIN (
         SELECT
           EXTRACT(HOUR FROM v.fecha_venta AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') as hora,
           COUNT(DISTINCT v.id) as total_ventas,
           SUM(dv.subtotal) as monto
         FROM detalle_venta dv
         JOIN ventas v ON dv.venta_id = v.id
         WHERE dv.modulo_dueno_id = $1
         AND v.fecha_venta BETWEEN $2 AND $3
         AND v.es_ajuste_manual = false
         AND v.metodo_pago != 'consumo_propio'
         GROUP BY 1
       ) bucket ON bucket.hora = h.hora
       ORDER BY h.hora`,
        [moduloId, startDate, endDate]
      );

      // EXTRACT(DOW ...) devuelve 0=domingo, 1=lunes, ..., 6=sábado. Mismo
      // patrón de subconsulta que ventasPorHora, y por el mismo motivo.
      const ventasPorDiaSemana = await pool.query(
        `SELECT dia.numero,
              COALESCE(bucket.total_ventas, 0) as total_ventas,
              COALESCE(bucket.monto, 0) as monto
       FROM generate_series(0, 6) as dia(numero)
       LEFT JOIN (
         SELECT
           EXTRACT(DOW FROM v.fecha_venta AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') as numero,
           COUNT(DISTINCT v.id) as total_ventas,
           SUM(dv.subtotal) as monto
         FROM detalle_venta dv
         JOIN ventas v ON dv.venta_id = v.id
         WHERE dv.modulo_dueno_id = $1
         AND v.fecha_venta BETWEEN $2 AND $3
         AND v.es_ajuste_manual = false
         AND v.metodo_pago != 'consumo_propio'
         GROUP BY 1
       ) bucket ON bucket.numero = dia.numero
       ORDER BY dia.numero`,
        [moduloId, startDate, endDate]
      );

      const totalProductos = await pool.query(
        `SELECT COUNT(*) as total
       FROM productos
       WHERE activo = true
       AND modulo_id = $1`,
        [moduloId]
      );

      // Valor de la mercancía en existencia, a precio de venta (no de compra,
      // porque no todos los productos tienen precio_compra cargado de forma
      // confiable).
      const valorMercancia = await pool.query(
        `SELECT COALESCE(SUM(stock_actual * precio_venta), 0) as total
       FROM productos
       WHERE activo = true
       AND modulo_id = $1`,
        [moduloId]
      );

      const metodoPagoPopular = await pool.query(
        `SELECT
          metodo_pago,
          COUNT(*) as cantidad,
          SUM(total) as monto_total
       FROM ventas
       WHERE modulo_id = $1
       AND fecha_venta BETWEEN $2 AND $3
       AND es_ajuste_manual = false
       AND metodo_pago != 'consumo_propio'
       GROUP BY metodo_pago
       ORDER BY cantidad DESC
       LIMIT 1`,
        [moduloId, startDate, endDate]
      );

      // Productos activos sin ninguna venta en el período actual. Antes exigía
      // "v.modulo_id = $1" (que la venta COMPLETA fuera de este módulo) — un
      // producto compartido vendido desde otro módulo quedaba marcado "sin
      // venta" aunque sí se hubiera vendido. Ahora exige dv.modulo_dueno_id,
      // que es lo que realmente importa: si es tuyo, no importa quién lo vendió.
      const productosSinVenta = await pool.query(
        `SELECT p.id, p.nombre, p.stock_actual, c.nombre as categoria_nombre
       FROM productos p
       LEFT JOIN categorias c ON p.categoria_id = c.id
       WHERE p.activo = true AND p.modulo_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM detalle_venta dv
         JOIN ventas v ON dv.venta_id = v.id
         WHERE dv.producto_id = p.id
         AND dv.modulo_dueno_id = $1
         AND v.fecha_venta BETWEEN $2 AND $3
         AND v.es_ajuste_manual = false
         AND v.metodo_pago != 'consumo_propio'
       )
       ORDER BY p.nombre
       LIMIT 20`,
        [moduloId, startDate, endDate]
      );

      // Ventas del período anterior equivalente, para comparar. Mismo criterio
      // de atribución por dueño que ventasPeriodo.
      const ventasPeriodoAnterior = await pool.query(
        `SELECT COUNT(DISTINCT v.id) as total, COALESCE(SUM(dv.subtotal), 0) as monto
       FROM detalle_venta dv
       JOIN ventas v ON dv.venta_id = v.id
       WHERE dv.modulo_dueno_id = $1
       AND v.fecha_venta BETWEEN $2 AND $3
       AND v.es_ajuste_manual = false
       AND v.metodo_pago != 'consumo_propio'`,
        [moduloId, startDateAnterior, endDateAnterior]
      );

      const montoAnterior = Number(ventasPeriodoAnterior.rows[0]?.monto || 0);
      const montoActual = Number(ventasPeriodo.rows[0]?.monto || 0);
      // null si el período anterior no tuvo ventas, para evitar división por
      // cero y para que el frontend sepa que no hay base de comparación
      // (negocio nuevo, período personalizado sin datos previos, etc.)
      const cambioMontoPct = montoAnterior > 0
        ? ((montoActual - montoAnterior) / montoAnterior) * 100
        : null;

      const response = {
        ventasPeriodo: ventasPeriodo.rows[0] || { total: 0, monto: 0 },
        productosStockBajo: productosStockBajo.rows[0] || { total: 0, agotados: 0 },
        topProductos: topProductos.rows,
        productosSinVenta: productosSinVenta.rows,
        ventasPorDia: ventasPorDia.rows,
        ventasPorHora: ventasPorHora.rows,
        ventasPorDiaSemana: ventasPorDiaSemana.rows,
        totalProductos: totalProductos.rows[0]?.total || 0,
        valor_mercancia: Number(valorMercancia.rows[0]?.total || 0),
        metodoPagoPopular: metodoPagoPopular.rows[0] || null,
        comparacionPeriodoAnterior: {
          monto: ventasPeriodoAnterior.rows[0]?.monto || 0,
          total: ventasPeriodoAnterior.rows[0]?.total || 0,
          cambioMontoPct
        },
        periodoInfo: {
          tipo: periodo || 'hoy',
          fecha_inicio: moment(startDate).utcOffset(-300).format('YYYY-MM-DD'),
          fecha_fin: moment(endDate).utcOffset(-300).format('YYYY-MM-DD'),
          dias: moment(endDate).diff(moment(startDate), 'days') + 1
        }
      };

      res.json(response);
    } catch (error) {
      console.error('Error obteniendo estadísticas:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Ventas cruzadas entre módulos: cuando un producto compartido se vende
  // desde un módulo distinto al dueño, la factura queda a nombre de quien
  // vendió (su numeración, su caja), pero el dueño necesita saber cuánto le
  // vendieron para poder liquidarlo. Dos direcciones sobre el módulo activo:
  // - como_dueno: de MIS productos, cuánto vendieron OTROS módulos.
  // - como_vendedor: de lo que YO vendí, cuánto era de OTROS dueños.
  // Mismo patrón de resolución de período que GET /api/estadisticas.
  // Convierte las filas planas (una por módulo+producto) en una lista por
  // módulo con su total y el desglose de productos anidado — mismo criterio
  // para como_dueno y como_vendedor.
  const agruparCruzadasPorModulo = (rows) => {
    const porModulo = new Map();
    for (const r of rows) {
      const unidades = Number(r.unidades);
      const monto = Number(r.monto);
      if (!porModulo.has(r.modulo_id)) {
        porModulo.set(r.modulo_id, { modulo_id: r.modulo_id, modulo_nombre: r.modulo_nombre, unidades: 0, monto: 0, productos: [] });
      }
      const grupo = porModulo.get(r.modulo_id);
      grupo.unidades += unidades;
      grupo.monto += monto;
      grupo.productos.push({ producto_id: r.producto_id, producto_nombre: r.producto_nombre, unidades, monto });
    }
    return Array.from(porModulo.values())
      .map(g => ({ ...g, productos: g.productos.sort((a, b) => b.monto - a.monto) }))
      .sort((a, b) => b.monto - a.monto);
  };

  app.get('/api/estadisticas/ventas-cruzadas', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const negocioId = req.negocioId;
      const { periodo, fecha_inicio, fecha_fin } = req.query;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      let startDate, endDate;
      // Solo se puede "marcar como pagado" un día calendario puntual, no un
      // rango — se calcula aquí para 'hoy' (siempre un solo día) y para
      // 'personalizado' cuando fecha_inicio y fecha_fin coinciden (como
      // cuando se navega día a día desde el filtro "Hoy" del frontend).
      let diaUnico = null;

      switch (periodo) {
        case 'hoy':
          startDate = ahoraColombia().startOf('day').toDate();
          endDate = ahoraColombia().endOf('day').toDate();
          diaUnico = ahoraColombia().format('YYYY-MM-DD');
          break;
        case 'semana':
          startDate = ahoraColombia().subtract(7, 'days').startOf('day').toDate();
          endDate = ahoraColombia().endOf('day').toDate();
          break;
        case 'mes':
          startDate = ahoraColombia().subtract(30, 'days').startOf('day').toDate();
          endDate = ahoraColombia().endOf('day').toDate();
          break;
        case 'personalizado':
          if (!fecha_inicio || !fecha_fin) {
            return res.status(400).json({ error: 'Para período personalizado se requieren fecha_inicio y fecha_fin' });
          }
          startDate = moment(`${fecha_inicio} 00:00:00-05:00`).toDate();
          endDate = moment(`${fecha_fin} 23:59:59-05:00`).toDate();
          if (fecha_inicio === fecha_fin) diaUnico = fecha_inicio;
          break;
        default:
          startDate = ahoraColombia().startOf('day').toDate();
          endDate = ahoraColombia().endOf('day').toDate();
          diaUnico = ahoraColombia().format('YYYY-MM-DD');
      }

      const comoDueno = await pool.query(
        `SELECT v.modulo_id as modulo_id, m.nombre as modulo_nombre,
              p.id as producto_id, p.nombre as producto_nombre,
              SUM(dv.cantidad) as unidades, SUM(dv.subtotal) as monto
       FROM detalle_venta dv
       JOIN ventas v ON dv.venta_id = v.id
       JOIN modulos m ON v.modulo_id = m.id
       JOIN productos p ON dv.producto_id = p.id
       WHERE dv.modulo_dueno_id = $1 AND v.modulo_id != $1
       AND v.fecha_venta BETWEEN $2 AND $3
       AND v.es_ajuste_manual = false AND v.metodo_pago != 'consumo_propio'
       GROUP BY v.modulo_id, m.nombre, p.id, p.nombre`,
        [moduloId, startDate, endDate]
      );

      const comoVendedor = await pool.query(
        `SELECT dv.modulo_dueno_id as modulo_id, m.nombre as modulo_nombre,
              p.id as producto_id, p.nombre as producto_nombre,
              SUM(dv.cantidad) as unidades, SUM(dv.subtotal) as monto
       FROM detalle_venta dv
       JOIN ventas v ON dv.venta_id = v.id
       JOIN modulos m ON dv.modulo_dueno_id = m.id
       JOIN productos p ON dv.producto_id = p.id
       WHERE v.modulo_id = $1 AND dv.modulo_dueno_id != $1
       AND v.fecha_venta BETWEEN $2 AND $3
       AND v.es_ajuste_manual = false AND v.metodo_pago != 'consumo_propio'
       GROUP BY dv.modulo_dueno_id, m.nombre, p.id, p.nombre`,
        [moduloId, startDate, endDate]
      );

      // El check de "pagado" solo lo puede marcar el módulo por defecto del
      // negocio (el primero creado, ej. "Aquí fué") — los demás módulos
      // (ej. Lozanía, Empanadas) pueden ver el estado pero no cambiarlo.
      const moduloDefectoResult = await pool.query(
        'SELECT id FROM modulos WHERE negocio_id = $1 ORDER BY fecha_creacion ASC LIMIT 1',
        [negocioId]
      );
      const puedeMarcarPagado = moduloDefectoResult.rows[0]?.id === Number(moduloId);

      let pagado = null;
      if (diaUnico) {
        const pagadoResult = await pool.query(
          'SELECT pagado FROM ventas_cruzadas_pagos WHERE negocio_id = $1 AND fecha = $2',
          [negocioId, diaUnico]
        );
        pagado = pagadoResult.rows[0]?.pagado ?? false;
      }

      res.json({
        como_dueno: agruparCruzadasPorModulo(comoDueno.rows),
        como_vendedor: agruparCruzadasPorModulo(comoVendedor.rows),
        dia: diaUnico,
        pagado,
        puede_marcar_pagado: puedeMarcarPagado
      });
    } catch (error) {
      console.error('Error obteniendo ventas cruzadas:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Marca/desmarca un día de ventas cruzadas como pagado y mueve el dinero
  // entre bolsillos: el módulo que vendió entrega lo de cada dueño (sale de
  // su bolsillo 'origenPago' hacia 'otros_modulos', saldando la deuda que
  // dejaron las ventas) y cada dueño lo recibe en su caja. Desmarcar borra
  // esos traslados. Se puede llamar dentro de una transacción ya abierta.
  // Rango de un día para cobrar ventas cruzadas. El día de la apertura de
  // bolsillos solo cuenta lo vendido después de abrir: lo de antes ya se
  // entregó antes de contar el dinero.
  const rangoCruzadas = (fecha, apertura) => {
    const inicioDia = moment(`${fecha} 00:00:00-05:00`).toDate();
    const desde = apertura && new Date(apertura) > inicioDia ? new Date(apertura) : inicioDia;
    return [desde, moment(`${fecha} 23:59:59-05:00`).toDate()];
  };

  const marcarPagoCruzadas = async (db, { negocioId, moduloVendedorId, fecha, pagado, usuarioId, origenPago = 'caja' }) => {
    await db.query(
      `DELETE FROM traslados_bolsillo WHERE negocio_id = $1 AND tipo = 'pago_cruzada' AND ref_fecha = $2`,
      [negocioId, fecha]
    );

    await db.query(
      `INSERT INTO ventas_cruzadas_pagos (negocio_id, fecha, pagado, marcado_por, fecha_actualizacion)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (negocio_id, fecha)
     DO UPDATE SET pagado = $3, marcado_por = $4, fecha_actualizacion = now()`,
      [negocioId, fecha, pagado, usuarioId]
    );

    if (!pagado) return 0;

    // Los días anteriores a la apertura de bolsillos solo cambian la marca:
    // sus ventas no dejaron deuda en 'otros_modulos' que haya que saldar.
    const apertura = await bolsillosActivos(db, moduloVendedorId);
    if (!apertura || fecha < moment(apertura).utcOffset(-300).format('YYYY-MM-DD')) return 0;

    const porDueno = await db.query(
      `SELECT dv.modulo_dueno_id, m.nombre, SUM(dv.subtotal) AS monto
     FROM detalle_venta dv
     JOIN ventas v ON dv.venta_id = v.id
     JOIN modulos m ON m.id = dv.modulo_dueno_id
     WHERE v.modulo_id = $1 AND dv.modulo_dueno_id != $1
     AND v.fecha_venta BETWEEN $2 AND $3
     AND v.es_ajuste_manual = false AND v.metodo_pago != 'consumo_propio'
     GROUP BY dv.modulo_dueno_id, m.nombre`,
      [moduloVendedorId, ...rangoCruzadas(fecha, apertura)]
    );

    let total = 0;
    for (const fila of porDueno.rows) {
      const monto = Number(fila.monto);
      if (monto <= 0) continue;
      total += monto;
      await db.query(
        `INSERT INTO traslados_bolsillo (negocio_id, modulo_id, origen, destino, monto, tipo, concepto, ref_fecha, usuario_id)
       VALUES ($1, $2, 'otros_modulos', 'caja', $3, 'pago_cruzada', $4, $5, $6)`,
        [negocioId, fila.modulo_dueno_id, monto, `Recibido por ventas cruzadas del ${fecha}`, fecha, usuarioId]
      );
    }

    if (total > 0) {
      await db.query(
        `INSERT INTO traslados_bolsillo (negocio_id, modulo_id, origen, destino, monto, tipo, concepto, ref_fecha, usuario_id)
       VALUES ($1, $2, $3, 'otros_modulos', $4, 'pago_cruzada', $5, $6, $7)`,
        [negocioId, moduloVendedorId, origenPago, total, `Entregado a otros módulos (ventas del ${fecha})`, fecha, usuarioId]
      );
    }
    return total;
  };

  const esModuloPorDefecto = async (db, negocioId, moduloId) => {
    const result = await db.query(
      'SELECT id FROM modulos WHERE negocio_id = $1 ORDER BY fecha_creacion ASC LIMIT 1',
      [negocioId]
    );
    return result.rows[0]?.id === Number(moduloId);
  };

  app.put('/api/estadisticas/ventas-cruzadas/pagado', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    let client;
    try {
      const moduloId = req.moduloId;
      const negocioId = req.negocioId;
      const { fecha, pagado, bolsillo } = req.body;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) {
        return res.status(400).json({ error: 'fecha debe tener el formato YYYY-MM-DD' });
      }
      if (typeof pagado !== 'boolean') {
        return res.status(400).json({ error: 'pagado debe ser true o false' });
      }
      const origenPago = bolsillo || 'caja';
      if (!BOLSILLOS_MANUALES.includes(origenPago)) {
        return res.status(400).json({ error: 'bolsillo inválido' });
      }

      if (!(await esModuloPorDefecto(pool, negocioId, moduloId))) {
        return res.status(403).json({ error: 'Solo se puede marcar como pagado desde el módulo por defecto del negocio' });
      }

      client = await pool.connect();
      await client.query('BEGIN');
      await marcarPagoCruzadas(client, {
        negocioId, moduloVendedorId: moduloId, fecha, pagado, usuarioId: req.user.id, origenPago
      });
      await client.query('COMMIT');

      res.json({ fecha, pagado });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('Error actualizando pagado de ventas cruzadas:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  // Estadística dedicada de "consumo propio" (mercancía retirada para uso
  // personal, no una venta real) — deliberadamente separada del resto de
  // Estadísticas, ya que ese resto excluye consumo_propio por completo.
  // 'total' es una opción nueva exclusiva de esta ruta: sin filtro de
  // fecha en absoluto, para ver el histórico completo.
  app.get('/api/estadisticas/consumo-propio', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const { periodo, fecha_inicio, fecha_fin } = req.query;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      let startDate = null;
      let endDate = null;

      switch (periodo) {
        case 'hoy':
          startDate = ahoraColombia().startOf('day').toDate();
          endDate = ahoraColombia().endOf('day').toDate();
          break;
        case 'semana':
          startDate = ahoraColombia().subtract(7, 'days').startOf('day').toDate();
          endDate = ahoraColombia().endOf('day').toDate();
          break;
        case 'mes':
          startDate = ahoraColombia().subtract(30, 'days').startOf('day').toDate();
          endDate = ahoraColombia().endOf('day').toDate();
          break;
        case 'personalizado':
          if (!fecha_inicio || !fecha_fin) {
            return res.status(400).json({ error: 'Para período personalizado se requieren fecha_inicio y fecha_fin' });
          }
          startDate = moment(`${fecha_inicio} 00:00:00-05:00`).toDate();
          endDate = moment(`${fecha_fin} 23:59:59-05:00`).toDate();
          break;
        case 'total':
          // Sin filtro de fecha: startDate/endDate quedan null.
          break;
        default:
          startDate = ahoraColombia().startOf('day').toDate();
          endDate = ahoraColombia().endOf('day').toDate();
      }

      const filtroFecha = (startDate && endDate) ? 'AND v.fecha_venta BETWEEN $2 AND $3' : '';
      const params = (startDate && endDate) ? [moduloId, startDate, endDate] : [moduloId];

      // Separado en dos consultas (en vez de un solo JOIN) para no duplicar
      // ventas.total por cada línea de detalle_venta cuando una "venta" de
      // consumo propio tiene más de un producto.
      const valorResult = await pool.query(
        `SELECT COUNT(*) as total_registros, COALESCE(SUM(v.total), 0) as valor_total
       FROM ventas v
       WHERE v.modulo_id = $1 AND v.metodo_pago = 'consumo_propio' ${filtroFecha}`,
        params
      );

      const itemsResult = await pool.query(
        `SELECT COALESCE(SUM(dv.cantidad), 0) as total_items
       FROM detalle_venta dv
       JOIN ventas v ON dv.venta_id = v.id
       WHERE v.modulo_id = $1 AND v.metodo_pago = 'consumo_propio' ${filtroFecha}`,
        params
      );

      res.json({
        totalRegistros: Number(valorResult.rows[0].total_registros),
        totalItems: Number(itemsResult.rows[0].total_items),
        valorTotal: Number(valorResult.rows[0].valor_total),
        periodoInfo: {
          tipo: periodo || 'hoy',
          fecha_inicio: startDate ? moment(startDate).utcOffset(-300).format('YYYY-MM-DD') : null,
          fecha_fin: endDate ? moment(endDate).utcOffset(-300).format('YYYY-MM-DD') : null
        }
      });
    } catch (error) {
      console.error('Error obteniendo estadística de consumo propio:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.get('/api/estadisticas/global', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const userId = req.user.id;
      const { periodo, fecha_inicio, fecha_fin } = req.query;

      const adminResult = await pool.query(
        'SELECT negocio_id FROM usuarios WHERE id = $1 AND activo = true',
        [userId]
      );

      if (adminResult.rows.length === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      const negocioId = adminResult.rows[0].negocio_id;

      let startDate, endDate;
      
      switch (periodo) {
        case 'hoy':
          startDate = ahoraColombia().startOf('day').toDate();
          endDate = ahoraColombia().endOf('day').toDate();
          break;
        case 'semana':
          startDate = ahoraColombia().subtract(7, 'days').startOf('day').toDate();
          endDate = ahoraColombia().endOf('day').toDate();
          break;
        case 'mes':
          startDate = ahoraColombia().subtract(30, 'days').startOf('day').toDate();
          endDate = ahoraColombia().endOf('day').toDate();
          break;
        case 'personalizado':
          if (!fecha_inicio || !fecha_fin) {
            return res.status(400).json({ error: 'Para período personalizado se requieren fecha_inicio y fecha_fin' });
          }
          // fecha_inicio/fecha_fin llegan como 'YYYY-MM-DD' sin hora ni zona;
          // se ancla explícitamente a -05:00 para que "el día completo" sea
          // el día completo en Colombia, sin importar la zona del proceso.
          startDate = moment(`${fecha_inicio} 00:00:00-05:00`).toDate();
          endDate = moment(`${fecha_fin} 23:59:59-05:00`).toDate();
          break;
        default:
          startDate = ahoraColombia().startOf('day').toDate();
          endDate = ahoraColombia().endOf('day').toDate();
      }

      const modulosResult = await pool.query(
        'SELECT id, nombre FROM modulos WHERE negocio_id = $1 AND activo = true',
        [negocioId]
      );

      const estadisticasModulos = [];
      
      for (const modulo of modulosResult.rows) {
        const ventas = await pool.query(
          `SELECT COUNT(*) as total, COALESCE(SUM(total), 0) as monto
         FROM ventas
         WHERE modulo_id = $1 AND fecha_venta BETWEEN $2 AND $3
         AND es_ajuste_manual = false
         AND metodo_pago != 'consumo_propio'`,
          [modulo.id, startDate, endDate]
        );
        
        const productos = await pool.query(
          `SELECT COUNT(*) as total 
         FROM productos 
         WHERE modulo_id = $1 AND activo = true`,
          [modulo.id]
        );
        
        const stockBajo = await pool.query(
          `SELECT COUNT(*) as total 
         FROM productos 
         WHERE modulo_id = $1 AND stock_actual <= stock_minimo AND activo = true`,
          [modulo.id]
        );
        
        estadisticasModulos.push({
          modulo_id: modulo.id,
          modulo_nombre: modulo.nombre,
          ventas: ventas.rows[0],
          productos: productos.rows[0]?.total || 0,
          stock_bajo: stockBajo.rows[0]?.total || 0
        });
      }

      const ventasGlobales = await pool.query(
        `SELECT COUNT(*) as total, COALESCE(SUM(v.total), 0) as monto
       FROM ventas v
       JOIN modulos m ON v.modulo_id = m.id
       WHERE m.negocio_id = $1 AND v.fecha_venta BETWEEN $2 AND $3
       AND v.es_ajuste_manual = false
       AND v.metodo_pago != 'consumo_propio'`,
        [negocioId, startDate, endDate]
      );

      const productosGlobales = await pool.query(
        `SELECT COUNT(*) as total
       FROM productos p
       JOIN modulos m ON p.modulo_id = m.id
       WHERE m.negocio_id = $1 AND p.activo = true`,
        [negocioId]
      );

      const stockBajoGlobal = await pool.query(
        `SELECT COUNT(*) as total
       FROM productos p
       JOIN modulos m ON p.modulo_id = m.id
       WHERE m.negocio_id = $1 AND p.stock_actual <= p.stock_minimo AND p.activo = true`,
        [negocioId]
      );

      res.json({
        negocio_id: negocioId,
        periodo_info: {
          tipo: periodo || 'hoy',
          fecha_inicio: moment(startDate).utcOffset(-300).format('YYYY-MM-DD'),
          fecha_fin: moment(endDate).utcOffset(-300).format('YYYY-MM-DD')
        },
        global: {
          ventas: ventasGlobales.rows[0],
          productos: productosGlobales.rows[0]?.total || 0,
          stock_bajo: stockBajoGlobal.rows[0]?.total || 0
        },
        modulos: estadisticasModulos
      });
    } catch (error) {
      console.error('Error obteniendo estadísticas globales:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  return { esModuloPorDefecto, marcarPagoCruzadas, rangoCruzadas };
};
