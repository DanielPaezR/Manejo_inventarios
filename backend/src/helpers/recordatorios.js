// Recordatorios automáticos por notificación (push), para no tener que
// acordarse de todo:
// - cierre:  en la noche, si se vendió hoy y no se ha hecho el cierre de
//            caja (solo negocios que usan los bolsillos).
// - pedidos: en la mañana, a qué proveedores toca pedirles hoy (o se pasó
//            el día), según el calendario de cada proveedor.
// - pagos:   en la mañana, pagos fijos que vencen en los próximos 2 días o
//            que ya vencieron y no se han registrado este mes.
// La configuración vive en modulos.recordatorios y cada envío queda en
// resumen_envios (canal 'recordatorio_<tipo>', semana = fecha del día)
// para no mandarlo dos veces el mismo día.
const { canalesDisponibles, enviarPush } = require('./notificador');

const TIPOS = ['cierre', 'pedidos', 'pagos'];
const HORA_CIERRE = 21;
const HORA_MANANA = 7;
const DIAS_ANTES_PAGO = 2;
const DIAS_DESPUES_PAGO = 5; // después de esto deja de insistir

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const ahoraBogota = () => new Date(Date.now() - 5 * 3600 * 1000); // Colombia no tiene horario de verano
const hoyBogota = () => ahoraBogota().toISOString().slice(0, 10);
const listar = (nombres) => nombres.length <= 1 ? (nombres[0] || '')
  : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;

function leerConfig(valor) {
  const c = valor || {};
  const hora = Number(c.cierre?.hora);
  return {
    cierre: { activo: c.cierre?.activo !== false, hora: Number.isInteger(hora) && hora >= 17 && hora <= 23 ? hora : HORA_CIERRE },
    pedidos: { activo: c.pedidos?.activo !== false },
    pagos: { activo: c.pagos?.activo !== false }
  };
}

// ---------- Qué hay que recordar en cada tipo ----------

async function avisoCierre(pool, moduloId, fecha) {
  const { rows: [apertura] } = await pool.query(
    "SELECT 1 FROM cuadres_caja WHERE modulo_id = $1 AND bolsillo = 'apertura' LIMIT 1", [moduloId]);
  if (!apertura) return { motivo: 'Este negocio no usa los bolsillos de caja' };
  const [{ rows: [ventas] }, { rows: [cierre] }] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS cantidad, COALESCE(SUM(total), 0) AS total
       FROM ventas
       WHERE modulo_id = $1 AND es_ajuste_manual = false AND metodo_pago != 'consumo_propio'
         AND (fecha_venta AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::date = $2`,
      [moduloId, fecha]),
    pool.query(
      `SELECT 1 FROM cierres_caja_dia WHERE modulo_id = $1 AND fecha = $2
       UNION ALL
       SELECT 1 FROM traslados_bolsillo WHERE modulo_id = $1 AND tipo = 'cierre' AND ref_fecha = $2
       LIMIT 1`,
      [moduloId, fecha])
  ]);
  if (cierre) return { motivo: 'Hoy ya se hizo el cierre' };
  if (ventas.cantidad === 0) return { motivo: 'Hoy no hay ventas' };
  return {
    titulo: '🌙 ¿Ya cerraste la caja?',
    cuerpo: `Hoy llevas ${ventas.cantidad} ${ventas.cantidad === 1 ? 'venta' : 'ventas'} por ${pesos(ventas.total)} y falta el cierre. Cuenta los billetes y deja la base lista para mañana.`,
    url: '/finanzas'
  };
}

// calendario: función (moduloId) => [{ nombre, estado, pide_en_sitio }] que
// usa la misma lógica de la pantalla de proveedores (vive en server.js).
async function avisoPedidos(pool, moduloId, calendario) {
  const lista = await calendario(moduloId);
  const atrasados = lista.filter(p => p.estado === 'atrasado').map(p => p.nombre);
  const hoyPedir = lista.filter(p => p.estado === 'hoy' && !p.pide_en_sitio).map(p => p.nombre);
  const hoyVienen = lista.filter(p => p.estado === 'hoy' && p.pide_en_sitio).map(p => p.nombre);
  if (!atrasados.length && !hoyPedir.length && !hoyVienen.length) return { motivo: 'Hoy no toca pedirle a ningún proveedor' };
  const partes = [];
  if (hoyPedir.length) partes.push(`Hoy toca pedirle a ${listar(hoyPedir)}.`);
  if (hoyVienen.length) partes.push(`Hoy pasa${hoyVienen.length > 1 ? 'n' : ''} ${listar(hoyVienen)}: revisa qué hace falta antes.`);
  if (atrasados.length) partes.push(`Se pasó el día de pedirle a ${listar(atrasados)}.`);
  partes.push('Las cantidades sugeridas ya están listas.');
  const total = hoyPedir.length + hoyVienen.length + atrasados.length;
  return {
    titulo: total === 1 ? '📦 Pedido a proveedor' : `📦 ${total} pedidos a proveedores`,
    cuerpo: partes.join(' '),
    url: '/pedidos'
  };
}

async function avisoPagos(pool, moduloId, fecha) {
  const { rows } = await pool.query(
    `SELECT pf.nombre, pf.monto,
            LEAST(pf.dia_mes, EXTRACT(DAY FROM (date_trunc('month', $2::date) + interval '1 month - 1 day'))::int) AS dia
     FROM pagos_fijos pf
     WHERE pf.modulo_id = $1 AND pf.activo = true
       AND NOT EXISTS (
         SELECT 1 FROM movimientos_caja mc
         WHERE mc.pago_fijo_id = pf.id
           AND (mc.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::date >= date_trunc('month', $2::date)::date)`,
    [moduloId, fecha]);
  const hoy = Number(fecha.slice(8, 10));
  const proximos = [];
  const vencidos = [];
  for (const r of rows) {
    const faltan = r.dia - hoy;
    if (faltan >= 0 && faltan <= DIAS_ANTES_PAGO) proximos.push({ ...r, faltan });
    else if (faltan < 0 && -faltan <= DIAS_DESPUES_PAGO) vencidos.push(r);
  }
  if (!proximos.length && !vencidos.length) return { motivo: 'No hay pagos fijos por vencer' };
  const cuando = (f) => (f === 0 ? 'hoy' : f === 1 ? 'mañana' : `en ${f} días`);
  const partes = [
    ...proximos.sort((a, b) => a.faltan - b.faltan).map(p => `${p.nombre} (${pesos(p.monto)}) vence ${cuando(p.faltan)}.`),
    ...vencidos.map(p => `${p.nombre} (${pesos(p.monto)}) venció el día ${p.dia} y no está registrado.`)
  ];
  const total = proximos.length + vencidos.length;
  return {
    titulo: vencidos.length ? '⚠️ Pagos pendientes' : (total === 1 ? '🗓️ Pago por vencer' : `🗓️ ${total} pagos por vencer`),
    cuerpo: partes.join(' '),
    url: '/finanzas'
  };
}

// Quién recibe cada tipo: los administradores; los pedidos también a los
// trabajadores con permiso de proveedores.
async function suscripcionesPara(pool, moduloId, tipo) {
  const extra = tipo === 'pedidos' ? "OR (u.permisos->>'proveedores')::boolean = true" : '';
  const { rows } = await pool.query(
    `SELECT DISTINCT ps.id, ps.endpoint, ps.p256dh, ps.auth
     FROM push_suscripciones ps
     JOIN usuarios u ON u.id = ps.usuario_id AND u.activo = true AND (u.rol = 'admin' ${extra})
     JOIN usuario_modulos um ON um.usuario_id = u.id AND um.modulo_id = $1`,
    [moduloId]);
  return rows;
}

async function construirAviso(pool, moduloId, tipo, calendario, fecha = hoyBogota()) {
  if (tipo === 'cierre') return avisoCierre(pool, moduloId, fecha);
  if (tipo === 'pedidos') return avisoPedidos(pool, moduloId, calendario);
  if (tipo === 'pagos') return avisoPagos(pool, moduloId, fecha);
  throw new Error('Tipo de recordatorio no válido');
}

// forzar = prueba desde Configuración: manda aunque ya se haya enviado hoy
// y no lo registra.
async function enviarRecordatorio(pool, moduloId, tipo, calendario, { forzar = false } = {}) {
  const fecha = hoyBogota();
  const aviso = await construirAviso(pool, moduloId, tipo, calendario, fecha);
  if (!aviso.titulo) return { enviado: false, ...aviso };
  const canal = `recordatorio_${tipo}`;
  if (!forzar) {
    const { rows: ya } = await pool.query(
      'SELECT 1 FROM resumen_envios WHERE modulo_id = $1 AND semana = $2 AND canal = $3 AND ok = true',
      [moduloId, fecha, canal]);
    if (ya.length) return { enviado: false, motivo: 'Ya se envió hoy', ...aviso };
  }
  if (!canalesDisponibles().push) return { enviado: false, motivo: 'Las notificaciones no están habilitadas en el servidor', ...aviso };
  const suscripciones = await suscripcionesPara(pool, moduloId, tipo);
  const r = await enviarPush(pool, suscripciones, aviso);
  if (!forzar) {
    await pool.query(
      `INSERT INTO resumen_envios (modulo_id, semana, canal, destino, ok, detalle)
       VALUES ($1, $2, $3, 'equipo', $4, $5)
       ON CONFLICT (modulo_id, semana, canal, destino) DO UPDATE SET ok = EXCLUDED.ok, detalle = EXCLUDED.detalle, fecha = now()`,
      [moduloId, fecha, canal, r.enviados > 0, `${r.enviados}/${suscripciones.length}`]);
  }
  return { enviado: r.enviados > 0, enviados: r.enviados, dispositivos: suscripciones.length, ...aviso };
}

// Cada 10 minutos revisa qué toca. Los de la mañana van entre 7 y 11;
// el de cierre desde la hora elegida hasta la medianoche.
function programarRecordatorios(pool, calendario) {
  const revisar = async () => {
    const hora = ahoraBogota().getUTCHours();
    const manana = hora >= HORA_MANANA && hora < 11;
    if (!manana && hora < 17) return;
    try {
      const { rows } = await pool.query('SELECT id, recordatorios FROM modulos WHERE activo = true');
      for (const m of rows) {
        const config = leerConfig(m.recordatorios);
        const tipos = [];
        if (manana && config.pedidos.activo) tipos.push('pedidos');
        if (manana && config.pagos.activo) tipos.push('pagos');
        if (config.cierre.activo && hora >= config.cierre.hora) tipos.push('cierre');
        for (const tipo of tipos) {
          await enviarRecordatorio(pool, m.id, tipo, calendario)
            .catch(err => console.error(`Recordatorio ${tipo} módulo ${m.id}:`, err.message));
        }
      }
    } catch (error) {
      if (!/recordatorios|cierres_caja_dia/.test(error.message)) {
        console.error('Error en los recordatorios:', error.message);
      }
    }
  };
  setInterval(revisar, 10 * 60 * 1000);
  setTimeout(revisar, 90 * 1000);
}

module.exports = { TIPOS, leerConfig, construirAviso, enviarRecordatorio, programarRecordatorios, hoyBogota };
