import React, { useEffect, useState } from 'react';
import './ListaEmpaque.css';

const pesos = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;

// Lo que se va marcando queda en este navegador, para no perderlo si se
// recarga la página o llega un pedido nuevo mientras se empaca.
const clave = (pedidoId) => `empaque_${pedidoId}`;
const leer = (pedidoId) => {
  try {
    return JSON.parse(localStorage.getItem(clave(pedidoId)) || '{}') || {};
  } catch {
    return {};
  }
};

// Lista de empaque de un pedido de cliente: foto de cada producto, la
// cantidad en grande y una casilla para ir marcando lo que ya se metió en
// la bolsa. Tocar la foto la agranda.
const ListaEmpaque = ({ pedido, editable = true }) => {
  const [listos, setListos] = useState(() => leer(pedido.id));
  const [fotoGrande, setFotoGrande] = useState(null);
  const detalles = pedido.detalles || [];

  useEffect(() => {
    try {
      localStorage.setItem(clave(pedido.id), JSON.stringify(listos));
    } catch { /* sin almacenamiento */ }
  }, [pedido.id, listos]);

  const marcar = (id) => setListos(prev => ({ ...prev, [id]: !prev[id] }));
  const cuantosListos = detalles.filter(d => listos[d.id]).length;
  const unidades = detalles.reduce((s, d) => s + Number(d.cantidad || 0), 0);
  const todoListo = detalles.length > 0 && cuantosListos === detalles.length;

  return (
    <div className="le">
      <div className="le__cabecera">
        <strong>📦 Para empacar · {unidades} {unidades === 1 ? 'unidad' : 'unidades'}</strong>
        {editable && detalles.length > 0 && (
          <span className={`le__progreso ${todoListo ? 'listo' : ''}`}>
            {todoListo ? '✅ Todo en la bolsa' : `${cuantosListos} de ${detalles.length} listos`}
          </span>
        )}
      </div>

      <ul className="le__lista">
        {detalles.map(d => {
          const hecho = editable && !!listos[d.id];
          return (
            <li key={d.id} className={`le__item ${hecho ? 'hecho' : ''}`}>
              <button
                type="button"
                className="le__foto"
                onClick={() => d.foto_url && setFotoGrande(d)}
                aria-label={d.foto_url ? `Ver foto de ${d.nombre_producto}` : undefined}
                disabled={!d.foto_url}
              >
                {d.foto_url
                  ? <img src={d.foto_url} alt="" loading="lazy" />
                  : <span aria-hidden="true">{(d.nombre_producto || '?').charAt(0).toUpperCase()}</span>}
              </button>
              <span className="le__cantidad">{Number(d.cantidad)}×</span>
              <div className="le__info">
                <span className="le__nombre">{d.nombre_producto}</span>
                <small>
                  {d.categoria_nombre ? `${d.categoria_nombre} · ` : ''}{pesos(d.precio_unitario)} c/u · {pesos(d.subtotal)}
                </small>
                {d.promocion_nombre && <small className="le__promo">🎁 {d.promocion_nombre}</small>}
              </div>
              {editable && (
                <button
                  type="button"
                  className={`le__check ${hecho ? 'si' : ''}`}
                  onClick={() => marcar(d.id)}
                  aria-pressed={hecho}
                  aria-label={hecho ? `Desmarcar ${d.nombre_producto}` : `Marcar ${d.nombre_producto} como empacado`}
                >
                  {hecho ? '✓' : ''}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="le__total">
        <span>Total</span>
        <strong>{pesos(pedido.total)}</strong>
      </div>

      {fotoGrande && (
        <div className="le__visor" onClick={() => setFotoGrande(null)} role="dialog" aria-label={fotoGrande.nombre_producto}>
          <img src={fotoGrande.foto_url} alt={fotoGrande.nombre_producto} />
          <p>{Number(fotoGrande.cantidad)}× {fotoGrande.nombre_producto}</p>
          <small>Toca para cerrar</small>
        </div>
      )}
    </div>
  );
};

export default ListaEmpaque;
