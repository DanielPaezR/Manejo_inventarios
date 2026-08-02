import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import './GestionInventario.css';

const GestionInventario = ({ user }) => {
  const { moduloActivo } = useModulo();
  const [productos, setProductos] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [productosConProveedor, setProductosConProveedor] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedProducto, setSelectedProducto] = useState(null);
  const [cantidad, setCantidad] = useState('');
  const [nuevoStock, setNuevoStock] = useState('');
  const [motivo, setMotivo] = useState('');
  const [tipoOperacion, setTipoOperacion] = useState('agregar');
  const [mensaje, setMensaje] = useState('');
  const [mostrarProveedores, setMostrarProveedores] = useState(false);
  const [nuevoProveedor, setNuevoProveedor] = useState({
    nombre: '',
    contacto: '',
    telefono: '',
    email: '',
    direccion: ''
  });
  const [pedidosSugeridos, setPedidosSugeridos] = useState([]);
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState(null);
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
      cargarProductos();
      cargarProveedores();
    }
  }, [moduloActivo]);

  const cargarProductos = async () => {
    try {
      setLoading(true);
      const response = await api.get('/productos');
      setProductos(response.data);
    } catch (error) {
      console.error('Error cargando productos:', error);
      setMensaje('❌ Error al cargar productos');
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

  const calcularPedidosSugeridos = useCallback(() => {
    // Productos con stock bajo o crítico
    const productosCriticos = productos.filter(
      p => p.stock_actual <= p.stock_minimo && p.stock_actual > 0
    );
    const productosAgotados = productos.filter(p => p.stock_actual === 0);
    
    const sugerencias = [];
    
    // Agrupar por proveedor (si tienen)
    productosCriticos.forEach(p => {
      // Buscar proveedor asociado a este producto
      const proveedor = proveedores.find(prov =>
        prov.productos_asociados && prov.productos_asociados.includes(p.id)
      );
      
      if (proveedor) {
        const cantidadSugerida = Math.max(p.stock_minimo * 2, 10);
        sugerencias.push({
          producto: p,
          proveedor,
          cantidadSugerida,
          urgencia: p.stock_actual === 0 ? 'crítica' : 'media',
          mensaje: p.stock_actual === 0 
            ? `⚠️ ¡AGOTADO! ${p.nombre} necesita reposición urgente`
            : `📦 ${p.nombre} tiene stock bajo (${p.stock_actual}/${p.stock_minimo})`
        });
      }
    });
    
    setPedidosSugeridos(sugerencias);
  }, [productos, proveedores]);

  // Recalcular sugerencias cuando cambien productos o proveedores. Antes se
  // llamaba una sola vez en el efecto de montaje, con productos/proveedores
  // todavía vacíos (las cargas son async), y nunca se repetía cuando los
  // datos reales llegaban. Este efecto debe declararse DESPUÉS de
  // calcularPedidosSugeridos: su dependencia se evalúa en el momento del
  // render, y referenciar un `const` antes de su línea de declaración es un
  // ReferenceError (temporal dead zone), no solo un problema de closures.
  useEffect(() => {
    calcularPedidosSugeridos();
  }, [calcularPedidosSugeridos]);

  const handleAgregarStock = async () => {
    if (!selectedProducto) {
      setMensaje('⚠️ Selecciona un producto');
      return;
    }

    if (!cantidad || parseInt(cantidad) <= 0) {
      setMensaje('⚠️ Ingresa una cantidad válida');
      return;
    }

    try {
      setLoading(true);
      await api.post('/inventario/agregar-stock', {
        producto_id: selectedProducto.id,
        cantidad: parseInt(cantidad),
        motivo: motivo || 'Sin motivo'
      });
      
      setMensaje(`✅ Stock agregado correctamente a "${selectedProducto.nombre}"`);
      setCantidad('');
      setMotivo('');
      cargarProductos();
      setTimeout(() => setMensaje(''), 3000);
    } catch (error) {
      console.error('Error agregando stock:', error);
      setMensaje('❌ Error al agregar stock');
    } finally {
      setLoading(false);
    }
  };

  const handleAjustarStock = async () => {
    if (!selectedProducto) {
      setMensaje('⚠️ Selecciona un producto');
      return;
    }

    if (!nuevoStock || parseInt(nuevoStock) < 0) {
      setMensaje('⚠️ Ingresa un stock válido');
      return;
    }

    try {
      setLoading(true);
      await api.post('/inventario/ajustar-stock', {
        producto_id: selectedProducto.id,
        nuevo_stock: parseInt(nuevoStock),
        motivo: motivo || 'Sin motivo'
      });
      
      setMensaje(`✅ Stock ajustado correctamente para "${selectedProducto.nombre}"`);
      setNuevoStock('');
      setMotivo('');
      cargarProductos();
      setTimeout(() => setMensaje(''), 3000);
    } catch (error) {
      console.error('Error ajustando stock:', error);
      setMensaje('❌ Error al ajustar stock');
    } finally {
      setLoading(false);
    }
  };

  // Enviar pedido por WhatsApp
  const enviarPedidoWhatsApp = (producto, proveedor, cantidadSugerida) => {
    // Número de teléfono del proveedor (formato internacional)
    const telefono = proveedor.telefono?.replace(/\D/g, '');
    if (!telefono) {
      setMensaje(`❌ El proveedor "${proveedor.nombre}" no tiene número de teléfono registrado`);
      return;
    }

    // Construir mensaje personalizado
    const mensajeWhatsApp = encodeURIComponent(
      `📦 *PEDIDO DE REPOSICIÓN*\n\n` +
      `🔹 *Producto:* ${producto.nombre}\n` +
      `🔹 *Cantidad sugerida:* ${cantidadSugerida} unidades\n` +
      `🔹 *Stock actual:* ${producto.stock_actual} unidades\n` +
      `🔹 *Stock mínimo:* ${producto.stock_minimo} unidades\n` +
      `🔹 *Módulo:* ${moduloActivo.nombre}\n\n` +
      `📅 *Fecha de pedido:* ${new Date().toLocaleDateString()}\n\n` +
      `Por favor, confirmar disponibilidad y fecha de entrega.\n` +
      `¡Gracias! 🙏`
    );

    // URL de WhatsApp
    const url = `https://wa.me/${telefono}?text=${mensajeWhatsApp}`;
    
    // Abrir en nueva ventana
    window.open(url, '_blank');
    
    setMensaje(`📤 Enviando pedido a ${proveedor.nombre}...`);
    setTimeout(() => setMensaje(''), 3000);
  };

  // Enviar pedido múltiple (varios productos al mismo proveedor)
  const enviarPedidoMultipleWhatsApp = (productosDelProveedor, proveedor) => {
    const telefono = proveedor.telefono?.replace(/\D/g, '');
    if (!telefono) {
      setMensaje(`❌ El proveedor "${proveedor.nombre}" no tiene número de teléfono registrado`);
      return;
    }

    let mensaje = `📦 *PEDIDO DE REPOSICIÓN MÚLTIPLE*\n\n`;
    mensaje += `📅 *Fecha:* ${new Date().toLocaleDateString()}\n`;
    mensaje += `🏪 *Módulo:* ${moduloActivo.nombre}\n\n`;
    mensaje += `*Lista de productos:*\n`;
    mensaje += `-------------------\n`;

    productosDelProveedor.forEach((item, index) => {
      mensaje += `${index + 1}. *${item.producto.nombre}*\n`;
      mensaje += `   Cantidad: ${item.cantidadSugerida} unidades\n`;
      mensaje += `   Stock actual: ${item.producto.stock_actual}\n\n`;
    });

    mensaje += `-------------------\n`;
    mensaje += `Por favor, confirmar disponibilidad y fecha de entrega. 🙏`;

    const url = `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
    window.open(url, '_blank');
    
    setMensaje(`📤 Enviando pedido múltiple a ${proveedor.nombre}...`);
    setTimeout(() => setMensaje(''), 3000);
  };

  // Sugerencia de pedido para un proveedor específico, basada en ventas
  // históricas y tiempo de entrega (complementaria a "Pedidos Sugeridos",
  // que es por stock crítico). Recibe el id explícito en vez de leerlo de
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

  // Agrupar pedidos sugeridos por proveedor
  const pedidosPorProveedor = pedidosSugeridos.reduce((acc, item) => {
    const key = item.proveedor.id;
    if (!acc[key]) {
      acc[key] = {
        proveedor: item.proveedor,
        productos: []
      };
    }
    acc[key].productos.push(item);
    return acc;
  }, {});

  if (!puedeGestionar) {
    return (
      <div className="gestion-inventario-container">
        <div className="alert alert-warning">
          ⚠️ No tienes permisos para gestionar inventario. Solo administradores pueden acceder a esta sección.
        </div>
      </div>
    );
  }

  if (!moduloActivo) {
    return (
      <div className="gestion-inventario-container">
        <div className="alert alert-warning">
          ⚠️ No hay módulo activo. Selecciona un módulo para gestionar el inventario.
        </div>
      </div>
    );
  }

  return (
    <div className="gestion-inventario-container">
      <div className="gestion-header">
        <h2>📦 Gestión de Inventario</h2>
        <div className="modulo-indicador">
          <span className="badge">📁 {moduloActivo.nombre}</span>
        </div>
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

      {/* Panel de Pedidos Sugeridos */}
      {pedidosSugeridos.length > 0 && (
        <div className="card pedidos-sugeridos">
          <h3>
            📋 Pedidos Sugeridos
            <span className="badge-pedidos">{pedidosSugeridos.length} productos</span>
          </h3>
          
          <div className="pedidos-grid">
            {Object.values(pedidosPorProveedor).map((grupo, index) => (
              <div key={index} className="pedido-proveedor-card">
                <div className="proveedor-header">
                  <div className="proveedor-info">
                    <strong>{grupo.proveedor.nombre}</strong>
                    {grupo.proveedor.telefono && (
                      <span className="proveedor-telefono">📞 {grupo.proveedor.telefono}</span>
                    )}
                  </div>
                  <button
                    onClick={() => revisarPedidoProveedor(grupo.proveedor.id)}
                    className="btn-pedir-todo"
                    title="Revisar y ajustar el pedido antes de enviarlo"
                  >
                    🧾 Revisar pedido
                  </button>
                </div>
                
                <div className="productos-pedido">
                  {grupo.productos.map((item, idx) => (
                    <div key={idx} className={`producto-pedido-item ${item.urgencia === 'crítica' ? 'urgente' : ''}`}>
                      <div className="producto-pedido-info">
                        <span className="producto-nombre">{item.producto.nombre}</span>
                        <span className="producto-stock">
                          Stock: {item.producto.stock_actual}/{item.producto.stock_minimo}
                        </span>
                        <span className="producto-cantidad-sugerida">
                          Sugerido: {item.cantidadSugerida} uds
                        </span>
                        {item.urgencia === 'crítica' && (
                          <span className="badge-urgente">⚠️ URGENTE</span>
                        )}
                      </div>
                      <button
                        onClick={() => enviarPedidoWhatsApp(item.producto, item.proveedor, item.cantidadSugerida)}
                        className="btn-pedir-individual"
                        title="Enviar pedido individual por WhatsApp"
                      >
                        📤 Pedir
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="gestion-grid">
        {/* Selección de producto */}
        <div className="card seleccion-producto">
          <h3>1. Seleccionar Producto</h3>
          {loading ? (
            <div className="loading">Cargando productos...</div>
          ) : (
            <div className="producto-selector">
              <select 
                value={selectedProducto?.id || ''}
                onChange={(e) => {
                  const producto = productos.find(p => p.id === parseInt(e.target.value));
                  setSelectedProducto(producto);
                  setCantidad('');
                  setNuevoStock('');
                }}
              >
                <option value="">Seleccionar producto...</option>
                {productos.map(producto => (
                  <option key={producto.id} value={producto.id}>
                    {producto.nombre} - Stock: {producto.stock_actual}
                  </option>
                ))}
              </select>
              
              {selectedProducto && (
                <div className="producto-info">
                  <div className="info-grid">
                    <p><strong>📦 Stock actual:</strong> {selectedProducto.stock_actual}</p>
                    <p><strong>⚠️ Stock mínimo:</strong> {selectedProducto.stock_minimo}</p>
                    <p><strong>💰 Precio compra:</strong> ${Number(selectedProducto.precio_compra).toLocaleString()}</p>
                    <p><strong>💵 Precio venta:</strong> ${Number(selectedProducto.precio_venta).toLocaleString()}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Operaciones de stock */}
        <div className="card operaciones-stock">
          <h3>2. Operaciones</h3>
          
          <div className="tipo-operacion">
            <button 
              className={`btn-tipo ${tipoOperacion === 'agregar' ? 'active' : ''}`}
              onClick={() => setTipoOperacion('agregar')}
            >
              ➕ Agregar Stock
            </button>
            <button 
              className={`btn-tipo ${tipoOperacion === 'ajustar' ? 'active' : ''}`}
              onClick={() => setTipoOperacion('ajustar')}
            >
              🔧 Ajustar Stock
            </button>
          </div>

          {tipoOperacion === 'agregar' ? (
            <div className="operacion-form">
              <div className="form-group">
                <label>Cantidad a agregar *</label>
                <input
                  type="number"
                  value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  placeholder="Ej: 10"
                  min="1"
                  disabled={!selectedProducto}
                />
              </div>
              <div className="form-group">
                <label>Motivo (opcional)</label>
                <input
                  type="text"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej: Reposición de stock"
                  disabled={!selectedProducto}
                />
              </div>
              <button 
                onClick={handleAgregarStock} 
                className="btn-agregar-stock"
                disabled={!selectedProducto || loading}
              >
                {loading ? '⏳ Procesando...' : '✅ Agregar Stock'}
              </button>
            </div>
          ) : (
            <div className="operacion-form">
              <div className="form-group">
                <label>Nuevo stock total *</label>
                <input
                  type="number"
                  value={nuevoStock}
                  onChange={(e) => setNuevoStock(e.target.value)}
                  placeholder="Ej: 50"
                  min="0"
                  disabled={!selectedProducto}
                />
                {selectedProducto && nuevoStock && (
                  <div className="stock-diferencia">
                    <span>Diferencia: {parseInt(nuevoStock) - selectedProducto.stock_actual}</span>
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>Motivo (opcional)</label>
                <input
                  type="text"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej: Corrección de inventario físico"
                  disabled={!selectedProducto}
                />
              </div>
              <button 
                onClick={handleAjustarStock} 
                className="btn-ajustar-stock"
                disabled={!selectedProducto || loading}
              >
                {loading ? '⏳ Procesando...' : '✅ Ajustar Stock'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabla de productos con stock bajo */}
      <div className="card alertas-stock">
        <h3>⚠️ Alertas de Stock Bajo</h3>
        {loading ? (
          <div className="loading">Cargando alertas...</div>
        ) : (
          <div className="alertas-lista">
            {productos.filter(p => p.stock_actual <= p.stock_minimo).length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Stock Actual</th>
                    <th>Stock Mínimo</th>
                    <th>Estado</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {productos
                    .filter(p => p.stock_actual <= p.stock_minimo)
                    .map(producto => {
                      const sugerencia = pedidosSugeridos.find(p => p.producto.id === producto.id);
                      return (
                        <tr key={producto.id} className="alerta-row">
                          <td>{producto.nombre}</td>
                          <td className="stock-critico">{producto.stock_actual}</td>
                          <td>{producto.stock_minimo}</td>
                          <td>
                            <span className={`estado-badge ${producto.stock_actual === 0 ? 'agotado' : 'bajo'}`}>
                              {producto.stock_actual === 0 ? 'Agotado' : 'Stock Bajo'}
                            </span>
                          </td>
                          <td>
                            {sugerencia && sugerencia.proveedor ? (
                              <button
                                onClick={() => enviarPedidoWhatsApp(
                                  sugerencia.producto, 
                                  sugerencia.proveedor, 
                                  sugerencia.cantidadSugerida
                                )}
                                className="btn-pedir-whatsapp"
                                title="Enviar pedido por WhatsApp"
                              >
                                📤 WhatsApp
                              </button>
                            ) : (
                              <span className="sin-proveedor">Sin proveedor</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            ) : (
              <p className="sin-alertas">✅ Todos los productos tienen stock adecuado</p>
            )}
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
    </div>
  );
};

export default GestionInventario;