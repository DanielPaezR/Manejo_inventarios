import React, { useState, useEffect, useRef } from 'react';
import { barajar, vibrar } from './comunes';

// Memoria: 8 parejas de emojis boca abajo. Menos jugadas y menos tiempo,
// más puntos.
const MAZOS = [
  ['🍕', '🍔', '🌮', '🍩', '🍦', '🍉', '🍓', '🥑', '🍪', '🧁', '🍿', '🥨'],
  ['🐶', '🐱', '🐰', '🦊', '🐻', '🐼', '🐸', '🐵', '🦁', '🐯', '🐷', '🐮'],
  ['⚽', '🏀', '🎸', '🎮', '🚀', '🎈', '🎁', '🌈', '⭐', '🌙', '🔥', '💎']
];

const JuegoMemoria = ({ onFin, activo }) => {
  const [cartas] = useState(() => {
    const mazo = MAZOS[Math.floor(Math.random() * MAZOS.length)];
    const elegidos = barajar(mazo).slice(0, 8);
    return barajar([...elegidos, ...elegidos]).map((emoji, i) => ({ id: i, emoji }));
  });
  const [abiertas, setAbiertas] = useState([]);
  const [encontradas, setEncontradas] = useState(new Set());
  const [jugadas, setJugadas] = useState(0);
  const [segundos, setSegundos] = useState(0);
  const inicioRef = useRef(null);

  useEffect(() => {
    if (!activo) return undefined;
    const t = setInterval(() => {
      if (inicioRef.current) setSegundos(Math.floor((Date.now() - inicioRef.current) / 1000));
    }, 250);
    return () => clearInterval(t);
  }, [activo]);

  const tocar = (carta) => {
    if (!activo || abiertas.length === 2 || abiertas.includes(carta.id) || encontradas.has(carta.emoji)) return;
    if (!inicioRef.current) inicioRef.current = Date.now();
    vibrar(8);
    const nuevas = [...abiertas, carta.id];
    setAbiertas(nuevas);
    if (nuevas.length === 2) {
      setJugadas(j => j + 1);
      const [a, b] = nuevas.map(id => cartas[id]);
      if (a.emoji === b.emoji) {
        const total = new Set(encontradas).add(a.emoji);
        setTimeout(() => {
          setEncontradas(total);
          setAbiertas([]);
          vibrar(30);
          if (total.size === 8) {
            const seg = Math.max(1, Math.round((Date.now() - inicioRef.current) / 1000));
            const movs = jugadas + 1;
            const puntaje = Math.max(100, Math.min(2000, 1500 - (movs - 8) * 25 - seg * 6));
            onFin({ puntaje, duracion: seg, detalle: `${movs} jugadas en ${seg} segundos` });
          }
        }, 350);
      } else {
        setTimeout(() => setAbiertas([]), 750);
      }
    }
  };

  return (
    <div className="jm">
      <div className="jg-hud">
        <span>🔁 {jugadas} jugadas</span>
        <span>⏱️ {segundos}s</span>
        <span>✅ {encontradas.size}/8</span>
      </div>
      <div className="jm-tablero">
        {cartas.map(c => {
          const visible = abiertas.includes(c.id) || encontradas.has(c.emoji);
          return (
            <button key={c.id} type="button" className={`jm-carta ${visible ? 'volteada' : ''} ${encontradas.has(c.emoji) ? 'lista' : ''}`}
              onClick={() => tocar(c)} aria-label={visible ? c.emoji : 'Carta boca abajo'}>
              <span className="jm-cara jm-cara--atras">?</span>
              <span className="jm-cara jm-cara--frente">{c.emoji}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default JuegoMemoria;
