import React, { useState, useEffect, useCallback } from 'react';
import { Bot, MessageSquareText } from 'lucide-react';
import api from '../services/api';

const formatearFecha = (fecha) => new Date(fecha).toLocaleString('es-CO', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
});

// Configuración del asistente automático del menú/catálogo: lo que sabe del
// negocio (horario, domicilio, preguntas frecuentes) y lo que le preguntan.
const ConfigAsistente = ({ moduloId, textos, avisar }) => {
  const [datos, setDatos] = useState(null);
  const [form, setForm] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [verPreguntas, setVerPreguntas] = useState(false);
  const [verPrompt, setVerPrompt] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await api.get(`/modulos/${moduloId}/bot`);
      setDatos(res.data);
      setForm({
        bot_activo: res.data.bot_activo,
        bot_horario: res.data.bot_horario || '',
        bot_envio_costo: res.data.bot_envio_costo ?? '',
        bot_envio_info: res.data.bot_envio_info || '',
        bot_info_extra: res.data.bot_info_extra || '',
        bot_prompt: res.data.bot_prompt || ''
      });
    } catch (err) {
      console.error('Error cargando el asistente:', err);
    }
  }, [moduloId]);

  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async (cambios = {}) => {
    const nuevo = { ...form, ...cambios };
    setForm(nuevo);
    try {
      setGuardando(true);
      await api.put(`/modulos/${moduloId}/bot`, nuevo);
      avisar('✅ Asistente actualizado');
      cargar();
    } catch (err) {
      avisar(`❌ ${err.response?.data?.error || 'No se pudo guardar el asistente'}`);
    } finally {
      setGuardando(false);
    }
  };

  if (!datos || !form) return null;

  const campo = (clave) => ({
    value: form[clave],
    onChange: (e) => setForm(f => ({ ...f, [clave]: e.target.value }))
  });

  return (
    <div className="card conf-card">
      <div className="conf-switch-fila">
        <div>
          <h3 className="conf-titulo"><Bot size={18} /> Asistente automático</h3>
          <p className="conf-ayuda">
            Un chat en tu {textos.menu} que responde solo las preguntas de los clientes (horarios, precios,
            domicilios, cómo pedir) con la información de abajo y tus productos. Si no sabe algo, manda al cliente a tu WhatsApp.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={form.bot_activo}
          aria-label="Asistente automático"
          className={`conf-switch ${form.bot_activo ? 'on' : ''}`}
          onClick={() => guardar({ bot_activo: !form.bot_activo })}
          disabled={guardando || (!datos.disponible && !form.bot_activo)}
        >
          <span />
        </button>
      </div>

      {!datos.disponible && (
        <p className="conf-aviso">
          El asistente todavía no está habilitado en el servidor. Pídele al administrador del sistema que configure la clave de OpenAI.
        </p>
      )}

      <div className="conf-campos">
        <label className="conf-campo">
          <span>Horario de atención</span>
          <input type="text" maxLength={300} placeholder="Ej. Lunes a sábado 10 a. m. a 8 p. m.; domingos 11 a. m. a 4 p. m." {...campo('bot_horario')} />
        </label>
        {datos.tiene_domicilio && (
          <>
            <label className="conf-campo">
              <span>Costo del domicilio</span>
              <input type="number" min="0" inputMode="numeric" placeholder="Ej. 5000" {...campo('bot_envio_costo')} />
            </label>
            <label className="conf-campo conf-campo--ancho">
              <span>Condiciones del domicilio</span>
              <textarea rows={3} maxLength={1500}
                placeholder="Ej. Llevamos a Laureles, Belén y Estadio. Llega en 30 a 45 minutos. Gratis en compras desde $80.000. Otros barrios: consultar."
                {...campo('bot_envio_info')} />
            </label>
          </>
        )}
        <label className="conf-campo conf-campo--ancho">
          <span>Otra información para el asistente</span>
          <textarea rows={4} maxLength={3000}
            placeholder="Ej. Recibimos efectivo y transferencia a Nequi 300... Hacemos cambios en 8 días con factura. Solo ventas a mayores de edad."
            {...campo('bot_info_extra')} />
        </label>
      </div>

      <button type="button" className="conf-link" onClick={() => setVerPrompt(v => !v)}>
        {verPrompt ? 'Ocultar instrucciones avanzadas' : 'Instrucciones avanzadas (prompt personalizado)'}
      </button>
      {verPrompt && (
        <label className="conf-campo conf-campo--ancho conf-prompt">
          <span>Prompt personalizado del negocio</span>
          <small className="conf-ayuda">
            Opcional. Si lo dejas vacío, el asistente usa automáticamente toda la información de arriba y tus productos.
            Puedes usar estas variables y se reemplazan por los datos actuales:
          </small>
          <div className="conf-variables">
            {datos.variables_prompt.map(v => (
              <button key={v} type="button" className="conf-variable"
                onClick={() => setForm(f => ({ ...f, bot_prompt: `${f.bot_prompt}${f.bot_prompt && !f.bot_prompt.endsWith(' ') ? ' ' : ''}${v}` }))}>
                {v}
              </button>
            ))}
          </div>
          <textarea rows={6} maxLength={4000}
            placeholder="Ej. Eres el asistente de {nombre_negocio}. Atendemos {horario}. El domicilio cuesta {costo_domicilio} ({info_domicilio}). Productos: {productos}. Habla de forma juvenil y cercana."
            {...campo('bot_prompt')} />
        </label>
      )}

      <div className="conf-acciones conf-acciones-fin">
        <button type="button" onClick={() => guardar()} disabled={guardando} className="btn-guardar conf-btn-guardar">
          {guardando ? 'Guardando...' : '💾 Guardar información'}
        </button>
      </div>

      <button type="button" className="conf-link" onClick={() => setVerPreguntas(v => !v)}>
        <MessageSquareText size={15} />
        {verPreguntas ? 'Ocultar preguntas' : `Ver lo que preguntan (${datos.preguntas_hoy} hoy, máximo ${datos.limite_diario} al día)`}
      </button>
      {verPreguntas && (
        datos.ultimas.length === 0 ? (
          <p className="conf-ayuda">Todavía no hay preguntas.</p>
        ) : (
          <div className="conf-preguntas">
            {datos.ultimas.map(m => (
              <div key={m.id} className="conf-pregunta">
                <small>{formatearFecha(m.fecha)}</small>
                <strong>{m.pregunta}</strong>
                <p className={m.error ? 'conf-pregunta--error' : ''}>{m.error ? 'No se pudo responder' : m.respuesta}</p>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
};

export default ConfigAsistente;
