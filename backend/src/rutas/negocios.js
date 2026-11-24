// Rutas: Negocios, módulos (sedes) y acceso de usuarios a módulos.
// Movidas desde server.js (secciones: RUTAS DE NEGOCIOS · RUTAS DE MÓDULOS · RUTAS DE GESTIÓN DE USUARIOS EN MÓDULOS).
// Reciben ctx con lo que server.js prepara (app, pool, middlewares, helpers)
// y lo que exportan los grupos registrados antes; devuelven lo que otros usan.
module.exports = function registrarRutas(ctx) {
  const {
    authenticateToken, requireAdmin, requireSuperAdmin, checkAccess, planes, app, pool
  } = ctx;
  // Definidos en grupos que se registran después: se buscan al usarlos.
  const juegosActivos = (...args) => ctx.juegosActivos(...args);

  // ==================== RUTAS DE NEGOCIOS ====================

  app.post('/api/negocios', authenticateToken, requireSuperAdmin, async (req, res) => {
    // pool.connect() dentro del try: si la conexión falla, no debe quedar
    // como una promesa rechazada sin atrapar que tumbe todo el proceso.
    let client;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const { nombre, direccion, telefono, email, ruc_nit, logo_url } = req.body;
      // tipo cambia solo textos de la app ("Mesa" vs "Cliente", menú vs
      // catálogo); la lógica es la misma para todos los negocios.
      const tipo = req.body.tipo === 'tienda' ? 'tienda' : 'restaurante';

      const negocioResult = await client.query(
        `INSERT INTO negocios (nombre, direccion, telefono, email, ruc_nit, logo_url, tipo)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [nombre, direccion, telefono, email, ruc_nit, logo_url, tipo]
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

  // Trae TODOS los negocios (activos e inactivos): el panel de super_admin
  // necesita ver los inactivos para poder reactivarlos — filtrar por
  // activo=true los escondería para siempre.
  app.get('/api/negocios', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM negocios ORDER BY activo DESC, nombre'
      );
      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo negocios:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Activar/desactivar un negocio — bloquea el login de sus usuarios (ver
  // POST /api/login, que filtra WHERE activo = true) de forma reversible.
  // Para un borrado real y definitivo ver DELETE /api/negocios/:id, que solo
  // procede si el negocio no tiene módulos ni usuarios asociados.
  app.put('/api/negocios/:id/estado', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { activo, motivo } = req.body;

      if (typeof activo !== 'boolean') {
        return res.status(400).json({ error: 'activo debe ser true o false' });
      }

      // Al reactivar se limpia el motivo: ya no aplica una vez el negocio
      // vuelve a estar activo. Al desactivar, motivo es opcional.
      const result = await pool.query(
        `UPDATE negocios
       SET activo = $1, motivo_desactivacion = $2
       WHERE id = $3
       RETURNING *`,
        [activo, activo ? null : (motivo?.trim() || null), id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Negocio no encontrado' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error actualizando estado del negocio:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Borrado real solo si el negocio está genuinamente vacío (sin módulos ni
  // usuarios) — mismo criterio de seguridad que DELETE /api/modulos/:id: con
  // todo lo que puede depender de un negocio a través de sus módulos
  // (productos, ventas, clientes, historial financiero), un borrado con
  // datos sería demasiado riesgoso, así que se desactiva en su lugar.
  app.delete('/api/negocios/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;

      const negocioResult = await pool.query('SELECT id, nombre FROM negocios WHERE id = $1', [id]);

      if (negocioResult.rows.length === 0) {
        return res.status(404).json({ error: 'Negocio no encontrado' });
      }

      const negocio = negocioResult.rows[0];

      const [modulos, usuarios] = await Promise.all([
        pool.query('SELECT COUNT(*) FROM modulos WHERE negocio_id = $1', [id]),
        pool.query('SELECT COUNT(*) FROM usuarios WHERE negocio_id = $1', [id])
      ]);

      const conteos = {
        módulos: parseInt(modulos.rows[0].count, 10),
        usuarios: parseInt(usuarios.rows[0].count, 10)
      };
      const tieneDatos = Object.values(conteos).some(c => c > 0);

      if (tieneDatos) {
        await pool.query('UPDATE negocios SET activo = false WHERE id = $1', [id]);

        const detalle = Object.entries(conteos)
          .filter(([, c]) => c > 0)
          .map(([tabla, c]) => `${c} ${tabla}`)
          .join(', ');

        return res.json({
          eliminado: false,
          message: `El negocio "${negocio.nombre}" tenía datos asociados (${detalle}), así que se desactivó en vez de eliminarse.`
        });
      }

      await pool.query('DELETE FROM negocios WHERE id = $1', [id]);

      res.json({ eliminado: true, message: `Negocio "${negocio.nombre}" eliminado correctamente.` });
    } catch (error) {
      console.error('Error eliminando negocio:', error);
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

  // Crear módulos es función exclusiva de super_admin: antes un admin podía
  // crear módulos para su propio negocio, pero eso quedó centralizado para
  // que la estructura del negocio (qué módulos existen) la controle una sola
  // autoridad.
  app.post('/api/negocios/:id/modulos', authenticateToken, requireSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { nombre, descripcion } = req.body;

      if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'El nombre es requerido' });
      }

      const limiteSedes = await planes.verificarLimite(pool, id, 'sedes');
      if (limiteSedes.error) return res.status(403).json({ error: limiteSedes.error });

      const result = await pool.query(
        `INSERT INTO modulos (negocio_id, nombre, descripcion)
       VALUES ($1, $2, $3) RETURNING *`,
        [id, nombre.trim(), descripcion?.trim() || null]
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

  // Asignar/desasignar acceso a módulos es función exclusiva de super_admin:
  // antes un admin podía dar/quitar acceso de sus propios trabajadores, pero
  // eso quedó centralizado junto con la creación de módulos.
  app.post('/api/usuarios/:usuarioId/modulos/:moduloId', authenticateToken, requireSuperAdmin, async (req, res) => {
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

  app.delete('/api/usuarios/:usuarioId/modulos/:moduloId', authenticateToken, requireSuperAdmin, async (req, res) => {
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

      // negocio_nombre se trae para la vista previa editable del menú en
      // PedidosCliente.jsx (el subtítulo bajo el nombre público, igual que
      // en el menú real que ve el cliente).
      const result = await pool.query(
        `SELECT m.id, m.nombre, m.nombre_publico, m.descripcion, m.activo, m.foto_portada_url,
              m.frecuencia_entrega_dias, m.tiene_domicilio, n.nombre as negocio_nombre
       FROM modulos m
       JOIN negocios n ON m.negocio_id = n.id
       WHERE m.id = $1 AND m.negocio_id = $2`,
        [id, negocioId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Módulo no encontrado' });
      }

      res.json({ ...result.rows[0], juegos_activos: await juegosActivos(id) });
    } catch (error) {
      console.error('Error obteniendo módulo:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Configurar la personalización del menú público de este módulo: nombre de
  // marca visible al cliente, foto de portada (hero de MenuPublico.jsx),
  // frecuencia de entrega a domicilio (informativa, la usa la Ruta de
  // Entregas) y si este módulo ofrece domicilio o no (tiene_domicilio — si
  // está apagado, MenuPublico.jsx ni siquiera muestra la opción). Ruta
  // dedicada en vez de un PUT /api/modulos/:id genérico porque hoy no existe
  // ninguna ruta general de edición de módulo. Los campos son independientes
  // entre sí: cada uno se actualiza SOLO si vino explícito en el body, para
  // que editar uno no borre los demás.
  app.put('/api/modulos/:id/portada', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const negocioId = req.negocioId;

      if (!negocioId) {
        return res.status(400).json({ error: 'Negocio no identificado' });
      }

      const sets = [];
      const values = [];
      let paramIndex = 1;

      if ('nombre_publico' in req.body) {
        sets.push(`nombre_publico = $${paramIndex++}`);
        values.push(req.body.nombre_publico?.trim() || null);
      }

      if ('foto_portada_url' in req.body) {
        sets.push(`foto_portada_url = $${paramIndex++}`);
        values.push(req.body.foto_portada_url?.trim() || null);
      }

      if ('frecuencia_entrega_dias' in req.body) {
        const { frecuencia_entrega_dias } = req.body;
        let frecuenciaValida = null;
        if (frecuencia_entrega_dias !== null && frecuencia_entrega_dias !== undefined && frecuencia_entrega_dias !== '') {
          frecuenciaValida = parseInt(frecuencia_entrega_dias, 10);
          if (!Number.isFinite(frecuenciaValida) || frecuenciaValida <= 0) {
            return res.status(400).json({ error: 'frecuencia_entrega_dias debe ser un entero positivo' });
          }
        }
        sets.push(`frecuencia_entrega_dias = $${paramIndex++}`);
        values.push(frecuenciaValida);
      }

      if ('tiene_domicilio' in req.body) {
        sets.push(`tiene_domicilio = $${paramIndex++}`);
        values.push(!!req.body.tiene_domicilio);
      }

      if ('juegos_activos' in req.body) {
        sets.push(`juegos_activos = $${paramIndex++}`);
        values.push(!!req.body.juegos_activos);
      }

      if (sets.length === 0) {
        return res.status(400).json({ error: 'No hay nada para actualizar' });
      }

      values.push(id, negocioId);

      const result = await pool.query(
        `UPDATE modulos SET ${sets.join(', ')}
       WHERE id = $${paramIndex++} AND negocio_id = $${paramIndex}
       RETURNING id, nombre, nombre_publico, descripcion, activo, foto_portada_url, frecuencia_entrega_dias, tiene_domicilio`,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Módulo no encontrado' });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error actualizando módulo:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Eliminar módulos es función exclusiva de super_admin (antes admin podía
  // borrar los suyos). Borrado real solo si el módulo está genuinamente
  // vacío (sin productos, ventas, clientes ni proveedores) — mismo criterio
  // de seguridad que Negocios: si tiene datos, se desactiva en vez de
  // borrarse, porque un borrado perdería historial real.
  app.delete('/api/modulos/:id', authenticateToken, requireSuperAdmin, async (req, res) => {
    let client;
    try {
      const { id } = req.params;

      const moduloResult = await pool.query(
        'SELECT id, nombre, negocio_id FROM modulos WHERE id = $1',
        [id]
      );

      if (moduloResult.rows.length === 0) {
        return res.status(404).json({ error: 'Módulo no encontrado' });
      }

      const modulo = moduloResult.rows[0];

      const [productos, ventas, clientes, proveedores] = await Promise.all([
        pool.query('SELECT COUNT(*) FROM productos WHERE modulo_id = $1', [id]),
        pool.query('SELECT COUNT(*) FROM ventas WHERE modulo_id = $1', [id]),
        pool.query('SELECT COUNT(*) FROM clientes WHERE modulo_id = $1', [id]),
        pool.query('SELECT COUNT(*) FROM proveedores WHERE modulo_id = $1', [id])
      ]);

      const conteos = {
        productos: parseInt(productos.rows[0].count, 10),
        ventas: parseInt(ventas.rows[0].count, 10),
        clientes: parseInt(clientes.rows[0].count, 10),
        proveedores: parseInt(proveedores.rows[0].count, 10)
      };
      const tieneDatos = Object.values(conteos).some(c => c > 0);

      if (tieneDatos) {
        await pool.query('UPDATE modulos SET activo = false WHERE id = $1', [id]);

        const detalle = Object.entries(conteos)
          .filter(([, c]) => c > 0)
          .map(([tabla, c]) => `${c} ${tabla}`)
          .join(', ');

        return res.json({
          eliminado: false,
          message: `El módulo "${modulo.nombre}" tenía datos asociados (${detalle}), así que se desactivó en vez de eliminarse.`
        });
      }

      client = await pool.connect();
      await client.query('BEGIN');

      await client.query('DELETE FROM secuencias_factura WHERE modulo_id = $1', [id]);
      await client.query('DELETE FROM secuencias_cliente WHERE modulo_id = $1', [id]);
      await client.query('DELETE FROM usuario_modulos WHERE modulo_id = $1', [id]);
      await client.query('DELETE FROM modulos WHERE id = $1', [id]);

      await client.query('COMMIT');

      res.json({ eliminado: true, message: `Módulo "${modulo.nombre}" eliminado correctamente.` });
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }
      console.error('Error eliminando módulo:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  return {};
};
