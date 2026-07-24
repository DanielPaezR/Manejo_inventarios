import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import './Clientes.css';

const Clientes = ({ user }) => {
  const { moduloActivo } = useModulo();
  const [clientes, setClientes] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editCliente, setEditCliente] = useState(null);
  const [showHistorialModal, setShowHistorialModal] = useState(false);
  const [clienteHistorial, setClienteHistorial] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [formData, setFormData] = useState({
    nombre: '',
    cedula: '',
    telefono: '',
    direccion: '',
    email: ''
  });

  // Verificar permisos
  const puedeGestionar = user?.rol === 'admin' || user?.rol === 'super_admin';

  const cargarClientes = useCallback(async (search) => {
    try {
      setLoading(true);
      const response = await api.get('/clientes', { params: search ? { search } : {} });
      setClientes(response.data);
    } catch (error) {
      console.error('Error cargando clientes:', error);
      alert('Error al cargar clientes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (moduloActivo && puedeGestionar) {
      cargarClientes();
    }
  }, [moduloActivo, puedeGestionar, cargarClientes]);

  // Búsqueda con debounce
  useEffect(() => {
    if (!moduloActivo || !puedeGestionar) return;
    const timeoutId = setTimeout(() => {
      cargarClientes(busqueda);
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [busqueda, moduloActivo, puedeGestionar, cargarClientes]);

  const resetForm = () => {
    setFormData({ nombre: '', cedula: '', telefono: '', direccion: '', email: '' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      setLoading(true);

      if (editCliente) {
        await api.put(`/clientes/${editCliente.id}`, formData);
        alert('Cliente actualizado correctamente');
      } else {
        await api.post('/clientes', formData);
        alert('Cliente creado correctamente');
      }

      setShowModal(false);
      setEditCliente(null);
      resetForm();
      cargarClientes(busqueda);
    } catch (error) {
      console.error('Error guardando cliente:', error);
      alert(error.response?.data?.error || 'Error al guardar el cliente');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (cliente) => {
    setEditCliente(cliente);
    setFormData({
      nombre: cliente.nombre,
      cedula: cliente.cedula || '',
      telefono: cliente.telefono || '',
      direccion: cliente.direccion || '',
      email: cliente.email || ''
    });
    setShowModal(true);
  };

  const handleVerHistorial = async (cliente) => {
    setClienteHistorial(cliente);
    setShowHistorialModal(true);
    setHistorial([]);

    try {
      setCargandoHistorial(true);
      const response = await api.get(`/clientes/${cliente.id}/historial`);
      setHistorial(response.data);
    } catch (error) {
      console.error('Error cargando historial:', error);
      alert('Error al cargar el historial del cliente');
    } finally {
      setCargandoHistorial(false);
    }
  };

  if (!puedeGestionar) {
    return (
      <div className="clientes-container">
        <div className="alert alert-warning">
          ⚠️ No tienes permisos para gestionar clientes. Solo administradores pueden acceder a esta sección.
        </div>
      </div>
    );
  }

  if (!moduloActivo) {
    return (
      <div className="clientes-container">
        <div className="alert alert-warning">
          ⚠️ No hay módulo activo. Selecciona un módulo para gestionar clientes.
        </div>
      </div>
    );
  }

  return (
    <div className="clientes-container">
      <div className="clientes-header">
        <div className="header-left">
          <h2>👤 Clientes</h2>
          <div className="modulo-indicador">
            <span className="badge">📁 {moduloActivo.nombre}</span>
          </div>
        </div>
        <button
          onClick={() => { setEditCliente(null); resetForm(); setShowModal(true); }}
          className="btn-agregar"
        >
          + Nuevo Cliente
        </button>
      </div>

      <div className="clientes-busqueda">
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="🔍 Buscar por nombre o cédula..."
          className="busqueda-input-clientes"
        />
      </div>

      {loading && !showModal ? (
        <div className="loading">Cargando clientes...</div>
      ) : (
        <div className="clientes-grid">
          {clientes.length === 0 ? (
            <div className="sin-datos">
              <p>No hay clientes registrados</p>
              <button onClick={() => { setEditCliente(null); resetForm(); setShowModal(true); }} className="btn-agregar-primero">
                + Agregar primer cliente
              </button>
            </div>
          ) : (
            clientes.map(cliente => (
              <div key={cliente.id} className="cliente-card">
                <div className="cliente-card-header">
                  <div className="cliente-nombre">
                    <span className="cliente-numero">#{cliente.numero_cliente}</span>
                    <h3>{cliente.nombre}</h3>
                  </div>
                  <div className="cliente-actions">
                    <button onClick={() => handleEdit(cliente)} className="btn-editar">
                      ✏️
                    </button>
                  </div>
                </div>

                <div className="cliente-card-body">
                  {cliente.cedula && (
                    <div className="cliente-info-item">
                      <span className="info-icon">🪪</span>
                      <span className="info-value">{cliente.cedula}</span>
                    </div>
                  )}
                  {cliente.telefono && (
                    <div className="cliente-info-item">
                      <span className="info-icon">📞</span>
                      <span className="info-value">{cliente.telefono}</span>
                      <button
                        onClick={() => window.open(`https://wa.me/${cliente.telefono.replace(/\D/g, '')}`, '_blank')}
                        className="btn-whatsapp"
                        title="Contactar por WhatsApp"
                      >
                        💬
                      </button>
                    </div>
                  )}
                  {cliente.email && (
                    <div className="cliente-info-item">
                      <span className="info-icon">✉️</span>
                      <span className="info-value">{cliente.email}</span>
                    </div>
                  )}
                  {cliente.direccion && (
                    <div className="cliente-info-item">
                      <span className="info-icon">📍</span>
                      <span className="info-value">{cliente.direccion}</span>
                    </div>
                  )}
                </div>

                <div className="cliente-card-footer">
                  <button onClick={() => handleVerHistorial(cliente)} className="btn-historial">
                    🧾 Ver historial de compras
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Modal de cliente */}
      {showModal && (
        <div className="modal" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editCliente ? 'Editar Cliente' : 'Nuevo Cliente'}</h3>
              <button onClick={() => setShowModal(false)}>✕</button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Nombre *</label>
                <input
                  type="text"
                  value={formData.nombre}
                  onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                  placeholder="Nombre del cliente"
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Cédula</label>
                  <input
                    type="text"
                    value={formData.cedula}
                    onChange={(e) => setFormData({ ...formData, cedula: e.target.value })}
                    placeholder="Número de documento"
                  />
                </div>
                <div className="form-group">
                  <label>Teléfono</label>
                  <input
                    type="tel"
                    value={formData.telefono}
                    onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                    placeholder="Ej: 3101234567"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="cliente@correo.com"
                />
              </div>

              <div className="form-group">
                <label>Dirección</label>
                <input
                  type="text"
                  value={formData.direccion}
                  onChange={(e) => setFormData({ ...formData, direccion: e.target.value })}
                  placeholder="Dirección del cliente"
                />
              </div>

              <div className="form-actions">
                <button type="submit" className="btn-guardar" disabled={loading}>
                  {loading ? 'Guardando...' : editCliente ? 'Actualizar' : 'Guardar'}
                </button>
                <button type="button" onClick={() => setShowModal(false)} className="btn-cancelar">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de historial de compras */}
      {showHistorialModal && clienteHistorial && (
        <div className="modal" onClick={() => setShowHistorialModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🧾 Historial de {clienteHistorial.nombre}</h3>
              <button onClick={() => setShowHistorialModal(false)}>✕</button>
            </div>

            {cargandoHistorial ? (
              <div className="loading">Cargando historial...</div>
            ) : historial.length === 0 ? (
              <p className="sin-historial">Este cliente aún no tiene compras registradas.</p>
            ) : (
              <div className="historial-lista">
                {historial.map(venta => (
                  <div key={venta.id} className="historial-item">
                    <div className="historial-item-header">
                      <span className="historial-factura">{venta.numero_factura}</span>
                      <span className="historial-total">${Number(venta.total).toLocaleString()}</span>
                    </div>
                    <div className="historial-item-meta">
                      <span>{new Date(venta.fecha_venta).toLocaleString()}</span>
                      <span>Vendedor: {venta.vendedor_nombre}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Clientes;
