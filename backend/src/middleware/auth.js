const jwt = require('jsonwebtoken');

/**
 * Middleware de autenticación JWT
 * Verifica que el token sea válido y adjunta el usuario al request
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'secreto_temporal', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido o expirado' });
    }
    req.user = user;
    next();
  });
};

/**
 * Middleware para verificar rol de administrador
 * Requiere que el usuario sea admin o super_admin
 */
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  
  if (req.user.rol !== 'admin' && req.user.rol !== 'super_admin') {
    return res.status(403).json({ error: 'Se requieren permisos de administrador' });
  }
  
  next();
};

/**
 * Middleware para verificar rol de super administrador
 * Requiere que el usuario sea super_admin
 */
const requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  
  if (req.user.rol !== 'super_admin') {
    return res.status(403).json({ error: 'Se requieren permisos de super administrador' });
  }
  
  next();
};

/**
 * Middleware para verificar que el usuario pertenece a un negocio
 * Útil para rutas que necesitan el negocio_id del usuario
 */
const requireNegocio = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    // Si es super_admin, puede pasar sin negocio específico
    if (req.user.rol === 'super_admin') {
      return next();
    }

    // Verificar que el usuario tiene negocio_id
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    const result = await pool.query(
      'SELECT negocio_id FROM usuarios WHERE id = $1 AND activo = true',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (!result.rows[0].negocio_id) {
      return res.status(400).json({ error: 'Usuario no tiene negocio asignado' });
    }

    req.negocioId = result.rows[0].negocio_id;
    next();
  } catch (error) {
    console.error('Error en requireNegocio:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = {
  authenticateToken,
  requireAdmin,
  requireSuperAdmin,
  requireNegocio
};