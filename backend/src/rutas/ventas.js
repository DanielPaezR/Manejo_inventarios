// Rutas: Ventas.
// Movidas desde server.js (secciones: RUTAS DE VENTAS).
// Reciben ctx con lo que server.js prepara (app, pool, middlewares, helpers)
// y lo que exportan los grupos registrados antes; devuelven lo que otros usan.
module.exports = function registrarRutas(ctx) {
  const {
    ahoraColombia, authenticateToken, checkAccess, generarNumeroFactura, expandirDetalles,
    registrarIngresosVenta, app, pool
  } = ctx;

  // ==================== RUTAS DE VENTAS ====================

  app.post('/api/ventas', authenticateToken, checkAccess, async (req, res) => {
    // pool.connect() dentro del try: si la conexión falla, no debe quedar
    // como una promesa rechazada sin atrapar que tumbe todo el proceso.
    let client;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const { detalles: detallesRecibidos, cliente_nombre, cliente_documento, cliente_direccion, cliente_telefono, metodo_pago, cliente_id } = req.body;
      const usuario_id = req.user.id;
      const moduloId = req.moduloId;
      const negocioId = req.negocioId;

      if (!moduloId) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      // Una venta a crédito es una deuda del cliente, no efectivo real, así
      // que necesita un cliente identificable para poder cobrarla después.
      if (metodo_pago === 'credito' && !cliente_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Las ventas a crédito requieren un cliente registrado' });
      }

      // cliente_id nunca se validaba contra el módulo del usuario: cualquier
      // llamada directa a la API (sin pasar por el buscador ya filtrado del
      // POS) podía mandar el id de un cliente de otro módulo/negocio. Con
      // crédito de por medio eso generaría deuda falsa en un cliente ajeno.
      // Los clientes son por módulo (no por negocio), así que la validación
      // es contra moduloId.
      if (cliente_id) {
        const clienteCheck = await client.query(
          'SELECT id FROM clientes WHERE id = $1 AND modulo_id = $2',
          [cliente_id, moduloId]
        );
        if (clienteCheck.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Cliente no encontrado' });
        }
      }

      console.log('🛒 Procesando venta - Usuario:', req.user.email, 'Módulo:', moduloId);

      if (!Array.isArray(detallesRecibidos) || detallesRecibidos.length === 0) {
        throw new Error('La venta debe incluir al menos un producto');
      }

      // Las promociones ({ promocion_id, cantidad }) se desarman en sus
      // productos con el precio especial repartido (ver helpers/promociones.js).
      const detalles = await expandirDetalles(client, moduloId, detallesRecibidos);
      // Stock pedido por producto sumando todas sus líneas (un producto puede
      // venir suelto y además dentro de una promoción).
      const unidadesPorProducto = new Map();
      for (const d of detalles) {
        unidadesPorProducto.set(d.producto_id, (unidadesPorProducto.get(d.producto_id) || 0) + Number(d.cantidad));
      }

      // Productos con ignora_stock = true (ej. categoría "Preparados": se
      // cocinan al pedir, no representan stock físico) — se pueden vender
      // sin importar stock_actual, y no lo descuentan al completarse.
      const productosQueIgnoranStock = new Set();

      // Módulo dueño real de cada producto vendido (puede ser distinto de
      // moduloId cuando el producto es compartido y se vende desde otro
      // módulo del negocio) — se guarda en detalle_venta para poder atribuir
      // la venta a las cuentas del dueño aunque la factura sea de quien vendió.
      const duenoPorProducto = new Map();
      // Snapshot del costo al momento de la venta, para poder calcular el
      // costo de mercancía vendida real más adelante sin depender del
      // precio_compra ACTUAL del producto (que puede cambiar con el tiempo).
      const costoPorProducto = new Map();

      for (const detalle of detalles) {
        // Number.isFinite() NO coerce strings (a diferencia de isFinite()).
        // Postgres devuelve las columnas NUMERIC/DECIMAL como string a
        // través del driver pg (para no perder precisión), y el frontend
        // reenvía ese precio tal cual desde el carrito — así que
        // detalle.precio_unitario normalmente llega como "150000.00", no
        // como number. Validar el string crudo con Number.isFinite rechazaba
        // TODA venta con este error, no algo específico del producto
        // señalado (ese es solo el primero del arreglo en fallar el check).
        detalle.cantidad = Number(detalle.cantidad);
        detalle.precio_unitario = Number(detalle.precio_unitario);

        if (!Number.isFinite(detalle.cantidad) || detalle.cantidad <= 0) {
          throw new Error(`Cantidad inválida para el producto ${detalle.producto_id}`);
        }
        if (!Number.isFinite(detalle.precio_unitario) || detalle.precio_unitario < 0) {
          throw new Error(`Precio unitario inválido para el producto ${detalle.producto_id}`);
        }

        // FOR UPDATE bloquea la fila hasta el COMMIT/ROLLBACK de esta
        // transacción: dos ventas concurrentes del mismo producto ya no
        // pueden leer el mismo stock antes de que ninguna confirme.
        // El producto es vendible desde este módulo si es suyo (modulo_id =
        // moduloId) o si su dueño lo compartió explícitamente con este módulo
        // (producto_modulo_compartido) — así se puede vender mercancía en
        // consignación de otro módulo sin salir del negocio. La verificación
        // de módulo compartido va en un EXISTS aparte (no un JOIN) a propósito:
        // un JOIN dentro de este FOR UPDATE bloquearía también la fila de
        // modulos, lo que puede chocar con otras transacciones que necesiten
        // esa misma fila (ver generarNumeroFactura).
        const stockResult = await client.query(
          `SELECT p.id, p.nombre, p.stock_actual, p.ignora_stock, p.modulo_id, p.precio_compra
         FROM productos p
         WHERE p.id = $1 AND p.activo = true
         AND (
           p.modulo_id = $2
           OR EXISTS (
             SELECT 1 FROM producto_modulo_compartido pmc
             JOIN modulos m_otro ON pmc.modulo_id = m_otro.id
             WHERE pmc.producto_id = p.id AND pmc.modulo_id = $2 AND m_otro.negocio_id = $3
           )
         )
         FOR UPDATE`,
          [detalle.producto_id, moduloId, negocioId]
        );

        if (stockResult.rows.length === 0) {
          throw new Error(`Producto no encontrado o inactivo: ${detalle.producto_id}`);
        }

        const producto = stockResult.rows[0];
        duenoPorProducto.set(detalle.producto_id, producto.modulo_id);
        costoPorProducto.set(detalle.producto_id, producto.precio_compra);

        if (producto.ignora_stock) {
          productosQueIgnoranStock.add(detalle.producto_id);
        } else if (producto.stock_actual < unidadesPorProducto.get(detalle.producto_id)) {
          throw new Error(`Stock insuficiente para "${producto.nombre}". Stock actual: ${producto.stock_actual}, solicitado: ${unidadesPorProducto.get(detalle.producto_id)}`);
        }
      }

      // NOTA: este call le faltaba el segundo argumento (pool), lo que hacía
      // que pool.connect() reventara dentro del helper y NINGUNA venta pudiera
      // completarse. Corregido como parte de este cambio porque bloqueaba
      // directamente la ruta que se está modificando para aceptar cliente_id.
      const numero_factura = await generarNumeroFactura(moduloId, pool);
      console.log('🧾 Número de factura generado:', numero_factura);

      const subtotal = detalles.reduce((sum, detalle) => sum + (detalle.subtotal !== undefined ? Number(detalle.subtotal) : detalle.cantidad * detalle.precio_unitario), 0);
      const total = subtotal;

      console.log('💰 Totales - Subtotal:', subtotal, 'Total:', total);

      const ventaResult = await client.query(
        `INSERT INTO ventas
       (modulo_id, numero_factura, cliente_nombre, cliente_documento, cliente_direccion, cliente_telefono, subtotal, total, usuario_id, metodo_pago, cliente_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
        [moduloId, numero_factura, cliente_nombre, cliente_documento, cliente_direccion, cliente_telefono, subtotal, total, usuario_id, metodo_pago, cliente_id || null]
      );
      
      const venta = ventaResult.rows[0];
      console.log('✅ Venta registrada con ID:', venta.id);
      
      for (const detalle of detalles) {
        // modulo_dueno_id queda fijo (snapshot) al momento de la venta: si el
        // producto cambia de dueño después, esta línea histórica sigue
        // atribuida a quien era dueño cuando realmente se vendió.
        await client.query(
          `INSERT INTO detalle_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal, modulo_dueno_id, costo_unitario, promocion_id, promocion_nombre)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [venta.id, detalle.producto_id, detalle.cantidad, detalle.precio_unitario,
           detalle.subtotal !== undefined ? detalle.subtotal : detalle.cantidad * detalle.precio_unitario,
           duenoPorProducto.get(detalle.producto_id), costoPorProducto.get(detalle.producto_id),
           detalle.promocion_id || null, detalle.promocion_nombre || null]
        );

        if (!productosQueIgnoranStock.has(detalle.producto_id)) {
          // Sin "AND modulo_id = ..." aquí: el producto puede ser de otro
          // módulo (compartido). Ya se validó arriba, con el mismo FOR UPDATE,
          // que este módulo puede venderlo — el stock es una sola fila física
          // y se descuenta por su propio id sin importar quién lo vendió.
          await client.query(
            'UPDATE productos SET stock_actual = stock_actual - $1, fecha_actualizacion = NOW() WHERE id = $2',
            [detalle.cantidad, detalle.producto_id]
          );
        }
      }

      // Registro automático en caja: si esto falla, hace throw y cae al
      // catch de abajo, que hace ROLLBACK de toda la venta — no debe poder
      // completarse una venta sin su movimiento de caja correspondiente.
      // Excepciones: a crédito no es efectivo real todavía (se registra
      // cuando el cliente abona), y consumo propio no es efectivo real en
      // absoluto (mercancía retirada para uso personal, no una venta).
      if (metodo_pago !== 'credito' && metodo_pago !== 'consumo_propio') {
        await registrarIngresosVenta(client, {
          negocioId,
          moduloVendedorId: moduloId,
          metodoPago: metodo_pago,
          ventaId: venta.id,
          numeroFactura: numero_factura,
          usuarioId: usuario_id,
          detalles,
          duenoPorProducto
        });
      }

      await client.query('COMMIT');
      console.log('✅ Transacción completada exitosamente');
      
      const ventaCompleta = await client.query(
        `SELECT v.*, 
              n.nombre as negocio_nombre,
              n.direccion as negocio_direccion,
              n.telefono as negocio_telefono,
              n.email as negocio_email,
              n.ruc_nit as negocio_ruc_nit,
              m.nombre as modulo_nombre,
              u.nombre as vendedor_nombre,
              json_agg(
                json_build_object(
                  'id', dv.id,
                  'producto_id', dv.producto_id,
                  'producto_nombre', p.nombre,
                  'promocion_nombre', dv.promocion_nombre,
                  'cantidad', dv.cantidad,
                  'precio_unitario', dv.precio_unitario,
                  'subtotal', dv.subtotal
                )
              ) as detalles
       FROM ventas v
       JOIN modulos m ON v.modulo_id = m.id
       JOIN negocios n ON m.negocio_id = n.id
       JOIN usuarios u ON v.usuario_id = u.id
       LEFT JOIN detalle_venta dv ON v.id = dv.venta_id
       LEFT JOIN productos p ON dv.producto_id = p.id
       WHERE v.id = $1
       GROUP BY v.id, n.id, m.id, u.id`,
        [venta.id]
      );

      res.status(201).json(ventaCompleta.rows[0]);

    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }
      console.error('❌ ERROR registrando venta:', error);
      // error.code solo lo trae el driver de Postgres (errores internos, p.ej.
      // constraints); los `throw new Error(...)` propios de esta ruta (stock
      // insuficiente, producto no encontrado, cantidad inválida) no lo tienen
      // y sí son seguros de mostrar al usuario tal cual.
      const mensaje = error.code ? 'Error al procesar la venta' : error.message;
      res.status(400).json({ error: mensaje });
    } finally {
      if (client) client.release();
    }
  });

  app.get('/api/ventas', authenticateToken, checkAccess, async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const { limit = 50 } = req.query;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const result = await pool.query(
        `SELECT v.*, u.nombre as vendedor_nombre
       FROM ventas v
       JOIN usuarios u ON v.usuario_id = u.id
       WHERE v.modulo_id = $1
       ORDER BY v.fecha_venta DESC
       LIMIT $2`,
        [moduloId, limit]
      );

      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo ventas:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Historial de ventas de un día (hora Colombia), con o sin cliente. Sirve para
  // revisar qué se cobró en una cuenta sin cliente asignado sin saber el número
  // de factura. ?sin_cliente=1 deja solo las ventas sin cliente registrado.
  app.get('/api/ventas/del-dia', authenticateToken, checkAccess, async (req, res) => {
    try {
      const moduloId = req.moduloId;
      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }
      const fecha = /^\d{4}-\d{2}-\d{2}$/.test(req.query.fecha || '')
        ? req.query.fecha
        : ahoraColombia().format('YYYY-MM-DD');
      const soloSinCliente = req.query.sin_cliente === '1';

      const result = await pool.query(
        `SELECT v.id, v.numero_factura, v.fecha_venta, v.cliente_nombre, v.cliente_id, v.total,
              v.metodo_pago, v.es_ajuste_manual, u.nombre AS vendedor_nombre,
              (SELECT string_agg(dv.cantidad || ' ' || p.nombre, ', ' ORDER BY dv.id)
               FROM detalle_venta dv JOIN productos p ON p.id = dv.producto_id
               WHERE dv.venta_id = v.id) AS productos
       FROM ventas v
       LEFT JOIN usuarios u ON u.id = v.usuario_id
       WHERE v.modulo_id = $1
         AND (v.fecha_venta AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::date = $2::date
         AND ($3::boolean = false OR v.cliente_id IS NULL)
       ORDER BY v.fecha_venta DESC`,
        [moduloId, fecha, soloSinCliente]
      );

      res.json({ fecha, ventas: result.rows });
    } catch (error) {
      console.error('Error obteniendo ventas del día:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Buscador de facturas por número (ej. "FAC001231") — para revisar rápido
  // qué se compró y cuándo, pegando el serial impreso en el recibo. Búsqueda
  // parcial e insensible a mayúsculas (no hace falta copiar el número
  // completo), acotada al módulo activo porque numero_factura solo es único
  // dentro de cada módulo (cada uno tiene su propia secuencia). Devuelve una
  // lista liviana; el detalle completo se pide aparte con GET /:id/factura.
  app.get('/api/ventas/buscar-factura', authenticateToken, checkAccess, async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const q = (req.query.q || '').trim();

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }
      if (!q) {
        return res.status(400).json({ error: 'Se requiere un término de búsqueda (q)' });
      }

      const result = await pool.query(
        `SELECT v.id, v.numero_factura, v.fecha_venta, v.cliente_nombre, v.total, v.metodo_pago, v.es_ajuste_manual
       FROM ventas v
       WHERE v.modulo_id = $1 AND UPPER(v.numero_factura) LIKE '%' || UPPER($2) || '%'
       ORDER BY v.fecha_venta DESC
       LIMIT 20`,
        [moduloId, q]
      );

      res.json(result.rows);
    } catch (error) {
      console.error('Error buscando factura:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.get('/api/ventas/:id/factura', authenticateToken, checkAccess, async (req, res) => {
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const result = await pool.query(
        `SELECT v.*,
              n.nombre as negocio_nombre,
              n.direccion as negocio_direccion,
              n.telefono as negocio_telefono,
              n.email as negocio_email,
              n.ruc_nit as negocio_ruc_nit,
              m.nombre as modulo_nombre,
              u.nombre as vendedor_nombre,
              CASE WHEN v.cliente_id IS NOT NULL THEN (
                (SELECT COALESCE(SUM(v2.total), 0) FROM ventas v2
                 WHERE v2.modulo_id = v.modulo_id AND v2.cliente_id = v.cliente_id AND v2.metodo_pago = 'credito')
                -
                (SELECT COALESCE(SUM(mc.monto), 0) FROM movimientos_caja mc
                 WHERE mc.cliente_id = v.cliente_id AND mc.origen = 'manual' AND mc.categoria = 'abono_credito')
              ) ELSE NULL END AS cliente_deuda_actual,
              json_agg(
                json_build_object(
                  'producto_nombre', p.nombre,
                  'cantidad', dv.cantidad,
                  'precio_unitario', dv.precio_unitario,
                  'subtotal', dv.subtotal
                )
              ) as detalles
       FROM ventas v
       JOIN modulos m ON v.modulo_id = m.id
       JOIN negocios n ON m.negocio_id = n.id
       JOIN usuarios u ON v.usuario_id = u.id
       LEFT JOIN detalle_venta dv ON v.id = dv.venta_id
       LEFT JOIN productos p ON dv.producto_id = p.id
       WHERE v.id = $1 AND v.modulo_id = $2
       GROUP BY v.id, n.id, m.id, u.id`,
        [id, moduloId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Factura no encontrada' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error obteniendo factura:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  return {};
};
