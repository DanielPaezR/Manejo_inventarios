import React from 'react';
import { useModulo } from '../hooks/useModulo';
import './SelectorModulo.css';

const SelectorModulo = () => {
  const { moduloActivo, modulos, cambiarModulo } = useModulo();

  // Si no hay módulos o solo hay uno, no mostrar el selector
  if (!modulos || modulos.length <= 1) {
    return null;
  }

  return (
    <div className="selector-modulo">
      <label htmlFor="modulo-select">Módulo:</label>
      <select
        id="modulo-select"
        value={moduloActivo?.id || ''}
        onChange={(e) => {
          const moduloSeleccionado = modulos.find(
            m => m.id === parseInt(e.target.value)
          );
          if (moduloSeleccionado) {
            cambiarModulo(moduloSeleccionado);
          }
        }}
        className="modulo-select"
      >
        {modulos.map((modulo) => (
          <option key={modulo.id} value={modulo.id}>
            {modulo.nombre}
          </option>
        ))}
      </select>
    </div>
  );
};

export default SelectorModulo;