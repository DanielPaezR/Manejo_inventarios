import React from 'react';
import './TarjetaSellos.css';

// Dibujo de la tarjeta de sellos (se usa en el menú, en la confirmación
// del pedido y en el negocio). sellos = sellos de la tarjeta actual,
// premios = premios completos listos para reclamar.
const TarjetaSellos = ({ negocio, meta, premio, sellos = 0, premios = 0, nuevo = false, compacta = false }) => {
  const faltan = meta - sellos;
  return (
    <div className={`ts ${compacta ? 'ts--compacta' : ''}`}>
      <div className="ts__cabecera">
        <div>
          <small>Tarjeta de sellos</small>
          <strong>{negocio}</strong>
        </div>
        <span className="ts__conteo">{sellos}<small>/{meta}</small></span>
      </div>
      <div className="ts__sellos" style={{ '--ts-columnas': meta <= 8 ? meta : Math.ceil(meta / 2) }}>
        {Array.from({ length: meta }, (_, i) => {
          const lleno = i < sellos;
          const ultimo = i === meta - 1;
          return (
            <span key={i} className={`ts__sello ${lleno ? 'lleno' : ''} ${ultimo ? 'premio' : ''} ${nuevo && i === sellos - 1 ? 'nuevo' : ''}`}
              style={{ '--i': i }} aria-hidden="true">
              {lleno ? '★' : ultimo ? '🎁' : i + 1}
            </span>
          );
        })}
      </div>
      {premios > 0 ? (
        <p className="ts__premio ts__premio--listo">🎉 ¡Tienes {premios === 1 ? 'un premio listo' : `${premios} premios listos`}! Pide <b>{premio}</b> en caja con tu número.</p>
      ) : (
        <p className="ts__premio">Te {faltan === 1 ? 'falta 1 sello' : `faltan ${faltan} sellos`} para ganar <b>{premio}</b>.</p>
      )}
    </div>
  );
};

export default TarjetaSellos;
