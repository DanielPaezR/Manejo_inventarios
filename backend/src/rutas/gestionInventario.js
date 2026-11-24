// Rutas: Ajustes de inventario.
// Movidas desde server.js (secciones: RUTAS DE GESTIÓN DE INVENTARIO).
// Reciben ctx con lo que server.js prepara (app, pool, middlewares, helpers)
// y lo que exportan los grupos registrados antes; devuelven lo que otros usan.
module.exports = function registrarRutas(ctx) {
  const {
    authenticateToken, checkAccess, app, pool, requirePermiso
  } = ctx;

  // ==================== RUTAS DE GESTIÓN DE INVENTARIO ====================

  app.post('/api/inventario/agregar-stock', authenticateToken, checkAccess, requirePermiso('inventario'), async (req, res) => {
    // pool.connect() dentro del try: si la conexión falla, no debe quedar
    // como una promesa rechazada sin atrapar que tumbe todo el proceso.
    let client;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const { producto_id, cantidad, motivo } = req.body;
      const moduloId = req.moduloId;

      if (!moduloId) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const cantidadNum = parseInt(cantidad, 10);
      if (!Number.isFinite(cantidadNum) || cantidadNum <= 0) {
        throw new Error('La cantidad a agregar debe ser un número positivo');
      }

      const productoResult = await client.query(
        'SELECT id, nombre, stock_actual FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true',
        [producto_id, moduloId]
      );

      if (productoResult.rows.length === 0) {
        throw new Error('Producto no encontrado o no pertenece a este módulo');
      }

      const producto = productoResult.rows[0];
      const nuevoStock = producto.stock_actual + cantidadNum;

      await client.query(
        'UPDATE productos SET stock_actual = $1, fecha_actualizacion = NOW() WHERE id = $2',
        [nuevoStock, producto_id]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Stock agregado correctamente',
        producto: {
          id: producto.id,
          nombre: producto.nombre,
          stock_anterior: producto.stock_actual,
          stock_nuevo: nuevoStock,
          cantidad_agregada: cantidadNum
        }
      });

    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }
      console.error('Error agregando stock:', error);
      const mensaje = error.code ? 'Error al agregar stock' : error.message;
      res.status(400).json({ error: mensaje });
    } finally {
      if (client) client.release();
    }
  });

  app.post('/api/inventario/ajustar-stock', authenticateToken, checkAccess, requirePermiso('inventario'), async (req, res) => {
    // pool.connect() dentro del try: si la conexión falla, no debe quedar
    // como una promesa rechazada sin atrapar que tumbe todo el proceso.
    let client;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const { producto_id, nuevo_stock, motivo } = req.body;
      const moduloId = req.moduloId;

      if (!moduloId) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const nuevoStockNum = Number(nuevo_stock);
      if (!Number.isFinite(nuevoStockNum) || nuevoStockNum < 0) {
        throw new Error('El nuevo stock debe ser un número mayor o igual a cero');
      }

      const productoResult = await client.query(
        'SELECT id, nombre, stock_actual FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true',
        [producto_id, moduloId]
      );

      if (productoResult.rows.length === 0) {
        throw new Error('Producto no encontrado o no pertenece a este módulo');
      }

      const producto = productoResult.rows[0];
      const diferencia = nuevoStockNum - producto.stock_actual;

      await client.query(
        'UPDATE productos SET stock_actual = $1, fecha_actualizacion = NOW() WHERE id = $2',
        [nuevoStockNum, producto_id]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Stock ajustado correctamente',
        producto: {
          id: producto.id,
          nombre: producto.nombre,
          stock_anterior: producto.stock_actual,
          stock_nuevo: nuevoStockNum,
          diferencia: diferencia
        }
      });

    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }
      console.error('Error ajustando stock:', error);
      const mensaje = error.code ? 'Error al ajustar stock' : error.message;
      res.status(400).json({ error: mensaje });
    } finally {
      if (client) client.release();
    }
  });

  return {};
};
