import { useContext } from 'react';
import ModuloContext from '../context/ModuloContext';

/**
 * Hook personalizado para usar el contexto de módulo
 * Proporciona acceso al módulo activo y funciones para cambiarlo
 */
export const useModulo = () => {
  const context = useContext(ModuloContext);
  
  if (!context) {
    throw new Error('useModulo debe ser usado dentro de un ModuloProvider');
  }
  
  return context;
};

export default useModulo;