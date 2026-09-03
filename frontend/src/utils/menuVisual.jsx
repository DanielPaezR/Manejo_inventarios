import React from 'react';

// Compartido entre MenuPublico.jsx (lo que ve el cliente) y la vista previa
// editable de PedidosCliente.jsx (lo que edita el negocio) — mismo ícono y
// mismo criterio de color de placeholder, para que la vista previa sea fiel
// a como se ve el menú real.
export const IconoHoja = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M4 20c8 0 14-6 14-14 0-1 0-2-.5-3C10 4 4 10 4 18c0 .7 0 1.4.2 2z" />
    <path d="M4 20c3-6 7-10 13-13" />
  </svg>
);

// Paleta cálida para placeholders de foto (producto y hero): rota por
// hash del nombre para que cada uno tenga un color consistente entre
// renders.
const COLORES_PLACEHOLDER = ['#B5533C', '#5C7A52', '#C98A2E', '#8C5B3F', '#7A4B32', '#4E6B4A'];

export const obtenerColorPlaceholder = (texto) => {
  let hash = 0;
  for (let i = 0; i < texto.length; i++) {
    hash = texto.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORES_PLACEHOLDER[Math.abs(hash) % COLORES_PLACEHOLDER.length];
};
