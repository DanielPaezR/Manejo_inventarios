import React, { useState, useEffect, useRef } from 'react';
import { aleatorio, vibrar } from './comunes';

// Toque rápido: 30 segundos tocando círculos que aparecen y se encogen.
// Los dorados valen 3; las bombas restan 3.
const DURACION = 30;

const JuegoToque = ({ onFin, activo }) => {
  const [objetivos, setObjetivos] = useState([]);
  const [puntaje, setPuntaje] = useState(0);
  const [restante, setRestante] = useState(DURACION);
  const [efectos, setEfectos] = useState([]);
  const puntajeRef = useRef(0);
  const idRef = useRef(0);
  const terminadoRef = useRef(false);

  useEffect(() => {
    if (!activo) return undefined;
    const inicio = Date.now();
    let siguiente = 0;
    const tick = setInterval(() => {
      const pasado = (Date.now() - inicio) / 1000;
      const quedan = Math.max(0, DURACION - pasado);
      setRestante(quedan);
      const ahora = Date.now();
      // Quita los que ya vencieron.
      setObjetivos(prev => prev.filter(o => ahora - o.nace < o.vida));
      // Aparecen más seguido a medida que pasa el tiempo.
      if (ahora >= siguiente && quedan > 0) {
        const r = Math.random();
        const tipo = r < 0.12 ? 'oro' : r < 0.24 ? 'bomba' : 'normal';
        idRef.current += 1;
        setObjetivos(prev => [...prev, {
          id: idRef.current, tipo, nace: ahora,
          vida: Math.max(650, 1300 - pasado * 20),
          x: aleatorio(8, 82), y: aleatorio(6, 80), tam: aleatorio(54, 76)
        }]);
        siguiente = ahora + Math.max(280, 700 - pasado * 15);
      }
      if (quedan <= 0 && !terminadoRef.current) {
        terminadoRef.current = true;
        clearInterval(tick);
        onFin({ puntaje: Math.max(0, puntajeRef.current), duracion: DURACION, detalle: 'Se acabó el tiempo ⏰' });
      }
    }, 50);
    return () => clearInterval(tick);
  }, [activo]); // eslint-disable-line react-hooks/exhaustive-deps

  const tocar = (o, e) => {
    e.stopPropagation();
    const valor = o.tipo === 'oro' ? 3 : o.tipo === 'bomba' ? -3 : 1;
    puntajeRef.current += valor;
    setPuntaje(puntajeRef.current);
    vibrar(o.tipo === 'bomba' ? 60 : 10);
    setObjetivos(prev => prev.filter(x => x.id !== o.id));
    const ef = { id: o.id, x: o.x, y: o.y, texto: valor > 0 ? `+${valor}` : `${valor}`, malo: valor < 0 };
    setEfectos(prev => [...prev, ef]);
    setTimeout(() => setEfectos(prev => prev.filter(x => x.id !== ef.id)), 600);
  };

  return (
    <div className="jt">
      <div className="jg-hud">
        <span>⭐ {puntaje}</span>
        <span className={restante < 6 ? 'jg-hud--alerta' : ''}>⏱️ {Math.ceil(restante)}s</span>
      </div>
      <div className="jg-tiempo"><span style={{ width: `${(restante / DURACION) * 100}%` }} /></div>
      <div className="jt-campo">
        {objetivos.map(o => (
          <button key={o.id} type="button" className={`jt-objetivo jt-objetivo--${o.tipo}`}
            style={{ left: `${o.x}%`, top: `${o.y}%`, width: o.tam, height: o.tam, animationDuration: `${o.vida}ms` }}
            onPointerDown={(e) => tocar(o, e)} aria-label={o.tipo === 'bomba' ? 'Bomba' : 'Círculo'}>
            {o.tipo === 'bomba' ? '💣' : o.tipo === 'oro' ? '⭐' : ''}
          </button>
        ))}
        {efectos.map(ef => (
          <span key={`e${ef.id}`} className={`jt-efecto ${ef.malo ? 'malo' : ''}`} style={{ left: `${ef.x}%`, top: `${ef.y}%` }}>{ef.texto}</span>
        ))}
      </div>
    </div>
  );
};

export default JuegoToque;
