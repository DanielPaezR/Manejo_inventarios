const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/**
 * Middleware de verificación de acceso por módulo
 * Controla qué módulos puede ver/operar cada usuario según su rol:
 * - super_admin: acceso total a cualquier módulo
 * - admin: acceso a todos los módulos de su negocio
 * - trabajador: solo módulos asignados
 */
const checkAccess = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const userRol = req.user.rol;
    const moduloId = req.body.modulo_id || req.query.modulo_id || req.params.modulo_id;

    console.log('🔐 checkAccess - Usuario:', req.user.email, 'Rol:', userRol, 'Módulo ID:', moduloId);

    // CASO 1: Super Administrador → acceso total
    if (userRol === 'super_admin') {
      req.moduloId = moduloId || null;
      req.negocioId = req.query.negocio_id || null;
      return next();
    }

    // CASO 2: Administrador de Negocio → acceso a todos los módulos de su negocio
    if (userRol === 'admin') {
      const adminResult = await pool.query(
        'SELECT negocio_id FROM usuarios WHERE id = $1 AND activo = true',
        [userId]
      );
      
      if (adminResult.rows.length === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
      
      const negocioId = adminResult.rows[0].negocio_id;
      req.negocioId = negocioId;

      // Si se especifica un módulo, verificar que pertenece a su negocio
      if (moduloId) {
        const moduloResult = await pool.query(
          'SELECT negocio_id FROM modulos WHERE id = $1 AND activo = true',
          [moduloId]
        );
        
        if (moduloResult.rows.length === 0) {
          return res.status(404).json({ error: 'Módulo no encontrado' });
        }
        
        if (moduloResult.rows[0].negocio_id !== negocioId) {
          return res.status(403).json({ error: 'No tienes acceso a este módulo' });
        }
        req.moduloId = moduloId;
      }
      
      return next();
    }

    // CASO 3: Trabajador → solo módulos asignados
    if (userRol === 'trabajador') {
      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo para esta acción' });
      }

      const accesoResult = await pool.query(
        `SELECT um.*, m.negocio_id, m.nombre as modulo_nombre
         FROM usuario_modulos um
         JOIN modulos m ON um.modulo_id = m.id
         WHERE um.usuario_id = $1 AND um.modulo_id = $2 AND m.activo = true`,
        [userId, moduloId]
      );

      if (accesoResult.rows.length === 0) {
        return res.status(403).json({ error: 'No tienes acceso a este módulo' });
      }

      req.moduloId = moduloId;
      req.negocioId = accesoResult.rows[0].negocio_id;
      req.moduloNombre = accesoResult.rows[0].modulo_nombre;
      
      return next();
    }

    return res.status(403).json({ error: 'Rol no válido' });

  } catch (error) {
    console.error('❌ Error en middleware checkAccess:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

/**
 * Versión opcional de checkAccess que no requiere módulo
 * Útil para rutas que necesitan solo verificar el negocio
 */
const checkAccessOptional = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const userRol = req.user.rol;
    const moduloId = req.body.modulo_id || req.query.modulo_id || req.params.modulo_id;

    if (userRol === 'super_admin') {
      req.moduloId = moduloId || null;
      req.negocioId = req.query.negocio_id || null;
      return next();
    }

    if (userRol === 'admin') {
      const adminResult = await pool.query(
        'SELECT negocio_id FROM usuarios WHERE id = $1 AND activo = true',
        [userId]
      );
      
      if (adminResult.rows.length === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
      
      req.negocioId = adminResult.rows[0].negocio_id;

      if (moduloId) {
        const moduloResult = await pool.query(
          'SELECT negocio_id FROM modulos WHERE id = $1 AND activo = true',
          [moduloId]
        );
        
        if (moduloResult.rows.length === 0) {
          return res.status(404).json({ error: 'Módulo no encontrado' });
        }
        
        if (moduloResult.rows[0].negocio_id !== req.negocioId) {
          return res.status(403).json({ error: 'No tienes acceso a este módulo' });
        }
        req.moduloId = moduloId;
      }
      
      return next();
    }

    if (userRol === 'trabajador') {
      if (!moduloId) {
        // Para trabajadores, obtener su primer módulo asignado
        const modulosResult = await pool.query(
          `SELECT m.id, m.negocio_id, m.nombre
           FROM modulos m
           JOIN usuario_modulos um ON m.id = um.modulo_id
           WHERE um.usuario_id = $1 AND m.activo = true
           LIMIT 1`,
          [userId]
        );

        if (modulosResult.rows.length === 0) {
          return res.status(403).json({ error: 'No tienes módulos asignados' });
        }

        req.moduloId = modulosResult.rows[0].id;
        req.negocioId = modulosResult.rows[0].negocio_id;
        req.moduloNombre = modulosResult.rows[0].nombre;
        return next();
      }

      const accesoResult = await pool.query(
        `SELECT um.*, m.negocio_id, m.nombre as modulo_nombre
         FROM usuario_modulos um
         JOIN modulos m ON um.modulo_id = m.id
         WHERE um.usuario_id = $1 AND um.modulo_id = $2 AND m.activo = true`,
        [userId, moduloId]
      );

      if (accesoResult.rows.length === 0) {
        return res.status(403).json({ error: 'No tienes acceso a este módulo' });
      }

      req.moduloId = moduloId;
      req.negocioId = accesoResult.rows[0].negocio_id;
      req.moduloNombre = accesoResult.rows[0].modulo_nombre;
      
      return next();
    }

    return res.status(403).json({ error: 'Rol no válido' });

  } catch (error) {
    console.error('❌ Error en middleware checkAccessOptional:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = { checkAccess, checkAccessOptional };