import React from 'react';
import { Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom';
import './Dashboard.css';

const Dashboard = ({ user, onLogout }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    onLogout();
    navigate('/login');
  };

  const menuItems = [
    { path: '/ventas', label: '🏪 Punto de Venta', roles: ['admin', 'trabajador'] },
    { path: '/productos', label: '📦 Productos', roles: ['admin'] },
    { path: '/reportes', label: '📋 Reportes', roles: ['admin', 'super_admin'] },
    { path: '/estadisticas', label: '📊 Estadísticas', roles: ['admin'] },
  ];

  // Si es super admin, agregar opción de negocios
  if (user.rol === 'super_admin') {
    menuItems.unshift({ path: '/negocios', label: '🏢 Negocios', roles: ['super_admin'] });
  }

  const filteredMenuItems = menuItems.filter(item => 
    item.roles.includes(user.rol)
  );

  // Redirección automática basada en el rol
  const getDefaultRoute = () => {
    if (user.rol === 'super_admin') {
      return '/negocios';
    } else if (user.rol === 'admin' || user.rol === 'trabajador') {
      return '/ventas';
    }
    return '/ventas'; // Por defecto
  };

  return (
    <div className="dashboard">
      <div className="sidebar">
        <div className="sidebar-header">
          <h3>Sistema Inventario</h3>
          <div className="user-info">
            <strong>{user.nombre}</strong>
            <small>{user.rol}</small>
            {user.negocio && <small>{user.negocio.nombre}</small>}
          </div>
        </div>
        
        <nav className="sidebar-nav">
          {filteredMenuItems.map(item => (
            <button
              key={item.path}
              className={location.pathname === item.path ? 'active' : ''}
              onClick={() => navigate(item.path)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button onClick={handleLogout} className="logout-btn">
            🚪 Cerrar Sesión
          </button>
        </div>
      </div>

      <div className="main-content">
        <div className="header">
          <h1>
            {filteredMenuItems.find(item => item.path === location.pathname)?.label || 'Dashboard'}
          </h1>
          <div className="header-info">
            <span>Bienvenido, {user.nombre}</span>
          </div>
        </div>
        
        <div className="content">
          {/* Redirección automática cuando está en la raíz */}
          {location.pathname === '/' && <Navigate to={getDefaultRoute()} replace />}
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;