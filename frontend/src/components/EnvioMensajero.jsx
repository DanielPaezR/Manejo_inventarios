import React, { useEffect, useState } from 'react';
import api from '../services/api';
import './EnvioMensajero.css';

const pesos = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;

// Copia al portapapeles; si el navegador no deja (http o permisos), usa un
// textarea temporal.
const copiarTexto = async (texto) => {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = texto;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  }
};

// Datos de la tienda (punto de recogida): se piden una vez por módulo.
const cacheTienda = {};
const cargarTienda = (moduloId) => {
  if (!cacheTienda[moduloId]) {
    cacheTienda[moduloId] = api.get(`/modulos/${moduloId}`).then(r => r.data).catch(() => {
      delete cacheTienda[moduloId];
      return null;
    });
  }
  return cacheTienda[moduloId];
};

const enlaceMapa = (lat, lng) => `https://maps.google.com/?q=${lat},${lng}`;
const tieneCoords = (o, lat = 'lat', lng = 'lng') => o && o[lat] !== null && o[lat] !== undefined && o[lng] !== null && o[lng] !== undefined;

// Para pedir el domicilio a un mensajero externo (Rappi Favor, Picap, un
// mensajero de confianza…): los datos del envío listos para copiar y pegar
// campo por campo en la app del mensajero, o todos juntos por WhatsApp.
// No hay conexión directa con Rappi: su API de envíos es para empresas con
// convenio y mucho volumen.
const EnvioMensajero = ({ pedido, moduloId }) => {
  const [abierto, setAbierto] = useState(false);
  const [tienda, setTienda] = useState(null);
  const [copiado, setCopiado] = useState('');

  useEffect(() => {
    if (abierto && moduloId) cargarTienda(moduloId).then(setTienda);
  }, [abierto, moduloId]);

  const nombreTienda = tienda?.nombre_publico || tienda?.negocio_nombre || 'la tienda';
  const productos = (pedido.detalles || []).map(d => `${Number(d.cantidad)}x ${d.nombre_producto}`).join(', ');
  const cobrar = !pedido.pagado;

  const campos = [
    {
      id: 'recoger', titulo: '📍 Recoger en',
      valor: tienda?.negocio_direccion || 'Falta la dirección de la tienda',
      falta: !tienda?.negocio_direccion
    },
    {
      id: 'ubicacion_tienda', titulo: '🗺️ Ubicación de la tienda',
      valor: tieneCoords(tienda, 'ubicacion_lat', 'ubicacion_lng') ? enlaceMapa(tienda.ubicacion_lat, tienda.ubicacion_lng) : '',
      omitir: !tieneCoords(tienda, 'ubicacion_lat', 'ubicacion_lng')
    },
    { id: 'contacto_tienda', titulo: '🏪 Quién entrega el paquete', valor: [nombreTienda, tienda?.negocio_telefono].filter(Boolean).join(' · ') },
    { id: 'entregar', titulo: '🏠 Entregar en', valor: pedido.direccion_entrega || '' },
    { id: 'ubicacion', titulo: '🗺️ Ubicación del cliente', valor: tieneCoords(pedido) ? enlaceMapa(pedido.lat, pedido.lng) : '', omitir: !tieneCoords(pedido) },
    { id: 'cliente', titulo: '👤 Recibe', valor: [pedido.mesa_nombre, pedido.telefono].filter(Boolean).join(' · ') },
    { id: 'paquete', titulo: '📦 Qué lleva', valor: `Pedido de ${nombreTienda}: ${productos}` },
    {
      id: 'pago', titulo: '💵 Pago',
      valor: cobrar
        ? `El cliente paga al recibir: cobrar ${pesos(pedido.total)}${pedido.monto_recibido ? ` (paga con ${pesos(pedido.monto_recibido)})` : ''}`
        : `Ya está pagado: NO cobrarle nada al cliente (valor del pedido ${pesos(pedido.total)})`
    }
  ].filter(c => !c.omitir);

  const textoCompleto = [
    `*Envío de ${nombreTienda}*`,
    ...campos.map(c => `*${c.titulo.replace(/^\S+\s/, '')}:* ${c.valor}`)
  ].join('\n');

  const copiar = async (id, texto) => {
    if (await copiarTexto(texto)) {
      setCopiado(id);
      setTimeout(() => setCopiado(c => (c === id ? '' : c)), 1800);
    }
  };

  if (!abierto) {
    return (
      <button type="button" className="em-abrir" onClick={() => setAbierto(true)}>
        🛵 Pedir mensajero (Rappi Favor u otro): copiar datos del envío
      </button>
    );
  }

  return (
    <div className="em">
      <div className="em__cabecera">
        <strong>🛵 Datos para el mensajero</strong>
        <button type="button" className="em__cerrar" onClick={() => setAbierto(false)} aria-label="Cerrar">✕</button>
      </div>
      <p className="em__ayuda">Copia cada dato y pégalo en Rappi Favor (o la app que uses), o manda todo junto por WhatsApp.</p>
      {cobrar && (
        <p className="em__aviso">⚠️ Este pedido no está pagado. Con Rappi Favor es mejor que el cliente pague antes (transferencia) y marcarlo como pagado.</p>
      )}

      <ul className="em__campos">
        {campos.map(c => (
          <li key={c.id} className={c.falta ? 'falta' : ''}>
            <div>
              <small>{c.titulo}</small>
              <span>{c.valor}</span>
            </div>
            {!c.falta && (
              <button type="button" onClick={() => copiar(c.id, c.valor)} className={copiado === c.id ? 'ok' : ''}>
                {copiado === c.id ? '✓ Copiado' : 'Copiar'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {campos.some(c => c.falta) && (
        <p className="em__nota">Agrega la dirección del negocio (la configura el super admin al crear el negocio) para tenerla aquí.</p>
      )}

      <div className="em__acciones">
        <button type="button" className="em__btn" onClick={() => copiar('todo', textoCompleto)}>
          {copiado === 'todo' ? '✓ Todo copiado' : '📋 Copiar todo'}
        </button>
        <a className="em__btn em__btn--wa" href={`https://wa.me/?text=${encodeURIComponent(textoCompleto)}`} target="_blank" rel="noopener noreferrer">
          📲 Enviar a un mensajero por WhatsApp
        </a>
        <a className="em__btn em__btn--rappi" href="https://www.rappi.com.co/" target="_blank" rel="noopener noreferrer">
          Abrir Rappi
        </a>
      </div>
      <p className="em__nota">Cuando el mensajero recoja el paquete, toca <b>Enviar (en camino)</b> y avísale al cliente.</p>
    </div>
  );
};

export default EnvioMensajero;
