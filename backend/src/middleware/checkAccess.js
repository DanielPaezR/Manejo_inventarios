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

    // --- ADMINISTRADOR / TRABAJADOR ---
    // El acceso a módulos se controla igual para los dos roles: solo los
    // módulos asignados en usuario_modulos (ver GestionModulos.jsx) —
    // admin ya no tiene acceso automático a todos los módulos de su
    // negocio, super_admin decide el acceso de cada credencial.
    if (userRol === 'admin' || userRol === 'trabajador') {
      if (!moduloId) {
        // Sin módulo explícito: usar el primero que tenga asignado.
        const modulosResult = await pool.query(
          `SELECT m.id, m.negocio_id FROM modulos m
           JOIN usuario_modulos um ON m.id = um.modulo_id
           WHERE um.usuario_id = $1 AND m.activo = true
           ORDER BY m.id LIMIT 1`,
          [userId]
        );

        if (modulosResult.rows.length === 0) {
          return res.status(403).json({ error: 'No tienes módulos asignados' });
        }

        moduloId = modulosResult.rows[0].id;
        req.negocioId = modulosResult.rows[0].negocio_id;
        console.log(`🔄 ${userRol} sin módulo. Asignando módulo automático: ${moduloId}`);
      } else {
        // Verificar que tenga acceso asignado al módulo que envió.
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