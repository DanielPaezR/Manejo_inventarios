import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useJuegosActivos } from './comunes';
import './Juegos.css';

// Contador de dominó: las 28 fichas en una matriz triangular (fila N =
// fichas N-N … N-6). Se marcan las que van saliendo para saber qué queda en
// juego. La partida se guarda en el celular y la pantalla no se apaga.

const FICHAS = [];
for (let a = 0; a <= 6; a++) {
  for (let b = a; b <= 6; b++) FICHAS.push(`${a}-${b}`);
}
const FILAS = [0, 1, 2, 3, 4, 5, 6].map(a => FICHAS.filter(f => Number(f.split('-')[0]) === a));

// Posiciones de los puntos en una cuadrícula de 3x3 (0..8) para cada número.
const PUNTOS = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8]
};

const Mitad = ({ valor }) => (
  <span className="dm-mitad" aria-hidden="true">
    {Array.from({ length: 9 }, (_, i) => (
      <span key={i} className={PUNTOS[valor].includes(i) ? 'dm-punto' : ''} />
    ))}
  </span>
);

const vibrar = () => { try { navigator.vibrate?.(12); } catch { /* sin vibración */ } };

const JuegoDomino = () => {
  const { moduloId } = useParams();
  const clave = `domino-partida-${moduloId}`;
  // Orden en que salieron las fichas (para deshacer y el historial).
  const [jugadas, setJugadas] = useState(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem(clave) || '[]');
      return Array.isArray(guardado) ? guardado.filter(f => FICHAS.includes(f)) : [];
    } catch {
      return [];
    }
  });
  const [numeroResaltado, setNumeroResaltado] = useState(null);
  const bloqueoRef = useRef(null);
  const activos = useJuegosActivos(moduloId);

  useEffect(() => {
    try { localStorage.setItem(clave, JSON.stringify(jugadas)); } catch { /* modo privado */ }
  }, [clave, jugadas]);

  // Pantalla encendida mientras se juega (si el navegador lo permite).
  useEffect(() => {
    const pedir = async () => {
      try { bloqueoRef.current = await navigator.wakeLock?.request('screen'); } catch { /* no disponible */ }
    };
    pedir();
    const alVolver = () => { if (document.visibilityState === 'visible') pedir(); };
    document.addEventListener('visibilitychange', alVolver);
    document.title = 'Dominó';
    return () => {
      document.removeEventListener('visibilitychange', alVolver);
      bloqueoRef.current?.release?.().catch(() => {});
    };
  }, []);

  const jugadasSet = useMemo(() => new Set(jugadas), [jugadas]);
  const quedan = 28 - jugadas.length;
  // Cada número aparece en 7 fichas; cuántas de ellas siguen en juego.
  const porNumero = useMemo(() => [0, 1, 2, 3, 4, 5, 6].map(n =>
    FICHAS.filter(f => f.split('-').map(Number).includes(n) && !jugadasSet.has(f)).length
  ), [jugadasSet]);

  const alternar = (ficha) => {
    vibrar();
    setJugadas(prev => (prev.includes(ficha) ? prev.filter(f => f !== ficha) : [...prev, ficha]));
  };
  const deshacer = () => { vibrar(); setJugadas(prev => prev.slice(0, -1)); };
  const reiniciar = () => {
    if (jugadas.length === 0 || window.confirm('¿Empezar una partida nueva? Todas las fichas vuelven a quedar en juego.')) {
      setJugadas([]);
      setNumeroResaltado(null);
    }
  };

  if (activos === false) {
    return (
      <div className="jg">
        <div className="jg-inicio" style={{ '--jg-c1': '#374151', '--jg-c2': '#1f2937' }}>
          <div className="jg-inicio__emoji">🎲</div>
          <p>Los juegos no están disponibles en este negocio.</p>
          <Link to={`/menu/${moduloId}`} className="jg-btn jg-btn--grande">Volver</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="jg jg-domino">
      <header className="jg-cabecera">
        <Link to={`/menu/${moduloId}/juegos`} className="jg-volver" aria-label="Volver a juegos">‹</Link>
        <div>
          <h1>Dominó</h1>
          <p>Toca las fichas a medida que salen</p>
        </div>
        <div className="dm-contador" aria-live="polite">
          <strong>{quedan}</strong>
          <span>de 28<br />por salir</span>
        </div>
      </header>

      <div className="dm-barra" style={{ '--avance': `${(jugadas.length / 28) * 100}%` }} aria-hidden="true"><span /></div>

      <section className="dm-numeros" aria-label="Fichas que quedan de cada número">
        {porNumero.map((cuantas, n) => (
          <button key={n} type="button"
            className={`dm-numero ${numeroResaltado === n ? 'activo' : ''} ${cuantas === 0 ? 'agotado' : ''}`}
            onClick={() => setNumeroResaltado(v => (v === n ? null : n))}
            aria-pressed={numeroResaltado === n}
            aria-label={`Número ${n}: quedan ${cuantas} de 7`}>
            <span className="dm-numero__valor">{n}</span>
            <span className="dm-numero__barras" aria-hidden="true">
              {Array.from({ length: 7 }, (_, i) => <i key={i} className={i < cuantas ? 'lleno' : ''} />)}
            </span>
            <small>{cuantas}/7</small>
          </button>
        ))}
      </section>
      <p className="dm-ayuda">
        {numeroResaltado === null
          ? 'Toca un número para resaltar sus fichas.'
          : porNumero[numeroResaltado] === 0
            ? `Ya salieron todas las fichas con ${numeroResaltado}: quien juegue a ese número se tranca.`
            : `Quedan ${porNumero[numeroResaltado]} ${porNumero[numeroResaltado] === 1 ? 'ficha' : 'fichas'} con ${numeroResaltado}.`}
      </p>

      <section className="dm-triangulo" aria-label="Fichas del dominó">
        {FILAS.map((fila, i) => (
          <div key={i} className="dm-fila">
            {fila.map(ficha => {
              const [a, b] = ficha.split('-').map(Number);
              const jugada = jugadasSet.has(ficha);
              const resaltada = numeroResaltado !== null && (a === numeroResaltado || b === numeroResaltado);
              return (
                <button key={ficha} type="button"
                  className={`dm-ficha ${jugada ? 'jugada' : ''} ${resaltada ? 'resaltada' : ''} ${numeroResaltado !== null && !resaltada ? 'atenuada' : ''} ${a === b ? 'doble' : ''}`}
                  onClick={() => alternar(ficha)}
                  aria-pressed={jugada}
                  aria-label={`Ficha ${a}-${b}${jugada ? ', ya salió' : ''}`}>
                  <Mitad valor={a} />
                  <span className="dm-linea" />
                  <Mitad valor={b} />
                </button>
              );
            })}
          </div>
        ))}
      </section>

      {jugadas.length > 0 && (
        <section className="dm-historial" aria-label="Últimas fichas que salieron">
          <span>Últimas:</span>
          {jugadas.slice(-8).reverse().map(f => <b key={f}>{f}</b>)}
        </section>
      )}

      <footer className="dm-acciones">
        <button type="button" className="jg-btn jg-btn--suave" onClick={deshacer} disabled={jugadas.length === 0}>↶ Deshacer</button>
        <button type="button" className="jg-btn" onClick={reiniciar}>⟲ Reiniciar juego</button>
      </footer>
    </div>
  );
};

export default JuegoDomino;
