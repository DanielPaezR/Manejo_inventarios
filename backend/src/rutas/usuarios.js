// Rutas: Usuarios de cada negocio (super admin).
// Movidas desde server.js (secciones: RUTAS DE USUARIOS).
// Reciben ctx con lo que server.js prepara (app, pool, middlewares, helpers)
// y lo que exportan los grupos registrados antes; devuelven lo que otros usan.
module.exports = function registrarRutas(ctx) {
  const {
    bcrypt, authenticateToken, requireSuperAdmin, planes, app, pool
  } = ctx;

  // ==================== RUTAS DE USUARIOS ====================
  // Crear/listar/eliminar usuarios y su acceso a módulos es función
  // exclusiva de super_admin — un admin normal ya no gestiona usuarios ni
  // módulos, ni siquiera los de su propio negocio.

  app.get('/api/negocios/:id/usuarios', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      // modulos_asignados va con id además de nombre (no solo nombre, como
      // antes) para poder marcar los checkboxes de la pantalla de asignación
      // sin ambigüedad; el FILTER evita que un usuario sin módulos quede
      // como [null] en vez de [].
      const result = await pool.query(
        `SELECT u.id, u.nombre, u.email, u.rol, u.activo,
              COALESCE(
                json_agg(json_build_object('id', m.id, 'nombre', m.nombre)) FILTER (WHERE m.id IS NOT NULL),
                '[]'
              ) as modulos_asignados
       FROM usuarios u
       LEFT JOIN usuario_modulos um ON u.id = um.usuario_id
       LEFT JOIN modulos m ON um.modulo_id = m.id
       WHERE u.negocio_id = $1 AND u.rol != 'super_admin' AND u.activo = true
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

      const limiteUsuarios = await planes.verificarLimite(pool, id, 'usuarios');
      if (limiteUsuarios.error) return res.status(403).json({ error: limiteUsuarios.error });

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
        'SELECT rol, negocio_id FROM usuarios WHERE id = $1',
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

  return {};
};
