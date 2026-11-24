import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { vibrar } from './comunes';
import TriquiEnLinea from './TriquiEnLinea';

// Tres en raya: contra el celular (fácil o difícil) o dos personas en el
// mismo teléfono, o en línea con alguien de otra mesa (código de sala).
// Sin podio: es para pasar el rato.
const LINEAS = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const ganador = (t) => {
  for (const [a, b, c] of LINEAS) if (t[a] && t[a] === t[b] && t[a] === t[c]) return { quien: t[a], linea: [a, b, c] };
  return t.every(Boolean) ? { quien: 'empate', linea: [] } : null;
};

// Minimax: el celular nunca pierde en "difícil".
const minimax = (t, turno) => {
  const g = ganador(t);
  if (g) return { valor: g.quien === 'O' ? 1 : g.quien === 'X' ? -1 : 0 };
  let mejor = { valor: turno === 'O' ? -2 : 2, pos: -1 };
  t.forEach((v, i) => {
    if (v) return;
    const copia = [...t];
    copia[i] = turno;
    const r = minimax(copia, turno === 'O' ? 'X' : 'O');
    if ((turno === 'O' && r.valor > mejor.valor) || (turno === 'X' && r.valor < mejor.valor)) mejor = { valor: r.valor, pos: i };
  });
  return mejor;
};

const JuegoTriqui = ({ onFin, activo }) => {
  const [params] = useSearchParams();
  const salaEnlace = params.get('sala') || '';
  const [modo, setModo] = useState(salaEnlace ? 'linea' : null); // facil | dificil | dos | linea
  const [tablero, setTablero] = useState(Array(9).fill(null));
  const [turno, setTurno] = useState('X');
  const resultado = ganador(tablero);

  useEffect(() => {
    if (!resultado) return undefined;
    vibrar(resultado.quien === 'empate' ? 30 : 80);
    const t = setTimeout(() => {
      const titulo = resultado.quien === 'empate' ? '¡Empate!'
        : modo === 'dos' ? `¡Ganó ${resultado.quien}!`
          : resultado.quien === 'X' ? '¡Le ganaste al celular!' : 'Ganó el celular 🤖';
      onFin({ puntaje: 0, duracion: 0, titulo, detalle: modo === 'dificil' && resultado.quien !== 'O' ? 'En modo difícil empatarle ya es un logro.' : '' });
    }, 900);
    return () => clearTimeout(t);
  }, [resultado?.quien]); // eslint-disable-line react-hooks/exhaustive-deps

  // Turno del celular.
  useEffect(() => {
    if (!activo || !modo || modo === 'dos' || turno !== 'O' || resultado) return undefined;
    const t = setTimeout(() => {
      const libres = tablero.map((v, i) => (v ? null : i)).filter(i => i !== null);
      let pos;
      if (modo === 'dificil' || Math.random() < 0.45) pos = minimax(tablero, 'O').pos;
      if (pos === undefined || pos < 0) pos = libres[Math.floor(Math.random() * libres.length)];
      const nuevo = [...tablero];
      nuevo[pos] = 'O';
      setTablero(nuevo);
      setTurno('X');
    }, 450);
    return () => clearTimeout(t);
  }, [turno, modo, activo]); // eslint-disable-line react-hooks/exhaustive-deps

  const jugar = (i) => {
    if (!activo || tablero[i] || resultado || (modo !== 'dos' && turno === 'O')) return;
    vibrar(8);
    const nuevo = [...tablero];
    nuevo[i] = turno;
    setTablero(nuevo);
    setTurno(turno === 'X' ? 'O' : 'X');
  };

  if (modo === 'linea') {
    return <TriquiEnLinea codigoInicial={salaEnlace} onSalir={() => setModo(null)} />;
  }

  if (!modo) {
    return (
      <div className="jtr-modos">
        <p>¿Cómo quieres jugar?</p>
        <button type="button" className="jg-btn" onClick={() => setModo('facil')}>🤖 Contra el celular · Fácil</button>
        <button type="button" className="jg-btn" onClick={() => setModo('dificil')}>🧠 Contra el celular · Difícil</button>
        <button type="button" className="jg-btn jg-btn--suave" onClick={() => setModo('dos')}>👥 Dos personas en este celular</button>
        <button type="button" className="jg-btn jtr-modos__linea" onClick={() => setModo('linea')}>📲 Con alguien de otra mesa</button>
      </div>
    );
  }

  return (
    <div className="jtr">
      <div className="jg-hud">
        <span>{modo === 'dos' ? 'Dos jugadores' : modo === 'facil' ? 'Fácil' : 'Difícil'}</span>
        <span>{resultado ? 'Fin' : modo !== 'dos' && turno === 'O' ? 'Piensa el celular…' : `Turno de ${turno}`}</span>
      </div>
      <div className="jtr-tablero">
        {tablero.map((v, i) => (
          <button key={i} type="button" className={`jtr-celda ${v ? `jtr-celda--${v}` : ''} ${resultado?.linea.includes(i) ? 'gana' : ''}`}
            onClick={() => jugar(i)} aria-label={v || `Casilla ${i + 1}`}>
            {v === 'X' ? '✕' : v === 'O' ? '◯' : ''}
          </button>
        ))}
      </div>
    </div>
  );
};

export default JuegoTriqui;
