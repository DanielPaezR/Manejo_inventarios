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
  const [abonos, setAbonos] = useState([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [abonoForm, setAbonoForm] = useState({ monto: '', concepto: '' });
  const [guardandoAbono, setGuardandoAbono] = useState(false);
  const [deudaManualForm, setDeudaManualForm] = useState({ monto: '', concepto: '' });
  const [guardandoDeudaManual, setGuardandoDeudaManual] = useState(false);
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

  // Separado de handleVerHistorial para poder recargar el historial (y los
  // abonos) después de registrar un abono, sin resetear el modal ni el
  // formulario que el usuario tiene abierto.
  const cargarHistorial = useCallback(async (clienteId) => {
    try {
      setCargandoHistorial(true);
      const response = await api.get(`/clientes/${clienteId}/historial`);
      setHistorial(response.data.ventas || []);
      setAbonos(response.data.abonos || []);
    } catch (error) {
      console.error('Error cargando historial:', error);
      alert('Error al cargar el historial del cliente');
    } finally {
      setCargandoHistorial(false);
    }
  }, []);

  const handleVerHistorial = (cliente) => {
    setClienteHistorial(cliente);
    setShowHistorialModal(true);
    setHistorial([]);
    setAbonos([]);
    setAbonoForm({ monto: '', concepto: '' });
    setDeudaManualForm({ monto: '', concepto: '' });
    cargarHistorial(cliente.id);
  };

  const handleRegistrarAbono = async (e) => {
    e.preventDefault();

    const montoNum = Number(abonoForm.monto);
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      alert('Ingresa un monto válido');
      return;
    }

    try {
      setGuardandoAbono(true);
      const response = await api.post(`/clientes/${clienteHistorial.id}/abonos`, {
        monto: montoNum,
        concepto: abonoForm.concepto.trim() || undefined
      });
      // Actualiza la deuda mostrada en el modal y en la tarjeta del listado
      setClienteHistorial(prev => prev ? { ...prev, deuda_actual: response.data.deuda_actual } : prev);
      setAbonoForm({ monto: '', concepto: '' });
      cargarHistorial(clienteHistorial.id);
      cargarClientes(busqueda);
    } catch (error) {
      console.error('Error registrando abono:', error);
      alert(error.response?.data?.error || 'Error al registrar el abono');
    } finally {
      setGuardandoAbono(false);
    }
  };

  // Para dar de alta deuda existente antes del sistema. De aquí en
  // adelante, la deuda nueva debe registrarse vendiendo a crédito desde
  // Ventas — esto es solo para la carga inicial.
  const handleRegistrarDeudaManual = async (e) => {
    e.preventDefault();

    const montoNum = Number(deudaManualForm.monto);
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      alert('Ingresa un monto válido');
      return;
    }

    if (!confirm(`¿Confirmas agregar $${montoNum.toLocaleString()} de deuda existente para ${clienteHistorial.nombre}?`)) {
      return;
    }

    try {
      setGuardandoDeudaManual(true);
      const response = await api.post(`/clientes/${clienteHistorial.id}/deuda-manual`, {
        monto: montoNum,
        concepto: deudaManualForm.concepto.trim() || undefined
      });
      setClienteHistorial(prev => prev ? { ...prev, deuda_actual: response.data.deuda_actual } : prev);
      setDeudaManualForm({ monto: '', concepto: '' });
      cargarHistorial(clienteHistorial.id);
      cargarClientes(busqueda);
    } catch (error) {
      console.error('Error registrando deuda manual:', error);
      alert(error.response?.data?.error || 'Error al registrar la deuda');
    } finally {
      setGuardandoDeudaManual(false);
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

                {Number(cliente.deuda_actual) > 0 ? (
                  <span className="cliente-deuda-badge con-deuda">
                    Debe: ${Number(cliente.deuda_actual).toLocaleString()}
                  </span>
                ) : Number(cliente.deuda_actual) < 0 ? (
                  <span className="cliente-deuda-badge a-favor">
                    A favor: ${Math.abs(Number(cliente.deuda_actual)).toLocaleString()}
                  </span>
                ) : (
                  <span className="cliente-deuda-badge">Debe: $0</span>
                )}

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

            {Number(clienteHistorial.deuda_actual) > 0 ? (
              <div className="historial-deuda con-deuda">
                Debe: ${Number(clienteHistorial.deuda_actual).toLocaleString()}
              </div>
            ) : Number(clienteHistorial.deuda_actual) < 0 ? (
              <div className="historial-deuda a-favor">
                A favor: ${Math.abs(Number(clienteHistorial.deuda_actual)).toLocaleString()}
              </div>
            ) : (
              <div className="historial-deuda">Debe: $0</div>
            )}

            <form onSubmit={handleRegistrarAbono} className="abono-form">
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={abonoForm.monto}
                onChange={(e) => setAbonoForm({ ...abonoForm, monto: e.target.value })}
                placeholder="Monto del abono"
                required
              />
              <input
                type="text"
                value={abonoForm.concepto}
                onChange={(e) => setAbonoForm({ ...abonoForm, concepto: e.target.value })}
                placeholder="Concepto (opcional)"
              />
              <button type="submit" className="btn-registrar-abono" disabled={guardandoAbono}>
                {guardandoAbono ? 'Guardando...' : '💰 Registrar abono'}
              </button>
            </form>

            <form onSubmit={handleRegistrarDeudaManual} className="deuda-manual-form">
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={deudaManualForm.monto}
                onChange={(e) => setDeudaManualForm({ ...deudaManualForm, monto: e.target.value })}
                placeholder="Monto de deuda a agregar"
                required
              />
              <input
                type="text"
                value={deudaManualForm.concepto}
                onChange={(e) => setDeudaManualForm({ ...deudaManualForm, concepto: e.target.value })}
                placeholder="Concepto (opcional)"
              />
              <button type="submit" className="btn-registrar-deuda" disabled={guardandoDeudaManual}>
                {guardandoDeudaManual ? 'Guardando...' : '📒 Agregar deuda existente'}
              </button>
            </form>

            {cargandoHistorial ? (
              <div className="loading">Cargando historial...</div>
            ) : historial.length === 0 && abonos.length === 0 ? (
              <p className="sin-historial">Este cliente aún no tiene compras ni abonos registrados.</p>
            ) : (
              <div className="historial-lista">
                {[
                  ...historial.map(venta => ({ tipo: 'venta', fecha: venta.fecha_venta, data: venta })),
                  ...abonos.map(abono => ({ tipo: 'abono', fecha: abono.fecha, data: abono }))
                ]
                  .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
                  .map((item, index) => (
                    item.tipo === 'venta' ? (
                      <div key={`venta-${item.data.id}`} className="historial-item">
                        <div className="historial-item-header">
                          <span className="historial-factura">🛒 {item.data.numero_factura}</span>
                          <span className="historial-total">${Number(item.data.total).toLocaleString()}</span>
                        </div>
                        <div className="historial-item-meta">
                          <span>{new Date(item.data.fecha_venta).toLocaleString()}</span>
                          <span>Vendedor: {item.data.vendedor_nombre}</span>
                          {item.data.metodo_pago === 'credito' && <span className="historial-credito-badge">📒 Crédito</span>}
                        </div>
                      </div>
                    ) : (
                      <div key={`abono-${item.data.id}`} className="historial-item abono">
                        <div className="historial-item-header">
                          <span className="historial-factura">💰 {item.data.concepto}</span>
                          <span className="historial-total abono">+${Number(item.data.monto).toLocaleString()}</span>
                        </div>
                        <div className="historial-item-meta">
                          <span>{new Date(item.data.fecha).toLocaleString()}</span>
                          {item.data.usuario_nombre && <span>Registrado por: {item.data.usuario_nombre}</span>}
                        </div>
                      </div>
                    )
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
