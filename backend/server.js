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
      process.env.JWT_SECRET || 'secreto_temporal',
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
      query += ` AND (p.nombre ILIKE $2 OR p.codigo_ean = $3)`;
      params.push(`%${search}%`, search);
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

    const result = await pool.query(
      `INSERT INTO productos 
       (modulo_id, codigo_ean, nombre, descripcion, precio_compra, precio_venta, stock_actual, stock_minimo, categoria_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       RETURNING *`,
      [moduloId, codigo_ean, nombre, descripcion, precio_compra, precio_venta, stock_actual, stock_minimo, categoria_id]
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
      [codigo_ean, nombre, descripcion, precio_compra, precio_venta, stock_actual, stock_minimo, categoria_id, id, moduloId]
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
    
    const { detalles, cliente_nombre, cliente_documento, cliente_direccion, cliente_telefono, metodo_pago } = req.body;
    const usuario_id = req.user.id;
    const moduloId = req.moduloId;

    if (!moduloId) {
      return res.status(400).json({ error: 'Se requiere un módulo' });
    }

    console.log('🛒 Procesando venta - Usuario:', req.user.email, 'Módulo:', moduloId);

    for (const detalle of detalles) {
      const stockResult = await client.query(
        'SELECT id, nombre, stock_actual FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true',
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

    const numero_factura = await generarNumeroFactura(moduloId);
    console.log('🧾 Número de factura generado:', numero_factura);
    
    const subtotal = detalles.reduce((sum, detalle) => sum + (detalle.cantidad * detalle.precio_unitario), 0);
    const total = subtotal;

    console.log('💰 Totales - Subtotal:', subtotal, 'Total:', total);
    
    const ventaResult = await client.query(
      `INSERT INTO ventas 
       (modulo_id, numero_factura, cliente_nombre, cliente_documento, cliente_direccion, cliente_telefono, subtotal, total, usuario_id, metodo_pago) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       RETURNING *`,
      [moduloId, numero_factura, cliente_nombre, cliente_documento, cliente_direccion, cliente_telefono, subtotal, total, usuario_id, metodo_pago]
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
       JOIN negocios n ON v.negocio_id = n.id
       JOIN modulos m ON v.modulo_id = m.id
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
    console.error('❌ ERROR registrando venta:', error.message);
    res.status(400).json({ error: error.message });
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
       JOIN negocios n ON v.negocio_id = n.id
       JOIN modulos m ON v.modulo_id = m.id
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

    const ventasPeriodo = await pool.query(
      `SELECT COUNT(*) as total, COALESCE(SUM(total), 0) as monto 
       FROM ventas 
       WHERE modulo_id = $1 
       AND fecha_venta BETWEEN $2 AND $3`,
      [moduloId, startDate, endDate]
    );

    const productosStockBajo = await pool.query(
      `SELECT COUNT(*) as total 
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

    const response = {
      ventasPeriodo: ventasPeriodo.rows[0] || { total: 0, monto: 0 },
      productosStockBajo: productosStockBajo.rows[0] || { total: 0 },
      topProductos: topProductos.rows,
      ventasPorDia: ventasPorDia.rows,
      totalProductos: totalProductos.rows[0]?.total || 0,
      metodoPagoPopular: metodoPagoPopular.rows[0] || null,
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
      `SELECT COUNT(*) as total, COALESCE(SUM(total), 0) as monto 
       FROM ventas 
       WHERE negocio_id = $1 AND fecha_venta BETWEEN $2 AND $3`,
      [negocioId, startDate, endDate]
    );

    const productosGlobales = await pool.query(
      `SELECT COUNT(*) as total 
       FROM productos 
       WHERE negocio_id = $1 AND activo = true`,
      [negocioId]
    );

    const stockBajoGlobal = await pool.query(
      `SELECT COUNT(*) as total 
       FROM productos 
       WHERE negocio_id = $1 AND stock_actual <= stock_minimo AND activo = true`,
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
      return res.status(400).json({ error: 'Se requiere un módulo' });
    }

    const productoResult = await client.query(
      'SELECT id, nombre, stock_actual FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true',
      [producto_id, moduloId]
    );

    if (productoResult.rows.length === 0) {
      throw new Error('Producto no encontrado o no pertenece a este módulo');
    }

    const producto = productoResult.rows[0];
    const nuevoStock = producto.stock_actual + parseInt(cantidad);
    
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
        cantidad_agregada: cantidad
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error agregando stock:', error.message);
    res.status(400).json({ error: error.message });
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
      return res.status(400).json({ error: 'Se requiere un módulo' });
    }

    const productoResult = await client.query(
      'SELECT id, nombre, stock_actual FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true',
      [producto_id, moduloId]
    );

    if (productoResult.rows.length === 0) {
      throw new Error('Producto no encontrado o no pertenece a este módulo');
    }

    const producto = productoResult.rows[0];
    const diferencia = nuevo_stock - producto.stock_actual;
    
    await client.query(
      'UPDATE productos SET stock_actual = $1, fecha_actualizacion = NOW() WHERE id = $2',
      [nuevo_stock, producto_id]
    );

    await client.query('COMMIT');
    
    res.json({ 
      success: true, 
      message: 'Stock ajustado correctamente',
      producto: {
        id: producto.id,
        nombre: producto.nombre,
        stock_anterior: producto.stock_actual,
        stock_nuevo: nuevo_stock,
        diferencia: diferencia
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error ajustando stock:', error.message);
    res.status(400).json({ error: error.message });
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