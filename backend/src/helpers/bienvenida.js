// Asistente de bienvenida: lista de primeros pasos para un negocio nuevo.
// Cada paso se marca solo, mirando los datos reales del negocio (no hay
// que palomearlos a mano), salvo "compartir el menú", que el dueño marca.
// Se guarda en modulos.bienvenida: { oculto, compartido }.

const MIN_PRODUCTOS = 5;

async function estadoBienvenida(pool, moduloId) {
  const { rows: [d] } = await pool.query(
    `SELECT m.nombre_publico, m.foto_portada_url, m.bienvenida,
       (SELECT COUNT(*) FROM productos p WHERE p.modulo_id = m.id AND p.activo = true)::int AS productos,
       (SELECT COUNT(*) FROM productos p WHERE p.modulo_id = m.id AND p.activo = true AND COALESCE(p.precio_compra, 0) > 0)::int AS con_costo,
       (SELECT COUNT(*) FROM proveedores pr WHERE pr.modulo_id = m.id AND pr.activo = true)::int AS proveedores,
       (SELECT COUNT(*) FROM proveedores pr WHERE pr.modulo_id = m.id AND pr.activo = true AND pr.calendario_modo IS NOT NULL)::int AS con_calendario,
       EXISTS (SELECT 1 FROM ventas v WHERE v.modulo_id = m.id AND v.es_ajuste_manual = false) AS hay_venta,
       EXISTS (SELECT 1 FROM pedidos_cliente pc WHERE pc.modulo_id = m.id) AS hay_pedido_menu,
       EXISTS (SELECT 1 FROM push_suscripciones ps
               JOIN usuarios u ON u.id = ps.usuario_id AND u.rol = 'admin' AND u.activo = true
               JOIN usuario_modulos um ON um.usuario_id = u.id AND um.modulo_id = m.id) AS hay_push,
       EXISTS (SELECT 1 FROM cuadres_caja c WHERE c.modulo_id = m.id AND c.bolsillo = 'apertura') AS hay_caja
     FROM modulos m WHERE m.id = $1`,
    [moduloId]);
  if (!d) return null;
  const config = d.bienvenida || {};

  const pasos = [
    {
      id: 'portada', esencial: true, ruta: '/marketing',
      titulo: 'Ponle nombre y foto a tu menú',
      detalle: 'Así te ven tus clientes cuando abren el enlace o escanean el QR.',
      hecho: !!(d.nombre_publico && d.foto_portada_url)
    },
    {
      id: 'productos', esencial: true, ruta: '/productos',
      titulo: `Registra tus productos (${Math.min(d.productos, MIN_PRODUCTOS)}/${MIN_PRODUCTOS})`,
      detalle: 'Con precio de venta y foto. Después puedes seguir agregando.',
      hecho: d.productos >= MIN_PRODUCTOS
    },
    {
      id: 'costos', esencial: true, ruta: '/inventario',
      titulo: 'Escribe cuánto te cuesta cada producto',
      detalle: d.productos > 0
        ? `${d.con_costo} de ${d.productos} tienen precio de compra. Sin eso no se puede calcular tu ganancia.`
        : 'Sin el precio de compra no se puede calcular tu ganancia.',
      hecho: d.productos > 0 && d.con_costo / d.productos >= 0.8
    },
    {
      id: 'proveedores', esencial: true, ruta: '/proveedores',
      titulo: 'Agrega tus proveedores y cuándo les pides',
      detalle: 'Con su día de pedido te recordamos a quién pedirle y te sugerimos cantidades.',
      hecho: d.con_calendario > 0
    },
    {
      id: 'venta', esencial: true, ruta: '/ventas',
      titulo: 'Registra tu primera venta',
      detalle: 'Desde la pantalla de Ventas, con el método de pago.',
      hecho: d.hay_venta
    },
    {
      id: 'compartir', esencial: false, ruta: '/marketing', manual: true,
      titulo: 'Comparte tu menú con tus clientes',
      detalle: 'Descarga el QR o crea un flyer en Marketing y publícalo.',
      hecho: config.compartido === true || d.hay_pedido_menu
    },
    {
      id: 'notificaciones', esencial: false, ruta: '/pedidos-cliente',
      titulo: 'Activa las notificaciones en tu celular',
      detalle: 'Te avisamos de pedidos nuevos, el cierre de caja y el resumen de la semana.',
      hecho: d.hay_push
    },
    {
      id: 'caja', esencial: false, ruta: '/finanzas',
      titulo: 'Abre la caja y los bolsillos',
      detalle: 'Para saber cuánta plata hay en caja, en el banco y en la cartera.',
      hecho: d.hay_caja
    }
  ];

  const hechos = pasos.filter(p => p.hecho).length;
  return {
    oculto: config.oculto === true,
    pasos,
    hechos,
    total: pasos.length,
    esenciales_completos: pasos.filter(p => p.esencial).every(p => p.hecho),
    completo: hechos === pasos.length
  };
}

async function guardarBienvenida(pool, moduloId, cambios) {
  const { rows: [m] } = await pool.query('SELECT bienvenida FROM modulos WHERE id = $1', [moduloId]);
  const actual = m?.bienvenida || {};
  const nuevo = { ...actual };
  if ('oculto' in cambios) nuevo.oculto = cambios.oculto === true;
  if ('compartido' in cambios) nuevo.compartido = cambios.compartido === true;
  await pool.query('UPDATE modulos SET bienvenida = $1 WHERE id = $2', [JSON.stringify(nuevo), moduloId]);
}

module.exports = { estadoBienvenida, guardarBienvenida };
