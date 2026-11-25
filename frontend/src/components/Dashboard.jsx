import React, { useState, useEffect } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ShoppingCart, Package, ChartColumn, FileText, Truck, ClipboardList,
  ReceiptText, Bike, Users, FileSearch, Wallet, Landmark, Building2,
  CircleHelp, ChevronDown, Menu, KeyRound, LogOut, Store, Check, ClipboardCheck, Settings, Megaphone, Lock
} from 'lucide-react';
import CambiarPassword from './CambiarPassword';
import { useModulo } from '../hooks/useModulo';
import api from '../services/api';
import { puedeVerRuta } from '../utils/permisos';
import { usePlan } from '../hooks/usePlan';
import { BloqueoPlan } from './PlanNegocio';
import './Dashboard.css';

const MENU = {
  super_admin: [
    { path: '/negocios', icon: Building2, label: 'Negocios' }
  ],
  // Agrupado por para qué se usa cada cosa: vender, la mercancía, los
  // clientes, la plata, el análisis y los ajustes.
  admin: [
    { path: '/ventas', icon: ShoppingCart, label: 'Ventas', grupo: 'Vender' },
    { path: '/pedidos-cliente', icon: ReceiptText, label: 'Pedidos de clientes', grupo: 'Vender' },
    { path: '/ruta-entregas', icon: Bike, label: 'Ruta de entregas', grupo: 'Vender', funcion: 'domicilios' },
    { path: '/facturas', icon: FileSearch, label: 'Facturas', grupo: 'Vender' },
    { path: '/productos', icon: Package, label: 'Productos', grupo: 'Mercancía' },
    { path: '/inventario', icon: ClipboardCheck, label: 'Inventario', grupo: 'Mercancía' },
    { path: '/proveedores', icon: Truck, label: 'Proveedores', grupo: 'Mercancía' },
    { path: '/pedidos', icon: ClipboardList, label: 'Mis pedidos', grupo: 'Mercancía', funcion: 'proveedores' },
    { path: '/clientes', icon: Users, label: 'Clientes', grupo: 'Clientes' },
    { path: '/marketing', icon: Megaphone, label: 'Marketing', grupo: 'Clientes' },
    { path: '/finanzas', icon: Wallet, label: 'Caja y bolsillos', grupo: 'Dinero' },
    { path: '/finanzas-negocio', icon: Landmark, label: 'Finanzas del negocio', grupo: 'Dinero', funcion: 'finanzas' },
    { path: '/estadisticas', icon: ChartColumn, label: 'Estadísticas', grupo: 'Análisis' },
    { path: '/reportes', icon: FileText, label: 'Reportes', grupo: 'Análisis' },
    { path: '/configuracion', icon: Settings, label: 'Configuración', grupo: 'Ajustes' }
  ],
  trabajador: [
    { path: '/ventas', icon: ShoppingCart, label: 'Ventas' },
    { path: '/pedidos-cliente', icon: ReceiptText, label: 'Pedidos de Clientes' },
    { path: '/ruta-entregas', icon: Bike, label: 'Ruta de Entregas', funcion: 'domicilios' }
  ]
};

const ETIQUETA_ROL = { super_admin: 'Super admin', admin: 'Administrador', trabajador: 'Trabajador' };

const Dashboard = ({ user, onLogout, onRefrescarPermisos }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { moduloActivo, modulos, cambiarModulo } = useModulo();
  // Funciones del plan del negocio (el super admin no tiene plan).
  const { incluye: planIncluye } = usePlan();
  const incluyePlan = (funcion) => user?.rol === 'super_admin' || !funcion || planIncluye(funcion);
  const [showCambiarPassword, setShowCambiarPassword] = useState(false);
  const [showModuloMenu, setShowModuloMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  // Solo tiene sentido mostrar un selector si hay más de un módulo entre
  // los que elegir — con uno solo, el chip estático es más simple.
  const puedeCambiarModulo = modulos.length > 1;
  // En móvil el sidebar es un drawer: debe arrancar cerrado (collapsed=true).
  // En desktop arranca expandido (collapsed=false).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 768
  );

  const requiereModulo = !['/negocios', '/', '/finanzas-negocio'].includes(location.pathname);

  // Proveedores a los que hoy toca (o se pasó) mandar pedido: aviso en el
  // menú. Se recalcula al navegar para que desaparezca al hacer el pedido.
  const [pedidosPorHacer, setPedidosPorHacer] = useState(0);
  useEffect(() => {
    if (user?.rol !== 'admin' || !moduloActivo || !incluyePlan('proveedores')) return;
    api.get('/proveedores/calendario')
      .then(res => setPedidosPorHacer(res.data.proveedores.filter(p => p.estado === 'hoy' || p.estado === 'atrasado').length))
      .catch(() => {});
  }, [user?.rol, moduloActivo, location.pathname]);

  useEffect(() => {
    if (user?.rol === 'trabajador') onRefrescarPermisos?.();
  }, [user?.rol, location.pathname]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        setSidebarCollapsed(c => !c);
      }
      if (e.key === 'Escape') {
        setShowUserMenu(false);
        setShowModuloMenu(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // En móvil, cerrar el sidebar automáticamente al navegar a otra ruta.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      setSidebarCollapsed(true);
    }
  }, [location.pathname]);

  // Al cambiar de módulo, la página actual puede tener datos cargados del
  // módulo anterior — un reload completo es la forma más simple y
  // confiable de dejar todo el estado limpio con el módulo nuevo.
  useEffect(() => {
    const handleModuloCambiado = () => window.location.reload();
    window.addEventListener('moduloCambiado', handleModuloCambiado);
    return () => window.removeEventListener('moduloCambiado', handleModuloCambiado);
  }, []);

  const handleLogout = () => {
    if (window.confirm('¿Estás seguro de que quieres cerrar sesión?')) {
      onLogout();
      navigate('/login');
    }
  };

  const items = (user?.rol === 'super_admin'
    ? MENU.super_admin
    : user?.rol === 'admin'
      ? MENU.admin
      // El trabajador ve lo básico más las secciones que el admin le habilitó,
      // en el mismo orden del menú del admin.
      : MENU.admin.filter(item => MENU.trabajador.some(t => t.path === item.path) || puedeVerRuta(user, item.path))
  ).filter(item => item.path !== '/ruta-entregas' || moduloActivo?.tiene_domicilio !== false);
  // Lo que el plan no incluye sigue en el menú con candado y, al abrirlo,
  // muestra el aviso en lugar de la página.
  const bloqueada = items.find(item => item.path === location.pathname && !incluyePlan(item.funcion));

  const paginaActual = items.find(item => item.path === location.pathname);
  const inicial = user?.nombre?.charAt(0).toUpperCase() || 'U';

  return (
    <div className={`dashboard ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Backdrop del drawer en móvil: tocar fuera lo cierra. */}
      {!sidebarCollapsed && (
        <div className="sidebar-overlay" onClick={() => setSidebarCollapsed(true)} />
      )}

      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark"><Store size={18} strokeWidth={2.2} /></span>
          {!sidebarCollapsed && (
            <span className="sidebar-brand-text">
              <strong>Sistema de Inventario</strong>
              <small>Gestión del negocio</small>
            </span>
          )}
        </div>

        <nav className="sidebar-nav">
          <ul className="nav-menu">
            {items.map(({ path, icon: Icon, label, grupo, funcion }, i) => (
              <React.Fragment key={path}>
              {grupo && grupo !== items[i - 1]?.grupo && (
                sidebarCollapsed
                  ? (i > 0 && <li className="nav-separador" aria-hidden="true" />)
                  : <li className="nav-grupo">{grupo}</li>
              )}
              <li
                className={`nav-item ${location.pathname === path ? 'active' : ''}`}
                title={sidebarCollapsed ? label : ''}
              >
                <Link to={path}>
                  <Icon className="nav-icon" size={18} strokeWidth={1.9} />
                  {!sidebarCollapsed && <span className="nav-label">{label}</span>}
                  {!sidebarCollapsed && !incluyePlan(funcion) && (
                    <Lock size={13} className="nav-candado" aria-label="No incluido en tu plan" />
                  )}
                  {path === '/pedidos' && pedidosPorHacer > 0 && (
                    <span className="nav-badge" title="Proveedores a los que hoy toca hacer pedido">{pedidosPorHacer}</span>
                  )}
                </Link>
              </li>
              </React.Fragment>
            ))}
          </ul>
        </nav>

        <div className="sidebar-footer">
          <button
            onClick={() => window.open('https://github.com/DanielPaezR/Manejo_inventarios', '_blank')}
            className="nav-link-btn"
            title={sidebarCollapsed ? 'Ayuda' : ''}
          >
            <CircleHelp className="nav-icon" size={18} strokeWidth={1.9} />
            {!sidebarCollapsed && <span className="nav-label">Ayuda</span>}
          </button>
          {!sidebarCollapsed && <span className="sidebar-version">v2.0.0</span>}
        </div>
      </aside>

      <div className="dashboard-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="btn-toggle-sidebar"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title="Colapsar/Expandir menú (Ctrl+B)"
              aria-label="Colapsar o expandir menú"
            >
              <Menu size={18} />
            </button>
            {paginaActual && <h1 className="topbar-title">{paginaActual.label}</h1>}
          </div>

          <div className="topbar-right">
            {requiereModulo && moduloActivo && (
              puedeCambiarModulo ? (
                <div className="modulo-selector">
                  <button
                    className="modulo-chip modulo-chip-btn"
                    onClick={() => setShowModuloMenu(!showModuloMenu)}
                    title={moduloActivo.descripcion || 'Cambiar módulo'}
                  >
                    <span className="modulo-chip-dot" />
                    {moduloActivo.nombre}
                    <ChevronDown size={14} />
                  </button>
                  {showModuloMenu && (
                    <div className="dropdown dropdown-modulo">
                      <div className="dropdown-label">Cambiar de módulo</div>
                      {modulos.map((modulo) => (
                        <button
                          key={modulo.id}
                          className={`dropdown-item ${modulo.id === moduloActivo.id ? 'active' : ''}`}
                          onClick={() => {
                            cambiarModulo(modulo);
                            setShowModuloMenu(false);
                          }}
                        >
                          <span>{modulo.nombre}</span>
                          {modulo.id === moduloActivo.id && <Check size={15} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <span className="modulo-chip" title={moduloActivo.descripcion || ''}>
                  <span className="modulo-chip-dot" />
                  {moduloActivo.nombre}
                </span>
              )
            )}

            <div className="topbar-user">
              <button className="btn-user" onClick={() => setShowUserMenu(!showUserMenu)} title="Menú de usuario">
                <span className="user-avatar">{inicial}</span>
                <span className="user-info">
                  <span className="user-nombre">{user?.nombre}</span>
                  <span className="user-rol">{ETIQUETA_ROL[user?.rol] || user?.rol}</span>
                </span>
                <ChevronDown size={14} className="user-arrow" />
              </button>

              {showUserMenu && (
                <div className="dropdown dropdown-user">
                  <div className="dropdown-user-header">
                    <span className="user-avatar user-avatar-lg">{inicial}</span>
                    <div className="dropdown-user-info">
                      <strong>{user?.nombre}</strong>
                      <span>{user?.email}</span>
                    </div>
                  </div>
                  <button className="dropdown-item" onClick={() => { setShowUserMenu(false); setShowCambiarPassword(true); }}>
                    <KeyRound size={16} /> Cambiar contraseña
                  </button>
                  <div className="dropdown-divider" />
                  <button
                    className="dropdown-item dropdown-item-danger"
                    onClick={(e) => { e.stopPropagation(); handleLogout(); }}
                  >
                    <LogOut size={16} /> Cerrar sesión
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="main-content">
          {/* key={pathname}: remonta el div en cada navegación para que la
              animación de entrada se dispare de nuevo. */}
          <div key={location.pathname} className="page-transition">
            {bloqueada
              ? <BloqueoPlan titulo={bloqueada.label} funcion={bloqueada.funcion} />
              : <Outlet />}
          </div>
        </main>
      </div>

      {(showUserMenu || showModuloMenu) && (
        <div
          className="dropdown-overlay"
          onClick={() => {
            setShowUserMenu(false);
            setShowModuloMenu(false);
          }}
        />
      )}

      {showCambiarPassword && (
        <CambiarPassword onClose={() => setShowCambiarPassword(false)} />
      )}
    </div>
  );
};

export default Dashboard;
