import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiPublico from '../services/apiPublico';
import { leerMisPedidos, pasoActual } from '../utils/etapaPedido';
import SeguimientoPedido from './SeguimientoPedido';
import './MenuPedidoConfirmacion.css';
import './SeguimientoPedido.css';

const pesos = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
const fecha = (f) => new Date(f).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const ACTIVO = ['por_enviar', 'recibido', 'empacado', 'en_camino'];

// "Mis pedidos" del menú en línea: los pedidos que el cliente hizo desde
// este celular (se recuerdan en el navegador, no necesita cuenta) y en qué
// van. Se actualiza solo mientras haya alguno en curso.
const MisPedidosMenu = () => {
  const { moduloId } = useParams();
  const navigate = useNavigate();
  const [pedidos, setPedidos] = useState(null);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    const tokens = leerMisPedidos(moduloId);
    if (tokens.length === 0) {
      setPedidos([]);
      return;
    }
    try {
      const res = await apiPublico.post(`/menu/${moduloId}/mis-pedidos`, { tokens });
      setPedidos(res.data);
      setError('');
    } catch {
      setError('No se pudieron cargar tus pedidos. Revisa tu conexión.');
      setPedidos(prev => prev || []);
    }
  }, [moduloId]);

  useEffect(() => { cargar(); }, [cargar]);

  const hayActivos = (pedidos || []).some(p => ACTIVO.includes(pasoActual(p)));
  useEffect(() => {
    if (!hayActivos) return undefined;
    const id = setInterval(cargar, 30000);
    return () => clearInterval(id);
  }, [hayActivos, cargar]);

  return (
    <div className="menu-confirmacion-container">
      <div className="mis-pedidos__cabecera">
        <button type="button" className="mis-pedidos__volver" onClick={() => navigate(`/menu/${moduloId}`)} aria-label="Volver al menú">←</button>
        <h1>Mis pedidos</h1>
      </div>
      <p className="mis-pedidos__ayuda">Los pedidos que hiciste desde este celular. Toca uno para ver el detalle.</p>

      {error && <p className="mp-error">{error}</p>}

      {pedidos === null ? (
        <div className="menu-confirmacion-loading">Cargando...</div>
      ) : pedidos.length === 0 ? (
        <div className="mis-pedidos__vacio">
          <p>Todavía no has hecho pedidos desde este celular.</p>
          <button type="button" className="mis-pedidos__enlace" onClick={() => navigate(`/menu/${moduloId}`)}>Ver el menú</button>
        </div>
      ) : (
        <div className="mis-pedidos__lista">
          {pedidos.map(p => (
            <button
              type="button"
              key={p.token_publico}
              className="mis-pedidos__item"
              onClick={() => navigate(`/menu/${moduloId}/pedido/${p.token_publico}`)}
            >
              <div className="mis-pedidos__fila">
                <span>{fecha(p.fecha_creacion)} · {p.es_domicilio ? '🛵 Domicilio' : '🛍️ Para recoger'}</span>
                <b>{pesos(p.total)}</b>
              </div>
              {p.productos && <p className="mis-pedidos__productos">{p.productos}</p>}
              <SeguimientoPedido pedido={p} compacto />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default MisPedidosMenu;
