// Rutas: Pedidos de clientes (panel del negocio) y notificaciones push.
// Movidas desde server.js (secciones: RUTAS DE PEDIDOS DE CLIENTE (PANEL DEL NEGOCIO) · RUTAS DE NOTIFICACIONES PUSH).
// Reciben ctx con lo que server.js prepara (app, pool, middlewares, helpers)
// y lo que exportan los grupos registrados antes; devuelven lo que otros usan.
module.exports = function registrarRutas(ctx) {
  const {
    authenticateToken, checkAccess, generarNumeroFactura, generarNumeroCliente, sellos,
    registrarIngresosVenta, app, pool, planes
  } = ctx;

  // ==================== RUTAS DE PEDIDOS DE CLIENTE (PANEL DEL NEGOCIO) ====================
  // Tanda 3 de 3 del "Menú QR": gestión, del lado del negocio, de los
  // pedidos creados por clientes desde /menu/:moduloId (Tanda 2). Con
  // authenticateToken + checkAccess pero SIN requireAdmin: tanto admin
  // como trabajador deben poder gestionarlos, igual que ya operan el POS.

  // Lista los pedidos del módulo activo. 'pendiente'/'confirmado' primero
  // (son los que necesitan acción), luego 'completado'/'cancelado' al
  // final — cada grupo por fecha_creacion descendente.
  app.get('/api/pedidos-cliente', authenticateToken, checkAccess, async (req, res) => {
    try {
      const moduloId = req.moduloId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const pedidosResult = await pool.query(
        `SELECT * FROM pedidos_cliente
       WHERE modulo_id = $1
       ORDER BY
         CASE estado
           WHEN 'pendiente' THEN 0
           WHEN 'confirmado' THEN 0
           ELSE 1
         END,
         fecha_creacion DESC`,
        [moduloId]
      );

      const pedidos = pedidosResult.rows;
      if (pedidos.length === 0) {
        return res.json([]);
      }

      const detallesResult = await pool.query(
        `SELECT * FROM pedidos_cliente_detalle
       WHERE pedido_cliente_id = ANY($1)
       ORDER BY id`,
        [pedidos.map(p => p.id)]
      );

      const detallesPorPedido = {};
      for (const detalle of detallesResult.rows) {
        if (!detallesPorPedido[detalle.pedido_cliente_id]) {
          detallesPorPedido[detalle.pedido_cliente_id] = [];
        }
        detallesPorPedido[detalle.pedido_cliente_id].push(detalle);
      }

      res.json(pedidos.map(p => ({ ...p, detalles: detallesPorPedido[p.id] || [] })));
    } catch (error) {
      console.error('Error listando pedidos de cliente:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Detalle completo de un pedido, validando que pertenezca al módulo del
  // usuario (un trabajador/admin de otro módulo no debe poder verlo).
  app.get('/api/pedidos-cliente/:id', authenticateToken, checkAccess, async (req, res) => {
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const pedidoResult = await pool.query(
        'SELECT * FROM pedidos_cliente WHERE id = $1 AND modulo_id = $2',
        [id, moduloId]
      );

      if (pedidoResult.rows.length === 0) {
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }

      const detalleResult = await pool.query(
        'SELECT * FROM pedidos_cliente_detalle WHERE pedido_cliente_id = $1 ORDER BY id',
        [id]
      );

      res.json({ ...pedidoResult.rows[0], detalles: detalleResult.rows });
    } catch (error) {
      console.error('Error obteniendo pedido de cliente:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // El negocio edita mesa_nombre/items. A diferencia de la ruta pública
  // (PUT /api/menu/pedido/:token), esta SÍ permite editar en 'confirmado'
  // (el negocio puede necesitar ajustar cantidades al preparar el pedido),
  // pero no en 'completado'/'cancelado'.
  app.put('/api/pedidos-cliente/:id', authenticateToken, checkAccess, async (req, res) => {
    // pool.connect() dentro del try: mismo motivo que en las rutas
    // públicas de la Tanda 2 (un fallo de conexión no debe tumbar el
    // proceso completo).
    let client;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const { id } = req.params;
      const moduloId = req.moduloId;
      const { mesa_nombre, monto_recibido, items } = req.body;

      if (!moduloId) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const pedidoResult = await client.query(
        'SELECT * FROM pedidos_cliente WHERE id = $1 AND modulo_id = $2 FOR UPDATE',
        [id, moduloId]
      );

      if (pedidoResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }

      const pedido = pedidoResult.rows[0];

      if (!['pendiente', 'confirmado'].includes(pedido.estado)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Este pedido ya no se puede editar' });
      }

      if (!mesa_nombre || !mesa_nombre.trim()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Ingresa el nombre del cliente' });
      }

      if (!Array.isArray(items) || items.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'El pedido debe tener al menos un producto' });
      }

      let montoRecibidoValido = null;
      if (monto_recibido !== undefined && monto_recibido !== null && monto_recibido !== '') {
        const val = Number(monto_recibido);
        if (!Number.isFinite(val) || val < 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Monto recibido inválido' });
        }
        montoRecibidoValido = val;
      }

      const detallesValidados = [];
      let subtotal = 0;

      for (const item of items) {
        const cantidad = Number(item.cantidad);
        if (!Number.isFinite(cantidad) || cantidad <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Cantidad inválida para el producto ${item.producto_id}` });
        }

        const productoResult = await client.query(
          'SELECT id, nombre, precio_venta, stock_actual, ignora_stock FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true',
          [item.producto_id, moduloId]
        );

        if (productoResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Producto no disponible: ${item.producto_id}` });
        }

        const producto = productoResult.rows[0];
        if (!producto.ignora_stock && cantidad > producto.stock_actual) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: `No hay suficiente stock de "${producto.nombre}". Disponible: ${producto.stock_actual}`
          });
        }

        const precioUnitario = Number(producto.precio_venta);
        const subtotalItem = cantidad * precioUnitario;
        subtotal += subtotalItem;

        detallesValidados.push({
          producto_id: producto.id,
          nombre_producto: producto.nombre,
          cantidad,
          precio_unitario: precioUnitario,
          subtotal: subtotalItem
        });
      }

      const total = subtotal;

      await client.query('DELETE FROM pedidos_cliente_detalle WHERE pedido_cliente_id = $1', [pedido.id]);

      for (const detalle of detallesValidados) {
        await client.query(
          `INSERT INTO pedidos_cliente_detalle
         (pedido_cliente_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
          [pedido.id, detalle.producto_id, detalle.nombre_producto, detalle.cantidad, detalle.precio_unitario, detalle.subtotal]
        );
      }

      const actualizado = await client.query(
        `UPDATE pedidos_cliente
       SET mesa_nombre = $1, monto_recibido = $2, subtotal = $3, total = $4, fecha_actualizacion = NOW()
       WHERE id = $5
       RETURNING *`,
        [mesa_nombre.trim(), montoRecibidoValido, subtotal, total, pedido.id]
      );

      await client.query('COMMIT');

      res.json({ ...actualizado.rows[0], detalles: detallesValidados });
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }
      console.error('Error editando pedido de cliente (panel negocio):', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  // El negocio marca que ya vio el pedido, sin importar si el cliente ya
  // había confirmado su lado o no (puede procesarlo antes de que el
  // cliente le dé "confirmar" en su pantalla).
  app.put('/api/pedidos-cliente/:id/confirmar', authenticateToken, checkAccess, async (req, res) => {
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const pedidoResult = await pool.query(
        'SELECT * FROM pedidos_cliente WHERE id = $1 AND modulo_id = $2',
        [id, moduloId]
      );

      if (pedidoResult.rows.length === 0) {
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }

      const pedido = pedidoResult.rows[0];

      if (pedido.estado !== 'pendiente') {
        return res.status(400).json({ error: 'Este pedido ya no está pendiente' });
      }

      const actualizado = await pool.query(
        `UPDATE pedidos_cliente SET estado = 'confirmado', fecha_actualizacion = NOW() WHERE id = $1 RETURNING *`,
        [pedido.id]
      );

      res.json(actualizado.rows[0]);
    } catch (error) {
      console.error('Error confirmando pedido de cliente (panel negocio):', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // LA RUTA IMPORTANTE: completa un pedido_cliente convirtiéndolo en una
  // venta real, con descuento de stock real. Reutiliza exactamente el
  // mismo patrón transaccional que POST /api/ventas (mismo helper de
  // número de factura, mismo criterio de movimientos_caja) para no
  // duplicar reglas de negocio que puedan divergir con el tiempo.
  // Marca si el cliente ya pagó un pedido pendiente (ej. transfirió antes
  // de que se lo lleven) o si falta pagar. Al entregarlo se usa ese dato para
  // registrar la venta con su método, o como fiado si no ha pagado.
  app.put('/api/pedidos-cliente/:id/pago', authenticateToken, checkAccess, async (req, res) => {
    try {
      const { pagado, metodo_pago } = req.body;
      if (typeof pagado !== 'boolean') {
        return res.status(400).json({ error: 'pagado debe ser true o false' });
      }
      const metodo = pagado ? (metodo_pago || 'efectivo') : null;
      if (metodo && !['efectivo', 'transferencia', 'tarjeta'].includes(metodo)) {
        return res.status(400).json({ error: 'Método de pago inválido' });
      }
      const result = await pool.query(
        `UPDATE pedidos_cliente SET pagado = $1, metodo_pago_cliente = $2, fecha_actualizacion = NOW()
       WHERE id = $3 AND modulo_id = $4 AND estado IN ('pendiente', 'confirmado')
       RETURNING id, pagado, metodo_pago_cliente`,
        [pagado, metodo, req.params.id, req.moduloId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Pedido no encontrado o ya fue entregado/cancelado' });
      }
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error actualizando pago del pedido:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // El negocio revisa el comprobante que subió el cliente: aprobarlo deja el
  // pedido como pagado por transferencia; rechazarlo lo deja pendiente de
  // pago (el cliente puede subir otro).
  app.put('/api/pedidos-cliente/:id/comprobante', authenticateToken, checkAccess, async (req, res) => {
    try {
      const { aprobar } = req.body;
      if (typeof aprobar !== 'boolean') {
        return res.status(400).json({ error: 'aprobar debe ser true o false' });
      }
      const result = await pool.query(
        `UPDATE pedidos_cliente
       SET comprobante_estado = $1,
           pagado = $2,
           metodo_pago_cliente = CASE WHEN $2 THEN 'transferencia' ELSE NULL END,
           fecha_actualizacion = NOW()
       WHERE id = $3 AND modulo_id = $4 AND comprobante_url IS NOT NULL AND estado IN ('pendiente', 'confirmado')
       RETURNING id, pagado, metodo_pago_cliente, comprobante_estado`,
        [aprobar ? 'aprobado' : 'rechazado', aprobar, req.params.id, req.moduloId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Pedido no encontrado, sin comprobante o ya entregado' });
      }
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error revisando comprobante:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.put('/api/pedidos-cliente/:id/completar', authenticateToken, checkAccess, async (req, res) => {
    let client;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const { id } = req.params;
      const moduloId = req.moduloId;
      const negocioId = req.negocioId;
      const usuarioId = req.user.id;
      const { metodo_pago, fiado_auto } = req.body;
      let { cliente_id } = req.body;

      if (!moduloId) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      if (!metodo_pago) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Selecciona un método de pago' });
      }

      // Una venta a crédito es una deuda del cliente, no efectivo real, así
      // que necesita un cliente identificable para poder cobrarla después
      // — mismo criterio que ya exige POST /api/ventas. pedidos_cliente no
      // tiene cliente_id propio (el cliente del menú QR no tiene cuenta),
      // así que el negocio debe pasarlo explícitamente al completar.
      // fiado_auto: entregado sin pagar desde la Ruta de Entregas. El cliente
      // se busca por teléfono (o se crea con el nombre y teléfono del pedido)
      // más abajo, cuando ya se tiene el pedido.
      if (metodo_pago === 'credito' && !cliente_id && !fiado_auto) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Para completar como crédito, este pedido necesita un cliente registrado primero' });
      }

      // Los clientes son por módulo (no por negocio) — mismo criterio que
      // POST /api/ventas.
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

      // FOR UPDATE: bloquea la fila del pedido hasta el COMMIT/ROLLBACK,
      // para que no se pueda completar/cancelar el mismo pedido dos veces
      // en paralelo.
      const pedidoResult = await client.query(
        'SELECT * FROM pedidos_cliente WHERE id = $1 AND modulo_id = $2 FOR UPDATE',
        [id, moduloId]
      );

      if (pedidoResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }

      const pedido = pedidoResult.rows[0];

      if (!['pendiente', 'confirmado'].includes(pedido.estado)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Este pedido ya fue completado o cancelado' });
      }

      if (metodo_pago === 'credito' && !cliente_id && fiado_auto) {
        const telefono = (pedido.telefono || '').replace(/\D/g, '');
        const existente = telefono
          ? await client.query(
              `SELECT id FROM clientes WHERE modulo_id = $1 AND regexp_replace(COALESCE(telefono, ''), '[^0-9]', '', 'g') = $2
             ORDER BY id LIMIT 1`,
              [moduloId, telefono]
            )
          : { rows: [] };
        if (existente.rows.length > 0) {
          cliente_id = existente.rows[0].id;
        } else {
          const numeroCliente = await generarNumeroCliente(moduloId, pool);
          const nuevo = await client.query(
            `INSERT INTO clientes (negocio_id, modulo_id, numero_cliente, nombre, telefono, direccion)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [negocioId, moduloId, numeroCliente, pedido.mesa_nombre, pedido.telefono || null, pedido.direccion_entrega || null]
          );
          cliente_id = nuevo.rows[0].id;
        }
      }

      const detalleResult = await client.query(
        'SELECT * FROM pedidos_cliente_detalle WHERE pedido_cliente_id = $1 ORDER BY id',
        [pedido.id]
      );
      const detalles = detalleResult.rows;

      if (detalles.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Este pedido no tiene productos' });
      }

      // El stock pudo haber cambiado desde que se creó el pedido (otras
      // ventas, otros pedidos completados) — se revalida con FOR UPDATE
      // antes de descontar, igual que POST /api/ventas. Productos con
      // ignora_stock = true (ej. "Preparados") se saltan la validación y no
      // descuentan stock_actual más abajo.
      const productosQueIgnoranStock = new Set();
      // Snapshot del costo al momento de la venta (ver mismo campo en POST /api/ventas)
      const costoPorProducto = new Map();
      const unidadesPorProducto = new Map();
      for (const d of detalles) {
        unidadesPorProducto.set(d.producto_id, (unidadesPorProducto.get(d.producto_id) || 0) + Number(d.cantidad));
      }

      for (const detalle of detalles) {
        const stockResult = await client.query(
          'SELECT id, nombre, stock_actual, ignora_stock, precio_compra FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true FOR UPDATE',
          [detalle.producto_id, moduloId]
        );

        if (stockResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Producto no encontrado o inactivo: ${detalle.nombre_producto}` });
        }

        const producto = stockResult.rows[0];
        costoPorProducto.set(detalle.producto_id, producto.precio_compra);
        if (producto.ignora_stock) {
          productosQueIgnoranStock.add(detalle.producto_id);
        } else if (producto.stock_actual < unidadesPorProducto.get(detalle.producto_id)) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: `Stock insuficiente para "${producto.nombre}". Stock actual: ${producto.stock_actual}, solicitado: ${unidadesPorProducto.get(detalle.producto_id)}`
          });
        }
      }

      const numero_factura = await generarNumeroFactura(moduloId, pool);

      const ventaResult = await client.query(
        `INSERT INTO ventas
       (modulo_id, numero_factura, cliente_nombre, subtotal, total, usuario_id, metodo_pago, cliente_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
        [moduloId, numero_factura, pedido.mesa_nombre, pedido.subtotal, pedido.total, usuarioId, metodo_pago, cliente_id || null]
      );

      const venta = ventaResult.rows[0];

      // modulo_dueno_id = moduloId siempre aquí: el lookup de stock de arriba
      // exige "AND modulo_id = $2" (sin EXISTS de compartidos como en POST
      // /api/ventas), así que este flujo todavía no vende productos de otro
      // módulo — pero igual hay que grabarlo explícito, no dejarlo en NULL,
      // para que Estadísticas/Finanzas (que atribuyen por modulo_dueno_id)
      // no pierdan estas ventas.
      for (const detalle of detalles) {
        await client.query(
          `INSERT INTO detalle_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal, modulo_dueno_id, costo_unitario, promocion_id, promocion_nombre)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [venta.id, detalle.producto_id, detalle.cantidad, detalle.precio_unitario, detalle.subtotal, moduloId, costoPorProducto.get(detalle.producto_id),
           detalle.promocion_id || null, detalle.promocion_nombre || null]
        );

        if (!productosQueIgnoranStock.has(detalle.producto_id)) {
          await client.query(
            'UPDATE productos SET stock_actual = stock_actual - $1, fecha_actualizacion = NOW() WHERE id = $2 AND modulo_id = $3',
            [detalle.cantidad, detalle.producto_id, moduloId]
          );
        }
      }

      // Mismo criterio que POST /api/ventas: crédito no es efectivo real
      // todavía, y consumo_propio no es una venta real en absoluto. Ninguno
      // de los dos debería llegar aquí desde el selector del frontend, pero
      // se deja la misma condición por si se completa alguna vez vía API
      // directa con un metodo_pago fuera de los que ofrece la UI.
      if (metodo_pago !== 'credito' && metodo_pago !== 'consumo_propio') {
        await registrarIngresosVenta(client, {
          negocioId,
          moduloVendedorId: moduloId,
          metodoPago: metodo_pago,
          ventaId: venta.id,
          numeroFactura: numero_factura,
          usuarioId,
          detalles,
          duenoPorProducto: new Map(detalles.map(d => [d.producto_id, moduloId]))
        });
      }

      const pedidoCompletado = await client.query(
        `UPDATE pedidos_cliente SET estado = 'completado', venta_id = $1, fecha_actualizacion = NOW() WHERE id = $2 RETURNING *`,
        [venta.id, pedido.id]
      );

      const sellado = await sellos.sellarPedido(client, pedido);

      await client.query('COMMIT');

      res.json({ ...pedidoCompletado.rows[0], venta, sello_sumado: sellado === true });
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }
      console.error('Error completando pedido de cliente:', error);
      const mensaje = error.code ? 'Error al completar el pedido' : error.message;
      res.status(400).json({ error: mensaje });
    } finally {
      if (client) client.release();
    }
  });

  // El negocio cancela un pedido (desde 'pendiente' o 'confirmado', no
  // desde 'completado' — una venta ya registrada no se deshace por aquí).
  app.put('/api/pedidos-cliente/:id/cancelar', authenticateToken, checkAccess, async (req, res) => {
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const pedidoResult = await pool.query(
        'SELECT * FROM pedidos_cliente WHERE id = $1 AND modulo_id = $2',
        [id, moduloId]
      );

      if (pedidoResult.rows.length === 0) {
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }

      const pedido = pedidoResult.rows[0];

      if (!['pendiente', 'confirmado'].includes(pedido.estado)) {
        return res.status(400).json({ error: 'Este pedido ya no se puede cancelar' });
      }

      const actualizado = await pool.query(
        `UPDATE pedidos_cliente SET estado = 'cancelado', fecha_actualizacion = NOW() WHERE id = $1 RETURNING *`,
        [pedido.id]
      );

      res.json(actualizado.rows[0]);
    } catch (error) {
      console.error('Error cancelando pedido de cliente (panel negocio):', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Posición de una parada en la Ruta de Entregas. Solo aplica a pedidos a
  // domicilio — uno para recoger en el local no tiene "parada" que ordenar.
  // orden_ruta null es válido (vuelve a quedar "sin asignar", al final de
  // la lista en el frontend).
  app.put('/api/pedidos-cliente/:id/orden-ruta', authenticateToken, checkAccess, planes.requierePlan(pool, 'domicilios'), async (req, res) => {
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;
      const { orden_ruta } = req.body;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      let ordenValido = null;
      if (orden_ruta !== null && orden_ruta !== undefined && orden_ruta !== '') {
        ordenValido = parseInt(orden_ruta, 10);
        if (!Number.isFinite(ordenValido)) {
          return res.status(400).json({ error: 'orden_ruta debe ser un número' });
        }
      }

      const pedidoResult = await pool.query(
        'SELECT id, es_domicilio FROM pedidos_cliente WHERE id = $1 AND modulo_id = $2',
        [id, moduloId]
      );

      if (pedidoResult.rows.length === 0) {
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }

      if (!pedidoResult.rows[0].es_domicilio) {
        return res.status(400).json({ error: 'Este pedido no es a domicilio' });
      }

      const result = await pool.query(
        'UPDATE pedidos_cliente SET orden_ruta = $1 WHERE id = $2 RETURNING *',
        [ordenValido, id]
      );

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error actualizando orden de ruta:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Etapa de preparación de un pedido activo: 'empacado' (para recoger:
  // listo para recoger) y 'en_camino' (solo domicilios); null lo devuelve a
  // "recibido". Empacar un pedido pendiente lo da por confirmado. El cliente
  // la ve en su pantalla del pedido y en "Mis pedidos" del menú. Entregarlo
  // sigue siendo "Completar" (registra la venta).
  app.put('/api/pedidos-cliente/:id/etapa', authenticateToken, checkAccess, async (req, res) => {
    try {
      const moduloId = req.moduloId;
      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }
      const etapa = req.body?.etapa || null;
      if (etapa !== null && !['empacado', 'en_camino'].includes(etapa)) {
        return res.status(400).json({ error: 'Etapa no válida' });
      }

      const { rows: [pedido] } = await pool.query(
        'SELECT id, estado, es_domicilio FROM pedidos_cliente WHERE id = $1 AND modulo_id = $2',
        [req.params.id, moduloId]
      );
      if (!pedido) {
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }
      if (!['pendiente', 'confirmado'].includes(pedido.estado)) {
        return res.status(400).json({ error: 'Este pedido ya fue entregado o cancelado' });
      }
      if (etapa === 'en_camino') {
        if (!pedido.es_domicilio) {
          return res.status(400).json({ error: 'Solo los pedidos a domicilio se envían' });
        }
        if (!(await planes.moduloIncluye(pool, moduloId, 'domicilios'))) {
          const plan = await planes.planDeModulo(pool, moduloId);
          return res.status(403).json({ error: planes.mensajeBloqueo(plan, 'domicilios'), plan_bloqueado: 'domicilios' });
        }
      }

      // Las fechas guardan cuándo pasó por cada etapa; al devolverla se
      // borran las de las etapas siguientes.
      const { rows: [actualizado] } = await pool.query(
        `UPDATE pedidos_cliente
         SET etapa = $1::text,
             estado = CASE WHEN $1::text IS NULL THEN estado ELSE 'confirmado' END,
             fecha_empacado = CASE WHEN $1::text IS NULL THEN NULL ELSE COALESCE(fecha_empacado, NOW()) END,
             fecha_en_camino = CASE WHEN $1::text = 'en_camino' THEN COALESCE(fecha_en_camino, NOW()) ELSE NULL END,
             fecha_actualizacion = NOW()
         WHERE id = $2
         RETURNING *`,
        [etapa, pedido.id]
      );
      res.json(actualizado);
    } catch (error) {
      console.error('Error cambiando la etapa del pedido:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Borra de una sola vez todos los pedidos 'cancelado' del módulo activo,
  // para limpiar de golpe en vez de uno por uno. Registrada ANTES de
  // DELETE /:id para que Express no confunda "cancelados" con un :id.
  app.delete('/api/pedidos-cliente/cancelados', authenticateToken, checkAccess, async (req, res) => {
    try {
      const moduloId = req.moduloId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const resultado = await pool.query(
        `DELETE FROM pedidos_cliente WHERE modulo_id = $1 AND estado = 'cancelado' RETURNING id`,
        [moduloId]
      );

      res.json({ eliminados: resultado.rowCount });
    } catch (error) {
      console.error('Error eliminando pedidos cancelados:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Borra un pedido individual. Solo 'pendiente'/'cancelado': un pedido
  // 'confirmado'/'completado' es parte del historial real del negocio (el
  // segundo, además, ya generó una venta) y no debe poder desaparecer.
  app.delete('/api/pedidos-cliente/:id', authenticateToken, checkAccess, async (req, res) => {
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const pedidoResult = await pool.query(
        'SELECT * FROM pedidos_cliente WHERE id = $1 AND modulo_id = $2',
        [id, moduloId]
      );

      if (pedidoResult.rows.length === 0) {
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }

      const pedido = pedidoResult.rows[0];

      if (!['pendiente', 'cancelado'].includes(pedido.estado)) {
        return res.status(400).json({
          error: 'No se puede eliminar un pedido confirmado o completado — son parte del historial real del negocio'
        });
      }

      // pedidos_cliente_detalle se borra solo por el ON DELETE CASCADE.
      await pool.query('DELETE FROM pedidos_cliente WHERE id = $1', [pedido.id]);

      res.json({ ok: true });
    } catch (error) {
      console.error('Error eliminando pedido de cliente:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ==================== RUTAS DE NOTIFICACIONES PUSH ====================
  // Suscripción/desuscripción del navegador de cada admin/trabajador a
  // notificaciones push de pedidos nuevos del menú QR. Con authenticateToken
  // + checkAccess pero SIN requireAdmin, igual que el resto del panel de
  // pedidos de cliente: tanto admin como trabajador deben poder activarlas.

  // Guarda (o actualiza, si el endpoint ya existía) la suscripción del
  // navegador actual. El shape { endpoint, keys: { p256dh, auth } } es
  // exactamente el que devuelve PushSubscription.toJSON() en el navegador.
  app.post('/api/push/suscribir', authenticateToken, checkAccess, async (req, res) => {
    try {
      const { endpoint, keys } = req.body;

      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ error: 'Suscripción inválida' });
      }

      await pool.query(
        `INSERT INTO push_suscripciones (usuario_id, negocio_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE
         SET usuario_id = EXCLUDED.usuario_id,
             negocio_id = EXCLUDED.negocio_id,
             p256dh = EXCLUDED.p256dh,
             auth = EXCLUDED.auth`,
        [req.user.id, req.negocioId, endpoint, keys.p256dh, keys.auth]
      );

      res.status(201).json({ ok: true });
    } catch (error) {
      console.error('Error guardando suscripción push:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Borra la suscripción del navegador actual (el usuario apagó las
  // notificaciones, o el navegador la invalidó y el frontend limpia su lado).
  app.delete('/api/push/suscribir', authenticateToken, checkAccess, async (req, res) => {
    try {
      const { endpoint } = req.body;

      if (!endpoint) {
        return res.status(400).json({ error: 'Se requiere el endpoint de la suscripción' });
      }

      await pool.query('DELETE FROM push_suscripciones WHERE endpoint = $1', [endpoint]);

      res.json({ ok: true });
    } catch (error) {
      console.error('Error borrando suscripción push:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  return {};
};
