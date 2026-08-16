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
    direccion: '',
    dias_entrega: ''
  });
  // Modal de gestión de productos asociados: sección A (ya asociados, con
  // edición inline) y sección B (asignar nuevos, multi-selección).
  const [productosAsociados, setProductosAsociados] = useState([]);
  const [cargandoAsociados, setCargandoAsociados] = useState(false);
  const [edicionesAsociados, setEdicionesAsociados] = useState({});
  const [guardandoEdiciones, setGuardandoEdiciones] = useState(false);
  const [busquedaProductoNuevo, setBusquedaProductoNuevo] = useState('');
  const [seleccionados, setSeleccionados] = useState({});
  const [asignandoSeleccionados, setAsignandoSeleccionados] = useState(false);

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
        direccion: '',
        dias_entrega: ''
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
      direccion: proveedor.direccion || '',
      dias_entrega: proveedor.dias_entrega || ''
    });
    setShowModal(true);
  };

  // Abre el modal de gestión para un proveedor y carga su detalle real de
  // productos asociados (nombre, precio, días de entrega, cantidad mínima).
  const abrirGestionProductos = (proveedor) => {
    setProveedorSeleccionado(proveedor);
    setShowProductosModal(true);
    setBusquedaProductoNuevo('');
    setSeleccionados({});
    cargarProductosAsociados(proveedor.id);
  };

  const cargarProductosAsociados = async (proveedorId) => {
    try {
      setCargandoAsociados(true);
      const response = await api.get(`/proveedores/${proveedorId}/productos-asociados`);
      setProductosAsociados(response.data);
      // Reinicia el estado de edición inline con los valores actuales,
      // para que "Guardar cambios" solo detecte lo que el usuario toque.
      const ediciones = {};
      response.data.forEach(p => {
        ediciones[p.id] = {
          precio_compra: p.precio_compra ?? '',
          tiempo_entrega_dias: p.tiempo_entrega_dias ?? '',
          cantidad_minima_pedido: p.cantidad_minima_pedido ?? '',
          unidades_por_paquete: p.unidades_por_paquete ?? ''
        };
      });
      setEdicionesAsociados(ediciones);
    } catch (error) {
      console.error('Error cargando productos asociados:', error);
      alert('Error al cargar los productos asociados');
    } finally {
      setCargandoAsociados(false);
    }
  };

  const handleCambioEdicionAsociado = (productoId, campo, valor) => {
    setEdicionesAsociados(prev => ({
      ...prev,
      [productoId]: { ...prev[productoId], [campo]: valor }
    }));
  };

  // Solo llama al POST individual por las filas que realmente cambiaron
  // respecto a lo que llegó del servidor.
  const handleGuardarCambiosAsociados = async () => {
    const cambiados = productosAsociados.filter(p => {
      const edicion = edicionesAsociados[p.id];
      if (!edicion) return false;
      return (
        String(edicion.precio_compra) !== String(p.precio_compra ?? '') ||
        String(edicion.tiempo_entrega_dias) !== String(p.tiempo_entrega_dias ?? '') ||
        String(edicion.cantidad_minima_pedido) !== String(p.cantidad_minima_pedido ?? '') ||
        String(edicion.unidades_por_paquete) !== String(p.unidades_por_paquete ?? '')
      );
    });

    if (cambiados.length === 0) {
      alert('No hay cambios para guardar');
      return;
    }

    try {
      setGuardandoEdiciones(true);
      await Promise.all(cambiados.map(p => {
        const edicion = edicionesAsociados[p.id];
        return api.post(`/productos/${p.id}/proveedores/${proveedorSeleccionado.id}`, {
          precio_compra: parseFloat(edicion.precio_compra) || 0,
          tiempo_entrega_dias: parseInt(edicion.tiempo_entrega_dias, 10) || 3,
          cantidad_minima_pedido: parseInt(edicion.cantidad_minima_pedido, 10) || 1,
          unidades_por_paquete: parseInt(edicion.unidades_por_paquete, 10) || 1
        });
      }));

      alert(`${cambiados.length} producto(s) actualizado(s) correctamente`);
      await cargarProductosAsociados(proveedorSeleccionado.id);
    } catch (error) {
      console.error('Error guardando cambios:', error);
      alert(error.response?.data?.error || 'Error al guardar los cambios');
    } finally {
      setGuardandoEdiciones(false);
    }
  };

  const handleQuitarProducto = async (productoId) => {
    if (!confirm('¿Quitar este producto de este proveedor?')) return;

    try {
      await api.delete(`/productos/${productoId}/proveedores/${proveedorSeleccionado.id}`);
      setProductosAsociados(prev => prev.filter(p => p.id !== productoId));
      setEdicionesAsociados(prev => {
        const resto = { ...prev };
        delete resto[productoId];
        return resto;
      });
      cargarProveedores();
    } catch (error) {
      console.error('Error quitando producto:', error);
      alert(error.response?.data?.error || 'Error al quitar el producto');
    }
  };

  // Marca/desmarca un producto en la sección de "asignar nuevos". Al marcar,
  // precarga los 3 valores editables con los defaults del backend.
  const handleToggleSeleccion = (producto) => {
    setSeleccionados(prev => {
      const copia = { ...prev };
      if (copia[producto.id]) {
        delete copia[producto.id];
      } else {
        copia[producto.id] = {
          precio_compra: producto.precio_compra ?? '',
          tiempo_entrega_dias: proveedorSeleccionado?.dias_entrega || 3,
          cantidad_minima_pedido: 1,
          unidades_por_paquete: 1
        };
      }
      return copia;
    });
  };

  const handleCambioSeleccion = (productoId, campo, valor) => {
    setSeleccionados(prev => ({
      ...prev,
      [productoId]: { ...prev[productoId], [campo]: valor }
    }));
  };

  const handleAsignarSeleccionados = async () => {
    const idsSeleccionados = Object.keys(seleccionados);
    if (idsSeleccionados.length === 0) {
      alert('Selecciona al menos un producto');
      return;
    }

    try {
      setAsignandoSeleccionados(true);
      const productosBody = idsSeleccionados.map(id => ({
        producto_id: id,
        precio_compra: parseFloat(seleccionados[id].precio_compra) || 0,
        tiempo_entrega_dias: parseInt(seleccionados[id].tiempo_entrega_dias, 10) || 3,
        cantidad_minima_pedido: parseInt(seleccionados[id].cantidad_minima_pedido, 10) || 1,
        unidades_por_paquete: parseInt(seleccionados[id].unidades_por_paquete, 10) || 1
      }));

      await api.post(`/proveedores/${proveedorSeleccionado.id}/productos-bulk`, {
        productos: productosBody
      });

      alert(`${idsSeleccionados.length} producto(s) asignado(s) correctamente`);
      setSeleccionados({});
      setBusquedaProductoNuevo('');
      await cargarProductosAsociados(proveedorSeleccionado.id);
      cargarProveedores();
    } catch (error) {
      console.error('Error asignando productos:', error);
      alert(error.response?.data?.error || 'Error al asignar los productos seleccionados');
    } finally {
      setAsignandoSeleccionados(false);
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
          onClick={() => { setEditProveedor(null); setFormData({ nombre: '', contacto: '', telefono: '', email: '', direccion: '', dias_entrega: '' }); setShowModal(true); }} 
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
              <button onClick={() => { setEditProveedor(null); setFormData({ nombre: '', contacto: '', telefono: '', email: '', direccion: '', dias_entrega: '' }); setShowModal(true); }} className="btn-agregar-primero">
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
                  {proveedor.dias_entrega && (
                    <div className="proveedor-info-item">
                      <span className="info-icon">🚚</span>
                      <span className="info-value">Trae pedido cada {proveedor.dias_entrega} días</span>
                    </div>
                  )}
                </div>

                <div className="proveedor-card-footer">
                  <button
                    onClick={() => abrirGestionProductos(proveedor)}
                    className="btn-asociar"
                  >
                    📦 Ver/editar productos ({proveedor.productos_asociados?.filter(Boolean).length || 0})
                  </button>
                </div>
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

              <div className="form-group">
                <label>Tiempo de entrega</label>
                <input
                  type="number"
                  min="1"
                  placeholder="Cada cuántos días trae pedido (opcional)"
                  value={formData.dias_entrega}
                  onChange={(e) => setFormData({ ...formData, dias_entrega: e.target.value })}
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

      {/* Modal de gestión de productos asociados */}
      {showProductosModal && proveedorSeleccionado && (
        <div className="modal" onClick={() => setShowProductosModal(false)}>
          <div className="modal-content modal-gestion-productos" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📦 Productos de {proveedorSeleccionado.nombre}</h3>
              <button onClick={() => setShowProductosModal(false)}>✕</button>
            </div>

            {/* Sección A: productos ya asociados, con edición inline */}
            <div className="gestion-seccion">
              <h4>Productos asociados</h4>
              {cargandoAsociados ? (
                <div className="loading">Cargando...</div>
              ) : productosAsociados.length === 0 ? (
                <p className="sin-datos-mini">Este proveedor no tiene productos asociados todavía</p>
              ) : (
                <>
                  <div className="tabla-asociados-wrapper">
                    <table className="tabla-asociados">
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th>Precio compra</th>
                          <th>Días entrega</th>
                          <th>Cant. mínima</th>
                          <th>Unid. por paquete</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {productosAsociados.map(p => (
                          <tr key={p.id}>
                            <td>{p.nombre}</td>
                            <td>
                              <input
                                type="number"
                                step="0.01"
                                value={edicionesAsociados[p.id]?.precio_compra ?? ''}
                                onChange={(e) => handleCambioEdicionAsociado(p.id, 'precio_compra', e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="1"
                                value={edicionesAsociados[p.id]?.tiempo_entrega_dias ?? ''}
                                onChange={(e) => handleCambioEdicionAsociado(p.id, 'tiempo_entrega_dias', e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="1"
                                value={edicionesAsociados[p.id]?.cantidad_minima_pedido ?? ''}
                                onChange={(e) => handleCambioEdicionAsociado(p.id, 'cantidad_minima_pedido', e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="1"
                                value={edicionesAsociados[p.id]?.unidades_por_paquete ?? ''}
                                onChange={(e) => handleCambioEdicionAsociado(p.id, 'unidades_por_paquete', e.target.value)}
                              />
                            </td>
                            <td>
                              <button
                                onClick={() => handleQuitarProducto(p.id)}
                                className="btn-quitar-producto"
                                title="Quitar del proveedor"
                              >
                                🗑️
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button
                    onClick={handleGuardarCambiosAsociados}
                    className="btn-guardar-cambios"
                    disabled={guardandoEdiciones}
                  >
                    {guardandoEdiciones ? 'Guardando...' : '💾 Guardar cambios'}
                  </button>
                </>
              )}
            </div>

            {/* Sección B: asignar productos nuevos, multi-selección */}
            <div className="gestion-seccion">
              <h4>Asignar productos nuevos</h4>
              <input
                type="text"
                className="input-busqueda-productos"
                placeholder="🔍 Buscar producto por nombre..."
                value={busquedaProductoNuevo}
                onChange={(e) => setBusquedaProductoNuevo(e.target.value)}
              />

              <div className="lista-productos-disponibles">
                {productos
                  .filter(p => !productosAsociados.some(pa => pa.id === p.id))
                  .filter(p => p.nombre.toLowerCase().includes(busquedaProductoNuevo.toLowerCase()))
                  .map(producto => {
                    const marcado = !!seleccionados[producto.id];
                    return (
                      <div key={producto.id} className={`producto-disponible-item ${marcado ? 'marcado' : ''}`}>
                        <label className="producto-disponible-check">
                          <input
                            type="checkbox"
                            checked={marcado}
                            onChange={() => handleToggleSeleccion(producto)}
                          />
                          <span>{producto.nombre} <small>Stock: {producto.stock_actual}</small></span>
                        </label>
                        {marcado && (
                          <div className="producto-disponible-detalle">
                            <div className="form-group">
                              <label>Precio compra</label>
                              <input
                                type="number"
                                step="0.01"
                                value={seleccionados[producto.id].precio_compra}
                                onChange={(e) => handleCambioSeleccion(producto.id, 'precio_compra', e.target.value)}
                              />
                            </div>
                            <div className="form-group">
                              <label>Días entrega</label>
                              <input
                                type="number"
                                min="1"
                                value={seleccionados[producto.id].tiempo_entrega_dias}
                                onChange={(e) => handleCambioSeleccion(producto.id, 'tiempo_entrega_dias', e.target.value)}
                              />
                            </div>
                            <div className="form-group">
                              <label>Cant. mínima</label>
                              <input
                                type="number"
                                min="1"
                                value={seleccionados[producto.id].cantidad_minima_pedido}
                                onChange={(e) => handleCambioSeleccion(producto.id, 'cantidad_minima_pedido', e.target.value)}
                              />
                            </div>
                            <div className="form-group">
                              <label>Unid. por paquete</label>
                              <input
                                type="number"
                                min="1"
                                value={seleccionados[producto.id].unidades_por_paquete}
                                onChange={(e) => handleCambioSeleccion(producto.id, 'unidades_por_paquete', e.target.value)}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                {productos.filter(p => !productosAsociados.some(pa => pa.id === p.id)).length === 0 && (
                  <p className="sin-datos-mini">No hay más productos disponibles para asociar</p>
                )}
              </div>

              <div className="form-actions">
                <button
                  onClick={handleAsignarSeleccionados}
                  className="btn-guardar"
                  disabled={asignandoSeleccionados || Object.keys(seleccionados).length === 0}
                >
                  {asignandoSeleccionados
                    ? 'Asignando...'
                    : `✅ Asignar seleccionados (${Object.keys(seleccionados).length})`}
                </button>
                <button type="button" onClick={() => setShowProductosModal(false)} className="btn-cancelar">
                  Cerrar
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