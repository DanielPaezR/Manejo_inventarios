import React, { useState, useEffect } from 'react';
import api from '../services/api';
import './Negocios.css';

const Negocios = ({ user }) => {
  const [negocios, setNegocios] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showGestionUsuarios, setShowGestionUsuarios] = useState(false);
  const [showEstadisticas, setShowEstadisticas] = useState(false);
  const [negocioSeleccionado, setNegocioSeleccionado] = useState(null);
  const [usuarios, setUsuarios] = useState([]);
  const [estadisticas, setEstadisticas] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mensaje, setMensaje] = useState('');

  const [formData, setFormData] = useState({
    nombre: '',
    direccion: '',
    telefono: '',
    email: '',
    ruc_nit: '',
    logo_url: ''
  });

  const [usuarioForm, setUsuarioForm] = useState({
    nombre: '',
    email: '',
    password: '',
    rol: 'trabajador'
  });

  useEffect(() => {
    cargarNegocios();
  }, []);

  const cargarNegocios = async () => {
    try {
      const response = await api.get('/negocios');
      setNegocios(response.data);
    } catch (error) {
      console.error('Error cargando negocios:', error);
      setMensaje('❌ Error al cargar negocios');
    }
  };

  const cargarUsuariosNegocio = async (negocioId) => {
    try {
      const response = await api.get(`/negocios/${negocioId}/usuarios`);
      setUsuarios(response.data);
    } catch (error) {
      console.error('Error cargando usuarios:', error);
      setMensaje('❌ Error al cargar usuarios');
    }
  };

  const cargarEstadisticasNegocio = async (negocioId) => {
    try {
      const response = await api.get(`/estadisticas?negocio_id=${negocioId}`);
      setEstadisticas(response.data);
    } catch (error) {
      console.error('Error cargando estadísticas:', error);
      setMensaje('❌ Error al cargar estadísticas');
    }
  };

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleUsuarioInputChange = (e) => {
    setUsuarioForm({
      ...usuarioForm,
      [e.target.name]: e.target.value
    });
  };

  const resetForm = () => {
    setFormData({
      nombre: '',
      direccion: '',
      telefono: '',
      email: '',
      ruc_nit: '',
      logo_url: ''
    });
    setShowForm(false);
  };

  const resetUsuarioForm = () => {
    setUsuarioForm({
      nombre: '',
      email: '',
      password: '',
      rol: 'trabajador'
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await api.post('/negocios', formData);
      setMensaje('✅ Negocio creado correctamente');
      resetForm();
      cargarNegocios();
    } catch (error) {
      console.error('Error creando negocio:', error);
      setMensaje('❌ Error al crear el negocio');
    } finally {
      setLoading(false);
      setTimeout(() => setMensaje(''), 5000);
    }
  };

  const handleCrearUsuario = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await api.post(`/negocios/${negocioSeleccionado.id}/usuarios`, usuarioForm);
      setMensaje('✅ Usuario creado correctamente');
      resetUsuarioForm();
      cargarUsuariosNegocio(negocioSeleccionado.id);
    } catch (error) {
      console.error('Error creando usuario:', error);
      setMensaje('❌ Error al crear el usuario');
    } finally {
      setLoading(false);
      setTimeout(() => setMensaje(''), 5000);
    }
  };

  const eliminarUsuario = async (usuarioId) => {
    if (!window.confirm('¿Estás seguro de que quieres eliminar este usuario?')) {
      return;
    }

    try {
      await api.delete(`/usuarios/${usuarioId}`);
      setMensaje('✅ Usuario eliminado correctamente');
      cargarUsuariosNegocio(negocioSeleccionado.id);
    } catch (error) {
      console.error('Error eliminando usuario:', error);
      setMensaje('❌ Error al eliminar el usuario');
    }
  };

  const abrirGestionUsuarios = async (negocio) => {
    setNegocioSeleccionado(negocio);
    setShowGestionUsuarios(true);
    await cargarUsuariosNegocio(negocio.id);
  };

  const abrirEstadisticas = async (negocio) => {
    setNegocioSeleccionado(negocio);
    setShowEstadisticas(true);
    await cargarEstadisticasNegocio(negocio.id);
  };

  return (
    <div className="negocios-container">
      {/* Modal Gestión de Usuarios */}
      {showGestionUsuarios && (
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header">
              <h2>👥 Gestión de Usuarios - {negocioSeleccionado?.nombre}</h2>
              <button className="btn-close" onClick={() => setShowGestionUsuarios(false)}>×</button>
            </div>
            
            <div className="modal-content">
              {/* Formulario Crear Usuario */}
              <div className="usuario-form-section">
                <h3>➕ Crear Nuevo Usuario</h3>
                <form onSubmit={handleCrearUsuario} className="usuario-form">
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Nombre *:</label>
                      <input
                        type="text"
                        name="nombre"
                        value={usuarioForm.nombre}
                        onChange={handleUsuarioInputChange}
                        required
                        placeholder="Nombre completo"
                      />
                    </div>
                    
                    <div className="form-group">
                      <label>Email *:</label>
                      <input
                        type="email"
                        name="email"
                        value={usuarioForm.email}
                        onChange={handleUsuarioInputChange}
                        required
                        placeholder="usuario@negocio.com"
                      />
                    </div>
                    
                    <div className="form-group">
                      <label>Contraseña *:</label>
                      <input
                        type="password"
                        name="password"
                        value={usuarioForm.password}
                        onChange={handleUsuarioInputChange}
                        required
                        placeholder="Mínimo 6 caracteres"
                        minLength="6"
                      />
                    </div>
                    
                    <div className="form-group">
                      <label>Rol *:</label>
                      <select
                        name="rol"
                        value={usuarioForm.rol}
                        onChange={handleUsuarioInputChange}
                        required
                      >
                        <option value="trabajador">Trabajador</option>
                        <option value="admin">Administrador</option>
                      </select>
                    </div>
                  </div>
                  
                  <button type="submit" disabled={loading} className="btn-primary">
                    {loading ? 'Creando...' : 'Crear Usuario'}
                  </button>
                </form>
              </div>

              {/* Lista de Usuarios Existentes */}
              <div className="usuarios-list-section">
                <h3>📋 Usuarios del Negocio</h3>
                <div className="usuarios-grid">
                  {usuarios.map(usuario => (
                    <div key={usuario.id} className="usuario-card">
                      <div className="usuario-info">
                        <h4>{usuario.nombre}</h4>
                        <p><strong>Email:</strong> {usuario.email}</p>
                        <p><strong>Rol:</strong> 
                          <span className={`rol-badge ${usuario.rol}`}>
                            {usuario.rol}
                          </span>
                        </p>
                        <p><strong>Creado:</strong> {new Date(usuario.fecha_creacion).toLocaleDateString()}</p>
                      </div>
                      <div className="usuario-actions">
                        <button 
                          onClick={() => eliminarUsuario(usuario.id)}
                          className="btn-eliminar"
                          disabled={usuario.email === user.email}
                        >
                          🗑️ Eliminar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Estadísticas */}
      {showEstadisticas && (
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header">
              <h2>📊 Estadísticas - {negocioSeleccionado?.nombre}</h2>
              <button className="btn-close" onClick={() => setShowEstadisticas(false)}>×</button>
            </div>
            
            <div className="modal-content">
              {estadisticas ? (
                <div className="estadisticas-grid">
                  <div className="estadistica-card">
                    <h3>💰 Ventas Hoy</h3>
                    <p className="estadistica-valor">${estadisticas.ventasHoy.monto.toLocaleString()}</p>
                    <p className="estadistica-desc">{estadisticas.ventasHoy.total} ventas</p>
                  </div>
                  
                  <div className="estadistica-card">
                    <h3>📦 Stock Bajo</h3>
                    <p className="estadistica-valor">{estadisticas.productosStockBajo.total}</p>
                    <p className="estadistica-desc">productos</p>
                  </div>
                  
                  <div className="estadistica-card">
                    <h3>🔥 Top Productos</h3>
                    <div className="top-productos">
                      {estadisticas.topProductos.map((producto, index) => (
                        <div key={index} className="top-producto">
                          <span className="ranking">#{index + 1}</span>
                          <span className="producto-nombre">{producto.nombre}</span>
                          <span className="producto-vendido">{producto.total_vendido} und</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  <div className="estadistica-card full-width">
                    <h3>📈 Ventas Última Semana</h3>
                    <div className="ventas-semana">
                      {estadisticas.ventasUltimaSemana.map((dia, index) => (
                        <div key={index} className="venta-dia">
                          <span className="dia">{new Date(dia.fecha).toLocaleDateString('es-ES', { weekday: 'short' })}</span>
                          <span className="ventas-cantidad">{dia.cantidad} ventas</span>
                          <span className="ventas-total">${dia.total.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p>Cargando estadísticas...</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Contenido Principal */}
      <div className="negocios-header">
        <h1>🏢 Gestión de Negocios</h1>
        <button 
          onClick={() => setShowForm(true)}
          className="btn-primary"
        >
          🏢 Nuevo Negocio
        </button>
      </div>

      {mensaje && <div className="mensaje">{mensaje}</div>}

      {/* Formulario de Negocio */}
      {showForm && (
        <div className="form-overlay">
          <div className="form-container">
            <h2>Nuevo Negocio</h2>
            
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="form-group full-width">
                  <label>Nombre del Negocio *:</label>
                  <input
                    type="text"
                    name="nombre"
                    value={formData.nombre}
                    onChange={handleInputChange}
                    required
                    placeholder="Mi Negocio S.A.S"
                  />
                </div>

                <div className="form-group full-width">
                  <label>Dirección:</label>
                  <input
                    type="text"
                    name="direccion"
                    value={formData.direccion}
                    onChange={handleInputChange}
                    placeholder="Calle 123 # 45-67"
                  />
                </div>

                <div className="form-group">
                  <label>Teléfono:</label>
                  <input
                    type="text"
                    name="telefono"
                    value={formData.telefono}
                    onChange={handleInputChange}
                    placeholder="3001234567"
                  />
                </div>

                <div className="form-group">
                  <label>Email:</label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    placeholder="info@negocio.com"
                  />
                </div>

                <div className="form-group">
                  <label>NIT/RUC:</label>
                  <input
                    type="text"
                    name="ruc_nit"
                    value={formData.ruc_nit}
                    onChange={handleInputChange}
                    placeholder="123456789-0"
                  />
                </div>

                <div className="form-group">
                  <label>URL del Logo (opcional):</label>
                  <input
                    type="url"
                    name="logo_url"
                    value={formData.logo_url}
                    onChange={handleInputChange}
                    placeholder="https://ejemplo.com/logo.png"
                  />
                </div>
              </div>

              <div className="form-actions">
                <button type="submit" disabled={loading} className="btn-primary">
                  {loading ? 'Creando...' : 'Crear Negocio'}
                </button>
                <button type="button" onClick={resetForm} className="btn-secondary">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lista de Negocios */}
      <div className="negocios-grid">
        {negocios.map(negocio => (
          <div key={negocio.id} className="negocio-card">
            <div className="negocio-header">
              <h3>{negocio.nombre}</h3>
              <span className={`estado ${negocio.activo ? 'activo' : 'inactivo'}`}>
                {negocio.activo ? 'Activo' : 'Inactivo'}
              </span>
            </div>
            
            <div className="negocio-info">
              {negocio.direccion && (
                <p><strong>📍 Dirección:</strong> {negocio.direccion}</p>
              )}
              {negocio.telefono && (
                <p><strong>📞 Teléfono:</strong> {negocio.telefono}</p>
              )}
              {negocio.email && (
                <p><strong>📧 Email:</strong> {negocio.email}</p>
              )}
              {negocio.ruc_nit && (
                <p><strong>🔢 NIT/RUC:</strong> {negocio.ruc_nit}</p>
              )}
              <p><strong>📅 Creado:</strong> {new Date(negocio.fecha_creacion).toLocaleDateString()}</p>
            </div>

            <div className="negocio-actions">
              <button 
                onClick={() => abrirGestionUsuarios(negocio)}
                className="btn-gestion-usuarios"
              >
                👥 Gestionar Usuarios
              </button>
              <button 
                onClick={() => abrirEstadisticas(negocio)}
                className="btn-estadisticas"
              >
                📊 Ver Estadísticas
              </button>
            </div>
          </div>
        ))}
      </div>

      {negocios.length === 0 && (
        <div className="empty-state">
          <p>No hay negocios registrados</p>
          <button 
            onClick={() => setShowForm(true)}
            className="btn-primary"
          >
            🏢 Crear Primer Negocio
          </button>
        </div>
      )}
    </div>
  );
};

export default Negocios;