import React, { useState, useEffect, useCallback } from 'react';
import { AlarmClock } from 'lucide-react';
import api from '../services/api';
import { usePlan } from '../hooks/usePlan';

// Recordatorios automáticos por notificación: cierre de caja en la noche,
// pedidos a proveedores y pagos fijos en la mañana.
const TIPOS = [
  {
    id: 'pedidos', emoji: '📦', titulo: 'Pedidos a proveedores', funcion: 'proveedores',
    ayuda: 'A las 7 a. m., si según el calendario de proveedores hoy toca pedirle a alguien (o se pasó el día). También les llega a los trabajadores con permiso de proveedores.'
  },
  {
    id: 'pagos', emoji: '🗓️', titulo: 'Pagos fijos', funcion: 'finanzas',
    ayuda: 'A las 7 a. m., si un pago fijo (arriendo, servicios…) vence en los próximos 2 días o ya venció y no lo has registrado este mes.'
  },
  {
    id: 'cierre', emoji: '🌙', titulo: 'Cierre de caja', funcion: 'finanzas',
    ayuda: 'En la noche, si hoy hubo ventas y todavía no hiciste el cierre en Caja y bolsillos.'
  }
];
const HORAS = [17, 18, 19, 20, 21, 22, 23];
const formatoHora = (h) => `${h > 12 ? h - 12 : h}:00 p. m.`;

const ConfigRecordatorios = ({ moduloId, avisar }) => {
  const [datos, setDatos] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState('');
  const [previas, setPrevias] = useState({});
  const { plan, incluye } = usePlan();

  const cargar = useCallback(async () => {
    try {
      const res = await api.get(`/modulos/${moduloId}/recordatorios`);
      setDatos(res.data);
    } catch (err) {
      console.error('Error cargando recordatorios:', err);
    }
  }, [moduloId]);

  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async (tipo, cambios) => {
    const nuevo = { cierre: datos.cierre, pedidos: datos.pedidos, pagos: datos.pagos, [tipo]: { ...datos[tipo], ...cambios } };
    try {
      setGuardando(true);
      const res = await api.put(`/modulos/${moduloId}/recordatorios`, nuevo);
      setDatos(d => ({ ...d, ...res.data }));
      avisar('✅ Recordatorios actualizados');
    } catch (err) {
      avisar(`❌ ${err.response?.data?.error || 'No se pudo guardar'}`);
    } finally {
      setGuardando(false);
    }
  };

  const probar = async (tipo) => {
    try {
      setProbando(tipo);
      const res = await api.post(`/modulos/${moduloId}/recordatorios/probar`, { tipo });
      const r = res.data;
      setPrevias(p => ({ ...p, [tipo]: r.titulo ? `${r.titulo}\n${r.cuerpo}` : `Hoy no llegaría nada: ${r.motivo}.` }));
      if (r.enviado) avisar('✅ Enviado a tus dispositivos');
      else if (r.titulo) avisar('⚠️ No hay dispositivos con notificaciones activas; abajo ves cómo se vería');
    } catch (err) {
      avisar(`❌ ${err.response?.data?.error || 'No se pudo probar'}`);
    } finally {
      setProbando('');
    }
  };

  if (!datos) return null;

  return (
    <div className="card conf-card">
      <h3 className="conf-titulo"><AlarmClock size={18} /> Recordatorios</h3>
      <p className="conf-ayuda">
        Te avisamos por notificación lo que no se puede olvidar. Solo llegan cuando hay algo pendiente, nunca de relleno.
      </p>
      {!datos.push_disponible ? (
        <p className="conf-aviso">Las notificaciones todavía no están habilitadas en el servidor.</p>
      ) : datos.dispositivos_push === 0 && (
        <p className="conf-aviso">
          Todavía no tienes dispositivos con notificaciones activas. Actívalas en <strong>Pedidos de Clientes</strong> (botón
          de la campana) desde el celular donde quieras recibirlas.
        </p>
      )}

      {TIPOS.filter(t => incluye(t.funcion)).map(t => (
        <div key={t.id} className="conf-recordatorio">
          <div className="conf-switch-fila">
            <div>
              <h4 className="conf-subtitulo">{t.emoji} {t.titulo}</h4>
              <p className="conf-ayuda">{t.ayuda}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={datos[t.id].activo}
              aria-label={t.titulo}
              className={`conf-switch ${datos[t.id].activo ? 'on' : ''}`}
              onClick={() => guardar(t.id, { activo: !datos[t.id].activo })}
              disabled={guardando}
            >
              <span />
            </button>
          </div>
          {datos[t.id].activo && (
            <div className="conf-acciones">
              {t.id === 'cierre' && (
                <label className="conf-hora">
                  <span>Avisarme desde las</span>
                  <select value={datos.cierre.hora} disabled={guardando}
                    onChange={(e) => guardar('cierre', { hora: Number(e.target.value) })}>
                    {HORAS.map(h => <option key={h} value={h}>{formatoHora(h)}</option>)}
                  </select>
                </label>
              )}
              <button type="button" className="conf-btn" onClick={() => probar(t.id)} disabled={!!probando}>
                {probando === t.id ? 'Revisando...' : '👀 ¿Qué llegaría hoy?'}
              </button>
            </div>
          )}
          {previas[t.id] && datos[t.id].activo && <div className="conf-burbuja-ejemplo conf-resumen-previa">{previas[t.id]}</div>}
        </div>
      ))}
      {TIPOS.some(t => !incluye(t.funcion)) && (
        <p className="conf-nota">
          🔒 Los recordatorios de {TIPOS.filter(t => !incluye(t.funcion)).map(t => t.titulo.toLowerCase()).join(', ')} no están incluidos en tu plan {plan?.nombre}.
        </p>
      )}
    </div>
  );
};

export default ConfigRecordatorios;
