import React, { useState, useEffect, useCallback } from 'react';
import { CalendarDays, ClipboardList } from 'lucide-react';
import api from '../services/api';
import { describirCalendario, fechaCorta } from '../utils/calendarioProveedor';
import './CalendarioPedidos.css';

const ETIQUETA = {
  atrasado: 'Atrasado',
  hoy: 'Hoy',
  manana: 'Mañana',
  proximo: 'Próximo',
  hecho: 'Pedido hecho',
  esperando_aviso: 'Esperando aviso',
  sin_configurar: 'Sin calendario',
  pausado: 'En pausa'
};

// Qué hacer con cada proveedor, en una frase.
const detalle = (p) => {
  const llega = p.llegada && p.llegada !== p.proximo_pedido ? ` · llega el ${fechaCorta(p.llegada)}` : '';
  switch (p.estado) {
    case 'atrasado':
      return `Tocaba pedir el ${fechaCorta(p.proximo_pedido)}; todavía alcanza a llegar el ${fechaCorta(p.llegada)}`;
    case 'hoy':
      if (p.calendario_modo === 'avisa') return `Viene el ${fechaCorta(p.llegada)}: manda el pedido hoy`;
      return p.pide_en_sitio ? 'Llega hoy: pídele en el momento' : `Hoy toca mandar el pedido${llega}`;
    case 'manana':
      return p.pide_en_sitio ? 'Llega mañana' : `Mañana toca mandar el pedido${llega}`;
    case 'proximo':
      if (p.calendario_modo === 'avisa') return `Viene el ${fechaCorta(p.llegada)}: manda el pedido a más tardar el ${fechaCorta(p.proximo_pedido)}`;
      return p.pide_en_sitio ? `Llega el ${fechaCorta(p.proximo_pedido)}` : `Pedir el ${fechaCorta(p.proximo_pedido)}${llega}`;
    case 'hecho':
      return `Ya está pedido · llega el ${fechaCorta(p.llegada)}`;
    case 'esperando_aviso':
      return 'Cuando avise que viene, anota la fecha aquí';
    case 'sin_configurar':
      return 'Configura cómo se le pide en Proveedores';
    default:
      return describirCalendario(p);
  }
};

const VisitaAviso = ({ proveedor, onGuardado }) => {
  const [fecha, setFecha] = useState(proveedor.proxima_visita || '');
  const [guardando, setGuardando] = useState(false);

  const guardar = async (valor) => {
    try {
      setGuardando(true);
      await api.put(`/proveedores/${proveedor.id}/proxima-visita`, { fecha: valor || null });
      onGuardado();
    } catch (err) {
      window.alert(err.response?.data?.error || 'No se pudo guardar la fecha');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="cal-visita">
      <label>
        <span>Viene el</span>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </label>
      <button type="button" className="cal-btn-sec" disabled={guardando || !fecha || fecha === proveedor.proxima_visita}
        onClick={() => guardar(fecha)}>
        Guardar
      </button>
      {proveedor.proxima_visita && (
        <button type="button" className="cal-btn-link" disabled={guardando} onClick={() => { setFecha(''); guardar(null); }}>
          Quitar
        </button>
      )}
    </div>
  );
};

// Calendario de pedidos: qué proveedor toca hoy, cuál viene y cuál ya
// está pedido. recargarCon cambia cada vez que se crea un pedido.
const CalendarioPedidos = ({ onRevisar, recargarCon }) => {
  const [proveedores, setProveedores] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const res = await api.get('/proveedores/calendario');
      setProveedores(res.data.proveedores);
    } catch (err) {
      console.error('Error cargando calendario de proveedores:', err);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar, recargarCon]);

  if (!proveedores) return null;

  return (
    <div className="card cal-card">
      <h3 className="cal-titulo"><CalendarDays size={18} /> Calendario de pedidos</h3>
      {proveedores.length === 0 ? (
        <p className="cal-vacio">No hay proveedores registrados. Ve a <strong>Proveedores</strong> para agregar uno.</p>
      ) : (
        <div className="cal-lista">
          {proveedores.map(p => (
            <div key={p.id} className={`cal-fila cal-${p.estado}`}>
              <div className="cal-info">
                <div className="cal-nombre">
                  <strong>{p.nombre}</strong>
                  <span className={`cal-badge cal-badge-${p.estado}`}>{ETIQUETA[p.estado]}</span>
                </div>
                <span className="cal-detalle">{detalle(p)}</span>
                {['atrasado', 'hoy', 'manana', 'proximo'].includes(p.estado) && p.dias_cobertura && (
                  <small className="cal-cobertura">El pedido debe alcanzar para {p.dias_cobertura} días</small>
                )}
                {p.calendario_modo === 'avisa' && <VisitaAviso key={p.proxima_visita || 'sin-fecha'} proveedor={p} onGuardado={cargar} />}
              </div>
              {p.estado !== 'pausado' && (
                <button type="button" className="cal-btn" onClick={() => onRevisar(p.id)}>
                  <ClipboardList size={15} /> Revisar pedido
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CalendarioPedidos;
