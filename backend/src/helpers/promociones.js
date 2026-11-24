// Promociones (combos): dos o más productos juntos a un precio especial.
//
// Al venderse, una promoción se "desarma" en sus productos: cada uno queda
// como una línea normal de la venta (descuenta su stock, cuenta para su
// dueño, su costo y sus estadísticas) y el precio especial se reparte entre
// ellos según lo que vale cada uno normalmente. Cada línea queda marcada con
// promocion_id / promocion_nombre para saber de qué combo salió.

const num = (x) => (x === null || x === undefined ? 0 : Number(x));
const hoyColombia = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);

const vigente = (p, hoy = hoyColombia()) => {
  const inicio = p.fecha_inicio ? String(p.fecha_inicio).slice(0, 10) : null;
  const fin = p.fecha_fin ? String(p.fecha_fin).slice(0, 10) : null;
  return (!inicio || inicio <= hoy) && (!fin || fin >= hoy);
};

// Lista las promociones de un módulo con sus productos, el precio normal,
// el ahorro y cuántas se pueden vender con el stock actual.
async function cargarPromociones(db, moduloId, { soloDisponibles = false } = {}) {
  const { rows: promos } = await db.query(
    `SELECT id, nombre, descripcion, precio, foto_url, activo,
            to_char(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
            to_char(fecha_fin, 'YYYY-MM-DD') AS fecha_fin
     FROM promociones WHERE modulo_id = $1 ORDER BY activo DESC, nombre`,
    [moduloId]);
  if (promos.length === 0) return [];

  const { rows: items } = await db.query(
    `SELECT pi.promocion_id, pi.producto_id, pi.cantidad, p.nombre, p.precio_venta, p.precio_compra,
            p.stock_actual, p.ignora_stock, p.activo, p.foto_url
     FROM promocion_items pi JOIN productos p ON p.id = pi.producto_id
     WHERE pi.promocion_id = ANY($1::int[])
     ORDER BY pi.id`,
    [promos.map(p => p.id)]);

  const hoy = hoyColombia();
  const lista = promos.map(p => {
    const suyos = items.filter(i => i.promocion_id === p.id);
    const precioNormal = suyos.reduce((s, i) => s + num(i.precio_venta) * i.cantidad, 0);
    const costo = suyos.reduce((s, i) => s + num(i.precio_compra) * i.cantidad, 0);
    const conStock = suyos.filter(i => !i.ignora_stock);
    const disponibles = suyos.some(i => !i.activo)
      ? 0
      : conStock.length === 0 ? 99 : Math.min(...conStock.map(i => Math.floor(num(i.stock_actual) / i.cantidad)));
    return {
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion,
      precio: num(p.precio),
      foto_url: p.foto_url,
      activo: p.activo,
      fecha_inicio: p.fecha_inicio,
      fecha_fin: p.fecha_fin,
      vigente: vigente(p, hoy),
      precio_normal: Math.round(precioNormal),
      ahorro: Math.max(0, Math.round(precioNormal - num(p.precio))),
      ahorro_pct: precioNormal > 0 ? Math.round(((precioNormal - num(p.precio)) / precioNormal) * 100) : 0,
      // Margen del combo con los costos registrados (para el negocio).
      ganancia: costo > 0 ? Math.round(num(p.precio) - costo) : null,
      disponibles: Math.max(0, disponibles),
      items: suyos.map(i => ({
        producto_id: i.producto_id,
        nombre: i.nombre,
        cantidad: i.cantidad,
        precio_venta: num(i.precio_venta),
        foto_url: i.foto_url
      }))
    };
  });
  return soloDisponibles ? lista.filter(p => p.activo && p.vigente && p.disponibles > 0) : lista;
}

// Convierte "N unidades de la promoción X" en las líneas de sus productos
// con el precio repartido. Lanza un Error con mensaje para el usuario si la
// promoción no existe, está apagada o vencida.
async function expandirPromocion(db, moduloId, promocionId, cantidad) {
  const n = Number(cantidad);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('Cantidad inválida para la promoción');
  }
  const { rows: [promo] } = await db.query(
    `SELECT id, nombre, precio, activo,
            to_char(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, to_char(fecha_fin, 'YYYY-MM-DD') AS fecha_fin
     FROM promociones WHERE id = $1 AND modulo_id = $2`,
    [promocionId, moduloId]);
  if (!promo || !promo.activo || !vigente(promo)) {
    throw new Error('Esta promoción ya no está disponible');
  }
  const { rows: items } = await db.query(
    `SELECT pi.producto_id, pi.cantidad, p.nombre, p.precio_venta
     FROM promocion_items pi JOIN productos p ON p.id = pi.producto_id
     WHERE pi.promocion_id = $1 ORDER BY pi.id`,
    [promo.id]);
  if (items.length === 0) {
    throw new Error('Esta promoción no tiene productos');
  }

  // Reparto del precio de UNA promoción entre sus productos, proporcional a
  // su precio normal; el último absorbe el redondeo para que sume exacto.
  const precio = num(promo.precio);
  const pesoTotal = items.reduce((s, i) => s + num(i.precio_venta) * i.cantidad, 0);
  let asignado = 0;
  return items.map((item, idx) => {
    const peso = pesoTotal > 0 ? (num(item.precio_venta) * item.cantidad) / pesoTotal : 1 / items.length;
    const parte = idx === items.length - 1 ? precio - asignado : Math.round(precio * peso);
    asignado += parte;
    const unidades = item.cantidad * n;
    return {
      producto_id: item.producto_id,
      nombre_producto: item.nombre,
      cantidad: unidades,
      precio_unitario: Math.round((parte / item.cantidad) * 100) / 100,
      subtotal: parte * n,
      promocion_id: promo.id,
      promocion_nombre: promo.nombre
    };
  });
}

// Recibe los detalles de una venta o pedido (productos sueltos y/o
// { promocion_id, cantidad }) y devuelve solo líneas de productos.
async function expandirDetalles(db, moduloId, detalles) {
  const resultado = [];
  for (const d of detalles) {
    if (d && d.promocion_id) {
      resultado.push(...await expandirPromocion(db, moduloId, d.promocion_id, d.cantidad));
    } else {
      resultado.push(d);
    }
  }
  return resultado;
}

// Valida y limpia lo que llega del formulario de promociones.
function limpiarPromocion(body) {
  const nombre = String(body.nombre || '').trim().slice(0, 120);
  if (!nombre) return { error: 'Ponle un nombre a la promoción' };
  const precio = Math.round(Number(body.precio));
  if (!Number.isFinite(precio) || precio <= 0) return { error: 'El precio de la promoción debe ser mayor a 0' };
  const vistos = new Map();
  for (const i of Array.isArray(body.items) ? body.items : []) {
    const productoId = Number(i.producto_id);
    const cantidad = Number(i.cantidad);
    if (!Number.isInteger(productoId) || !Number.isInteger(cantidad) || cantidad <= 0) continue;
    vistos.set(productoId, (vistos.get(productoId) || 0) + cantidad);
  }
  const items = Array.from(vistos.entries()).map(([producto_id, cantidad]) => ({ producto_id, cantidad }));
  const unidades = items.reduce((s, i) => s + i.cantidad, 0);
  if (items.length === 0 || unidades < 2) return { error: 'Una promoción debe tener al menos 2 unidades (por ejemplo, dos productos distintos o 2 del mismo)' };
  const fecha = (f) => (/^\d{4}-\d{2}-\d{2}$/.test(String(f || '')) ? f : null);
  const inicio = fecha(body.fecha_inicio);
  const fin = fecha(body.fecha_fin);
  if (inicio && fin && fin < inicio) return { error: 'La fecha final no puede ser antes de la inicial' };
  return {
    datos: {
      nombre,
      descripcion: String(body.descripcion || '').trim().slice(0, 500) || null,
      precio,
      foto_url: /^https:\/\//.test(String(body.foto_url || '')) ? String(body.foto_url).slice(0, 500) : null,
      activo: body.activo !== false,
      fecha_inicio: inicio,
      fecha_fin: fin,
      items
    }
  };
}

module.exports = { cargarPromociones, expandirPromocion, expandirDetalles, limpiarPromocion };
