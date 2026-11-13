import React, { useState, useEffect, useCallback } from 'react';
import { Bot, MessageSquareText, Plus, Trash2, Store, Sparkles, CircleHelp } from 'lucide-react';
import api from '../services/api';

const formatearFecha = (fecha) => new Date(fecha).toLocaleString('es-CO', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
});

const TONOS = [
  { valor: 'amable', titulo: 'Amable y cercano', ejemplo: '¡Hola! Claro que sí, con gusto te ayudo.' },
  { valor: 'formal', titulo: 'Formal', ejemplo: 'Buenos días. Con gusto le colaboro con su consulta.' },
  { valor: 'juvenil', titulo: 'Juvenil y divertido', ejemplo: '¡Hey! De una, te cuento todo.' }
];

const ESTILO_VACIO = { nombre_asistente: '', tono: 'amable', emojis: true, saludo: '', faq: [], indicaciones: '' };

// Configuración del asistente automático del menú/catálogo: lo que sabe del
// negocio, su personalidad y lo que le preguntan. Todo con campos simples.
const ConfigAsistente = ({ moduloId, textos, avisar }) => {
  const [datos, setDatos] = useState(null);
  const [form, setForm] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [verPreguntas, setVerPreguntas] = useState(false);

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
        bot_estilo: { ...ESTILO_VACIO, ...(res.data.bot_estilo || {}) }
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
  const estilo = form.bot_estilo;
  const cambiarEstilo = (cambios) => setForm(f => ({ ...f, bot_estilo: { ...f.bot_estilo, ...cambios } }));
  const cambiarFaq = (index, cambios) => cambiarEstilo({ faq: estilo.faq.map((f, i) => (i === index ? { ...f, ...cambios } : f)) });
  const saludoEjemplo = estilo.saludo
    || `¡Hola! ${estilo.nombre_asistente ? `Soy ${estilo.nombre_asistente}. ` : ''}Te ayudo con precios, horarios${datos.tiene_domicilio ? ', domicilios' : ''} y cómo hacer tu pedido.`;

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

      {/* 1. Información del negocio */}
      <h4 className="conf-subtitulo"><Store size={16} /> Información del negocio</h4>
      <div className="conf-campos">
        <label className="conf-campo">
          <span>Horario de atención</span>
          <input type="text" maxLength={300} placeholder="Ej. Lunes a sábado de 10 a. m. a 8 p. m." {...campo('bot_horario')} />
        </label>
        {datos.tiene_domicilio && (
          <>
            <label className="conf-campo">
              <span>Costo del domicilio</span>
              <input type="number" min="0" inputMode="numeric" placeholder="Ej. 5000" {...campo('bot_envio_costo')} />
            </label>
            <label className="conf-campo conf-campo--ancho">
              <span>Condiciones del domicilio</span>
              <textarea rows={2} maxLength={1500}
                placeholder="Ej. Llevamos a Laureles, Belén y Estadio. Llega en 30 a 45 minutos. Gratis en compras desde $80.000."
                {...campo('bot_envio_info')} />
            </label>
          </>
        )}
        <label className="conf-campo conf-campo--ancho">
          <span>Otra información útil</span>
          <textarea rows={2} maxLength={3000}
            placeholder="Ej. Recibimos efectivo y Nequi. Hacemos cambios en 8 días con factura."
            {...campo('bot_info_extra')} />
        </label>
      </div>

      {/* 2. Personalidad */}
      <h4 className="conf-subtitulo"><Sparkles size={16} /> Personalidad del asistente</h4>
      <div className="conf-campos">
        <label className="conf-campo">
          <span>Nombre del asistente (opcional)</span>
          <input type="text" maxLength={40} placeholder="Ej. Lucía"
            value={estilo.nombre_asistente} onChange={(e) => cambiarEstilo({ nombre_asistente: e.target.value })} />
        </label>
        <div className="conf-campo">
          <span>¿Usa emojis? 😊</span>
          <div className="conf-opciones-si-no">
            <button type="button" className={estilo.emojis ? 'activa' : ''} onClick={() => cambiarEstilo({ emojis: true })}>Sí</button>
            <button type="button" className={!estilo.emojis ? 'activa' : ''} onClick={() => cambiarEstilo({ emojis: false })}>No</button>
          </div>
        </div>
        <div className="conf-campo conf-campo--ancho">
          <span>Forma de hablar</span>
          <div className="conf-tonos">
            {TONOS.map(t => (
              <button key={t.valor} type="button"
                className={`conf-tono ${estilo.tono === t.valor ? 'activa' : ''}`}
                onClick={() => cambiarEstilo({ tono: t.valor })}>
                <strong>{t.titulo}</strong>
                <small>"{t.ejemplo}"</small>
              </button>
            ))}
          </div>
        </div>
        <label className="conf-campo conf-campo--ancho">
          <span>Mensaje de bienvenida (opcional)</span>
          <input type="text" maxLength={200} placeholder={saludoEjemplo}
            value={estilo.saludo} onChange={(e) => cambiarEstilo({ saludo: e.target.value })} />
          <small className="conf-nota">Así lo verá el cliente al abrir el chat:</small>
          <div className="conf-burbuja-ejemplo">{saludoEjemplo}</div>
        </label>
      </div>

      {/* 3. Preguntas frecuentes */}
      <h4 className="conf-subtitulo"><CircleHelp size={16} /> Preguntas frecuentes</h4>
      <p className="conf-ayuda">Escribe preguntas que te hacen seguido y cómo quieres que el asistente las responda.</p>
      <div className="conf-faq">
        {estilo.faq.map((f, i) => (
          <div key={i} className="conf-faq-item">
            <div className="conf-faq-campos">
              <input type="text" maxLength={150} placeholder="Pregunta. Ej. ¿Hacen envíos a otras ciudades?"
                value={f.pregunta} onChange={(e) => cambiarFaq(i, { pregunta: e.target.value })} />
              <textarea rows={2} maxLength={500} placeholder="Respuesta. Ej. Sí, por Servientrega; llega en 2 a 4 días."
                value={f.respuesta} onChange={(e) => cambiarFaq(i, { respuesta: e.target.value })} />
            </div>
            <button type="button" className="conf-faq-quitar" title="Quitar pregunta"
              onClick={() => cambiarEstilo({ faq: estilo.faq.filter((_, j) => j !== i) })}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {estilo.faq.length < 15 && (
          <button type="button" className="conf-btn conf-faq-agregar"
            onClick={() => cambiarEstilo({ faq: [...estilo.faq, { pregunta: '', respuesta: '' }] })}>
            <Plus size={16} /> Agregar pregunta
          </button>
        )}
      </div>

      <label className="conf-campo conf-campo--ancho conf-indicaciones">
        <span>Algo más que deba saber o tener en cuenta (opcional)</span>
        <textarea rows={2} maxLength={1000}
          placeholder="Escríbelo como se lo dirías a un empleado nuevo. Ej. Recomienda los paquetes porque salen más baratos."
          value={estilo.indicaciones} onChange={(e) => cambiarEstilo({ indicaciones: e.target.value })} />
      </label>

      <div className="conf-acciones conf-acciones-fin">
        <button type="button" onClick={() => guardar()} disabled={guardando} className="btn-guardar conf-btn-guardar">
          {guardando ? 'Guardando...' : '💾 Guardar asistente'}
        </button>
      </div>

      <button type="button" className="conf-link" onClick={() => setVerPreguntas(v => !v)}>
        <MessageSquareText size={15} />
        {verPreguntas ? 'Ocultar preguntas' : `Ver lo que preguntan los clientes (${datos.preguntas_hoy} hoy)`}
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
