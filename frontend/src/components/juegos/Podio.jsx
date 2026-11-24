import React, { useState, useEffect } from 'react';
import { obtenerPodio } from './comunes';

// Podio de un juego: los 3 primeros en escalones con medalla y el resto en
// lista. Pestañas "Esta semana" / "De siempre".
const Podio = ({ moduloId, juego, recarga = 0, resaltarNombre }) => {
  const [periodo, setPeriodo] = useState('semana');
  const [filas, setFilas] = useState(null);

  useEffect(() => {
    setFilas(null);
    obtenerPodio(moduloId, juego, periodo).then(setFilas);
  }, [moduloId, juego, periodo, recarga]);

  const esYo = (f) => resaltarNombre && f.nombre.toLowerCase() === resaltarNombre.toLowerCase();
  const [primero, segundo, tercero, ...resto] = filas || [];

  const Escalon = ({ fila, puesto }) => (
    <div className={`pd-escalon pd-escalon--${puesto} ${fila && esYo(fila) ? 'pd-yo' : ''}`}>
      {fila ? (
        <>
          <span className="pd-avatar">{fila.avatar}</span>
          <strong className="pd-nombre">{fila.nombre}</strong>
          <span className="pd-puntaje">{fila.puntaje.toLocaleString('es-CO')}</span>
        </>
      ) : (
        <span className="pd-vacio">?</span>
      )}
      <div className="pd-base"><span>{['🥇', '🥈', '🥉'][puesto - 1]}</span></div>
    </div>
  );

  return (
    <section className="pd">
      <div className="pd-pestanas" role="tablist">
        {[['semana', 'Esta semana'], ['siempre', 'De siempre']].map(([v, l]) => (
          <button key={v} type="button" role="tab" aria-selected={periodo === v} className={periodo === v ? 'activa' : ''} onClick={() => setPeriodo(v)}>{l}</button>
        ))}
      </div>
      {filas === null ? (
        <p className="pd-cargando">Cargando podio…</p>
      ) : filas.length === 0 ? (
        <p className="pd-cargando">Nadie ha guardado puntaje {periodo === 'semana' ? 'esta semana' : 'todavía'}. ¡Sé el primero! 🏆</p>
      ) : (
        <>
          <div className="pd-escalones">
            <Escalon fila={segundo} puesto={2} />
            <Escalon fila={primero} puesto={1} />
            <Escalon fila={tercero} puesto={3} />
          </div>
          {resto.length > 0 && (
            <ol className="pd-lista" start={4}>
              {resto.map((f, i) => (
                <li key={`${f.nombre}-${i}`} className={esYo(f) ? 'pd-yo' : ''}>
                  <span className="pd-lista__pos">{i + 4}</span>
                  <span className="pd-lista__avatar">{f.avatar}</span>
                  <span className="pd-lista__nombre">{f.nombre}</span>
                  <b>{f.puntaje.toLocaleString('es-CO')}</b>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
};

export default Podio;
