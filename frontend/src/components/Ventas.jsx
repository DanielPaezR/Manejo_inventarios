import React, { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import Factura from './Factura';
import './Ventas.css';

const Ventas = ({ user }) => {
  const [productos, setProductos] = useState([]);
  const [carrito, setCarrito] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [cliente, setCliente] = useState({
    nombre: '',
    documento: '',
    telefono: '',
    direccion: ''
  });
  const [metodoPago, setMetodoPago] = useState('efectivo');
  const [loading, setLoading] = useState(false);
  const [factura, setFactura] = useState(null);
  const [mensaje, setMensaje] = useState('');
  const [mostrarConfirmacion, setMostrarConfirmacion] = useState(false);
  const [modoScanner, setModoScanner] = useState(false);
  
  const inputBusquedaRef = useRef(null);
  const confirmarButtonRef = useRef(null);
  const cancelarButtonRef = useRef(null);

  // Cargar productos
  useEffect(() => {
    cargarProductos();
  }, []);

  // Focus automático en la búsqueda cuando se activa el modo scanner
  useEffect(() => {
    if (modoScanner && inputBusquedaRef.current) {
      inputBusquedaRef.current.focus();
      setMensaje('🔴 Modo scanner activado - Listo para escanear');
    }
  }, [modoScanner]);

  // Focus automático en el botón de confirmar cuando aparece el modal
  useEffect(() => {
    if (mostrarConfirmacion && confirmarButtonRef.current) {
      setTimeout(() => {
        confirmarButtonRef.current.focus();
      }, 100);
    }
  }, [mostrarConfirmacion]);

  const cargarProductos = async () => {
    try {
      const response = await api.get('/productos');
      setProductos(response.data);
    } catch (error) {
      console.error('Error cargando productos:', error);
      setMensaje('❌ Error al cargar productos');
    }
  };

  // ✅ FUNCIÓN MEJORADA: Buscar y manejar scanner
  const buscarProducto = async (codigoEAN = null) => {
    const textoBusqueda = codigoEAN || busqueda;
    
    if (!textoBusqueda.trim()) {
      cargarProductos();
      return;
    }

    try {
      const response = await api.get(`/productos?search=${textoBusqueda}`);
      const productosEncontrados = response.data;
      
      if (productosEncontrados.length === 0) {
        setMensaje('❌ Producto no encontrado');
        setTimeout(() => setMensaje(''), 3000);
        return;
      }

      // Si estamos en modo scanner, agregar automáticamente el primer producto
      if (modoScanner && productosEncontrados.length > 0) {
        const producto = productosEncontrados[0];
        agregarAlCarrito(producto);
        
        // Limpiar búsqueda después de agregar
        setBusqueda('');
        if (inputBusquedaRef.current) {
          inputBusquedaRef.current.focus();
        }
        
        setMensaje(`✅ ${producto.nombre} agregado al carrito`);
      } else {
        // Modo búsqueda normal
        setProductos(productosEncontrados);
      }
    } catch (error) {
      console.error('Error buscando productos:', error);
      setMensaje('❌ Error en la búsqueda');
    }
  };

  // ✅ MANEJADOR DE TECLADO PARA SCANNER
  const handleKeyPress = (e) => {
    // Si se presiona Enter y hay texto en la búsqueda
    if (e.key === 'Enter' && busqueda.trim()) {
      e.preventDefault();
      buscarProducto();
    }
  };

  // ✅ MANEJADOR DE TECLADO PARA EL MODAL DE CONFIRMACIÓN
  const handleModalKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (document.activeElement === confirmarButtonRef.current) {
        procesarVenta();
      } else if (document.activeElement === cancelarButtonRef.current) {
        setMostrarConfirmacion(false);
      }
    } else if (e.key === 'Escape') {
      setMostrarConfirmacion(false);
    } else if (e.key === 'Tab' && e.shiftKey) {
      // Prevenir tab hacia atrás desde el primer botón
      if (document.activeElement === confirmarButtonRef.current) {
        e.preventDefault();
        cancelarButtonRef.current.focus();
      }
    }
  };

  const agregarAlCarrito = (producto) => {
    if (producto.stock_actual <= 0) {
      setMensaje('❌ Producto sin stock');
      setTimeout(() => setMensaje(''), 3000);
      return;
    }

    const productoEnCarrito = carrito.find(item => item.producto_id === producto.id);
    
    if (productoEnCarrito) {
      if (productoEnCarrito.cantidad >= producto.stock_actual) {
        setMensaje('❌ No hay suficiente stock');
        setTimeout(() => setMensaje(''), 3000);
        return;
      }
      setCarrito(carrito.map(item =>
        item.producto_id === producto.id
          ? { 
              ...item, 
              cantidad: item.cantidad + 1, 
              subtotal: (item.cantidad + 1) * item.precio_unitario 
            }
          : item
      ));
    } else {
      setCarrito([...carrito, {
        producto_id: producto.id,
        producto_nombre: producto.nombre,
        cantidad: 1,
        precio_unitario: producto.precio_venta,
        subtotal: producto.precio_venta
      }]);
    }
    
    if (!modoScanner) {
      setMensaje('✅ Producto agregado al carrito');
      setTimeout(() => setMensaje(''), 2000);
    }
  };

  const modificarCantidad = (productoId, nuevaCantidad) => {
    if (nuevaCantidad < 1) {
      eliminarDelCarrito(productoId);
      return;
    }

    const producto = productos.find(p => p.id === productoId);
    if (producto && nuevaCantidad > producto.stock_actual) {
      setMensaje('❌ No hay suficiente stock');
      setTimeout(() => setMensaje(''), 3000);
      return;
    }

    setCarrito(carrito.map(item =>
      item.producto_id === productoId
        ? { 
            ...item, 
            cantidad: nuevaCantidad, 
            subtotal: nuevaCantidad * item.precio_unitario 
          }
        : item
    ));
  };

  const eliminarDelCarrito = (productoId) => {
    setCarrito(carrito.filter(item => item.producto_id !== productoId));
  };

  // ✅ FUNCIÓN CORREGIDA - Asegurar que sean números
  const calcularTotales = () => {
    const subtotal = carrito.reduce((total, item) => {
      const itemSubtotal = Number(item.subtotal) || 0;
      return total + itemSubtotal;
    }, 0);
    
    const iva = subtotal * 0.19;
    const total = subtotal + iva;
    
    return { 
      subtotal: Number(subtotal.toFixed(2)), 
      iva: Number(iva.toFixed(2)), 
      total: Number(total.toFixed(2)) 
    };
  };

  const limpiarVenta = () => {
    setCarrito([]);
    setCliente({ nombre: '', documento: '', telefono: '', direccion: '' });
    setMetodoPago('efectivo');
    setBusqueda('');
    setMensaje('🔄 Venta limpiada');
    setTimeout(() => setMensaje(''), 3000);
  };

  const toggleModoScanner = () => {
    const nuevoModo = !modoScanner;
    setModoScanner(nuevoModo);
    
    if (nuevoModo && inputBusquedaRef.current) {
      inputBusquedaRef.current.focus();
    }
  };

  const confirmarVenta = () => {
    if (carrito.length === 0) {
      setMensaje('❌ El carrito está vacío');
      setTimeout(() => setMensaje(''), 3000);
      return;
    }
    setMostrarConfirmacion(true);
  };

  const procesarVenta = async () => {
    setLoading(true);
    setMostrarConfirmacion(false);

    try {
      const { subtotal, iva, total } = calcularTotales();
      
      const ventaData = {
        detalles: carrito,
        cliente_nombre: cliente.nombre || 'Consumidor Final',
        cliente_documento: cliente.documento || '',
        cliente_telefono: cliente.telefono || '',
        cliente_direccion: cliente.direccion || '',
        metodo_pago: metodoPago
      };

      const response = await api.post('/ventas', ventaData);
      setFactura(response.data);
      setMensaje('✅ Venta registrada exitosamente');
      
      // Limpiar después de éxito
      setTimeout(() => {
        setCarrito([]);
        setCliente({ nombre: '', documento: '', telefono: '', direccion: '' });
        setBusqueda('');
        cargarProductos(); // Actualizar stocks
        
        // Reactivar modo scanner si estaba activo
        if (modoScanner && inputBusquedaRef.current) {
          inputBusquedaRef.current.focus();
        }
      }, 2000);

    } catch (error) {
      console.error('Error procesando venta:', error);
      setMensaje('❌ Error al procesar la venta: ' + (error.response?.data?.error || 'Error de conexión'));
    } finally {
      setLoading(false);
      setTimeout(() => setMensaje(''), 5000);
    }
  };

  const { subtotal, iva, total } = calcularTotales();

  return (
    <div className="ventas-container">
      {factura && (
        <Factura 
          venta={factura} 
          onClose={() => setFactura(null)} 
        />
      )}

      {/* Modal de Confirmación - MODIFICADO */}
      {mostrarConfirmacion && (
        <div className="modal-overlay" onKeyDown={handleModalKeyDown}>
          <div className="modal-confirmacion">
            <h3>Confirmar Venta</h3>
            <div className="confirmacion-detalles">
              <p><strong>Cliente:</strong> {cliente.nombre || 'Consumidor Final'}</p>
              <p><strong>Items:</strong> {carrito.length} productos</p>
              <p><strong>Subtotal:</strong> ${subtotal.toLocaleString()}</p>
              <p><strong>IVA (19%):</strong> ${iva.toLocaleString()}</p>
              <p><strong>Total:</strong> ${total.toLocaleString()}</p>
              <p><strong>Método de pago:</strong> {metodoPago}</p>
            </div>
            <div className="modal-actions">
              <button 
                ref={confirmarButtonRef}
                onClick={procesarVenta} 
                disabled={loading}
                className="btn-confirmar"
                autoFocus
              >
                {loading ? 'Procesando...' : '✅ Confirmar Venta (Enter)'}
              </button>
              <button 
                ref={cancelarButtonRef}
                onClick={() => setMostrarConfirmacion(false)}
                className="btn-cancelar"
              >
                ✖️ Cancelar (Esc)
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="ventas-header">
        <h1>Punto de Venta</h1>
        <div className="header-controls">
          <button 
            onClick={toggleModoScanner}
            className={`btn-scanner ${modoScanner ? 'scanner-activo' : ''}`}
          >
            {modoScanner ? '🔴 Scanner Activo' : '📷 Activar Scanner'}
          </button>
          {mensaje && <div className="mensaje-flotante">{mensaje}</div>}
        </div>
      </div>

      <div className="ventas-content">
        {/* Panel de Búsqueda y Productos */}
        <div className="productos-panel">
          <div className="busqueda-container">
            <input
              ref={inputBusquedaRef}
              type="text"
              placeholder={modoScanner ? "Escanear código de barras..." : "Buscar por nombre o código EAN..."}
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyPress={handleKeyPress}
              className={modoScanner ? 'input-scanner-activo' : ''}
            />
            <button onClick={() => buscarProducto()} className="btn-buscar">
              🔍 {modoScanner ? 'Escanear' : 'Buscar'}
            </button>
            <button onClick={cargarProductos} className="btn-refrescar">
              🔄 Todos
            </button>
          </div>

          {!modoScanner && (
            <div className="productos-grid">
              {productos.map(producto => (
                <div key={producto.id} className="producto-card">
                  <div className="producto-info">
                    <h4>{producto.nombre}</h4>
                    <p className="producto-codigo">EAN: {producto.codigo_ean || 'N/A'}</p>
                    <p className="producto-precio">${typeof producto.precio_venta === 'number' ? producto.precio_venta.toLocaleString() : '0'}</p>
                    <p className="producto-stock">
                      Stock: {producto.stock_actual} 
                      {producto.stock_actual <= producto.stock_minimo && (
                        <span className="stock-bajo"> ⚠️ Bajo</span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => agregarAlCarrito(producto)}
                    disabled={producto.stock_actual <= 0}
                    className="btn-agregar"
                  >
                    {producto.stock_actual > 0 ? '➕ Agregar' : '❌ Sin Stock'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {modoScanner && (
            <div className="scanner-info">
              <div className="scanner-instructions">
                <h3>🔄 Modo Scanner Activado</h3>
                <p>• Apunte el scanner al código de barras</p>
                <p>• El producto se agregará automáticamente al carrito</p>
                <p>• El campo de búsqueda se limpiará después de cada escaneo</p>
                <p>• Presione ESC para desactivar el modo scanner</p>
              </div>
            </div>
          )}
        </div>

        {/* Panel del Carrito */}
        <div className="carrito-panel">
          <div className="carrito-header">
            <h3>Carrito de Venta</h3>
            <div className="carrito-controls">
              <span className="items-count">{carrito.length} items</span>
              {carrito.length > 0 && (
                <button onClick={limpiarVenta} className="btn-limpiar">
                  🗑️ Limpiar
                </button>
              )}
            </div>
          </div>

          <div className="cliente-info">
            <h4>Datos del Cliente</h4>
            <input
              type="text"
              placeholder="Nombre del cliente (opcional)"
              value={cliente.nombre}
              onChange={(e) => setCliente({...cliente, nombre: e.target.value})}
            />
            <input
              type="text"
              placeholder="Documento (opcional)"
              value={cliente.documento}
              onChange={(e) => setCliente({...cliente, documento: e.target.value})}
            />
            <input
              type="text"
              placeholder="Teléfono (opcional)"
              value={cliente.telefono}
              onChange={(e) => setCliente({...cliente, telefono: e.target.value})}
            />
          </div>

          <div className="carrito-items">
            {carrito.length === 0 ? (
              <p className="carrito-vacio">El carrito está vacío</p>
            ) : (
              carrito.map(item => (
                <div key={item.producto_id} className="carrito-item">
                  <div className="item-info">
                    <span className="item-nombre">{item.producto_nombre}</span>
                    <span className="item-precio">
                      ${typeof item.precio_unitario === 'number' ? item.precio_unitario.toLocaleString() : '0'} c/u
                    </span>
                  </div>
                  <div className="item-controls">
                    <button 
                      onClick={() => modificarCantidad(item.producto_id, item.cantidad - 1)}
                      className="btn-cantidad"
                    >
                      -
                    </button>
                    <span className="item-cantidad">{item.cantidad}</span>
                    <button 
                      onClick={() => modificarCantidad(item.producto_id, item.cantidad + 1)}
                      className="btn-cantidad"
                    >
                      +
                    </button>
                    <button 
                      onClick={() => eliminarDelCarrito(item.producto_id)}
                      className="btn-eliminar"
                    >
                      🗑️
                    </button>
                  </div>
                  <div className="item-subtotal">
                    ${typeof item.subtotal === 'number' ? item.subtotal.toLocaleString() : '0'}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="carrito-totales">
            <div className="total-line">
              <span>Subtotal:</span>
              <span>${typeof subtotal === 'number' ? subtotal.toLocaleString() : '0'}</span>
            </div>
            <div className="total-line">
              <span>IVA (19%):</span>
              <span>${typeof iva === 'number' ? iva.toLocaleString() : '0'}</span>
            </div>
            <div className="total-line total-final">
              <span>TOTAL:</span>
              <span>${typeof total === 'number' ? total.toLocaleString() : '0'}</span>
            </div>
          </div>

          <div className="metodo-pago">
            <label>Método de Pago:</label>
            <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)}>
              <option value="efectivo">💵 Efectivo</option>
              <option value="tarjeta">💳 Tarjeta</option>
              <option value="transferencia">🏦 Transferencia</option>
              <option value="nequi">📱 Nequi</option>
              <option value="daviplata">📱 DaviPlata</option>
            </select>
          </div>

          <div className="acciones-venta">
            <button
              onClick={confirmarVenta}
              disabled={carrito.length === 0}
              className="btn-procesar"
            >
              💳 Registrar Venta - ${typeof total === 'number' ? total.toLocaleString() : '0'}
            </button>
            
            {carrito.length > 0 && (
              <button
                onClick={limpiarVenta}
                className="btn-cancelar-venta"
              >
                ❌ Cancelar Venta
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Ventas;