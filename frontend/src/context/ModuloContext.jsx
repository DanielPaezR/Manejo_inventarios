import React, { createContext, useState, useContext, useEffect } from 'react';
import api from '../services/api';

// Crear el contexto
const ModuloContext = createContext();

// Provider del contexto
export const ModuloProvider = ({ children, user }) => {
  const [moduloActivo, setModuloActivo] = useState(null);
  const [modulos, setModulos] = useState([]);
  const [loading, setLoading] = useState(true);

  // Cargar módulos cada vez que cambie el usuario (login/logout/cambio de usuario)
  useEffect(() => {
    // Logout: resetear estado en memoria y limpiar localStorage
    if (!user) {
      setModulos([]);
      setModuloActivo(null);
      localStorage.removeItem('moduloActivo');
      setLoading(false);
      return;
    }

    try {
      if (user.modulos && user.modulos.length > 0) {
        setModulos(user.modulos);

        // Si hay un módulo guardado en localStorage, usarlo
        const moduloGuardado = localStorage.getItem('moduloActivo');
        if (moduloGuardado) {
          const modulo = JSON.parse(moduloGuardado);
          // Verificar que el módulo guardado aún está en la lista
          const existe = user.modulos.some(m => m.id === modulo.id);
          if (existe) {
            setModuloActivo(modulo);
          } else {
            setModuloActivo(user.modulos[0]);
          }
        } else {
          setModuloActivo(user.modulos[0]);
        }
      } else {
        // Usuario sin módulos: limpiar estado
        setModulos([]);
        setModuloActivo(null);
      }
    } catch (error) {
      console.error('Error cargando módulos:', error);
    }
    setLoading(false);
  }, [user]);

  // Cambiar módulo activo
  const cambiarModulo = (modulo) => {
    if (!modulo) return;
    
    // Verificar que el módulo existe en la lista
    const existe = modulos.some(m => m.id === modulo.id);
    if (!existe) {
      console.error('Módulo no disponible:', modulo);
      return;
    }
    
    setModuloActivo(modulo);
    localStorage.setItem('moduloActivo', JSON.stringify(modulo));

    // Opcional: recargar datos o notificar a otros componentes
    window.dispatchEvent(new CustomEvent('moduloCambiado', { detail: modulo }));
  };

  // Vuelve a pedir la lista de módulos del usuario (GET /api/usuarios/modulos)
  // sin necesidad de cerrar sesión — usado después de crear un módulo nuevo
  // desde la app, para que aparezca de inmediato en el selector. Si se pasa
  // activarModuloId, ese módulo queda como activo al terminar (para entrar
  // directo al módulo recién creado).
  const refrescarModulos = async (activarModuloId) => {
    if (!user) return;
    try {
      const response = await api.get('/usuarios/modulos');
      setModulos(response.data);

      if (activarModuloId) {
        const nuevo = response.data.find(m => m.id === activarModuloId);
        if (nuevo) {
          setModuloActivo(nuevo);
          localStorage.setItem('moduloActivo', JSON.stringify(nuevo));
        }
      }
    } catch (error) {
      console.error('Error refrescando módulos:', error);
    }
  };

  // Valor del contexto
  const value = {
    moduloActivo,
    modulos,
    loading,
    cambiarModulo,
    refrescarModulos,
    tieneModulos: modulos.length > 0
  };

  return (
    <ModuloContext.Provider value={value}>
      {children}
    </ModuloContext.Provider>
  );
};

// Hook personalizado para usar el contexto
export const useModulo = () => {
  const context = useContext(ModuloContext);
  if (!context) {
    throw new Error('useModulo debe ser usado dentro de un ModuloProvider');
  }
  return context;
};

export default ModuloContext;