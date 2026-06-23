import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import SelectorModulo from './SelectorModulo';
import { useModulo } from '../hooks/useModulo';
import './Dashboard.css';

const Dashboard = ({ user, onLogout }) => {
  const location = useLocation();
  const { moduloActivo } = useModulo();

  // Verificar si estamos en una ruta que requiere módulo
  const requiereModulo = !['/negocios', '/'].includes(location.pathname);

  return (
    <div className="dashboard">
      <nav className="navbar">
        <div className="navbar-brand">
          <h1>📊 Sistema de Inventario</h1>
        </div>
        
        <div className="navbar-user">
          <span className="user-info">
            {user?.nombre} ({user?.rol})
          </span>
          <button onClick={onLogout} className="btn-logout">
            Cerrar Sesión
          </button>
        </div>
      </nav>

      {/* Selector de módulo - solo si se requiere y hay módulos */}
      {requiereModulo && moduloActivo && (
        <div className="modulo-section">
          <div className="modulo-info">
            <span className="modulo-label">Módulo activo:</span>
            <span className="modulo-nombre">{moduloActivo.nombre}</span>
          </div>
          <SelectorModulo />
        </div>
      )}

      <div className="dashboard-container">
        <aside className="sidebar">
          <ul className="nav-menu">
            {/* Super Admin solo ve Negocios */}
            {user?.rol === 'super_admin' && (
              <li className={location.pathname === '/negocios' ? 'active' : ''}>
                <Link to="/negocios">🏢 Negocios</Link>
              </li>
            )}

            {/* Admin y Trabajador ven el resto */}
            {user?.rol !== 'super_admin' && (
              <>
                <li className={location.pathname === '/ventas' ? 'active' : ''}>
                  <Link to="/ventas">🛒 Ventas</Link>
                </li>
                <li className={location.pathname === '/productos' ? 'active' : ''}>
                  <Link to="/productos">📦 Productos</Link>
                </li>
                <li className={location.pathname === '/estadisticas' ? 'active' : ''}>
                  <Link to="/estadisticas">📊 Estadísticas</Link>
                </li>
                <li className={location.pathname === '/reportes' ? 'active' : ''}>
                  <Link to="/reportes">📄 Reportes</Link>
                </li>
                <li className={location.pathname === '/inventario' ? 'active' : ''}>
                  <Link to="/inventario">📦 Gestión Inventario</Link>
                </li>
              </>
            )}

            {/* Cambiar contraseña - visible para todos */}
            <li className="nav-separator"></li>
            <li>
              <button onClick={() => window.location.href = '/cambiar-password'} className="nav-link-btn">
                🔑 Cambiar Contraseña
              </button>
            </li>
          </ul>
        </aside>

        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Dashboard;