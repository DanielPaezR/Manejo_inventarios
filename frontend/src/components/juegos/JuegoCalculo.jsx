import React, { useState, useEffect, useRef, useCallback } from 'react';
import { aleatorio, barajar, vibrar } from './comunes';

// Cálculo veloz: 60 segundos de operaciones con 4 opciones. La dificultad
// sube con la racha; cada acierto suma 10 más un bono por racha.
const DURACION = 60;

const generar = (nivel) => {
  let a; let b; let op; let r;
  if (nivel < 3) { a = aleatorio(1, 12); b = aleatorio(1, 12); op = '+'; r = a + b; }
  else if (nivel < 6) {
    if (Math.random() < 0.5) { a = aleatorio(5, 30); b = aleatorio(1, a); op = '−'; r = a - b; }
    else { a = aleatorio(8, 40); b = aleatorio(5, 40); op = '+'; r = a + b; }
  } else if (nivel < 10) {
    const t = Math.random();
    if (t < 0.4) { a = aleatorio(2, 9); b = aleatorio(2, 9); op = '×'; r = a * b; }
    else if (t < 0.7) { a = aleatorio(20, 99); b = aleatorio(10, a); op = '−'; r = a - b; }
    else { a = aleatorio(25, 99); b = aleatorio(15, 99); op = '+'; r = a + b; }
  } else {
    const t = Math.random();
    if (t < 0.5) { a = aleatorio(6, 15); b = aleatorio(3, 12); op = '×'; r = a * b; }
    else { b = aleatorio(2, 12); r = aleatorio(2, 12); a = b * r; op = '÷'; }
  }
  const opciones = new Set([r]);
  while (opciones.size < 4) {
    const delta = aleatorio(1, Math.max(3, Math.round(Math.abs(r) * 0.25)));
    const candidato = Math.random() < 0.5 ? r + delta : r - delta;
    if (candidato >= 0) opciones.add(candidato);
  }
  return { texto: `${a} ${op} ${b}`, respuesta: r, opciones: barajar([...opciones]) };
};

const JuegoCalculo = ({ onFin, activo }) => {
  const [racha, setRacha] = useState(0);
  const [aciertos, setAciertos] = useState(0);
  const [puntaje, setPuntaje] = useState(0);
  const [pregunta, setPregunta] = useState(() => generar(0));
  const [restante, setRestante] = useState(DURACION);
  const [feedback, setFeedback] = useState(null);
  const estadoRef = useRef({ puntaje: 0, aciertos: 0, fallos: 0, terminado: false });

  useEffect(() => {
    if (!activo) return undefined;
    const inicio = Date.now();
    const t = setInterval(() => {
      const quedan = Math.max(0, DURACION - (Date.now() - inicio) / 1000);
      setRestante(quedan);
      if (quedan <= 0 && !estadoRef.current.terminado) {
        estadoRef.current.terminado = true;
        clearInterval(t);
        const { puntaje: p, aciertos: a, fallos: f } = estadoRef.current;
        onFin({ puntaje: Math.max(0, p), duracion: DURACION, detalle: `${a} aciertos y ${f} errores` });
      }
    }, 100);
    return () => clearInterval(t);
  }, [activo]); // eslint-disable-line react-hooks/exhaustive-deps

  const responder = useCallback((valor) => {
    if (!activo || estadoRef.current.terminado) return;
    const e = estadoRef.current;
    if (valor === pregunta.respuesta) {
      const nuevaRacha = racha + 1;
      e.puntaje += 10 + Math.min(nuevaRacha, 10) * 2;
      e.aciertos += 1;
      setRacha(nuevaRacha);
      setAciertos(e.aciertos);
      setFeedback('bien');
      vibrar(10);
      setPregunta(generar(e.aciertos));
    } else {
      e.puntaje = Math.max(0, e.puntaje - 5);
      e.fallos += 1;
      setRacha(0);
      setFeedback('mal');
      vibrar(70);
    }
    setPuntaje(e.puntaje);
    setTimeout(() => setFeedback(null), 300);
  }, [activo, pregunta, racha]);

  return (
    <div className="jc">
      <div className="jg-hud">
        <span>⭐ {puntaje}</span>
        <span>🔥 Racha {racha}</span>
        <span className={restante < 10 ? 'jg-hud--alerta' : ''}>⏱️ {Math.ceil(restante)}s</span>
      </div>
      <div className="jg-tiempo"><span style={{ width: `${(restante / DURACION) * 100}%` }} /></div>
      <div className={`jc-pregunta ${feedback ? `jc-pregunta--${feedback}` : ''}`}>
        <small>Nivel {Math.min(4, Math.floor(aciertos / 3) + 1)}</small>
        <strong>{pregunta.texto} = ?</strong>
      </div>
      <div className="jc-opciones">
        {pregunta.opciones.map(o => (
          <button key={`${pregunta.texto}-${o}`} type="button" className="jc-opcion" onClick={() => responder(o)}>{o}</button>
        ))}
      </div>
    </div>
  );
};

export default JuegoCalculo;
