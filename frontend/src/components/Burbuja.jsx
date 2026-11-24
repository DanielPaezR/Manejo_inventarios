import React from 'react';
import './Burbuja.css';

// Burbuja de contexto: una línea suave con un dato útil justo donde se
// necesita (cuánto se pide normalmente, cuánto queda, cómo va la meta...).
// No bloquea nada ni pide acciones; si no hay nada que decir, no se muestra.
//   tono: 'info' (por defecto), 'bien', 'ojo'
//   compacta: versión pequeña para debajo de un campo o dentro de una tabla
const Burbuja = ({ children, tono = 'info', icono = '💡', compacta = false, className = '' }) => {
  if (!children) return null;
  return (
    <div className={`burbuja burbuja--${tono} ${compacta ? 'burbuja--compacta' : ''} ${className}`} role="note">
      {icono && <span className="burbuja__icono" aria-hidden="true">{icono}</span>}
      <span className="burbuja__texto">{children}</span>
    </div>
  );
};

export default Burbuja;
