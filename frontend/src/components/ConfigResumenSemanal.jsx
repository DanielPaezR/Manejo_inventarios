import React, { useState, useEffect, useCallback } from 'react';
import { BellRing } from 'lucide-react';
import api from '../services/api';

// Configuración del resumen semanal: cada lunes en la mañana le llega al
// dueño lo más importante de su negocio, por notificación (y por WhatsApp
// cuando se active la cuenta de Meta).
const ConfigResumenSemanal = ({ moduloId, avisar }) => {
  const [datos, setDatos] = useState(null);
  const [whatsapp, setWhatsapp] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [vistaPrevia, setVistaPrevia] = useState('');

  const cargar = useCallback(async () => {
    try {
      const res = await api.get(`/modulos/${moduloId}/resumen-semanal`);
      setDatos(res.data);
      setWhatsapp(res.data.whatsapp ? res.data.whatsapp.replace(/^57/, '') : '');
    } catch (err) {
      console.error('Error cargando el resumen semanal:', err);
    }
  }, [moduloId]);

  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async (cambios = {}) => {
    const nuevo = { activo: datos.activo, push: datos.push, whatsapp, ...cambios };
    try {
      setGuardando(true);
      await api.put(`/modulos/${moduloId}/resumen-semanal`, nuevo);
      avisar('✅ Resumen semanal actualizado');
      cargar();
    } catch (err) {
      avisar(`❌ ${err.response?.data?.error || 'No se pudo guardar'}`);
    } finally {
      setGuardando(false);
    }
  };

  const probar = async () => {
    try {
      setProbando(true);
      const res = await api.post(`/modulos/${moduloId}/resumen-semanal/probar`);
      setVistaPrevia(res.data.texto || '');
      const push = res.data.push;
      if (push && push.enviados > 0) avisar('✅ Resumen enviado a tus dispositivos');
      else avisar('⚠️ No hay dispositivos con notificaciones activas; abajo ves cómo se vería');
      cargar();
    } catch (err) {
      avisar(`❌ ${err.response?.data?.error || 'No se pudo enviar'}`);
    } finally {
      setProbando(false);
    }
  };

  if (!datos) return null;

  return (
    <div className="card conf-card">
      <div className="conf-switch-fila">
        <div>
          <h3 className="conf-titulo"><BellRing size={18} /> Resumen semanal</h3>
          <p className="conf-ayuda">
            Cada lunes en la mañana te llega lo más importante de tu negocio: cómo te fue, qué se está acabando,
            a quién cobrarle y qué revisar. Sin tener que entrar a buscarlo.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={datos.activo}
          aria-label="Resumen semanal"
          className={`conf-switch ${datos.activo ? 'on' : ''}`}
          onClick={() => guardar({ activo: !datos.activo })}
          disabled={guardando}
        >
          <span />
        </button>
      </div>

      {datos.activo && (
        <>
          <h4 className="conf-subtitulo">🔔 Notificación en el celular o computador</h4>
          {!datos.canales.push ? (
            <p className="conf-aviso">Las notificaciones todavía no están habilitadas en el servidor.</p>
          ) : datos.dispositivos_push === 0 ? (
            <p className="conf-aviso">
              Todavía no tienes dispositivos con notificaciones activas. Actívalas en <strong>Pedidos de Clientes</strong>
              (botón de la campana) desde el celular donde quieras recibir el resumen.
            </p>
          ) : (
            <p className="conf-ayuda">Se enviará a {datos.dispositivos_push} {datos.dispositivos_push === 1 ? 'dispositivo' : 'dispositivos'} de administradores con notificaciones activas.</p>
          )}

          <h4 className="conf-subtitulo">💬 WhatsApp</h4>
          <div className="conf-campos">
            <label className="conf-campo">
              <span>Número donde recibirlo</span>
              <input type="tel" inputMode="tel" placeholder="Ej. 3001234567" value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)} />
            </label>
          </div>
          {!datos.canales.whatsapp && (
            <p className="conf-ayuda">
              Puedes dejar tu número guardado desde ya: el envío por WhatsApp se activará cuando el sistema tenga su cuenta de WhatsApp Business.
            </p>
          )}

          <div className="conf-acciones conf-acciones-fin">
            <button type="button" className="conf-btn" onClick={probar} disabled={probando || guardando}>
              {probando ? 'Enviando...' : '📨 Enviarme uno ahora'}
            </button>
            <button type="button" className="btn-guardar conf-btn-guardar" onClick={() => guardar()} disabled={guardando}>
              {guardando ? 'Guardando...' : '💾 Guardar'}
            </button>
          </div>

          {vistaPrevia && (
            <div className="conf-burbuja-ejemplo conf-resumen-previa">{vistaPrevia}</div>
          )}
        </>
      )}
    </div>
  );
};

export default ConfigResumenSemanal;
