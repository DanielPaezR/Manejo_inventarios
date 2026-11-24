import React, { useEffect, useRef, useState } from 'react';
import { aleatorio, vibrar } from './comunes';

// Atrapa la fruta: arrastra la canasta. Frutas +10, estrella +50, bomba
// quita una vida; dejar caer una fruta también. 3 vidas.
const FRUTAS = ['🍎', '🍌', '🍇', '🍓', '🍊', '🍉', '🍍', '🥝'];

const JuegoFruta = ({ onFin, activo }) => {
  const lienzoRef = useRef(null);
  const [hud, setHud] = useState({ puntaje: 0, vidas: 3 });

  useEffect(() => {
    if (!activo) return undefined;
    const lienzo = lienzoRef.current;
    const ctx = lienzo.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = lienzo.clientWidth;
    const H = lienzo.clientHeight;
    lienzo.width = W * dpr;
    lienzo.height = H * dpr;
    ctx.scale(dpr, dpr);

    const tamCanasta = Math.min(110, W * 0.26);
    const j = { x: W / 2, objetivoX: W / 2, items: [], particulas: [], puntaje: 0, vidas: 3, inicio: performance.now(), ultimoItem: 0, vivo: true, golpe: 0 };

    const nuevoItem = (t) => {
      const r = Math.random();
      const tipo = r < 0.14 ? 'bomba' : r < 0.2 ? 'estrella' : 'fruta';
      const nivel = (t - j.inicio) / 1000;
      j.items.push({
        tipo,
        emoji: tipo === 'bomba' ? '💣' : tipo === 'estrella' ? '⭐' : FRUTAS[aleatorio(0, FRUTAS.length - 1)],
        x: aleatorio(24, W - 24),
        y: -30,
        v: 2.2 + Math.min(nivel * 0.07, 5) + Math.random() * 1.2,
        giro: Math.random() * Math.PI,
        vg: (Math.random() - 0.5) * 0.12
      });
    };

    const chispa = (x, y, color) => {
      for (let i = 0; i < 10; i++) {
        j.particulas.push({ x, y, vx: (Math.random() - 0.5) * 6, vy: -Math.random() * 5, vida: 30, color });
      }
    };

    let animacion;
    const paso = (t) => {
      if (!j.vivo) return;
      const nivel = (t - j.inicio) / 1000;
      if (t - j.ultimoItem > Math.max(330, 900 - nivel * 14)) { nuevoItem(t); j.ultimoItem = t; }
      j.x += (j.objetivoX - j.x) * 0.35;

      // Fondo
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#0f2a1d');
      g.addColorStop(1, '#1d3b16');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      if (j.golpe > 0) { ctx.fillStyle = `rgba(239,68,68,${j.golpe / 30})`; ctx.fillRect(0, 0, W, H); j.golpe -= 1; }

      // Canasta
      const cy = H - 46;
      ctx.font = `${tamCanasta * 0.8}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🧺', j.x, cy);

      // Items
      ctx.font = '40px system-ui';
      j.items = j.items.filter(it => {
        it.y += it.v;
        it.giro += it.vg;
        ctx.save();
        ctx.translate(it.x, it.y);
        ctx.rotate(it.giro);
        ctx.fillText(it.emoji, 0, 0);
        ctx.restore();
        const atrapado = it.y > cy - 34 && it.y < cy + 10 && Math.abs(it.x - j.x) < tamCanasta * 0.45;
        if (atrapado) {
          if (it.tipo === 'bomba') { j.vidas -= 1; j.golpe = 24; vibrar(120); chispa(it.x, it.y, '#ef4444'); }
          else { j.puntaje += it.tipo === 'estrella' ? 50 : 10; vibrar(10); chispa(it.x, it.y, it.tipo === 'estrella' ? '#facc15' : '#a3e635'); }
          setHud({ puntaje: j.puntaje, vidas: j.vidas });
          return false;
        }
        if (it.y > H + 30) {
          if (it.tipo === 'fruta') { j.vidas -= 1; j.golpe = 18; vibrar(60); setHud({ puntaje: j.puntaje, vidas: j.vidas }); }
          return false;
        }
        return true;
      });

      // Partículas
      j.particulas = j.particulas.filter(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.25; p.vida -= 1;
        ctx.globalAlpha = Math.max(0, p.vida / 30);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 4, 4);
        ctx.globalAlpha = 1;
        return p.vida > 0;
      });

      if (j.vidas <= 0) {
        j.vivo = false;
        const seg = Math.round((t - j.inicio) / 1000);
        setTimeout(() => onFin({ puntaje: j.puntaje, duracion: seg, detalle: `Aguantaste ${seg} segundos` }), 300);
        return;
      }
      animacion = requestAnimationFrame(paso);
    };
    animacion = requestAnimationFrame(paso);

    const mover = (clientX) => {
      const r = lienzo.getBoundingClientRect();
      j.objetivoX = Math.max(tamCanasta / 2, Math.min(W - tamCanasta / 2, clientX - r.left));
    };
    const alPuntero = (e) => mover(e.clientX);
    const alToque = (e) => { e.preventDefault(); mover(e.touches[0].clientX); };
    const teclas = (e) => {
      if (e.key === 'ArrowLeft') j.objetivoX = Math.max(tamCanasta / 2, j.objetivoX - 40);
      if (e.key === 'ArrowRight') j.objetivoX = Math.min(W - tamCanasta / 2, j.objetivoX + 40);
    };
    lienzo.addEventListener('pointermove', alPuntero);
    lienzo.addEventListener('pointerdown', alPuntero);
    lienzo.addEventListener('touchmove', alToque, { passive: false });
    window.addEventListener('keydown', teclas);
    return () => {
      j.vivo = false;
      cancelAnimationFrame(animacion);
      lienzo.removeEventListener('pointermove', alPuntero);
      lienzo.removeEventListener('pointerdown', alPuntero);
      lienzo.removeEventListener('touchmove', alToque);
      window.removeEventListener('keydown', teclas);
    };
  }, [activo]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="jf">
      <div className="jg-hud">
        <span>⭐ {hud.puntaje}</span>
        <span>{'❤️'.repeat(Math.max(0, hud.vidas))}{'🖤'.repeat(Math.max(0, 3 - hud.vidas))}</span>
      </div>
      <canvas ref={lienzoRef} className="jf-lienzo" />
      <p className="jg-ayuda">Arrastra el dedo para mover la canasta. ¡Cuidado con las bombas!</p>
    </div>
  );
};

export default JuegoFruta;
