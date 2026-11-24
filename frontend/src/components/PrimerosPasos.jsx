import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import './PrimerosPasos.css';

// Asistente de bienvenida para negocios nuevos: lista de primeros pasos
// que se marcan solos con los datos reales del negocio. Sale arriba en
// Ventas (solo administradores) hasta completarla u ocultarla.
const CLAVE_ABIERTO = 'primeros-pasos-abierto';

const PrimerosPasos = () => {
  const navigate = useNavigate();
  const [estado, setEstado] = useState(null);
  const [abierto, setAbierto] = useState(() => {
    // En el celular empieza cerrada para no tapar la pantalla de ventas.
    try {
      const guardado = localStorage.getItem(CLAVE_ABIERTO);
      if (guardado) return guardado === 'si';
    } catch { /* modo privado */ }
    return typeof window === 'undefined' || window.innerWidth > 640;
  });

  const cargar = useCallback(async () => {
    try {
      const res = await api.get('/bienvenida');
      setEstado(res.data);
    } catch {
      setEstado(null);
    }
  }, []);

  useEffect(() => {
    cargar();
    window.addEventListener('ventaRegistrada', cargar);
    return () => window.removeEventListener('ventaRegistrada', cargar);
  }, [cargar]);

  const guardar = async (cambios) => {
    try {
      const res = await api.put('/bienvenida', cambios);
      setEstado(res.data);
    } catch { /* se reintenta la próxima vez */ }
  };

  const alternar = () => {
    setAbierto(a => {
      try { localStorage.setItem(CLAVE_ABIERTO, a ? 'no' : 'si'); } catch { /* modo privado */ }
      return !a;
    });
  };

  if (!estado || estado.oculto || estado.completo) return null;
  const porcentaje = Math.round((estado.hechos / estado.total) * 100);
  const siguiente = estado.pasos.find(p => !p.hecho);
  const grupos = [
    { titulo: 'Lo esencial', pasos: estado.pasos.filter(p => p.esencial) },
    { titulo: 'Para sacarle más provecho', pasos: estado.pasos.filter(p => !p.esencial) }
  ];

  return (
    <section className={`pp ${abierto ? 'abierto' : ''}`} aria-label="Primeros pasos">
      <button type="button" className="pp__cabecera" onClick={alternar} aria-expanded={abierto}>
        <span className="pp__anillo" style={{ '--pp-avance': `${porcentaje * 3.6}deg` }} aria-hidden="true">
          <span>{estado.hechos}/{estado.total}</span>
        </span>
        <span className="pp__textos">
          <strong>{estado.esenciales_completos ? '🎉 ¡Tu negocio ya está listo!' : '🚀 Primeros pasos'}</strong>
          <small>
            {estado.esenciales_completos
              ? 'Lo esencial está hecho. Estos extras te ayudan a vender más.'
              : `Siguiente: ${siguiente?.titulo.replace(/ \(.*\)$/, '')}`}
          </small>
        </span>
        <span className="pp__flecha" aria-hidden="true">{abierto ? '−' : '+'}</span>
      </button>

      {abierto && (
        <div className="pp__cuerpo">
          {grupos.map(g => (
            <div key={g.titulo} className="pp__grupo">
              <h4>{g.titulo}</h4>
              <ol>
                {g.pasos.map(p => (
                  <li key={p.id} className={`pp__paso ${p.hecho ? 'hecho' : ''} ${p === siguiente ? 'siguiente' : ''}`}>
                    <span className="pp__check" aria-label={p.hecho ? 'Hecho' : 'Pendiente'}>{p.hecho ? '✓' : ''}</span>
                    <div className="pp__info">
                      <strong>{p.titulo}</strong>
                      {!p.hecho && <small>{p.detalle}</small>}
                    </div>
                    {!p.hecho && (
                      <div className="pp__acciones">
                        <button type="button" className="pp__ir" onClick={() => navigate(p.ruta)}>Ir</button>
                        {p.manual && (
                          <button type="button" className="pp__marcar" onClick={() => guardar({ compartido: true })}>Ya lo hice</button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
          <button type="button" className="pp__ocultar" onClick={() => guardar({ oculto: true })}>
            {estado.esenciales_completos ? 'Listo, ocultar' : 'Ocultar por ahora'}
          </button>
          <p className="pp__nota">Puedes volver a verla desde Configuración.</p>
        </div>
      )}
    </section>
  );
};

export default PrimerosPasos;

// En Configuración: volver a mostrar la lista si se ocultó sin terminarla.
export const VolverPrimerosPasos = ({ avisar }) => {
  const [estado, setEstado] = useState(null);
  useEffect(() => { api.get('/bienvenida').then(r => setEstado(r.data)).catch(() => {}); }, []);
  if (!estado || !estado.oculto || estado.completo) return null;
  const mostrar = async () => {
    try {
      const r = await api.put('/bienvenida', { oculto: false });
      setEstado(r.data);
      avisar('✅ Los primeros pasos vuelven a salir en Ventas');
    } catch { avisar('❌ No se pudo cambiar'); }
  };
  return (
    <div className="card conf-card">
      <div className="conf-switch-fila">
        <div>
          <h3 className="conf-titulo">🚀 Primeros pasos</h3>
          <p className="conf-ayuda">Llevas {estado.hechos} de {estado.total}. La lista está oculta.</p>
        </div>
        <button type="button" className="conf-btn" onClick={mostrar}>Mostrar en Ventas</button>
      </div>
    </div>
  );
};
