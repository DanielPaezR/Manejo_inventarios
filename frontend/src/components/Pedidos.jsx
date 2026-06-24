import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import './Pedidos.css';

const Pedidos = ({ user }) => {
  const { moduloActivo } = useModulo();
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [showDetalleModal, setShowDetalleModal] = useState(false);
  const [pedidoSeleccionado, setPedidoSeleccionado] = useState(null);
  const [showCrearModal, setShowCrearModal] = useState(false);
  const [proveedores, setProveedores] = useState([]);
  const [productos, setProductos] = useState([]);
  const [nuevoPedido, setNuevoPedido] = useState({
    proveedor_id: '',
    detalles: [],
    observaciones: ''
  });

  // Verificar permisos
  const puedeGestionar = user?.rol === 'admin' || user?.rol === 'super_admin';

  useEffect(() => {
    if (moduloActivo && puedeGestionar) {
      cargarPedidos();
      cargarProveedores();
      cargarProductos();
    }
  }, [moduloActivo, filtroEstado]);

  const cargarPedidos = async () => {
    try {
      setLoading(true);
      const params = filtroEstado !== 'todos' ? { estado: filtroEstado } : {};
      const response = await api.get('/pedidos', { params });
      setPedidos(response.data);
    } catch (error) {
      console.error('Error cargando pedidos:', error);
      alert('Error al cargar pedidos');
    } finally {
      setLoading(false);
    }
  };

  const cargarProveedores = async () => {
    try {
      const response = await api.get('/proveedores');
      setProveedores(response.data);
    } catch (error) {
      console.error('Error cargando proveedores:', error);
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

  const verDetalle = async (id) => {
    try {
      setLoading(true);
      const response = await api.get(`/pedidos/${id}`);
      setPedidoSeleccionado(response.data);
      setShowDetalleModal(true);
    } catch (error) {
      console.error('Error cargando detalle del pedido:', error);
      alert('Error al cargar el detalle del pedido');
    } finally {
      setLoading(false);
    }
  };

  const cambiarEstado = async (id, nuevoEstado) => {
    if (!confirm(`¿Cambiar estado del pedido a "${nuevoEstado}"?`)) return;
    
    try {
      await api.put(`/pedidos/${id}/estado`, { estado: nuevoEstado });
      alert('Estado actualizado correctamente');
      cargarPedidos();
      if (showDetalleModal) {
        setShowDetalleModal(false);
      }
    } catch (error) {
      console.error('Error cambiando estado:', error);
      alert(error.response?.data?.error || 'Error al cambiar estado');
    }
  };

  const handleCrearPedido = async () => {
    if (!nuevoPedido.proveedor_id || nuevoPedido.detalles.length === 0) {
      alert('Selecciona un proveedor y al menos un producto');
      return;
    }

    try {
      setLoading(true);
      await api.post('/pedidos', nuevoPedido);
      alert('Pedido creado correctamente');
      setShowCrearModal(false);
      setNuevoPedido({
        proveedor_id: '',
        detalles: [],
        observaciones: ''
      });
      cargarPedidos();
    } catch (error) {
      console.error('Error creando pedido:', error);
      alert(error.response?.data?.error || 'Error al crear pedido');
    } finally {
      setLoading(false);
    }
  };

  const agregarDetalle = (productoId, cantidad) => {
    const producto = productos.find(p => p.id === parseInt(productoId));
    if (!producto) return;

    // Verificar si ya existe en el carrito
    const existente = nuevoPedido.detalles.find(d => d.producto_id === producto.id);
    if (existente) {
      setNuevoPedido({
        ...nuevoPedido,
        detalles: nuevoPedido.detalles.map(d =>
          d.producto_id === producto.id
            ? { ...d, cantidad: d.cantidad + parseInt(cantidad) }
            : d
        )
      });
    } else {
      setNuevoPedido({
        ...nuevoPedido,
        detalles: [
          ...nuevoPedido.detalles,
          {
            producto_id: producto.id,
            cantidad: parseInt(cantidad) || 1,
            producto_nombre: producto.nombre,
            precio_unitario: producto.precio_compra || 0
          }
        ]
      });
    }
  };

  const eliminarDetalle = (productoId) => {
    setNuevoPedido({
      ...nuevoPedido,
      detalles: nuevoPedido.detalles.filter(d => d.producto_id !== productoId)
    });
  };

  const getEstadoBadge = (estado) => {
    const estados = {
      pendiente: { color: '#ed8936', label: '⏳ Pendiente' },
      enviado: { color: '#4299e1', label: '📤 Enviado' },
      recibido: { color: '#48bb78', label: '✅ Recibido' },
      cancelado: { color: '#fc8181', label: '❌ Cancelado' }
    };
    return estados[estado] || estados.pendiente;
  };

  const totalPedido = (detalles) => {
    return detalles.reduce((sum, d) => sum + (d.cantidad * d.precio_unitario), 0);
  };

  if (!puedeGestionar) {
    return (
      <div className="pedidos-container">
        <div className="alert alert-warning">
          ⚠️ No tienes permisos para gestionar pedidos. Solo administradores pueden acceder a esta sección.
        </div>
      </div>
    );
  }

  if (!moduloActivo) {
    return (
      <div className="pedidos-container">
        <div className="alert alert-warning">
          ⚠️ No hay módulo activo. Selecciona un módulo para gestionar pedidos.
        </div>
      </div>
    );
  }

  return (
    <div className="pedidos-container">
      <div className="pedidos-header">
        <div className="header-left">
          <h2>📦 Gestión de Pedidos</h2>
          <div className="modulo-indicador">
            <span className="badge">📁 {moduloActivo.nombre}</span>
          </div>
        </div>
        <button 
          onClick={() => setShowCrearModal(true)} 
          className="btn-agregar"
        >
          + Nuevo Pedido
        </button>
      </div>

      <div className="filtros-pedidos">
        <div className="filtros-group">
          <button 
            className={`btn-filtro ${filtroEstado === 'todos' ? 'active' : ''}`}
            onClick={() => setFiltroEstado('todos')}
          >
            Todos
          </button>
          <button 
            className={`btn-filtro ${filtroEstado === 'pendiente' ? 'active' : ''}`}
            onClick={() => setFiltroEstado('pendiente')}
          >
            ⏳ Pendientes
          </button>
          <button 
            className={`btn-filtro ${filtroEstado === 'enviado' ? 'active' : ''}`}
            onClick={() => setFiltroEstado('enviado')}
          >
            📤 Enviados
          </button>
          <button 
            className={`btn-filtro ${filtroEstado === 'recibido' ? 'active' : ''}`}
            onClick={() => setFiltroEstado('recibido')}
          >
            ✅ Recibidos
          </button>
          <button 
            className={`btn-filtro ${filtroEstado === 'cancelado' ? 'active' : ''}`}
            onClick={() => setFiltroEstado('cancelado')}
          >
            ❌ Cancelados
          </button>
        </div>
        <button onClick={cargarPedidos} className="btn-refresh">
          🔄
        </button>
      </div>

      {loading ? (
        <div className="loading">Cargando pedidos...</div>
      ) : (
        <div className="pedidos-table">
          {pedidos.length === 0 ? (
            <div className="sin-datos">
              <p>No hay pedidos registrados</p>
              <button onClick={() => setShowCrearModal(true)} className="btn-agregar-primero">
                + Crear primer pedido
              </button>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Proveedor</th>
                  <th>Fecha</th>
                  <th>Productos</th>
                  <th>Total</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map(pedido => {
                  const estado = getEstadoBadge(pedido.estado);
                  return (
                    <tr key={pedido.id}>
                      <td>#{pedido.id}</td>
                      <td>{pedido.proveedor_nombre}</td>
                      <td>{new Date(pedido.fecha_pedido).toLocaleDateString()}</td>
                      <td>{pedido.detalles?.length || 0} productos</td>
                      <td>${Number(pedido.total || 0).toLocaleString()}</td>
                      <td>
                        <span className="estado-badge" style={{ background: estado.color }}>
                          {estado.label}
                        </span>
                      </td>
                      <td>
                        <button 
                          onClick={() => verDetalle(pedido.id)} 
                          className="btn-ver"
                          title="Ver detalle"
                        >
                          👁️
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Modal de detalle */}
      {showDetalleModal && pedidoSeleccionado && (
        <div className="modal" onClick={() => setShowDetalleModal(false)}>
          <div className="modal-content modal-grande" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🧾 Detalle del Pedido #{pedidoSeleccionado.id}</h3>
              <button onClick={() => setShowDetalleModal(false)}>✕</button>
            </div>
            
            <div className="pedido-detalle">
              <div className="detalle-header">
                <div className="detalle-info">
                  <p><strong>Proveedor:</strong> {pedidoSeleccionado.proveedor_nombre}</p>
                  <p><strong>Fecha:</strong> {new Date(pedidoSeleccionado.fecha_pedido).toLocaleString()}</p>
                  <p><strong>Estado:</strong> {getEstadoBadge(pedidoSeleccionado.estado).label}</p>
                  {pedidoSeleccionado.fecha_entrega_estimada && (
                    <p><strong>Entrega estimada:</strong> {new Date(pedidoSeleccionado.fecha_entrega_estimada).toLocaleDateString()}</p>
                  )}
                  {pedidoSeleccionado.observaciones && (
                    <p><strong>Observaciones:</strong> {pedidoSeleccionado.observaciones}</p>
                  )}
                </div>
                <div className="detalle-actions">
                  {pedidoSeleccionado.estado === 'pendiente' && (
                    <>
                      <button onClick={() => cambiarEstado(pedidoSeleccionado.id, 'enviado')} className="btn-enviar">
                        📤 Marcar como Enviado
                      </button>
                      <button onClick={() => cambiarEstado(pedidoSeleccionado.id, 'cancelado')} className="btn-cancelar-pedido">
                        ❌ Cancelar
                      </button>
                    </>
                  )}
                  {pedidoSeleccionado.estado === 'enviado' && (
                    <button onClick={() => cambiarEstado(pedidoSeleccionado.id, 'recibido')} className="btn-recibir">
                      ✅ Marcar como Recibido
                    </button>
                  )}
                </div>
              </div>

              <div className="detalle-productos">
                <h4>📦 Productos</h4>
                <table>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Cantidad</th>
                      <th>Precio</th>
                      <th>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pedidoSeleccionado.detalles?.map((detalle, index) => (
                      <tr key={index}>
                        <td>{detalle.producto_nombre}</td>
                        <td>{detalle.cantidad}</td>
                        <td>${Number(detalle.precio_unitario).toLocaleString()}</td>
                        <td>${Number(detalle.subtotal).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan="3"><strong>Total</strong></td>
                      <td><strong>${Number(pedidoSeleccionado.total || 0).toLocaleString()}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={() => setShowDetalleModal(false)} className="btn-cerrar">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de creación */}
      {showCrearModal && (
        <div className="modal" onClick={() => setShowCrearModal(false)}>
          <div className="modal-content modal-grande" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📦 Nuevo Pedido</h3>
              <button onClick={() => setShowCrearModal(false)}>✕</button>
            </div>
            
            <div className="crear-pedido">
              <div className="crear-pedido-form">
                <div className="form-group">
                  <label>Proveedor *</label>
                  <select
                    value={nuevoPedido.proveedor_id}
                    onChange={(e) => setNuevoPedido({ ...nuevoPedido, proveedor_id: e.target.value })}
                  >
                    <option value="">Seleccionar proveedor...</option>
                    {proveedores.map(prov => (
                      <option key={prov.id} value={prov.id}>
                        {prov.nombre} {prov.telefono && `- 📞 ${prov.telefono}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Observaciones</label>
                  <textarea
                    value={nuevoPedido.observaciones}
                    onChange={(e) => setNuevoPedido({ ...nuevoPedido, observaciones: e.target.value })}
                    placeholder="Observaciones del pedido..."
                    rows="2"
                  />
                </div>

                <div className="agregar-producto-pedido">
                  <h4>Agregar producto</h4>
                  <div className="agregar-producto-row">
                    <select
                      onChange={(e) => {
                        const productoId = e.target.value;
                        if (productoId) {
                          const producto = productos.find(p => p.id === parseInt(productoId));
                          if (producto && !nuevoPedido.detalles.find(d => d.producto_id === producto.id)) {
                            agregarDetalle(productoId, 1);
                            e.target.value = '';
                          }
                        }
                      }}
                    >
                      <option value="">Seleccionar producto...</option>
                      {productos
                        .filter(p => !nuevoPedido.detalles.find(d => d.producto_id === p.id))
                        .map(producto => (
                          <option key={producto.id} value={producto.id}>
                            {producto.nombre} - Stock: {producto.stock_actual}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div className="pedido-detalles-lista">
                  <h4>Productos del pedido</h4>
                  {nuevoPedido.detalles.length === 0 ? (
                    <p className="sin-productos-pedido">No hay productos agregados</p>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th>Cantidad</th>
                          <th>Precio</th>
                          <th>Subtotal</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {nuevoPedido.detalles.map((detalle, index) => (
                          <tr key={index}>
                            <td>{detalle.producto_nombre}</td>
                            <td>
                              <input
                                type="number"
                                value={detalle.cantidad}
                                onChange={(e) => {
                                  const nuevaCantidad = parseInt(e.target.value) || 1;
                                  setNuevoPedido({
                                    ...nuevoPedido,
                                    detalles: nuevoPedido.detalles.map(d =>
                                      d.producto_id === detalle.producto_id
                                        ? { ...d, cantidad: nuevaCantidad }
                                        : d
                                    )
                                  });
                                }}
                                min="1"
                                className="input-cantidad"
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                step="0.01"
                                value={detalle.precio_unitario}
                                onChange={(e) => {
                                  const nuevoPrecio = parseFloat(e.target.value) || 0;
                                  setNuevoPedido({
                                    ...nuevoPedido,
                                    detalles: nuevoPedido.detalles.map(d =>
                                      d.producto_id === detalle.producto_id
                                        ? { ...d, precio_unitario: nuevoPrecio }
                                        : d
                                    )
                                  });
                                }}
                                className="input-precio"
                              />
                            </td>
                            <td>${(detalle.cantidad * detalle.precio_unitario).toLocaleString()}</td>
                            <td>
                              <button onClick={() => eliminarDetalle(detalle.producto_id)} className="btn-eliminar-detalle">
                                ✕
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan="3"><strong>Total</strong></td>
                          <td><strong>${totalPedido(nuevoPedido.detalles).toLocaleString()}</strong></td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={handleCrearPedido} className="btn-guardar" disabled={loading || nuevoPedido.detalles.length === 0}>
                {loading ? 'Creando...' : '✅ Crear Pedido'}
              </button>
              <button onClick={() => setShowCrearModal(false)} className="btn-cancelar">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Pedidos;