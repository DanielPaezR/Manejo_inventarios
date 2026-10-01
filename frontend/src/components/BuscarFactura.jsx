import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import Factura from './Factura';
import './BuscarFactura.css';

const formatearMoneda = (valor) => {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(valor || 0);
};

const formatearFecha = (fecha) => {
  if (!fecha) return '';
  return new Date(fecha).toLocaleString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const ETIQUETAS_METODO_PAGO = {
  efectivo: '💵 Efectivo',
  tarjeta: '💳 Tarjeta',
  transferencia: '🔁 Transferencia',
  credito: '📒 Crédito (fiado)',
  consumo_propio: '🏠 Consumo propio'
};

// Buscador de facturas por número de serial (ej. "FAC001231"), para revisar
// rápido qué se compró, cuándo, y si el cliente quedó debiendo — reutiliza
// el mismo modal de Factura que ya existe para mostrar el detalle completo.
const BuscarFactura = ({ user }) => {
  const { moduloActivo } = useModulo();
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [error, setError] = useState('');
  const [facturaSeleccionada, setFacturaSeleccionada] = useState(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  const buscar = useCallback(async (termino) => {
    if (!termino.trim()) {
      setResultados([]);
      setBuscado(false);
      setError('');
      return;
    }
    try {
      setLoading(true);
      setError('');
      const response = await api.get('/ventas/buscar-factura', { params: { q: termino.trim() } });
      setResultados(response.data);
    } catch (err) {
      console.error('Error buscando factura:', err);
      setError(err.response?.data?.error || 'Error al buscar la factura');
      setResultados([]);
    } finally {
      setLoading(false);
      setBuscado(true);
    }
  }, []);

  // Búsqueda con debounce, igual criterio que Clientes.jsx.
  useEffect(() => {
    if (!moduloActivo) return;
    const timeoutId = setTimeout(() => buscar(query), 300);
    return () => clearTimeout(timeoutId);
  }, [query, moduloActivo, buscar]);

  const verDetalle = async (id) => {
    try {
      setCargandoDetalle(true);
      const response = await api.get(`/ventas/${id}/factura`);
      setFacturaSeleccionada(response.data);
    } catch (err) {
      console.error('Error cargando el detalle de la factura:', err);
      alert(err.response?.data?.error || 'Error al cargar la factura');
    } finally {
      setCargandoDetalle(false);
    }
  };

  if (!moduloActivo) {
    return (
      <div className="buscar-factura-container">
        <p className="bf-sin-modulo">⚠️ No hay módulo activo. Selecciona un módulo para buscar facturas.</p>
      </div>
    );
  }

  return (
    <div className="buscar-factura-container">
      <div className="bf-header">
        <h2>🔎 Buscar Factura</h2>
        <p className="bf-subtitulo">
          Pega o escribe el número de factura (ej. <strong>FAC001231</strong>) para ver qué se compró, cuándo, y revisar si el cliente quedó debiendo.
        </p>
      </div>

      <div className="bf-buscador">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ej. FAC001231"
          className="bf-input"
          autoFocus
        />
        {loading && <span className="bf-cargando">Buscando...</span>}
      </div>

      {error && <p className="bf-error">❌ {error}</p>}

      {buscado && !loading && !error && resultados.length === 0 && (
        <p className="bf-sin-resultados">No se encontró ninguna factura con "{query}" en este módulo.</p>
      )}

      {resultados.length > 0 && (
        <div className="bf-resultados">
          {resultados.map((v) => (
            <button
              key={v.id}
              type="button"
              className="bf-resultado-item"
              onClick={() => verDetalle(v.id)}
              disabled={cargandoDetalle}
            >
              <div className="bf-resultado-principal">
                <span className="bf-resultado-numero">{v.numero_factura}</span>
                <span className="bf-resultado-cliente">{v.cliente_nombre || 'Consumidor final'}</span>
              </div>
              <div className="bf-resultado-secundario">
                <span className="bf-resultado-fecha">{formatearFecha(v.fecha_venta)}</span>
                <span className={`bf-badge-metodo bf-metodo-${v.metodo_pago}`}>
                  {ETIQUETAS_METODO_PAGO[v.metodo_pago] || v.metodo_pago}
                </span>
                <span className="bf-resultado-total">{formatearMoneda(v.total)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {facturaSeleccionada && (
        <Factura venta={facturaSeleccionada} onClose={() => setFacturaSeleccionada(null)} />
      )}
    </div>
  );
};

export default BuscarFactura;
