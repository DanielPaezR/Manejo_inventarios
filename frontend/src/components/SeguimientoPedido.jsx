import React from 'react';
import { pasosPedido, pasoActual, indicePaso, textoPasoCliente } from '../utils/etapaPedido';
import './SeguimientoPedido.css';

const hora = (fecha) => (fecha
  ? new Date(fecha).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })
  : null);

// Barra de pasos del pedido para el cliente: Recibido → Empacado →
// En camino → Entregado (o "Listo para recoger" si no es domicilio).
const SeguimientoPedido = ({ pedido, compacto = false }) => {
  const paso = pasoActual(pedido);
  const actual = indicePaso(pedido);
  const horas = {
    recibido: hora(pedido.fecha_creacion),
    empacado: hora(pedido.fecha_empacado),
    en_camino: hora(pedido.fecha_en_camino),
    entregado: paso === 'entregado' ? hora(pedido.fecha_actualizacion) : null
  };

  return (
    <div className={`sp ${compacto ? 'sp--compacto' : ''} sp--${paso}`}>
      <p className="sp__texto" role="status">{textoPasoCliente(pedido)}</p>
      {paso !== 'cancelado' && paso !== 'por_enviar' && (
        <ol className="sp__pasos">
          {pasosPedido(pedido).map((p, i) => (
            <li key={p.id} className={i < actual ? 'hecho' : i === actual ? 'actual' : ''}>
              <span className="sp__punto" aria-hidden="true">{i <= actual ? p.emoji : ''}</span>
              <span className="sp__titulo">{p.titulo}</span>
              {!compacto && i <= actual && horas[p.id] && <small>{horas[p.id]}</small>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

export default SeguimientoPedido;
