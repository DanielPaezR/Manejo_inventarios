import React, { useState, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useJuegosActivos } from './comunes';
import { usePantallaEncendida, vibrarCorto } from './apoyos';
import './Juegos.css';
import './ZonaJuegos.css';
import './Apoyos.css';

// Reloj de ajedrez: el celular va en la mesa entre los dos jugadores. La
// mitad de arriba está girada para el de enfrente. Cada uno toca SU mitad
// al terminar su jugada y empieza a correr el tiempo del otro.
const TIEMPOS = [
  { id: '1+0', nombre: 'Bala', min: 1, inc: 0 },
  { id: '3+2', nombre: 'Relámpago', min: 3, inc: 2 },
  { id: '5+0', nombre: 'Blitz', min: 5, inc: 0 },
  { id: '10+0', nombre: 'Rápida', min: 10, inc: 0 },
  { id: '15+10', nombre: 'Rápida +', min: 15, inc: 10 },
  { id: '30+0', nombre: 'Clásica', min: 30, inc: 0 }
];

const formato = (ms) => {
  const total = Math.max(0, ms);
  if (total < 10000) {
    const s = Math.floor(total / 1000);
    const d = Math.floor((total % 1000) / 100);
    return `0:0${s}.${d}`;
  }
  const s = Math.ceil(total / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

const RelojAjedrez = () => {
  const { moduloId } = useParams();
  const activos = useJuegosActivos(moduloId);
  usePantallaEncendida();

  const [config, setConfig] = useState(TIEMPOS[2]);
  const [personal, setPersonal] = useState({ min: 7, inc: 3 });
  const [tiempos, setTiempos] = useState([TIEMPOS[2].min * 60000, TIEMPOS[2].min * 60000]);
  const [turno, setTurno] = useState(null); // null = sin empezar; 0 = arriba; 1 = abajo
  const [pausado, setPausado] = useState(false);
  const [jugadas, setJugadas] = useState([0, 0]);
  const [caido, setCaido] = useState(null);
  const ultimoRef = useRef(null);

  useEffect(() => { document.title = 'Reloj de ajedrez'; }, []);

  // Corre el reloj del jugador en turno.
  useEffect(() => {
    if (turno === null || pausado || caido !== null) return undefined;
    ultimoRef.current = performance.now();
    const t = setInterval(() => {
      const ahora = performance.now();
      const delta = ahora - ultimoRef.current;
      ultimoRef.current = ahora;
      setTiempos(prev => {
        const nuevo = [...prev];
        nuevo[turno] = Math.max(0, nuevo[turno] - delta);
        if (nuevo[turno] === 0) {
          setCaido(turno);
          vibrarCorto(600);
        }
        return nuevo;
      });
    }, 50);
    return () => clearInterval(t);
  }, [turno, pausado, caido]);

  const elegir = (c) => {
    setConfig(c);
    setTiempos([c.min * 60000, c.min * 60000]);
    setTurno(null);
    setPausado(false);
    setJugadas([0, 0]);
    setCaido(null);
  };

  // Toca su mitad quien acaba de jugar: suma el incremento y pasa el turno.
  const tocar = (lado) => {
    if (caido !== null || pausado) return;
    if (turno === null) {
      // Empieza la partida: corre el reloj del otro (quien juega primero).
      vibrarCorto(20);
      setTurno(1 - lado);
      return;
    }
    if (turno !== lado) return;
    vibrarCorto(20);
    setTiempos(prev => {
      const nuevo = [...prev];
      nuevo[lado] += config.inc * 1000;
      return nuevo;
    });
    setJugadas(prev => prev.map((j, i) => (i === lado ? j + 1 : j)));
    setTurno(1 - lado);
  };

  const reiniciar = () => {
    if (turno === null || window.confirm('¿Reiniciar el reloj?')) elegir(config);
  };

  if (activos === false) {
    return (
      <div className="jg">
        <div className="jg-inicio" style={{ '--jg-c1': '#374151', '--jg-c2': '#1f2937' }}>
          <div className="jg-inicio__emoji">♞</div>
          <p>Los juegos no están disponibles en este negocio.</p>
          <Link to={`/menu/${moduloId}`} className="jg-btn jg-btn--grande">Volver</Link>
        </div>
      </div>
    );
  }

  const Mitad = ({ lado }) => {
    const activo = turno === lado && caido === null;
    const poco = tiempos[lado] < 20000;
    return (
      <button type="button"
        className={`ra-mitad ${lado === 0 ? 'ra-mitad--arriba' : ''} ${activo ? 'activa' : ''} ${poco && turno !== null ? 'poco' : ''} ${caido === lado ? 'caido' : ''} ${caido !== null && caido !== lado ? 'gana' : ''}`}
        onClick={() => tocar(lado)}
        aria-label={`Reloj del jugador ${lado === 0 ? 'de arriba' : 'de abajo'}: ${formato(tiempos[lado])}`}>
        <span className="ra-tiempo">{formato(tiempos[lado])}</span>
        <span className="ra-info">
          {caido === lado ? '⏰ Se acabó tu tiempo'
            : caido !== null ? '🏆 ¡Ganaste por tiempo!'
              : turno === null ? 'Si juegas con negras, toca aquí para empezar'
                : `Jugadas: ${jugadas[lado]}${activo ? ' · Te toca' : ''}`}
        </span>
      </button>
    );
  };

  return (
    <div className="ra">
      <Mitad lado={0} />

      <div className="ra-centro">
        <Link to={`/menu/${moduloId}/juegos`} className="ra-boton" aria-label="Salir">‹</Link>
        {turno === null ? (
          <div className="ra-tiempos" role="radiogroup" aria-label="Tiempo de la partida">
            {TIEMPOS.map(c => (
              <button key={c.id} type="button" role="radio" aria-checked={config.id === c.id}
                className={config.id === c.id ? 'activo' : ''} onClick={() => elegir(c)}>
                <b>{c.id}</b><small>{c.nombre}</small>
              </button>
            ))}
            <button type="button" role="radio" aria-checked={config.id === 'personal'}
              className={config.id === 'personal' ? 'activo' : ''}
              onClick={() => elegir({ id: 'personal', nombre: 'Personal', ...personal })}>
              <b>{personal.min}+{personal.inc}</b><small>Personal</small>
            </button>
          </div>
        ) : (
          <div className="ra-acciones">
            <button type="button" className="ra-boton ra-boton--grande" onClick={() => setPausado(p => !p)} disabled={caido !== null}>
              {pausado ? '▶' : '❚❚'}
            </button>
            <span className="ra-modo">{config.min} min{config.inc ? ` + ${config.inc} s` : ''}</span>
          </div>
        )}
        <button type="button" className="ra-boton" onClick={reiniciar} aria-label="Reiniciar">⟲</button>
      </div>

      {turno === null && config.id === 'personal' && (
        <div className="ra-personal">
          <label>Minutos <input type="number" min="1" max="180" value={personal.min}
            onChange={(e) => { const v = Math.max(1, Math.min(180, Number(e.target.value) || 1)); setPersonal(p => ({ ...p, min: v })); elegir({ id: 'personal', nombre: 'Personal', min: v, inc: personal.inc }); }} /></label>
          <label>Incremento (s) <input type="number" min="0" max="60" value={personal.inc}
            onChange={(e) => { const v = Math.max(0, Math.min(60, Number(e.target.value) || 0)); setPersonal(p => ({ ...p, inc: v })); elegir({ id: 'personal', nombre: 'Personal', min: personal.min, inc: v }); }} /></label>
        </div>
      )}

      <Mitad lado={1} />
      {pausado && <div className="ra-pausa" onClick={() => setPausado(false)}>En pausa · toca para seguir</div>}
    </div>
  );
};

export default RelojAjedrez;
