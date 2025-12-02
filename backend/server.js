const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const moment = require('moment');
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

// Agrega esto al principio de tu server.js, después de los middlewares
app.use((req, res, next) => {
  console.log('📍 Ruta solicitada:', req.method, req.url);
  next();
});

app.put('/api/usuarios/cambiar-password', authenticateToken, async (req, res) => {
  try {
    const { passwordActual, nuevaPassword } = req.body;
    const usuarioId = req.user.id; // Del middleware de autenticación

    console.log(`🔄 Cambiando contraseña para usuario: ${usuarioId}`);
    
    // Validaciones
    if (!passwordActual || !nuevaPassword) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    if (nuevaPassword.length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }

    // Obtener usuario actual con password
    const usuarioResult = await pool.query(
      'SELECT id, password, email FROM usuarios WHERE id = $1',
      [usuarioId]
    );

    if (usuarioResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const usuario = usuarioResult.rows[0];

    // Verificar contraseña actual
    const passwordValida = await bcrypt.compare(passwordActual, usuario.password);
    if (!passwordValida) {
      return res.status(400).json({ error: 'Contraseña actual incorrecta' });
    }

    // Hashear nueva contraseña
    const hashedPassword = await bcrypt.hash(nuevaPassword, 10);

    // Actualizar contraseña
    await pool.query(
      'UPDATE usuarios SET password = $1 WHERE id = $2',
      [hashedPassword, usuarioId]
    );

    console.log(`✅ Contraseña actualizada para: ${usuario.email}`);
    
    res.json({ 
      success: true, 
      message: 'Contraseña actualizada correctamente' 
    });

  } catch (error) {
    console.error('❌ Error cambiando contraseña:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});


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

// Ruta específica para buscar producto por EAN - AGREGAR ESTA RUTA
app.get('/api/productos/buscar/:ean', authenticateToken, getNegocioUsuario, async (req, res) => {
  try {
    const { ean } = req.params;
    
    console.log('🔍 DEBUG Buscando producto por EAN:', ean, 'Negocio:', req.negocioId);

    const result = await pool.query(
      `SELECT p.*, c.nombre as categoria_nombre 
       FROM productos p 
       LEFT JOIN categorias c ON p.categoria_id = c.id 
       WHERE p.activo = true 
       AND p.negocio_id = $1 
       AND p.codigo_ean = $2`,
      [req.negocioId, ean]
    );

    console.log('🔍 DEBUG Resultados encontrados:', result.rows.length);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json(result.rows[0]);
    
  } catch (error) {
    console.error('Error buscando producto por EAN:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Rutas de Ventas - VERSIÓN CORREGIDA (usando "fecha" en lugar de "fecha_venta")
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

// Ruta para registrar devoluciones (afecta stock y ventas)
app.post('/api/ventas/devolucion', authenticateToken, getNegocioUsuario, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { detalles, cliente_nombre, cliente_documento, cliente_telefono, motivo_devolucion } = req.body;
    const usuario_id = req.user.id;
    
    console.log('↩️ DEBUG Procesando devolución - Usuario:', req.user.email);

    // Validar que haya detalles
    if (!detalles || detalles.length === 0) {
      throw new Error('No hay productos para devolver');
    }

    // Calcular totales (negativos para devolución)
    const subtotal = detalles.reduce((sum, detalle) => sum + (detalle.cantidad * detalle.precio_unitario), 0) * -1;
    const iva = subtotal * 0.19;
    const total = subtotal + iva;

    // Generar número de factura especial para devolución
    const numero_factura = await generarNumeroFactura(req.negocioId);
    const numero_devolucion = `DEV-${numero_factura}`;
    
    console.log('🧾 DEBUG Número de devolución:', numero_devolucion);

    // Insertar venta negativa (devolución)
    const ventaResult = await client.query(
      `INSERT INTO ventas 
       (negocio_id, numero_factura, cliente_nombre, cliente_documento, cliente_telefono, 
        subtotal, iva, total, usuario_id, metodo_pago, es_devolucion, motivo_devolucion) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11) 
       RETURNING *`,
      [req.negocioId, numero_devolucion, cliente_nombre, cliente_documento, cliente_telefono, 
       subtotal, iva, total, usuario_id, 'devolucion', motivo_devolucion]
    );
    
    const venta = ventaResult.rows[0];
    console.log('✅ DEBUG Devolución registrada con ID:', venta.id);
    
    // Insertar detalles de devolución
    for (const detalle of detalles) {
      await client.query(
        `INSERT INTO detalle_venta (venta_id, producto_id, cantidad, precio_unitario, subtotal) 
         VALUES ($1, $2, $3, $4, $5)`,
        [venta.id, detalle.producto_id, detalle.cantidad * -1, detalle.precio_unitario, detalle.cantidad * detalle.precio_unitario * -1]
      );
    }
    
    await client.query('COMMIT');
    console.log('✅ DEBUG Transacción de devolución completada');
    
    res.status(201).json({
      success: true,
      message: 'Devolución registrada correctamente',
      devolucion: venta
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ ERROR registrando devolución:', error.message);
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Ruta para obtener ventas - CORREGIDA (usando "fecha" en lugar de "fecha_venta")
app.get('/api/ventas', authenticateToken, getNegocioUsuario, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    
    const result = await pool.query(
      `SELECT v.*, u.nombre as vendedor_nombre
       FROM ventas v
       JOIN usuarios u ON v.usuario_id = u.id
       WHERE v.negocio_id = $1
       ORDER BY v.fecha DESC
       LIMIT $2`,
      [req.negocioId, limit]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo ventas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para obtener una factura específica - CORREGIDA (usando "fecha" si es necesario en consultas internas)
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

    // Si es super_admin pero no tiene negocio_id, usar query param
    let negocioId = req.negocioId;
    
    if (req.user.rol === 'super_admin' && req.query.negocio_id) {
      negocioId = req.query.negocio_id;
      console.log('📊 DEBUG - Super admin usando negocio específico:', negocioId);
    }

    if (!negocioId) {
      return res.json([]);
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
       AND p.negocio_id = $1
       ORDER BY p.stock_actual ASC`,
      [negocioId]
    );
    
    console.log('📊 DEBUG - Alertas encontradas:', result.rows.length);
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo alertas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para estadísticas específicas por negocio (super admin) - VERSIÓN FLEXIBLE
app.get('/api/estadisticas/negocio/:negocioId', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { negocioId } = req.params;
    const { periodo, fecha_inicio, fecha_fin } = req.query;
    
    console.log('📈 DEBUG estadisticas super admin - Negocio:', negocioId, 'Período:', periodo);

    // Verificar que el negocio existe
    const negocioExistente = await pool.query(
      'SELECT id, nombre FROM negocios WHERE id = $1 AND activo = true',
      [negocioId]
    );

    if (negocioExistente.rows.length === 0) {
      return res.status(404).json({ error: 'Negocio no encontrado o inactivo' });
    }

    const negocio = negocioExistente.rows[0];

    // Definir fechas según el período
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
        
        // Validar que no sea un rango mayor a 1 año
        const diffDays = moment(endDate).diff(moment(startDate), 'days');
        if (diffDays > 365) {
          return res.status(400).json({ error: 'El período no puede ser mayor a 1 año' });
        }
        break;
      default:
        // Por defecto: hoy
        startDate = moment().startOf('day').toDate();
        endDate = moment().endOf('day').toDate();
    }

    console.log('📈 DEBUG super admin - Fechas calculadas:', { 
      startDate: moment(startDate).format('YYYY-MM-DD HH:mm:ss'),
      endDate: moment(endDate).format('YYYY-MM-DD HH:mm:ss'),
      periodo: periodo || 'hoy'
    });

    // Primero determinar el nombre real de la columna
    let fechaColumnName = 'fecha_venta';
    try {
      // Intentar consultar usando fecha_venta
      const testQuery = await pool.query(
        'SELECT 1 FROM ventas WHERE negocio_id = $1 AND fecha_venta IS NOT NULL LIMIT 1',
        [negocioId]
      );
      console.log('✅ Usando columna: fecha_venta');
    } catch (error) {
      if (error.message.includes('fecha_venta')) {
        fechaColumnName = 'fecha';
        console.log('⚠️ Cambiando a columna: fecha');
      }
    }

    // Función helper para usar la columna correcta
    const fechaColumn = () => fechaColumnName;

    // VENTAS DEL PERÍODO
    const ventasPeriodo = await pool.query(
      `SELECT COUNT(*) as total, COALESCE(SUM(total), 0) as monto 
       FROM ventas 
       WHERE negocio_id = $1 
       AND ${fechaColumn()} BETWEEN $2 AND $3`,
      [negocioId, startDate, endDate]
    );

    // PRODUCTOS CON STOCK BAJO
    const productosStockBajo = await pool.query(
      `SELECT COUNT(*) as total 
       FROM productos 
       WHERE stock_actual <= stock_minimo 
       AND activo = true 
       AND negocio_id = $1`,
      [negocioId]
    );

    // TOP PRODUCTOS DEL PERÍODO
    const topProductos = await pool.query(
      `SELECT 
          p.id,
          p.nombre, 
          SUM(dv.cantidad) as total_vendido,
          SUM(dv.subtotal) as monto_total
       FROM detalle_venta dv
       JOIN productos p ON dv.producto_id = p.id
       JOIN ventas v ON dv.venta_id = v.id
       WHERE v.negocio_id = $1 
       AND v.${fechaColumn()} BETWEEN $2 AND $3
       GROUP BY p.id, p.nombre
       ORDER BY total_vendido DESC
       LIMIT 10`,
      [negocioId, startDate, endDate]
    );

    // VENTAS POR DÍA DEL PERÍODO
    const ventasPorDia = await pool.query(
      `SELECT 
          DATE(${fechaColumn()}) as fecha, 
          COUNT(*) as cantidad, 
          SUM(total) as total
       FROM ventas
       WHERE negocio_id = $1 
       AND ${fechaColumn()} BETWEEN $2 AND $3
       GROUP BY DATE(${fechaColumn()})
       ORDER BY fecha ASC`,
      [negocioId, startDate, endDate]
    );

    // TOTAL PRODUCTOS EN INVENTARIO
    const totalProductos = await pool.query(
      `SELECT COUNT(*) as total 
       FROM productos 
       WHERE activo = true 
       AND negocio_id = $1`,
      [negocioId]
    );

    // TOTAL DE CLIENTES ÚNICOS
    const clientesUnicos = await pool.query(
      `SELECT COUNT(DISTINCT cliente_documento) as total_clientes
       FROM ventas
       WHERE negocio_id = $1 
       AND ${fechaColumn()} BETWEEN $2 AND $3
       AND cliente_documento IS NOT NULL
       AND cliente_documento != ''`,
      [negocioId, startDate, endDate]
    );

    // PROMEDIO DE VENTAS POR DÍA
    const promedioVentas = await pool.query(
      `SELECT 
          COALESCE(AVG(daily.total_sum), 0) as promedio_diario,
          COALESCE(COUNT(DISTINCT DATE(${fechaColumn()})), 0) as dias_con_ventas
       FROM (
         SELECT DATE(${fechaColumn()}) as fecha_dia, SUM(total) as total_sum
         FROM ventas
         WHERE negocio_id = $1 
         AND ${fechaColumn()} BETWEEN $2 AND $3
         GROUP BY DATE(${fechaColumn()})
       ) daily`,
      [negocioId, startDate, endDate]
    );

    // MÉTODO DE PAGO MÁS UTILIZADO
    const metodoPagoPopular = await pool.query(
      `SELECT 
          metodo_pago,
          COUNT(*) as cantidad,
          SUM(total) as monto_total
       FROM ventas
       WHERE negocio_id = $1 
       AND ${fechaColumn()} BETWEEN $2 AND $3
       GROUP BY metodo_pago
       ORDER BY cantidad DESC
       LIMIT 1`,
      [negocioId, startDate, endDate]
    );

    // VENTAS POR VENDEDOR
    const ventasPorVendedor = await pool.query(
      `SELECT 
          u.id,
          u.nombre as vendedor,
          COUNT(v.id) as total_ventas,
          SUM(v.total) as monto_total
       FROM ventas v
       JOIN usuarios u ON v.usuario_id = u.id
       WHERE v.negocio_id = $1 
       AND v.${fechaColumn()} BETWEEN $2 AND $3
       GROUP BY u.id, u.nombre
       ORDER BY monto_total DESC`,
      [negocioId, startDate, endDate]
    );

    console.log('📈 DEBUG super admin - Estadísticas calculadas correctamente (usando columna:', fechaColumnName, ')');
    
    // Preparar respuesta
    const response = {
      negocio: {
        id: negocio.id,
        nombre: negocio.nombre
      },
      ventasPeriodo: ventasPeriodo.rows[0] || { total: 0, monto: 0 },
      productosStockBajo: productosStockBajo.rows[0] || { total: 0 },
      topProductos: topProductos.rows,
      ventasPorDia: ventasPorDia.rows,
      totalProductos: totalProductos.rows[0]?.total || 0,
      totalClientes: clientesUnicos.rows[0]?.total_clientes || 0,
      promedioVentas: promedioVentas.rows[0] || { promedio_diario: 0, dias_con_ventas: 0 },
      metodoPagoPopular: metodoPagoPopular.rows[0] || null,
      ventasPorVendedor: ventasPorVendedor.rows,
      periodoInfo: {
        tipo: periodo || 'hoy',
        fecha_inicio: moment(startDate).format('YYYY-MM-DD'),
        fecha_fin: moment(endDate).format('YYYY-MM-DD'),
        dias: moment(endDate).diff(moment(startDate), 'days') + 1
      },
      debug: {
        fecha_column_used: fechaColumnName
      }
    };

    // Para compatibilidad con el frontend existente
    response.ventasHoy = {
      total: response.ventasPeriodo.total,
      monto: response.ventasPeriodo.monto
    };
    
    response.ventasUltimaSemana = response.ventasPorDia;
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ ERROR obteniendo estadísticas super admin:', error);
    res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
  }
});

// Ruta para estadísticas con filtros de período (solo admin) - CORREGIDA (usando "fecha")
app.get('/api/estadisticas', authenticateToken, getNegocioUsuario, requireAdmin, async (req, res) => {
  try {
    const { periodo, fecha_inicio, fecha_fin } = req.query;
    
    console.log('📈 DEBUG estadisticas - Parámetros:', { 
      periodo, 
      fecha_inicio, 
      fecha_fin,
      usuario: req.user.email, 
      negocio: req.negocioId 
    });

    if (req.user.rol === 'super_admin' && !req.negocioId) {
      return res.status(400).json({ 
        error: 'El super administrador debe especificar un negocio (negocio_id)' 
      });
    }

    // Definir fechas según el período
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
        
        // Validar que no sea un rango mayor a 1 año
        const diffDays = moment(endDate).diff(moment(startDate), 'days');
        if (diffDays > 365) {
          return res.status(400).json({ error: 'El período no puede ser mayor a 1 año' });
        }
        break;
      default:
        // Por defecto: hoy
        startDate = moment().startOf('day').toDate();
        endDate = moment().endOf('day').toDate();
    }

    console.log('📈 DEBUG - Fechas calculadas:', { 
      startDate: moment(startDate).format('YYYY-MM-DD HH:mm:ss'),
      endDate: moment(endDate).format('YYYY-MM-DD HH:mm:ss'),
      periodo: periodo || 'hoy'
    });

    // VENTAS DEL PERÍODO - USANDO "fecha" (no fecha_venta)
    const ventasPeriodo = await pool.query(
      `SELECT COUNT(*) as total, COALESCE(SUM(total), 0) as monto 
       FROM ventas 
       WHERE negocio_id = $1 
       AND fecha BETWEEN $2 AND $3`,
      [req.negocioId, startDate, endDate]
    );

    // PRODUCTOS CON STOCK BAJO
    const productosStockBajo = await pool.query(
      `SELECT COUNT(*) as total 
       FROM productos 
       WHERE stock_actual <= stock_minimo 
       AND activo = true 
       AND negocio_id = $1`,
      [req.negocioId]
    );

    // TOP PRODUCTOS DEL PERÍODO - USANDO "fecha" (no fecha_venta)
    const topProductos = await pool.query(
      `SELECT 
          p.id,
          p.nombre, 
          SUM(dv.cantidad) as total_vendido,
          SUM(dv.subtotal) as monto_total
       FROM detalle_venta dv
       JOIN productos p ON dv.producto_id = p.id
       JOIN ventas v ON dv.venta_id = v.id
       WHERE v.negocio_id = $1 
       AND v.fecha BETWEEN $2 AND $3
       GROUP BY p.id, p.nombre
       ORDER BY total_vendido DESC
       LIMIT 10`,
      [req.negocioId, startDate, endDate]
    );

    // VENTAS POR DÍA DEL PERÍODO - USANDO "fecha" (no fecha_venta)
    const ventasPorDia = await pool.query(
      `SELECT 
          DATE(fecha) as fecha, 
          COUNT(*) as cantidad, 
          SUM(total) as total
       FROM ventas
       WHERE negocio_id = $1 
       AND fecha BETWEEN $2 AND $3
       GROUP BY DATE(fecha)
       ORDER BY fecha ASC`,
      [req.negocioId, startDate, endDate]
    );

    // TOTAL PRODUCTOS EN INVENTARIO
    const totalProductos = await pool.query(
      `SELECT COUNT(*) as total 
       FROM productos 
       WHERE activo = true 
       AND negocio_id = $1`,
      [req.negocioId]
    );

    // PROMEDIO DE VENTAS POR DÍA - USANDO "fecha" (no fecha_venta)
    const promedioVentas = await pool.query(
      `SELECT 
          COALESCE(AVG(daily.total_sum), 0) as promedio_diario,
          COALESCE(COUNT(DISTINCT DATE(fecha)), 0) as dias_con_ventas
       FROM (
         SELECT DATE(fecha) as fecha_dia, SUM(total) as total_sum
         FROM ventas
         WHERE negocio_id = $1 
         AND fecha BETWEEN $2 AND $3
         GROUP BY DATE(fecha)
       ) daily`,
      [req.negocioId, startDate, endDate]
    );

    // MÉTODO DE PAGO MÁS UTILIZADO - USANDO "fecha" (no fecha_venta)
    const metodoPagoPopular = await pool.query(
      `SELECT 
          metodo_pago,
          COUNT(*) as cantidad,
          SUM(total) as monto_total
       FROM ventas
       WHERE negocio_id = $1 
       AND fecha BETWEEN $2 AND $3
       GROUP BY metodo_pago
       ORDER BY cantidad DESC
       LIMIT 1`,
      [req.negocioId, startDate, endDate]
    );

    console.log('📈 DEBUG - Estadísticas calculadas correctamente');
    
    // Preparar respuesta
    const response = {
      ventasPeriodo: ventasPeriodo.rows[0] || { total: 0, monto: 0 },
      productosStockBajo: productosStockBajo.rows[0] || { total: 0 },
      topProductos: topProductos.rows,
      ventasPorDia: ventasPorDia.rows,
      totalProductos: totalProductos.rows[0]?.total || 0,
      promedioVentas: promedioVentas.rows[0] || { promedio_diario: 0, dias_con_ventas: 0 },
      metodoPagoPopular: metodoPagoPopular.rows[0] || null,
      periodoInfo: {
        tipo: periodo || 'hoy',
        fecha_inicio: moment(startDate).format('YYYY-MM-DD'),
        fecha_fin: moment(endDate).format('YYYY-MM-DD'),
        dias: moment(endDate).diff(moment(startDate), 'days') + 1
      }
    };

    // Para compatibilidad con el frontend existente
    response.ventasHoy = {
      total: response.ventasPeriodo.total,
      monto: response.ventasPeriodo.monto
    };
    
    response.ventasUltimaSemana = response.ventasPorDia;
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ ERROR obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
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
// RUTAS DE GESTIÓN DE INVENTARIO (MOTIVO OPCIONAL)
// =============================================

// 1. Ruta específica para buscar producto por EAN
app.get('/api/productos/buscar/:ean', authenticateToken, getNegocioUsuario, async (req, res) => {
  try {
    const { ean } = req.params;
    
    console.log('🔍 DEBUG Buscando producto por EAN:', ean, 'Negocio:', req.negocioId);

    const result = await pool.query(
      `SELECT p.*, c.nombre as categoria_nombre 
       FROM productos p 
       LEFT JOIN categorias c ON p.categoria_id = c.id 
       WHERE p.activo = true 
       AND p.negocio_id = $1 
       AND p.codigo_ean = $2`,
      [req.negocioId, ean]
    );

    console.log('🔍 DEBUG Resultados encontrados:', result.rows.length);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json(result.rows[0]);
    
  } catch (error) {
    console.error('Error buscando producto por EAN:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 2. Ruta para agregar stock a productos existentes - MOTIVO OPCIONAL
app.post('/api/inventario/agregar-stock', authenticateToken, getNegocioUsuario, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { producto_id, cantidad, motivo } = req.body; // ✅ motivo es opcional
    const usuario_id = req.user.id;

    console.log('📦 DEBUG Agregando stock - Producto:', producto_id, 'Cantidad:', cantidad, 'Motivo:', motivo);

    // 1. Verificar que el producto existe y pertenece al negocio
    const productoResult = await client.query(
      'SELECT id, nombre, stock_actual FROM productos WHERE id = $1 AND negocio_id = $2 AND activo = true',
      [producto_id, req.negocioId]
    );

    if (productoResult.rows.length === 0) {
      throw new Error('Producto no encontrado o no pertenece a este negocio');
    }

    const producto = productoResult.rows[0];
    console.log('📦 DEBUG Producto encontrado:', producto.nombre, 'Stock actual:', producto.stock_actual);

    // 2. Actualizar stock del producto
    const nuevoStock = producto.stock_actual + parseInt(cantidad);
    
    await client.query(
      'UPDATE productos SET stock_actual = $1, fecha_actualizacion = NOW() WHERE id = $2',
      [nuevoStock, producto_id]
    );

    console.log('✅ DEBUG Stock actualizado - Nuevo stock:', nuevoStock);
    console.log('📝 DEBUG Movimiento registrado - Producto:', producto.nombre, 'Cantidad:', cantidad, 'Motivo:', motivo || 'Sin motivo');

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
    console.error('❌ ERROR agregando stock:', error.message);
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

// 3. Ruta para ajustar stock (corrección de inventario físico) - MOTIVO OPCIONAL
app.post('/api/inventario/ajustar-stock', authenticateToken, getNegocioUsuario, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { producto_id, nuevo_stock, motivo } = req.body; // ✅ motivo es opcional
    const usuario_id = req.user.id;

    console.log('📊 DEBUG Ajustando stock - Producto:', producto_id, 'Nuevo stock:', nuevo_stock, 'Motivo:', motivo);

    // 1. Verificar que el producto existe y pertenece al negocio
    const productoResult = await client.query(
      'SELECT id, nombre, stock_actual FROM productos WHERE id = $1 AND negocio_id = $2 AND activo = true',
      [producto_id, req.negocioId]
    );

    if (productoResult.rows.length === 0) {
      throw new Error('Producto no encontrado o no pertenece a este negocio');
    }

    const producto = productoResult.rows[0];
    const diferencia = nuevo_stock - producto.stock_actual;
    
    console.log('📊 DEBUG Producto encontrado:', producto.nombre, 'Stock actual:', producto.stock_actual, 'Diferencia:', diferencia);

    // 2. Actualizar stock del producto
    await client.query(
      'UPDATE productos SET stock_actual = $1, fecha_actualizacion = NOW() WHERE id = $2',
      [nuevo_stock, producto_id]
    );

    console.log('✅ DEBUG Stock ajustado - Nuevo stock:', nuevo_stock);
    console.log('📝 DEBUG Ajuste registrado - Producto:', producto.nombre, 
                'Stock anterior:', producto.stock_actual, 
                'Stock nuevo:', nuevo_stock, 
                'Diferencia:', diferencia, 
                'Motivo:', motivo || 'Sin motivo');

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
    console.error('❌ ERROR ajustando stock:', error.message);
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

// 4. Ruta para obtener historial de movimientos (placeholder)
app.get('/api/inventario/movimientos', authenticateToken, getNegocioUsuario, requireAdmin, async (req, res) => {
  try {
    console.log('📋 DEBUG Obteniendo movimientos - Negocio:', req.negocioId);
    
    // Por ahora devolvemos un array vacío
    res.json([]);
    
  } catch (error) {
    console.error('Error obteniendo movimientos:', error);
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
         AND DATE(v.fecha) BETWEEN COALESCE($2, CURRENT_DATE) AND COALESCE($3, CURRENT_DATE)
         ORDER BY v.fecha DESC`,
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
         AND DATE(fecha) BETWEEN COALESCE($2, CURRENT_DATE) AND COALESCE($3, CURRENT_DATE)`,
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



// 5. REPORTE FINANCIERO MENSUAL (PDF) - Función completa
async function generarReporteFinancieroMensual(negocioId, fechaInicio, fechaFin) {
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

      // Obtener fechas del período (si no se especifican, usar mes actual)
      let startDate = fechaInicio || moment().startOf('month').format('YYYY-MM-DD');
      let endDate = fechaFin || moment().endOf('month').format('YYYY-MM-DD');

      console.log('💰 Generando reporte financiero - Período:', startDate, 'a', endDate);

      // OBTENER DATOS FINANCIEROS

      // 1. Ventas totales del período
      const ventasResult = await pool.query(
        `SELECT 
            COUNT(*) as total_ventas,
            COALESCE(SUM(total), 0) as monto_total,
            COALESCE(SUM(iva), 0) as iva_total,
            COALESCE(SUM(subtotal), 0) as subtotal_total
         FROM ventas 
         WHERE negocio_id = $1 
         AND fecha BETWEEN $2 AND $3`,
        [negocioId, startDate, endDate]
      );

      // 2. Ventas por día (para gráfico)
      const ventasPorDia = await pool.query(
        `SELECT 
            DATE(fecha) as fecha,
            COUNT(*) as ventas_dia,
            SUM(total) as monto_dia,
            SUM(iva) as iva_dia
         FROM ventas
         WHERE negocio_id = $1 
         AND fecha BETWEEN $2 AND $3
         GROUP BY DATE(fecha)
         ORDER BY fecha`,
        [negocioId, startDate, endDate]
      );

      // 3. Métodos de pago utilizados
      const metodosPago = await pool.query(
        `SELECT 
            metodo_pago,
            COUNT(*) as cantidad_ventas,
            SUM(total) as monto_total,
            ROUND((COUNT(*) * 100.0 / (SELECT COUNT(*) FROM ventas WHERE negocio_id = $1 AND fecha BETWEEN $2 AND $3)), 2) as porcentaje
         FROM ventas
         WHERE negocio_id = $1 
         AND fecha BETWEEN $2 AND $3
         GROUP BY metodo_pago
         ORDER BY monto_total DESC`,
        [negocioId, startDate, endDate]
      );

      // 4. Productos más vendidos (top 10)
      const productosTop = await pool.query(
        `SELECT 
            p.nombre,
            SUM(dv.cantidad) as cantidad_vendida,
            SUM(dv.subtotal) as monto_total,
            ROUND(AVG(dv.precio_unitario), 2) as precio_promedio
         FROM detalle_venta dv
         JOIN productos p ON dv.producto_id = p.id
         JOIN ventas v ON dv.venta_id = v.id
         WHERE v.negocio_id = $1 
         AND v.fecha BETWEEN $2 AND $3
         GROUP BY p.id, p.nombre
         ORDER BY cantidad_vendida DESC
         LIMIT 10`,
        [negocioId, startDate, endDate]
      );

      // 5. Clientes frecuentes
      const clientesFrecuentes = await pool.query(
        `SELECT 
            cliente_nombre,
            cliente_documento,
            COUNT(*) as compras,
            SUM(total) as monto_total
         FROM ventas
         WHERE negocio_id = $1 
         AND fecha BETWEEN $2 AND $3
         AND cliente_nombre IS NOT NULL
         AND cliente_nombre != 'Consumidor Final'
         GROUP BY cliente_nombre, cliente_documento
         HAVING COUNT(*) >= 2
         ORDER BY monto_total DESC
         LIMIT 10`,
        [negocioId, startDate, endDate]
      );

      // 6. Valor del inventario actual
      const valorInventario = await pool.query(
        `SELECT 
            COUNT(*) as total_productos,
            SUM(stock_actual) as unidades_total,
            SUM(precio_compra * stock_actual) as valor_inventario,
            SUM(precio_venta * stock_actual) as valor_venta_potencial
         FROM productos
         WHERE negocio_id = $1 AND activo = true`,
        [negocioId]
      );

      // 7. Productos con stock bajo
      const productosStockBajo = await pool.query(
        `SELECT 
            nombre,
            stock_actual,
            stock_minimo,
            precio_compra,
            precio_venta,
            (precio_compra * stock_actual) as valor_inventario
         FROM productos
         WHERE negocio_id = $1 
         AND activo = true 
         AND stock_actual <= stock_minimo
         ORDER BY stock_actual ASC`,
        [negocioId]
      );

      const ventas = ventasResult.rows[0];
      const inventario = valorInventario.rows[0];

      // CALCULAR MÉTRICAS FINANCIERAS
      const margenBruto = ventas.subtotal_total - (inventario?.valor_inventario || 0);
      const margenPorcentaje = ventas.subtotal_total > 0 ? 
        (margenBruto / ventas.subtotal_total * 100).toFixed(2) : 0;
      
      const ticketPromedio = ventas.total_ventas > 0 ? 
        ventas.monto_total / ventas.total_ventas : 0;

      // GENERAR PDF
      doc.fontSize(20).text(`REPORTE FINANCIERO MENSUAL`, { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Negocio: ${negocio.nombre}`, { align: 'center' });
      doc.text(`Período: ${moment(startDate).format('DD/MM/YYYY')} - ${moment(endDate).format('DD/MM/YYYY')}`, { align: 'center' });
      doc.text(`Generado: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, { align: 'center' });
      doc.moveDown();

      // RESUMEN EJECUTIVO
      doc.fontSize(16).text('📊 RESUMEN EJECUTIVO', { underline: true });
      doc.moveDown(0.5);
      
      doc.fontSize(12);
      doc.text(`Período analizado: ${moment(startDate).format('DD/MM/YYYY')} - ${moment(endDate).format('DD/MM/YYYY')}`);
      doc.text(`Total de días con ventas: ${ventasPorDia.rows.length}`);
      doc.moveDown();

      // MÉTRICAS FINANCIERAS PRINCIPALES
      doc.fontSize(14).text('💰 MÉTRICAS FINANCIERAS', { underline: true });
      doc.moveDown(0.5);
      
      doc.text(`Ventas Totales: $${Number(ventas.monto_total).toLocaleString()}`);
      doc.text(`• Subtotal: $${Number(ventas.subtotal_total).toLocaleString()}`);
      doc.text(`• IVA (19%): $${Number(ventas.iva_total).toLocaleString()}`);
      doc.text(`Total Ventas: ${ventas.total_ventas} transacciones`);
      doc.text(`Ticket Promedio: $${Number(ticketPromedio).toLocaleString()}`);
      doc.text(`Margen Bruto: $${Number(margenBruto).toLocaleString()} (${margenPorcentaje}%)`);
      doc.moveDown();

      // MÉTODOS DE PAGO
      doc.fontSize(14).text('💳 DISTRIBUCIÓN DE MÉTODOS DE PAGO', { underline: true });
      doc.moveDown(0.5);
      
      if (metodosPago.rows.length > 0) {
        metodosPago.rows.forEach(metodo => {
          doc.text(`${metodo.metodo_pago}: ${metodo.cantidad_ventas} ventas (${metodo.porcentaje}%) - $${Number(metodo.monto_total).toLocaleString()}`);
        });
      } else {
        doc.text('No hay datos de métodos de pago');
      }
      doc.moveDown();

      // INVENTARIO
      doc.fontSize(14).text('📦 ANÁLISIS DE INVENTARIO', { underline: true });
      doc.moveDown(0.5);
      
      if (inventario) {
        doc.text(`Total Productos: ${inventario.total_productos}`);
        doc.text(`Unidades en Inventario: ${inventario.unidades_total}`);
        doc.text(`Valor del Inventario: $${Number(inventario.valor_inventario).toLocaleString()}`);
        doc.text(`Valor de Venta Potencial: $${Number(inventario.valor_venta_potencial).toLocaleString()}`);
      }
      doc.moveDown();

      // PRODUCTOS MÁS VENDIDOS
      if (productosTop.rows.length > 0) {
        doc.fontSize(14).text('🔥 TOP 10 PRODUCTOS MÁS VENDIDOS', { underline: true });
        doc.moveDown(0.5);
        
        productosTop.rows.forEach((producto, index) => {
          doc.fontSize(10);
          doc.text(`${index + 1}. ${producto.nombre}`);
          doc.text(`   Vendidos: ${producto.cantidad_vendida} unidades - $${Number(producto.monto_total).toLocaleString()}`);
          doc.text(`   Precio promedio: $${Number(producto.precio_promedio).toLocaleString()}`);
        });
        doc.moveDown();
      }

      // CLIENTES FRECUENTES
      if (clientesFrecuentes.rows.length > 0) {
        doc.fontSize(14).text('👥 CLIENTES FRECUENTES', { underline: true });
        doc.moveDown(0.5);
        
        clientesFrecuentes.rows.forEach((cliente, index) => {
          doc.fontSize(10);
          doc.text(`${index + 1}. ${cliente.cliente_nombre} (${cliente.cliente_documento || 'Sin documento'})`);
          doc.text(`   Compras: ${cliente.compras} - Total gastado: $${Number(cliente.monto_total).toLocaleString()}`);
        });
        doc.moveDown();
      }

      // ALERTAS DE STOCK
      if (productosStockBajo.rows.length > 0) {
        doc.fontSize(14).text('⚠️ PRODUCTOS CON STOCK BAJO', { underline: true });
        doc.moveDown(0.5);
        
        productosStockBajo.rows.forEach(producto => {
          doc.fontSize(10);
          doc.text(`${producto.nombre}`);
          doc.text(`   Stock: ${producto.stock_actual} (Mínimo: ${producto.stock_minimo})`);
          doc.text(`   Valor en inventario: $${Number(producto.valor_inventario).toLocaleString()}`);
        });
        doc.moveDown();
      }

      // VENTAS POR DÍA (tabla)
      if (ventasPorDia.rows.length > 0) {
        doc.fontSize(14).text('📈 VENTAS POR DÍA', { underline: true });
        doc.moveDown(0.5);
        
        // Crear tabla simple
        let yPosition = doc.y;
        let xPosition = 50;
        let rowHeight = 20;
        let colWidth = 100;
        
        // Encabezados
        doc.fontSize(10).font('Helvetica-Bold');
        doc.text('Fecha', xPosition, yPosition);
        doc.text('Ventas', xPosition + colWidth, yPosition);
        doc.text('Monto', xPosition + colWidth * 2, yPosition);
        doc.text('IVA', xPosition + colWidth * 3, yPosition);
        
        yPosition += rowHeight;
        doc.font('Helvetica');
        
        // Filas
        ventasPorDia.rows.forEach(dia => {
          doc.text(moment(dia.fecha).format('DD/MM'), xPosition, yPosition);
          doc.text(dia.ventas_dia.toString(), xPosition + colWidth, yPosition);
          doc.text(`$${Number(dia.monto_dia).toLocaleString()}`, xPosition + colWidth * 2, yPosition);
          doc.text(`$${Number(dia.iva_dia).toLocaleString()}`, xPosition + colWidth * 3, yPosition);
          yPosition += 15;
          
          // Si nos quedamos sin espacio, crear nueva página
          if (yPosition > 700) {
            doc.addPage();
            yPosition = 50;
          }
        });
        doc.moveDown();
      }

      // RECOMENDACIONES
      doc.addPage();
      doc.fontSize(16).text('💡 RECOMENDACIONES Y ANÁLISIS', { align: 'center', underline: true });
      doc.moveDown();
      
      doc.fontSize(12);
      doc.text('1. Análisis de Rentabilidad:');
      doc.text('   • Margen bruto del ' + margenPorcentaje + '% indica ' + 
        (margenPorcentaje > 30 ? 'buena rentabilidad' : margenPorcentaje > 15 ? 'rentabilidad aceptable' : 'rentabilidad baja'));
      doc.moveDown(0.5);
      
      doc.text('2. Gestión de Inventario:');
      if (productosStockBajo.rows.length > 0) {
        doc.text(`   • ${productosStockBajo.rows.length} productos necesitan reabastecimiento urgente`);
        doc.text(`   • Valor estimado para reposición: $${Number(productosStockBajo.rows.reduce((sum, p) => sum + (p.precio_compra * (p.stock_minimo * 3 - p.stock_actual)), 0)).toLocaleString()}`);
      } else {
        doc.text('   • Inventario en niveles óptimos');
      }
      doc.moveDown(0.5);
      
      doc.text('3. Comportamiento de Ventas:');
      doc.text(`   • Ticket promedio: $${Number(ticketPromedio).toLocaleString()}`);
      if (ticketPromedio < 100000) {
        doc.text('   • Considerar estrategias para aumentar el ticket promedio');
      }
      doc.moveDown(0.5);
      
      doc.text('4. Métodos de Pago:');
      const metodoPrincipal = metodosPago.rows[0];
      if (metodoPrincipal) {
        doc.text(`   • Método principal: ${metodoPrincipal.metodo_pago} (${metodoPrincipal.porcentaje}%)`);
        if (metodoPrincipal.porcentaje > 70) {
          doc.text('   • Dependencia alta de un solo método de pago');
        }
      }
      doc.moveDown();

      // FIRMA Y FECHA
      doc.moveDown(2);
      doc.text('_________________________________', { align: 'center' });
      doc.text('Responsable del Reporte', { align: 'center' });
      doc.text(new Date().toLocaleDateString(), { align: 'center' });

      doc.end();

    } catch (error) {
      reject(error);
    }
  });
}

// Ruta para verificar estructura de tabla ventas
app.get('/api/debug/ventas-structure', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'ventas' 
      ORDER BY ordinal_position
    `);
    
    // Verificar si existe fecha o fecha_venta
    const tieneFecha = result.rows.some(col => col.column_name === 'fecha');
    const tieneFechaVenta = result.rows.some(col => col.column_name === 'fecha_venta');
    
    res.json({
      table: 'ventas',
      columns: result.rows,
      analysis: {
        tiene_fecha: tieneFecha,
        tiene_fecha_venta: tieneFechaVenta,
        recommended_column: tieneFecha ? 'fecha' : tieneFechaVenta ? 'fecha_venta' : 'none'
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});