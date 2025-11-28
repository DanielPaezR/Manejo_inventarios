const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// CONEXIÓN CORRECTA PARA RAILWAY
const pool = new Pool({
  // Usar DATABASE_URL completa que Railway provee
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  // Opciones adicionales
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// ✅ Debug para verificar
console.log('🔍 Conexión BD configurada con DATABASE_URL:', !!process.env.DATABASE_URL);


// Ruta para inicializar BD completa con tu script
app.get('/api/init-db-complete', async (req, res) => {
  try {
    console.log('🚀 Inicializando base de datos completa...');
    
    // Tu script SQL completo
    const initSQL = `
      -- Tabla de negocios
      CREATE TABLE IF NOT EXISTS negocios (
          id SERIAL PRIMARY KEY,
          nombre VARCHAR(255) NOT NULL,
          direccion TEXT,
          telefono VARCHAR(20),
          email VARCHAR(255),
          ruc_nit VARCHAR(50),
          logo_url TEXT,
          activo BOOLEAN DEFAULT true,
          fecha_creacion TIMESTAMP DEFAULT NOW()
      );

      -- Tabla de usuarios/empleados
      CREATE TABLE IF NOT EXISTS usuarios (
          id SERIAL PRIMARY KEY,
          negocio_id INTEGER REFERENCES negocios(id),
          nombre VARCHAR(100) NOT NULL,
          email VARCHAR(255) NOT NULL,
          password VARCHAR(255) NOT NULL,
          rol VARCHAR(20) DEFAULT 'trabajador',
          activo BOOLEAN DEFAULT true,
          fecha_creacion TIMESTAMP DEFAULT NOW(),
          UNIQUE(email, negocio_id)
      );

      -- Tabla de categorías por negocio
      CREATE TABLE IF NOT EXISTS categorias (
          id SERIAL PRIMARY KEY,
          negocio_id INTEGER REFERENCES negocios(id),
          nombre VARCHAR(100) NOT NULL,
          descripcion TEXT
      );

      -- Tabla de productos
      CREATE TABLE IF NOT EXISTS productos (
          id SERIAL PRIMARY KEY,
          negocio_id INTEGER REFERENCES negocios(id),
          codigo_ean VARCHAR(13),
          nombre VARCHAR(255) NOT NULL,
          descripcion TEXT,
          precio_compra DECIMAL(10,2),
          precio_venta DECIMAL(10,2) NOT NULL,
          stock_actual INTEGER DEFAULT 0,
          stock_minimo INTEGER DEFAULT 5,
          categoria_id INTEGER REFERENCES categorias(id),
          activo BOOLEAN DEFAULT true,
          fecha_creacion TIMESTAMP DEFAULT NOW(),
          fecha_actualizacion TIMESTAMP DEFAULT NOW(),
          UNIQUE(codigo_ean, negocio_id)
      );

      -- Tabla de ventas
      CREATE TABLE IF NOT EXISTS ventas (
          id SERIAL PRIMARY KEY,
          negocio_id INTEGER REFERENCES negocios(id),
          numero_factura VARCHAR(50) NOT NULL,
          fecha_venta TIMESTAMP DEFAULT NOW(),
          cliente_nombre VARCHAR(255),
          cliente_documento VARCHAR(50),
          cliente_direccion TEXT,
          cliente_telefono VARCHAR(20),
          subtotal DECIMAL(10,2) NOT NULL,
          iva DECIMAL(10,2) DEFAULT 0,
          total DECIMAL(10,2) NOT NULL,
          usuario_id INTEGER REFERENCES usuarios(id),
          estado VARCHAR(20) DEFAULT 'completada',
          metodo_pago VARCHAR(50) DEFAULT 'efectivo'
      );

      -- Tabla de detalles de venta
      CREATE TABLE IF NOT EXISTS detalle_venta (
          id SERIAL PRIMARY KEY,
          venta_id INTEGER REFERENCES ventas(id) ON DELETE CASCADE,
          producto_id INTEGER REFERENCES productos(id),
          cantidad INTEGER NOT NULL,
          precio_unitario DECIMAL(10,2) NOT NULL,
          subtotal DECIMAL(10,2) NOT NULL
      );

      -- Tabla de secuencias de facturación por negocio
      CREATE TABLE IF NOT EXISTS secuencias_factura (
          id SERIAL PRIMARY KEY,
          negocio_id INTEGER REFERENCES negocios(id) UNIQUE,
          prefijo VARCHAR(10) DEFAULT 'FAC',
          siguiente_numero INTEGER DEFAULT 1,
          resolucion_dian VARCHAR(100),
          fecha_resolucion DATE
      );

      -- Insertar datos iniciales
      -- 1. Crear negocio principal
      INSERT INTO negocios (nombre, direccion, telefono, email, ruc_nit) VALUES 
      ('Mi Negocio Principal', 'Dirección principal', '3001234567', 'info@minegocio.com', '123456789-0')
      ON CONFLICT DO NOTHING;

      -- 2. Crear super admin (sin negocio asignado)
      INSERT INTO usuarios (nombre, email, password, rol) VALUES 
      ('Super Administrador', 'superadmin@system.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'super_admin')
      ON CONFLICT (email, negocio_id) DO NOTHING;

      -- 3. Crear admin para el negocio principal
      INSERT INTO usuarios (negocio_id, nombre, email, password, rol) VALUES 
      (1, 'Administrador Principal', 'admin@negocio.com', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin')
      ON CONFLICT (email, negocio_id) DO NOTHING;

      -- 4. Crear secuencia de facturación para el negocio principal
      INSERT INTO secuencias_factura (negocio_id, prefijo, siguiente_numero, resolucion_dian) VALUES 
      (1, 'FAC', 1, 'Resolución DIAN 18764000000001')
      ON CONFLICT (negocio_id) DO NOTHING;

      -- 5. Insertar categorías para el negocio principal
      INSERT INTO categorias (negocio_id, nombre, descripcion) VALUES 
      (1, 'General', 'Productos sin categoría específica'),
      (1, 'Tecnología', 'Productos electrónicos y tecnológicos'),
      (1, 'Hogar', 'Artículos para el hogar')
      ON CONFLICT DO NOTHING;

      -- 6. Insertar algunos productos de ejemplo
      INSERT INTO productos (negocio_id, codigo_ean, nombre, descripcion, precio_compra, precio_venta, stock_actual, stock_minimo, categoria_id) VALUES 
      (1, '1234567890123', 'Laptop HP 15"', 'Laptop HP 15 pulgadas, 8GB RAM, 256GB SSD', 1200000, 1500000, 10, 2, 2),
      (1, '1234567890124', 'Mouse Inalámbrico', 'Mouse ergonómico inalámbrico', 25000, 45000, 25, 5, 2),
      (1, '1234567890125', 'Silla Oficina', 'Silla ergonómica para oficina', 180000, 250000, 8, 2, 3)
      ON CONFLICT (codigo_ean, negocio_id) DO NOTHING;

      -- Crear índices para mejor performance
      CREATE INDEX IF NOT EXISTS idx_usuarios_negocio ON usuarios(negocio_id);
      CREATE INDEX IF NOT EXISTS idx_productos_negocio ON productos(negocio_id);
      CREATE INDEX IF NOT EXISTS idx_ventas_negocio ON ventas(negocio_id);
      CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(fecha_venta);
      CREATE INDEX IF NOT EXISTS idx_productos_ean ON productos(codigo_ean);
    `;
    
    // Ejecutar el script completo
    await pool.query(initSQL);
    
    console.log('✅ Base de datos inicializada completamente');
    res.json({ 
      success: true, 
      message: '✅ Base de datos inicializada completamente con todas las tablas y datos de prueba' 
    });
  } catch (error) {
    console.error('❌ Error inicializando BD completa:', error);
    res.status(500).json({ error: error.message });
  }
});

// Ruta para verificar tablas existentes
app.get('/api/check-tables', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    res.json({ 
      tables: result.rows.map(row => row.table_name),
      count: result.rows.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Middleware de autenticación
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'secreto_temporal', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido' });
    }
    req.user = user;
    next();
  });
};

// Middleware para verificar rol de administrador - VERSIÓN CON DEBUG
const requireAdmin = (req, res, next) => {
  console.log('🔐 DEBUG requireAdmin - Usuario:', req.user.email, 'Rol:', req.user.rol);
  
  if (req.user.rol !== 'admin' && req.user.rol !== 'super_admin') {
    console.log('❌ DEBUG requireAdmin - Acceso denegado, rol:', req.user.rol);
    return res.status(403).json({ error: 'Se requieren permisos de administrador' });
  }
  
  console.log('✅ DEBUG requireAdmin - Acceso permitido');
  next();
};

// Middleware para verificar rol de super admin
const requireSuperAdmin = (req, res, next) => {
  if (req.user.rol !== 'super_admin') {
    return res.status(403).json({ error: 'Se requieren permisos de super administrador' });
  }
  next();
};

// Middleware para obtener negocio del usuario - VERSIÓN CON DEBUG
const getNegocioUsuario = async (req, res, next) => {
  try {
    console.log('🔍 DEBUG getNegocioUsuario - Usuario:', req.user.email, 'Rol:', req.user.rol);

    // Si es super_admin, puede acceder sin negocio específico
    if (req.user.rol === 'super_admin') {
      req.negocioId = req.query.negocio_id || null;
      console.log('🔍 DEBUG - Super admin, Negocio ID:', req.negocioId);
      return next();
    }

    // Para usuarios normales, obtener su negocio
    const userResult = await pool.query(
      'SELECT id, nombre, email, rol, negocio_id FROM usuarios WHERE id = $1 AND activo = true',
      [req.user.id]
    );
    
    if (userResult.rows.length === 0) {
      console.log('❌ DEBUG - Usuario no encontrado o inactivo');
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    const usuario = userResult.rows[0];
    const negocioId = usuario.negocio_id;
    
    console.log('🔍 DEBUG - Usuario encontrado:', usuario.nombre, 'Negocio ID:', negocioId);
    
    if (!negocioId) {
      console.log('❌ DEBUG - Usuario sin negocio asignado');
      return res.status(400).json({ error: 'Usuario no tiene negocio asignado' });
    }
    
    req.negocioId = negocioId;
    console.log('✅ DEBUG - Negocio asignado al request:', req.negocioId);
    next();
    
  } catch (error) {
    console.error('❌ Error obteniendo negocio:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// Función para generar número de factura
async function generarNumeroFactura(negocioId) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const secuencia = await client.query(
      'SELECT * FROM secuencias_factura WHERE negocio_id = $1 FOR UPDATE',
      [negocioId]
    );
    
    if (secuencia.rows.length === 0) {
      throw new Error('No hay secuencia de facturación configurada para este negocio');
    }
    
    const numeroActual = secuencia.rows[0].siguiente_numero;
    const prefijo = secuencia.rows[0].prefijo;
    
    await client.query(
      'UPDATE secuencias_factura SET siguiente_numero = siguiente_numero + 1 WHERE negocio_id = $1',
      [negocioId]
    );
    
    await client.query('COMMIT');
    
    return `${prefijo}${String(numeroActual).padStart(6, '0')}`;
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Rutas de Autenticación
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
    if (user.negocio_id) {
      const negocioResult = await pool.query(
        'SELECT * FROM negocios WHERE id = $1',
        [user.negocio_id]
      );
      negocioInfo = negocioResult.rows[0];
    }

    res.json({
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol,
        negocio_id: user.negocio_id,
        negocio: negocioInfo
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para obtener perfil del usuario
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
    if (user.negocio_id) {
      const negocioResult = await pool.query(
        'SELECT * FROM negocios WHERE id = $1',
        [user.negocio_id]
      );
      negocioInfo = negocioResult.rows[0];
    }

    res.json({
      user: {
        ...user,
        negocio: negocioInfo
      }
    });
  } catch (error) {
    console.error('Error obteniendo perfil:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para crear nuevos negocios (solo super admin)
app.post('/api/negocios', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { nombre, direccion, telefono, email, ruc_nit, logo_url } = req.body;

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      const negocioResult = await client.query(
        `INSERT INTO negocios (nombre, direccion, telefono, email, ruc_nit, logo_url) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [nombre, direccion, telefono, email, ruc_nit, logo_url]
      );

      const negocio = negocioResult.rows[0];

      await client.query(
        'INSERT INTO secuencias_factura (negocio_id, prefijo, siguiente_numero) VALUES ($1, $2, $3)',
        [negocio.id, 'FAC', 1]
      );

      await client.query(
        'INSERT INTO categorias (negocio_id, nombre, descripcion) VALUES ($1, $2, $3)',
        [negocio.id, 'General', 'Productos sin categoría específica']
      );

      await client.query('COMMIT');
      res.status(201).json(negocio);

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Error creando negocio:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para obtener todos los negocios (solo super admin)
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

// Rutas de Productos
app.get('/api/productos', authenticateToken, getNegocioUsuario, async (req, res) => {
  try {
    const { search } = req.query;
    let query = `
      SELECT p.*, c.nombre as categoria_nombre 
      FROM productos p 
      LEFT JOIN categorias c ON p.categoria_id = c.id 
      WHERE p.activo = true AND p.negocio_id = $1
    `;
    let params = [req.negocioId];

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

// Crear producto (solo admin)
app.post('/api/productos', authenticateToken, getNegocioUsuario, requireAdmin, async (req, res) => {
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

    const result = await pool.query(
      `INSERT INTO productos 
       (negocio_id, codigo_ean, nombre, descripcion, precio_compra, precio_venta, stock_actual, stock_minimo, categoria_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
       RETURNING *`,
      [req.negocioId, codigo_ean, nombre, descripcion, precio_compra, precio_venta, stock_actual, stock_minimo, categoria_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creando producto:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Actualizar producto (solo admin)
app.put('/api/productos/:id', authenticateToken, getNegocioUsuario, requireAdmin, async (req, res) => {
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

    console.log('🔧 DEBUG Actualizar producto - ID:', id, 'Datos:', req.body);

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
       WHERE id = $9 AND negocio_id = $10
       RETURNING *`,
      [codigo_ean, nombre, descripcion, precio_compra, precio_venta, stock_actual, stock_minimo, categoria_id, id, req.negocioId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    console.log('✅ DEBUG Producto actualizado:', result.rows[0].nombre);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error actualizando producto:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Eliminar producto (solo admin)
app.delete('/api/productos/:id', authenticateToken, getNegocioUsuario, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    await pool.query(
      'UPDATE productos SET activo = false WHERE id = $1 AND negocio_id = $2',
      [id, req.negocioId]
    );

    res.json({ message: 'Producto eliminado correctamente' });
  } catch (error) {
    console.error('Error eliminando producto:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Rutas de Ventas - VERSIÓN MEJORADA CON VALIDACIÓN DE STOCK
app.post('/api/ventas', authenticateToken, getNegocioUsuario, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { detalles, cliente_nombre, cliente_documento, cliente_direccion, cliente_telefono, metodo_pago } = req.body;
    const usuario_id = req.user.id;
    
    console.log('🛒 DEBUG Procesando venta - Usuario:', req.user.email, 'Negocio:', req.negocioId);
    console.log('🛒 DEBUG Detalles venta:', detalles);

    // ✅ VALIDAR STOCK ANTES DE PROCESAR LA VENTA
    for (const detalle of detalles) {
      const stockResult = await client.query(
        'SELECT id, nombre, stock_actual FROM productos WHERE id = $1 AND negocio_id = $2 AND activo = true',
        [detalle.producto_id, req.negocioId]
      );
      
      if (stockResult.rows.length === 0) {
        throw new Error(`Producto no encontrado o inactivo: ${detalle.producto_id}`);
      }
      
      const producto = stockResult.rows[0];
      const stockActual = producto.stock_actual;
      
      console.log(`📦 DEBUG Validando stock - Producto: ${producto.nombre}, Stock actual: ${stockActual}, Cantidad solicitada: ${detalle.cantidad}`);
      
      if (stockActual < detalle.cantidad) {
        throw new Error(`Stock insuficiente para "${producto.nombre}". Stock actual: ${stockActual}, solicitado: ${detalle.cantidad}`);
      }
    }

    console.log('✅ DEBUG Stock validado correctamente');
    
    // Generar número de factura
    const numero_factura = await generarNumeroFactura(req.negocioId);
    console.log('🧾 DEBUG Número de factura generado:', numero_factura);
    
    // Calcular subtotal y total (con IVA del 19%)
    const subtotal = detalles.reduce((sum, detalle) => sum + (detalle.cantidad * detalle.precio_unitario), 0);
    const iva = subtotal * 0.19;
    const total = subtotal + iva;

    console.log('💰 DEBUG Totales - Subtotal:', subtotal, 'IVA:', iva, 'Total:', total);
    
    // Insertar venta con datos de factura
    const ventaResult = await client.query(
      `INSERT INTO ventas 
       (negocio_id, numero_factura, cliente_nombre, cliente_documento, cliente_direccion, cliente_telefono, subtotal, iva, total, usuario_id, metodo_pago) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
       RETURNING *`,
      [req.negocioId, numero_factura, cliente_nombre, cliente_documento, cliente_direccion, cliente_telefono, subtotal, iva, total, usuario_id, metodo_pago]
    );
    
    const venta = ventaResult.rows[0];
    console.log('✅ DEBUG Venta registrada con ID:', venta.id);
    
    // Insertar detalles y actualizar stock
    for (const detalle of detalles) {
      // Insertar detalle de venta
      await client.query(
        `INSERT INTO detalle_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal) 
         VALUES ($1, $2, $3, $4, $5)`,
        [venta.id, detalle.producto_id, detalle.cantidad, detalle.precio_unitario, detalle.cantidad * detalle.precio_unitario]
      );
      
      // ✅ ACTUALIZAR STOCK EN BASE DE DATOS
      const updateResult = await client.query(
        'UPDATE productos SET stock_actual = stock_actual - $1, fecha_actualizacion = NOW() WHERE id = $2 AND negocio_id = $3 RETURNING stock_actual',
        [detalle.cantidad, detalle.producto_id, req.negocioId]
      );
      
      console.log(`📦 DEBUG Stock actualizado - Producto: ${detalle.producto_id}, Cantidad vendida: ${detalle.cantidad}, Nuevo stock: ${updateResult.rows[0].stock_actual}`);
    }
    
    await client.query('COMMIT');
    console.log('✅ DEBUG Transacción completada exitosamente');
    
    // Obtener la venta completa con detalles para la respuesta
    const ventaCompleta = await client.query(
      `SELECT v.*, 
              n.nombre as negocio_nombre,
              n.direccion as negocio_direccion,
              n.telefono as negocio_telefono,
              n.email as negocio_email,
              n.ruc_nit as negocio_ruc_nit,
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
       JOIN usuarios u ON v.usuario_id = u.id
       LEFT JOIN detalle_venta dv ON v.id = dv.venta_id
       LEFT JOIN productos p ON dv.producto_id = p.id
       WHERE v.id = $1
       GROUP BY v.id, n.id, u.id`,
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

// Ruta para obtener ventas
app.get('/api/ventas', authenticateToken, getNegocioUsuario, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    
    const result = await pool.query(
      `SELECT v.*, u.nombre as vendedor_nombre
       FROM ventas v
       JOIN usuarios u ON v.usuario_id = u.id
       WHERE v.negocio_id = $1
       ORDER BY v.fecha_venta DESC
       LIMIT $2`,
      [req.negocioId, limit]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo ventas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para obtener una factura específica
app.get('/api/ventas/:id/factura', authenticateToken, getNegocioUsuario, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `SELECT v.*, 
              n.nombre as negocio_nombre,
              n.direccion as negocio_direccion,
              n.telefono as negocio_telefono,
              n.email as negocio_email,
              n.ruc_nit as negocio_ruc_nit,
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
       JOIN usuarios u ON v.usuario_id = u.id
       LEFT JOIN detalle_venta dv ON v.id = dv.venta_id
       LEFT JOIN productos p ON dv.producto_id = p.id
       WHERE v.id = $1 AND v.negocio_id = $2
       GROUP BY v.id, n.id, u.id`,
      [id, req.negocioId]
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

// Ruta para obtener alertas de stock bajo (solo admin)
app.get('/api/alertas/stock-bajo', authenticateToken, getNegocioUsuario, requireAdmin, async (req, res) => {
  try {
    console.log('📊 DEBUG alertas/stock-bajo - Usuario:', req.user.email, 'Negocio ID:', req.negocioId);

    if (req.user.rol === 'super_admin' && !req.negocioId) {
      return res.json([]);
    }

    const result = await pool.query(
      `SELECT * FROM productos 
       WHERE stock_actual <= stock_minimo 
       AND activo = true 
       AND negocio_id = $1
       ORDER BY stock_actual ASC`,
      [req.negocioId]
    );
    
    console.log('📊 DEBUG - Alertas encontradas:', result.rows.length);
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo alertas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para estadísticas (solo admin)
app.get('/api/estadisticas', authenticateToken, getNegocioUsuario, requireAdmin, async (req, res) => {
  try {
    console.log('📈 DEBUG estadisticas - Usuario:', req.user.email, 'Rol:', req.user.rol, 'Negocio ID:', req.negocioId);

    if (req.user.rol === 'super_admin' && !req.negocioId) {
      return res.status(400).json({ 
        error: 'El super administrador debe especificar un negocio (negocio_id)' 
      });
    }

    const ventasHoy = await pool.query(
      `SELECT COUNT(*) as total, COALESCE(SUM(total), 0) as monto 
       FROM ventas 
       WHERE negocio_id = $1 AND DATE(fecha_venta) = CURRENT_DATE`,
      [req.negocioId]
    );

    const productosStockBajo = await pool.query(
      `SELECT COUNT(*) as total 
       FROM productos 
       WHERE stock_actual <= stock_minimo AND activo = true AND negocio_id = $1`,
      [req.negocioId]
    );

    const topProductos = await pool.query(
      `SELECT p.nombre, SUM(dv.cantidad) as total_vendido
       FROM detalle_venta dv
       JOIN productos p ON dv.producto_id = p.id
       JOIN ventas v ON dv.venta_id = v.id
       WHERE v.negocio_id = $1 AND v.fecha_venta >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY p.id, p.nombre
       ORDER BY total_vendido DESC
       LIMIT 5`,
      [req.negocioId]
    );

    const ventasUltimaSemana = await pool.query(
      `SELECT DATE(fecha_venta) as fecha, COUNT(*) as cantidad, SUM(total) as total
       FROM ventas
       WHERE negocio_id = $1 AND fecha_venta >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY DATE(fecha_venta)
       ORDER BY fecha DESC`,
      [req.negocioId]
    );

    console.log('📈 DEBUG - Estadísticas calculadas correctamente');
    res.json({
      ventasHoy: ventasHoy.rows[0],
      productosStockBajo: productosStockBajo.rows[0],
      topProductos: topProductos.rows,
      ventasUltimaSemana: ventasUltimaSemana.rows
    });
    
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para obtener categorías
app.get('/api/categorias', authenticateToken, getNegocioUsuario, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM categorias WHERE negocio_id = $1 ORDER BY nombre',
      [req.negocioId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo categorías:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta de salud del servidor
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Servidor funcionando correctamente',
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📊 Sistema de Inventario con Múltiples Negocios`);
  console.log(`💾 Base de datos: ${process.env.DB_NAME || 'inventario_negocio'}`);
});

// Ruta para obtener usuarios de un negocio (solo super admin)
app.get('/api/negocios/:id/usuarios', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `SELECT id, nombre, email, rol, fecha_creacion, activo 
       FROM usuarios 
       WHERE negocio_id = $1 AND activo = true
       ORDER BY nombre`,
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para crear usuario en un negocio (solo super admin)
app.post('/api/negocios/:id/usuarios', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, email, password, rol } = req.body;

    // Validar que el rol sea válido
    if (!['admin', 'trabajador'].includes(rol)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    // Verificar que el email no exista en el mismo negocio
    const usuarioExistente = await pool.query(
      'SELECT id FROM usuarios WHERE email = $1 AND negocio_id = $2',
      [email, id]
    );

    if (usuarioExistente.rows.length > 0) {
      return res.status(400).json({ error: 'El email ya está registrado en este negocio' });
    }

    // Hash de la contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO usuarios (negocio_id, nombre, email, password, rol) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, nombre, email, rol, fecha_creacion`,
      [id, nombre, email, hashedPassword, rol]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creando usuario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para eliminar usuario (solo super admin)
app.delete('/api/usuarios/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // No permitir eliminar al super admin
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

    // Eliminar lógicamente (desactivar)
    await pool.query(
      'UPDATE usuarios SET activo = false WHERE id = $1',
      [id]
    );

    res.json({ message: 'Usuario eliminado correctamente' });
  } catch (error) {
    console.error('Error eliminando usuario:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para generar reportes
app.get('/api/reportes', authenticateToken, getNegocioUsuario, requireAdmin, async (req, res) => {
  try {
    const { tipo, fecha_inicio, fecha_fin } = req.query;
    
    console.log('📋 Generando reporte:', { tipo, fecha_inicio, fecha_fin });

    // Validar tipo de reporte
    const tiposValidos = ['ventas_diarias', 'ventas_mensual', 'inventario', 'productos_excel', 'ventas_excel'];
    if (!tiposValidos.includes(tipo)) {
      return res.status(400).json({ error: 'Tipo de reporte inválido' });
    }

    let reporteData;
    
    switch (tipo) {
      case 'ventas_diarias':
        reporteData = await generarReporteVentasDiarias(req.negocioId, fecha_inicio, fecha_fin);
        break;
      case 'ventas_mensual':
        reporteData = await generarReporteFinancieroMensual(req.negocioId, fecha_inicio, fecha_fin);
        break;
      case 'inventario':
        reporteData = await generarReporteInventario(req.negocioId);
        break;
      case 'productos_excel':
        reporteData = await generarExcelProductos(req.negocioId);
        break;
      case 'ventas_excel':
        reporteData = await generarExcelVentas(req.negocioId, fecha_inicio, fecha_fin);
        break;
    }

    // Configurar headers para descarga
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

// =============================================
// FUNCIONES DE GENERACIÓN DE REPORTES
// =============================================

const PDFDocument = require('pdfkit');
const excel = require('excel4node');

// 1. REPORTE DE VENTAS DIARIAS (PDF)
async function generarReporteVentasDiarias(negocioId, fechaInicio, fechaFin) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument();
      const buffers = [];
      
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // Obtener datos del negocio
      const negocioResult = await pool.query(
        'SELECT * FROM negocios WHERE id = $1',
        [negocioId]
      );
      const negocio = negocioResult.rows[0];

      // Obtener ventas del período
      const ventasResult = await pool.query(
        `SELECT v.*, u.nombre as vendedor_nombre
         FROM ventas v
         JOIN usuarios u ON v.usuario_id = u.id
         WHERE v.negocio_id = $1 
         AND DATE(v.fecha_venta) BETWEEN COALESCE($2, CURRENT_DATE) AND COALESCE($3, CURRENT_DATE)
         ORDER BY v.fecha_venta DESC`,
        [negocioId, fechaInicio, fechaFin]
      );

      const ventas = ventasResult.rows;

      // Obtener totales
      const totalesResult = await pool.query(
        `SELECT 
           COUNT(*) as total_ventas,
           COALESCE(SUM(total), 0) as monto_total,
           COALESCE(SUM(iva), 0) as iva_total
         FROM ventas 
         WHERE negocio_id = $1 
         AND DATE(fecha_venta) BETWEEN COALESCE($2, CURRENT_DATE) AND COALESCE($3, CURRENT_DATE)`,
        [negocioId, fechaInicio, fechaFin]
      );

      const totales = totalesResult.rows[0];

      // GENERAR PDF
      doc.fontSize(20).text(`REPORTE DE VENTAS DIARIAS`, { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Negocio: ${negocio.nombre}`, { align: 'center' });
      doc.text(`Período: ${fechaInicio || 'Hoy'} - ${fechaFin || 'Hoy'}`, { align: 'center' });
      doc.text(`Generado: ${new Date().toLocaleDateString()}`, { align: 'center' });
      doc.moveDown();

      // Resumen
      doc.fontSize(14).text('RESUMEN DEL DÍA', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(12);
      doc.text(`Total Ventas: ${totales.total_ventas}`);
      doc.text(`Monto Total: $${Number(totales.monto_total).toLocaleString()}`);
      doc.text(`IVA Recaudado: $${Number(totales.iva_total).toLocaleString()}`);
      doc.moveDown();

      // Detalle de ventas
      if (ventas.length > 0) {
        doc.fontSize(14).text('DETALLE DE VENTAS', { underline: true });
        doc.moveDown(0.5);
        
        ventas.forEach((venta, index) => {
          doc.fontSize(10);
          doc.text(`Factura: ${venta.numero_factura}`);
          doc.text(`Fecha: ${new Date(venta.fecha_venta).toLocaleString()}`);
          doc.text(`Cliente: ${venta.cliente_nombre || 'Consumidor Final'}`);
          doc.text(`Vendedor: ${venta.vendedor_nombre}`);
          doc.text(`Total: $${Number(venta.total).toLocaleString()}`);
          doc.text(`Método: ${venta.metodo_pago}`);
          doc.moveDown(0.3);
          
          if (index < ventas.length - 1) {
            doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
            doc.moveDown(0.3);
          }
        });
      } else {
        doc.text('No hay ventas registradas en este período.');
      }

      doc.end();

    } catch (error) {
      reject(error);
    }
  });
}

// 2. REPORTE DE INVENTARIO (PDF)
async function generarReporteInventario(negocioId) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument();
      const buffers = [];
      
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // Obtener datos del negocio
      const negocioResult = await pool.query(
        'SELECT * FROM negocios WHERE id = $1',
        [negocioId]
      );
      const negocio = negocioResult.rows[0];

      // Obtener productos
      const productosResult = await pool.query(
        `SELECT p.*, c.nombre as categoria_nombre
         FROM productos p
         LEFT JOIN categorias c ON p.categoria_id = c.id
         WHERE p.negocio_id = $1 AND p.activo = true
         ORDER BY p.stock_actual ASC`,
        [negocioId]
      );

      const productos = productosResult.rows;

      // Calcular valor total del inventario
      const valorInventario = productos.reduce((total, producto) => {
        return total + (producto.precio_compra * producto.stock_actual);
      }, 0);

      const productosStockBajo = productos.filter(p => p.stock_actual <= p.stock_minimo);

      // GENERAR PDF
      doc.fontSize(20).text(`REPORTE DE INVENTARIO`, { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Negocio: ${negocio.nombre}`, { align: 'center' });
      doc.text(`Generado: ${new Date().toLocaleDateString()}`, { align: 'center' });
      doc.moveDown();

      // Resumen
      doc.fontSize(14).text('RESUMEN DE INVENTARIO', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(12);
      doc.text(`Total Productos: ${productos.length}`);
      doc.text(`Productos con stock bajo: ${productosStockBajo.length}`);
      doc.text(`Valor total del inventario: $${Number(valorInventario).toLocaleString()}`);
      doc.moveDown();

      // Productos con stock bajo
      if (productosStockBajo.length > 0) {
        doc.fontSize(14).text('PRODUCTOS CON STOCK BAJO ⚠️', { underline: true });
        doc.moveDown(0.5);
        
        productosStockBajo.forEach(producto => {
          doc.fontSize(10);
          doc.text(`${producto.nombre} - Stock: ${producto.stock_actual} (Mínimo: ${producto.stock_minimo})`);
        });
        doc.moveDown();
      }

      // Lista completa de productos
      doc.fontSize(14).text('INVENTARIO COMPLETO', { underline: true });
      doc.moveDown(0.5);
      
      if (productos.length > 0) {
        productos.forEach((producto, index) => {
          doc.fontSize(9);
          doc.text(`${producto.nombre}`);
          doc.text(`  Código: ${producto.codigo_ean || 'N/A'} | Categoría: ${producto.categoria_nombre || 'General'}`);
          doc.text(`  Stock: ${producto.stock_actual} | Precio: $${Number(producto.precio_venta).toLocaleString()}`);
          doc.text(`  Valor: $${Number(producto.precio_compra * producto.stock_actual).toLocaleString()}`);
          
          if (index < productos.length - 1) {
            doc.moveDown(0.2);
          }
        });
      } else {
        doc.text('No hay productos registrados.');
      }

      doc.end();

    } catch (error) {
      reject(error);
    }
  });
}

// 3. EXPORTAR PRODUCTOS A EXCEL
async function generarExcelProductos(negocioId) {
  return new Promise(async (resolve, reject) => {
    try {
      const workbook = new excel.Workbook();
      const worksheet = workbook.createWorksheet('Productos');

      // Obtener productos
      const productosResult = await pool.query(
        `SELECT p.*, c.nombre as categoria_nombre
         FROM productos p
         LEFT JOIN categorias c ON p.categoria_id = c.id
         WHERE p.negocio_id = $1 AND p.activo = true
         ORDER BY p.nombre`,
        [negocioId]
      );

      const productos = productosResult.rows;

      // Estilos
      const headerStyle = workbook.createStyle({
        font: { bold: true, color: '#FFFFFF' },
        fill: { type: 'pattern', patternType: 'solid', fgColor: '#3498db' },
        alignment: { horizontal: 'center' }
      });

      const moneyStyle = workbook.createStyle({
        numberFormat: '$#,##0.00'
      });

      // Encabezados
      worksheet.cell(1, 1).string('Nombre').style(headerStyle);
      worksheet.cell(1, 2).string('Código EAN').style(headerStyle);
      worksheet.cell(1, 3).string('Categoría').style(headerStyle);
      worksheet.cell(1, 4).string('Stock Actual').style(headerStyle);
      worksheet.cell(1, 5).string('Stock Mínimo').style(headerStyle);
      worksheet.cell(1, 6).string('Precio Compra').style(headerStyle);
      worksheet.cell(1, 7).string('Precio Venta').style(headerStyle);
      worksheet.cell(1, 8).string('Valor Inventario').style(headerStyle);

      // Datos
      productos.forEach((producto, index) => {
        const row = index + 2;
        const valorInventario = producto.precio_compra * producto.stock_actual;
        
        worksheet.cell(row, 1).string(producto.nombre);
        worksheet.cell(row, 2).string(producto.codigo_ean || 'N/A');
        worksheet.cell(row, 3).string(producto.categoria_nombre || 'General');
        worksheet.cell(row, 4).number(producto.stock_actual);
        worksheet.cell(row, 5).number(producto.stock_minimo);
        worksheet.cell(row, 6).number(Number(producto.precio_compra)).style(moneyStyle);
        worksheet.cell(row, 7).number(Number(producto.precio_venta)).style(moneyStyle);
        worksheet.cell(row, 8).number(Number(valorInventario)).style(moneyStyle);
      });

      // Ajustar anchos de columna
      worksheet.column(1).setWidth(30);
      worksheet.column(2).setWidth(15);
      worksheet.column(3).setWidth(15);
      worksheet.column(4).setWidth(12);
      worksheet.column(5).setWidth(12);
      worksheet.column(6).setWidth(15);
      worksheet.column(7).setWidth(15);
      worksheet.column(8).setWidth(18);

      workbook.writeToBuffer().then(buffer => {
        resolve(buffer);
      });

    } catch (error) {
      reject(error);
    }
  });
}

// 4. EXPORTAR VENTAS A EXCEL
async function generarExcelVentas(negocioId, fechaInicio, fechaFin) {
  return new Promise(async (resolve, reject) => {
    try {
      const workbook = new excel.Workbook();
      const worksheet = workbook.createWorksheet('Ventas');

      // Obtener ventas
      const ventasResult = await pool.query(
        `SELECT v.*, u.nombre as vendedor_nombre
         FROM ventas v
         JOIN usuarios u ON v.usuario_id = u.id
         WHERE v.negocio_id = $1 
         AND DATE(v.fecha_venta) BETWEEN COALESCE($2, CURRENT_DATE - INTERVAL '7 days') AND COALESCE($3, CURRENT_DATE)
         ORDER BY v.fecha_venta DESC`,
        [negocioId, fechaInicio, fechaFin]
      );

      const ventas = ventasResult.rows;

      // Estilos
      const headerStyle = workbook.createStyle({
        font: { bold: true, color: '#FFFFFF' },
        fill: { type: 'pattern', patternType: 'solid', fgColor: '#27ae60' },
        alignment: { horizontal: 'center' }
      });

      const moneyStyle = workbook.createStyle({
        numberFormat: '$#,##0.00'
      });

      const dateStyle = workbook.createStyle({
        numberFormat: 'dd/mm/yyyy hh:mm'
      });

      // Encabezados
      worksheet.cell(1, 1).string('Factura').style(headerStyle);
      worksheet.cell(1, 2).string('Fecha').style(headerStyle);
      worksheet.cell(1, 3).string('Cliente').style(headerStyle);
      worksheet.cell(1, 4).string('Vendedor').style(headerStyle);
      worksheet.cell(1, 5).string('Subtotal').style(headerStyle);
      worksheet.cell(1, 6).string('IVA').style(headerStyle);
      worksheet.cell(1, 7).string('Total').style(headerStyle);
      worksheet.cell(1, 8).string('Método Pago').style(headerStyle);

      // Datos
      ventas.forEach((venta, index) => {
        const row = index + 2;
        
        worksheet.cell(row, 1).string(venta.numero_factura);
        worksheet.cell(row, 2).date(new Date(venta.fecha_venta)).style(dateStyle);
        worksheet.cell(row, 3).string(venta.cliente_nombre || 'Consumidor Final');
        worksheet.cell(row, 4).string(venta.vendedor_nombre);
        worksheet.cell(row, 5).number(Number(venta.subtotal)).style(moneyStyle);
        worksheet.cell(row, 6).number(Number(venta.iva)).style(moneyStyle);
        worksheet.cell(row, 7).number(Number(venta.total)).style(moneyStyle);
        worksheet.cell(row, 8).string(venta.metodo_pago);
      });

      // Ajustar anchos de columna
      worksheet.column(1).setWidth(15);
      worksheet.column(2).setWidth(20);
      worksheet.column(3).setWidth(25);
      worksheet.column(4).setWidth(20);
      worksheet.column(5).setWidth(12);
      worksheet.column(6).setWidth(12);
      worksheet.column(7).setWidth(12);
      worksheet.column(8).setWidth(15);

      workbook.writeToBuffer().then(buffer => {
        resolve(buffer);
      });

    } catch (error) {
      reject(error);
    }
  });
}

// 5. REPORTE FINANCIERO MENSUAL (PDF) - Función placeholder
async function generarReporteFinancieroMensual(negocioId, fechaInicio, fechaFin) {
  // Por ahora usamos la misma función que ventas diarias
  return await generarReporteVentasDiarias(negocioId, fechaInicio, fechaFin);
}
