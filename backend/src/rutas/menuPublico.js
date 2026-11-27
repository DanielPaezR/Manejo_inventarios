// Rutas: Menú público (sin sesión).
// Movidas desde server.js (secciones: RUTAS DE MENÚ PÚBLICO (SIN AUTENTICACIÓN)).
// Reciben ctx con lo que server.js prepara (app, pool, middlewares, helpers)
// y lo que exportan los grupos registrados antes; devuelven lo que otros usan.
module.exports = function registrarRutas(ctx) {
  const {
    geocodificar, botDisponible, limpiarEstilo, cargarPromociones, sellos, planes, app, pool
  } = ctx;
  // Definidos en grupos que se registran después: se buscan al usarlos.
  const juegosActivos = (...args) => ctx.juegosActivos(...args);

  // ==================== RUTAS DE MENÚ PÚBLICO (SIN AUTENTICACIÓN) ====================
  // A propósito SIN authenticateToken/checkAccess: son para clientes sin
  // cuenta que escanean un QR. Usan el moduloId de la URL, nunca req.moduloId
  // (que depende de la sesión de un usuario logueado). Tanda 2 de 3 del
  // "Menú QR" — la Tanda 3 (panel del negocio, completar pedido con
  // descuento de stock real) viene en un cambio aparte.

  // Geocodifica una dirección escrita a mano en el checkout del menú público,
  // para que el cliente pueda confirmar/ajustar el pin en un mapa ANTES de
  // enviar el pedido (a diferencia de geocodificarYGuardarPedido más abajo,
  // que corre después y en silencio). Proxy delgado al mismo geocodificar()
  // — necesario porque Nominatim exige un User-Agent identificable que un
  // fetch de navegador no puede fijar, y así se respeta la misma cola/
  // rate-limit ya construida ahí en vez de duplicarla en el frontend.
  // IMPORTANTE: esta ruta debe ir ANTES de '/api/menu/:moduloId' — si no,
  // Express la matchea contra esa ruta con moduloId="geocodificar" primero
  // y nunca llega aquí (probado en carne propia: devolvía 404 "Menú no
  // disponible" en vez de geocodificar).
  app.get('/api/menu/geocodificar', async (req, res) => {
    try {
      const { direccion } = req.query;
      if (!direccion || !direccion.trim()) {
        return res.status(400).json({ error: 'Falta la dirección' });
      }
      // Cerca del local del negocio (si lo configuró): sin esto, "Calle 10
      // # 20-30" cae en la Calle 10 de cualquier ciudad (casi siempre Bogotá).
      const cerca = { lat: Number(req.query.cerca_lat), lng: Number(req.query.cerca_lng) };
      const conCerca = req.query.cerca_lat && Number.isFinite(cerca.lat) && Number.isFinite(cerca.lng);

      const coords = await geocodificar(direccion.trim(), conCerca ? { cerca } : {});
      if (!coords) {
        return res.status(404).json({ error: 'No se pudo ubicar esa dirección' });
      }

      res.json(coords);
    } catch (error) {
      console.error('Error geocodificando dirección (menú público):', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Número y enlace con nombre de un menú (para las páginas del cliente que
  // solo tienen lo que viene en la dirección, ej. "Mis pedidos").
  app.get('/api/menu/:moduloId/id', async (req, res) => {
    try {
      if (!/^\d+$/.test(req.params.moduloId)) return res.status(404).json({ error: 'Menú no disponible' });
      const { rows: [m] } = await pool.query('SELECT id, slug FROM modulos WHERE id = $1 AND activo = true', [req.params.moduloId]);
      if (!m) return res.status(404).json({ error: 'Menú no disponible' });
      res.json(m);
    } catch (error) {
      console.error('Error resolviendo menú:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Menú público: solo productos activos con stock disponible, sin datos
  // internos (precio_compra, codigo_ean, etc.)
  app.get('/api/menu/:moduloId', async (req, res) => {
    try {
      const { moduloId } = req.params;

      if (!/^\d+$/.test(moduloId)) {
        return res.status(404).json({ error: 'Menú no disponible' });
      }

      const moduloResult = await pool.query(
        `SELECT m.id, m.nombre, m.nombre_publico, m.activo, m.foto_portada_url, ${planes.sqlTieneDomicilio()} AS tiene_domicilio, m.bot_activo, m.bot_estilo,
              m.ubicacion_lat, m.ubicacion_lng, m.slug,
              m.bot_horario, m.bot_envio_costo,
              n.nombre as negocio_nombre, n.tipo as negocio_tipo
       FROM modulos m
       JOIN negocios n ON m.negocio_id = n.id
       WHERE m.id = $1`,
        [moduloId]
      );

      if (moduloResult.rows.length === 0 || moduloResult.rows[0].activo === false) {
        return res.status(404).json({ error: 'Menú no disponible' });
      }

      const productosResult = await pool.query(
        `SELECT p.id, p.nombre, p.descripcion, p.precio_venta, p.stock_actual, p.foto_url, p.es_novedad, p.ignora_stock,
              c.nombre as categoria_nombre
       FROM productos p
       LEFT JOIN categorias c ON p.categoria_id = c.id
       WHERE p.modulo_id = $1 AND p.activo = true AND (p.stock_actual > 0 OR p.ignora_stock = true)
       ORDER BY c.nombre NULLS LAST, p.nombre`,
        [moduloId]
      );

      res.json({
        modulo: {
          id: moduloResult.rows[0].id,
          // Enlace con nombre (/menu/elixir): el menú se cambia a él si
          // entraron con el número.
          slug: moduloResult.rows[0].slug || null,
          nombre: moduloResult.rows[0].nombre,
          // nombre_publico es el nombre de marca que ve el cliente en el menú
          // (ej. "Cositas de Ana"); si el módulo no lo configuró, cae al
          // nombre interno de gestión — así el menú nunca queda sin título.
          nombre_publico: moduloResult.rows[0].nombre_publico || moduloResult.rows[0].nombre,
          negocio_nombre: moduloResult.rows[0].negocio_nombre,
          foto_portada_url: moduloResult.rows[0].foto_portada_url,
          tiene_domicilio: moduloResult.rows[0].tiene_domicilio,
          // Dónde queda el local: centro del mapa al elegir la dirección.
          ubicacion: moduloResult.rows[0].ubicacion_lat !== null && moduloResult.rows[0].ubicacion_lat !== undefined
            ? { lat: Number(moduloResult.rows[0].ubicacion_lat), lng: Number(moduloResult.rows[0].ubicacion_lng) }
            : null,
          negocio_tipo: moduloResult.rows[0].negocio_tipo,
          // Datos que el negocio llenó en la configuración del asistente; la
          // portada del menú los muestra aunque el asistente esté apagado.
          horario: moduloResult.rows[0].bot_horario || null,
          envio_costo: moduloResult.rows[0].bot_envio_costo !== null && moduloResult.rows[0].bot_envio_costo !== undefined
            ? Number(moduloResult.rows[0].bot_envio_costo) : null,
          // El asistente solo aparece si el negocio lo encendió y el servidor
          // tiene la clave de la API configurada.
          bot_activo: moduloResult.rows[0].bot_activo && botDisponible() && await planes.moduloIncluye(pool, moduloId, 'asistente'),
          // Nombre y saludo que el negocio eligió para su asistente.
          bot_nombre: limpiarEstilo(moduloResult.rows[0].bot_estilo).nombre_asistente || null,
          bot_saludo: limpiarEstilo(moduloResult.rows[0].bot_estilo).saludo || null,
          juegos_activos: await juegosActivos(moduloId),
          sellos: await sellos.configDe(pool, moduloId).then(c => (c.activo ? c : null)).catch(() => null)
        },
        productos: productosResult.rows,
        // Si la tabla de promociones aún no existe, el menú sigue funcionando.
        promociones: await planes.moduloIncluye(pool, moduloId, 'promociones')
          ? await cargarPromociones(pool, moduloId, { soloDisponibles: true }).catch(() => [])
          : []
      });
    } catch (error) {
      console.error('Error obteniendo menú público:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  return {};
};
