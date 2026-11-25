// Planes de suscripción por negocio (negocios.plan) y lo que incluye cada
// uno, según la cotización "Planes y funciones del Sistema de Inventario"
// (noviembre 2026). Un negocio sin plan asignado (NULL) queda "sin
// límites", así los negocios que ya existían siguen funcionando igual
// hasta que el super admin les asigne un plan. Para cambiar lo que incluye
// cada plan, edita este archivo: el resto del sistema lo consulta aquí.
//
// Lo que tienen todos los planes (ventas, inventario, conteo físico,
// clientes y fiado, catálogo en línea para recoger, registro de ingresos y
// gastos, estadísticas básicas y reportes en Excel/PDF) no se lista: solo
// las funciones que cambian de un plan a otro.

const FUNCIONES = {
  domicilios: 'Domicilios, ruta de entregas y comprobantes de pago',
  proveedores: 'Calendario de proveedores y sugerencia de pedidos',
  finanzas: 'Caja por bolsillos, cierre de caja, pagos fijos y finanzas del negocio',
  reportes: 'Estadísticas completas (dinero, antes y ahora, clientes en línea)',
  multisede: 'Ventas entre sedes y finanzas consolidadas',
  promociones: 'Promociones y combos',
  marketing: 'Flyers y piezas para redes',
  sellos: 'Tarjeta de sellos para clientes',
  juegos: 'Zona de juegos con podio y premios',
  asistente: 'Asistente automático con IA en el menú'
};

// Precios en pesos colombianos, sin IVA.
const PLANES = {
  emprende: {
    nombre: 'Emprende',
    descripcion: 'Para empezar: vender, controlar el inventario y el fiado, y recibir pedidos en línea para recoger.',
    sedes: 1,
    usuarios: 2,
    soporte: 'WhatsApp, horario laboral',
    precios: { mensual: 49900, semestral: 269400, anual: 499000, licencia: 990000, cuota_licencia: 29900 },
    funciones: ['promociones']
  },
  negocio: {
    nombre: 'Negocio',
    descripcion: 'Todo para una tienda con domicilios: rutas, proveedores, caja por bolsillos y estadísticas completas.',
    recomendado: true,
    sedes: 1,
    usuarios: 5,
    soporte: 'WhatsApp, horario laboral',
    precios: { mensual: 89900, semestral: 485400, anual: 899000, licencia: 1890000, cuota_licencia: 29900 },
    funciones: ['domicilios', 'proveedores', 'finanzas', 'reportes', 'promociones', 'marketing', 'sellos', 'juegos', 'asistente']
  },
  multisede: {
    nombre: 'Multisede',
    descripcion: 'Hasta 3 sedes o módulos en un mismo negocio, con ventas entre sedes y finanzas consolidadas.',
    sedes: 3,
    usuarios: null, // sin límite
    soporte: 'Prioritario, mismo día',
    precios: { mensual: 149900, semestral: 809400, anual: 1499000, licencia: 3290000, cuota_licencia: 49900 },
    funciones: Object.keys(FUNCIONES)
  }
};

// Lo que no depende del plan.
const CONDICIONES = {
  sede_adicional: 39900, // por mes, solo en Multisede
  implementacion: 150000, // una sola vez; gratis con pago anual o licencia
  prueba_dias: 15
};

const SIN_PLAN = {
  id: null,
  nombre: 'Sin límites',
  descripcion: 'Este negocio todavía no tiene un plan asignado: tiene todo incluido.',
  sedes: null,
  usuarios: null,
  funciones: Object.keys(FUNCIONES)
};

// sedesExtra: sedes adicionales compradas aparte (negocios.sedes_extra).
const planPorId = (id, sedesExtra = 0) => {
  if (!id || !PLANES[id]) return SIN_PLAN;
  const plan = { id, ...PLANES[id] };
  const extra = Number(sedesExtra) || 0;
  if (id === 'multisede' && extra > 0) return { ...plan, sedes: plan.sedes + extra, sedes_extra: extra };
  return plan;
};

const leerPlan = (n) => planPorId(n?.plan, n?.sedes_extra);

// sedes_extra llega con la migración 010; si aún no corre, se lee sin ella.
async function consultarPlan(db, sql, params) {
  try {
    return (await db.query(sql, params)).rows[0];
  } catch (err) {
    if (!/sedes_extra/.test(err.message)) throw err;
    return (await db.query(sql.replace(', n.sedes_extra', ''), params)).rows[0];
  }
}

const planDeNegocio = async (db, negocioId) =>
  leerPlan(await consultarPlan(db, 'SELECT n.plan, n.sedes_extra FROM negocios n WHERE n.id = $1', [negocioId]));

const planDeModulo = async (db, moduloId) =>
  leerPlan(await consultarPlan(db,
    'SELECT n.plan, n.sedes_extra FROM modulos m JOIN negocios n ON n.id = m.negocio_id WHERE m.id = $1', [moduloId]));

const incluye = (plan, funcion) => plan.funciones.includes(funcion);

// Si falla la consulta (ej. la migración no ha corrido), no bloquea nada.
async function moduloIncluye(db, moduloId, funcion) {
  try {
    return incluye(await planDeModulo(db, moduloId), funcion);
  } catch {
    return true;
  }
}

const mensajeBloqueo = (plan, funcion) => {
  const sugerido = Object.entries(PLANES).find(([, p]) => p.funciones.includes(funcion));
  return `${FUNCIONES[funcion] || 'Esta función'} no está incluida en el plan ${plan.nombre}` +
    (sugerido ? `. Está disponible desde el plan ${sugerido[1].nombre}.` : '.');
};

// Middleware: responde 403 si el plan del negocio no incluye la función.
// Va después de checkAccess (usa req.negocioId o req.moduloId). El super
// admin no se bloquea, y si no se puede leer el plan tampoco.
const requierePlan = (db, funcion) => async (req, res, next) => {
  if (req.user?.rol === 'super_admin') return next();
  try {
    const plan = req.negocioId ? await planDeNegocio(db, req.negocioId)
      : req.moduloId ? await planDeModulo(db, req.moduloId) : null;
    if (plan && !incluye(plan, funcion)) {
      return res.status(403).json({ error: mensajeBloqueo(plan, funcion), plan_bloqueado: funcion });
    }
  } catch { /* no bloquea */ }
  next();
};

// Expresión SQL: true si el negocio (por su id) tiene la función en su plan.
const sqlNegocioIncluye = (funcion, negocioId) => {
  const ids = Object.entries(PLANES).filter(([, p]) => p.funciones.includes(funcion)).map(([id]) => `'${id}'`);
  return `COALESCE((SELECT np.plan IS NULL${ids.length ? ` OR np.plan IN (${ids.join(', ')})` : ''} FROM negocios np WHERE np.id = ${negocioId}), true)`;
};

// tiene_domicilio "efectivo" de un módulo (alias m): lo que configuró el
// negocio, siempre que su plan incluya domicilios.
const sqlTieneDomicilio = (m = 'm') => `(${m}.tiene_domicilio AND ${sqlNegocioIncluye('domicilios', `${m}.negocio_id`)})`;

// Uso actual frente a los límites del plan.
async function usoDelNegocio(db, negocioId) {
  const [plan, { rows: [uso] }] = await Promise.all([
    planDeNegocio(db, negocioId),
    db.query(
      `SELECT (SELECT COUNT(*) FROM modulos WHERE negocio_id = $1 AND activo = true)::int AS sedes,
              (SELECT COUNT(*) FROM usuarios WHERE negocio_id = $1 AND activo = true)::int AS usuarios`,
      [negocioId])
  ]);
  return { plan, uso };
}

// Para crear sedes o usuarios: { error } si se pasa del límite.
async function verificarLimite(db, negocioId, recurso) {
  const { plan, uso } = await usoDelNegocio(db, negocioId);
  const limite = plan[recurso];
  if (limite !== null && uso[recurso] >= limite) {
    const nombre = recurso === 'sedes' ? (limite === 1 ? 'sede' : 'sedes') : (limite === 1 ? 'usuario' : 'usuarios');
    const como = plan.id === 'multisede' && recurso === 'sedes'
      ? ` Cada sede adicional cuesta $${CONDICIONES.sede_adicional.toLocaleString('es-CO')} al mes.`
      : ' Cambia el plan del negocio para agregar más.';
    return { error: `El plan ${plan.nombre} permite hasta ${limite} ${nombre}.${como}` };
  }
  return {};
}

module.exports = {
  FUNCIONES, PLANES, CONDICIONES, planPorId, planDeNegocio, planDeModulo, incluye, moduloIncluye,
  mensajeBloqueo, usoDelNegocio, verificarLimite, requierePlan, sqlNegocioIncluye, sqlTieneDomicilio
};
