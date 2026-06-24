import React, { useState, useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import SelectorModulo from './SelectorModulo';
import { useModulo } from '../hooks/useModulo';
import './Dashboard.css';

const Dashboard = ({ user, onLogout }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { moduloActivo, modulos } = useModulo();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [notificaciones, setNotificaciones] = useState([]);
  const [showNotificaciones, setShowNotificaciones] = useState(false);

  // Verificar si estamos en una ruta que requiere módulo
  const requiereModulo = !['/negocios', '/'].includes(location.pathname);

  // Atajos de teclado
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl + B: Colapsar/Expandir sidebar
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        setSidebarCollapsed(!sidebarCollapsed);
      }
      
      // Escape: Cerrar menús
      if (e.key === 'Escape') {
        setShowUserMenu(false);
        setShowNotificaciones(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebarCollapsed]);

  // Cargar notificaciones de stock bajo (simulado)
  useEffect(() => {
    // Aquí podrías cargar notificaciones desde la API
    // Por ahora son simuladas
    const notificacionesSimuladas = [
      { id: 1, mensaje: '⚠️ 3 productos con stock bajo', tipo: 'warning', leido: false },
      { id: 2, mensaje: '📦 Pedido #1234 en camino', tipo: 'info', leido: false },
    ];
    setNotificaciones(notificacionesSimuladas);
  }, []);

  const handleLogout = () => {
    if (window.confirm('¿Estás seguro de que quieres cerrar sesión?')) {
      onLogout();
      navigate('/login');
    }
  };

  const marcarNotificacionesLeidas = () => {
    setNotificaciones(prev => prev.map(n => ({ ...n, leido: true })));
    setShowNotificaciones(false);
  };

  // Menú de navegación con iconos - ACTUALIZADO CON PROVEEDORES Y PEDIDOS
  const menuItems = {
    super_admin: [
      { path: '/negocios', icon: '🏢', label: 'Negocios' }
    ],
    admin: [
      { path: '/ventas', icon: '🛒', label: 'Ventas' },
      { path: '/productos', icon: '📦', label: 'Productos' },
      { path: '/estadisticas', icon: '📊', label: 'Estadísticas' },
      { path: '/reportes', icon: '📄', label: 'Reportes' },
      { path: '/inventario', icon: '📋', label: 'Gestión Inventario' },
      { path: '/proveedores', icon: '🤝', label: 'Proveedores' },      // ✅ NUEVO
      { path: '/pedidos', icon: '📦', label: 'Pedidos' },              // ✅ NUEVO
    ],
    trabajador: [
      { path: '/ventas', icon: '🛒', label: 'Ventas' },
    ]
  };

  // Obtener items según el rol
  const items = user?.rol === 'super_admin' 
    ? menuItems.super_admin 
    : user?.rol === 'admin' 
      ? menuItems.admin 
      : menuItems.trabajador;

  // Contar notificaciones no leídas
  const notificacionesNoLeidas = notificaciones.filter(n => !n.leido).length;

  return (
    <div className={`dashboard ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Navbar superior */}
      <nav className="navbar">
        <div className="navbar-left">
          <button 
            className="btn-toggle-sidebar"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title="Colapsar/Expandir menú (Ctrl+B)"
          >
            ☰
          </button>
          <div className="navbar-brand">
            <h1>📊 Sistema de Inventario</h1>
            {moduloActivo && (
              <span className="navbar-modulo">
                📁 {moduloActivo.nombre}
              </span>
            )}
          </div>
        </div>
        
        <div className="navbar-right">
          {/* Buscador rápido */}
          <div className="navbar-search">
            <input
              type="text"
              placeholder="🔍 Buscar..."
              className="search-input"
              onKeyPress={(e) => {
                if (e.key === 'Enter' && e.target.value) {
                  // Buscar en toda la aplicación
                  console.log('Buscando:', e.target.value);
                }
              }}
            />
          </div>

          {/* Notificaciones */}
          <div className="navbar-notificaciones">
            <button 
              className="btn-notificaciones"
              onClick={() => setShowNotificaciones(!showNotificaciones)}
              title="Notificaciones"
            >
              🔔
              {notificacionesNoLeidas > 0 && (
                <span className="badge-notificacion">{notificacionesNoLeidas}</span>
              )}
            </button>
            
            {showNotificaciones && (
              <div className="dropdown-notificaciones">
                <div className="dropdown-header">
                  <span>Notificaciones</span>
                  {notificacionesNoLeidas > 0 && (
                    <button onClick={marcarNotificacionesLeidas} className="btn-marcar-leidas">
                      Marcar todas como leídas
                    </button>
                  )}
                </div>
                {notificaciones.length > 0 ? (
                  <ul>
                    {notificaciones.map(notif => (
                      <li key={notif.id} className={`notificacion-item ${notif.leido ? 'leido' : ''}`}>
                        <span className={`notificacion-icono ${notif.tipo}`}>
                          {notif.tipo === 'warning' ? '⚠️' : '📌'}
                        </span>
                        <span className="notificacion-mensaje">{notif.mensaje}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="sin-notificaciones">No hay notificaciones</p>
                )}
              </div>
            )}
          </div>

          {/* Menú de usuario */}
          <div className="navbar-user">
            <button 
              className="btn-user"
              onClick={() => setShowUserMenu(!showUserMenu)}
              title="Menú de usuario"
            >
              <span className="user-avatar">
                {user?.nombre?.charAt(0).toUpperCase() || 'U'}
              </span>
              <span className="user-info">
                <span className="user-nombre">{user?.nombre}</span>
                <span className="user-rol">{user?.rol}</span>
              </span>
              <span className="user-arrow">▼</span>
            </button>

            {showUserMenu && (
              <div className="dropdown-user">
                <div className="dropdown-user-header">
                  <div className="user-avatar-large">
                    {user?.nombre?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <div className="user-info-large">
                    <strong>{user?.nombre}</strong>
                    <span>{user?.email}</span>
                    <span className="user-rol-badge">{user?.rol}</span>
                  </div>
                </div>
                <ul className="dropdown-user-menu">
                  <li>
                    <button onClick={() => navigate('/cambiar-password')}>
                      🔑 Cambiar Contraseña
                    </button>
                  </li>
                  <li className="dropdown-divider"></li>
                  <li>
                    <button onClick={handleLogout} className="btn-logout-dropdown">
                      🚪 Cerrar Sesión
                    </button>
                  </li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Selector de módulo */}
      {requiereModulo && moduloActivo && (
        <div className="modulo-section">
          <div className="modulo-info">
            <span className="modulo-label">📁 Módulo activo:</span>
            <span className="modulo-nombre">{moduloActivo.nombre}</span>
            {moduloActivo.descripcion && (
              <span className="modulo-descripcion">{moduloActivo.descripcion}</span>
            )}
          </div>
          <SelectorModulo />
        </div>
      )}

      <div className="dashboard-container">
        {/* Sidebar */}
        <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <ul className="nav-menu">
            {items.map((item) => (
              <li 
                key={item.path} 
                className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
                title={sidebarCollapsed ? item.label : ''}
              >
                <Link to={item.path}>
                  <span className="nav-icon">{item.icon}</span>
                  {!sidebarCollapsed && <span className="nav-label">{item.label}</span>}
                </Link>
              </li>
            ))}

            {/* Separador y opciones adicionales */}
            {!sidebarCollapsed && (
              <>
                <li className="nav-separator"></li>
                <li className="nav-item nav-help">
                  <button 
                    onClick={() => window.open('https://github.com/DanielPaezR/Manejo_inventarios', '_blank')}
                    className="nav-link-btn"
                  >
                    <span className="nav-icon">❓</span>
                    <span className="nav-label">Ayuda</span>
                  </button>
                </li>
              </>
            )}
          </ul>

          {/* Footer del sidebar */}
          {!sidebarCollapsed && (
            <div className="sidebar-footer">
              <div className="sidebar-version">
                <span>v2.0.0</span>
                <span className="sidebar-modulos-count">
                  {modulos.length} módulos disponibles
                </span>
              </div>
            </div>
          )}
        </aside>

        {/* Contenido principal */}
        <main className="main-content">
          <Outlet />
        </main>
      </div>

      {/* Overlay para cerrar menús en móvil */}
      {(showUserMenu || showNotificaciones) && (
        <div 
          className="dropdown-overlay" 
          onClick={() => {
            setShowUserMenu(false);
            setShowNotificaciones(false);
          }}
        />
      )}
    </div>
  );
};

export default Dashboard;