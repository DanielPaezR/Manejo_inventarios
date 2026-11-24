// Rutas: Inicio de sesión, permisos de trabajadores y perfil.
// Movidas desde server.js (secciones: RUTAS DE AUTENTICACIÓN · PERMISOS DE TRABAJADORES · RUTAS DE PERFIL).
// Reciben ctx con lo que server.js prepara (app, pool, middlewares, helpers)
// y lo que exportan los grupos registrados antes; devuelven lo que otros usan.
module.exports = function registrarRutas(ctx) {
  const {
    bcrypt, jwt, authenticateToken, requireAdmin, JWT_SECRET, app, pool
  } = ctx;

  // ==================== RUTAS DE AUTENTICACIÓN ====================

  // ==================== PERMISOS DE TRABAJADORES ====================
  // El administrador del negocio puede darle a cada trabajador acceso a
  // secciones extra (p. ej. registrar productos al arrancar) y quitárselo
  // después. Se lee de la base en cada petición, así que quitar un permiso
  // aplica de inmediato aunque el trabajador tenga la sesión abierta.
  const PERMISOS_TRABAJADOR = ['productos', 'inventario', 'proveedores', 'clientes', 'facturas'];

  const limpiarPermisos = (permisos) => {
    const limpios = {};
    for (const clave of PERMISOS_TRABAJADOR) {
      if (permisos && permisos[clave] === true) limpios[clave] = true;
    }
    return limpios;
  };

  const requirePermiso = (clave) => async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'No autenticado' });
      }
      if (req.user.rol === 'admin' || req.user.rol === 'super_admin') {
        return next();
      }
      if (req.user.rol === 'trabajador') {
        const result = await pool.query('SELECT permisos FROM usuarios WHERE id = $1 AND activo = true', [req.user.id]);
        if (result.rows[0]?.permisos?.[clave] === true) {
          return next();
        }
      }
      return res.status(403).json({ error: 'No tienes permiso para esta sección. Pídeselo al administrador.' });
    } catch (error) {
      console.error('Error verificando permisos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  };

  // Permisos actuales del usuario (el frontend los refresca al navegar).
  app.get('/api/usuarios/mis-permisos', authenticateToken, async (req, res) => {
    try {
      const result = await pool.query('SELECT rol, permisos FROM usuarios WHERE id = $1 AND activo = true', [req.user.id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }
      res.json({ rol: result.rows[0].rol, permisos: limpiarPermisos(result.rows[0].permisos) });
    } catch (error) {
      console.error('Error obteniendo permisos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Trabajadores del negocio del administrador, con sus permisos.
  app.get('/api/equipo', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const admin = await pool.query('SELECT negocio_id FROM usuarios WHERE id = $1', [req.user.id]);
      const negocioId = admin.rows[0]?.negocio_id;
      if (!negocioId) {
        return res.json([]);
      }
      const result = await pool.query(
        `SELECT u.id, u.nombre, u.email, u.activo, u.permisos,
              COALESCE(string_agg(m.nombre, ', ' ORDER BY m.nombre), '') AS modulos
       FROM usuarios u
       LEFT JOIN usuario_modulos um ON um.usuario_id = u.id
       LEFT JOIN modulos m ON m.id = um.modulo_id
       WHERE u.negocio_id = $1 AND u.rol = 'trabajador'
       GROUP BY u.id
       ORDER BY u.activo DESC, u.nombre`,
        [negocioId]
      );
      res.json(result.rows.map(u => ({ ...u, permisos: limpiarPermisos(u.permisos) })));
    } catch (error) {
      console.error('Error obteniendo el equipo:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // El administrador cambia los permisos de un trabajador de su mismo negocio.
  // No puede crear usuarios ni cambiar roles: eso sigue en manos del super admin.
  app.put('/api/equipo/:id/permisos', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      if (!/^\d+$/.test(id)) {
        return res.status(404).json({ error: 'Trabajador no encontrado' });
      }
      const permisos = limpiarPermisos(req.body.permisos || {});
      const result = await pool.query(
        `UPDATE usuarios u
       SET permisos = $1::jsonb
       FROM usuarios a
       WHERE u.id = $2 AND u.rol = 'trabajador'
         AND a.id = $3 AND (a.rol = 'super_admin' OR a.negocio_id = u.negocio_id)
       RETURNING u.id, u.nombre, u.permisos`,
        [JSON.stringify(permisos), id, req.user.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Trabajador no encontrado' });
      }
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error guardando permisos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

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
        
        if (user.rol === 'admin' || user.rol === 'trabajador') {
          // El acceso a módulos de admin y trabajador se controla igual: solo
          // los módulos asignados explícitamente en usuario_modulos (ver
          // GestionModulos.jsx) — admin ya no ve automáticamente todos los
          // módulos de su negocio, super_admin decide el acceso de cada uno.
          const modulosResult = await pool.query(
            `SELECT m.id, m.nombre, m.descripcion, m.activo, m.tiene_domicilio
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
          modulos: modulos,
          permisos: limpiarPermisos(user.permisos)
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
        
        if (user.rol === 'admin' || user.rol === 'trabajador') {
          // El acceso a módulos de admin y trabajador se controla igual: solo
          // los módulos asignados explícitamente en usuario_modulos (ver
          // GestionModulos.jsx) — admin ya no ve automáticamente todos los
          // módulos de su negocio, super_admin decide el acceso de cada uno.
          const modulosResult = await pool.query(
            `SELECT m.id, m.nombre, m.descripcion, m.activo, m.tiene_domicilio
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

  return { requirePermiso };
};
