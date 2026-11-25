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
