import React, { useState } from 'react';
import { Store, CircleAlert, TrendingUp, Package, ReceiptText, ShoppingCart, Truck, Wallet } from 'lucide-react';
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
      {/* Panel ilustrado genérico (sirve para cualquier negocio): tarjetas
          flotantes que muestran lo que hace la app. En celular queda como
          una franja con el nombre y el lema. */}
      <aside className="login-hero">
        <div className="login-hero-glow" aria-hidden="true" />
        <span className="login-hero-brand">
          <span className="login-mark"><Store size={18} strokeWidth={2.2} /></span>
          Sistema de Inventario
        </span>

        <div className="login-ilustracion" aria-hidden="true">
          <div className="login-tarjeta login-tarjeta-ventas">
            <span className="login-tarjeta-label"><TrendingUp size={14} /> Ventas de hoy</span>
            <strong>$ 1.284.500</strong>
            <span className="login-chip-ok">+12% vs ayer</span>
            <div className="login-barras">
              {[38, 52, 44, 66, 58, 80, 92].map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}
            </div>
          </div>

          <div className="login-tarjeta login-tarjeta-stock">
            <span className="login-tarjeta-label"><Package size={14} /> Stock bajo</span>
            <div className="login-fila"><span>Producto A</span><em>3 und</em></div>
            <div className="login-fila"><span>Producto B</span><em>5 und</em></div>
          </div>

          <div className="login-tarjeta login-tarjeta-factura">
            <span className="login-icono-ok"><ReceiptText size={16} /></span>
            <div>
              <strong>FAC000231</strong>
              <small>Pagada · $ 48.000</small>
            </div>
          </div>
        </div>

        <div className="login-hero-copy">
          <h2>Tu negocio, en orden.</h2>
          <p>Ventas, inventario, pedidos y finanzas en un solo lugar.</p>
          <ul className="login-features">
            <li><ShoppingCart size={14} /> Ventas</li>
            <li><Package size={14} /> Inventario</li>
            <li><Truck size={14} /> Pedidos</li>
            <li><Wallet size={14} /> Finanzas</li>
          </ul>
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
