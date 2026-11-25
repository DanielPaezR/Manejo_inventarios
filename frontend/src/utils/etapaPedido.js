// En qué va un pedido de cliente, igual para el negocio y para el cliente.
// estado (pendiente/confirmado/completado/cancelado) + etapa
// (null/empacado/en_camino, ver PUT /api/pedidos-cliente/:id/etapa).

// Pasos que ve el cliente; "en camino" solo existe en los domicilios.
export const pasosPedido = (pedido) => (pedido.es_domicilio
  ? [
    { id: 'recibido', titulo: 'Recibido', emoji: '📝' },
    { id: 'empacado', titulo: 'Empacado', emoji: '📦' },
    { id: 'en_camino', titulo: 'En camino', emoji: '🛵' },
    { id: 'entregado', titulo: 'Entregado', emoji: '✅' }
  ]
  : [
    { id: 'recibido', titulo: 'Recibido', emoji: '📝' },
    { id: 'empacado', titulo: 'Listo para recoger', emoji: '🛍️' },
    { id: 'entregado', titulo: 'Entregado', emoji: '✅' }
  ]);

// Paso actual: 'por_enviar' | 'recibido' | 'empacado' | 'en_camino' | 'entregado' | 'cancelado'
export const pasoActual = (pedido) => {
  if (pedido.estado === 'cancelado') return 'cancelado';
  if (pedido.estado === 'completado') return 'entregado';
  if (pedido.etapa === 'en_camino') return 'en_camino';
  if (pedido.etapa === 'empacado') return 'empacado';
  if (pedido.estado === 'pendiente') return 'por_enviar';
  return 'recibido';
};

// Frase corta para el cliente.
export const textoPasoCliente = (pedido) => ({
  por_enviar: 'Falta enviarlo por WhatsApp',
  recibido: 'El negocio recibió tu pedido',
  empacado: pedido.es_domicilio ? 'Tu pedido ya está empacado y pronto sale' : 'Tu pedido está listo para recoger',
  en_camino: '¡Tu pedido va en camino!',
  entregado: 'Entregado',
  cancelado: 'Cancelado'
}[pasoActual(pedido)]);

// Cuántos pasos de la barra van completos (índice del paso actual).
export const indicePaso = (pedido) => {
  const paso = pasoActual(pedido);
  if (paso === 'por_enviar' || paso === 'cancelado') return -1;
  return pasosPedido(pedido).findIndex(p => p.id === paso);
};

// Pedidos que el cliente hizo desde este navegador (no tiene cuenta): se
// guardan los enlaces por módulo para su lista de "Mis pedidos".
const CLAVE = (moduloId) => `mis_pedidos_${moduloId}`;
const MAXIMO = 30;

export const leerMisPedidos = (moduloId) => {
  try {
    const lista = JSON.parse(localStorage.getItem(CLAVE(moduloId)) || '[]');
    return Array.isArray(lista) ? lista.filter(t => typeof t === 'string') : [];
  } catch {
    return [];
  }
};

export const recordarPedido = (moduloId, token) => {
  if (!moduloId || !token) return;
  try {
    const lista = [token, ...leerMisPedidos(moduloId).filter(t => t !== token)].slice(0, MAXIMO);
    localStorage.setItem(CLAVE(moduloId), JSON.stringify(lista));
  } catch { /* sin almacenamiento: no pasa nada */ }
};

// ---------- Aviso al cliente por WhatsApp ----------
// Celular colombiano de 10 dígitos (3xx...) -> con el 57 adelante.
export const telefonoWhatsApp = (telefono) => {
  const d = String(telefono || '').replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('3')) return `57${d}`;
  if (d.length === 12 && d.startsWith('57')) return d;
  return d.length >= 10 ? d : '';
};

// Mensaje según la etapa. Sin emojis fuera del plano básico: la
// redirección de wa.me los convierte en "?" (ver MenuPedidoConfirmacion).
export const mensajeAvisoCliente = (pedido, etapa, negocio) => {
  const nombre = (pedido.mesa_nombre || '').trim().split(/\s+/)[0];
  const saludo = `Hola${nombre ? ` ${nombre}` : ''}, te escribimos de ${negocio || 'la tienda'}.`;
  const cuerpo = {
    empacado: pedido.es_domicilio
      ? 'Tu pedido ya está empacado y pronto sale para tu dirección.'
      : 'Tu pedido ya está listo, puedes pasar a recogerlo.',
    en_camino: `Tu pedido ya va en camino${pedido.direccion_entrega ? ` a ${pedido.direccion_entrega}` : ''}.`,
    entregado: 'Tu pedido fue entregado. ¡Gracias por tu compra!'
  }[etapa];
  if (!cuerpo) return '';
  const total = etapa !== 'entregado' && !pedido.pagado && pedido.total
    ? `\nTotal a pagar: $${Number(pedido.total).toLocaleString('es-CO')}`
    : '';
  const enlace = pedido.token_publico && pedido.modulo_id && typeof window !== 'undefined'
    ? `\n\nMira cómo va tu pedido aquí: ${window.location.origin}/menu/${pedido.modulo_id}/pedido/${pedido.token_publico}`
    : '';
  return `${saludo}\n\n${cuerpo}${total}${enlace}`;
};

// Enlace wa.me listo, o '' si el pedido no tiene un celular válido.
export const enlaceAvisoCliente = (pedido, etapa, negocio) => {
  const tel = telefonoWhatsApp(pedido.telefono);
  const texto = mensajeAvisoCliente(pedido, etapa, negocio);
  return tel && texto ? `https://wa.me/${tel}?text=${encodeURIComponent(texto)}` : '';
};
