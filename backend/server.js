const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const moment = require('moment');
const path = require('path');
require('dotenv').config();

// ==================== IMPORTS DE MIDDLEWARES Y HELPERS ====================
const { authenticateToken, requireAdmin, requireSuperAdmin } = require('./src/middleware/auth');
const { checkAccess } = require('./src/middleware/checkAccess');
const { generarNumeroFactura } = require('./src/helpers/generarNumeroFactura');
const { generarNumeroCliente } = require('./src/helpers/generarNumeroCliente');
const { JWT_SECRET } = require('./src/config/jwtSecret');

// ==================== IMPORTS DE REPORTES ====================
const generarReporteVentasDiarias = require('./src/reports/reporteVentasDiarias');
const generarReporteInventario = require('./src/reports/reporteInventario');
const generarReporteFinancieroMensual = require('./src/reports/reporteFinanciero');
const generarExcelProductos = require('./src/reports/excelProductos');
const generarExcelVentas = require('./src/reports/excelVentas');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// CONEXIÓN A POSTGRESQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

console.log('🔍 Conexión BD configurada con DATABASE_URL:', !!process.env.DATABASE_URL);

// Log de rutas
app.use((req, res, next) => {
  console.log('📍 Ruta solicitada:', req.method, req.url);
  next();
});

// ==================== RUTAS DE AUTENTICACIÓN ====================

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const result = await pool.query(
      'SELECT * FROM usuarios WHERE email = $1 AND activo = true',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, rol: user.rol },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    let negocioInfo = null;
    let modulos = [];

    if (user.negocio_id) {
      const negocioResult = await pool.query(
        'SELECT * FROM negocios WHERE id = $1 AND activo = true',
        [user.negocio_id]
      );
      negocioInfo = negocioResult.rows[0];
      
      if (user.rol === 'admin') {
        const modulosResult = await pool.query(
          'SELECT id, nombre, descripcion, activo FROM modulos WHERE negocio_id = $1 AND activo = true ORDER BY nombre',
          [user.negocio_id]
        );
        modulos = modulosResult.rows;
      } else if (user.rol === 'trabajador') {
        const modulosResult = await pool.query(
          `SELECT m.id, m.nombre, m.descripcion, m.activo 
           FROM modulos m
           JOIN usuario_modulos um ON m.id = um.modulo_id
           WHERE um.usuario_id = $1 AND m.activo = true
           ORDER BY m.nombre`,
          [user.id]
        );
        modulos = modulosResult.rows;
      }
    }

    res.json({
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol,
        negocio_id: user.negocio_id,
        negocio: negocioInfo,
        modulos: modulos
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.put('/api/usuarios/cambiar-password', authenticateToken, async (req, res) => {
  try {
    const { passwordActual, nuevaPassword } = req.body;
    const usuarioId = req.user.id;

    if (!passwordActual || !nuevaPassword) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    if (nuevaPassword.length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }

    const usuarioResult = await pool.query(
      'SELECT id, password, email FROM usuarios WHERE id = $1',
      [usuarioId]
    );

    if (usuarioResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const usuario = usuarioResult.rows[0];
    const passwordValida = await bcrypt.compare(passwordActual, usuario.password);
    
    if (!passwordValida) {
      return res.status(400).json({ error: 'Contraseña actual incorrecta' });
    }

    const hashedPassword = await bcrypt.hash(nuevaPassword, 10);

    await pool.query(
      'UPDATE usuarios SET password = $1 WHERE id = $2',
      [hashedPassword, usuarioId]
    );

    res.json({ success: true, message: 'Contraseña actualizada correctamente' });
  } catch (error) {
    console.error('Error cambiando contraseña:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ==================== RUTAS DE PERFIL ====================

app.get('/api/perfil', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, nombre, email, rol, negocio_id FROM usuarios WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const user = result.rows[0];
    let negocioInfo = null;
    let modulos = [];

    if (user.negocio_id) {
      const negocioResult = await pool.query(
        'SELECT * FROM negocios WHERE id = $1 AND activo = true',
        [user.negocio_id]
      );
      negocioInfo = negocioResult.rows[0];
      
      if (user.rol === 'admin') {
        const modulosResult = await pool.query(
          'SELECT id, nombre, descripcion, activo FROM modulos WHERE negocio_id = $1 AND activo = true ORDER BY nombre',
          [user.negocio_id]
        );
        modulos = modulosResult.rows;
      } else if (user.rol === 'trabajador') {
        const modulosResult = await pool.query(
          `SELECT m.id, m.nombre, m.descripcion, m.activo 
           FROM modulos m
           JOIN usuario_modulos um ON m.id = um.modulo_id
           WHERE um.usuario_id = $1 AND m.activo = true
           ORDER BY m.nombre`,
          [user.id]
        );
        modulos = modulosResult.rows;
      }
    }

    res.json({
      user: {
        ...user,
        negocio: negocioInfo,
        modulos: modulos
      }
    });
  } catch (error) {
    console.error('Error obteniendo perfil:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ==================== RUTAS DE NEGOCIOS ====================

app.post('/api/negocios', authenticateToken, requireSuperAdmin, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { nombre, direccion, telefono, email, ruc_nit, logo_url } = req.body;

    const negocioResult = await client.query(
      `INSERT INTO negocios (nombre, direccion, telefono, email, ruc_nit, logo_url) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [nombre, direccion, telefono, email, ruc_nit, logo_url]
    );

    const negocio = negocioResult.rows[0];

    await client.query(
      'INSERT INTO modulos (negocio_id, nombre, descripcion) VALUES ($1, $2, $3)',
      [negocio.id, 'Módulo Principal', 'Módulo principal del negocio']
    );

    await client.query('COMMIT');
    res.status(201).json(negocio);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creando negocio:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    client.release();
  }
});

app.get('/api/negocios', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM negocios WHERE activo = true ORDER BY nombre'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo negocios:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ==================== RUTAS DE MÓDULOS ====================

app.get('/api/negocios/:id/modulos', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (req.user.rol !== 'super_admin') {
      const userResult = await pool.query(
        'SELECT negocio_id FROM usuarios WHERE id = $1',
        [req.user.id]
      );
      if (userResult.rows[0]?.negocio_id !== parseInt(id)) {
        return res.status(403).json({ error: 'No tienes acceso a este negocio' });
      }
    }

    const result = await pool.query(
      'SELECT * FROM modulos WHERE negocio_id = $1 AND activo = true ORDER BY nombre',
      [id]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo módulos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/negocios/:id/modulos', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, descripcion } = req.body;

    if (req.user.rol !== 'super_admin') {
      const userResult = await pool.query(
        'SELECT negocio_id FROM usuarios WHERE id = $1',
        [req.user.id]
      );
      if (userResult.rows[0]?.negocio_id !== parseInt(id)) {
        return res.status(403).json({ error: 'No tienes acceso a este negocio' });
      }
    }

    const result = await pool.query(
      `INSERT INTO modulos (negocio_id, nombre, descripcion) 
       VALUES ($1, $2, $3) RETURNING *`,
      [id, nombre, descripcion]
    );

    await pool.query(
      'INSERT INTO secuencias_factura (modulo_id, prefijo, siguiente_numero) VALUES ($1, $2, $3)',
      [result.rows[0].id, 'FAC', 1]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creando módulo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/api/usuarios/modulos', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRol = req.user.rol;

    let modulos = [];

    if (userRol === 'super_admin') {
      const result = await pool.query(
        `SELECT m.*, n.nombre as negocio_nombre 
         FROM modulos m
         JOIN negocios n ON m.negocio_id = n.id
         WHERE m.activo = true
         ORDER BY n.nombre, m.nombre`
      );
      modulos = result.rows;
    } else {
      const result = await pool.query(
        `SELECT m.*, n.nombre as negocio_nombre 
         FROM modulos m
         JOIN negocios n ON m.negocio_id = n.id
         WHERE m.id IN (
           SELECT modulo_id FROM usuario_modulos WHERE usuario_id = $1
         ) AND m.activo = true
         ORDER BY n.nombre, m.nombre`,
        [userId]
      );
      modulos = result.rows;
    }

    res.json(modulos);
  } catch (error) {
    console.error('Error obteniendo módulos del usuario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ==================== RUTAS DE GESTIÓN DE USUARIOS EN MÓDULOS ====================

app.post('/api/usuarios/:usuarioId/modulos/:moduloId', authenticateToken, async (req, res) => {
  try {
    const { usuarioId, moduloId } = req.params;

    const usuarioResult = await pool.query(
      'SELECT rol, negocio_id FROM usuarios WHERE id = $1 AND activo = true',
      [usuarioId]
    );
    
    if (usuarioResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (usuarioResult.rows[0].rol === 'super_admin') {
      return res.status(400).json({ error: 'No se puede asignar un super admin a un módulo' });
    }

    const moduloResult = await pool.query(
      'SELECT id, negocio_id FROM modulos WHERE id = $1 AND activo = true',
      [moduloId]
    );
    
    if (moduloResult.rows.length === 0) {
      return res.status(404).json({ error: 'Módulo no encontrado' });
    }

    if (usuarioResult.rows[0].negocio_id !== moduloResult.rows[0].negocio_id) {
      return res.status(400).json({ error: 'El usuario no pertenece al negocio del módulo' });
    }

    await pool.query(
      'INSERT INTO usuario_modulos (usuario_id, modulo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [usuarioId, moduloId]
    );

    res.json({ success: true, message: 'Usuario asignado al módulo correctamente' });
  } catch (error) {
    console.error('Error asignando usuario a módulo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.delete('/api/usuarios/:usuarioId/modulos/:moduloId', authenticateToken, async (req, res) => {
  try {
    const { usuarioId, moduloId } = req.params;

    const usuarioResult = await pool.query(
      'SELECT rol FROM usuarios WHERE id = $1 AND activo = true',
      [usuarioId]
    );
    
    if (usuarioResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (usuarioResult.rows[0].rol === 'super_admin') {
      return res.status(400).json({ error: 'No se puede desasignar un super admin' });
    }

    await pool.query(
      'DELETE FROM usuario_modulos WHERE usuario_id = $1 AND modulo_id = $2',
      [usuarioId, moduloId]
    );

    res.json({ success: true, message: 'Usuario desasignado del módulo correctamente' });
  } catch (error) {
    console.error('Error desasignando usuario de módulo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/api/modulos/:id/usuarios', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.rol 
       FROM usuarios u
       JOIN usuario_modulos um ON u.id = um.usuario_id
       WHERE um.modulo_id = $1 AND u.activo = true
       ORDER BY u.nombre`,
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo usuarios del módulo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ==================== RUTAS DE PRODUCTOS ====================

app.get('/api/productos', authenticateToken, checkAccess, async (req, res) => {
  try {
    const { search } = req.query;
    const moduloId = req.moduloId;

    if (!moduloId) {
      return res.status(400).json({ error: 'Se requiere un módulo' });
    }

    let query = `
      SELECT p.*, c.nombre as categoria_nombre 
      FROM productos p 
      LEFT JOIN categorias c ON p.categoria_id = c.id 
      WHERE p.activo = true AND p.modulo_id = $1
    `;
    let params = [moduloId];

    if (search) {
      // codigo_ean antes exigía coincidencia exacta y completa (=), a
      // diferencia de nombre (ILIKE parcial). Escribir un código de barras
      // a mano y buscar mientras se completa nunca encontraba nada hasta
      // el último dígito. Ahora ambos aceptan coincidencia parcial.
      query += ` AND (p.nombre ILIKE $2 OR p.codigo_ean ILIKE $2)`;
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

app.post('/api/productos', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const { 
      codigo_ean, 
      nombre, 
      descripcion, 
      precio_compra, 
      precio_venta, 
      stock_actual, 
      stock_minimo, 
      categoria_id 
    } = req.body;

    const moduloId = req.moduloId;

    if (!moduloId) {
      return res.status(400).json({ error: 'Se requiere un módulo' });
    }

    // '' (sin categoría) no es un entero válido para esta columna
    const categoriaIdValor = categoria_id === '' || categoria_id === undefined ? null : categoria_id;

    const result = await pool.query(
      `INSERT INTO productos
       (modulo_id, codigo_ean, nombre, descripcion, precio_compra, precio_venta, stock_actual, stock_minimo, categoria_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [moduloId, codigo_ean, nombre, descripcion, precio_compra, precio_venta, stock_actual, stock_minimo, categoriaIdValor]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creando producto:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.put('/api/productos/:id', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
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
      categoria_id 
    } = req.body;

    const moduloId = req.moduloId;

    if (!moduloId) {
      return res.status(400).json({ error: 'Se requiere un módulo' });
    }

    // '' (sin categoría) no es un entero válido para esta columna; sin esto,
    // actualizar un producto sin categoría rompía con un 500
    // (invalid input syntax for type integer).
    const categoriaIdValor = categoria_id === '' || categoria_id === undefined ? null : categoria_id;

    const result = await pool.query(
      `UPDATE productos
       SET codigo_ean = $1,
           nombre = $2,
           descripcion = $3,
           precio_compra = $4,
           precio_venta = $5,
           stock_actual = $6,
           stock_minimo = $7,
           categoria_id = $8,
           fecha_actualizacion = NOW()
       WHERE id = $9 AND modulo_id = $10
       RETURNING *`,
      [codigo_ean, nombre, descripcion, precio_compra, precio_venta, stock_actual, stock_minimo, categoriaIdValor, id, moduloId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error actualizando producto:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.delete('/api/productos/:id', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
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

    if (!moduloId) {
      return res.status(400).json({ error: 'Se requiere un módulo' });
    }

    const result = await pool.query(
      `SELECT p.*, c.nombre as categoria_nombre 
       FROM productos p 
       LEFT JOIN categorias c ON p.categoria_id = c.id 
       WHERE p.activo = true 
       AND p.modulo_id = $1 
       AND p.codigo_ean = $2`,
      [moduloId, ean]
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

// ==================== RUTAS DE VENTAS ====================

app.post('/api/ventas', authenticateToken, checkAccess, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { detalles, cliente_nombre, cliente_documento, cliente_direccion, cliente_telefono, metodo_pago, cliente_id } = req.body;
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

    // cliente_id nunca se validaba contra el negocio del usuario: cualquier
    // llamada directa a la API (sin pasar por el buscador ya filtrado del
    // POS) podía mandar el id de un cliente de otro negocio. Con crédito de
    // por medio eso generaría deuda falsa en un cliente ajeno.
    if (cliente_id) {
      const clienteCheck = await client.query(
        'SELECT id FROM clientes WHERE id = $1 AND negocio_id = $2',
        [cliente_id, negocioId]
      );
      if (clienteCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Cliente no encontrado' });
      }
    }

    console.log('🛒 Procesando venta - Usuario:', req.user.email, 'Módulo:', moduloId);

    if (!Array.isArray(detalles) || detalles.length === 0) {
      throw new Error('La venta debe incluir al menos un producto');
    }

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
      const stockResult = await client.query(
        'SELECT id, nombre, stock_actual FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true FOR UPDATE',
        [detalle.producto_id, moduloId]
      );

      if (stockResult.rows.length === 0) {
        throw new Error(`Producto no encontrado o inactivo: ${detalle.producto_id}`);
      }

      const producto = stockResult.rows[0];
      if (producto.stock_actual < detalle.cantidad) {
        throw new Error(`Stock insuficiente para "${producto.nombre}". Stock actual: ${producto.stock_actual}, solicitado: ${detalle.cantidad}`);
      }
    }

    // NOTA: este call le faltaba el segundo argumento (pool), lo que hacía
    // que pool.connect() reventara dentro del helper y NINGUNA venta pudiera
    // completarse. Corregido como parte de este cambio porque bloqueaba
    // directamente la ruta que se está modificando para aceptar cliente_id.
    const numero_factura = await generarNumeroFactura(moduloId, pool);
    console.log('🧾 Número de factura generado:', numero_factura);

    const subtotal = detalles.reduce((sum, detalle) => sum + (detalle.cantidad * detalle.precio_unitario), 0);
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
      await client.query(
        `INSERT INTO detalle_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal) 
         VALUES ($1, $2, $3, $4, $5)`,
        [venta.id, detalle.producto_id, detalle.cantidad, detalle.precio_unitario, detalle.cantidad * detalle.precio_unitario]
      );
      
      await client.query(
        'UPDATE productos SET stock_actual = stock_actual - $1, fecha_actualizacion = NOW() WHERE id = $2 AND modulo_id = $3',
        [detalle.cantidad, detalle.producto_id, moduloId]
      );
    }

    // Registro automático en caja: si esto falla, hace throw y cae al
    // catch de abajo, que hace ROLLBACK de toda la venta — no debe poder
    // completarse una venta sin su movimiento de caja correspondiente.
    // Excepción: a crédito no es efectivo real todavía, así que no genera
    // ingreso ahora — eso se registra cuando el cliente abona.
    if (metodo_pago !== 'credito') {
      await client.query(
        `INSERT INTO movimientos_caja
         (negocio_id, tipo, origen, monto, concepto, venta_id, usuario_id)
         VALUES ($1, 'ingreso', 'venta', $2, $3, $4, $5)`,
        [negocioId, total, `Venta #${numero_factura}`, venta.id, usuario_id]
      );
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
    await client.query('ROLLBACK');
    console.error('❌ ERROR registrando venta:', error);
    // error.code solo lo trae el driver de Postgres (errores internos, p.ej.
    // constraints); los `throw new Error(...)` propios de esta ruta (stock
    // insuficiente, producto no encontrado, cantidad inválida) no lo tienen
    // y sí son seguros de mostrar al usuario tal cual.
    const mensaje = error.code ? 'Error al procesar la venta' : error.message;
    res.status(400).json({ error: mensaje });
  } finally {
    client.release();
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

// ==================== RUTAS DE CLIENTES ====================

// Listar / buscar clientes del negocio (admin y trabajador, para el autocomplete del POS)
app.get('/api/clientes', authenticateToken, checkAccess, async (req, res) => {
  try {
    const negocioId = req.negocioId;
    const { search, numero_cliente } = req.query;

    if (!negocioId) {
      return res.status(400).json({ error: 'Negocio no identificado' });
    }

    // deuda_actual = ventas a crédito de ese cliente (metodo_pago='credito',
    // que ya no generan ingreso automático en caja) menos sus abonos.
    // Los abonos usan origen='manual' (categoria='abono_credito' los
    // distingue) porque el CHECK de movimientos_caja.origen solo admite
    // 'manual'/'venta'/'pedido' — 'abono_credito' no es un valor válido ahí.
    const deudaSelect = `(
        (SELECT COALESCE(SUM(v.total), 0)
         FROM ventas v JOIN modulos m ON v.modulo_id = m.id
         WHERE m.negocio_id = clientes.negocio_id
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
        `SELECT clientes.*, ${deudaSelect} FROM clientes WHERE negocio_id = $1 AND activo = true AND numero_cliente = $2`,
        [negocioId, parseInt(numeroClienteStr, 10)]
      );

      return res.json(result.rows);
    }

    let query = `SELECT clientes.*, ${deudaSelect} FROM clientes WHERE negocio_id = $1 AND activo = true`;
    const params = [negocioId];

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
app.get('/api/clientes/:id', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const negocioId = req.negocioId;

    const result = await pool.query(
      `SELECT clientes.*,
          (
            (SELECT COALESCE(SUM(v.total), 0)
             FROM ventas v JOIN modulos m ON v.modulo_id = m.id
             WHERE m.negocio_id = clientes.negocio_id
             AND v.cliente_id = clientes.id AND v.metodo_pago = 'credito')
            -
            (SELECT COALESCE(SUM(mc.monto), 0)
             FROM movimientos_caja mc
             WHERE mc.cliente_id = clientes.id AND mc.origen = 'manual' AND mc.categoria = 'abono_credito')
          ) AS deuda_actual
       FROM clientes WHERE id = $1 AND negocio_id = $2`,
      [id, negocioId]
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
app.get('/api/clientes/:id/historial', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const negocioId = req.negocioId;

    // Confirmar que el cliente pertenece al negocio del usuario antes de exponer su historial
    const clienteResult = await pool.query(
      'SELECT id FROM clientes WHERE id = $1 AND negocio_id = $2',
      [id, negocioId]
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
       JOIN modulos m ON v.modulo_id = m.id
       JOIN usuarios u ON v.usuario_id = u.id
       LEFT JOIN detalle_venta dv ON v.id = dv.venta_id
       LEFT JOIN productos p ON dv.producto_id = p.id
       WHERE v.cliente_id = $1 AND m.negocio_id = $2
       GROUP BY v.id, u.id
       ORDER BY v.fecha_venta DESC`,
      [id, negocioId]
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
app.post('/api/clientes/:id/abonos', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const negocioId = req.negocioId;
    const usuarioId = req.user.id;
    const { monto, concepto } = req.body;

    const clienteResult = await pool.query(
      'SELECT id FROM clientes WHERE id = $1 AND negocio_id = $2',
      [id, negocioId]
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
       (negocio_id, tipo, origen, monto, concepto, categoria, cliente_id, usuario_id)
       VALUES ($1, 'ingreso', 'manual', $2, $3, 'abono_credito', $4, $5)
       RETURNING *`,
      [negocioId, montoNum, conceptoFinal, id, usuarioId]
    );

    // Deuda actualizada tras el abono. No se bloquea si el abono supera la
    // deuda (puede ser un adelanto) — el frontend puede avisar con esto.
    const deudaResult = await pool.query(
      `SELECT
          (SELECT COALESCE(SUM(v.total), 0)
           FROM ventas v JOIN modulos m ON v.modulo_id = m.id
           WHERE m.negocio_id = $1 AND v.cliente_id = $2 AND v.metodo_pago = 'credito')
          -
          (SELECT COALESCE(SUM(mc.monto), 0)
           FROM movimientos_caja mc
           WHERE mc.cliente_id = $2 AND mc.origen = 'manual' AND mc.categoria = 'abono_credito')
        AS deuda_actual`,
      [negocioId, id]
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
app.post('/api/clientes/:id/deuda-manual', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const negocioId = req.negocioId;
    const moduloId = req.moduloId;
    const usuarioId = req.user.id;
    const { monto, concepto } = req.body;

    if (!moduloId) {
      return res.status(400).json({ error: 'Se requiere un módulo' });
    }

    const clienteResult = await pool.query(
      'SELECT id, nombre, cedula, telefono, direccion FROM clientes WHERE id = $1 AND negocio_id = $2',
      [id, negocioId]
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
       (modulo_id, numero_factura, cliente_nombre, cliente_documento, cliente_direccion, cliente_telefono, subtotal, total, usuario_id, metodo_pago, cliente_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, 'credito', $9)
       RETURNING *`,
      [moduloId, numero_factura, cliente.nombre, cliente.cedula, cliente.direccion, cliente.telefono, montoNum, usuarioId, id]
    );

    const deudaResult = await pool.query(
      `SELECT
          (SELECT COALESCE(SUM(v.total), 0)
           FROM ventas v JOIN modulos m ON v.modulo_id = m.id
           WHERE m.negocio_id = $1 AND v.cliente_id = $2 AND v.metodo_pago = 'credito')
          -
          (SELECT COALESCE(SUM(mc.monto), 0)
           FROM movimientos_caja mc
           WHERE mc.cliente_id = $2 AND mc.origen = 'manual' AND mc.categoria = 'abono_credito')
        AS deuda_actual`,
      [negocioId, id]
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
    const { nombre, cedula, telefono, direccion, email } = req.body;

    if (!negocioId) {
      return res.status(400).json({ error: 'Negocio no identificado' });
    }

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre es requerido' });
    }

    // UNIQUE(negocio_id, cedula) permite múltiples NULL sin chocar, pero un
    // string vacío '' sí choca si hay más de un cliente sin cédula.
    const cedulaLimpia = cedula && cedula.trim() !== '' ? cedula.trim() : null;

    const numero_cliente = await generarNumeroCliente(negocioId, pool);

    const result = await pool.query(
      `INSERT INTO clientes (negocio_id, numero_cliente, nombre, cedula, telefono, direccion, email)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [negocioId, numero_cliente, nombre.trim(), cedulaLimpia, telefono || null, direccion || null, email || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un cliente con esa cédula en este negocio' });
    }
    console.error('Error creando cliente:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Editar cliente (solo admin)
app.put('/api/clientes/:id', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const negocioId = req.negocioId;
    const { nombre, cedula, telefono, direccion, email } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre es requerido' });
    }

    const cedulaLimpia = cedula && cedula.trim() !== '' ? cedula.trim() : null;

    const result = await pool.query(
      `UPDATE clientes
       SET nombre = $1, cedula = $2, telefono = $3, direccion = $4, email = $5
       WHERE id = $6 AND negocio_id = $7
       RETURNING *`,
      [nombre.trim(), cedulaLimpia, telefono || null, direccion || null, email || null, id, negocioId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un cliente con esa cédula en este negocio' });
    }
    console.error('Error actualizando cliente:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

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
        startDate = moment().startOf('day').toDate();
        endDate = moment().endOf('day').toDate();
        break;
      case 'semana':
        startDate = moment().subtract(7, 'days').startOf('day').toDate();
        endDate = moment().endOf('day').toDate();
        break;
      case 'mes':
        startDate = moment().subtract(30, 'days').startOf('day').toDate();
        endDate = moment().endOf('day').toDate();
        break;
      case 'personalizado':
        if (!fecha_inicio || !fecha_fin) {
          return res.status(400).json({ error: 'Para período personalizado se requieren fecha_inicio y fecha_fin' });
        }
        startDate = moment(fecha_inicio).startOf('day').toDate();
        endDate = moment(fecha_fin).endOf('day').toDate();
        break;
      default:
        startDate = moment().startOf('day').toDate();
        endDate = moment().endOf('day').toDate();
    }

    // Período anterior equivalente (misma duración, inmediatamente antes
    // de startDate) para comparar el monto de ventas.
    const duracionMs = endDate.getTime() - startDate.getTime();
    const startDateAnterior = new Date(startDate.getTime() - duracionMs);
    const endDateAnterior = new Date(startDate.getTime() - 1);

    const ventasPeriodo = await pool.query(
      `SELECT COUNT(*) as total, COALESCE(SUM(total), 0) as monto 
       FROM ventas 
       WHERE modulo_id = $1 
       AND fecha_venta BETWEEN $2 AND $3`,
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
       WHERE v.modulo_id = $1 
       AND v.fecha_venta BETWEEN $2 AND $3
       GROUP BY p.id, p.nombre
       ORDER BY total_vendido DESC
       LIMIT 10`,
      [moduloId, startDate, endDate]
    );

    const ventasPorDia = await pool.query(
      `SELECT 
          DATE(fecha_venta) as fecha, 
          COUNT(*) as cantidad, 
          SUM(total) as total
       FROM ventas
       WHERE modulo_id = $1 
       AND fecha_venta BETWEEN $2 AND $3
       GROUP BY DATE(fecha_venta)
       ORDER BY fecha ASC`,
      [moduloId, startDate, endDate]
    );

    const totalProductos = await pool.query(
      `SELECT COUNT(*) as total 
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
       GROUP BY metodo_pago
       ORDER BY cantidad DESC
       LIMIT 1`,
      [moduloId, startDate, endDate]
    );

    // Productos activos sin ninguna venta en el período actual
    const productosSinVenta = await pool.query(
      `SELECT p.id, p.nombre, p.stock_actual, c.nombre as categoria_nombre
       FROM productos p
       LEFT JOIN categorias c ON p.categoria_id = c.id
       WHERE p.activo = true AND p.modulo_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM detalle_venta dv
         JOIN ventas v ON dv.venta_id = v.id
         WHERE dv.producto_id = p.id
         AND v.modulo_id = $1
         AND v.fecha_venta BETWEEN $2 AND $3
       )
       ORDER BY p.nombre
       LIMIT 20`,
      [moduloId, startDate, endDate]
    );

    // Ventas del período anterior equivalente, para comparar
    const ventasPeriodoAnterior = await pool.query(
      `SELECT COUNT(*) as total, COALESCE(SUM(total), 0) as monto
       FROM ventas
       WHERE modulo_id = $1
       AND fecha_venta BETWEEN $2 AND $3`,
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
      totalProductos: totalProductos.rows[0]?.total || 0,
      metodoPagoPopular: metodoPagoPopular.rows[0] || null,
      comparacionPeriodoAnterior: {
        monto: ventasPeriodoAnterior.rows[0]?.monto || 0,
        total: ventasPeriodoAnterior.rows[0]?.total || 0,
        cambioMontoPct
      },
      periodoInfo: {
        tipo: periodo || 'hoy',
        fecha_inicio: moment(startDate).format('YYYY-MM-DD'),
        fecha_fin: moment(endDate).format('YYYY-MM-DD'),
        dias: moment(endDate).diff(moment(startDate), 'days') + 1
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
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
        startDate = moment().startOf('day').toDate();
        endDate = moment().endOf('day').toDate();
        break;
      case 'semana':
        startDate = moment().subtract(7, 'days').startOf('day').toDate();
        endDate = moment().endOf('day').toDate();
        break;
      case 'mes':
        startDate = moment().subtract(30, 'days').startOf('day').toDate();
        endDate = moment().endOf('day').toDate();
        break;
      case 'personalizado':
        if (!fecha_inicio || !fecha_fin) {
          return res.status(400).json({ error: 'Para período personalizado se requieren fecha_inicio y fecha_fin' });
        }
        startDate = moment(fecha_inicio).startOf('day').toDate();
        endDate = moment(fecha_fin).endOf('day').toDate();
        break;
      default:
        startDate = moment().startOf('day').toDate();
        endDate = moment().endOf('day').toDate();
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
         WHERE modulo_id = $1 AND fecha_venta BETWEEN $2 AND $3`,
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
       WHERE m.negocio_id = $1 AND v.fecha_venta BETWEEN $2 AND $3`,
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
        fecha_inicio: moment(startDate).format('YYYY-MM-DD'),
        fecha_fin: moment(endDate).format('YYYY-MM-DD')
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

// ==================== RUTAS DE PROVEEDORES ====================

// Obtener todos los proveedores del negocio
app.get('/api/proveedores', authenticateToken, checkAccess, async (req, res) => {
  try {
    const negocioId = req.negocioId;
    
    if (!negocioId) {
      return res.status(400).json({ error: 'Negocio no identificado' });
    }

    const result = await pool.query(
      `SELECT p.*, 
              array_agg(pp.producto_id) as productos_asociados
       FROM proveedores p
       LEFT JOIN producto_proveedor pp ON p.id = pp.proveedor_id AND pp.activo = true
       WHERE p.negocio_id = $1 AND p.activo = true
       GROUP BY p.id
       ORDER BY p.nombre`,
      [negocioId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo proveedores:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Crear nuevo proveedor
app.post('/api/proveedores', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const negocioId = req.negocioId;
    const { nombre, contacto, telefono, email, direccion, dias_entrega } = req.body;

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

    const result = await pool.query(
      `INSERT INTO proveedores (negocio_id, nombre, contacto, telefono, email, direccion, dias_entrega)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [negocioId, nombre, contacto, telefono, email, direccion, diasEntregaValor]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creando proveedor:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Actualizar proveedor
app.put('/api/proveedores/:id', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const negocioId = req.negocioId;
    const { nombre, contacto, telefono, email, direccion, activo, dias_entrega } = req.body;

    let diasEntregaValor = null;
    if (dias_entrega !== undefined && dias_entrega !== null && dias_entrega !== '') {
      const diasEntregaStr = String(dias_entrega).trim();
      if (!/^\d+$/.test(diasEntregaStr) || parseInt(diasEntregaStr, 10) <= 0) {
        return res.status(400).json({ error: 'dias_entrega debe ser un entero positivo' });
      }
      diasEntregaValor = parseInt(diasEntregaStr, 10);
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
           dias_entrega = $7,
           fecha_actualizacion = NOW()
       WHERE id = $8 AND negocio_id = $9
       RETURNING *`,
      [nombre, contacto, telefono, email, direccion, activo, diasEntregaValor, id, negocioId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error actualizando proveedor:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Eliminar proveedor (desactivar)
app.delete('/api/proveedores/:id', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const negocioId = req.negocioId;

    await pool.query(
      'UPDATE proveedores SET activo = false WHERE id = $1 AND negocio_id = $2',
      [id, negocioId]
    );

    res.json({ message: 'Proveedor eliminado correctamente' });
  } catch (error) {
    console.error('Error eliminando proveedor:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Sugerencia de cantidad a pedir por proveedor, basada en ventas históricas
// y tiempo de entrega (producto_proveedor.tiempo_entrega_dias tiene
// prioridad sobre proveedores.dias_entrega, que a su vez tiene prioridad
// sobre el default de 3 días).
app.get('/api/proveedores/:id/sugerencia-pedido', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const negocioId = req.negocioId;
    const moduloId = req.moduloId;
    const { dias_historial } = req.query;

    if (!moduloId) {
      return res.status(400).json({ error: 'Se requiere un módulo' });
    }

    const proveedorResult = await pool.query(
      'SELECT id, nombre, dias_entrega FROM proveedores WHERE id = $1 AND negocio_id = $2 AND activo = true',
      [id, negocioId]
    );

    if (proveedorResult.rows.length === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }

    const proveedor = proveedorResult.rows[0];

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
          pp.tiempo_entrega_dias, pp.cantidad_minima_pedido, pp.precio_compra
       FROM productos p
       JOIN producto_proveedor pp ON pp.producto_id = p.id
       WHERE pp.proveedor_id = $1
       AND pp.activo = true
       AND p.activo = true
       AND p.modulo_id = $2`,
      [id, moduloId]
    );

    const sugerencias = [];

    for (const producto of productosResult.rows) {
      const ventasResult = await pool.query(
        `SELECT COALESCE(SUM(dv.cantidad), 0) as total_vendido
         FROM detalle_venta dv
         JOIN ventas v ON dv.venta_id = v.id
         WHERE dv.producto_id = $1
         AND v.modulo_id = $2
         AND v.fecha_venta >= NOW() - ($3 || ' days')::interval`,
        [producto.id, moduloId, diasHistorial]
      );

      const totalVendido = Number(ventasResult.rows[0]?.total_vendido || 0);
      const promedioDiario = totalVendido / diasHistorial;
      const tiempoEntrega = producto.tiempo_entrega_dias || proveedor.dias_entrega || 3;
      const consumoEsperado = promedioDiario * tiempoEntrega;
      let cantidadSugerida = Math.ceil(
        Math.max(0, consumoEsperado + producto.stock_minimo - producto.stock_actual)
      );

      // Respeta el mínimo de pedido del proveedor si existe
      if (producto.cantidad_minima_pedido && cantidadSugerida > 0 && cantidadSugerida < producto.cantidad_minima_pedido) {
        cantidadSugerida = producto.cantidad_minima_pedido;
      }

      sugerencias.push({
        producto_id: producto.id,
        nombre: producto.nombre,
        codigo_ean: producto.codigo_ean,
        stock_actual: producto.stock_actual,
        stock_minimo: producto.stock_minimo,
        promedioDiario,
        tiempoEntrega,
        cantidadSugerida
      });
    }

    sugerencias.sort((a, b) => b.cantidadSugerida - a.cantidadSugerida);

    res.json(sugerencias);
  } catch (error) {
    console.error('Error calculando sugerencia de pedido:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ==================== RUTAS DE PRODUCTO-PROVEEDOR ====================

// Asociar producto con proveedor
app.post('/api/productos/:productoId/proveedores/:proveedorId', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const { productoId, proveedorId } = req.params;
    const { precio_compra, tiempo_entrega_dias, cantidad_minima_pedido } = req.body;
    const moduloId = req.moduloId;
    const negocioId = req.negocioId;

    // Verificar que el producto existe y pertenece al módulo
    const productoResult = await pool.query(
      'SELECT id FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true',
      [productoId, moduloId]
    );

    if (productoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    // Verificar que el proveedor existe Y pertenece al mismo negocio (evita
    // asociar productos propios con proveedores de otro negocio)
    const proveedorResult = await pool.query(
      'SELECT id FROM proveedores WHERE id = $1 AND negocio_id = $2 AND activo = true',
      [proveedorId, negocioId]
    );

    if (proveedorResult.rows.length === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }

    const result = await pool.query(
      `INSERT INTO producto_proveedor (producto_id, proveedor_id, precio_compra, tiempo_entrega_dias, cantidad_minima_pedido) 
       VALUES ($1, $2, $3, $4, $5) 
       ON CONFLICT (producto_id, proveedor_id) 
       DO UPDATE SET precio_compra = $3, tiempo_entrega_dias = $4, cantidad_minima_pedido = $5, activo = true
       RETURNING *`,
      [productoId, proveedorId, precio_compra, tiempo_entrega_dias, cantidad_minima_pedido]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error asociando producto con proveedor:', error);
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
app.post('/api/pedidos', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { proveedor_id, detalles, observaciones } = req.body;
    const moduloId = req.moduloId;
    const negocioId = req.negocioId;
    const usuarioId = req.user.id;

    if (!proveedor_id || !detalles || detalles.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Proveedor y detalles son requeridos' });
    }

    // Verificar que el proveedor existe y pertenece al mismo negocio
    const proveedorResult = await client.query(
      'SELECT id FROM proveedores WHERE id = $1 AND negocio_id = $2 AND activo = true',
      [proveedor_id, negocioId]
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
    await client.query('ROLLBACK');
    console.error('Error creando pedido:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    client.release();
  }
});

// Obtener pedidos del módulo
app.get('/api/pedidos', authenticateToken, checkAccess, async (req, res) => {
  try {
    const moduloId = req.moduloId;
    const { estado, limit = 50 } = req.query;

    let query = `
      SELECT p.*, 
             pr.nombre as proveedor_nombre,
             pr.telefono as proveedor_telefono
      FROM pedidos_proveedor p
      JOIN proveedores pr ON p.proveedor_id = pr.id
      WHERE p.modulo_id = $1
    `;
    let params = [moduloId];
    let paramIndex = 2;

    if (estado) {
      query += ` AND p.estado = $${paramIndex}`;
      params.push(estado);
      paramIndex++;
    }

    query += ` ORDER BY p.fecha_pedido DESC LIMIT $${paramIndex}`;
    params.push(limit);

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

// Actualizar estado del pedido
app.put('/api/pedidos/:id/estado', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const moduloId = req.moduloId;
    const { estado, fecha_entrega_estimada } = req.body;

    const estadosValidos = ['pendiente', 'enviado', 'recibido', 'cancelado'];
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const result = await pool.query(
      `UPDATE pedidos_proveedor 
       SET estado = $1, 
           fecha_entrega_estimada = COALESCE($2, fecha_entrega_estimada)
       WHERE id = $3 AND modulo_id = $4
       RETURNING *`,
      [estado, fecha_entrega_estimada, id, moduloId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    // Si el pedido se marca como "recibido", actualizar el stock
    if (estado === 'recibido') {
      // Obtener detalles del pedido
      const detalles = await pool.query(
        'SELECT producto_id, cantidad FROM pedido_detalle WHERE pedido_id = $1',
        [id]
      );

      // Actualizar stock de cada producto
      for (const detalle of detalles.rows) {
        await pool.query(
          'UPDATE productos SET stock_actual = stock_actual + $1, fecha_actualizacion = NOW() WHERE id = $2',
          [detalle.cantidad, detalle.producto_id]
        );
      }
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error actualizando estado del pedido:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ==================== RUTAS DE FINANZAS ====================
// Caja del negocio completo (no por módulo). Los ingresos por venta se
// insertan automáticamente dentro de la transacción de POST /api/ventas
// (ahí no hay ambigüedad de precio). Los egresos por pedido a proveedor
// YA NO se insertan solos al crear el pedido: el precio calculado puede
// no coincidir con lo que realmente se paga, y algunos proveedores
// entregan sin pedido formal previo. El egreso se registra a mano desde
// POST /api/finanzas/movimientos cuando efectivamente se paga, opcionalmente
// vinculado a un pedido existente (pedido_id) para trazabilidad.

// Registrar un movimiento manual (saldo inicial, ingreso o egreso)
app.post('/api/finanzas/movimientos', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const negocioId = req.negocioId;
    const usuarioId = req.user.id;
    const { tipo, monto, concepto, categoria, pedido_id } = req.body;

    if (!negocioId) {
      return res.status(400).json({ error: 'Negocio no identificado' });
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
        "SELECT id FROM movimientos_caja WHERE negocio_id = $1 AND tipo = 'saldo_inicial'",
        [negocioId]
      );
      if (existente.rows.length > 0) {
        return res.status(400).json({ error: "Ya existe un saldo inicial registrado, usa 'ingreso' o 'egreso' para ajustes" });
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
        `SELECT p.id
         FROM pedidos_proveedor p
         JOIN modulos m ON p.modulo_id = m.id
         WHERE p.id = $1 AND m.negocio_id = $2`,
        [pedido_id, negocioId]
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

    const result = await pool.query(
      `INSERT INTO movimientos_caja
       (negocio_id, tipo, origen, monto, concepto, categoria, pedido_id, usuario_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [negocioId, tipo, origen, montoNum, concepto.trim(), categoria || null, origen === 'pedido' ? pedido_id : null, usuarioId]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error registrando movimiento de caja:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Pedidos de cualquier módulo del negocio que aún no tienen un egreso
// registrado en movimientos_caja (para vincular al pagarlos)
app.get('/api/finanzas/pedidos-sin-registrar', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const negocioId = req.negocioId;

    if (!negocioId) {
      return res.status(400).json({ error: 'Negocio no identificado' });
    }

    const result = await pool.query(
      `SELECT p.id, p.total, p.fecha_pedido, p.estado,
              pr.nombre as proveedor_nombre
       FROM pedidos_proveedor p
       JOIN proveedores pr ON p.proveedor_id = pr.id
       JOIN modulos m ON p.modulo_id = m.id
       LEFT JOIN movimientos_caja mc ON mc.pedido_id = p.id AND mc.origen = 'pedido'
       WHERE m.negocio_id = $1 AND mc.id IS NULL
       ORDER BY p.fecha_pedido DESC`,
      [negocioId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo pedidos sin registrar:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Listar movimientos (automáticos de ventas + manuales, incluyendo egresos de pedido vinculados)
app.get('/api/finanzas/movimientos', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const negocioId = req.negocioId;
    const { limit } = req.query;

    if (!negocioId) {
      return res.status(400).json({ error: 'Negocio no identificado' });
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
      `SELECT mc.*, u.nombre as usuario_nombre
       FROM movimientos_caja mc
       LEFT JOIN usuarios u ON mc.usuario_id = u.id
       WHERE mc.negocio_id = $1
       ORDER BY mc.fecha DESC
       LIMIT $2`,
      [negocioId, limitNum]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo movimientos de caja:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Balance actual y desglose
app.get('/api/finanzas/balance', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const negocioId = req.negocioId;

    if (!negocioId) {
      return res.status(400).json({ error: 'Negocio no identificado' });
    }

    const result = await pool.query(
      `SELECT
          COALESCE(SUM(monto) FILTER (WHERE tipo IN ('saldo_inicial','ingreso')), 0)
          - COALESCE(SUM(monto) FILTER (WHERE tipo = 'egreso'), 0) as balance_actual,
          COALESCE(SUM(monto) FILTER (WHERE tipo = 'saldo_inicial'), 0) as saldo_inicial,
          COALESCE(SUM(monto) FILTER (WHERE tipo = 'ingreso' AND origen = 'manual' AND (categoria IS DISTINCT FROM 'abono_credito')), 0) as ingresos_manuales,
          COALESCE(SUM(monto) FILTER (WHERE tipo = 'ingreso' AND origen = 'venta'), 0) as total_ventas,
          COALESCE(SUM(monto) FILTER (WHERE tipo = 'egreso' AND origen = 'pedido'), 0) as total_pedidos,
          COALESCE(SUM(monto) FILTER (WHERE tipo = 'egreso' AND origen = 'manual'), 0) as egresos_manuales,
          COALESCE(SUM(monto) FILTER (WHERE origen = 'manual' AND categoria = 'abono_credito'), 0) as total_abonos_credito
       FROM movimientos_caja
       WHERE negocio_id = $1`,
      [negocioId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error obteniendo balance de caja:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ==================== RUTAS DE ALERTAS MEJORADAS ====================

// Obtener productos con stock bajo Y sus proveedores
app.get('/api/alertas/stock-bajo-completo', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const moduloId = req.moduloId;

    if (!moduloId) {
      return res.status(400).json({ error: 'Se requiere un módulo' });
    }

    const result = await pool.query(
      `SELECT p.*, 
              c.nombre as categoria_nombre,
              (p.stock_actual <= p.stock_minimo) as necesita_reponer,
              CASE 
                WHEN p.stock_actual = 0 THEN 'Agotado'
                WHEN p.stock_actual <= p.stock_minimo THEN 'Bajo'
                ELSE 'Normal'
              END as estado_stock,
              json_agg(
                json_build_object(
                  'id', prov.id,
                  'nombre', prov.nombre,
                  'telefono', prov.telefono,
                  'contacto', prov.contacto,
                  'precio_compra', pp.precio_compra,
                  'tiempo_entrega', pp.tiempo_entrega_dias,
                  'cantidad_minima', pp.cantidad_minima_pedido
                )
              ) as proveedores
       FROM productos p 
       LEFT JOIN categorias c ON p.categoria_id = c.id
       LEFT JOIN producto_proveedor pp ON p.id = pp.producto_id AND pp.activo = true
       LEFT JOIN proveedores prov ON pp.proveedor_id = prov.id AND prov.activo = true
       WHERE p.activo = true 
       AND p.modulo_id = $1
       AND p.stock_actual <= p.stock_minimo
       GROUP BY p.id, c.nombre
       ORDER BY p.stock_actual ASC`,
      [moduloId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo alertas completas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ==================== RUTAS DE REPORTES ====================

app.get('/api/reportes', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const { tipo, fecha_inicio, fecha_fin } = req.query;
    const moduloId = req.moduloId;
    const negocioId = req.negocioId;

    if (!moduloId) {
      return res.status(400).json({ error: 'Se requiere un módulo' });
    }

    let reporteData;
    
    switch (tipo) {
      case 'ventas_diarias':
        reporteData = await generarReporteVentasDiarias(pool, negocioId, moduloId, fecha_inicio, fecha_fin);
        break;
      case 'ventas_mensual':
        reporteData = await generarReporteFinancieroMensual(pool, negocioId, moduloId, fecha_inicio, fecha_fin);
        break;
      case 'inventario':
        reporteData = await generarReporteInventario(pool, negocioId, moduloId);
        break;
      case 'productos_excel':
        reporteData = await generarExcelProductos(pool, moduloId);
        break;
      case 'ventas_excel':
        reporteData = await generarExcelVentas(pool, moduloId, fecha_inicio, fecha_fin);
        break;
      default:
        return res.status(400).json({ error: 'Tipo de reporte inválido' });
    }

    const extension = tipo.includes('excel') ? 'xlsx' : 'pdf';
    const contentType = tipo.includes('excel') ? 
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 
      'application/pdf';
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename=reporte_${tipo}.${extension}`);
    
    res.send(reporteData);

  } catch (error) {
    console.error('Error generando reporte:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ==================== RUTAS DE GESTIÓN DE INVENTARIO ====================

app.post('/api/inventario/agregar-stock', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  
  try {
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
    await client.query('ROLLBACK');
    console.error('Error agregando stock:', error);
    const mensaje = error.code ? 'Error al agregar stock' : error.message;
    res.status(400).json({ error: mensaje });
  } finally {
    client.release();
  }
});

app.post('/api/inventario/ajustar-stock', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  
  try {
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
    await client.query('ROLLBACK');
    console.error('Error ajustando stock:', error);
    const mensaje = error.code ? 'Error al ajustar stock' : error.message;
    res.status(400).json({ error: mensaje });
  } finally {
    client.release();
  }
});

// ==================== RUTAS DE USUARIOS (solo super admin) ====================

app.get('/api/negocios/:id/usuarios', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `SELECT u.id, u.nombre, u.email, u.rol, u.activo, 
              json_agg(m.nombre) as modulos_asignados
       FROM usuarios u
       LEFT JOIN usuario_modulos um ON u.id = um.usuario_id
       LEFT JOIN modulos m ON um.modulo_id = m.id
       WHERE u.negocio_id = $1 AND u.rol != 'super_admin'
       GROUP BY u.id
       ORDER BY u.nombre`,
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/negocios/:id/usuarios', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, email, password, rol } = req.body;

    if (!['admin', 'trabajador'].includes(rol)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    const usuarioExistente = await pool.query(
      'SELECT id FROM usuarios WHERE email = $1 AND negocio_id = $2',
      [email, id]
    );

    if (usuarioExistente.rows.length > 0) {
      return res.status(400).json({ error: 'El email ya está registrado en este negocio' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO usuarios (negocio_id, nombre, email, password, rol) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, nombre, email, rol, fecha_creacion`,
      [id, nombre, email, hashedPassword, rol]
    );

    if (rol === 'trabajador') {
      const moduloPrincipal = await pool.query(
        'SELECT id FROM modulos WHERE negocio_id = $1 AND nombre = $2',
        [id, 'Módulo Principal']
      );
      
      if (moduloPrincipal.rows.length > 0) {
        await pool.query(
          'INSERT INTO usuario_modulos (usuario_id, modulo_id) VALUES ($1, $2)',
          [result.rows[0].id, moduloPrincipal.rows[0].id]
        );
      }
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creando usuario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.delete('/api/usuarios/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const usuario = await pool.query(
      'SELECT rol FROM usuarios WHERE id = $1',
      [id]
    );

    if (usuario.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (usuario.rows[0].rol === 'super_admin') {
      return res.status(400).json({ error: 'No se puede eliminar un super administrador' });
    }

    await pool.query('UPDATE usuarios SET activo = false WHERE id = $1', [id]);
    await pool.query('DELETE FROM usuario_modulos WHERE usuario_id = $1', [id]);

    res.json({ message: 'Usuario eliminado correctamente' });
  } catch (error) {
    console.error('Error eliminando usuario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ==================== RUTAS DE SALUD ====================

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Servidor funcionando correctamente',
    timestamp: new Date().toISOString()
  });
});

// ==================== SERVIR FRONTEND ====================

app.use(express.static(path.join(__dirname, '../frontend/dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

// ==================== INICIAR SERVIDOR ====================

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📊 Sistema de Inventario con Módulos`);
  console.log(`💾 Base de datos: ${process.env.DB_NAME || 'inventario_negocio'}`);
});