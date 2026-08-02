import React, { useState, useEffect, useRef } from 'react';
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
  // Revisar pedido por proveedor / sugerencia de pedido (antes en la
  // página eliminada "Gestión de Inventario"). Reutiliza proveedores/
  // cargarProveedores de arriba en vez de duplicar la carga.
  const [mensaje, setMensaje] = useState('');
  const [proveedorSugerenciaId, setProveedorSugerenciaId] = useState('');
  const [diasHistorial, setDiasHistorial] = useState(30);
  const [sugerenciaPedido, setSugerenciaPedido] = useState([]);
  const [sugerenciaConsultada, setSugerenciaConsultada] = useState(false);
  const [cargandoSugerencia, setCargandoSugerencia] = useState(false);
  const sugerenciaPedidoRef = useRef(null);

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

  // Enviar pedido múltiple (varios productos al mismo proveedor) por WhatsApp
  const enviarPedidoMultipleWhatsApp = (productosDelProveedor, proveedor) => {
    const telefono = proveedor.telefono?.replace(/\D/g, '');
    if (!telefono) {
      setMensaje(`❌ El proveedor "${proveedor.nombre}" no tiene número de teléfono registrado`);
      return;
    }

    let mensajeTexto = `📦 *PEDIDO DE REPOSICIÓN MÚLTIPLE*\n\n`;
    mensajeTexto += `📅 *Fecha:* ${new Date().toLocaleDateString()}\n`;
    mensajeTexto += `🏪 *Módulo:* ${moduloActivo.nombre}\n\n`;
    mensajeTexto += `*Lista de productos:*\n`;
    mensajeTexto += `-------------------\n`;

    productosDelProveedor.forEach((item, index) => {
      mensajeTexto += `${index + 1}. *${item.producto.nombre}*\n`;
      mensajeTexto += `   Cantidad: ${item.cantidadSugerida} unidades\n\n`;
    });

    mensajeTexto += `-------------------\n`;
    mensajeTexto += `Por favor, confirmar disponibilidad y fecha de entrega. 🙏`;

    const url = `https://wa.me/${telefono}?text=${encodeURIComponent(mensajeTexto)}`;
    window.open(url, '_blank');

    setMensaje(`📤 Enviando pedido múltiple a ${proveedor.nombre}...`);
    setTimeout(() => setMensaje(''), 3000);
  };

  // Sugerencia de pedido para un proveedor específico, basada en ventas
  // históricas y tiempo de entrega. Recibe el id explícito en vez de leerlo de
  // proveedorSugerenciaId porque setProveedorSugerenciaId es asíncrono: si
  // se llama justo después de seleccionarlo (ej. desde "Revisar pedido"),
  // el estado todavía no se actualizó y se consultaría el proveedor viejo.
  const calcularSugerenciaParaProveedor = async (idProveedor) => {
    if (!idProveedor) {
      setMensaje('⚠️ Selecciona un proveedor');
      return;
    }

    try {
      setCargandoSugerencia(true);
      const response = await api.get(`/proveedores/${idProveedor}/sugerencia-pedido`, {
        params: { dias_historial: diasHistorial || 30 }
      });
      setSugerenciaPedido(
        response.data.map(item => ({
          ...item,
          cantidadEditada: item.cantidadSugerida,
          incluido: item.cantidadSugerida > 0
        }))
      );
      setSugerenciaConsultada(true);
    } catch (error) {
      console.error('Error calculando sugerencia de pedido:', error);
      setMensaje('❌ Error al calcular la sugerencia de pedido');
    } finally {
      setCargandoSugerencia(false);
    }
  };

  // Usada directamente por el botón "🧮 Calcular sugerencia" (sí lee el
  // estado, porque ahí el usuario ya seleccionó el proveedor desde el
  // select y el estado ya está al día para cuando hace click).
  const calcularSugerenciaPedido = () => calcularSugerenciaParaProveedor(proveedorSugerenciaId);

  // Atajo para "🧾 Revisar pedido": selecciona el proveedor, calcula su
  // sugerencia y lleva al usuario directo a la tarjeta de revisión, sin
  // que tenga que buscarla ni repetir la selección en el select de abajo.
  const revisarPedidoProveedor = (proveedorId) => {
    setProveedorSugerenciaId(String(proveedorId));
    calcularSugerenciaParaProveedor(proveedorId);
    sugerenciaPedidoRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const actualizarCantidadSugerencia = (productoId, valor) => {
    setSugerenciaPedido(prev => prev.map(item =>
      item.producto_id === productoId ? { ...item, cantidadEditada: valor } : item
    ));
  };

  const toggleIncluidoSugerencia = (productoId) => {
    setSugerenciaPedido(prev => prev.map(item =>
      item.producto_id === productoId ? { ...item, incluido: !item.incluido } : item
    ));
  };

  // Reutiliza enviarPedidoMultipleWhatsApp adaptando el formato de items
  // ({ producto, cantidadSugerida }) a partir de la sugerencia editable.
  const enviarSugerenciaPorWhatsApp = () => {
    const proveedor = proveedores.find(p => p.id === parseInt(proveedorSugerenciaId));
    if (!proveedor) {
      setMensaje('⚠️ Selecciona un proveedor válido');
      return;
    }

    const itemsIncluidos = sugerenciaPedido
      .filter(item => item.incluido && parseInt(item.cantidadEditada) > 0)
      .map(item => ({
        producto: {
          nombre: item.nombre,
          codigo_ean: item.codigo_ean,
          stock_actual: item.stock_actual
        },
        cantidadSugerida: parseInt(item.cantidadEditada) || 0
      }));

    if (itemsIncluidos.length === 0) {
      setMensaje('⚠️ Selecciona al menos un producto con cantidad mayor a 0');
      return;
    }

    enviarPedidoMultipleWhatsApp(itemsIncluidos, proveedor);
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

      {mensaje && (
        <div className={`mensaje-flotante ${mensaje.includes('✅') ? 'exito' : mensaje.includes('❌') || mensaje.includes('⚠️') ? 'error' : 'info'}`}>
          {mensaje}
          <button onClick={() => setMensaje('')} className="btn-cerrar-mensaje">✕</button>
        </div>
      )}

      {/* Revisar pedido por proveedor: TODOS los proveedores activos, no
          solo los que el sistema detecta con stock crítico ahora mismo. */}
      <div className="card revisar-pedido-proveedores">
        <h3>🧾 Revisar pedido por proveedor</h3>
        {proveedores.length === 0 ? (
          <p className="sin-alertas">
            No hay proveedores registrados. Ve a <strong>Proveedores</strong> para agregar uno.
          </p>
        ) : (
          <div className="proveedores-revisar-grid">
            {proveedores.map(proveedor => (
              <div key={proveedor.id} className="proveedor-revisar-card">
                <span className="proveedor-revisar-nombre">{proveedor.nombre}</span>
                <button
                  onClick={() => revisarPedidoProveedor(proveedor.id)}
                  className="btn-revisar-pedido"
                >
                  🧾 Revisar pedido
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sugerencia de pedido por proveedor específico */}
      <div className="card sugerencia-pedido-proveedor" ref={sugerenciaPedidoRef}>
        <h3>🧮 Sugerencia de Pedido por Proveedor</h3>
        <p className="sugerencia-descripcion">
          Calcula cuánto pedir de cada producto asociado a un proveedor, según el promedio de ventas y su tiempo de entrega.
        </p>

        <div className="sugerencia-controles">
          <div className="form-group">
            <label>Proveedor</label>
            <select
              value={proveedorSugerenciaId}
              onChange={(e) => {
                setProveedorSugerenciaId(e.target.value);
                setSugerenciaPedido([]);
                setSugerenciaConsultada(false);
              }}
            >
              <option value="">Seleccionar proveedor...</option>
              {proveedores.map(proveedor => (
                <option key={proveedor.id} value={proveedor.id}>{proveedor.nombre}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Basado en ventas de los últimos {diasHistorial || 30} días</label>
            <input
              type="number"
              min="1"
              value={diasHistorial}
              onChange={(e) => setDiasHistorial(e.target.value)}
            />
          </div>
          <button
            onClick={calcularSugerenciaPedido}
            className="btn-calcular-sugerencia"
            disabled={!proveedorSugerenciaId || cargandoSugerencia}
          >
            {cargandoSugerencia ? '⏳ Calculando...' : '🧮 Calcular sugerencia'}
          </button>
        </div>

        {sugerenciaConsultada && (
          sugerenciaPedido.length === 0 ? (
            <p className="sin-alertas">
              Este proveedor no tiene productos asociados. Ve a <strong>Proveedores</strong> para asociar productos antes de calcular una sugerencia.
            </p>
          ) : (
            <>
              <table className="tabla-sugerencia-pedido">
                <thead>
                  <tr>
                    <th></th>
                    <th>Producto</th>
                    <th>Stock actual</th>
                    <th>Promedio diario</th>
                    <th>Cantidad sugerida</th>
                  </tr>
                </thead>
                <tbody>
                  {sugerenciaPedido.map(item => (
                    <tr key={item.producto_id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={item.incluido}
                          onChange={() => toggleIncluidoSugerencia(item.producto_id)}
                        />
                      </td>
                      <td>{item.nombre}</td>
                      <td>{item.stock_actual}</td>
                      <td>{item.promedioDiario.toFixed(1)} uds/día</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          value={item.cantidadEditada}
                          onChange={(e) => actualizarCantidadSugerencia(item.producto_id, e.target.value)}
                          className="input-cantidad-sugerida"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={enviarSugerenciaPorWhatsApp} className="btn-pedir-todo">
                📤 Enviar por WhatsApp
              </button>
            </>
          )
        )}
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