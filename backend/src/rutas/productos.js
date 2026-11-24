// Rutas: Productos, categorías y promociones (combos).
// Movidas desde server.js (secciones: RUTAS DE PRODUCTOS · RUTAS DE CATEGORÍAS · PROMOCIONES (COMBOS)).
// Reciben ctx con lo que server.js prepara (app, pool, middlewares, helpers)
// y lo que exportan los grupos registrados antes; devuelven lo que otros usan.
module.exports = function registrarRutas(ctx) {
  const {
    authenticateToken, checkAccess, cargarPromociones, limpiarPromocion, planes, app, pool,
    requirePermiso
  } = ctx;

  // ==================== RUTAS DE PRODUCTOS ====================

  app.get('/api/productos', authenticateToken, checkAccess, async (req, res) => {
    try {
      const { search } = req.query;
      const moduloId = req.moduloId;
      const negocioId = req.negocioId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      // Un producto siempre pertenece a su módulo dueño (p.modulo_id), pero si
      // el dueño lo compartió explícitamente con este módulo (fila en
      // producto_modulo_compartido), también aparece en su listado — a
      // diferencia del compartido=true de antes, ahora es por módulo
      // específico, no automático a todo el negocio.
      // compartido_con trae los módulos con los que el dueño lo compartió (para
      // que el modal de edición ya tenga la selección actual sin otra llamada).
      let query = `
      SELECT p.*, c.nombre as categoria_nombre,
             m_dueno.nombre as modulo_dueno_nombre,
             COALESCE(
               (SELECT array_agg(pmc.modulo_id) FROM producto_modulo_compartido pmc WHERE pmc.producto_id = p.id),
               '{}'
             ) as compartido_con
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      JOIN modulos m_dueno ON p.modulo_id = m_dueno.id
      WHERE p.activo = true
      AND (
        p.modulo_id = $1
        OR EXISTS (
          SELECT 1 FROM producto_modulo_compartido pmc
          JOIN modulos m_otro ON pmc.modulo_id = m_otro.id
          WHERE pmc.producto_id = p.id AND pmc.modulo_id = $1 AND m_otro.negocio_id = $2
        )
      )
    `;
      let params = [moduloId, negocioId];

      if (search) {
        // codigo_ean antes exigía coincidencia exacta y completa (=), a
        // diferencia de nombre (ILIKE parcial). Escribir un código de barras
        // a mano y buscar mientras se completa nunca encontraba nada hasta
        // el último dígito. Ahora ambos aceptan coincidencia parcial.
        query += ` AND (p.nombre ILIKE $3 OR p.codigo_ean ILIKE $3)`;
        params.push(`%${search}%`);
      }

      query += ' ORDER BY p.nombre';
      
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo productos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // compartido_con: array de modulo_id (del mismo negocio, distintos al
  // dueño) con los que este producto también se puede vender — reemplaza al
  // viejo booleano compartido (que era todo-o-nada con el negocio completo).
  // Se valida y se escriben las filas de producto_modulo_compartido dentro
  // de la misma transacción de creación/edición del producto.
  const guardarCompartidoCon = async (client, productoId, moduloDuenoId, negocioId, compartidoCon) => {
    const moduloIds = Array.isArray(compartidoCon)
      ? [...new Set(compartidoCon.map(Number).filter(id => Number.isFinite(id) && id !== moduloDuenoId))]
      : [];

    await client.query('DELETE FROM producto_modulo_compartido WHERE producto_id = $1', [productoId]);

    if (moduloIds.length === 0) return;

    // Solo módulos activos del MISMO negocio — ids que no cumplan (de otro
    // negocio, inactivos, inexistentes) se descartan en silencio en vez de
    // fallar, igual que categoria_id/pedido_id inválidos en otras rutas.
    const validos = await client.query(
      'SELECT id FROM modulos WHERE id = ANY($1) AND negocio_id = $2 AND activo = true',
      [moduloIds, negocioId]
    );

    for (const row of validos.rows) {
      await client.query(
        'INSERT INTO producto_modulo_compartido (producto_id, modulo_id) VALUES ($1, $2)',
        [productoId, row.id]
      );
    }
  };

  app.post('/api/productos', authenticateToken, checkAccess, requirePermiso('productos'), async (req, res) => {
    let client;
    try {
      const {
        codigo_ean,
        nombre,
        descripcion,
        precio_compra,
        precio_venta,
        stock_actual,
        stock_minimo,
        categoria_id,
        es_novedad,
        foto_url,
        ignora_stock,
        compartido_con
      } = req.body;

      const moduloId = req.moduloId;
      const negocioId = req.negocioId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      // '' (sin categoría) no es un entero válido para esta columna
      const categoriaIdValor = categoria_id === '' || categoria_id === undefined ? null : categoria_id;

      client = await pool.connect();
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO productos
       (modulo_id, codigo_ean, nombre, descripcion, precio_compra, precio_venta, stock_actual, stock_minimo, categoria_id, es_novedad, foto_url, ignora_stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
        [moduloId, codigo_ean, nombre, descripcion, precio_compra, precio_venta, stock_actual, stock_minimo, categoriaIdValor, !!es_novedad, foto_url?.trim() || null, !!ignora_stock]
      );

      await guardarCompartidoCon(client, result.rows[0].id, moduloId, negocioId, compartido_con);

      await client.query('COMMIT');
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }
      console.error('Error creando producto:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  app.put('/api/productos/:id', authenticateToken, checkAccess, requirePermiso('productos'), async (req, res) => {
    let client;
    try {
      const { id } = req.params;
      const {
        codigo_ean,
        nombre,
        descripcion,
        precio_compra,
        precio_venta,
        stock_actual,
        stock_minimo,
        categoria_id,
        es_novedad,
        foto_url,
        ignora_stock,
        compartido_con
      } = req.body;

      const moduloId = req.moduloId;
      const negocioId = req.negocioId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      // '' (sin categoría) no es un entero válido para esta columna; sin esto,
      // actualizar un producto sin categoría rompía con un 500
      // (invalid input syntax for type integer).
      const categoriaIdValor = categoria_id === '' || categoria_id === undefined ? null : categoria_id;

      client = await pool.connect();
      await client.query('BEGIN');

      // WHERE ... AND modulo_id = $13 (dueño): un módulo que solo tiene acceso
      // de VENTA a este producto por ser compartido no puede editarlo — solo
      // el módulo dueño puede tocar precio/stock/nombre/con quién se comparte.
      const result = await client.query(
        `UPDATE productos
       SET codigo_ean = $1,
           nombre = $2,
           descripcion = $3,
           precio_compra = $4,
           precio_venta = $5,
           stock_actual = $6,
           stock_minimo = $7,
           categoria_id = $8,
           es_novedad = $9,
           foto_url = $10,
           ignora_stock = $11,
           fecha_actualizacion = NOW()
       WHERE id = $12 AND modulo_id = $13
       RETURNING *`,
        [codigo_ean, nombre, descripcion, precio_compra, precio_venta, stock_actual, stock_minimo, categoriaIdValor, !!es_novedad, foto_url?.trim() || null, !!ignora_stock, id, moduloId]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      if (compartido_con !== undefined) {
        await guardarCompartidoCon(client, id, moduloId, negocioId, compartido_con);
      }

      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }
      console.error('Error actualizando producto:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  app.delete('/api/productos/:id', authenticateToken, checkAccess, requirePermiso('productos'), async (req, res) => {
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      await pool.query(
        'UPDATE productos SET activo = false WHERE id = $1 AND modulo_id = $2',
        [id, moduloId]
      );

      res.json({ message: 'Producto eliminado correctamente' });
    } catch (error) {
      console.error('Error eliminando producto:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.get('/api/productos/buscar/:ean', authenticateToken, checkAccess, async (req, res) => {
    try {
      const { ean } = req.params;
      const moduloId = req.moduloId;
      const negocioId = req.negocioId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const result = await pool.query(
        `SELECT p.*, c.nombre as categoria_nombre, m_dueno.nombre as modulo_dueno_nombre
       FROM productos p
       LEFT JOIN categorias c ON p.categoria_id = c.id
       JOIN modulos m_dueno ON p.modulo_id = m_dueno.id
       WHERE p.activo = true
       AND (
         p.modulo_id = $1
         OR EXISTS (
           SELECT 1 FROM producto_modulo_compartido pmc
           JOIN modulos m_otro ON pmc.modulo_id = m_otro.id
           WHERE pmc.producto_id = p.id AND pmc.modulo_id = $1 AND m_otro.negocio_id = $3
         )
       )
       AND p.codigo_ean = $2`,
        [moduloId, ean, negocioId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error buscando producto por EAN:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ==================== RUTAS DE CATEGORÍAS ====================

  app.get('/api/categorias', authenticateToken, checkAccess, async (req, res) => {
    try {
      const moduloId = req.moduloId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const result = await pool.query(
        'SELECT * FROM categorias WHERE modulo_id = $1 ORDER BY nombre',
        [moduloId]
      );

      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo categorías:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Crear categoría de producto
  app.post('/api/categorias', authenticateToken, checkAccess, requirePermiso('productos'), async (req, res) => {
    try {
      const moduloId = req.moduloId;
      const negocioId = req.negocioId;
      const { nombre } = req.body;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'El nombre es requerido' });
      }

      // categorias no tiene UNIQUE(modulo_id, nombre), así que se valida a
      // mano antes de insertar para responder un mensaje claro.
      const existente = await pool.query(
        'SELECT id FROM categorias WHERE modulo_id = $1 AND nombre = $2',
        [moduloId, nombre.trim()]
      );
      if (existente.rows.length > 0) {
        return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
      }

      const result = await pool.query(
        'INSERT INTO categorias (negocio_id, modulo_id, nombre) VALUES ($1, $2, $3) RETURNING *',
        [negocioId, moduloId, nombre.trim()]
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Error creando categoría:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Renombrar categoría de producto
  app.put('/api/categorias/:id', authenticateToken, checkAccess, requirePermiso('productos'), async (req, res) => {
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;
      const { nombre } = req.body;

      if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'El nombre es requerido' });
      }

      const existente = await pool.query(
        'SELECT id FROM categorias WHERE modulo_id = $1 AND nombre = $2 AND id != $3',
        [moduloId, nombre.trim(), id]
      );
      if (existente.rows.length > 0) {
        return res.status(400).json({ error: 'Ya existe una categoría con ese nombre' });
      }

      const result = await pool.query(
        'UPDATE categorias SET nombre = $1 WHERE id = $2 AND modulo_id = $3 RETURNING *',
        [nombre.trim(), id, moduloId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Categoría no encontrada' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error actualizando categoría:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Eliminar categoría de producto. La tabla no tiene columna `activo`
  // (sin soft-delete posible), así que es un DELETE real: primero se
  // valida que ningún producto ACTIVO la use.
  app.delete('/api/categorias/:id', authenticateToken, checkAccess, requirePermiso('productos'), async (req, res) => {
    let client;
    try {
      const { id } = req.params;
      const moduloId = req.moduloId;

      client = await pool.connect();
      await client.query('BEGIN');

      const categoriaResult = await client.query(
        'SELECT id FROM categorias WHERE id = $1 AND modulo_id = $2 FOR UPDATE',
        [id, moduloId]
      );
      if (categoriaResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Categoría no encontrada' });
      }

      // Sus productos (activos e inactivos) quedan sin categoría, que la
      // app muestra como "General", y luego se borra la categoría.
      const movidos = await client.query(
        'UPDATE productos SET categoria_id = NULL, fecha_actualizacion = NOW() WHERE categoria_id = $1',
        [id]
      );
      await client.query('DELETE FROM categorias WHERE id = $1 AND modulo_id = $2', [id, moduloId]);
      await client.query('COMMIT');

      res.json({ message: 'Categoría eliminada correctamente', productos_movidos: movidos.rowCount });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('Error eliminando categoría:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  // ==================== PROMOCIONES (COMBOS) ====================
  // Lista para el punto de venta y el administrador (cualquiera que venda).
  app.get('/api/promociones', authenticateToken, checkAccess, async (req, res) => {
    try {
      if (!req.moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }
      const todas = await cargarPromociones(pool, req.moduloId);
      const puedeGestionar = req.user.rol !== 'trabajador' || req.query.todas === '1';
      res.json(puedeGestionar ? todas : todas.filter(p => p.activo && p.vigente));
    } catch (error) {
      console.error('Error listando promociones:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  const guardarPromocion = async (req, res, id) => {
    const { error, datos } = limpiarPromocion(req.body);
    if (error) {
      return res.status(400).json({ error });
    }
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      // Todos los productos deben ser de este módulo.
      const { rows: propios } = await client.query(
        'SELECT id FROM productos WHERE id = ANY($1::int[]) AND modulo_id = $2',
        [datos.items.map(i => i.producto_id), req.moduloId]);
      if (propios.length !== datos.items.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Algún producto de la promoción no pertenece a este módulo' });
      }
      let promocionId = id;
      if (id) {
        const r = await client.query(
          `UPDATE promociones SET nombre = $1, descripcion = $2, precio = $3, foto_url = $4, activo = $5,
                fecha_inicio = $6, fecha_fin = $7
         WHERE id = $8 AND modulo_id = $9 RETURNING id`,
          [datos.nombre, datos.descripcion, datos.precio, datos.foto_url, datos.activo, datos.fecha_inicio, datos.fecha_fin, id, req.moduloId]);
        if (r.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Promoción no encontrada' });
        }
        await client.query('DELETE FROM promocion_items WHERE promocion_id = $1', [id]);
      } else {
        const r = await client.query(
          `INSERT INTO promociones (modulo_id, nombre, descripcion, precio, foto_url, activo, fecha_inicio, fecha_fin)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [req.moduloId, datos.nombre, datos.descripcion, datos.precio, datos.foto_url, datos.activo, datos.fecha_inicio, datos.fecha_fin]);
        promocionId = r.rows[0].id;
      }
      for (const item of datos.items) {
        await client.query(
          'INSERT INTO promocion_items (promocion_id, producto_id, cantidad) VALUES ($1, $2, $3)',
          [promocionId, item.producto_id, item.cantidad]);
      }
      await client.query('COMMIT');
      const todas = await cargarPromociones(pool, req.moduloId);
      res.status(id ? 200 : 201).json(todas.find(p => p.id === Number(promocionId)));
    } catch (err) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('Error guardando promoción:', err);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  };

  // Funciones que dependen del plan del negocio.
  const requiereFuncion = (funcion) => async (req, res, next) => {
    try {
      const plan = await planes.planDeModulo(pool, req.moduloId);
      if (!planes.incluye(plan, funcion)) return res.status(403).json({ error: planes.mensajeBloqueo(plan, funcion), plan_bloqueado: funcion });
    } catch { /* si no se puede leer el plan, no bloquea */ }
    next();
  };

  app.post('/api/promociones', authenticateToken, checkAccess, requirePermiso('productos'), requiereFuncion('promociones'), (req, res) => guardarPromocion(req, res, null));

  app.put('/api/promociones/:id', authenticateToken, checkAccess, requirePermiso('productos'), (req, res) => {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(404).json({ error: 'Promoción no encontrada' });
    }
    return guardarPromocion(req, res, Number(req.params.id));
  });

  // Borrar una promoción no afecta las ventas ya hechas: sus líneas conservan
  // el nombre de la promoción (promocion_nombre).
  app.delete('/api/promociones/:id', authenticateToken, checkAccess, requirePermiso('productos'), async (req, res) => {
    try {
      const r = await pool.query('DELETE FROM promociones WHERE id = $1 AND modulo_id = $2 RETURNING id', [req.params.id, req.moduloId]);
      if (r.rows.length === 0) {
        return res.status(404).json({ error: 'Promoción no encontrada' });
      }
      res.json({ ok: true });
    } catch (error) {
      console.error('Error borrando promoción:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  return { requiereFuncion };
};
