import React, { useState, useRef, useEffect } from 'react';
import apiPublico from '../services/apiPublico';
import './AsistenteMenu.css';

// Id de la conversación (para que el negocio vea las preguntas agrupadas).
const nuevaSesion = () =>
  (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const SUGERENCIAS_BASE = ['¿A qué horas atienden?', '¿Qué medios de pago reciben?', '¿Cómo hago un pedido?'];

// Chat del asistente automático en el menú/catálogo público. Responde con la
// información del negocio (ver backend/src/helpers/asistenteBot.js).
const AsistenteMenu = ({ moduloId, modulo, subirPorCarrito }) => {
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const sesionRef = useRef(nuevaSesion());
  const listaRef = useRef(null);
  const inputRef = useRef(null);

  const nombre = modulo?.nombre_publico || 'el negocio';
  const sugerencias = modulo?.tiene_domicilio
    ? ['¿Cuánto cuesta el domicilio?', ...SUGERENCIAS_BASE]
    : SUGERENCIAS_BASE;

  useEffect(() => {
    listaRef.current?.scrollTo({ top: listaRef.current.scrollHeight, behavior: 'smooth' });
  }, [mensajes, enviando]);

  useEffect(() => {
    if (abierto) inputRef.current?.focus();
  }, [abierto]);

  const enviar = async (pregunta) => {
    const limpia = pregunta.trim();
    if (!limpia || enviando) return;
    const historial = [...mensajes, { rol: 'user', texto: limpia }];
    setMensajes(historial);
    setTexto('');
    setError('');
    try {
      setEnviando(true);
      const res = await apiPublico.post(`/menu/${moduloId}/bot`, { mensajes: historial, sesion: sesionRef.current });
      setMensajes(prev => [...prev, { rol: 'assistant', texto: res.data.respuesta }]);
    } catch (err) {
      setError(err.response?.data?.error || 'No pude responder. Intenta de nuevo.');
      // Se quita la pregunta sin respuesta para que el historial siga
      // alternando y se pueda reintentar.
      setMensajes(prev => prev.slice(0, -1));
      setTexto(limpia);
    } finally {
      setEnviando(false);
    }
  };

  if (!abierto) {
    return (
      <button
        type="button"
        className={`am-burbuja ${subirPorCarrito ? 'am-burbuja--alta' : ''}`}
        onClick={() => setAbierto(true)}
        aria-label="Abrir el asistente para hacer preguntas"
      >
        <span aria-hidden="true">💬</span>
        <span className="am-burbuja__texto">Pregúntanos</span>
      </button>
    );
  }

  return (
    <div className="am-panel" role="dialog" aria-label={`Asistente de ${nombre}`}>
      <div className="am-panel__header">
        <div>
          <strong>Asistente de {nombre}</strong>
          <small>Respuestas automáticas con la información del negocio</small>
        </div>
        <button type="button" className="am-cerrar" onClick={() => setAbierto(false)} aria-label="Cerrar">✕</button>
      </div>

      <div className="am-mensajes" ref={listaRef} aria-live="polite">
        <div className="am-msg am-msg--bot">
          ¡Hola! Te ayudo con precios, horarios{modulo?.tiene_domicilio ? ', domicilios' : ''} y cómo hacer tu pedido. ¿Qué necesitas?
        </div>
        {mensajes.map((m, i) => (
          <div key={i} className={`am-msg ${m.rol === 'user' ? 'am-msg--yo' : 'am-msg--bot'}`}>{m.texto}</div>
        ))}
        {enviando && <div className="am-msg am-msg--bot am-escribiendo"><span /><span /><span /></div>}
        {mensajes.length === 0 && !enviando && (
          <div className="am-sugerencias">
            {sugerencias.map(s => (
              <button key={s} type="button" className="am-sugerencia" onClick={() => enviar(s)}>{s}</button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="am-error">{error}</p>}

      <form className="am-form" onSubmit={(e) => { e.preventDefault(); enviar(texto); }}>
        <input
          ref={inputRef}
          type="text"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escribe tu pregunta..."
          maxLength={500}
          disabled={enviando}
          aria-label="Tu pregunta"
        />
        <button type="submit" disabled={enviando || !texto.trim()}>Enviar</button>
      </form>
    </div>
  );
};

export default AsistenteMenu;
