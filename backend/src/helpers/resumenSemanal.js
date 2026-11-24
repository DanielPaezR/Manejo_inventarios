// Resumen semanal que le llega solo al dueño (lunes en la mañana): las
// frases clave de la pestaña Resumen, por push y, cuando se configure,
// por WhatsApp. La configuración vive en modulos.resumen_semanal y cada
// envío queda en resumen_envios para no mandarlo dos veces.
const { construirResumen } = require('./resumenNegocio');
const { canalesDisponibles, enviarPush, enviarWhatsApp } = require('./notificador');

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;

// Texto corto, de 3 a 5 líneas, con lo más importante.
function armarTexto(nombre, r) {
  const lineas = [];
  const base = r.ventas.semana_promedio;
  const cambio = base > 0 ? Math.round(((r.ventas.ultimos_7 - base) / base) * 100) : null;
  lineas.push(cambio === null || Math.abs(cambio) < 3
    ? `Vendiste ${pesos(r.ventas.ultimos_7)} en la semana.`
    : `Vendiste ${pesos(r.ventas.ultimos_7)} en la semana, ${Math.abs(cambio)}% ${cambio > 0 ? 'más' : 'menos'} que una semana normal.`);

  if (r.metas?.ventas_mes) {
    const pct = Math.round((r.metas.avance.ventas_mes / r.metas.ventas_mes) * 100);
    lineas.push(`Llevas el ${pct}% de tu meta del mes.`);
  }
  const agotarse = r.atencion.por_agotarse.length;
  if (agotarse > 0) lineas.push(`${agotarse} ${agotarse === 1 ? 'producto se está acabando' : 'productos se están acabando'}.`);
  if (r.atencion.fiado.quietos.length > 0) {
    const c = r.atencion.fiado.quietos[0];
    lineas.push(`Cóbrale a ${c.nombre}: debe ${pesos(c.deuda)}.`);
  }
  const p = r.productos.margen_bajo[0];
  if (p) lineas.push(`Revisa el precio de ${p.nombre.trim()} (deja ${p.margen}%).`);
  return { titulo: `📊 Tu semana en ${nombre}`, cuerpo: lineas.slice(0, 4).join('\n') };
}

const lunesDeEstaSemana = () => {
  const ahora = new Date(Date.now() - 5 * 3600 * 1000); // hora Colombia
  const dia = ahora.getUTCDay() || 7;
  ahora.setUTCDate(ahora.getUTCDate() - (dia - 1));
  return ahora.toISOString().slice(0, 10);
};

// Envía el resumen de un módulo. forzar=true ignora si ya se envió (prueba).
async function enviarResumenModulo(pool, moduloId, { forzar = false } = {}) {
  const { rows: [modulo] } = await pool.query(
    'SELECT id, negocio_id, nombre, resumen_semanal FROM modulos WHERE id = $1 AND activo = true', [moduloId]);
  if (!modulo) return { ok: false, error: 'Módulo no encontrado' };

  const config = modulo.resumen_semanal || {};
  const semana = lunesDeEstaSemana();
  const resumen = await construirResumen(pool, moduloId);
  const { titulo, cuerpo } = armarTexto(modulo.nombre, resumen);
  const canales = canalesDisponibles();
  const resultado = { push: null, whatsapp: null, texto: `${titulo}\n${cuerpo}` };

  const yaEnviado = async (canal, destino) => {
    if (forzar) return false;
    const r = await pool.query(
      'SELECT 1 FROM resumen_envios WHERE modulo_id = $1 AND semana = $2 AND canal = $3 AND destino = $4 AND ok = true',
      [moduloId, semana, canal, destino]);
    return r.rows.length > 0;
  };
  const registrar = (canal, destino, ok, detalle) => pool.query(
    `INSERT INTO resumen_envios (modulo_id, semana, canal, destino, ok, detalle)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (modulo_id, semana, canal, destino) DO UPDATE SET ok = EXCLUDED.ok, detalle = EXCLUDED.detalle, fecha = now()`,
    [moduloId, semana, canal, destino, ok, detalle || null]);

  // Push: a los administradores del negocio con acceso a este módulo.
  if (config.push !== false && canales.push && !(await yaEnviado('push', 'admins'))) {
    const { rows: suscripciones } = await pool.query(
      `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
       FROM push_suscripciones ps
       JOIN usuarios u ON u.id = ps.usuario_id AND u.activo = true AND u.rol = 'admin'
       JOIN usuario_modulos um ON um.usuario_id = u.id AND um.modulo_id = $1`,
      [moduloId]);
    const r = await enviarPush(pool, suscripciones, { titulo, cuerpo, url: '/estadisticas' });
    resultado.push = { ...r, suscripciones: suscripciones.length };
    await registrar('push', 'admins', r.enviados > 0, `${r.enviados}/${suscripciones.length}`);
  }

  // WhatsApp: al número que el dueño haya guardado.
  if (config.whatsapp && canales.whatsapp && !(await yaEnviado('whatsapp', config.whatsapp))) {
    const r = await enviarWhatsApp(config.whatsapp, `${titulo}\n${cuerpo}`);
    resultado.whatsapp = r;
    await registrar('whatsapp', config.whatsapp, r.ok, r.error);
  }

  return { ok: true, ...resultado };
}

// Revisa cada cierto tiempo si es lunes entre 7 y 10 a. m. (Colombia) y
// manda el resumen a los módulos que no lo han recibido esta semana.
function programarResumenSemanal(pool) {
  const revisar = async () => {
    const ahora = new Date(Date.now() - 5 * 3600 * 1000);
    const esLunes = ahora.getUTCDay() === 1;
    const hora = ahora.getUTCHours();
    if (!esLunes || hora < 7 || hora >= 10) return;
    try {
      const { rows } = await pool.query(
        `SELECT id FROM modulos
         WHERE activo = true AND COALESCE((resumen_semanal->>'activo')::boolean, true) = true`);
      for (const { id } of rows) {
        await enviarResumenModulo(pool, id).catch(err => console.error(`Resumen semanal módulo ${id}:`, err.message));
      }
    } catch (error) {
      // Si la migración aún no se corrió, no hace nada.
      if (!/resumen_semanal|resumen_envios/.test(error.message)) {
        console.error('Error en el resumen semanal:', error.message);
      }
    }
  };
  setInterval(revisar, 15 * 60 * 1000);
  setTimeout(revisar, 60 * 1000);
}

module.exports = { enviarResumenModulo, programarResumenSemanal, armarTexto };
