import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import './ResumenNegocio.css';

// Pestaña Ventas: quién vende cuánto y en qué horario (últimas 4 semanas).
// Solo se muestra si más de una persona ha vendido.

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const hora12 = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'a. m.' : 'p. m.'}`;

const AnalisisEquipo = () => {
  const { moduloActivo } = useModulo();
  const [equipo, setEquipo] = useState(null);

  useEffect(() => {
    if (!moduloActivo) return;
    api.get('/estadisticas/equipo').then(r => setEquipo(r.data)).catch(() => setEquipo([]));
  }, [moduloActivo]);

  if (!equipo || equipo.length < 2) return null;

  const maxTotal = Math.max(...equipo.map(p => p.total), 1);
  const maxHora = Math.max(...equipo.flatMap(p => p.horas.map(h => h.ventas)), 1);
  const horas = Array.from({ length: 17 }, (_, i) => i + 6);

  return (
    <div className="rn est-analisis">
      <section className="card rn-capitulo">
        <div className="rn-capitulo__cabecera">
          <span className="rn-capitulo__numero aa-icono">👥</span>
          <div>
            <small>Tu equipo · últimas 4 semanas</small>
            <h3>{equipo[0].nombre} hace el {equipo[0].participacion}% de las ventas.</h3>
          </div>
        </div>
        <div className="rn-proveedores">
          {equipo.map(p => (
            <div key={p.id} className="rn-proveedor">
              <div className="rn-proveedor__fila">
                <strong>{p.nombre}</strong>
                <span>{pesos(p.total)}</span>
              </div>
              <div className="rn-barra"><div style={{ width: `${(p.total / maxTotal) * 100}%` }} /></div>
              <div className="rn-proveedor__detalle">
                <span><b>{p.ventas}</b> ventas</span>
                <span>Cada venta <b>{pesos(p.ticket)}</b></span>
                <span>Vendió <b>{p.dias}</b> días · {pesos(p.por_dia)} por día</span>
                {p.desde !== null && <span>Entre {hora12(p.desde)} y {hora12(p.hasta)}</span>}
              </div>
              <div className="eq-horas" aria-label={`Ventas por hora de ${p.nombre}`}>
                {horas.map(h => {
                  const v = p.horas.find(x => x.hora === h)?.ventas || 0;
                  return <span key={h} title={`${hora12(h)}: ${v} ventas`} style={{ opacity: v ? 0.25 + (v / maxHora) * 0.75 : 0.08 }} />;
                })}
              </div>
            </div>
          ))}
        </div>
        <p className="rn-nota">Cada cuadrito es una hora, de 6 a. m. a 10 p. m.; entre más oscuro, más ventas. Sirve para ver quién cubre las horas con más clientes.</p>
      </section>
    </div>
  );
};

export default AnalisisEquipo;
