import React, { useState } from 'react';
import { Store, CircleAlert } from 'lucide-react';
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
        onLogin(response.data.user, response.data.token);

        // Si el usuario tiene módulos, guardar el primero como activo
        if (response.data.user.modulos && response.data.user.modulos.length > 0) {
          localStorage.setItem('moduloActivo', JSON.stringify(response.data.user.modulos[0]));
        }

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
    <div className="login-page">
      {/* Foto del negocio: en escritorio ocupa la mitad izquierda; en
          celular queda como franja superior. Para otro negocio basta
          cambiar /login-bg.jpg. */}
      <aside className="login-hero">
        <div className="login-hero-overlay">
          <span className="login-hero-brand">
            <span className="login-mark"><Store size={18} strokeWidth={2.2} /></span>
            Sistema de Inventario
          </span>
          <div className="login-hero-copy">
            <h2>Tu negocio, en orden.</h2>
            <p>Ventas, inventario y finanzas en un solo lugar.</p>
          </div>
        </div>
      </aside>

      <main className="login-panel">
        <div className="login-card">
          <h1>Iniciar sesión</h1>
          <p className="login-subtitle">Accede a tu cuenta para gestionar tu negocio</p>

          {error && (
            <div className="login-error" role="alert">
              <CircleAlert size={16} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form">
            <div className="login-field">
              <label htmlFor="email">Correo electrónico</label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ejemplo@correo.com"
                autoComplete="email"
                required
              />
            </div>

            <div className="login-field">
              <label htmlFor="password">Contraseña</label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>

            <button type="submit" className="btn-login" disabled={loading}>
              {loading && <span className="login-spinner" />}
              {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
};

export default Login;
