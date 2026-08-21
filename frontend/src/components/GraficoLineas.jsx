import React, { useMemo, useRef, useState, useEffect } from 'react';
import './GraficoLineas.css';

// Gráfico de líneas reutilizable en SVG puro, sin librerías externas
// (mismo criterio que el resto de Estadísticas, que dibuja sus barras con
// CSS). Pensado para series de tiempo: cada serie comparte el mismo eje X
// (mismas fechas, mismo orden) — así lo entregan los endpoints de
// evolución financiera.
//
// Props:
//   series: [{ nombre, color, datos: [{ fecha: 'YYYY-MM-DD', valor }], total? }]
//     'total' es opcional: si no viene, la leyenda muestra la suma de
//     'valor' de esa serie. Para series acumuladas (ej. balance) donde
//     sumar los puntos no tiene sentido, el que arma la página debe pasar
//     el total que sí tenga sentido (ej. el balance actual).
//   altura: alto en px del área de dibujo (default 220).
const MARGEN = { top: 16, right: 16, bottom: 30, left: 46 };
const MAX_ETIQUETAS_X = 8;
const ANCHO_POR_DEFECTO = 600; // usado solo antes de la primera medición real

const formatearMoneda = (valor) => {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(valor || 0);
};

// Versión corta para no saturar el eje Y ni la leyenda con cifras largas.
const formatearCompacto = (valor) => {
  const signo = valor < 0 ? '-' : '';
  const abs = Math.abs(valor);
  if (abs >= 1000000) return `${signo}$${(abs / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${signo}$${(abs / 1000).toFixed(0)}K`;
  return `${signo}$${abs.toFixed(0)}`;
};

// fecha llega como 'YYYY-MM-DD' (sin hora): se ancla a mediodía UTC antes
// de formatear para que ningún navegador, en ninguna zona horaria, le
// reste un día por accidente.
const formatearFecha = (fecha) => {
  const dt = new Date(`${fecha}T12:00:00Z`);
  return dt.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

const GraficoLineas = ({ series, altura = 220 }) => {
  // El viewBox se mide en píxeles reales del contenedor (en vez de una
  // unidad lógica fija estirada con preserveAspectRatio="none") para que
  // el escalado en X y en Y sea el mismo — si no, el texto del SVG
  // (fechas, valores del eje Y) queda deformado cuando el ancho real no
  // coincide con la proporción de la unidad lógica.
  const contenedorRef = useRef(null);
  const [anchoSvg, setAnchoSvg] = useState(ANCHO_POR_DEFECTO);

  useEffect(() => {
    const el = contenedorRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const ancho = entries[0]?.contentRect?.width;
      if (ancho && Math.abs(ancho - anchoSvg) > 1) setAnchoSvg(ancho);
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { puntosPorSerie, minVal, maxVal, fechas, anchoPlot, coordX, coordY } = useMemo(() => {
    const fechas = series?.[0]?.datos?.map(d => d.fecha) || [];
    const n = fechas.length;

    const todosLosValores = (series || []).flatMap(s => s.datos.map(d => Number(d.valor)));
    let minVal = todosLosValores.length > 0 ? Math.min(...todosLosValores) : 0;
    let maxVal = todosLosValores.length > 0 ? Math.max(...todosLosValores) : 0;
    // El mínimo puede ser negativo (ej. balance en rojo) — no se fuerza a
    // incluir el 0. Si todos los valores son iguales, se agrega un margen
    // artificial para no dividir entre 0 al escalar.
    if (minVal === maxVal) {
      minVal -= 1;
      maxVal += 1;
    } else {
      const colchon = (maxVal - minVal) * 0.08;
      minVal -= colchon;
      maxVal += colchon;
    }

    const anchoPlot = anchoSvg - MARGEN.left - MARGEN.right;
    const altoPlot = altura - MARGEN.top - MARGEN.bottom;

    const coordX = (i) => (n <= 1 ? MARGEN.left + anchoPlot / 2 : MARGEN.left + (i / (n - 1)) * anchoPlot);
    const coordY = (valor) => MARGEN.top + (1 - (valor - minVal) / (maxVal - minVal)) * altoPlot;

    const puntosPorSerie = (series || []).map(s => ({
      ...s,
      puntos: s.datos.map((d, i) => ({ x: coordX(i), y: coordY(Number(d.valor)), fecha: d.fecha, valor: Number(d.valor) }))
    }));

    return { puntosPorSerie, minVal, maxVal, fechas, anchoPlot, coordX, coordY };
  }, [series, altura, anchoSvg]);

  const hayDatos = series && series.length > 0 && fechas.length > 0;
  const n = fechas.length;
  const pasoEtiquetas = Math.max(1, Math.ceil(n / MAX_ETIQUETAS_X));
  const mostrarBaseCero = hayDatos && minVal < 0 && maxVal > 0;

  return (
    <div className="grafico-lineas" ref={contenedorRef}>
      {hayDatos && (
        <svg
          viewBox={`0 0 ${anchoSvg} ${altura}`}
          className="grafico-lineas-svg"
          style={{ height: altura }}
        >
          {/* Líneas guía horizontales: máximo, medio, mínimo */}
          {[maxVal, (maxVal + minVal) / 2, minVal].map((valor, idx) => {
            const y = coordY(valor);
            return (
              <g key={idx} className="grafico-lineas-guia">
                <line x1={MARGEN.left} x2={MARGEN.left + anchoPlot} y1={y} y2={y} />
                <text x={2} y={y - 4}>{formatearCompacto(valor)}</text>
              </g>
            );
          })}

          {/* Línea base en 0, cuando la serie cruza de negativo a positivo */}
          {mostrarBaseCero && (
            <line
              className="grafico-lineas-base-cero"
              x1={MARGEN.left}
              x2={MARGEN.left + anchoPlot}
              y1={coordY(0)}
              y2={coordY(0)}
            />
          )}

          {/* Series */}
          {puntosPorSerie.map((s, idx) => (
            <g key={idx}>
              <polyline
                className="grafico-lineas-linea"
                style={{ stroke: s.color }}
                points={s.puntos.map(p => `${p.x},${p.y}`).join(' ')}
              />
              {s.puntos.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={4} style={{ fill: s.color }}>
                  <title>{`${s.nombre} · ${formatearFecha(p.fecha)}: ${formatearMoneda(p.valor)}`}</title>
                </circle>
              ))}
            </g>
          ))}

          {/* Etiquetas de fecha en el eje X, espaciadas si hay muchos puntos */}
          {fechas.map((fecha, i) => {
            if (i % pasoEtiquetas !== 0 && i !== n - 1) return null;
            return (
              <text key={i} x={coordX(i)} y={altura - 8} className="grafico-lineas-etiqueta-x">
                {formatearFecha(fecha)}
              </text>
            );
          })}
        </svg>
      )}

      {hayDatos && (
        <div className="grafico-lineas-leyenda">
          {series.map((s, idx) => {
            const total = s.total !== undefined
              ? s.total
              : s.datos.reduce((sum, d) => sum + Number(d.valor), 0);
            return (
              <div key={idx} className="grafico-lineas-leyenda-item">
                <span className="grafico-lineas-leyenda-color" style={{ background: s.color }} />
                <span className="grafico-lineas-leyenda-nombre">{s.nombre}</span>
                <span className="grafico-lineas-leyenda-total">{formatearMoneda(total)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default GraficoLineas;
