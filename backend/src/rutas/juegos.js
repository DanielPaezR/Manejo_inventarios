// Rutas: Zona de juegos, salas en línea, tarjeta de sellos y administración de juegos.
// Movidas desde server.js (secciones: ZONA DE JUEGOS DEL MENÚ).
// Reciben ctx con lo que server.js prepara (app, pool, middlewares, helpers)
// y lo que exportan los grupos registrados antes; devuelven lo que otros usan.
module.exports = function registrarRutas(ctx) {
  const {
    authenticateToken, requireAdmin, checkAccess, guardarPuntaje, podioJuego, campeonesJuegos,
    leerPremio, ganadoresJuegos, misPremios, canjearPremio, puntajesRecientes, sellos, planes, salas,
    app, pool, requiereFuncion
  } = ctx;
  // Definidos en grupos que se registran después: se buscan al usarlos.
  const ipCliente = (...args) => ctx.ipCliente(...args);

  // ==================== ZONA DE JUEGOS DEL MENÚ ====================
  // Cada negocio decide si muestra la zona de juegos (modulos.juegos_activos).
  const juegosActivos = async (moduloId) => {
    try {
      const { rows: [m] } = await pool.query('SELECT juegos_activos FROM modulos WHERE id = $1', [moduloId]);
      return m ? m.juegos_activos !== false && await planes.moduloIncluye(pool, moduloId, 'juegos') : false;
    } catch {
      return true;
    }
  };

  // Puntajes y podio por negocio. Públicas (sin sesión); si la tabla aún no
  // existe, el podio sale vacío y guardar avisa que todavía no está activo.
  app.get('/api/menu/:moduloId/juegos/podio', async (req, res) => {
    try {
      if (!/^\d+$/.test(req.params.moduloId)) return res.json([]);
      res.json(await podioJuego(pool, req.params.moduloId, String(req.query.juego || ''), req.query.periodo === 'semana' ? 'semana' : 'siempre'));
    } catch (error) {
      console.error('Error leyendo el podio:', error.message);
      res.json([]);
    }
  });

  app.get('/api/menu/:moduloId/juegos/campeones', async (req, res) => {
    try {
      if (!/^\d+$/.test(req.params.moduloId)) return res.json({});
      res.json(await campeonesJuegos(pool, req.params.moduloId));
    } catch (error) {
      console.error('Error leyendo campeones:', error.message);
      res.json({});
    }
  });

  app.post('/api/menu/:moduloId/juegos/puntajes', async (req, res) => {
    try {
      if (!/^\d+$/.test(req.params.moduloId)) return res.status(404).json({ error: 'Juegos no disponibles' });
      if (!(await juegosActivos(req.params.moduloId))) return res.status(404).json({ error: 'Los juegos no están disponibles en este negocio' });
      const r = await guardarPuntaje(pool, req.params.moduloId, ipCliente(req), req.body || {});
      if (r.error) return res.status(r.status).json({ error: r.error });
      res.status(201).json(r.datos);
    } catch (error) {
      console.error('Error guardando puntaje:', error.message);
      res.status(503).json({ error: 'El podio todavía no está disponible' });
    }
  });

  // El cliente pregunta si alguno de sus códigos (guardados en su celular)
  // ganó el premio de la semana pasada. También dice cuál es el premio.
  app.post('/api/menu/:moduloId/juegos/mis-premios', async (req, res) => {
    try {
      if (!/^\d+$/.test(req.params.moduloId)) return res.json({ premio: { activo: false }, ganados: [] });
      const codigos = (Array.isArray(req.body?.codigos) ? req.body.codigos : [])
        .map(c => String(c).toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(c => c.length >= 4).slice(0, 200);
      res.json(await misPremios(pool, req.params.moduloId, codigos));
    } catch (error) {
      console.error('Error leyendo premios:', error.message);
      res.json({ premio: { activo: false }, ganados: [] });
    }
  });

  // ---- Jugar entre clientes (salas con código) ----
  const rutaSala = (accion) => async (req, res) => {
    try {
      if (!/^\d+$/.test(req.params.moduloId)) return res.status(404).json({ error: 'Juegos no disponibles' });
      if (!(await juegosActivos(req.params.moduloId))) return res.status(404).json({ error: 'Los juegos no están disponibles en este negocio' });
      const r = await accion(req);
      if (r.error) return res.status(r.status).json({ error: r.error });
      res.status(r.status).json(r.datos);
    } catch (error) {
      console.error('Error en sala de juego:', error.message);
      res.status(503).json({ error: 'El juego en línea no está disponible en este momento' });
    }
  };
  app.post('/api/menu/:moduloId/salas', rutaSala(req => salas.crearSala(pool, req.params.moduloId, ipCliente(req), req.body || {})));
  app.post('/api/menu/:moduloId/salas/:codigo/unirse', rutaSala(req => salas.unirse(pool, req.params.moduloId, req.params.codigo, req.body || {})));
  app.get('/api/menu/:moduloId/salas/:codigo', rutaSala(req => salas.consultar(pool, req.params.moduloId, req.params.codigo, String(req.query.token || ''))));
  app.post('/api/menu/:moduloId/salas/:codigo/jugar', rutaSala(req => salas.jugar(pool, req.params.moduloId, req.params.codigo, req.body?.token, req.body?.casilla)));
  app.post('/api/menu/:moduloId/salas/:codigo/revancha', rutaSala(req => salas.revancha(pool, req.params.moduloId, req.params.codigo, req.body?.token)));

  // ---- Tarjeta de sellos ----
  // El cliente consulta su tarjeta con su celular. Límite por IP para que no
  // se pueda recorrer números.
  const consultasSellos = new Map();
  app.get('/api/menu/:moduloId/sellos', async (req, res) => {
    try {
      if (!/^\d+$/.test(req.params.moduloId)) return res.status(404).json({ error: 'No disponible' });
      const ip = ipCliente(req);
      const ahora = Date.now();
      const recientes = (consultasSellos.get(ip) || []).filter(t => ahora - t < 10 * 60 * 1000);
      if (recientes.length >= 30) return res.status(429).json({ error: 'Muchas consultas seguidas. Intenta en unos minutos.' });
      recientes.push(ahora);
      consultasSellos.set(ip, recientes);
      if (consultasSellos.size > 5000) consultasSellos.clear();

      const t = await sellos.tarjeta(pool, req.params.moduloId, req.query.telefono);
      if (!t.config.activo) return res.status(404).json({ error: 'Este negocio no tiene tarjeta de sellos' });
      if (!t.telefono) return res.status(400).json({ error: 'Escribe tu número de celular' });
      res.json({ ...t.config, sellos: t.sellos, premios: t.premios, canjes: t.canjes });
    } catch (error) {
      console.error('Error consultando sellos:', error.message);
      res.status(500).json({ error: 'No se pudo consultar la tarjeta' });
    }
  });

  app.get('/api/sellos', authenticateToken, checkAccess, async (req, res) => {
    try {
      if (req.query.telefono) {
        const t = await sellos.tarjeta(pool, req.moduloId, req.query.telefono);
        return res.json(t);
      }
      res.json(await sellos.clientesConSellos(pool, req.moduloId));
    } catch (error) {
      console.error('Error leyendo sellos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.put('/api/sellos/config', authenticateToken, checkAccess, requireAdmin, requiereFuncion('sellos'), async (req, res) => {
    try {
      const premio = String(req.body?.premio || '').trim();
      if (req.body?.activo === true && !premio) return res.status(400).json({ error: 'Escribe cuál es el premio' });
      const config = sellos.leerConfig({ ...req.body, premio });
      await pool.query('UPDATE modulos SET sellos = $1 WHERE id = $2',
        [JSON.stringify({ ...config, activo: req.body?.activo === true }), req.moduloId]);
      res.json(config);
    } catch (error) {
      console.error('Error guardando tarjeta de sellos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.post('/api/sellos/sellar', authenticateToken, checkAccess, requiereFuncion('sellos'), async (req, res) => {
    try {
      const r = await sellos.sellarManual(pool, req.moduloId, req.body?.telefono,
        { nombre: req.body?.nombre, usuarioId: req.user.id, cantidad: req.body?.cantidad ?? 1 });
      if (r.error) return res.status(r.status).json({ error: r.error });
      res.status(201).json(r.datos);
    } catch (error) {
      console.error('Error sellando:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.post('/api/sellos/canjear', authenticateToken, checkAccess, async (req, res) => {
    try {
      const r = await sellos.canjear(pool, req.moduloId, req.body?.telefono, req.user.id);
      if (r.error) return res.status(r.status).json({ error: r.error });
      res.json(r.datos);
    } catch (error) {
      console.error('Error entregando premio de sellos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ---- Administración de los juegos (dueño del negocio) ----
  app.get('/api/juegos/admin', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      const [premio, recientes, ganadores] = await Promise.all([
        leerPremio(pool, req.moduloId),
        puntajesRecientes(pool, req.moduloId),
        ganadoresJuegos(pool, req.moduloId)
      ]);
      const { rows: [m] } = await pool.query('SELECT premio_juegos FROM modulos WHERE id = $1', [req.moduloId]);
      res.json({ premio: { ...premio, activo: m?.premio_juegos?.activo === true }, recientes, ganadores });
    } catch (error) {
      console.error('Error leyendo administración de juegos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.put('/api/juegos/admin/premio', authenticateToken, checkAccess, requireAdmin, requiereFuncion('juegos'), async (req, res) => {
    try {
      const descripcion = String(req.body?.descripcion || '').trim().slice(0, 120);
      const activo = req.body?.activo === true;
      if (activo && !descripcion) return res.status(400).json({ error: 'Escribe cuál es el premio' });
      await pool.query('UPDATE modulos SET premio_juegos = $1 WHERE id = $2', [JSON.stringify({ activo, descripcion }), req.moduloId]);
      res.json({ activo, descripcion });
    } catch (error) {
      console.error('Error guardando premio de juegos:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Ocultar (o volver a mostrar) un puntaje del podio: nombres feos o trampas.
  // "todos_del_nombre" oculta todos los puntajes con ese mismo nombre.
  app.put('/api/juegos/admin/puntajes/:id', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      const oculto = req.body?.oculto !== false;
      const { rows: [fila] } = await pool.query('SELECT id, nombre FROM juego_puntajes WHERE id = $1 AND modulo_id = $2', [req.params.id, req.moduloId]);
      if (!fila) return res.status(404).json({ error: 'Puntaje no encontrado' });
      const { rowCount } = req.body?.todos_del_nombre
        ? await pool.query('UPDATE juego_puntajes SET oculto = $1 WHERE modulo_id = $2 AND lower(nombre) = lower($3)', [oculto, req.moduloId, fila.nombre])
        : await pool.query('UPDATE juego_puntajes SET oculto = $1 WHERE id = $2', [oculto, fila.id]);
      res.json({ ok: true, afectados: rowCount });
    } catch (error) {
      console.error('Error moderando puntaje:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.post('/api/juegos/admin/canjear', authenticateToken, checkAccess, async (req, res) => {
    try {
      const r = await canjearPremio(pool, req.moduloId, req.body?.codigo);
      if (r.error) return res.status(r.status).json({ error: r.error });
      res.json(r.datos);
    } catch (error) {
      console.error('Error canjeando premio:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  return { juegosActivos };
};
