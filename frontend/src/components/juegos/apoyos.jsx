import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

// Piezas comunes de los apoyos para juegos de mesa (reloj de ajedrez,
// anotador de cartas, tiro al blanco): cabecera, editor de jugadores,
// estado guardado en el celular y pantalla siempre encendida.

export const CabeceraApoyo = ({ moduloId, titulo, subtitulo, derecha }) => (
  <header className="jg-cabecera">
    <Link to={`/menu/${moduloId}/juegos`} className="jg-volver" aria-label="Volver a juegos">‹</Link>
    <div>
      <h1>{titulo}</h1>
      {subtitulo && <p>{subtitulo}</p>}
    </div>
    {derecha}
  </header>
);

// Estado que se guarda solo en el celular (sobrevive si se cierra la página).
export const useEstadoGuardado = (clave, inicial) => {
  const [valor, setValor] = useState(() => {
    try {
      const guardado = localStorage.getItem(clave);
      return guardado ? JSON.parse(guardado) : inicial;
    } catch {
      return inicial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* modo privado */ }
  }, [clave, valor]);
  return [valor, setValor];
};

// Mantiene la pantalla encendida mientras la página está abierta.
export const usePantallaEncendida = () => {
  const bloqueo = useRef(null);
  useEffect(() => {
    const pedir = async () => {
      try { bloqueo.current = await navigator.wakeLock?.request('screen'); } catch { /* no disponible */ }
    };
    pedir();
    const alVolver = () => { if (document.visibilityState === 'visible') pedir(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      document.removeEventListener('visibilitychange', alVolver);
      bloqueo.current?.release?.().catch(() => {});
    };
  }, []);
};

export const COLORES_JUGADOR = ['#f472b6', '#60a5fa', '#facc15', '#4ade80', '#fb923c', '#a78bfa', '#2dd4bf', '#f87171'];

// Editor de la lista de jugadores (2 a 8).
export const EditorJugadores = ({ jugadores, onCambiar, minimo = 2, maximo = 8 }) => {
  const [nuevo, setNuevo] = useState('');
  const agregar = () => {
    const nombre = nuevo.trim().slice(0, 16) || `Jugador ${jugadores.length + 1}`;
    if (jugadores.length >= maximo) return;
    onCambiar([...jugadores, nombre]);
    setNuevo('');
  };
  return (
    <div className="ap-jugadores">
      {jugadores.map((j, i) => (
        <div key={i} className="ap-jugador" style={{ '--color': COLORES_JUGADOR[i % COLORES_JUGADOR.length] }}>
          <span className="ap-jugador__punto" />
          <input type="text" value={j} maxLength={16} aria-label={`Nombre del jugador ${i + 1}`}
            onChange={(e) => onCambiar(jugadores.map((x, k) => (k === i ? e.target.value : x)))} />
          {jugadores.length > minimo && (
            <button type="button" className="ap-quitar" onClick={() => onCambiar(jugadores.filter((_, k) => k !== i))} aria-label={`Quitar a ${j}`}>✕</button>
          )}
        </div>
      ))}
      {jugadores.length < maximo && (
        <div className="ap-jugador ap-jugador--nuevo">
          <span className="ap-jugador__punto">+</span>
          <input type="text" value={nuevo} maxLength={16} placeholder="Agregar jugador"
            onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && agregar()} />
          <button type="button" className="jg-btn ap-agregar" onClick={agregar}>Agregar</button>
        </div>
      )}
    </div>
  );
};

export const vibrarCorto = (ms = 15) => { try { navigator.vibrate?.(ms); } catch { /* sin vibración */ } };
