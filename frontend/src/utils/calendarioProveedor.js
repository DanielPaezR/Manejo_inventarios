// Textos del calendario de pedidos de un proveedor (ver
// "CALENDARIO DE PROVEEDORES" en backend/server.js).

export const DIAS_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// 'YYYY-MM-DD' -> 'vie 31 oct' (sin pasar por la zona horaria del navegador).
export const fechaCorta = (fecha) => {
  if (!fecha) return '';
  const [y, m, d] = fecha.split('-').map(Number);
  const dia = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DIAS_CORTOS[dia]} ${d} ${MESES_CORTOS[m - 1]}`;
};

// Resumen en una línea de cómo se le pide al proveedor.
export const describirCalendario = (p) => {
  if (!p.calendario_modo) return null;
  if (p.calendario_modo === 'pausado') return 'En pausa: no se le pide por ahora';
  const cada = p.frecuencia_semanas > 1 ? `cada ${p.frecuencia_semanas} semanas` : 'cada semana';
  if (p.calendario_modo === 'avisa') return `Avisa cuándo viene (más o menos ${cada})`;
  const dia = DIAS_SEMANA[p.dia_pedido - 1];
  if (p.pide_en_sitio) return `Llega los ${dia} (${cada}); se pide en el momento`;
  const llega = p.dias_hasta_llegada === 0
    ? 'llega el mismo día'
    : p.dias_hasta_llegada === 7 ? 'llega a la semana' : `llega ${p.dias_hasta_llegada} días después`;
  return `Pedido los ${dia} ${cada}; ${llega}`;
};
