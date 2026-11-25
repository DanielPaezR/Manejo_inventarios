// Rutas: Datos de compra y conteo físico del inventario.
// Movidas desde server.js (secciones: INVENTARIO: DATOS DE COMPRA Y CONTEO FÍSICO).
// Reciben ctx con lo que server.js prepara (app, pool, middlewares, helpers)
// y lo que exportan los grupos registrados antes; devuelven lo que otros usan.
module.exports = function registrarRutas(ctx) {
  const {
    moment, ahoraColombia, authenticateToken, requireAdmin, checkAccess, app, pool, requirePermiso, planes
  } = ctx;

  // ==================== INVENTARIO: DATOS DE COMPRA Y CONTEO FÍSICO ====================

  // Productos activos del módulo a los que les falta precio de compra o
  // proveedor — sin esos datos no se puede calcular cuánto cuesta un pedido
  // ni a quién pedirle cada cosa.
  app.get('/api/inventario/productos-incompletos', authenticateToken, checkAccess, requirePermiso('inventario'), async (req, res) => {
    try {
      const moduloId = req.moduloId;
      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const result = await pool.query(
        `SELECT p.id, p.nombre, p.codigo_ean, p.precio_venta, p.precio_compra, p.ignora_stock,
              c.nombre AS categoria_nombre,
              prov.proveedor_id
       FROM productos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
       LEFT JOIN LATERAL (
         SELECT pp.proveedor_id
         FROM producto_proveedor pp
         JOIN proveedores pr ON pr.id = pp.proveedor_id AND pr.activo = true
         WHERE pp.producto_id = p.id AND pp.activo = true
         ORDER BY pp.id
         LIMIT 1
       ) prov ON true
       WHERE p.modulo_id = $1 AND p.activo = true
         AND (COALESCE(p.precio_compra, 0) = 0 OR prov.proveedor_id IS NULL)
       ORDER BY p.nombre`,
        [moduloId]
      );

      res.json(result.rows.map(r => ({
        ...r,
        precio_venta: Number(r.precio_venta),
        precio_compra: r.precio_compra === null ? null : Number(r.precio_compra)
      })));
    } catch (error) {
      console.error('Error obteniendo productos incompletos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Guarda precio de compra y/o proveedor de un producto. El proveedor
  // elegido queda como el único activo del producto (en la práctica cada
  // producto se le compra a un solo proveedor).
  app.put('/api/inventario/productos/:id/datos-compra', authenticateToken, checkAccess, requirePermiso('inventario'), async (req, res) => {
    let client;
    try {
      const moduloId = req.moduloId;
      const { id } = req.params;
      const { precio_compra, proveedor_id } = req.body;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const tienePrecio = precio_compra !== undefined && precio_compra !== null && precio_compra !== '';
      const precioNum = Number(precio_compra);
      if (tienePrecio && (!Number.isFinite(precioNum) || precioNum < 0)) {
        return res.status(400).json({ error: 'El precio de compra debe ser un número mayor o igual a cero' });
      }
      const tieneProveedor = proveedor_id !== undefined && proveedor_id !== null && proveedor_id !== '';
      if (!tienePrecio && !tieneProveedor) {
        return res.status(400).json({ error: 'Indica el precio de compra, el proveedor o ambos' });
      }

      client = await pool.connect();
      await client.query('BEGIN');

      const productoResult = await client.query(
        'SELECT id, precio_compra FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true FOR UPDATE',
        [id, moduloId]
      );
      if (productoResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      if (tienePrecio) {
        await client.query('UPDATE productos SET precio_compra = $1 WHERE id = $2', [precioNum, id]);
        await client.query(
          'UPDATE producto_proveedor SET precio_compra = $1 WHERE producto_id = $2 AND activo = true',
          [precioNum, id]
        );
      }

      if (tieneProveedor) {
        const proveedorResult = await client.query(
          'SELECT id, dias_entrega FROM proveedores WHERE id = $1 AND modulo_id = $2 AND activo = true',
          [proveedor_id, moduloId]
        );
        if (proveedorResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Proveedor no encontrado' });
        }
        const precioVinculo = tienePrecio ? precioNum : Number(productoResult.rows[0].precio_compra || 0);
        await client.query(
          'UPDATE producto_proveedor SET activo = false WHERE producto_id = $1 AND proveedor_id <> $2',
          [id, proveedor_id]
        );
        await client.query(
          `INSERT INTO producto_proveedor (producto_id, proveedor_id, precio_compra, tiempo_entrega_dias, cantidad_minima_pedido, unidades_por_paquete)
         VALUES ($1, $2, $3, $4, 1, 1)
         ON CONFLICT (producto_id, proveedor_id)
         DO UPDATE SET precio_compra = $3, activo = true`,
          [id, proveedor_id, precioVinculo, proveedorResult.rows[0].dias_entrega || 3]
        );
      }

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('Error guardando datos de compra:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  // Productos para el conteo físico (los preparados no llevan stock, se
  // excluyen). proveedor: id numérico, 'sin' (sin proveedor) o vacío (todos).
  app.get('/api/inventario/conteo', authenticateToken, checkAccess, requirePermiso('inventario'), async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const { proveedor } = req.query;
      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const params = [moduloId];
      let filtro = '';
      if (proveedor === 'sin') {
        filtro = `AND NOT EXISTS (SELECT 1 FROM producto_proveedor pp WHERE pp.producto_id = p.id AND pp.activo = true)`;
      } else if (proveedor !== undefined && proveedor !== '') {
        if (!/^\d+$/.test(String(proveedor))) {
          return res.status(400).json({ error: 'proveedor inválido' });
        }
        params.push(parseInt(proveedor, 10));
        filtro = `AND EXISTS (SELECT 1 FROM producto_proveedor pp WHERE pp.producto_id = p.id AND pp.activo = true AND pp.proveedor_id = $2)`;
      }

      const result = await pool.query(
        `SELECT p.id, p.nombre, p.codigo_ean, p.stock_actual, p.precio_compra, c.nombre AS categoria_nombre,
              -- Para la burbuja: en cuántos conteos anteriores faltó y cuánto.
              (SELECT COUNT(*)::int FROM ajustes_inventario a WHERE a.producto_id = p.id AND a.diferencia < 0) AS veces_faltante,
              (SELECT COALESCE(SUM(a.diferencia), 0)::int FROM ajustes_inventario a WHERE a.producto_id = p.id AND a.diferencia < 0) AS unidades_faltantes
       FROM productos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
       WHERE p.modulo_id = $1 AND p.activo = true AND p.ignora_stock = false ${filtro}
       ORDER BY c.nombre NULLS LAST, p.nombre`,
        params
      );

      res.json(result.rows.map(r => ({ ...r, precio_compra: Number(r.precio_compra || 0) })));
    } catch (error) {
      console.error('Error obteniendo productos para conteo:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Registra un conteo físico: deja el stock de cada producto contado igual
  // a lo que hay de verdad y guarda la diferencia (en unidades y en plata a
  // precio de compra) para ver cuánto se pierde sin registrar.
  app.post('/api/inventario/conteos', authenticateToken, checkAccess, requirePermiso('inventario'), async (req, res) => {
    let client;
    try {
      const moduloId = req.moduloId;
      const negocioId = req.negocioId;
      const { items, proveedor_id } = req.body;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Cuenta al menos un producto' });
      }
      for (const it of items) {
        const cantidad = Number(it.stock_contado);
        if (!Number.isInteger(cantidad) || cantidad < 0 || !it.producto_id) {
          return res.status(400).json({ error: 'Cada producto contado necesita una cantidad entera mayor o igual a cero' });
        }
      }

      client = await pool.connect();
      await client.query('BEGIN');

      let proveedorValido = null;
      if (proveedor_id !== undefined && proveedor_id !== null && proveedor_id !== '' && proveedor_id !== 'sin') {
        const prov = await client.query('SELECT id FROM proveedores WHERE id = $1 AND modulo_id = $2', [proveedor_id, moduloId]);
        if (prov.rows.length > 0) proveedorValido = prov.rows[0].id;
      }

      const conteo = await client.query(
        `INSERT INTO conteos_inventario (negocio_id, modulo_id, proveedor_id, usuario_id, productos_contados, unidades_diferencia, valor_diferencia)
       VALUES ($1, $2, $3, $4, 0, 0, 0) RETURNING id`,
        [negocioId, moduloId, proveedorValido, req.user.id]
      );
      const conteoId = conteo.rows[0].id;

      const detalle = [];
      let unidadesDiferencia = 0;
      let valorDiferencia = 0;

      for (const it of items) {
        const prod = await client.query(
          'SELECT id, nombre, stock_actual, precio_compra FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true AND ignora_stock = false FOR UPDATE',
          [it.producto_id, moduloId]
        );
        if (prod.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: `Producto ${it.producto_id} no encontrado` });
        }
        const p = prod.rows[0];
        const contado = Number(it.stock_contado);
        const diferencia = contado - p.stock_actual;
        const costo = Number(p.precio_compra || 0);

        await client.query(
          `INSERT INTO ajustes_inventario (conteo_id, producto_id, stock_sistema, stock_contado, diferencia, costo_unitario)
         VALUES ($1, $2, $3, $4, $5, $6)`,
          [conteoId, p.id, p.stock_actual, contado, diferencia, costo]
        );
        if (diferencia !== 0) {
          await client.query('UPDATE productos SET stock_actual = $1 WHERE id = $2', [contado, p.id]);
        }

        unidadesDiferencia += diferencia;
        valorDiferencia += diferencia * costo;
        detalle.push({
          producto_id: p.id,
          nombre: p.nombre,
          stock_sistema: p.stock_actual,
          stock_contado: contado,
          diferencia,
          valor: diferencia * costo
        });
      }

      valorDiferencia = Math.round(valorDiferencia * 100) / 100;
      await client.query(
        'UPDATE conteos_inventario SET productos_contados = $1, unidades_diferencia = $2, valor_diferencia = $3 WHERE id = $4',
        [items.length, unidadesDiferencia, valorDiferencia, conteoId]
      );

      await client.query('COMMIT');
      res.status(201).json({
        id: conteoId,
        productos_contados: items.length,
        unidades_diferencia: unidadesDiferencia,
        valor_diferencia: valorDiferencia,
        detalle: detalle.filter(d => d.diferencia !== 0).sort((a, b) => a.valor - b.valor)
      });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('Error registrando conteo de inventario:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  app.get('/api/inventario/conteos', authenticateToken, checkAccess, requirePermiso('inventario'), async (req, res) => {
    try {
      const moduloId = req.moduloId;
      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const result = await pool.query(
        `SELECT ci.id, ci.fecha, ci.productos_contados, ci.unidades_diferencia, ci.valor_diferencia,
              pr.nombre AS proveedor_nombre, u.nombre AS usuario_nombre
       FROM conteos_inventario ci
       LEFT JOIN proveedores pr ON pr.id = ci.proveedor_id
       LEFT JOIN usuarios u ON u.id = ci.usuario_id
       WHERE ci.modulo_id = $1
       ORDER BY ci.fecha DESC
       LIMIT 20`,
        [moduloId]
      );

      res.json(result.rows.map(r => ({ ...r, valor_diferencia: Number(r.valor_diferencia) })));
    } catch (error) {
      console.error('Error obteniendo conteos de inventario:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Resumen de ingresos/egresos de un período, para la pestaña "Ingresos y
  // Egresos" de Estadísticas. Misma resolución de fechas que GET
  // /api/estadisticas, ahora filtrado por módulo (antes era todo el negocio).
  app.get('/api/finanzas/resumen-periodo', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
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

      const totales = await pool.query(
        `SELECT
          COALESCE(SUM(monto) FILTER (WHERE tipo IN ('ingreso', 'saldo_inicial')), 0) as total_ingresos,
          COALESCE(SUM(monto) FILTER (WHERE tipo = 'egreso'), 0) as total_egresos
       FROM movimientos_caja
       WHERE modulo_id = $1 AND fecha BETWEEN $2 AND $3`,
        [moduloId, startDate, endDate]
      );

      const totalIngresos = Number(totales.rows[0]?.total_ingresos || 0);
      const totalEgresos = Number(totales.rows[0]?.total_egresos || 0);

      // categoria_gasto_id tiene prioridad sobre origen = 'pedido': un egreso
      // vinculado a un pedido TAMBIÉN puede tener una categoría de gasto
      // asignada (son independientes), y de ser así se agrupa por categoría
      // para que ningún egreso quede contado en más de un grupo.
      const egresosPorCategoria = await pool.query(
        `SELECT
          CASE
            WHEN mc.categoria_gasto_id IS NOT NULL THEN 'cat_' || mc.categoria_gasto_id::text
            WHEN mc.origen = 'pedido' THEN 'pedido'
            WHEN mc.categoria = 'ajuste_cuadre' THEN 'ajuste_cuadre'
            ELSE 'sin_categoria'
          END as grupo_key,
          CASE
            WHEN mc.categoria_gasto_id IS NOT NULL THEN cg.nombre
            WHEN mc.origen = 'pedido' THEN '📦 Pedidos a proveedor'
            WHEN mc.categoria = 'ajuste_cuadre' THEN '🧮 Faltantes en cuadre de caja'
            ELSE '🗂️ Sin categoría'
          END as grupo_nombre,
          SUM(mc.monto) as monto
       FROM movimientos_caja mc
       LEFT JOIN categorias_gasto cg ON mc.categoria_gasto_id = cg.id
       WHERE mc.modulo_id = $1 AND mc.tipo = 'egreso' AND mc.fecha BETWEEN $2 AND $3
       GROUP BY grupo_key, grupo_nombre
       ORDER BY monto DESC`,
        [moduloId, startDate, endDate]
      );

      // tipo = 'saldo_inicial' se evalúa primero para que nunca caiga en el
      // grupo "Ingresos manuales" (ambos tienen origen = 'manual').
      const ingresosPorOrigen = await pool.query(
        `SELECT
          CASE
            WHEN mc.tipo = 'saldo_inicial' THEN 'saldo_inicial'
            WHEN mc.origen = 'venta' THEN 'venta'
            WHEN mc.origen = 'manual' AND mc.categoria = 'abono_credito' THEN 'abono'
            WHEN mc.categoria = 'ajuste_cuadre' THEN 'ajuste_cuadre'
            WHEN mc.categoria = 'comision_favor' THEN 'comision_favor'
            ELSE 'manual'
          END as grupo_key,
          CASE
            WHEN mc.tipo = 'saldo_inicial' THEN '🏦 Saldo inicial'
            WHEN mc.origen = 'venta' THEN '🛒 Ventas'
            WHEN mc.origen = 'manual' AND mc.categoria = 'abono_credito' THEN '💰 Abonos de clientes'
            WHEN mc.categoria = 'ajuste_cuadre' THEN '🧮 Sobrantes en cuadre de caja'
            WHEN mc.categoria = 'comision_favor' THEN '🤝 Ganancia por favores (giros, recargas)'
            ELSE '✋ Ingresos manuales'
          END as grupo_nombre,
          SUM(mc.monto) as monto
       FROM movimientos_caja mc
       WHERE mc.modulo_id = $1 AND mc.tipo IN ('ingreso', 'saldo_inicial') AND mc.fecha BETWEEN $2 AND $3
       GROUP BY grupo_key, grupo_nombre
       ORDER BY monto DESC`,
        [moduloId, startDate, endDate]
      );

      res.json({
        total_ingresos: totalIngresos,
        total_egresos: totalEgresos,
        egresos_por_categoria: egresosPorCategoria.rows.map(r => ({
          nombre: r.grupo_nombre,
          monto: Number(r.monto),
          porcentaje: totalEgresos > 0 ? (Number(r.monto) / totalEgresos) * 100 : 0
        })),
        ingresos_por_origen: ingresosPorOrigen.rows.map(r => ({
          nombre: r.grupo_nombre,
          monto: Number(r.monto),
          porcentaje: totalIngresos > 0 ? (Number(r.monto) / totalIngresos) * 100 : 0
        })),
        periodoInfo: {
          tipo: periodo || 'hoy',
          fecha_inicio: moment(startDate).utcOffset(-300).format('YYYY-MM-DD'),
          fecha_fin: moment(endDate).utcOffset(-300).format('YYYY-MM-DD')
        }
      });
    } catch (error) {
      console.error('Error obteniendo resumen financiero del período:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // 'fechaStr' debe ser exactamente el lunes de su semana ISO (isoWeekday
  // 1 = lunes, independiente del locale de moment, que por defecto no
  // está configurado como 'es' en este proceso).
  const esLunesValido = (fechaStr) => {
    if (typeof fechaStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) return false;
    const m = moment(fechaStr, 'YYYY-MM-DD', true);
    return m.isValid() && m.isoWeekday() === 1;
  };

  // Registro semanal de Finanzas: ingresos por ventas, los 3 tipos de
  // gasto, utilidad bruta y la meta de reinversión (editable) de una
  // semana puntual (lunes a domingo). Por módulo, como el resto de Finanzas.
  app.get('/api/finanzas/reporte-semanal', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const { semana_inicio } = req.query;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      let semanaInicioStr;
      if (semana_inicio) {
        if (!esLunesValido(semana_inicio)) {
          return res.status(400).json({ error: 'semana_inicio debe ser una fecha YYYY-MM-DD que caiga en lunes' });
        }
        semanaInicioStr = semana_inicio;
      } else {
        // Mismo ajuste de zona horaria que el resto de la app: el proceso
        // corre en UTC, pero el negocio opera en Colombia (UTC-5).
        semanaInicioStr = ahoraColombia().startOf('isoWeek').format('YYYY-MM-DD');
      }

      const semanaFinStr = moment(semanaInicioStr, 'YYYY-MM-DD').add(6, 'days').format('YYYY-MM-DD');
      // Igual que fecha_inicio/fecha_fin en /finanzas/resumen-periodo: se
      // ancla explícitamente a -05:00 para que el rango sea el día completo
      // en Colombia sin importar en qué zona horaria corra el proceso.
      const startDate = moment(`${semanaInicioStr} 00:00:00-05:00`).toDate();
      const endDate = moment(`${semanaFinStr} 23:59:59-05:00`).toDate();

      const ingresosResult = await pool.query(
        `SELECT COALESCE(SUM(monto), 0) as total
       FROM movimientos_caja
       WHERE modulo_id = $1 AND origen = 'venta' AND fecha BETWEEN $2 AND $3`,
        [moduloId, startDate, endDate]
      );

      // "Inversión Mercancía" es una categoría de gasto que el módulo crea a
      // mano (igual que "Gastos Fijos" más abajo) — si no existe con ese
      // nombre exacto para este módulo, el IN (SELECT...) queda vacío y esta
      // parte del total simplemente no suma nada (no es un error).
      const mercanciaResult = await pool.query(
        `SELECT COALESCE(SUM(monto), 0) as total
       FROM movimientos_caja
       WHERE modulo_id = $1 AND fecha BETWEEN $2 AND $3
         AND (
           origen = 'pedido'
           OR (origen = 'manual' AND categoria_gasto_id IN (
             SELECT id FROM categorias_gasto WHERE modulo_id = $1 AND LOWER(nombre) = LOWER('Inversión Mercancía')
           ))
         )`,
        [moduloId, startDate, endDate]
      );

      // Mismo criterio que GET /api/estadisticas/consumo-propio (ventas con
      // metodo_pago = 'consumo_propio'), acotado a esta semana y a este
      // módulo directamente (ventas ya tiene modulo_id propio).
      const propiosResult = await pool.query(
        `SELECT COALESCE(SUM(v.total), 0) as total
       FROM ventas v
       WHERE v.modulo_id = $1 AND v.metodo_pago = 'consumo_propio' AND v.fecha_venta BETWEEN $2 AND $3`,
        [moduloId, startDate, endDate]
      );

      const fijosResult = await pool.query(
        `SELECT COALESCE(SUM(monto), 0) as total
       FROM movimientos_caja
       WHERE modulo_id = $1 AND origen = 'manual' AND fecha BETWEEN $2 AND $3
         AND categoria_gasto_id IN (
           SELECT id FROM categorias_gasto WHERE modulo_id = $1 AND LOWER(nombre) = LOWER('Gastos Fijos')
         )`,
        [moduloId, startDate, endDate]
      );

      // No se crea la fila si todavía no existe — solo al guardar (POST de
      // abajo). Antes de eso, el registro semanal simplemente muestra 0.
      const reinversionResult = await pool.query(
        'SELECT monto, notas FROM metas_reinversion WHERE modulo_id = $1 AND semana_inicio = $2',
        [moduloId, semanaInicioStr]
      );

      const ingresosVentas = Number(ingresosResult.rows[0].total);
      const gastosMercancia = Number(mercanciaResult.rows[0].total);
      const gastosPropios = Number(propiosResult.rows[0].total);
      const gastosFijos = Number(fijosResult.rows[0].total);
      const totalGastos = gastosMercancia + gastosPropios + gastosFijos;
      const utilidadBruta = ingresosVentas - totalGastos;

      res.json({
        semana_inicio: semanaInicioStr,
        semana_fin: semanaFinStr,
        ingresos_ventas: ingresosVentas,
        gastos_mercancia: gastosMercancia,
        gastos_propios: gastosPropios,
        gastos_fijos: gastosFijos,
        total_gastos: totalGastos,
        utilidad_bruta: utilidadBruta,
        reinversion: {
          monto: reinversionResult.rows.length > 0 ? Number(reinversionResult.rows[0].monto) : 0,
          notas: reinversionResult.rows.length > 0 ? (reinversionResult.rows[0].notas || '') : ''
        }
      });
    } catch (error) {
      console.error('Error obteniendo reporte semanal de finanzas:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.post('/api/finanzas/reporte-semanal/reinversion', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const negocioId = req.negocioId;
      const { semana_inicio, monto, notas } = req.body;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      if (!esLunesValido(semana_inicio)) {
        return res.status(400).json({ error: 'semana_inicio debe ser una fecha YYYY-MM-DD que caiga en lunes' });
      }

      const montoNum = Number(monto);
      if (!Number.isFinite(montoNum) || montoNum < 0) {
        return res.status(400).json({ error: 'El monto debe ser un número mayor o igual a cero' });
      }

      const result = await pool.query(
        `INSERT INTO metas_reinversion (negocio_id, modulo_id, semana_inicio, monto, notas, fecha_registro)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (modulo_id, semana_inicio)
       DO UPDATE SET monto = $4, notas = $5, fecha_registro = NOW()
       RETURNING *`,
        [negocioId, moduloId, semana_inicio, montoNum, notas?.trim() || null]
      );

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error guardando meta de reinversión:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Convierte una fecha (Date/timestamp de movimientos_caja.fecha o
  // ventas.fecha_venta, ambas "timestamp without time zone" guardadas en
  // UTC) a la clave de bucket correspondiente en hora Colombia, según
  // granularidad. Mismo ajuste utcOffset(-300) que ahoraColombia().
  const claveBucketColombia = (fecha, granularidad) => {
    const m = moment(fecha).utcOffset(-300);
    if (granularidad === 'dia') return m.startOf('day').format('YYYY-MM-DD');
    if (granularidad === 'mes') return m.startOf('month').format('YYYY-MM-DD');
    // 'semana': isoWeek para que la semana empiece en lunes, igual que
    // /api/finanzas/reporte-semanal.
    return m.startOf('isoWeek').format('YYYY-MM-DD');
  };

  // Genera la lista completa y ordenada de claves de bucket entre dos
  // fechas (inclusive), sin huecos, para que los gráficos de evolución
  // muestren una línea continua incluso en periodos sin movimientos.
  const generarClavesBucket = (inicio, fin, granularidad) => {
    const unidad = granularidad === 'dia' ? 'day' : granularidad === 'mes' ? 'month' : 'week';
    const finClave = claveBucketColombia(fin, granularidad);
    let cursor = moment(claveBucketColombia(inicio, granularidad), 'YYYY-MM-DD');
    const claves = [];
    let clave = cursor.format('YYYY-MM-DD');
    while (clave <= finClave) {
      claves.push(clave);
      cursor = cursor.add(1, unidad);
      clave = cursor.format('YYYY-MM-DD');
    }
    return claves;
  };

  // Evolución del balance general acumulado (saldo_inicial + ingresos -
  // egresos, corrido bucket a bucket) desde el movimiento_caja más antiguo
  // del negocio hasta hoy, navegable por día/semana/mes.
  app.get('/api/finanzas/evolucion-balance', authenticateToken, checkAccess, requireAdmin, planes.requierePlan(pool, 'reportes'), async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const { granularidad = 'semana', fecha_inicio, fecha_fin } = req.query;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      if (!['dia', 'semana', 'mes'].includes(granularidad)) {
        return res.status(400).json({ error: "granularidad debe ser 'dia', 'semana' o 'mes'" });
      }

      if ((fecha_inicio && !fecha_fin) || (!fecha_inicio && fecha_fin)) {
        return res.status(400).json({ error: 'fecha_inicio y fecha_fin deben venir juntas' });
      }

      // Se trae TODA la historia de movimientos_caja, sin importar el rango
      // pedido para mostrar: el balance acumulado tiene que partir de la
      // historia completa, no reiniciar en 0 si el usuario filtra para ver
      // solo un recorte reciente (si no, el gráfico mentiría).
      const movimientosResult = await pool.query(
        `SELECT fecha, monto, tipo
       FROM movimientos_caja
       WHERE modulo_id = $1
       ORDER BY fecha ASC`,
        [moduloId]
      );
      const movimientos = movimientosResult.rows;

      if (movimientos.length === 0) {
        return res.json({ puntos: [], balance_al_inicio_del_rango: 0, balance_actual: 0 });
      }

      const netoPorBucket = new Map();
      for (const mov of movimientos) {
        const clave = claveBucketColombia(mov.fecha, granularidad);
        // saldo_inicial e ingreso suman, egreso resta (mismo criterio que
        // balance_actual en GET /api/finanzas/balance).
        const signo = mov.tipo === 'egreso' ? -1 : 1;
        netoPorBucket.set(clave, (netoPorBucket.get(clave) || 0) + signo * Number(mov.monto));
      }

      const hoy = ahoraColombia().toDate();
      const claves = generarClavesBucket(movimientos[0].fecha, hoy, granularidad);

      let acumulado = 0;
      const serieCompleta = claves.map(clave => {
        acumulado += netoPorBucket.get(clave) || 0;
        return { fecha: clave, balance: acumulado };
      });

      let puntos = serieCompleta;
      let balanceAlInicioDelRango = 0;
      if (fecha_inicio && fecha_fin) {
        const idxInicio = serieCompleta.findIndex(p => p.fecha >= fecha_inicio);
        const antesDelRango = idxInicio > 0 ? serieCompleta[idxInicio - 1] : null;
        balanceAlInicioDelRango = antesDelRango ? antesDelRango.balance : 0;
        puntos = serieCompleta.filter(p => p.fecha >= fecha_inicio && p.fecha <= fecha_fin);
      }

      res.json({
        puntos,
        balance_al_inicio_del_rango: balanceAlInicioDelRango,
        balance_actual: serieCompleta[serieCompleta.length - 1].balance
      });
    } catch (error) {
      console.error('Error obteniendo evolución de balance:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Evolución de egresos por categoría (mercancía / gastos fijos / gastos
  // propios / otros) período a período, SIN acumular — cada punto es lo
  // gastado en ese bucket. A diferencia de evolución-balance, no necesita
  // traer historia previa al rango mostrado porque no hay acumulación.
  app.get('/api/finanzas/evolucion-egresos', authenticateToken, checkAccess, requireAdmin, planes.requierePlan(pool, 'reportes'), async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const { granularidad = 'semana', fecha_inicio, fecha_fin } = req.query;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
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
        // Por defecto, "desde que tengo el módulo": el movimiento_caja más
        // antiguo (mismo criterio que evolución-balance) hasta hoy.
        const minResult = await pool.query(
          'SELECT MIN(fecha) as min_fecha FROM movimientos_caja WHERE modulo_id = $1',
          [moduloId]
        );
        const minFecha = minResult.rows[0]?.min_fecha;
        if (!minFecha) {
          return res.json({ puntos: [] });
        }
        startDate = minFecha;
        endDate = ahoraColombia().endOf('day').toDate();
      }

      // Igual que en /api/finanzas/reporte-semanal: coincidencia por nombre
      // exacto (insensible a mayúsculas) contra las categorías de gasto que
      // el módulo ya haya creado con esos nombres. Si no existen, quedan en
      // null y ningún egreso cae en esas categorías (no es un error).
      const categoriasResult = await pool.query(
        'SELECT id, LOWER(nombre) as nombre_lower FROM categorias_gasto WHERE modulo_id = $1',
        [moduloId]
      );
      const catMercanciaId = categoriasResult.rows.find(c => c.nombre_lower === 'inversión mercancía')?.id ?? null;
      const catFijosId = categoriasResult.rows.find(c => c.nombre_lower === 'gastos fijos')?.id ?? null;

      const egresosResult = await pool.query(
        `SELECT fecha, monto, origen, categoria_gasto_id
       FROM movimientos_caja
       WHERE modulo_id = $1 AND tipo = 'egreso' AND fecha BETWEEN $2 AND $3`,
        [moduloId, startDate, endDate]
      );

      // Mismo criterio que GET /api/estadisticas/consumo-propio (ventas con
      // metodo_pago = 'consumo_propio'), acotado a este módulo directamente
      // (ventas ya tiene modulo_id propio).
      const propiosResult = await pool.query(
        `SELECT v.fecha_venta as fecha, v.total as monto
       FROM ventas v
       WHERE v.modulo_id = $1 AND v.metodo_pago = 'consumo_propio' AND v.fecha_venta BETWEEN $2 AND $3`,
        [moduloId, startDate, endDate]
      );

      const buckets = new Map();
      const sumar = (clave, campo, monto) => {
        if (!buckets.has(clave)) {
          buckets.set(clave, { mercancia: 0, gastos_fijos: 0, gastos_propios: 0, otros: 0 });
        }
        buckets.get(clave)[campo] += monto;
      };

      for (const mov of egresosResult.rows) {
        const clave = claveBucketColombia(mov.fecha, granularidad);
        const monto = Number(mov.monto);
        // catMercanciaId/catFijosId pueden ser null si el negocio no ha
        // creado esa categoría todavía — comparar categoria_gasto_id (que
        // también puede ser null) contra null daría un falso positivo, por
        // eso el chequeo explícito de "!== null" antes de comparar.
        const esMercancia = mov.origen === 'pedido' || (catMercanciaId !== null && mov.categoria_gasto_id === catMercanciaId);
        const esFijos = !esMercancia && catFijosId !== null && mov.categoria_gasto_id === catFijosId;
        if (esMercancia) sumar(clave, 'mercancia', monto);
        else if (esFijos) sumar(clave, 'gastos_fijos', monto);
        else sumar(clave, 'otros', monto);
      }

      for (const venta of propiosResult.rows) {
        const clave = claveBucketColombia(venta.fecha, granularidad);
        sumar(clave, 'gastos_propios', Number(venta.monto));
      }

      const claves = generarClavesBucket(startDate, endDate, granularidad);
      const puntos = claves.map(clave => ({
        fecha: clave,
        ...(buckets.get(clave) || { mercancia: 0, gastos_fijos: 0, gastos_propios: 0, otros: 0 })
      }));

      res.json({ puntos });
    } catch (error) {
      console.error('Error obteniendo evolución de egresos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  return { claveBucketColombia, generarClavesBucket };
};
