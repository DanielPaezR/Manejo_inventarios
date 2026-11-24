import React, { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useJuegosActivos } from './comunes';
import { CabeceraApoyo, EditorJugadores, useEstadoGuardado, usePantallaEncendida, vibrarCorto, COLORES_JUGADOR } from './apoyos';
import './Juegos.css';
import './ZonaJuegos.css';
import './Apoyos.css';

// Tiro al blanco: cada jugador tira N veces por turno (7 por defecto). Se
// anota cada tiro tocando su valor; al completar los tiros pasa al
// siguiente. Al terminar las rondas, podio con el ganador.
const INICIAL = {
  fase: 'config',
  jugadores: ['Jugador 1', 'Jugador 2'],
  tiros: 7,
  rondas: 1,
  valores: '0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10',
  turnos: [], // [{ jugador, tiros: [..] }] completados
  actual: [] // tiros del turno en curso
};

const leerValores = (texto) => {
  const lista = String(texto).split(/[,\s]+/).map(Number).filter(n => Number.isFinite(n) && n >= 0 && n <= 1000);
  return [...new Set(lista)].sort((a, b) => a - b);
};

const TiroAlBlanco = () => {
  const { moduloId } = useParams();
  const activos = useJuegosActivos(moduloId);
  usePantallaEncendida();
  const [estado, setEstado] = useEstadoGuardado(`tiro-${moduloId}`, INICIAL);

  useEffect(() => { document.title = 'Tiro al blanco'; }, []);

  const { jugadores, tiros, rondas, turnos, actual } = estado;
  const valores = leerValores(estado.valores);
  const n = jugadores.length;
  const totalTurnos = n * rondas;
  const turnoActual = turnos.length;
  const terminado = turnoActual >= totalTurnos;
  const jugadorActual = turnoActual % n;
  const rondaActual = Math.floor(turnoActual / n) + 1;

  const totales = useMemo(() => jugadores.map((_, i) => turnos.filter(t => t.jugador === i).reduce((s, t) => s + t.tiros.reduce((a, b) => a + b, 0), 0)), [jugadores, turnos]);
  const mejorTurno = useMemo(() => turnos.reduce((m, t) => {
    const suma = t.tiros.reduce((a, b) => a + b, 0);
    return !m || suma > m.suma ? { jugador: t.jugador, suma } : m;
  }, null), [turnos]);
  const orden = [...totales.keys()].sort((a, b) => totales[b] - totales[a]);
  const sumaActual = actual.reduce((a, b) => a + b, 0);

  const anotar = (v) => {
    if (terminado) return;
    vibrarCorto(v === 0 ? 40 : 15);
    setEstado(e => {
      const nuevoActual = [...e.actual, v];
      if (nuevoActual.length >= e.tiros) {
        return { ...e, actual: [], turnos: [...e.turnos, { jugador: e.turnos.length % e.jugadores.length, tiros: nuevoActual }] };
      }
      return { ...e, actual: nuevoActual };
    });
  };

  const deshacer = () => {
    setEstado(e => {
      if (e.actual.length > 0) return { ...e, actual: e.actual.slice(0, -1) };
      if (e.turnos.length > 0) {
        const ultimo = e.turnos[e.turnos.length - 1];
        return { ...e, turnos: e.turnos.slice(0, -1), actual: ultimo.tiros.slice(0, -1) };
      }
      return e;
    });
  };

  const empezar = () => setEstado(e => ({
    ...e,
    fase: 'juego',
    turnos: [],
    actual: [],
    tiros: Math.max(1, Math.min(20, Number(e.tiros) || 7)),
    rondas: Math.max(1, Math.min(10, Number(e.rondas) || 1)),
    jugadores: e.jugadores.map((j, i) => j.trim() || `Jugador ${i + 1}`)
  }));
  const otraVez = () => setEstado(e => ({ ...e, turnos: [], actual: [] }));

  if (activos === false) {
    return (
      <div className="jg">
        <div className="jg-inicio" style={{ '--jg-c1': '#374151', '--jg-c2': '#1f2937' }}>
          <div className="jg-inicio__emoji">🎯</div>
          <p>Los juegos no están disponibles en este negocio.</p>
          <Link to={`/menu/${moduloId}`} className="jg-btn jg-btn--grande">Volver</Link>
        </div>
      </div>
    );
  }

  if (estado.fase === 'config') {
    return (
      <div className="jg ap">
        <CabeceraApoyo moduloId={moduloId} titulo="🎯 Tiro al blanco" subtitulo="Anota cada tiro y mira quién gana" />
        <section className="ap-tarjeta">
          <h2>¿Quiénes juegan?</h2>
          <EditorJugadores jugadores={jugadores} onCambiar={(j) => setEstado(e => ({ ...e, jugadores: j }))} />
        </section>
        <section className="ap-tarjeta">
          <h2>Reglas</h2>
          <div className="ap-dos">
            <label className="ap-campo">
              <span>Tiros por turno</span>
              <input type="number" inputMode="numeric" min="1" max="20" value={tiros} onChange={(e) => setEstado(s => ({ ...s, tiros: e.target.value }))} />
            </label>
            <label className="ap-campo">
              <span>Rondas</span>
              <input type="number" inputMode="numeric" min="1" max="10" value={rondas} onChange={(e) => setEstado(s => ({ ...s, rondas: e.target.value }))} />
            </label>
          </div>
          <label className="ap-campo">
            <span>Puntos que da el blanco</span>
            <input type="text" inputMode="numeric" value={estado.valores} onChange={(e) => setEstado(s => ({ ...s, valores: e.target.value }))} />
            <small>Escribe los valores de tu blanco separados por comas. Ej: 0, 5, 10, 25, 50</small>
          </label>
          <div className="ap-valores-vista">{valores.map(v => <span key={v}>{v}</span>)}</div>
        </section>
        <button type="button" className="jg-btn jg-btn--full" onClick={empezar} disabled={valores.length === 0}>¡A tirar!</button>
      </div>
    );
  }

  return (
    <div className="jg ap">
      <CabeceraApoyo moduloId={moduloId} titulo="🎯 Tiro al blanco"
        subtitulo={terminado ? 'Partida terminada' : `Ronda ${rondaActual} de ${rondas} · ${tiros} tiros por turno`}
        derecha={<button type="button" className="jg-volver" onClick={() => setEstado(e => ({ ...e, fase: 'config' }))} aria-label="Ajustes">⚙</button>} />

      {terminado ? (
        <section className="ap-tarjeta ap-final">
          <div className="ap-final__copa">🏆</div>
          <h2>¡Ganó {jugadores[orden[0]]}!</h2>
          <p>{totales[orden[0]]} puntos{mejorTurno ? ` · Mejor turno: ${jugadores[mejorTurno.jugador]} con ${mejorTurno.suma}` : ''}</p>
          <div className="ap-podio">
            {[1, 0, 2].map(pos => orden[pos] !== undefined && (
              <div key={pos} className={`ap-podio__puesto ap-podio__puesto--${pos + 1}`} style={{ '--color': COLORES_JUGADOR[orden[pos] % COLORES_JUGADOR.length] }}>
                <strong>{jugadores[orden[pos]]}</strong>
                <span>{totales[orden[pos]]}</span>
                <div>{['🥇', '🥈', '🥉'][pos]}</div>
              </div>
            ))}
          </div>
          <div className="ap-botones">
            <button type="button" className="jg-btn jg-btn--suave" onClick={deshacer}>↶ Corregir último</button>
            <button type="button" className="jg-btn" onClick={otraVez}>Jugar otra vez</button>
          </div>
        </section>
      ) : (
        <section className="ap-tarjeta ap-turno" style={{ '--color': COLORES_JUGADOR[jugadorActual % COLORES_JUGADOR.length] }}>
          <div className="ap-turno__cabeza">
            <span>Le toca a</span>
            <strong>{jugadores[jugadorActual]}</strong>
            <b>{sumaActual} pts</b>
          </div>
          <div className="ap-tiros" aria-label="Tiros de este turno">
            {Array.from({ length: tiros }, (_, k) => (
              <span key={k} className={`ap-tiro ${k < actual.length ? 'lleno' : ''} ${k === actual.length ? 'siguiente' : ''}`}>
                {k < actual.length ? actual[k] : k + 1}
              </span>
            ))}
          </div>
          <div className="ap-teclado">
            {valores.map(v => (
              <button key={v} type="button" className={v === 0 ? 'cero' : v === valores[valores.length - 1] ? 'maximo' : ''} onClick={() => anotar(v)}>
                {v === 0 ? 'Fallo' : v}
              </button>
            ))}
          </div>
          <button type="button" className="jg-btn jg-btn--suave jg-btn--full" onClick={deshacer} disabled={turnos.length === 0 && actual.length === 0}>↶ Deshacer tiro</button>
        </section>
      )}

      <section className="ap-tarjeta">
        <h2>Marcador</h2>
        <div className="ap-marcador">
          {orden.map((i, pos) => (
            <div key={i} className={`ap-total ${pos === 0 && turnos.length ? 'lider' : ''} ${!terminado && i === jugadorActual ? 'turno' : ''}`}
              style={{ '--color': COLORES_JUGADOR[i % COLORES_JUGADOR.length] }}>
              <span className="ap-total__pos">{turnos.length ? `${pos + 1}°` : ''}</span>
              <span className="ap-total__nombre">{pos === 0 && turnos.length ? '👑 ' : ''}{jugadores[i]}</span>
              <strong>{totales[i]}</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default TiroAlBlanco;
