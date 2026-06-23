const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

const checkAccess = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const userRol = req.user.rol;
    let moduloId = req.body.modulo_id || req.query.modulo_id || req.params.modulo_id;

    console.log('🔐 checkAccess - Usuario:', req.user.email, 'Rol:', userRol, 'Módulo ID (recibido):', moduloId);

    // --- SUPER ADMIN ---
    if (userRol === 'super_admin') {
      req.moduloId = moduloId || null;
      req.negocioId = req.query.negocio_id || null;
      return next();
    }

    // --- ADMINISTRADOR ---
    if (userRol === 'admin') {
      // Obtener el negocio del admin
      const adminResult = await pool.query(
        'SELECT negocio_id FROM usuarios WHERE id = $1 AND activo = true',
        [userId]
      );
      
      if (adminResult.rows.length === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
      
      const negocioId = adminResult.rows[0].negocio_id;
      req.negocioId = negocioId;

      // 🚨 NUEVO: Si no se envió un módulo, obtener el primero del negocio
      if (!moduloId) {
        const moduloResult = await pool.query(
          'SELECT id FROM modulos WHERE negocio_id = $1 AND activo = true ORDER BY id LIMIT 1',
          [negocioId]
        );
        
        if (moduloResult.rows.length > 0) {
          moduloId = moduloResult.rows[0].id;
          console.log(`🔄 Admin sin módulo. Asignando módulo automático: ${moduloId}`);
        } else {
          console.log('⚠️ Admin sin módulos en su negocio.');
          return res.status(400).json({ error: 'El negocio no tiene módulos activos' });
        }
      } else {
        // Si envió un módulo, verificar que pertenezca a su negocio
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
      }

      req.moduloId = moduloId;
      return next();
    }

    // --- TRABAJADOR ---
    if (userRol === 'trabajador') {
      if (!moduloId) {
        // Si un trabajador no envía módulo, obtener el primero que tenga asignado
        const modulosResult = await pool.query(
          `SELECT m.id FROM modulos m
           JOIN usuario_modulos um ON m.id = um.modulo_id
           WHERE um.usuario_id = $1 AND m.activo = true
           ORDER BY m.id LIMIT 1`,
          [userId]
        );

        if (modulosResult.rows.length === 0) {
          return res.status(403).json({ error: 'No tienes módulos asignados' });
        }

        moduloId = modulosResult.rows[0].id;
        console.log(`🔄 Trabajador sin módulo. Asignando módulo automático: ${moduloId}`);
      } else {
        // Verificar que el trabajador tenga acceso al módulo que envió
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

        req.negocioId = accesoResult.rows[0].negocio_id;
        req.moduloNombre = accesoResult.rows[0].modulo_nombre;
      }

      req.moduloId = moduloId;
      return next();
    }

    return res.status(403).json({ error: 'Rol no válido' });

  } catch (error) {
    console.error('❌ Error en middleware checkAccess:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

module.exports = { checkAccess };