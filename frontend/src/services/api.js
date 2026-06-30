import axios from 'axios';

// ✅ USAR VARIABLE DE ENTORNO
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// Configurar la base URL
const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
});

// Interceptor para agregar el token y el módulo activo
api.interceptors.request.use(
  (config) => {
    // Token
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Módulo activo - OBTENER DEL LOCALSTORAGE
    try {
      const moduloActivoStr = localStorage.getItem('moduloActivo');
      if (moduloActivoStr) {
        const moduloActivo = JSON.parse(moduloActivoStr);
        if (moduloActivo && moduloActivo.id) {
          // Agregar modulo_id a la query string o al body
          if (config.method === 'get' || config.method === 'delete') {
            // Para GET y DELETE, agregar a params
            config.params = {
              ...config.params,
              modulo_id: moduloActivo.id
            };
          } else if (config.method === 'post' || config.method === 'put') {
            // Para POST y PUT, agregar al body
            config.data = {
              ...config.data,
              modulo_id: moduloActivo.id
            };
          }
        }
      }
    } catch (error) {
      console.error('Error obteniendo módulo activo:', error);
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor para manejar errores de autenticación
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // ✅ También manejar 403 (token inválido o expirado)
    if (error.response?.status === 401 || error.response?.status === 403) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('moduloActivo');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;