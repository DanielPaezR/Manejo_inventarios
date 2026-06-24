import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import './Proveedores.css';

const Proveedores = ({ user }) => {
  const { moduloActivo } = useModulo();
  const [proveedores, setProveedores] = useState([]);
  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editProveedor, setEditProveedor] = useState(null);
  const [showProductosModal, setShowProductosModal] = useState(false);
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState(null);
  const [formData, setFormData] = useState({
    nombre: '',
    contacto: '',
    telefono: '',
    email: '',
    direccion: ''
  });
  const [asociacionData, setAsociacionData] = useState({
    producto_id: '',
    precio_compra: '',
    tiempo_entrega_dias: 3,
    cantidad_minima_pedido: 1
  });

  // Verificar permisos
  const puedeGestionar = user?.rol === 'admin' || user?.rol === 'super_admin';

  useEffect(() => {
    if (moduloActivo && puedeGestionar) {
      cargarProveedores();
      cargarProductos();
    }
  }, [moduloActivo]);

  const cargarProveedores = async () => {
    try {
      setLoading(true);
      const response = await api.get('/proveedores');
      setProveedores(response.data);
    } catch (error) {
      console.error('Error cargando proveedores:', error);
      alert('Error al cargar proveedores');
    } finally {
      setLoading(false);
    }
  };

  const cargarProductos = async () => {
    try {
      const response = await api.get('/productos');
      setProductos(response.data);
    } catch (error) {
      console.error('Error cargando productos:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      setLoading(true);
      
      if (editProveedor) {
        await api.put(`/proveedores/${editProveedor.id}`, formData);
        alert('Proveedor actualizado correctamente');
      } else {
        await api.post('/proveedores', formData);
        alert('Proveedor creado correctamente');
      }
      
      setShowModal(false);
      setEditProveedor(null);
      setFormData({
        nombre: '',
        contacto: '',
        telefono: '',
        email: '',
        direccion: ''
      });
      cargarProveedores();
    } catch (error) {
      console.error('Error guardando proveedor:', error);
      alert(error.response?.data?.error || 'Error al guardar el proveedor');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Estás seguro de eliminar este proveedor?')) return;
    
    try {
      await api.delete(`/proveedores/${id}`);
      alert('Proveedor eliminado correctamente');
      cargarProveedores();
    } catch (error) {
      console.error('Error eliminando proveedor:', error);
      alert('Error al eliminar el proveedor');
    }
  };

  const handleEdit = (proveedor) => {
    setEditProveedor(proveedor);
    setFormData({
      nombre: proveedor.nombre,
      contacto: proveedor.contacto || '',
      telefono: proveedor.telefono || '',
      email: proveedor.email || '',
      direccion: proveedor.direccion || ''
    });
    setShowModal(true);
  };

  const handleAsociarProducto = async () => {
    if (!proveedorSeleccionado || !asociacionData.producto_id) {
      alert('Selecciona un producto');
      return;
    }

    try {
      setLoading(true);
      await api.post(
        `/productos/${asociacionData.producto_id}/proveedores/${proveedorSeleccionado.id}`,
        {
          precio_compra: parseFloat(asociacionData.precio_compra) || 0,
          tiempo_entrega_dias: parseInt(asociacionData.tiempo_entrega_dias) || 3,
          cantidad_minima_pedido: parseInt(asociacionData.cantidad_minima_pedido) || 1
        }
      );
      
      alert('Producto asociado correctamente');
      setShowProductosModal(false);
      setAsociacionData({
        producto_id: '',
        precio_compra: '',
        tiempo_entrega_dias: 3,
        cantidad_minima_pedido: 1
      });
      cargarProveedores();
    } catch (error) {
      console.error('Error asociando producto:', error);
      alert(error.response?.data?.error || 'Error al asociar producto');
    } finally {
      setLoading(false);
    }
  };

  const handleDesasociarProducto = async (proveedorId, productoId) => {
    if (!confirm('¿Desasociar este producto del proveedor?')) return;
    
    try {
      // Nota: Esta ruta aún no existe, la agregaremos después
      alert('Funcionalidad en desarrollo');
    } catch (error) {
      console.error('Error desasociando producto:', error);
      alert('Error al desasociar producto');
    }
  };

  if (!puedeGestionar) {
    return (
      <div className="proveedores-container">
        <div className="alert alert-warning">
          ⚠️ No tienes permisos para gestionar proveedores. Solo administradores pueden acceder a esta sección.
        </div>
      </div>
    );
  }

  if (!moduloActivo) {
    return (
      <div className="proveedores-container">
        <div className="alert alert-warning">
          ⚠️ No hay módulo activo. Selecciona un módulo para gestionar proveedores.
        </div>
      </div>
    );
  }

  return (
    <div className="proveedores-container">
      <div className="proveedores-header">
        <div className="header-left">
          <h2>🤝 Gestión de Proveedores</h2>
          <div className="modulo-indicador">
            <span className="badge">📁 {moduloActivo.nombre}</span>
          </div>
        </div>
        <button 
          onClick={() => { setEditProveedor(null); setFormData({ nombre: '', contacto: '', telefono: '', email: '', direccion: '' }); setShowModal(true); }} 
          className="btn-agregar"
        >
          + Nuevo Proveedor
        </button>
      </div>

      {loading && !showModal ? (
        <div className="loading">Cargando proveedores...</div>
      ) : (
        <div className="proveedores-grid">
          {proveedores.length === 0 ? (
            <div className="sin-datos">
              <p>No hay proveedores registrados</p>
              <button onClick={() => { setEditProveedor(null); setFormData({ nombre: '', contacto: '', telefono: '', email: '', direccion: '' }); setShowModal(true); }} className="btn-agregar-primero">
                + Agregar primer proveedor
              </button>
            </div>
          ) : (
            proveedores.map(proveedor => (
              <div key={proveedor.id} className="proveedor-card">
                <div className="proveedor-card-header">
                  <div className="proveedor-nombre">
                    <h3>{proveedor.nombre}</h3>
                    {proveedor.contacto && (
                      <span className="proveedor-contacto">👤 {proveedor.contacto}</span>
                    )}
                  </div>
                  <div className="proveedor-actions">
                    <button onClick={() => handleEdit(proveedor)} className="btn-editar">
                      ✏️
                    </button>
                    <button onClick={() => handleDelete(proveedor.id)} className="btn-eliminar">
                      🗑️
                    </button>
                  </div>
                </div>

                <div className="proveedor-card-body">
                  {proveedor.telefono && (
                    <div className="proveedor-info-item">
                      <span className="info-icon">📞</span>
                      <span className="info-value">{proveedor.telefono}</span>
                      <button 
                        onClick={() => window.open(`https://wa.me/${proveedor.telefono.replace(/\D/g, '')}`, '_blank')}
                        className="btn-whatsapp"
                        title="Contactar por WhatsApp"
                      >
                        💬
                      </button>
                    </div>
                  )}
                  {proveedor.email && (
                    <div className="proveedor-info-item">
                      <span className="info-icon">✉️</span>
                      <span className="info-value">{proveedor.email}</span>
                    </div>
                  )}
                  {proveedor.direccion && (
                    <div className="proveedor-info-item">
                      <span className="info-icon">📍</span>
                      <span className="info-value">{proveedor.direccion}</span>
                    </div>
                  )}
                </div>

                <div className="proveedor-card-footer">
                  <div className="productos-asociados">
                    <span className="productos-count">
                      📦 {proveedor.productos_asociados?.length || 0} productos asociados
                    </span>
                  </div>
                  <button 
                    onClick={() => {
                      setProveedorSeleccionado(proveedor);
                      setShowProductosModal(true);
                    }} 
                    className="btn-asociar"
                  >
                    + Asociar Producto
                  </button>
                </div>

                {proveedor.productos_asociados && proveedor.productos_asociados.length > 0 && (
                  <div className="productos-lista-mini">
                    {proveedor.productos_asociados.slice(0, 5).map((prodId, index) => {
                      const producto = productos.find(p => p.id === prodId);
                      return producto ? (
                        <span key={index} className="producto-tag">
                          {producto.nombre}
                        </span>
                      ) : null;
                    })}
                    {proveedor.productos_asociados.length > 5 && (
                      <span className="producto-tag-mas">+{proveedor.productos_asociados.length - 5} más</span>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Modal de proveedor */}
      {showModal && (
        <div className="modal" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editProveedor ? 'Editar Proveedor' : 'Nuevo Proveedor'}</h3>
              <button onClick={() => setShowModal(false)}>✕</button>
            </div>
            
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Nombre *</label>
                <input
                  type="text"
                  value={formData.nombre}
                  onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                  placeholder="Nombre del proveedor"
                  required
                />
              </div>

              <div className="form-group">
                <label>Contacto</label>
                <input
                  type="text"
                  value={formData.contacto}
                  onChange={(e) => setFormData({ ...formData, contacto: e.target.value })}
                  placeholder="Nombre del contacto"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Teléfono</label>
                  <input
                    type="tel"
                    value={formData.telefono}
                    onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
                    placeholder="Ej: 3101234567"
                  />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="proveedor@correo.com"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Dirección</label>
                <input
                  type="text"
                  value={formData.direccion}
                  onChange={(e) => setFormData({ ...formData, direccion: e.target.value })}
                  placeholder="Dirección del proveedor"
                />
              </div>

              <div className="form-actions">
                <button type="submit" className="btn-guardar" disabled={loading}>
                  {loading ? 'Guardando...' : editProveedor ? 'Actualizar' : 'Guardar'}
                </button>
                <button type="button" onClick={() => setShowModal(false)} className="btn-cancelar">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de asociación de productos */}
      {showProductosModal && proveedorSeleccionado && (
        <div className="modal" onClick={() => setShowProductosModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Asociar Producto a {proveedorSeleccionado.nombre}</h3>
              <button onClick={() => setShowProductosModal(false)}>✕</button>
            </div>
            
            <div className="asociacion-form">
              <div className="form-group">
                <label>Producto *</label>
                <select
                  value={asociacionData.producto_id}
                  onChange={(e) => setAsociacionData({ ...asociacionData, producto_id: e.target.value })}
                >
                  <option value="">Seleccionar producto...</option>
                  {productos
                    .filter(p => !proveedorSeleccionado.productos_asociados?.includes(p.id))
                    .map(producto => (
                      <option key={producto.id} value={producto.id}>
                        {producto.nombre} - Stock: {producto.stock_actual}
                      </option>
                    ))}
                </select>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Precio de compra</label>
                  <input
                    type="number"
                    step="0.01"
                    value={asociacionData.precio_compra}
                    onChange={(e) => setAsociacionData({ ...asociacionData, precio_compra: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
                <div className="form-group">
                  <label>Días de entrega</label>
                  <input
                    type="number"
                    value={asociacionData.tiempo_entrega_dias}
                    onChange={(e) => setAsociacionData({ ...asociacionData, tiempo_entrega_dias: e.target.value })}
                    placeholder="3"
                    min="1"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Cantidad mínima de pedido</label>
                <input
                  type="number"
                  value={asociacionData.cantidad_minima_pedido}
                  onChange={(e) => setAsociacionData({ ...asociacionData, cantidad_minima_pedido: e.target.value })}
                  placeholder="1"
                  min="1"
                />
              </div>

              <div className="form-actions">
                <button onClick={handleAsociarProducto} className="btn-guardar" disabled={loading}>
                  {loading ? 'Asociando...' : '✅ Asociar Producto'}
                </button>
                <button type="button" onClick={() => setShowProductosModal(false)} className="btn-cancelar">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Proveedores;