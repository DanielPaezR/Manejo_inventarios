import React, { useState } from 'react';
import api from '../services/api';
import './Login.css';

const Login = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.post('/login', { email, password });
      
      if (response.data.token && response.data.user) {
        // Guardar usuario y token
        onLogin(response.data.user, response.data.token);
        
        // Si el usuario tiene módulos, guardar el primero como activo
        if (response.data.user.modulos && response.data.user.modulos.length > 0) {
          localStorage.setItem('moduloActivo', JSON.stringify(response.data.user.modulos[0]));
        }
        
        // Redirigir según el rol
        if (response.data.user.rol === 'super_admin') {
          window.location.href = '/negocios';
        } else {
          window.location.href = '/ventas';
        }
      }
    } catch (err) {
      console.error('Error en login:', err);
      setError(err.response?.data?.error || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>📊 Sistema de Inventario</h1>
        <h2>Iniciar Sesión</h2>
        
        {error && <div className="error-message">{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Correo Electrónico</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ejemplo@correo.com"
              required
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="password">Contraseña</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="********"
              required
            />
          </div>
          
          <button type="submit" disabled={loading}>
            {loading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;