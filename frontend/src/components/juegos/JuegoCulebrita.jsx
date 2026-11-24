import React, { useEffect, useRef, useState } from 'react';
import { aleatorio, vibrar } from './comunes';

// Culebrita: tablero de 18x18. Se controla deslizando el dedo sobre el
// tablero, con los botones de flecha o con el teclado. Cada fruta suma 10 y
// la culebra va más rápido a medida que crece.
const N = 18;
const FRUTAS = ['🍎', '🍓', '🍒', '🍇', '🍑', '🍋'];
const DIRS = { arriba: [0, -1], abajo: [0, 1], izquierda: [-1, 0], derecha: [1, 0] };

const JuegoCulebrita = ({ onFin, activo }) => {
  const lienzoRef = useRef(null);
  const juegoRef = useRef(null);
  const [puntaje, setPuntaje] = useState(0);

  const cambiarDir = (nombre) => {
    const j = juegoRef.current;
    if (!j) return;
    const [dx, dy] = DIRS[nombre];
    const [ax, ay] = j.dirPendiente || j.dir;
    if (dx === -ax && dy === -ay) return; // no puede devolverse sobre sí misma
    j.dirPendiente = [dx, dy];
  };

  useEffect(() => {
    if (!activo) return undefined;
    const lienzo = lienzoRef.current;
    const ctx = lienzo.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const ancho = lienzo.clientWidth;
    lienzo.width = ancho * dpr;
    lienzo.height = ancho * dpr;
    ctx.scale(dpr, dpr);
    const c = ancho / N;

    const ponerFruta = (cuerpo) => {
      let p;
      do { p = [aleatorio(0, N - 1), aleatorio(0, N - 1)]; } while (cuerpo.some(([x, y]) => x === p[0] && y === p[1]));
      return { pos: p, emoji: FRUTAS[aleatorio(0, FRUTAS.length - 1)] };
    };
    const cuerpo = [[8, 9], [7, 9], [6, 9]];
    const j = { cuerpo, dir: [1, 0], dirPendiente: null, fruta: ponerFruta(cuerpo), puntaje: 0, inicio: Date.now(), vivo: true };
    juegoRef.current = j;

    const dibujar = () => {
      ctx.fillStyle = '#10221d';
      ctx.fillRect(0, 0, ancho, ancho);
      for (let x = 0; x < N; x++) {
        for (let y = 0; y < N; y++) {
          if ((x + y) % 2 === 0) { ctx.fillStyle = '#132a24'; ctx.fillRect(x * c, y * c, c, c); }
        }
      }
      ctx.font = `${c * 0.85}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(j.fruta.emoji, j.fruta.pos[0] * c + c / 2, j.fruta.pos[1] * c + c / 2 + 1);
      j.cuerpo.forEach(([x, y], i) => {
        const t = i / j.cuerpo.length;
        ctx.fillStyle = i === 0 ? '#5eead4' : `hsl(${168 - t * 30}, 70%, ${52 - t * 14}%)`;
        const m = i === 0 ? 1 : 2;
        const r = c * 0.35;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x * c + m, y * c + m, c - 2 * m, c - 2 * m, r);
        else ctx.rect(x * c + m, y * c + m, c - 2 * m, c - 2 * m);
        ctx.fill();
      });
      // Ojos
      const [hx, hy] = j.cuerpo[0];
      ctx.fillStyle = '#0b1512';
      const [dx, dy] = j.dir;
      [[-1, 1]].forEach(() => {
        const ox = dy !== 0 ? c * 0.22 : 0;
        const oy = dx !== 0 ? c * 0.22 : 0;
        [[1], [-1]].forEach(([s]) => {
          ctx.beginPath();
          ctx.arc(hx * c + c / 2 + dx * c * 0.18 + ox * s, hy * c + c / 2 + dy * c * 0.18 + oy * s, c * 0.09, 0, Math.PI * 2);
          ctx.fill();
        });
      });
    };

    let ultimo = 0;
    let animacion;
    const paso = (tiempo) => {
      if (!j.vivo) return;
      const velocidad = Math.max(70, 150 - j.puntaje / 4);
      if (tiempo - ultimo >= velocidad) {
        ultimo = tiempo;
        if (j.dirPendiente) { j.dir = j.dirPendiente; j.dirPendiente = null; }
        const [hx, hy] = j.cuerpo[0];
        const nueva = [hx + j.dir[0], hy + j.dir[1]];
        const choca = nueva[0] < 0 || nueva[1] < 0 || nueva[0] >= N || nueva[1] >= N
          || j.cuerpo.slice(0, -1).some(([x, y]) => x === nueva[0] && y === nueva[1]);
        if (choca) {
          j.vivo = false;
          vibrar(120);
          dibujar();
          const seg = Math.round((Date.now() - j.inicio) / 1000);
          setTimeout(() => onFin({ puntaje: j.puntaje, duracion: seg, detalle: `Creciste hasta ${j.cuerpo.length} cuadros` }), 350);
          return;
        }
        j.cuerpo.unshift(nueva);
        if (nueva[0] === j.fruta.pos[0] && nueva[1] === j.fruta.pos[1]) {
          j.puntaje += 10;
          setPuntaje(j.puntaje);
          vibrar(15);
          j.fruta = ponerFruta(j.cuerpo);
        } else {
          j.cuerpo.pop();
        }
        dibujar();
      }
      animacion = requestAnimationFrame(paso);
    };
    dibujar();
    animacion = requestAnimationFrame(paso);

    const teclas = { ArrowUp: 'arriba', ArrowDown: 'abajo', ArrowLeft: 'izquierda', ArrowRight: 'derecha', w: 'arriba', s: 'abajo', a: 'izquierda', d: 'derecha' };
    const alTeclear = (e) => { if (teclas[e.key]) { e.preventDefault(); cambiarDir(teclas[e.key]); } };
    window.addEventListener('keydown', alTeclear);

    // Deslizar el dedo sobre el tablero.
    let inicioToque = null;
    const alTocar = (e) => { const t = e.touches[0]; inicioToque = [t.clientX, t.clientY]; };
    const alMover = (e) => {
      if (!inicioToque) return;
      e.preventDefault();
      const t = e.touches[0];
      const dx = t.clientX - inicioToque[0];
      const dy = t.clientY - inicioToque[1];
      if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;
      cambiarDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'derecha' : 'izquierda') : (dy > 0 ? 'abajo' : 'arriba'));
      inicioToque = [t.clientX, t.clientY];
    };
    lienzo.addEventListener('touchstart', alTocar, { passive: true });
    lienzo.addEventListener('touchmove', alMover, { passive: false });

    return () => {
      j.vivo = false;
      cancelAnimationFrame(animacion);
      window.removeEventListener('keydown', alTeclear);
      lienzo.removeEventListener('touchstart', alTocar);
      lienzo.removeEventListener('touchmove', alMover);
    };
  }, [activo]); // eslint-disable-line react-hooks/exhaustive-deps

  const Flecha = ({ dir, simbolo }) => (
    <button type="button" className={`js-flecha js-flecha--${dir}`} onPointerDown={(e) => { e.preventDefault(); vibrar(6); cambiarDir(dir); }} aria-label={dir}>{simbolo}</button>
  );

  return (
    <div className="js">
      <div className="jg-hud"><span>⭐ {puntaje}</span><span>Desliza el dedo o usa las flechas</span></div>
      <canvas ref={lienzoRef} className="js-lienzo" />
      <div className="js-control">
        <Flecha dir="arriba" simbolo="▲" />
        <Flecha dir="izquierda" simbolo="◀" />
        <Flecha dir="derecha" simbolo="▶" />
        <Flecha dir="abajo" simbolo="▼" />
      </div>
    </div>
  );
};

export default JuegoCulebrita;
