// Rutas: Clientes y fiados.
// Movidas desde server.js (secciones: RUTAS DE CLIENTES).
// Reciben ctx con lo que server.js prepara (app, pool, middlewares, helpers)
// y lo que exportan los grupos registrados antes; devuelven lo que otros usan.
module.exports = function registrarRutas(ctx) {
  const {
    authenticateToken, checkAccess, generarNumeroFactura, generarNumeroCliente, BOLSILLOS_MANUALES,
    app, pool, requirePermiso
  } = ctx;

  // ==================== RUTAS DE CLIENTES ====================

  // Listar / buscar clientes del módulo (admin y trabajador, para el autocomplete del POS).
  // Los clientes son por módulo (no por negocio): cada módulo tiene su propia
  // lista de clientes y su propia deuda/crédito, independiente de otros
  // módulos del mismo negocio.
  app.get('/api/clientes', authenticateToken, checkAccess, async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const { search, numero_cliente } = req.query;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      // deuda_actual = ventas a crédito de ese cliente (metodo_pago='credito',
      // que ya no generan ingreso automático en caja) menos sus abonos.
      // Los abonos usan origen='manual' (categoria='abono_credito' los
      // distingue) porque el CHECK de movimientos_caja.origen solo admite
      // 'manual'/'venta'/'pedido' — 'abono_credito' no es un valor válido ahí.
      const deudaSelect = `(
        (SELECT COALESCE(SUM(v.total), 0)
         FROM ventas v
         WHERE v.modulo_id = clientes.modulo_id
         AND v.cliente_id = clientes.id AND v.metodo_pago = 'credito')
        -
        (SELECT COALESCE(SUM(mc.monto), 0)
         FROM movimientos_caja mc
         WHERE mc.cliente_id = clientes.id AND mc.origen = 'manual' AND mc.categoria = 'abono_credito')
      ) AS deuda_actual`;

      // Búsqueda exacta por numero_cliente: modo distinto al de nombre/cédula,
      // no se combinan. Si viene, ignora `search` por completo.
      if (numero_cliente !== undefined) {
        const numeroClienteStr = String(numero_cliente).trim();
        if (!/^\d+$/.test(numeroClienteStr) || parseInt(numeroClienteStr, 10) <= 0) {
          return res.status(400).json({ error: 'numero_cliente debe ser un entero positivo' });
        }

        const result = await pool.query(
          `SELECT clientes.*, ${deudaSelect} FROM clientes WHERE modulo_id = $1 AND activo = true AND numero_cliente = $2`,
          [moduloId, parseInt(numeroClienteStr, 10)]
        );

        return res.json(result.rows);
      }

      let query = `SELECT clientes.*, ${deudaSelect} FROM clientes WHERE modulo_id = $1 AND activo = true`;
      const params = [moduloId];

      if (search && search.trim() !== '') {
        params.push(`%${search.trim()}%`);
        query += ` AND (nombre ILIKE $${params.length} OR cedula ILIKE $${params.length})`;
      }

      query += ' ORDER BY nombre LIMIT 50';

      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo clientes:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Detalle de un cliente (solo admin)
  app.get('/api/clientes/:id', authenticateToken, checkAccess, requirePermiso('clientes'), async (req, res) => {
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;

      const result = await pool.query(
        `SELECT clientes.*,
          (
            (SELECT COALESCE(SUM(v.total), 0)
             FROM ventas v
             WHERE v.modulo_id = clientes.modulo_id
             AND v.cliente_id = clientes.id AND v.metodo_pago = 'credito')
            -
            (SELECT COALESCE(SUM(mc.monto), 0)
             FROM movimientos_caja mc
             WHERE mc.cliente_id = clientes.id AND mc.origen = 'manual' AND mc.categoria = 'abono_credito')
          ) AS deuda_actual
       FROM clientes WHERE id = $1 AND modulo_id = $2`,
        [id, moduloId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Cliente no encontrado' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error obteniendo cliente:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Historial de compras de un cliente (solo admin)
  app.get('/api/clientes/:id/historial', authenticateToken, checkAccess, requirePermiso('clientes'), async (req, res) => {
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;

      // Confirmar que el cliente pertenece al módulo del usuario antes de exponer su historial
      const clienteResult = await pool.query(
        'SELECT id FROM clientes WHERE id = $1 AND modulo_id = $2',
        [id, moduloId]
      );

      if (clienteResult.rows.length === 0) {
        return res.status(404).json({ error: 'Cliente no encontrado' });
      }

      const result = await pool.query(
        `SELECT v.*,
              u.nombre as vendedor_nombre,
              json_agg(
                json_build_object(
                  'producto_id', dv.producto_id,
                  'producto_nombre', p.nombre,
                  'cantidad', dv.cantidad,
                  'precio_unitario', dv.precio_unitario,
                  'subtotal', dv.subtotal
                )
              ) as detalles
       FROM ventas v
       JOIN usuarios u ON v.usuario_id = u.id
       LEFT JOIN detalle_venta dv ON v.id = dv.venta_id
       LEFT JOIN productos p ON dv.producto_id = p.id
       WHERE v.cliente_id = $1 AND v.modulo_id = $2
       GROUP BY v.id, u.id
       ORDER BY v.fecha_venta DESC`,
        [id, moduloId]
      );

      // Abonos a crédito del cliente, para verlos junto a las ventas
      const abonosResult = await pool.query(
        `SELECT mc.*, u.nombre as usuario_nombre
       FROM movimientos_caja mc
       LEFT JOIN usuarios u ON mc.usuario_id = u.id
       WHERE mc.cliente_id = $1 AND mc.origen = 'manual' AND mc.categoria = 'abono_credito'
       ORDER BY mc.fecha DESC`,
        [id]
      );

      res.json({ ventas: result.rows, abonos: abonosResult.rows });
    } catch (error) {
      console.error('Error obteniendo historial del cliente:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Registrar un abono a la deuda de crédito de un cliente
  app.post('/api/clientes/:id/abonos', authenticateToken, checkAccess, requirePermiso('clientes'), async (req, res) => {
    try {
      const { id } = req.params;
      const negocioId = req.negocioId;
      const moduloId = req.moduloId;
      const usuarioId = req.user.id;
      const { monto, concepto, bolsillo } = req.body;

      // El abono cae en caja (efectivo) o nequi (transferencia).
      const bolsilloAbono = bolsillo === undefined || bolsillo === null || bolsillo === '' ? 'caja' : bolsillo;
      if (!BOLSILLOS_MANUALES.includes(bolsilloAbono)) {
        return res.status(400).json({ error: 'bolsillo inválido' });
      }

      const clienteResult = await pool.query(
        'SELECT id FROM clientes WHERE id = $1 AND modulo_id = $2',
        [id, moduloId]
      );
      if (clienteResult.rows.length === 0) {
        return res.status(404).json({ error: 'Cliente no encontrado' });
      }

      const montoNum = Number(monto);
      if (!Number.isFinite(montoNum) || montoNum <= 0) {
        return res.status(400).json({ error: 'monto debe ser un número mayor a cero' });
      }

      const conceptoFinal = concepto && concepto.trim() ? concepto.trim() : 'Abono a cuenta';

      // origen='manual' porque el CHECK de movimientos_caja.origen solo
      // admite 'manual'/'venta'/'pedido'; categoria='abono_credito' es la
      // marca (sin restricción) que distingue esto de un ingreso manual
      // cualquiera en el resto de las consultas de finanzas/deuda.
      const result = await pool.query(
        `INSERT INTO movimientos_caja
       (negocio_id, modulo_id, tipo, origen, monto, concepto, categoria, cliente_id, usuario_id, bolsillo)
       VALUES ($1, $2, 'ingreso', 'manual', $3, $4, 'abono_credito', $5, $6, $7)
       RETURNING *`,
        [negocioId, moduloId, montoNum, conceptoFinal, id, usuarioId, bolsilloAbono]
      );

      // Deuda actualizada tras el abono. No se bloquea si el abono supera la
      // deuda (puede ser un adelanto) — el frontend puede avisar con esto.
      const deudaResult = await pool.query(
        `SELECT
          (SELECT COALESCE(SUM(v.total), 0)
           FROM ventas v
           WHERE v.modulo_id = $1 AND v.cliente_id = $2 AND v.metodo_pago = 'credito')
          -
          (SELECT COALESCE(SUM(mc.monto), 0)
           FROM movimientos_caja mc
           WHERE mc.cliente_id = $2 AND mc.origen = 'manual' AND mc.categoria = 'abono_credito')
        AS deuda_actual`,
        [moduloId, id]
      );

      res.status(201).json({
        abono: result.rows[0],
        deuda_actual: deudaResult.rows[0].deuda_actual
      });
    } catch (error) {
      console.error('Error registrando abono:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Registrar deuda existente/histórica de un cliente (para dar de alta
  // deuda previa al sistema). Se registra como una venta a crédito sin
  // productos: reutiliza exactamente el mismo mecanismo que una venta a
  // crédito real desde el POS — cuenta en deuda_actual porque esta se
  // calcula directo sobre ventas.metodo_pago = 'credito', y no genera
  // movimiento de caja hasta que el cliente abone, igual que cualquier
  // venta a crédito. De aquí en adelante, la deuda nueva debe salir del
  // módulo de Ventas; esta ruta es solo para la carga inicial.
  app.post('/api/clientes/:id/deuda-manual', authenticateToken, checkAccess, requirePermiso('clientes'), async (req, res) => {
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;
      const usuarioId = req.user.id;
      const { monto, concepto } = req.body;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const clienteResult = await pool.query(
        'SELECT id, nombre, cedula, telefono, direccion FROM clientes WHERE id = $1 AND modulo_id = $2',
        [id, moduloId]
      );
      if (clienteResult.rows.length === 0) {
        return res.status(404).json({ error: 'Cliente no encontrado' });
      }
      const cliente = clienteResult.rows[0];

      const montoNum = Number(monto);
      if (!Number.isFinite(montoNum) || montoNum <= 0) {
        return res.status(400).json({ error: 'monto debe ser un número mayor a cero' });
      }

      const conceptoFinal = concepto && concepto.trim() ? concepto.trim() : 'Deuda registrada manualmente';

      const numero_factura = await generarNumeroFactura(moduloId, pool);

      const result = await pool.query(
        `INSERT INTO ventas
       (modulo_id, numero_factura, cliente_nombre, cliente_documento, cliente_direccion, cliente_telefono, subtotal, total, usuario_id, metodo_pago, cliente_id, es_ajuste_manual)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, 'credito', $9, true)
       RETURNING *`,
        [moduloId, numero_factura, cliente.nombre, cliente.cedula, cliente.direccion, cliente.telefono, montoNum, usuarioId, id]
      );

      const deudaResult = await pool.query(
        `SELECT
          (SELECT COALESCE(SUM(v.total), 0)
           FROM ventas v
           WHERE v.modulo_id = $1 AND v.cliente_id = $2 AND v.metodo_pago = 'credito')
          -
          (SELECT COALESCE(SUM(mc.monto), 0)
           FROM movimientos_caja mc
           WHERE mc.cliente_id = $2 AND mc.origen = 'manual' AND mc.categoria = 'abono_credito')
        AS deuda_actual`,
        [moduloId, id]
      );

      res.status(201).json({
        venta: result.rows[0],
        concepto: conceptoFinal,
        deuda_actual: deudaResult.rows[0].deuda_actual
      });
    } catch (error) {
      console.error('Error registrando deuda manual:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Crear cliente (admin y trabajador, para registro rápido desde el POS)
  app.post('/api/clientes', authenticateToken, checkAccess, async (req, res) => {
    try {
      const negocioId = req.negocioId;
      const moduloId = req.moduloId;
      const { nombre, cedula, telefono, direccion, email } = req.body;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'El nombre es requerido' });
      }

      // UNIQUE(modulo_id, cedula) permite múltiples NULL sin chocar, pero un
      // string vacío '' sí choca si hay más de un cliente sin cédula. La
      // misma cédula SÍ puede existir en otro módulo del mismo negocio (son
      // clientes independientes, con su propia deuda cada uno) — por eso la
      // unicidad es por módulo, no por negocio.
      const cedulaLimpia = cedula && cedula.trim() !== '' ? cedula.trim() : null;

      const numero_cliente = await generarNumeroCliente(moduloId, pool);

      const result = await pool.query(
        `INSERT INTO clientes (negocio_id, modulo_id, numero_cliente, nombre, cedula, telefono, direccion, email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
        [negocioId, moduloId, numero_cliente, nombre.trim(), cedulaLimpia, telefono || null, direccion || null, email || null]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe un cliente con esa cédula en este módulo' });
      }
      console.error('Error creando cliente:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Editar cliente (solo admin)
  app.put('/api/clientes/:id', authenticateToken, checkAccess, requirePermiso('clientes'), async (req, res) => {
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;
      const { nombre, cedula, telefono, direccion, email } = req.body;

      if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'El nombre es requerido' });
      }

      const cedulaLimpia = cedula && cedula.trim() !== '' ? cedula.trim() : null;

      const result = await pool.query(
        `UPDATE clientes
       SET nombre = $1, cedula = $2, telefono = $3, direccion = $4, email = $5
       WHERE id = $6 AND modulo_id = $7
       RETURNING *`,
        [nombre.trim(), cedulaLimpia, telefono || null, direccion || null, email || null, id, moduloId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Cliente no encontrado' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Ya existe un cliente con esa cédula en este módulo' });
      }
      console.error('Error actualizando cliente:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  return {};
};
