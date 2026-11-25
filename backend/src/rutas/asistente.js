// Rutas: Asistente automático del menú y pedidos del menú público.
// Movidas desde server.js (secciones: ASISTENTE AUTOMÁTICO DEL MENÚ).
// Reciben ctx con lo que server.js prepara (app, pool, middlewares, helpers)
// y lo que exportan los grupos registrados antes; devuelven lo que otros usan.
module.exports = function registrarRutas(ctx) {
  const {
    crypto, webpush, ahoraColombia, authenticateToken, requireAdmin, checkAccess, geocodificar,
    OpenAI, botDisponible, responderBot, limpiarEstilo, expandirDetalles, sellos, planes, app, pool
  } = ctx;

  // ==================== ASISTENTE AUTOMÁTICO DEL MENÚ ====================
  // Responde preguntas de los clientes en el menú/catálogo público con OpenAI,
  // igual que el agente de Wabot (ver src/helpers/asistenteBot.js). Es público y sin supervisión, así que tiene
  // límites: por persona (IP) en una ventana de tiempo, largo de cada mensaje,
  // historial corto y un tope diario por módulo. Cada pregunta y respuesta
  // queda guardada para que el negocio vea qué preguntan.

  const BOT_LIMITE_POR_IP = 15;            // mensajes por IP...
  const BOT_VENTANA_IP_MS = 10 * 60 * 1000; // ...cada 10 minutos
  const BOT_LIMITE_DIARIO_MODULO = 400;
  const BOT_MAX_CARACTERES = 500;
  const BOT_MAX_HISTORIAL = 10;
  const botUsoPorIp = new Map();

  const ipCliente = (req) =>
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'desconocida';

  const botPermitidoParaIp = (ip) => {
    const ahora = Date.now();
    const recientes = (botUsoPorIp.get(ip) || []).filter(t => ahora - t < BOT_VENTANA_IP_MS);
    if (recientes.length >= BOT_LIMITE_POR_IP) {
      botUsoPorIp.set(ip, recientes);
      return false;
    }
    recientes.push(ahora);
    botUsoPorIp.set(ip, recientes);
    // Limpieza ocasional para que el mapa no crezca sin fin.
    if (botUsoPorIp.size > 5000) {
      for (const [clave, marcas] of botUsoPorIp) {
        if (!marcas.some(t => ahora - t < BOT_VENTANA_IP_MS)) botUsoPorIp.delete(clave);
      }
    }
    return true;
  };

  // Normaliza el historial que manda el navegador: solo user/assistant, texto
  // recortado, los últimos N, empezando en 'user' y terminando en 'user'.
  const limpiarHistorialBot = (mensajes) => {
    if (!Array.isArray(mensajes)) return null;
    let limpio = mensajes
      .filter(m => m && (m.rol === 'user' || m.rol === 'assistant') && typeof m.texto === 'string' && m.texto.trim())
      .map(m => ({ rol: m.rol, texto: m.texto.trim().slice(0, m.rol === 'user' ? BOT_MAX_CARACTERES : 2000) }))
      .slice(-BOT_MAX_HISTORIAL);
    while (limpio.length && limpio[0].rol !== 'user') limpio = limpio.slice(1);
    if (!limpio.length || limpio[limpio.length - 1].rol !== 'user') return null;
    return limpio;
  };

  const cargarContextoBot = async (moduloId) => {
    const moduloResult = await pool.query(
      `SELECT m.id, m.nombre, m.nombre_publico, m.activo, ${planes.sqlTieneDomicilio()} AS tiene_domicilio, m.bot_activo, m.bot_horario,
            m.bot_envio_costo, m.bot_envio_info, m.bot_info_extra, m.bot_estilo,
            n.nombre AS negocio_nombre, n.tipo AS negocio_tipo, n.telefono AS negocio_telefono,
            n.direccion AS negocio_direccion, n.activo AS negocio_activo
     FROM modulos m JOIN negocios n ON n.id = m.negocio_id
     WHERE m.id = $1`,
      [moduloId]
    );
    const modulo = moduloResult.rows[0];
    if (!modulo || !modulo.activo || modulo.negocio_activo === false) return null;
    // Mismo criterio de "disponible" que el menú público.
    const productosResult = await pool.query(
      `SELECT p.nombre, p.descripcion, p.precio_venta, p.stock_actual, p.ignora_stock, p.es_novedad,
            c.nombre AS categoria_nombre
     FROM productos p
     LEFT JOIN categorias c ON p.categoria_id = c.id
     WHERE p.modulo_id = $1 AND p.activo = true AND (p.stock_actual > 0 OR p.ignora_stock = true)
     ORDER BY c.nombre NULLS LAST, p.nombre, p.id`,
      [moduloId]
    );
    return { modulo, productos: productosResult.rows };
  };

  app.post('/api/menu/:moduloId/bot', async (req, res) => {
    const { moduloId } = req.params;
    if (!/^\d+$/.test(moduloId)) {
      return res.status(404).json({ error: 'Asistente no disponible' });
    }

    const sesion = typeof req.body.sesion === 'string' ? req.body.sesion.slice(0, 64) : 'sin-sesion';
    const historial = limpiarHistorialBot(req.body.mensajes);
    if (!historial) {
      return res.status(400).json({ error: 'Escribe tu pregunta' });
    }
    const pregunta = historial[historial.length - 1].texto;

    try {
      if (!botDisponible()) {
        return res.status(503).json({ error: 'El asistente no está disponible en este momento' });
      }
      const contexto = await cargarContextoBot(moduloId);
      if (!contexto || !contexto.modulo.bot_activo || !(await planes.moduloIncluye(pool, moduloId, 'asistente'))) {
        return res.status(404).json({ error: 'Asistente no disponible' });
      }
      if (!botPermitidoParaIp(ipCliente(req))) {
        return res.status(429).json({ error: 'Has enviado muchas preguntas seguidas. Espera unos minutos e intenta de nuevo.' });
      }
      const usoHoy = await pool.query(
        `SELECT COUNT(*)::int AS total FROM bot_mensajes WHERE modulo_id = $1 AND fecha >= $2`,
        [moduloId, ahoraColombia().startOf('day').toDate()]
      );
      if (usoHoy.rows[0].total >= BOT_LIMITE_DIARIO_MODULO) {
        return res.status(429).json({ error: 'El asistente alcanzó su límite de hoy. Escríbele directamente al negocio.' });
      }

      const { texto, uso } = await responderBot({
        db: pool,
        ...contexto,
        historial: historial.slice(0, -1),
        pregunta,
        ahora: ahoraColombia().locale('es').format('dddd D [de] MMMM YYYY, h:mm a')
      });

      await pool.query(
        `INSERT INTO bot_mensajes (modulo_id, sesion, pregunta, respuesta, tokens_entrada, tokens_salida)
       VALUES ($1, $2, $3, $4, $5, $6)`,
        [moduloId, sesion, pregunta, texto, uso?.prompt_tokens || null, uso?.completion_tokens || null]
      ).catch(err => console.error('Error guardando mensaje del bot:', err));

      res.json({ respuesta: texto });
    } catch (error) {
      console.error('Error del asistente del menú:', error);
      pool.query(
        'INSERT INTO bot_mensajes (modulo_id, sesion, pregunta, error) VALUES ($1, $2, $3, true)',
        [moduloId, sesion, pregunta]
      ).catch(() => {});
      // Sin saldo en OpenAI no es "ocupado": no sirve reintentar.
      if (error?.code === 'insufficient_quota' || error?.code === 'credit_balance_exhausted') {
        return res.status(503).json({ error: 'El asistente no está disponible en este momento. Escríbele directamente al negocio.' });
      }
      const ocupado = error instanceof OpenAI.RateLimitError || error instanceof OpenAI.InternalServerError
        || error instanceof OpenAI.APIConnectionError;
      res.status(ocupado ? 503 : 500).json({
        error: ocupado
          ? 'El asistente está ocupado. Intenta de nuevo en un momento.'
          : 'El asistente no pudo responder. Intenta de nuevo o escríbele directamente al negocio.'
      });
    }
  });

  // Configuración del asistente (admin): textos que usa para responder y las
  // últimas preguntas que le han hecho.
  app.get('/api/modulos/:id/bot', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT m.bot_activo, m.bot_horario, m.bot_envio_costo, m.bot_envio_info, m.bot_info_extra, m.bot_estilo, m.tiene_domicilio
       FROM modulos m WHERE m.id = $1 AND m.negocio_id = $2`,
        [req.params.id, req.negocioId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Módulo no encontrado' });
      }
      const [ultimas, hoy] = await Promise.all([
        pool.query(
          `SELECT id, pregunta, respuesta, error, fecha FROM bot_mensajes
         WHERE modulo_id = $1 ORDER BY fecha DESC LIMIT 30`,
          [req.params.id]
        ),
        pool.query(
          `SELECT COUNT(*)::int AS total FROM bot_mensajes WHERE modulo_id = $1 AND fecha >= $2`,
          [req.params.id, ahoraColombia().startOf('day').toDate()]
        )
      ]);
      const c = result.rows[0];
      res.json({
        ...c,
        bot_envio_costo: c.bot_envio_costo === null ? null : Number(c.bot_envio_costo),
        bot_estilo: limpiarEstilo(c.bot_estilo),
        disponible: botDisponible(),
        preguntas_hoy: hoy.rows[0].total,
        limite_diario: BOT_LIMITE_DIARIO_MODULO,
        ultimas: ultimas.rows
      });
    } catch (error) {
      console.error('Error obteniendo configuración del asistente:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.put('/api/modulos/:id/bot', authenticateToken, checkAccess, requireAdmin, async (req, res) => {
    try {
      if (req.body.bot_activo === true && !(await planes.moduloIncluye(pool, req.params.id, 'asistente'))) {
        const plan = await planes.planDeModulo(pool, req.params.id);
        return res.status(403).json({ error: planes.mensajeBloqueo(plan, 'asistente') });
      }
      const texto = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
      let costo = null;
      if (req.body.bot_envio_costo !== null && req.body.bot_envio_costo !== undefined && req.body.bot_envio_costo !== '') {
        costo = Number(req.body.bot_envio_costo);
        if (!Number.isFinite(costo) || costo < 0) {
          return res.status(400).json({ error: 'El costo del domicilio debe ser un número mayor o igual a cero' });
        }
      }
      const result = await pool.query(
        `UPDATE modulos
       SET bot_activo = $1, bot_horario = $2, bot_envio_costo = $3, bot_envio_info = $4, bot_info_extra = $5, bot_estilo = $6
       WHERE id = $7 AND negocio_id = $8
       RETURNING bot_activo, bot_horario, bot_envio_costo, bot_envio_info, bot_info_extra, bot_estilo`,
        [!!req.body.bot_activo, texto(req.body.bot_horario, 300), costo,
          texto(req.body.bot_envio_info, 1500), texto(req.body.bot_info_extra, 3000), JSON.stringify(limpiarEstilo(req.body.bot_estilo)),
          req.params.id, req.negocioId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Módulo no encontrado' });
      }
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error guardando configuración del asistente:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Geocodifica la dirección de un pedido a domicilio y guarda lat/lng si
  // Nominatim la encontró. Igual que enviarNotificacionesPedidoNuevo, se
  // llama SIN await después de responder al cliente (fire-and-forget): la
  // geocodificación puede tardar (cola de Nominatim) o fallar, y ninguna de
  // las dos cosas debe demorar ni tumbar la creación/edición del pedido,
  // que ya quedó confirmada en la BD sin coordenadas.
  async function geocodificarYGuardarPedido(pedidoId, direccion) {
    const coords = await geocodificar(direccion);
    if (!coords) return;

    await pool.query(
      'UPDATE pedidos_cliente SET lat = $1, lng = $2 WHERE id = $3',
      [coords.lat, coords.lng, pedidoId]
    );
  }

  // Crear pedido de cliente. NO descuenta stock todavía (eso pasa en la
  // Tanda 3, cuando el negocio lo completa) — solo valida que alcance.
  // Envía un push a cada admin/trabajador del negocio suscrito, avisando de
  // un pedido nuevo. Se llama SIN await después del COMMIT de la creación
  // del pedido (fire-and-forget): un fallo aquí (VAPID mal configurado, el
  // servicio push caído, etc.) nunca debe poder tumbar la respuesta al
  // cliente ni la creación del pedido, que ya quedó confirmada en la BD.
  async function enviarNotificacionesPedidoNuevo(moduloId, pedido) {
    try {
      const moduloResult = await pool.query(
        'SELECT negocio_id FROM modulos WHERE id = $1',
        [moduloId]
      );
      if (moduloResult.rows.length === 0) return;
      const negocioId = moduloResult.rows[0].negocio_id;

      const suscripcionesResult = await pool.query(
        'SELECT id, endpoint, p256dh, auth FROM push_suscripciones WHERE negocio_id = $1',
        [negocioId]
      );
      if (suscripcionesResult.rows.length === 0) return;

      const payload = JSON.stringify({
        title: '🧾 Nuevo pedido',
        body: `${pedido.mesa_nombre} · $${Number(pedido.total).toLocaleString('es-CO')}`,
        url: '/pedidos-cliente'
      });

      const resultados = await Promise.allSettled(
        suscripcionesResult.rows.map(sub =>
          webpush
            .sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
            .catch(err => {
              err.suscripcionId = sub.id;
              throw err;
            })
        )
      );

      for (const resultado of resultados) {
        if (resultado.status !== 'rejected') continue;
        const error = resultado.reason;
        if (error.statusCode === 410) {
          // 410 Gone: el navegador revocó esta suscripción, ya no sirve.
          await pool.query('DELETE FROM push_suscripciones WHERE id = $1', [error.suscripcionId]).catch(() => {});
        } else {
          console.error('Error enviando notificación push:', error.body || error.message);
        }
      }
    } catch (error) {
      console.error('Error enviando notificaciones de pedido nuevo:', error);
    }
  }

  app.post('/api/menu/:moduloId/pedidos', async (req, res) => {
    // client se declara afuera y pool.connect() va DENTRO del try: en una
    // ruta pública sin autenticación, si pool.connect() llega a rechazar
    // (ej. timeout de conexión) y queda fuera del try, la promesa rechazada
    // no la atrapa nada — Node la trata como unhandledRejection y tumba
    // todo el proceso, no solo esta petición.
    let client;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const { moduloId } = req.params;
      const { mesa_nombre, telefono, monto_recibido, items, es_domicilio, direccion_entrega, lat, lng } = req.body;

      if (!/^\d+$/.test(moduloId)) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Menú no disponible' });
      }

      const moduloResult = await client.query(
        `SELECT m.id, m.activo, ${planes.sqlTieneDomicilio()} AS tiene_domicilio FROM modulos m WHERE m.id = $1`,
        [moduloId]
      );
      if (moduloResult.rows.length === 0 || moduloResult.rows[0].activo === false) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Menú no disponible' });
      }

      if (!mesa_nombre || !mesa_nombre.trim()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Ingresa tu nombre' });
      }

      if (!telefono || !telefono.trim()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Ingresa un número de teléfono' });
      }

      if (es_domicilio && !moduloResult.rows[0].tiene_domicilio) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Este negocio no tiene domicilio disponible' });
      }

      if (!Array.isArray(items) || items.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'El pedido debe tener al menos un producto' });
      }

      let montoRecibidoValido = null;
      if (monto_recibido !== undefined && monto_recibido !== null && monto_recibido !== '') {
        const val = Number(monto_recibido);
        if (!Number.isFinite(val) || val < 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Monto recibido inválido' });
        }
        montoRecibidoValido = val;
      }

      // Si es domicilio, la dirección es obligatoria (sin ella el negocio no
      // sabe dónde llevarlo). lat/lng vienen del pin que el cliente confirmó
      // en el mapa del checkout (SelectorDireccionMapa) — si por lo que sea
      // no llegan (frontend viejo en caché, mapa no cargó, etc.), quedan en
      // null y las rellena el geocodificarYGuardarPedido de respaldo más
      // abajo, igual que antes de este cambio.
      const esDomicilio = !!es_domicilio;
      let direccionEntregaValida = null;
      let latValida = null;
      let lngValida = null;
      if (esDomicilio) {
        if (!direccion_entrega || !direccion_entrega.trim()) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'La dirección de entrega es requerida para pedidos a domicilio' });
        }
        direccionEntregaValida = direccion_entrega.trim();

        if (lat !== undefined && lat !== null && lng !== undefined && lng !== null) {
          const latNum = Number(lat);
          const lngNum = Number(lng);
          if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
            latValida = latNum;
            lngValida = lngNum;
          }
        }
      }

      const detallesValidados = [];
      let subtotal = 0;
      // Unidades pedidas por producto, sumando sueltos y dentro de promociones.
      const unidadesPedidas = new Map();

      // Promociones: se desarman en sus productos con el precio especial.
      const itemsSueltos = [];
      for (const item of items) {
        if (item && item.promocion_id) {
          let lineas;
          try {
            lineas = await expandirDetalles(client, moduloId, [item]);
          } catch (e) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: e.message });
          }
          for (const l of lineas) {
            detallesValidados.push(l);
            subtotal += l.subtotal;
            unidadesPedidas.set(l.producto_id, (unidadesPedidas.get(l.producto_id) || 0) + l.cantidad);
          }
        } else {
          itemsSueltos.push(item);
        }
      }

      for (const item of itemsSueltos) {
        const cantidad = Number(item.cantidad);
        if (!Number.isFinite(cantidad) || cantidad <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Cantidad inválida para el producto ${item.producto_id}` });
        }

        // Snapshot del precio_venta ACTUAL: se guarda en el detalle para que
        // si el precio cambia después, este pedido ya hecho no se altere.
        const productoResult = await client.query(
          'SELECT id, nombre, precio_venta, stock_actual, ignora_stock FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true',
          [item.producto_id, moduloId]
        );

        if (productoResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Producto no disponible: ${item.producto_id}` });
        }

        const producto = productoResult.rows[0];
        if (!producto.ignora_stock && cantidad > producto.stock_actual) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: `No hay suficiente stock de "${producto.nombre}". Disponible: ${producto.stock_actual}`
          });
        }

        const precioUnitario = Number(producto.precio_venta);
        const subtotalItem = cantidad * precioUnitario;
        subtotal += subtotalItem;
        unidadesPedidas.set(producto.id, (unidadesPedidas.get(producto.id) || 0) + cantidad);

        detallesValidados.push({
          producto_id: producto.id,
          nombre_producto: producto.nombre,
          cantidad,
          precio_unitario: precioUnitario,
          subtotal: subtotalItem
        });
      }

      // Revisa el stock con el total pedido de cada producto (sueltos + promociones).
      for (const [productoId, unidades] of unidadesPedidas) {
        const { rows: [p] } = await client.query(
          'SELECT nombre, stock_actual, ignora_stock FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true',
          [productoId, moduloId]);
        if (!p) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Uno de los productos ya no está disponible' });
        }
        if (!p.ignora_stock && unidades > p.stock_actual) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `No hay suficiente stock de "${p.nombre}". Disponible: ${p.stock_actual}` });
        }
      }

      const total = subtotal;
      const tokenPublico = crypto.randomBytes(24).toString('hex');

      const pedidoResult = await client.query(
        `INSERT INTO pedidos_cliente (modulo_id, token_publico, mesa_nombre, telefono, monto_recibido, subtotal, total, es_domicilio, direccion_entrega, lat, lng)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
        [moduloId, tokenPublico, mesa_nombre.trim(), telefono.trim(), montoRecibidoValido, subtotal, total, esDomicilio, direccionEntregaValida, latValida, lngValida]
      );

      const pedido = pedidoResult.rows[0];

      for (const detalle of detallesValidados) {
        await client.query(
          `INSERT INTO pedidos_cliente_detalle
         (pedido_cliente_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal, promocion_id, promocion_nombre)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [pedido.id, detalle.producto_id, detalle.nombre_producto, detalle.cantidad, detalle.precio_unitario, detalle.subtotal,
           detalle.promocion_id || null, detalle.promocion_nombre || null]
        );
      }

      await client.query('COMMIT');

      enviarNotificacionesPedidoNuevo(moduloId, pedido).catch(err =>
        console.error('Error inesperado enviando notificaciones push:', err)
      );

      if (esDomicilio && direccionEntregaValida && latValida === null) {
        geocodificarYGuardarPedido(pedido.id, direccionEntregaValida).catch(err =>
          console.error('Error inesperado geocodificando dirección:', err)
        );
      }

      res.status(201).json({ ...pedido, detalles: detallesValidados });
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }
      console.error('Error creando pedido de cliente:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  // Consultar un pedido de cliente por su token público. Incluye el
  // teléfono del negocio (vía modulos -> negocios) para que la confirmación
  // pueda armar el link de WhatsApp sin una segunda llamada.
  app.get('/api/menu/pedido/:token', async (req, res) => {
    try {
      const { token } = req.params;

      const pedidoResult = await pool.query(
        `SELECT pc.*, n.telefono as negocio_telefono, n.nombre as negocio_nombre, n.tipo as negocio_tipo, ${planes.sqlTieneDomicilio()} AS tiene_domicilio,
              COALESCE(m.nombre_publico, m.nombre) AS modulo_nombre_publico
       FROM pedidos_cliente pc
       JOIN modulos m ON pc.modulo_id = m.id
       JOIN negocios n ON m.negocio_id = n.id
       WHERE pc.token_publico = $1`,
        [token]
      );

      if (pedidoResult.rows.length === 0) {
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }

      const detalleResult = await pool.query(
        'SELECT * FROM pedidos_cliente_detalle WHERE pedido_cliente_id = $1 ORDER BY id',
        [pedidoResult.rows[0].id]
      );

      const pedido = pedidoResult.rows[0];
      const tarjetaSellos = await sellos.tarjeta(pool, pedido.modulo_id, pedido.telefono).catch(() => null);
      res.json({
        ...pedido,
        detalles: detalleResult.rows,
        sellos: tarjetaSellos?.config.activo
          ? { ...tarjetaSellos.config, sellos: tarjetaSellos.sellos, premios: tarjetaSellos.premios,
              aplica: Number(pedido.total) >= tarjetaSellos.config.minimo }
          : null
      });
    } catch (error) {
      console.error('Error obteniendo pedido de cliente:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Editar un pedido de cliente (solo si sigue 'pendiente'): reemplaza el
  // detalle completo y revalida stock igual que en la creación.
  // El cliente sube la foto del comprobante de pago (se sube directo a
  // Cloudinary desde su navegador; aquí solo se guarda la URL). Queda "en
  // revisión" hasta que el negocio lo apruebe o rechace.
  app.put('/api/menu/pedido/:token/comprobante', async (req, res) => {
    try {
      const { url } = req.body;
      if (typeof url !== 'string' || !/^https:\/\/res\.cloudinary\.com\//.test(url) || url.length > 500) {
        return res.status(400).json({ error: 'Comprobante inválido' });
      }
      const result = await pool.query(
        `UPDATE pedidos_cliente
       SET comprobante_url = $1, comprobante_estado = 'en_revision', fecha_actualizacion = NOW()
       WHERE token_publico = $2 AND estado IN ('pendiente', 'confirmado')
       RETURNING comprobante_url, comprobante_estado`,
        [url, req.params.token]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Pedido no encontrado o ya fue entregado' });
      }
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Error guardando comprobante:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.put('/api/menu/pedido/:token', async (req, res) => {
    // Mismo motivo que en POST /api/menu/:moduloId/pedidos: pool.connect()
    // va dentro del try para que un fallo de conexión no tumbe el proceso.
    let client;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const { token } = req.params;
      const { mesa_nombre, telefono, monto_recibido, items, es_domicilio, direccion_entrega, lat, lng } = req.body;

      // FOR UPDATE: evita que una edición y, por ejemplo, una cancelación
      // simultánea del mismo pedido se pisen entre sí.
      const pedidoResult = await client.query(
        `SELECT pc.*, ${planes.sqlTieneDomicilio()} AS tiene_domicilio
       FROM pedidos_cliente pc
       JOIN modulos m ON pc.modulo_id = m.id
       WHERE pc.token_publico = $1 FOR UPDATE OF pc`,
        [token]
      );

      if (pedidoResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }

      const pedido = pedidoResult.rows[0];

      if (pedido.estado !== 'pendiente') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Este pedido ya está siendo procesado por el negocio, no se puede editar. Contacta directamente si necesitas cambiarlo'
        });
      }

      if (!mesa_nombre || !mesa_nombre.trim()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Ingresa tu nombre' });
      }

      if (!telefono || !telefono.trim()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Ingresa un número de teléfono' });
      }

      if (es_domicilio && !pedido.tiene_domicilio) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Este negocio no tiene domicilio disponible' });
      }

      if (!Array.isArray(items) || items.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'El pedido debe tener al menos un producto' });
      }

      let montoRecibidoValido = null;
      if (monto_recibido !== undefined && monto_recibido !== null && monto_recibido !== '') {
        const val = Number(monto_recibido);
        if (!Number.isFinite(val) || val < 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Monto recibido inválido' });
        }
        montoRecibidoValido = val;
      }

      // Mismo criterio que POST /api/menu/:moduloId/pedidos.
      const esDomicilio = !!es_domicilio;
      let direccionEntregaValida = null;
      let latValida = null;
      let lngValida = null;
      if (esDomicilio) {
        if (!direccion_entrega || !direccion_entrega.trim()) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'La dirección de entrega es requerida para pedidos a domicilio' });
        }
        direccionEntregaValida = direccion_entrega.trim();

        if (lat !== undefined && lat !== null && lng !== undefined && lng !== null) {
          const latNum = Number(lat);
          const lngNum = Number(lng);
          if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
            latValida = latNum;
            lngValida = lngNum;
          }
        }
      }

      const detallesValidados = [];
      let subtotal = 0;

      for (const item of items) {
        const cantidad = Number(item.cantidad);
        if (!Number.isFinite(cantidad) || cantidad <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Cantidad inválida para el producto ${item.producto_id}` });
        }

        const productoResult = await client.query(
          'SELECT id, nombre, precio_venta, stock_actual, ignora_stock FROM productos WHERE id = $1 AND modulo_id = $2 AND activo = true',
          [item.producto_id, pedido.modulo_id]
        );

        if (productoResult.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Producto no disponible: ${item.producto_id}` });
        }

        const producto = productoResult.rows[0];
        if (!producto.ignora_stock && cantidad > producto.stock_actual) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: `No hay suficiente stock de "${producto.nombre}". Disponible: ${producto.stock_actual}`
          });
        }

        const precioUnitario = Number(producto.precio_venta);
        const subtotalItem = cantidad * precioUnitario;
        subtotal += subtotalItem;

        detallesValidados.push({
          producto_id: producto.id,
          nombre_producto: producto.nombre,
          cantidad,
          precio_unitario: precioUnitario,
          subtotal: subtotalItem
        });
      }

      const total = subtotal;

      await client.query('DELETE FROM pedidos_cliente_detalle WHERE pedido_cliente_id = $1', [pedido.id]);

      for (const detalle of detallesValidados) {
        await client.query(
          `INSERT INTO pedidos_cliente_detalle
         (pedido_cliente_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
          [pedido.id, detalle.producto_id, detalle.nombre_producto, detalle.cantidad, detalle.precio_unitario, detalle.subtotal]
        );
      }

      const actualizado = await client.query(
        `UPDATE pedidos_cliente
       SET mesa_nombre = $1, telefono = $2, monto_recibido = $3, subtotal = $4, total = $5, fecha_actualizacion = NOW(),
           es_domicilio = $6, direccion_entrega = $7, lat = $8, lng = $9
       WHERE id = $10
       RETURNING *`,
        [mesa_nombre.trim(), telefono.trim(), montoRecibidoValido, subtotal, total, esDomicilio, direccionEntregaValida, latValida, lngValida, pedido.id]
      );

      await client.query('COMMIT');

      if (esDomicilio && direccionEntregaValida && latValida === null) {
        geocodificarYGuardarPedido(pedido.id, direccionEntregaValida).catch(err =>
          console.error('Error inesperado geocodificando dirección:', err)
        );
      }

      res.json({ ...actualizado.rows[0], detalles: detallesValidados });
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }
      console.error('Error editando pedido de cliente:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    } finally {
      if (client) client.release();
    }
  });

  // Cancelar un pedido de cliente (solo si no está ya 'completado')
  // Confirmar un pedido de cliente (solo desde 'pendiente'). Es un cambio de
  // estado real, no solo un botón que abre WhatsApp: si el pedido se queda
  // en 'pendiente' tras enviarlo, el cliente podría seguir editándolo
  // después de mandar el mensaje y el negocio nunca se enteraría del cambio
  // (ya vio el mensaje viejo).
  app.put('/api/menu/pedido/:token/confirmar', async (req, res) => {
    try {
      const { token } = req.params;

      const pedidoResult = await pool.query(
        'SELECT * FROM pedidos_cliente WHERE token_publico = $1',
        [token]
      );

      if (pedidoResult.rows.length === 0) {
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }

      const pedido = pedidoResult.rows[0];

      if (pedido.estado !== 'pendiente') {
        return res.status(400).json({
          error: 'Este pedido ya no está pendiente (puede que ya lo hayan cancelado o procesado). Recarga la página para ver su estado actual.'
        });
      }

      const actualizado = await pool.query(
        `UPDATE pedidos_cliente SET estado = 'confirmado', fecha_actualizacion = NOW() WHERE id = $1 RETURNING *`,
        [pedido.id]
      );

      res.json(actualizado.rows[0]);
    } catch (error) {
      console.error('Error confirmando pedido de cliente:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  app.put('/api/menu/pedido/:token/cancelar', async (req, res) => {
    try {
      const { token } = req.params;

      const pedidoResult = await pool.query(
        'SELECT * FROM pedidos_cliente WHERE token_publico = $1',
        [token]
      );

      if (pedidoResult.rows.length === 0) {
        return res.status(404).json({ error: 'Pedido no encontrado' });
      }

      const pedido = pedidoResult.rows[0];

      if (!['pendiente', 'confirmado'].includes(pedido.estado)) {
        return res.status(400).json({ error: 'Este pedido ya no se puede cancelar' });
      }

      const actualizado = await pool.query(
        `UPDATE pedidos_cliente SET estado = 'cancelado', fecha_actualizacion = NOW() WHERE id = $1 RETURNING *`,
        [pedido.id]
      );

      res.json(actualizado.rows[0]);
    } catch (error) {
      console.error('Error cancelando pedido de cliente:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  return { ipCliente };
};
