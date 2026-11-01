import React, { useState } from 'react';
import api from '../services/api';
import './EstadoPagoPedido.css';

const METODOS = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta' };

// Estado de pago de un pedido de cliente pendiente: pagado / falta pagar,
// y el comprobante que haya subido el cliente para revisar. Lo usan la
// Ruta de Entregas y Pedidos de Clientes. onCambio recarga la lista.
const EstadoPagoPedido = ({ pedido, onCambio }) => {
  const [guardando, setGuardando] = useState(false);
  const [eligiendo, setEligiendo] = useState(false);

  const enviar = async (ruta, body) => {
    try {
      setGuardando(true);
      await api.put(`/pedidos-cliente/${pedido.id}/${ruta}`, body);
      setEligiendo(false);
      await onCambio();
    } catch (err) {
      window.alert(err.response?.data?.error || 'No se pudo actualizar el pago');
    } finally {
      setGuardando(false);
    }
  };

  const enRevision = pedido.comprobante_estado === 'en_revision';

  return (
    <div className="epp">
      <div className="epp-fila">
        {pedido.pagado ? (
          <span className="epp-badge epp-pagado">💰 Pagado · {METODOS[pedido.metodo_pago_cliente] || 'Efectivo'}</span>
        ) : enRevision ? (
          <span className="epp-badge epp-revision">🧾 Comprobante en revisión</span>
        ) : (
          <span className="epp-badge epp-falta">⏳ Falta pagar</span>
        )}

        {pedido.comprobante_url && (
          <a className="epp-link" href={pedido.comprobante_url} target="_blank" rel="noreferrer">Ver comprobante</a>
        )}

        {pedido.pagado ? (
          <button type="button" className="epp-btn-link" disabled={guardando} onClick={() => enviar('pago', { pagado: false })}>
            Marcar que falta pagar
          </button>
        ) : !enRevision && !eligiendo && (
          <button type="button" className="epp-btn" disabled={guardando} onClick={() => setEligiendo(true)}>
            Marcar pagado
          </button>
        )}
      </div>

      {enRevision && !pedido.pagado && (
        <div className="epp-fila">
          <button type="button" className="epp-btn epp-btn-ok" disabled={guardando} onClick={() => enviar('comprobante', { aprobar: true })}>
            ✅ Aprobar pago
          </button>
          <button type="button" className="epp-btn" disabled={guardando} onClick={() => enviar('comprobante', { aprobar: false })}>
            Rechazar
          </button>
        </div>
      )}
      {pedido.comprobante_estado === 'rechazado' && !pedido.pagado && (
        <small className="epp-nota">Comprobante rechazado: el cliente puede subir otro.</small>
      )}

      {eligiendo && (
        <div className="epp-fila">
          <span className="epp-nota">¿Cómo pagó?</span>
          {Object.entries(METODOS).map(([valor, nombre]) => (
            <button key={valor} type="button" className="epp-btn" disabled={guardando}
              onClick={() => enviar('pago', { pagado: true, metodo_pago: valor })}>
              {nombre}
            </button>
          ))}
          <button type="button" className="epp-btn-link" onClick={() => setEligiendo(false)}>Cancelar</button>
        </div>
      )}
    </div>
  );
};

export default EstadoPagoPedido;
