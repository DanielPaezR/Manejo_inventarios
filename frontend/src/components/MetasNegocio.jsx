import React, { useState } from 'react';
import api from '../services/api';

// "Hoy contra un día normal" y las metas de ventas, dentro del capítulo 1
// del Resumen.

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const DIAS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const hora12 = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
};

export const HoyVsNormal = ({ hoy }) => {
  if (!hoy) return null;
  const { ventas, normal_a_esta_hora: normal, normal_dia_completo: cierre } = hoy;
  const diferencia = normal > 0 ? Math.round(((ventas - normal) / normal) * 100) : null;
  const estado = diferencia === null ? 'neutro' : diferencia >= 5 ? 'bueno' : diferencia <= -5 ? 'malo' : 'neutro';
  return (
    <div className={`mn-hoy mn-hoy--${estado}`}>
      <div>
        <small>Hoy, {DIAS[hoy.dia_semana]} a las {hora12(hoy.hora)}</small>
        <strong>Llevas {pesos(ventas)}</strong>
      </div>
      <p>
        {normal > 0 ? (
          <>
            Un {DIAS[hoy.dia_semana]} normal, a esta hora, llevas {pesos(normal)}
            {diferencia !== null && Math.abs(diferencia) >= 5 && <> ({diferencia > 0 ? `vas ${diferencia}% arriba` : `vas ${Math.abs(diferencia)}% abajo`})</>}
            {cierre > 0 && <> y el día cierra en unos {pesos(cierre)}</>}.
          </>
        ) : (
          <>Todavía no hay suficientes {DIAS[hoy.dia_semana]}s anteriores para comparar.</>
        )}
      </p>
    </div>
  );
};

const BarraMeta = ({ titulo, actual, meta, diasRestantes, unidad }) => {
  const pct = Math.min(Math.round((actual / meta) * 100), 999);
  const falta = Math.max(meta - actual, 0);
  // Los días restantes no incluyen hoy; hoy todavía cuenta.
  const diasParaVender = diasRestantes + 1;
  return (
    <div className="mn-meta">
      <div className="mn-meta__fila">
        <span>{titulo}</span>
        <b>{pesos(actual)} <small>de {pesos(meta)}</small></b>
      </div>
      <div className="rn-barra rn-barra--verde"><div style={{ width: `${Math.min(pct, 100)}%` }} /></div>
      <small className="mn-meta__nota">
        {falta === 0
          ? `🎉 ¡Cumpliste la meta ${unidad}! Vas en el ${pct}%.`
          : `Vas en el ${pct}%. Te faltan ${pesos(falta)}: unos ${pesos(falta / diasParaVender)} por día en los ${diasParaVender} ${diasParaVender === 1 ? 'día que queda' : 'días que quedan'}.`}
      </small>
    </div>
  );
};

export const Metas = ({ metas, moduloId, sugerenciaSemana, onGuardado }) => {
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({ ventas_semana: '', ventas_mes: '', ganancia_mes: '' });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const hayMetas = metas.ventas_semana || metas.ventas_mes || metas.ganancia_mes;

  const abrir = () => {
    const redondear = (n) => Math.round(n / 10000) * 10000;
    setForm({
      ventas_semana: metas.ventas_semana || (sugerenciaSemana ? redondear(sugerenciaSemana * 1.1) : ''),
      ventas_mes: metas.ventas_mes || (sugerenciaSemana ? redondear(sugerenciaSemana * 1.1 * 4.3) : ''),
      ganancia_mes: metas.ganancia_mes || ''
    });
    setError('');
    setEditando(true);
  };

  const guardar = async () => {
    try {
      setGuardando(true);
      await api.put(`/modulos/${moduloId}/metas`, form);
      setEditando(false);
      onGuardado();
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudieron guardar las metas');
    } finally {
      setGuardando(false);
    }
  };

  if (editando) {
    const campo = (clave, titulo, ayuda) => (
      <label className="mn-campo">
        <span>{titulo}</span>
        <input type="number" min="0" inputMode="numeric" value={form[clave]} placeholder="Sin meta"
          onChange={(e) => setForm(f => ({ ...f, [clave]: e.target.value }))} />
        {ayuda && <small>{ayuda}</small>}
      </label>
    );
    return (
      <div className="mn-metas mn-metas--editando">
        <h4>🎯 Tus metas</h4>
        <div className="mn-campos">
          {campo('ventas_semana', 'Vender a la semana', sugerenciaSemana ? `Una semana normal vendes ${pesos(sugerenciaSemana)}` : null)}
          {campo('ventas_mes', 'Vender al mes')}
          {campo('ganancia_mes', 'Ganar al mes (opcional)')}
        </div>
        {error && <p className="mn-error">{error}</p>}
        <div className="mn-acciones">
          <button type="button" className="rn-link" onClick={() => setEditando(false)} disabled={guardando}>Cancelar</button>
          <button type="button" className="mn-btn" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar metas'}</button>
        </div>
      </div>
    );
  }

  if (!hayMetas) {
    return (
      <div className="mn-metas mn-metas--vacio">
        <p>🎯 <b>Ponte una meta.</b> Te mostraré cuánto llevas y cuánto necesitas vender cada día para cumplirla.</p>
        <button type="button" className="mn-btn" onClick={abrir}>Poner metas</button>
      </div>
    );
  }

  const a = metas.avance;
  return (
    <div className="mn-metas">
      <div className="mn-meta__fila">
        <h4>🎯 Tus metas</h4>
        <button type="button" className="rn-link" onClick={abrir}>Cambiar</button>
      </div>
      {metas.ventas_semana && <BarraMeta titulo="Ventas de esta semana" actual={a.ventas_semana} meta={metas.ventas_semana} diasRestantes={a.dias_restantes_semana} unidad="de la semana" />}
      {metas.ventas_mes && <BarraMeta titulo="Ventas del mes" actual={a.ventas_mes} meta={metas.ventas_mes} diasRestantes={a.dias_restantes_mes} unidad="del mes" />}
      {metas.ganancia_mes && <BarraMeta titulo="Ganancia del mes" actual={a.ganancia_mes} meta={metas.ganancia_mes} diasRestantes={a.dias_restantes_mes} unidad="de ganancia" />}
    </div>
  );
};
