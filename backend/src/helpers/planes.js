// Planes de suscripción por negocio (negocios.plan) y lo que incluye cada
// uno. Un negocio sin plan asignado (NULL) queda "sin límites", así los
// negocios que ya existían siguen funcionando igual hasta que el super
// admin les asigne un plan. Para cambiar lo que incluye cada plan, edita
// este archivo: el resto del sistema lo consulta aquí.

const FUNCIONES = {
  asistente: 'Asistente automático con IA en el menú',
  juegos: 'Zona de juegos con podio y premios',
  sellos: 'Tarjeta de sellos para clientes',
  promociones: 'Promociones y combos',
  marketing: 'Flyers y piezas para redes'
};

const PLANES = {
  emprende: {
    nombre: 'Emprende',
    descripcion: 'Para empezar: vender, controlar el inventario y recibir pedidos en línea.',
    sedes: 1,
    usuarios: 3,
    funciones: ['promociones']
  },
  negocio: {
    nombre: 'Negocio',
    descripcion: 'Todo para que los clientes vuelvan: sellos, juegos, marketing y asistente.',
    sedes: 1,
    usuarios: 10,
    funciones: ['promociones', 'marketing', 'sellos', 'juegos', 'asistente']
  },
  multisede: {
    nombre: 'Multisede',
    descripcion: 'Varias sedes o módulos en un mismo negocio, con todo incluido.',
    sedes: null, // sin límite
    usuarios: null,
    funciones: Object.keys(FUNCIONES)
  }
};

const SIN_PLAN = {
  id: null,
  nombre: 'Sin límites',
  descripcion: 'Este negocio todavía no tiene un plan asignado: tiene todo incluido.',
  sedes: null,
  usuarios: null,
  funciones: Object.keys(FUNCIONES)
};

const planPorId = (id) => (id && PLANES[id] ? { id, ...PLANES[id] } : SIN_PLAN);

async function planDeNegocio(db, negocioId) {
  const { rows: [n] } = await db.query('SELECT plan FROM negocios WHERE id = $1', [negocioId]);
  return planPorId(n?.plan);
}

async function planDeModulo(db, moduloId) {
  const { rows: [n] } = await db.query(
    'SELECT n.plan FROM modulos m JOIN negocios n ON n.id = m.negocio_id WHERE m.id = $1', [moduloId]);
  return planPorId(n?.plan);
}

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
    return { error: `El plan ${plan.nombre} permite hasta ${limite} ${nombre}. Cambia el plan del negocio para agregar más.` };
  }
  return {};
}

module.exports = { FUNCIONES, PLANES, planPorId, planDeNegocio, planDeModulo, incluye, moduloIncluye, mensajeBloqueo, usoDelNegocio, verificarLimite };
