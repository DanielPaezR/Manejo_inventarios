// Enlaces con nombre para el menú público: /menu/elixir en vez de /menu/64.
// El número del módulo sigue sirviendo (QR y enlaces ya compartidos); el
// nombre es solo una forma más bonita y fácil de recordar de llegar al mismo
// menú.

// Palabras que no pueden ser enlace porque chocan con rutas de la app.
const RESERVADOS = new Set([
  'pedido', 'pedidos', 'geocodificar', 'menu', 'menus', 'api', 'admin', 'login', 'juegos', 'salas',
  'sellos', 'bot', 'mis-pedidos', 'nuevo', 'nueva', 'configuracion', 'id'
]);

const MAX = 40;

// "Café La Abeja #2" -> "cafe-la-abeja-2"
const crearSlug = (texto) => (texto || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/ñ/g, 'n')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, MAX)
  .replace(/-+$/g, '');

// null si es válido; si no, el motivo.
const validarSlug = (slug) => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return 'Usa solo letras sin tildes, números y guiones (ej. elixir-tunja)';
  if (slug.length < 3 || slug.length > MAX) return `El enlace debe tener entre 3 y ${MAX} caracteres`;
  if (/^\d+$/.test(slug)) return 'El enlace no puede ser solo números';
  if (RESERVADOS.has(slug)) return 'Ese nombre está reservado, prueba con otro';
  return null;
};

// Primer slug libre a partir de `base`: elixir, elixir-2, elixir-3…
async function slugLibre(db, base, excluirModuloId = null) {
  let raiz = crearSlug(base);
  if (validarSlug(raiz)) raiz = crearSlug(`menu-${raiz || 'tienda'}`);
  for (let n = 1; n < 500; n++) {
    const sufijo = n === 1 ? '' : `-${n}`;
    const candidato = `${raiz.slice(0, MAX - sufijo.length).replace(/-+$/g, '')}${sufijo}`;
    if (RESERVADOS.has(candidato)) continue;
    const { rows } = await db.query('SELECT 1 FROM modulos WHERE slug = $1 AND id IS DISTINCT FROM $2', [candidato, excluirModuloId]);
    if (rows.length === 0) return candidato;
  }
  return `${raiz.slice(0, 30)}-${Date.now().toString(36)}`;
}

// Al arrancar: da enlace a los módulos que no tienen. Nombre de base: el
// nombre público del menú o, si no tiene, el del negocio (más el del módulo
// cuando el negocio tiene varios).
async function asegurarSlugs(db) {
  try {
    const { rows } = await db.query(
      `SELECT m.id, m.nombre, m.nombre_publico, n.nombre AS negocio,
              (SELECT COUNT(*) FROM modulos m2 WHERE m2.negocio_id = m.negocio_id)::int AS modulos_del_negocio
       FROM modulos m JOIN negocios n ON n.id = m.negocio_id
       WHERE m.slug IS NULL
       ORDER BY m.id`);
    for (const m of rows) {
      const base = m.nombre_publico
        || (m.modulos_del_negocio > 1 ? `${m.negocio} ${m.nombre}` : m.negocio)
        || m.nombre;
      const slug = await slugLibre(db, base, m.id);
      await db.query('UPDATE modulos SET slug = $1 WHERE id = $2 AND slug IS NULL', [slug, m.id]);
    }
    if (rows.length) console.log(`🔗 Enlaces con nombre creados para ${rows.length} menú(s)`);
  } catch (error) {
    // Si la migración aún no corrió, los enlaces con número siguen igual.
    console.error('No se pudieron crear los enlaces con nombre:', error.message);
  }
}

// Las rutas públicas /api/menu/:moduloId aceptan el número o el nombre: el
// nombre se traduce aquí al número y el resto de cada ruta sigue igual.
const resolverModuloId = (db) => async (req, res, next, valor) => {
  if (/^\d+$/.test(valor)) return next();
  const slug = String(valor || '').toLowerCase();
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return next();
  try {
    const { rows: [m] } = await db.query('SELECT id FROM modulos WHERE slug = $1', [slug]);
    if (m) req.params.moduloId = String(m.id);
  } catch { /* sin la columna todavía: sigue como antes */ }
  next();
};

module.exports = { crearSlug, validarSlug, slugLibre, asegurarSlugs, resolverModuloId };
