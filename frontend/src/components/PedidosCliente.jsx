import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import './PedidosCliente.css';

const ESTADO_INFO = {
  pendiente: { color: '#feebc8', textColor: '#9c4221', label: '⏳ Pendiente' },
  confirmado: { color: '#bee3f8', textColor: '#2c5282', label: '👀 Confirmado' },
  completado: { color: '#c6f6d5', textColor: '#22543d', label: '✅ Completado' },
  cancelado: { color: '#e2e8f0', textColor: '#4a5568', label: '❌ Cancelado' }
};

const formatearMoneda = (valor) => `$${Number(valor || 0).toLocaleString('es-CO')}`;

// Polling simple (no websockets) para que los pedidos nuevos del menú QR
// aparezcan sin que el usuario tenga que recargar la página a mano.
const INTERVALO_POLLING_MS = 30000;

const PedidosCliente = ({ user }) => {
  const { moduloActivo } = useModulo();
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [expandidoId, setExpandidoId] = useState(null);

  const [editandoId, setEditandoId] = useState(null);
  const [itemsEdit, setItemsEdit] = useState([]);
  const [mesaNombreEdit, setMesaNombreEdit] = useState('');
  const [productos, setProductos] = useState([]);
  const [productoAAgregar, setProductoAAgregar] = useState('');
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);

  const [accionEnCurso, setAccionEnCurso] = useState(null); // `${id}-${accion}`

  const [modalCompletar, setModalCompletar] = useState(null); // { pedidoId }
  const [metodoPagoCompletar, setMetodoPagoCompletar] = useState('efectivo');
  const [clientes, setClientes] = useState([]);
  const [clienteIdCompletar, setClienteIdCompletar] = useState('');
  const [completando, setCompletando] = useState(false);

  // Configuración del menú público (foto de portada del hero). Solo admin
  // puede verla/editarla, igual que la gestión de Productos/Categorías.
  const [fotoPortadaUrl, setFotoPortadaUrl] = useState('');
  const [guardandoPortada, setGuardandoPortada] = useState(false);
  const esAdmin = user?.rol === 'admin' || user?.rol === 'super_admin';

  const pollingRef = useRef(null);

  const cargarPedidos = useCallback(async ({ silencioso = false } = {}) => {
    if (!moduloActivo) return;
    try {
      if (!silencioso) setLoading(true);
      const response = await api.get('/pedidos-cliente');
      setPedidos(response.data);
    } catch (error) {
      console.error('Error cargando pedidos de cliente:', error);
      if (!silencioso) setMensaje('❌ Error al cargar los pedidos');
    } finally {
      if (!silencioso) setLoading(false);
    }
  }, [moduloActivo]);

  useEffect(() => {
    cargarPedidos();
  }, [cargarPedidos]);

  useEffect(() => {
    if (!moduloActivo || !esAdmin) return;
    api.get(`/modulos/${moduloActivo.id}`)
      .then(response => setFotoPortadaUrl(response.data.foto_portada_url || ''))
      .catch(error => console.error('Error cargando configuración del módulo:', error));
  }, [moduloActivo, esAdmin]);

  // Refresco automático cada 30s, sin mostrar el spinner de carga inicial
  // ni pisar una edición en curso (perdería lo que el usuario está tecleando).
  useEffect(() => {
    if (!moduloActivo) return;
    pollingRef.current = setInterval(() => {
      if (editandoId === null) {
        cargarPedidos({ silencioso: true });
      }
    }, INTERVALO_POLLING_MS);
    return () => clearInterval(pollingRef.current);
  }, [moduloActivo, editandoId, cargarPedidos]);

  const cargarProductos = async () => {
    try {
      const response = await api.get('/productos');
      setProductos(response.data);
    } catch (error) {
      console.error('Error cargando productos:', error);
    }
  };

  const cargarClientes = async () => {
    try {
      const response = await api.get('/clientes');
      setClientes(response.data);
    } catch (error) {
      console.error('Error cargando clientes:', error);
    }
  };

  const toggleExpandido = (id) => {
    if (editandoId !== null) return; // no colapsar el pedido que se está editando
    setExpandidoId(prev => (prev === id ? null : id));
  };

  const iniciarEdicion = (pedido) => {
    setEditandoId(pedido.id);
    setExpandidoId(pedido.id);
    setMesaNombreEdit(pedido.mesa_nombre);
    setItemsEdit(pedido.detalles.map(d => ({
      producto_id: d.producto_id,
      nombre_producto: d.nombre_producto,
      cantidad: d.cantidad,
      precio_unitario: Number(d.precio_unitario)
    })));
    if (productos.length === 0) cargarProductos();
  };

  const cancelarEdicion = () => {
    setEditandoId(null);
    setItemsEdit([]);
    setProductoAAgregar('');
  };

  const actualizarCantidadEdit = (productoId, cantidad) => {
    setItemsEdit(prev => prev.map(item =>
      item.producto_id === productoId ? { ...item, cantidad } : item
    ));
  };

  const eliminarItemEdit = (productoId) => {
    setItemsEdit(prev => prev.filter(item => item.producto_id !== productoId));
  };

  const agregarProductoEdit = (productoId) => {
    const producto = productos.find(p => p.id === parseInt(productoId));
    if (!producto || itemsEdit.find(i => i.producto_id === producto.id)) return;
    setItemsEdit(prev => [...prev, {
      producto_id: producto.id,
      nombre_producto: producto.nombre,
      cantidad: 1,
      precio_unitario: Number(producto.precio_venta)
    }]);
  };

  const totalEdit = () => itemsEdit.reduce((sum, i) => sum + (Number(i.cantidad) || 0) * i.precio_unitario, 0);

  const guardarEdicion = async (id) => {
    if (!mesaNombreEdit.trim()) {
      setMensaje('⚠️ Ingresa el nombre o número de mesa');
      return;
    }
    if (itemsEdit.length === 0) {
      setMensaje('⚠️ El pedido debe tener al menos un producto');
      return;
    }

    try {
      setGuardandoEdicion(true);
      await api.put(`/pedidos-cliente/${id}`, {
        mesa_nombre: mesaNombreEdit.trim(),
        items: itemsEdit.map(i => ({ producto_id: i.producto_id, cantidad: Number(i.cantidad) }))
      });
      setMensaje('✅ Pedido actualizado');
      setEditandoId(null);
      setItemsEdit([]);
      cargarPedidos();
    } catch (error) {
      console.error('Error guardando edición del pedido:', error);
      setMensaje(`❌ ${error.response?.data?.error || 'Error al guardar los cambios'}`);
    } finally {
      setGuardandoEdicion(false);
      setTimeout(() => setMensaje(''), 4000);
    }
  };

  const confirmarPedido = async (id) => {
    try {
      setAccionEnCurso(`${id}-confirmar`);
      await api.put(`/pedidos-cliente/${id}/confirmar`);
      setMensaje('✅ Pedido confirmado');
      cargarPedidos();
    } catch (error) {
      console.error('Error confirmando pedido:', error);
      setMensaje(`❌ ${error.response?.data?.error || 'Error al confirmar el pedido'}`);
    } finally {
      setAccionEnCurso(null);
      setTimeout(() => setMensaje(''), 4000);
    }
  };

  const cancelarPedido = async (id) => {
    if (!confirm('¿Cancelar este pedido? Esta acción no se puede deshacer.')) return;
    try {
      setAccionEnCurso(`${id}-cancelar`);
      await api.put(`/pedidos-cliente/${id}/cancelar`);
      setMensaje('✅ Pedido cancelado');
      cargarPedidos();
    } catch (error) {
      console.error('Error cancelando pedido:', error);
      setMensaje(`❌ ${error.response?.data?.error || 'Error al cancelar el pedido'}`);
    } finally {
      setAccionEnCurso(null);
      setTimeout(() => setMensaje(''), 4000);
    }
  };

  const abrirModalCompletar = (id) => {
    setModalCompletar({ pedidoId: id });
    setMetodoPagoCompletar('efectivo');
    setClienteIdCompletar('');
    if (clientes.length === 0) cargarClientes();
  };

  const confirmarCompletar = async () => {
    if (metodoPagoCompletar === 'credito' && !clienteIdCompletar) {
      setMensaje('⚠️ Selecciona un cliente para completar como crédito');
      return;
    }

    try {
      setCompletando(true);
      await api.put(`/pedidos-cliente/${modalCompletar.pedidoId}/completar`, {
        metodo_pago: metodoPagoCompletar,
        ...(clienteIdCompletar && { cliente_id: parseInt(clienteIdCompletar) })
      });
      setMensaje('✅ Pedido completado, venta registrada');
      setModalCompletar(null);
      cargarPedidos();
    } catch (error) {
      console.error('Error completando pedido:', error);
      setMensaje(`❌ ${error.response?.data?.error || 'Error al completar el pedido'}`);
    } finally {
      setCompletando(false);
      setTimeout(() => setMensaje(''), 4000);
    }
  };

  const guardarFotoPortada = async () => {
    try {
      setGuardandoPortada(true);
      await api.put(`/modulos/${moduloActivo.id}/portada`, { foto_portada_url: fotoPortadaUrl.trim() });
      setMensaje('✅ Foto de portada actualizada');
    } catch (error) {
      console.error('Error guardando foto de portada:', error);
      setMensaje(`❌ ${error.response?.data?.error || 'Error al guardar la foto de portada'}`);
    } finally {
      setGuardandoPortada(false);
      setTimeout(() => setMensaje(''), 4000);
    }
  };

  if (!moduloActivo) {
    return (
      <div className="pedidos-cliente-container">
        <div className="alert alert-warning">
          ⚠️ No hay módulo activo. Selecciona un módulo para gestionar pedidos de clientes.
        </div>
      </div>
    );
  }

  return (
    <div className="pedidos-cliente-container">
      <div className="pedidos-cliente-header">
        <div className="header-left">
          <h2>🧾 Pedidos de Clientes</h2>
          <div className="modulo-indicador">
            <span className="badge">📁 {moduloActivo.nombre}</span>
          </div>
        </div>
        <button onClick={() => cargarPedidos()} className="btn-refresh">🔄</button>
      </div>

      {esAdmin && (
        <div className="config-menu-card">
          <h3>⚙️ Configuración del menú</h3>
          <div className="config-menu-fila">
            <input
              type="text"
              value={fotoPortadaUrl}
              onChange={(e) => setFotoPortadaUrl(e.target.value)}
              placeholder="URL de la foto de portada"
              className="config-menu-input"
            />
            <button
              onClick={guardarFotoPortada}
              disabled={guardandoPortada}
              className="btn-guardar config-menu-btn-guardar"
            >
              {guardandoPortada ? 'Guardando...' : '💾 Guardar'}
            </button>
          </div>
        </div>
      )}

      {mensaje && (
        <div className={`mensaje-flotante ${mensaje.includes('✅') ? 'exito' : mensaje.includes('❌') || mensaje.includes('⚠️') ? 'error' : 'info'}`}>
          {mensaje}
          <button onClick={() => setMensaje('')} className="btn-cerrar-mensaje">✕</button>
        </div>
      )}

      {loading ? (
        <div className="loading">Cargando pedidos...</div>
      ) : pedidos.length === 0 ? (
        <div className="sin-datos">
          <p>No hay pedidos de clientes todavía. Aparecerán aquí cuando alguien pida desde el menú QR.</p>
        </div>
      ) : (
        <div className="pedidos-cliente-lista">
          {pedidos.map(pedido => {
            const estado = ESTADO_INFO[pedido.estado] || ESTADO_INFO.pendiente;
            const expandido = expandidoId === pedido.id;
            const editando = editandoId === pedido.id;
            const enAccion = accionEnCurso?.startsWith(`${pedido.id}-`);

            return (
              <div key={pedido.id} className="pedido-cliente-card">
                <div className="pedido-cliente-resumen" onClick={() => toggleExpandido(pedido.id)}>
                  <div className="pedido-cliente-resumen-principal">
                    <span className="pedido-cliente-mesa">{pedido.mesa_nombre}</span>
                    <span
                      className="estado-badge-pedidos-cliente"
                      style={{ background: estado.color, color: estado.textColor }}
                    >
                      {estado.label}
                    </span>
                  </div>
                  <div className="pedido-cliente-resumen-datos">
                    <span>{pedido.detalles?.length || 0} producto(s)</span>
                    <span>{formatearMoneda(pedido.total)}</span>
                    <span>{new Date(pedido.fecha_creacion).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>

                {expandido && (
                  <div className="pedido-cliente-detalle">
                    {editando ? (
                      <div className="pedido-cliente-edicion">
                        <div className="form-group">
                          <label>Mesa/Nombre</label>
                          <input
                            type="text"
                            value={mesaNombreEdit}
                            onChange={(e) => setMesaNombreEdit(e.target.value)}
                          />
                        </div>

                        <table className="tabla-pedido-cliente-edicion">
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
                            {itemsEdit.map(item => (
                              <tr key={item.producto_id}>
                                <td>{item.nombre_producto}</td>
                                <td>
                                  <input
                                    type="number"
                                    min="1"
                                    value={item.cantidad}
                                    onChange={(e) => actualizarCantidadEdit(item.producto_id, e.target.value)}
                                    className="input-cantidad"
                                  />
                                </td>
                                <td>{formatearMoneda(item.precio_unitario)}</td>
                                <td>{formatearMoneda((Number(item.cantidad) || 0) * item.precio_unitario)}</td>
                                <td>
                                  <button onClick={() => eliminarItemEdit(item.producto_id)} className="btn-eliminar-detalle">✕</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr>
                              <td colSpan="3"><strong>Total</strong></td>
                              <td colSpan="2"><strong>{formatearMoneda(totalEdit())}</strong></td>
                            </tr>
                          </tfoot>
                        </table>

                        <div className="pedido-cliente-agregar-producto">
                          <select
                            value={productoAAgregar}
                            onChange={(e) => {
                              agregarProductoEdit(e.target.value);
                              setProductoAAgregar('');
                            }}
                          >
                            <option value="">+ Agregar producto...</option>
                            {productos
                              .filter(p => !itemsEdit.find(i => i.producto_id === p.id))
                              .map(p => (
                                <option key={p.id} value={p.id}>{p.nombre} - Stock: {p.stock_actual}</option>
                              ))}
                          </select>
                        </div>

                        <div className="pedido-cliente-edicion-botones">
                          <button
                            onClick={() => guardarEdicion(pedido.id)}
                            className="btn-guardar"
                            disabled={guardandoEdicion}
                          >
                            {guardandoEdicion ? 'Guardando...' : '💾 Guardar cambios'}
                          </button>
                          <button onClick={cancelarEdicion} className="btn-cancelar" disabled={guardandoEdicion}>
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <table className="tabla-pedido-cliente-detalle">
                          <thead>
                            <tr>
                              <th>Producto</th>
                              <th>Cantidad</th>
                              <th>Precio</th>
                              <th>Subtotal</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pedido.detalles?.map(detalle => (
                              <tr key={detalle.id}>
                                <td>{detalle.nombre_producto}</td>
                                <td>{detalle.cantidad}</td>
                                <td>{formatearMoneda(detalle.precio_unitario)}</td>
                                <td>{formatearMoneda(detalle.subtotal)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr>
                              <td colSpan="3"><strong>Total</strong></td>
                              <td><strong>{formatearMoneda(pedido.total)}</strong></td>
                            </tr>
                          </tfoot>
                        </table>
                        {pedido.monto_recibido && (
                          <p className="pedido-cliente-monto-recibido">💵 El cliente indicó que paga con: {formatearMoneda(pedido.monto_recibido)}</p>
                        )}

                        {(pedido.estado === 'pendiente' || pedido.estado === 'confirmado') && (
                          <div className="pedido-cliente-acciones">
                            {pedido.estado === 'pendiente' && (
                              <button
                                onClick={() => confirmarPedido(pedido.id)}
                                disabled={enAccion}
                                className="btn-confirmar-pedido-cliente"
                              >
                                {accionEnCurso === `${pedido.id}-confirmar` ? 'Confirmando...' : '👀 Confirmar'}
                              </button>
                            )}
                            <button
                              onClick={() => iniciarEdicion(pedido)}
                              disabled={enAccion}
                              className="btn-editar-pedido-cliente"
                            >
                              ✏️ Editar
                            </button>
                            {pedido.estado === 'confirmado' && (
                              <button
                                onClick={() => abrirModalCompletar(pedido.id)}
                                disabled={enAccion}
                                className="btn-completar-pedido-cliente"
                              >
                                ✅ Completar
                              </button>
                            )}
                            <button
                              onClick={() => cancelarPedido(pedido.id)}
                              disabled={enAccion}
                              className="btn-cancelar-pedido-cliente-panel"
                            >
                              {accionEnCurso === `${pedido.id}-cancelar` ? 'Cancelando...' : '❌ Cancelar'}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modalCompletar && (
        <div className="modal" onClick={() => !completando && setModalCompletar(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>✅ Completar pedido</h3>
              <button onClick={() => setModalCompletar(null)} disabled={completando}>✕</button>
            </div>

            <div className="pedido-cliente-modal-completar">
              <div className="form-group">
                <label>💳 Método de pago</label>
                <select
                  value={metodoPagoCompletar}
                  onChange={(e) => setMetodoPagoCompletar(e.target.value)}
                >
                  <option value="efectivo">💵 Efectivo</option>
                  <option value="tarjeta">💳 Tarjeta</option>
                  <option value="transferencia">🏦 Transferencia</option>
                  <option value="credito">📒 Crédito</option>
                </select>
              </div>

              {metodoPagoCompletar === 'credito' && (
                <div className="form-group">
                  <label>Cliente</label>
                  <select
                    value={clienteIdCompletar}
                    onChange={(e) => setClienteIdCompletar(e.target.value)}
                  >
                    <option value="">Seleccionar cliente...</option>
                    {clientes.map(c => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button onClick={confirmarCompletar} className="btn-guardar" disabled={completando}>
                {completando ? 'Completando...' : '✅ Completar y registrar venta'}
              </button>
              <button onClick={() => setModalCompletar(null)} className="btn-cancelar" disabled={completando}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PedidosCliente;
