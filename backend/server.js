const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const moment = require('moment');
const path = require('path');
const crypto = require('crypto');
const webpush = require('web-push');
require('dotenv').config();

// El servidor corre en UTC (confirmado con SHOW timezone en Postgres), pero
// el negocio opera en Colombia (UTC-5, sin horario de verano). moment()
// solo, sin fijar el offset, calcula "hoy"/"inicio de día" según la zona
// horaria del proceso — que en producción es UTC, no Bogotá. Esto hacía
// que los filtros de período de Estadísticas y Finanzas (hoy/semana/mes)
// no coincidieran con el día real en Colombia. ahoraColombia() fija el
// offset explícitamente para que el cálculo sea correcto sin importar en
// qué zona horaria esté corriendo el proceso de Node.
const ahoraColombia = () => moment().utcOffset(-300);

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

// CONFIGURACIÓN DE WEB PUSH (notificaciones de pedidos nuevos)
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('🔔 Web Push configurado');
} else {
  console.warn('⚠️ VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT no configuradas — las notificaciones push no se enviarán.');
}

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
  // pool.connect() dentro del try: si la conexión falla, no debe quedar
  // como una promesa rechazada sin atrapar que tumbe todo el proceso.
  let client;

  try {
    client = await pool.connect();
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
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    console.error('Error creando negocio:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (client) client.release();
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

// Datos básicos de un módulo del propio negocio (usada hoy para prellenar
// la configuración del menú público en PedidosCliente.jsx — la foto de
// portada del hero). checkAccess ya valida sesión y resuelve negocioId.
app.get('/api/modulos/:id', authenticateToken, checkAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const negocioId = req.negocioId;

    if (!negocioId) {
      return res.status(400).json({ error: 'Negocio no identificado' });
    }

    const result = await pool.query(
      'SELECT id, nombre, descripcion, activo, foto_portada_url FROM modulos WHERE id = $1 AND negocio_id = $2',
      [id, negocioId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Módulo no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error obteniendo módulo:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Configurar la foto de portada del menú público (hero de MenuPublico.jsx).
// Ruta dedicada en vez de un PUT /api/modulos/:id genérico porque hoy no
// existe ninguna ruta general de edición de módulo, y este es el único
// campo editable por ahora.
app.put('/api/modulos/:id/portada', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const negocioId = req.negocioId;
    const { foto_portada_url } = req.body;

    if (!negocioId) {
      return res.status(400).json({ error: 'Negocio no identificado' });
    }

    const result = await pool.query(
      `UPDATE modulos SET foto_portada_url = $1
       WHERE id = $2 AND negocio_id = $3
       RETURNING id, nombre, descripcion, activo, foto_portada_url`,
      [foto_portada_url?.trim() || null, id, negocioId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Módulo no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error actualizando foto de portada del módulo:', error);
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
      categoria_id,
      es_novedad,
      foto_url,
      ignora_stock
    } = req.body;

    const moduloId = req.moduloId;

    if (!moduloId) {
      return res.status(400).json({ error: 'Se requiere un módulo' });
    }

    // '' (sin categoría) no es un entero válido para esta columna
    const categoriaIdValor = categoria_id === '' || categoria_id === undefined ? null : categoria_id;

    const result = await pool.query(
      `INSERT INTO productos
       (modulo_id, codigo_ean, nombre, descripcion, precio_compra, precio_venta, stock_actual, stock_minimo, categoria_id, es_novedad, foto_url, ignora_stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [moduloId, codigo_ean, nombre, descripcion, precio_compra, precio_venta, stock_actual, stock_minimo, categoriaIdValor, !!es_novedad, foto_url?.trim() || null, !!ignora_stock]
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
      categoria_id,
      es_novedad,
      foto_url,
      ignora_stock
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
           es_novedad = $9,
           foto_url = $10,
           ignora_stock = $11,
           fecha_actualizacion = NOW()
       WHERE id = $12 AND modulo_id = $13
       RETURNING *`,
      [codigo_ean, nombre, descripcion, precio_compra, precio_venta, stock_actual, stock_minimo, categoriaIdValor, !!es_novedad, foto_url?.trim() || null, !!ignora_stock, id, moduloId]
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

// Crear categoría de producto
app.post('/api/categorias', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
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
app.put('/api/categorias/:id', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
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
app.delete('/api/categorias/:id', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const moduloId = req.moduloId;

    const categoriaResult = await pool.query(
      'SELECT id FROM categorias WHERE id = $1 AND modulo_id = $2',
      [id, moduloId]
    );
    if (categoriaResult.rows.length === 0) {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }

    const enUso = await pool.query(
      'SELECT COUNT(*) as total FROM productos WHERE categoria_id = $1 AND activo = true',
      [id]
    );
    if (Number(enUso.rows[0].total) > 0) {
      return res.status(400).json({ error: 'Esta categoría tiene productos asociados. Reasígnalos a otra categoría antes de eliminarla.' });
    }

    await pool.query('DELETE FROM categorias WHERE id = $1 AND modulo_id = $2', [id, moduloId]);

    res.json({ message: 'Categoría eliminada correctamente' });
  } catch (error) {
    // productos.categoria_id no tiene ON DELETE, y el chequeo de arriba
    // solo mira productos activos: si quedan productos INACTIVOS con
    // esta categoría, el DELETE falla con violación de FK (23503). Se
    // traduce a un mensaje claro en vez del error crudo de Postgres.
    if (error.code === '23503') {
      return res.status(400).json({ error: 'Esta categoría todavía tiene productos asociados (incluso inactivos). Reasígnalos antes de eliminarla.' });
    }
    console.error('Error eliminando categoría:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ==================== RUTAS DE VENTAS ====================

app.post('/api/ventas', authenticateToken, checkAccess, async (req, res) => {
  // pool.connect() dentro del try: si la conexión falla, no debe quedar
  // como una promesa rechazada sin atrapar que tumbe todo el proceso.
  let client;

  try {
    client = await pool.connect();
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

    // Productos con ignora_stock = true (ej. categoría "Preparados": se
    // cocinan al pedir, no representan stock físico) — se pueden vender
    // sin importar stock_actual, y no lo descuentan al completarse.
    const productosQueIgnoranStock = new Set();

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
        'SELECT id, nombre, stock_actual, ignora_stock FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true FOR UPDATE',
        [detalle.producto_id, moduloId]
      );

      if (stockResult.rows.length === 0) {
        throw new Error(`Producto no encontrado o inactivo: ${detalle.producto_id}`);
      }

      const producto = stockResult.rows[0];
      if (producto.ignora_stock) {
        productosQueIgnoranStock.add(detalle.producto_id);
      } else if (producto.stock_actual < detalle.cantidad) {
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

      if (!productosQueIgnoranStock.has(detalle.producto_id)) {
        await client.query(
          'UPDATE productos SET stock_actual = stock_actual - $1, fecha_actualizacion = NOW() WHERE id = $2 AND modulo_id = $3',
          [detalle.cantidad, detalle.producto_id, moduloId]
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
       (modulo_id, numero_factura, cliente_nombre, cliente_documento, cliente_direccion, cliente_telefono, subtotal, total, usuario_id, metodo_pago, cliente_id, es_ajuste_manual)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, 'credito', $9, true)
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

    const ventasPeriodo = await pool.query(
      `SELECT COUNT(*) as total, COALESCE(SUM(total), 0) as monto
       FROM ventas
       WHERE modulo_id = $1
       AND fecha_venta BETWEEN $2 AND $3
       AND es_ajuste_manual = false
       AND metodo_pago != 'consumo_propio'`,
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
       AND v.es_ajuste_manual = false
       AND v.metodo_pago != 'consumo_propio'
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
       AND es_ajuste_manual = false
       AND metodo_pago != 'consumo_propio'
       GROUP BY DATE(fecha_venta)
       ORDER BY fecha ASC`,
      [moduloId, startDate, endDate]
    );

    // fecha_venta se guarda como "timestamp without time zone" y la sesión
    // de Postgres está en UTC (confirmado con current_setting('TIMEZONE')),
    // así que para reportar hora/día del negocio en Colombia hay que
    // convertir explícitamente UTC -> America/Bogota antes de extraer.
    const ventasPorHora = await pool.query(
      `SELECT h.hora,
              COALESCE(COUNT(v.id), 0) as total_ventas,
              COALESCE(SUM(v.total), 0) as monto
       FROM generate_series(0, 23) as h(hora)
       LEFT JOIN ventas v
         ON EXTRACT(HOUR FROM v.fecha_venta AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') = h.hora
         AND v.modulo_id = $1
         AND v.fecha_venta BETWEEN $2 AND $3
         AND v.es_ajuste_manual = false
         AND v.metodo_pago != 'consumo_propio'
       GROUP BY h.hora
       ORDER BY h.hora`,
      [moduloId, startDate, endDate]
    );

    // EXTRACT(DOW ...) devuelve 0=domingo, 1=lunes, ..., 6=sábado.
    const ventasPorDiaSemana = await pool.query(
      `SELECT dia.numero,
              COALESCE(COUNT(v.id), 0) as total_ventas,
              COALESCE(SUM(v.total), 0) as monto
       FROM generate_series(0, 6) as dia(numero)
       LEFT JOIN ventas v
         ON EXTRACT(DOW FROM v.fecha_venta AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') = dia.numero
         AND v.modulo_id = $1
         AND v.fecha_venta BETWEEN $2 AND $3
         AND v.es_ajuste_manual = false
         AND v.metodo_pago != 'consumo_propio'
       GROUP BY dia.numero
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
         AND v.es_ajuste_manual = false
         AND v.metodo_pago != 'consumo_propio'
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
       AND fecha_venta BETWEEN $2 AND $3
       AND es_ajuste_manual = false
       AND metodo_pago != 'consumo_propio'`,
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
           dias_entrega = $7
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
          pp.tiempo_entrega_dias, pp.cantidad_minima_pedido, pp.precio_compra,
          pp.unidades_por_paquete
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
      const ventasPorSemana = totalVendido / (diasHistorial / 7);
      const tiempoEntrega = producto.tiempo_entrega_dias || proveedor.dias_entrega || 3;
      const tiempoEntregaSemanas = tiempoEntrega / 7;
      const consumoEsperado = ventasPorSemana * tiempoEntregaSemanas;
      let cantidadSugerida = Math.ceil(
        Math.max(0, consumoEsperado + producto.stock_minimo - producto.stock_actual)
      );

      // Respeta el mínimo de pedido del proveedor si existe
      if (producto.cantidad_minima_pedido && cantidadSugerida > 0 && cantidadSugerida < producto.cantidad_minima_pedido) {
        cantidadSugerida = producto.cantidad_minima_pedido;
      }

      const unidadesPorPaquete = producto.unidades_por_paquete || 1;
      const cantidadSugeridaPaquetes = Math.ceil(cantidadSugerida / unidadesPorPaquete);

      sugerencias.push({
        producto_id: producto.id,
        nombre: producto.nombre,
        codigo_ean: producto.codigo_ean,
        stock_actual: producto.stock_actual,
        stock_minimo: producto.stock_minimo,
        ventas_por_semana: Math.round(ventasPorSemana * 10) / 10,
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
    const negocioId = req.negocioId;
    const moduloId = req.moduloId;

    if (!moduloId) {
      return res.status(400).json({ error: 'Se requiere un módulo' });
    }

    const proveedorResult = await pool.query(
      'SELECT id FROM proveedores WHERE id = $1 AND negocio_id = $2 AND activo = true',
      [id, negocioId]
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
app.post('/api/proveedores/:id/productos-bulk', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  // pool.connect() dentro del try: si la conexión falla, no debe quedar
  // como una promesa rechazada sin atrapar que tumbe todo el proceso.
  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const { id } = req.params;
    const negocioId = req.negocioId;
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
      'SELECT id, dias_entrega FROM proveedores WHERE id = $1 AND negocio_id = $2 AND activo = true',
      [id, negocioId]
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
app.post('/api/productos/:productoId/proveedores/:proveedorId', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const { productoId, proveedorId } = req.params;
    const { precio_compra, tiempo_entrega_dias, cantidad_minima_pedido, unidades_por_paquete } = req.body;
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
app.delete('/api/productos/:productoId/proveedores/:proveedorId', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const { productoId, proveedorId } = req.params;
    const negocioId = req.negocioId;

    const proveedorResult = await pool.query(
      'SELECT id FROM proveedores WHERE id = $1 AND negocio_id = $2 AND activo = true',
      [proveedorId, negocioId]
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
app.post('/api/pedidos', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
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
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    console.error('Error creando pedido:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (client) client.release();
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

// ==================== RUTAS DE CATEGORÍAS DE GASTO ====================
// Clasificación propia para egresos manuales (distinta del campo de texto
// libre movimientos_caja.categoria, que sigue usándose tal cual, incluyendo
// el marcador 'abono_credito').

app.get('/api/categorias-gasto', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const negocioId = req.negocioId;

    if (!negocioId) {
      return res.status(400).json({ error: 'Negocio no identificado' });
    }

    const result = await pool.query(
      'SELECT * FROM categorias_gasto WHERE negocio_id = $1 AND activo = true ORDER BY nombre',
      [negocioId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo categorías de gasto:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/categorias-gasto', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const negocioId = req.negocioId;
    const { nombre } = req.body;

    if (!negocioId) {
      return res.status(400).json({ error: 'Negocio no identificado' });
    }

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre es requerido' });
    }

    // El UNIQUE(negocio_id, nombre) de la tabla incluye las inactivas, así
    // que validamos antes para responder con un mensaje claro en vez del
    // error crudo del constraint.
    const existente = await pool.query(
      'SELECT id FROM categorias_gasto WHERE negocio_id = $1 AND nombre = $2',
      [negocioId, nombre.trim()]
    );
    if (existente.rows.length > 0) {
      return res.status(400).json({ error: 'Ya existe una categoría de gasto con ese nombre' });
    }

    const result = await pool.query(
      'INSERT INTO categorias_gasto (negocio_id, nombre) VALUES ($1, $2) RETURNING *',
      [negocioId, nombre.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creando categoría de gasto:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.put('/api/categorias-gasto/:id', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const negocioId = req.negocioId;
    const { nombre } = req.body;

    if (!nombre || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre es requerido' });
    }

    const existente = await pool.query(
      'SELECT id FROM categorias_gasto WHERE negocio_id = $1 AND nombre = $2 AND id != $3',
      [negocioId, nombre.trim(), id]
    );
    if (existente.rows.length > 0) {
      return res.status(400).json({ error: 'Ya existe una categoría de gasto con ese nombre' });
    }

    const result = await pool.query(
      'UPDATE categorias_gasto SET nombre = $1 WHERE id = $2 AND negocio_id = $3 RETURNING *',
      [nombre.trim(), id, negocioId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Categoría de gasto no encontrada' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error actualizando categoría de gasto:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Soft delete: los movimientos_caja que ya la usan conservan su
// categoria_gasto_id, solo deja de ofrecerse para nuevos registros.
app.delete('/api/categorias-gasto/:id', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const negocioId = req.negocioId;

    await pool.query(
      'UPDATE categorias_gasto SET activo = false WHERE id = $1 AND negocio_id = $2',
      [id, negocioId]
    );

    res.json({ message: 'Categoría de gasto eliminada correctamente' });
  } catch (error) {
    console.error('Error eliminando categoría de gasto:', error);
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
    const { tipo, monto, concepto, categoria, pedido_id, categoria_gasto_id } = req.body;

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

    // categoria_gasto_id es independiente de pedido_id: un egreso puede
    // tener uno, otro, ambos o ninguno.
    let categoriaGastoIdValida = null;
    if (categoria_gasto_id !== undefined && categoria_gasto_id !== null && categoria_gasto_id !== '') {
      if (tipo !== 'egreso') {
        return res.status(400).json({ error: 'categoria_gasto_id solo puede vincularse a un movimiento de tipo egreso' });
      }

      const categoriaResult = await pool.query(
        'SELECT id FROM categorias_gasto WHERE id = $1 AND negocio_id = $2',
        [categoria_gasto_id, negocioId]
      );
      if (categoriaResult.rows.length === 0) {
        return res.status(404).json({ error: 'Categoría de gasto no encontrada' });
      }

      categoriaGastoIdValida = categoria_gasto_id;
    }

    const result = await pool.query(
      `INSERT INTO movimientos_caja
       (negocio_id, tipo, origen, monto, concepto, categoria, pedido_id, usuario_id, categoria_gasto_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [negocioId, tipo, origen, montoNum, concepto.trim(), categoria || null, origen === 'pedido' ? pedido_id : null, usuarioId, categoriaGastoIdValida]
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
      `SELECT mc.*, u.nombre as usuario_nombre, cg.nombre as categoria_gasto_nombre
       FROM movimientos_caja mc
       LEFT JOIN usuarios u ON mc.usuario_id = u.id
       LEFT JOIN categorias_gasto cg ON mc.categoria_gasto_id = cg.id
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

// Resumen de ingresos/egresos de un período, para la pestaña "Ingresos y
// Egresos" de Estadísticas. Misma resolución de fechas que GET
// /api/estadisticas, pero sobre el negocio completo (movimientos_caja no
// es por módulo).
app.get('/api/finanzas/resumen-periodo', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const negocioId = req.negocioId;
    const { periodo, fecha_inicio, fecha_fin } = req.query;

    if (!negocioId) {
      return res.status(400).json({ error: 'Negocio no identificado' });
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
       WHERE negocio_id = $1 AND fecha BETWEEN $2 AND $3`,
      [negocioId, startDate, endDate]
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
            ELSE 'sin_categoria'
          END as grupo_key,
          CASE
            WHEN mc.categoria_gasto_id IS NOT NULL THEN cg.nombre
            WHEN mc.origen = 'pedido' THEN '📦 Pedidos a proveedor'
            ELSE '🗂️ Sin categoría'
          END as grupo_nombre,
          SUM(mc.monto) as monto
       FROM movimientos_caja mc
       LEFT JOIN categorias_gasto cg ON mc.categoria_gasto_id = cg.id
       WHERE mc.negocio_id = $1 AND mc.tipo = 'egreso' AND mc.fecha BETWEEN $2 AND $3
       GROUP BY grupo_key, grupo_nombre
       ORDER BY monto DESC`,
      [negocioId, startDate, endDate]
    );

    // tipo = 'saldo_inicial' se evalúa primero para que nunca caiga en el
    // grupo "Ingresos manuales" (ambos tienen origen = 'manual').
    const ingresosPorOrigen = await pool.query(
      `SELECT
          CASE
            WHEN mc.tipo = 'saldo_inicial' THEN 'saldo_inicial'
            WHEN mc.origen = 'venta' THEN 'venta'
            WHEN mc.origen = 'manual' AND mc.categoria = 'abono_credito' THEN 'abono'
            ELSE 'manual'
          END as grupo_key,
          CASE
            WHEN mc.tipo = 'saldo_inicial' THEN '🏦 Saldo inicial'
            WHEN mc.origen = 'venta' THEN '🛒 Ventas'
            WHEN mc.origen = 'manual' AND mc.categoria = 'abono_credito' THEN '💰 Abonos de clientes'
            ELSE '✋ Ingresos manuales'
          END as grupo_nombre,
          SUM(mc.monto) as monto
       FROM movimientos_caja mc
       WHERE mc.negocio_id = $1 AND mc.tipo IN ('ingreso', 'saldo_inicial') AND mc.fecha BETWEEN $2 AND $3
       GROUP BY grupo_key, grupo_nombre
       ORDER BY monto DESC`,
      [negocioId, startDate, endDate]
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
// semana puntual (lunes a domingo). Todo a nivel de negocio (como el
// resto de Finanzas), NO por módulo.
app.get('/api/finanzas/reporte-semanal', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
  try {
    const negocioId = req.negocioId;
    const { semana_inicio } = req.query;

    if (!negocioId) {
      return res.status(400).json({ error: 'Negocio no identificado' });
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
       WHERE negocio_id = $1 AND origen = 'venta' AND fecha BETWEEN $2 AND $3`,
      [negocioId, startDate, endDate]
    );

    // "Inversión Mercancía" es una categoría de gasto que el negocio crea
    // a mano (igual que "Gastos Fijos" más abajo) — si no existe con ese
    // nombre exacto para este negocio, el IN (SELECT...) queda vacío y
    // esta parte del total simplemente no suma nada (no es un error).
    const mercanciaResult = await pool.query(
      `SELECT COALESCE(SUM(monto), 0) as total
       FROM movimientos_caja
       WHERE negocio_id = $1 AND fecha BETWEEN $2 AND $3
         AND (
           origen = 'pedido'
           OR (origen = 'manual' AND categoria_gasto_id IN (
             SELECT id FROM categorias_gasto WHERE negocio_id = $1 AND LOWER(nombre) = LOWER('Inversión Mercancía')
           ))
         )`,
      [negocioId, startDate, endDate]
    );

    // Mismo criterio que GET /api/estadisticas/consumo-propio (ventas con
    // metodo_pago = 'consumo_propio'), pero acotado a esta semana y a
    // nivel de negocio completo en vez de un módulo puntual — Finanzas ya
    // opera así en el resto de sus rutas (balance, resumen-periodo), así
    // que se hace el mismo join ventas -> modulos para llegar a
    // negocio_id en vez de filtrar por modulo_id.
    const propiosResult = await pool.query(
      `SELECT COALESCE(SUM(v.total), 0) as total
       FROM ventas v
       JOIN modulos m ON v.modulo_id = m.id
       WHERE m.negocio_id = $1 AND v.metodo_pago = 'consumo_propio' AND v.fecha_venta BETWEEN $2 AND $3`,
      [negocioId, startDate, endDate]
    );

    const fijosResult = await pool.query(
      `SELECT COALESCE(SUM(monto), 0) as total
       FROM movimientos_caja
       WHERE negocio_id = $1 AND origen = 'manual' AND fecha BETWEEN $2 AND $3
         AND categoria_gasto_id IN (
           SELECT id FROM categorias_gasto WHERE negocio_id = $1 AND LOWER(nombre) = LOWER('Gastos Fijos')
         )`,
      [negocioId, startDate, endDate]
    );

    // No se crea la fila si todavía no existe — solo al guardar (POST de
    // abajo). Antes de eso, el registro semanal simplemente muestra 0.
    const reinversionResult = await pool.query(
      'SELECT monto, notas FROM metas_reinversion WHERE negocio_id = $1 AND semana_inicio = $2',
      [negocioId, semanaInicioStr]
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
    const negocioId = req.negocioId;
    const { semana_inicio, monto, notas } = req.body;

    if (!negocioId) {
      return res.status(400).json({ error: 'Negocio no identificado' });
    }

    if (!esLunesValido(semana_inicio)) {
      return res.status(400).json({ error: 'semana_inicio debe ser una fecha YYYY-MM-DD que caiga en lunes' });
    }

    const montoNum = Number(monto);
    if (!Number.isFinite(montoNum) || montoNum < 0) {
      return res.status(400).json({ error: 'El monto debe ser un número mayor o igual a cero' });
    }

    const result = await pool.query(
      `INSERT INTO metas_reinversion (negocio_id, semana_inicio, monto, notas, fecha_registro)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (negocio_id, semana_inicio)
       DO UPDATE SET monto = $3, notas = $4, fecha_registro = NOW()
       RETURNING *`,
      [negocioId, semana_inicio, montoNum, notas?.trim() || null]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error guardando meta de reinversión:', error);
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

app.post('/api/inventario/ajustar-stock', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
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
      return res.status(400).json({ error: 'Ingresa el nombre o número de mesa' });
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
app.put('/api/pedidos-cliente/:id/completar', authenticateToken, checkAccess, async (req, res) => {
  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const { id } = req.params;
    const moduloId = req.moduloId;
    const negocioId = req.negocioId;
    const usuarioId = req.user.id;
    const { metodo_pago, cliente_id } = req.body;

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
    if (metodo_pago === 'credito' && !cliente_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Para completar como crédito, este pedido necesita un cliente registrado primero' });
    }

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

    for (const detalle of detalles) {
      const stockResult = await client.query(
        'SELECT id, nombre, stock_actual, ignora_stock FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true FOR UPDATE',
        [detalle.producto_id, moduloId]
      );

      if (stockResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Producto no encontrado o inactivo: ${detalle.nombre_producto}` });
      }

      const producto = stockResult.rows[0];
      if (producto.ignora_stock) {
        productosQueIgnoranStock.add(detalle.producto_id);
      } else if (producto.stock_actual < detalle.cantidad) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Stock insuficiente para "${producto.nombre}". Stock actual: ${producto.stock_actual}, solicitado: ${detalle.cantidad}`
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

    for (const detalle of detalles) {
      await client.query(
        `INSERT INTO detalle_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [venta.id, detalle.producto_id, detalle.cantidad, detalle.precio_unitario, detalle.subtotal]
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
      await client.query(
        `INSERT INTO movimientos_caja
         (negocio_id, tipo, origen, monto, concepto, venta_id, usuario_id)
         VALUES ($1, 'ingreso', 'venta', $2, $3, $4, $5)`,
        [negocioId, pedido.total, `Venta #${numero_factura}`, venta.id, usuarioId]
      );
    }

    const pedidoCompletado = await client.query(
      `UPDATE pedidos_cliente SET estado = 'completado', venta_id = $1, fecha_actualizacion = NOW() WHERE id = $2 RETURNING *`,
      [venta.id, pedido.id]
    );

    await client.query('COMMIT');

    res.json({ ...pedidoCompletado.rows[0], venta });
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

// ==================== RUTAS DE MENÚ PÚBLICO (SIN AUTENTICACIÓN) ====================
// A propósito SIN authenticateToken/checkAccess: son para clientes sin
// cuenta que escanean un QR. Usan el moduloId de la URL, nunca req.moduloId
// (que depende de la sesión de un usuario logueado). Tanda 2 de 3 del
// "Menú QR" — la Tanda 3 (panel del negocio, completar pedido con
// descuento de stock real) viene en un cambio aparte.

// Menú público: solo productos activos con stock disponible, sin datos
// internos (precio_compra, codigo_ean, etc.)
app.get('/api/menu/:moduloId', async (req, res) => {
  try {
    const { moduloId } = req.params;

    if (!/^\d+$/.test(moduloId)) {
      return res.status(404).json({ error: 'Menú no disponible' });
    }

    const moduloResult = await pool.query(
      `SELECT m.id, m.nombre, m.activo, m.foto_portada_url, n.nombre as negocio_nombre
       FROM modulos m
       JOIN negocios n ON m.negocio_id = n.id
       WHERE m.id = $1`,
      [moduloId]
    );

    if (moduloResult.rows.length === 0 || moduloResult.rows[0].activo === false) {
      return res.status(404).json({ error: 'Menú no disponible' });
    }

    const productosResult = await pool.query(
      `SELECT p.id, p.nombre, p.descripcion, p.precio_venta, p.stock_actual, p.foto_url, p.es_novedad, p.ignora_stock,
              c.nombre as categoria_nombre
       FROM productos p
       LEFT JOIN categorias c ON p.categoria_id = c.id
       WHERE p.modulo_id = $1 AND p.activo = true AND (p.stock_actual > 0 OR p.ignora_stock = true)
       ORDER BY c.nombre NULLS LAST, p.nombre`,
      [moduloId]
    );

    res.json({
      modulo: {
        id: moduloResult.rows[0].id,
        nombre: moduloResult.rows[0].nombre,
        negocio_nombre: moduloResult.rows[0].negocio_nombre,
        foto_portada_url: moduloResult.rows[0].foto_portada_url
      },
      productos: productosResult.rows
    });
  } catch (error) {
    console.error('Error obteniendo menú público:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Crear pedido de cliente. NO descuenta stock todavía (eso pasa en la
// Tanda 3, cuando el negocio lo completa) — solo valida que alcance.
// Envía un push a cada admin/trabajador del negocio suscrito, avisando de
// un pedido nuevo. Se llama SIN await después del COMMIT de la creación
// del pedido (fire-and-forget): un fallo aquí (VAPID mal configurado, el
// servicio push caído, etc.) nunca debe poder tumbar la respuesta al
// cliente ni la creación del pedido, que ya quedó confirmada en la BD.
async function enviarNotificacionesPedidoNuevo(moduloId, pedido) {
  try {
    const moduloResult = await pool.query(
      'SELECT negocio_id FROM modulos WHERE id = $1',
      [moduloId]
    );
    if (moduloResult.rows.length === 0) return;
    const negocioId = moduloResult.rows[0].negocio_id;

    const suscripcionesResult = await pool.query(
      'SELECT id, endpoint, p256dh, auth FROM push_suscripciones WHERE negocio_id = $1',
      [negocioId]
    );
    if (suscripcionesResult.rows.length === 0) return;

    const payload = JSON.stringify({
      title: '🧾 Nuevo pedido',
      body: `${pedido.mesa_nombre} · $${Number(pedido.total).toLocaleString('es-CO')}`,
      url: '/pedidos-cliente'
    });

    const resultados = await Promise.allSettled(
      suscripcionesResult.rows.map(sub =>
        webpush
          .sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
          .catch(err => {
            err.suscripcionId = sub.id;
            throw err;
          })
      )
    );

    for (const resultado of resultados) {
      if (resultado.status !== 'rejected') continue;
      const error = resultado.reason;
      if (error.statusCode === 410) {
        // 410 Gone: el navegador revocó esta suscripción, ya no sirve.
        await pool.query('DELETE FROM push_suscripciones WHERE id = $1', [error.suscripcionId]).catch(() => {});
      } else {
        console.error('Error enviando notificación push:', error.body || error.message);
      }
    }
  } catch (error) {
    console.error('Error enviando notificaciones de pedido nuevo:', error);
  }
}

app.post('/api/menu/:moduloId/pedidos', async (req, res) => {
  // client se declara afuera y pool.connect() va DENTRO del try: en una
  // ruta pública sin autenticación, si pool.connect() llega a rechazar
  // (ej. timeout de conexión) y queda fuera del try, la promesa rechazada
  // no la atrapa nada — Node la trata como unhandledRejection y tumba
  // todo el proceso, no solo esta petición.
  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const { moduloId } = req.params;
    const { mesa_nombre, monto_recibido, items } = req.body;

    if (!/^\d+$/.test(moduloId)) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Menú no disponible' });
    }

    const moduloResult = await client.query(
      'SELECT id, activo FROM modulos WHERE id = $1',
      [moduloId]
    );
    if (moduloResult.rows.length === 0 || moduloResult.rows[0].activo === false) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Menú no disponible' });
    }

    if (!mesa_nombre || !mesa_nombre.trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ingresa tu nombre o el número de mesa' });
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

      // Snapshot del precio_venta ACTUAL: se guarda en el detalle para que
      // si el precio cambia después, este pedido ya hecho no se altere.
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
    const tokenPublico = crypto.randomBytes(24).toString('hex');

    const pedidoResult = await client.query(
      `INSERT INTO pedidos_cliente (modulo_id, token_publico, mesa_nombre, monto_recibido, subtotal, total)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [moduloId, tokenPublico, mesa_nombre.trim(), montoRecibidoValido, subtotal, total]
    );

    const pedido = pedidoResult.rows[0];

    for (const detalle of detallesValidados) {
      await client.query(
        `INSERT INTO pedidos_cliente_detalle
         (pedido_cliente_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [pedido.id, detalle.producto_id, detalle.nombre_producto, detalle.cantidad, detalle.precio_unitario, detalle.subtotal]
      );
    }

    await client.query('COMMIT');

    enviarNotificacionesPedidoNuevo(moduloId, pedido).catch(err =>
      console.error('Error inesperado enviando notificaciones push:', err)
    );

    res.status(201).json({ ...pedido, detalles: detallesValidados });
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    console.error('Error creando pedido de cliente:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (client) client.release();
  }
});

// Consultar un pedido de cliente por su token público. Incluye el
// teléfono del negocio (vía modulos -> negocios) para que la confirmación
// pueda armar el link de WhatsApp sin una segunda llamada.
app.get('/api/menu/pedido/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const pedidoResult = await pool.query(
      `SELECT pc.*, n.telefono as negocio_telefono, n.nombre as negocio_nombre
       FROM pedidos_cliente pc
       JOIN modulos m ON pc.modulo_id = m.id
       JOIN negocios n ON m.negocio_id = n.id
       WHERE pc.token_publico = $1`,
      [token]
    );

    if (pedidoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const detalleResult = await pool.query(
      'SELECT * FROM pedidos_cliente_detalle WHERE pedido_cliente_id = $1 ORDER BY id',
      [pedidoResult.rows[0].id]
    );

    res.json({ ...pedidoResult.rows[0], detalles: detalleResult.rows });
  } catch (error) {
    console.error('Error obteniendo pedido de cliente:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Editar un pedido de cliente (solo si sigue 'pendiente'): reemplaza el
// detalle completo y revalida stock igual que en la creación.
app.put('/api/menu/pedido/:token', async (req, res) => {
  // Mismo motivo que en POST /api/menu/:moduloId/pedidos: pool.connect()
  // va dentro del try para que un fallo de conexión no tumbe el proceso.
  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const { token } = req.params;
    const { mesa_nombre, monto_recibido, items } = req.body;

    // FOR UPDATE: evita que una edición y, por ejemplo, una cancelación
    // simultánea del mismo pedido se pisen entre sí.
    const pedidoResult = await client.query(
      'SELECT * FROM pedidos_cliente WHERE token_publico = $1 FOR UPDATE',
      [token]
    );

    if (pedidoResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const pedido = pedidoResult.rows[0];

    if (pedido.estado !== 'pendiente') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Este pedido ya está siendo procesado por el negocio, no se puede editar. Contacta directamente si necesitas cambiarlo'
      });
    }

    if (!mesa_nombre || !mesa_nombre.trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ingresa tu nombre o el número de mesa' });
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
        [item.producto_id, pedido.modulo_id]
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
    console.error('Error editando pedido de cliente:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    if (client) client.release();
  }
});

// Cancelar un pedido de cliente (solo si no está ya 'completado')
// Confirmar un pedido de cliente (solo desde 'pendiente'). Es un cambio de
// estado real, no solo un botón que abre WhatsApp: si el pedido se queda
// en 'pendiente' tras enviarlo, el cliente podría seguir editándolo
// después de mandar el mensaje y el negocio nunca se enteraría del cambio
// (ya vio el mensaje viejo).
app.put('/api/menu/pedido/:token/confirmar', async (req, res) => {
  try {
    const { token } = req.params;

    const pedidoResult = await pool.query(
      'SELECT * FROM pedidos_cliente WHERE token_publico = $1',
      [token]
    );

    if (pedidoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    const pedido = pedidoResult.rows[0];

    if (pedido.estado !== 'pendiente') {
      return res.status(400).json({
        error: 'Este pedido ya no está pendiente (puede que ya lo hayan cancelado o procesado). Recarga la página para ver su estado actual.'
      });
    }

    const actualizado = await pool.query(
      `UPDATE pedidos_cliente SET estado = 'confirmado', fecha_actualizacion = NOW() WHERE id = $1 RETURNING *`,
      [pedido.id]
    );

    res.json(actualizado.rows[0]);
  } catch (error) {
    console.error('Error confirmando pedido de cliente:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.put('/api/menu/pedido/:token/cancelar', async (req, res) => {
  try {
    const { token } = req.params;

    const pedidoResult = await pool.query(
      'SELECT * FROM pedidos_cliente WHERE token_publico = $1',
      [token]
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
    console.error('Error cancelando pedido de cliente:', error);
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