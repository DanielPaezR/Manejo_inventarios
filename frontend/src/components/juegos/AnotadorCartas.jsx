import React, { useState, useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useJuegosActivos } from './comunes';
import { CabeceraApoyo, EditorJugadores, useEstadoGuardado, usePantallaEncendida, vibrarCorto, COLORES_JUGADOR } from './apoyos';
import './Juegos.css';
import './ZonaJuegos.css';
import './Apoyos.css';

// Anotador de cartas: sirve para cualquier juego que se lleve por puntos
// (rondas). Se puede poner un puntaje objetivo y si gana el que más o el
// que menos puntos tiene.
const INICIAL = { fase: 'config', jugadores: ['Jugador 1', 'Jugador 2'], objetivo: '', modo: 'mas', rondas: [] };

const AnotadorCartas = () => {
  const { moduloId } = useParams();
  const activos = useJuegosActivos(moduloId);
  usePantallaEncendida();
  const [estado, setEstado] = useEstadoGuardado(`cartas-${moduloId}`, INICIAL);
  const [ronda, setRonda] = useState(null); // puntos de la ronda que se está anotando

  useEffect(() => { document.title = 'Anotador de cartas'; }, []);

  const { jugadores, objetivo, modo, rondas } = estado;
  const totales = useMemo(() => jugadores.map((_, i) => rondas.reduce((s, r) => s + (Number(r[i]) || 0), 0)), [jugadores, rondas]);
  const meta = Number(objetivo) || 0;
  const alcanzo = meta > 0 && totales.some(t => t >= meta);
  const orden = [...totales.keys()].sort((a, b) => (modo === 'mas' ? totales[b] - totales[a] : totales[a] - totales[b]));
  const lider = rondas.length > 0 ? orden[0] : null;
  const terminado = alcanzo;

  const empezar = () => {
    setEstado(e => ({ ...e, fase: 'juego', rondas: [], jugadores: e.jugadores.map((j, i) => j.trim() || `Jugador ${i + 1}`) }));
  };
  const abrirRonda = () => setRonda(jugadores.map(() => ''));
  const guardarRonda = () => {
    vibrarCorto(20);
    setEstado(e => ({ ...e, rondas: [...e.rondas, ronda.map(v => Number(v) || 0)] }));
    setRonda(null);
  };
  const borrarUltima = () => {
    if (window.confirm('¿Borrar la última ronda?')) setEstado(e => ({ ...e, rondas: e.rondas.slice(0, -1) }));
  };
  const nuevaPartida = () => {
    if (window.confirm('¿Empezar una partida nueva con los mismos jugadores?')) setEstado(e => ({ ...e, rondas: [] }));
  };

  if (activos === false) {
    return (
      <div className="jg">
        <div className="jg-inicio" style={{ '--jg-c1': '#374151', '--jg-c2': '#1f2937' }}>
          <div className="jg-inicio__emoji">🂡</div>
          <p>Los juegos no están disponibles en este negocio.</p>
          <Link to={`/menu/${moduloId}`} className="jg-btn jg-btn--grande">Volver</Link>
        </div>
      </div>
    );
  }

  if (estado.fase === 'config') {
    return (
      <div className="jg ap">
        <CabeceraApoyo moduloId={moduloId} titulo="🂡 Anotador de cartas" subtitulo="Para cualquier juego que se lleve por puntos" />
        <section className="ap-tarjeta">
          <h2>¿Quiénes juegan?</h2>
          <EditorJugadores jugadores={jugadores} onCambiar={(j) => setEstado(e => ({ ...e, jugadores: j }))} />
        </section>
        <section className="ap-tarjeta">
          <h2>¿Cómo se gana?</h2>
          <div className="ap-segmento">
            <button type="button" className={modo === 'mas' ? 'activo' : ''} onClick={() => setEstado(e => ({ ...e, modo: 'mas' }))}>⬆️ Más puntos</button>
            <button type="button" className={modo === 'menos' ? 'activo' : ''} onClick={() => setEstado(e => ({ ...e, modo: 'menos' }))}>⬇️ Menos puntos</button>
          </div>
          <label className="ap-campo">
            <span>Puntaje para terminar (opcional)</span>
            <input type="number" inputMode="numeric" min="0" placeholder="Ej. 100" value={objetivo}
              onChange={(e) => setEstado(s => ({ ...s, objetivo: e.target.value }))} />
            <small>{modo === 'mas' ? 'Gana el primero en llegar a ese puntaje.' : 'Cuando alguien llega a ese puntaje se acaba, y gana el que tenga menos.'}</small>
          </label>
        </section>
        <button type="button" className="jg-btn jg-btn--full" onClick={empezar}>Empezar a anotar</button>
      </div>
    );
  }

  return (
    <div className="jg ap">
      <CabeceraApoyo moduloId={moduloId} titulo="🂡 Anotador"
        subtitulo={`${rondas.length} ${rondas.length === 1 ? 'ronda' : 'rondas'}${meta ? ` · a ${meta} puntos` : ''} · gana ${modo === 'mas' ? 'el que más' : 'el que menos'}`}
        derecha={<button type="button" className="jg-volver" onClick={() => setEstado(e => ({ ...e, fase: 'config' }))} aria-label="Ajustes">⚙</button>} />

      {terminado && (
        <div className="ap-ganador">
          <span>🏆</span>
          <strong>¡Ganó {jugadores[orden[0]]}!</strong>
          <small>con {totales[orden[0]]} puntos</small>
        </div>
      )}

      <div className="ap-marcador">
        {orden.map((i, pos) => (
          <div key={i} className={`ap-total ${lider === i ? 'lider' : ''}`} style={{ '--color': COLORES_JUGADOR[i % COLORES_JUGADOR.length] }}>
            <span className="ap-total__pos">{rondas.length ? `${pos + 1}°` : ''}</span>
            <span className="ap-total__nombre">{lider === i ? '👑 ' : ''}{jugadores[i]}</span>
            <strong>{totales[i]}</strong>
            {meta > 0 && (
              <span className="ap-total__barra"><i style={{ width: `${Math.min(100, Math.max(0, (totales[i] / meta) * 100))}%` }} /></span>
            )}
          </div>
        ))}
      </div>

      {ronda ? (
        <section className="ap-tarjeta ap-ronda">
          <h2>Ronda {rondas.length + 1}</h2>
          {jugadores.map((j, i) => (
            <div key={i} className="ap-ronda__fila" style={{ '--color': COLORES_JUGADOR[i % COLORES_JUGADOR.length] }}>
              <span>{j}</span>
              <div className="ap-ronda__control">
                <button type="button" onClick={() => setRonda(r => r.map((v, k) => (k === i ? String((Number(v) || 0) - 5) : v)))}>−5</button>
                <input type="number" inputMode="numeric" value={ronda[i]} placeholder="0" aria-label={`Puntos de ${j}`}
                  onChange={(e) => setRonda(r => r.map((v, k) => (k === i ? e.target.value : v)))} />
                <button type="button" onClick={() => setRonda(r => r.map((v, k) => (k === i ? String((Number(v) || 0) + 5) : v)))}>+5</button>
              </div>
            </div>
          ))}
          <div className="ap-botones">
            <button type="button" className="jg-btn jg-btn--suave" onClick={() => setRonda(null)}>Cancelar</button>
            <button type="button" className="jg-btn" onClick={guardarRonda}>Guardar ronda</button>
          </div>
        </section>
      ) : (
        <div className="ap-botones">
          {terminado
            ? <button type="button" className="jg-btn" onClick={nuevaPartida}>Nueva partida</button>
            : <button type="button" className="jg-btn" onClick={abrirRonda}>+ Anotar ronda</button>}
          {rondas.length > 0 && <button type="button" className="jg-btn jg-btn--suave" onClick={borrarUltima}>↶ Borrar última</button>}
        </div>
      )}

      {rondas.length > 0 && (
        <section className="ap-tarjeta">
          <h2>Rondas</h2>
          <div className="ap-tabla-wrap">
            <table className="ap-tabla">
              <thead>
                <tr><th>#</th>{jugadores.map((j, i) => <th key={i} style={{ color: COLORES_JUGADOR[i % COLORES_JUGADOR.length] }}>{j}</th>)}</tr>
              </thead>
              <tbody>
                {rondas.map((r, k) => (
                  <tr key={k}><td>{k + 1}</td>{r.map((v, i) => <td key={i}>{v}</td>)}</tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td>Σ</td>{totales.map((t, i) => <td key={i}>{t}</td>)}</tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}
      {!terminado && rondas.length > 0 && (
        <button type="button" className="jg-btn jg-btn--suave jg-btn--full" onClick={nuevaPartida}>Nueva partida</button>
      )}
    </div>
  );
};

export default AnotadorCartas;
