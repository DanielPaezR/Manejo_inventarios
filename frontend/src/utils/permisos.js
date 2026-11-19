// Secciones extra que el administrador puede habilitarle a cada trabajador
// (ver "Tu equipo" en Configuración). Las claves coinciden con
// PERMISOS_TRABAJADOR en backend/server.js.
export const PERMISOS = [
  { clave: 'productos', titulo: 'Productos', descripcion: 'Crear, editar y borrar productos y categorías', rutas: ['/productos'] },
  { clave: 'inventario', titulo: 'Inventario', descripcion: 'Agregar mercancía, ajustar stock y hacer conteos', rutas: ['/inventario'] },
  { clave: 'proveedores', titulo: 'Proveedores y pedidos', descripcion: 'Gestionar proveedores y pedidos (Mis pedidos)', rutas: ['/proveedores', '/pedidos'] },
  { clave: 'clientes', titulo: 'Clientes', descripcion: 'Ver clientes, sus deudas y registrar abonos', rutas: ['/clientes'] },
  { clave: 'facturas', titulo: 'Facturas', descripcion: 'Consultar las ventas y facturas', rutas: ['/facturas'] }
];

const PERMISO_POR_RUTA = Object.fromEntries(PERMISOS.flatMap(p => p.rutas.map(r => [r, p.clave])));

const esAdmin = (user) => user?.rol === 'admin' || user?.rol === 'super_admin';

// ¿El usuario puede usar esta sección? Los administradores siempre pueden.
export const tienePermiso = (user, clave) => esAdmin(user) || user?.permisos?.[clave] === true;

// ¿El usuario puede entrar a esta ruta del menú? Las rutas que no son
// delegables quedan como estaban (las decide el menú de cada rol).
export const puedeVerRuta = (user, ruta) => {
  const clave = PERMISO_POR_RUTA[ruta];
  return clave ? tienePermiso(user, clave) : false;
};
