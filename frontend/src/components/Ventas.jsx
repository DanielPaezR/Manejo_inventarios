import React, { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import './Ventas.css';

const Ventas = ({ user }) => {
  const { moduloActivo } = useModulo();
  const [productos, setProductos] = useState([]);
  const [carrito, setCarrito] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [cliente, setCliente] = useState({
    nombre: '',
    documento: '',
    direccion: '',
    telefono: ''
  });
  const [metodoPago, setMetodoPago] = useState('efectivo');
  const [loading, setLoading] = useState(false);
  const [mostrarFactura, setMostrarFactura] = useState(false);
  const [facturaData, setFacturaData] = useState(null);
  const [modoScanner, setModoScanner] = useState(false);
  const inputRef = useRef(null);

  // Cargar productos al iniciar o cambiar de módulo
  useEffect(() => {
    if (moduloActivo) {
      cargarProductos();
      // Limpiar carrito al cambiar de módulo
      setCarrito([]);
    }
  }, [moduloActivo]);

  const cargarProductos = async () => {
    try {
      setLoading(true);
      const response = await api.get('/productos');
      setProductos(response.data);
    } catch (error) {
      console.error('Error cargando productos:', error);
      alert('Error al cargar productos');
    } finally {
      setLoading(false);
    }
  };

  // Buscar productos por nombre o código
  const buscarProductos = async (termino) => {
    try {
      setLoading(true);
      const response = await api.get('/productos', {
        params: { search: termino }
      });
      setProductos(response.data);
    } catch (error) {
      console.error('Error buscando productos:', error);
    } finally {
      setLoading(false);
    }
  };

  // Buscar producto por EAN (scanner)
  const buscarPorEAN = async (ean) => {
    try {
      const response = await api.get(`/productos/buscar/${ean}`);
      if (response.data) {
        agregarAlCarrito(response.data);
        setBusqueda('');
        // Enfocar input para siguiente escaneo
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }
    } catch (error) {
      if (error.response?.status === 404) {
        alert('Producto no encontrado');
      } else {
        console.error('Error buscando producto:', error);
      }
    }
  };

  // Manejar búsqueda
  const handleSearch = (e) => {
    const valor = e.target.value;
    setBusqueda(valor);
    
    if (modoScanner) {
      // Si está en modo scanner, buscar automáticamente al presionar Enter
      if (e.key === 'Enter' && valor) {
        buscarPorEAN(valor);
        e.preventDefault();
      }
    } else {
      // Búsqueda normal con debounce
      if (valor.length > 2) {
        buscarProductos(valor);
      } else if (valor.length === 0) {
        cargarProductos();
      }
    }
  };

  // Agregar al carrito
  const agregarAlCarrito = (producto) => {
    // Verificar stock
    if (producto.stock_actual <= 0) {
      alert(`El producto "${producto.nombre}" no tiene stock disponible`);
      return;
    }

    setCarrito(prev => {
      const existe = prev.find(item => item.producto_id === producto.id);
      if (existe) {
        // Verificar que no exceda el stock
        if (existe.cantidad >= producto.stock_actual) {
          alert(`Stock insuficiente. Solo hay ${producto.stock_actual} unidades disponibles`);
          return prev;
        }
        return prev.map(item =>
          item.producto_id === producto.id
            ? { ...item, cantidad: item.cantidad + 1 }
            : item
        );
      }
      return [...prev, {
        producto_id: producto.id,
        nombre: producto.nombre,
        precio_unitario: producto.precio_venta,
        cantidad: 1,
        stock_actual: producto.stock_actual
      }];
    });
  };

  // Eliminar del carrito
  const eliminarDelCarrito = (productoId) => {
    setCarrito(prev => prev.filter(item => item.producto_id !== productoId));
  };

  // Cambiar cantidad
  const cambiarCantidad = (productoId, cantidad) => {
    if (cantidad < 1) return;
    
    setCarrito(prev => {
      const producto = prev.find(item => item.producto_id === productoId);
      if (producto && cantidad > producto.stock_actual) {
        alert(`Stock insuficiente. Solo hay ${producto.stock_actual} unidades disponibles`);
        return prev;
      }
      return prev.map(item =>
        item.producto_id === productoId
          ? { ...item, cantidad }
          : item
      );
    });
  };

  // Calcular totales
  const subtotal = carrito.reduce((sum, item) => sum + (item.precio_unitario * item.cantidad), 0);

  // Procesar venta
  const procesarVenta = async () => {
    if (carrito.length === 0) {
      alert('El carrito está vacío');
      return;
    }

    if (!cliente.nombre && !cliente.documento) {
      if (!confirm('¿Continuar sin datos del cliente?')) {
        return;
      }
    }

    try {
      setLoading(true);
      const ventaData = {
        detalles: carrito.map(item => ({
          producto_id: item.producto_id,
          cantidad: item.cantidad,
          precio_unitario: item.precio_unitario
        })),
        cliente_nombre: cliente.nombre || 'Consumidor Final',
        cliente_documento: cliente.documento || '',
        cliente_direccion: cliente.direccion || '',
        cliente_telefono: cliente.telefono || '',
        metodo_pago: metodoPago
      };

      const response = await api.post('/ventas', ventaData);
      
      if (response.data) {
        setFacturaData(response.data);
        setMostrarFactura(true);
        setCarrito([]);
        setCliente({
          nombre: '',
          documento: '',
          direccion: '',
          telefono: ''
        });
        // Recargar productos para actualizar stock
        cargarProductos();
      }
    } catch (error) {
      console.error('Error procesando venta:', error);
      alert(error.response?.data?.error || 'Error al procesar la venta');
    } finally {
      setLoading(false);
    }
  };

  // Imprimir factura
  const imprimirFactura = () => {
    const contenido = document.getElementById('factura-content');
    if (!contenido) return;
    
    const ventana = window.open('', '_blank', 'width=400,height=600');
    if (!ventana) {
      alert('Por favor, permite las ventanas emergentes para imprimir');
      return;
    }
    
    ventana.document.write(`
      <html>
        <head>
          <title>Factura</title>
          <style>
            body { font-family: monospace; padding: 20px; max-width: 350px; margin: 0 auto; }
            .factura-header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px; }
            .factura-detalle { border-bottom: 1px solid #ddd; padding: 5px 0; }
            .factura-total { font-weight: bold; font-size: 1.2em; text-align: right; margin-top: 10px; }
            .factura-pie { text-align: center; margin-top: 20px; font-size: 0.9em; }
            @media print { .no-print { display: none; } }
          </style>
        </head>
        <body>
          <div id="factura-print">
            ${contenido.innerHTML}
          </div>
          <div class="no-print" style="text-align:center;margin-top:20px;">
            <button onclick="window.print()">🖨️ Imprimir</button>
            <button onclick="window.close()">Cerrar</button>
          </div>
          <script>
            window.print();
          <\/script>
        </body>
      </html>
    `);
    ventana.document.close();
  };

  // Si no hay módulo activo
  if (!moduloActivo) {
    return (
      <div className="ventas-container">
        <div className="alert alert-warning">
          ⚠️ No hay módulo activo. Selecciona un módulo para comenzar a vender.
        </div>
      </div>
    );
  }

  return (
    <div className="ventas-container">
      <div className="ventas-header">
        <h2>🛒 Punto de Venta</h2>
        <div className="modulo-indicador">
          <span className="badge">Módulo: {moduloActivo.nombre}</span>
        </div>
      </div>

      {/* Scanner y búsqueda */}
      <div className="busqueda-section">
        <div className="busqueda-input">
          <input
            ref={inputRef}
            type="text"
            value={busqueda}
            onChange={handleSearch}
            onKeyPress={handleSearch}
            placeholder={modoScanner ? "📷 Escanea un código de barras..." : "🔍 Buscar producto por nombre o código..."}
            className={modoScanner ? 'scanner-active' : ''}
          />
          <button
            onClick={() => {
              setModoScanner(!modoScanner);
              setBusqueda('');
              if (!modoScanner && inputRef.current) {
                inputRef.current.focus();
              }
            }}
            className={`btn-scanner ${modoScanner ? 'active' : ''}`}
            title="Activar modo scanner"
          >
            {modoScanner ? '📷' : '📷'}
          </button>
          <button onClick={cargarProductos} className="btn-refresh">
            🔄
          </button>
        </div>
        
        {modoScanner && (
          <div className="scanner-info">
            💡 Modo scanner activo: Escanea un código y se agregará automáticamente
          </div>
        )}
      </div>

      <div className="ventas-grid">
        {/* Lista de productos */}
        <div className="productos-lista">
          <h3>Productos</h3>
          {loading ? (
            <div className="loading">Cargando productos...</div>
          ) : (
            <div className="productos-grid">
              {productos.map(producto => (
                <div
                  key={producto.id}
                  className="producto-card"
                  onClick={() => agregarAlCarrito(producto)}
                >
                  <div className="producto-info">
                    <h4>{producto.nombre}</h4>
                    <p className="producto-precio">${producto.precio_venta.toLocaleString()}</p>
                    <p className={`producto-stock ${producto.stock_actual <= producto.stock_minimo ? 'bajo' : ''}`}>
                      Stock: {producto.stock_actual}
                    </p>
                    {producto.codigo_ean && (
                      <small className="producto-ean">Código: {producto.codigo_ean}</small>
                    )}
                  </div>
                  <button className="btn-agregar">+</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Carrito */}
        <div className="carrito-section">
          <h3>Carrito</h3>
          
          {/* Datos del cliente */}
          <div className="cliente-form">
            <input
              type="text"
              placeholder="Nombre del cliente"
              value={cliente.nombre}
              onChange={(e) => setCliente({ ...cliente, nombre: e.target.value })}
            />
            <input
              type="text"
              placeholder="Documento"
              value={cliente.documento}
              onChange={(e) => setCliente({ ...cliente, documento: e.target.value })}
            />
          </div>

          {/* Lista del carrito */}
          <div className="carrito-lista">
            {carrito.length === 0 ? (
              <p className="carrito-vacio">El carrito está vacío</p>
            ) : (
              carrito.map(item => (
                <div key={item.producto_id} className="carrito-item">
                  <div className="item-info">
                    <span className="item-nombre">{item.nombre}</span>
                    <span className="item-precio">${item.precio_unitario.toLocaleString()}</span>
                  </div>
                  <div className="item-controls">
                    <button onClick={() => cambiarCantidad(item.producto_id, item.cantidad - 1)}>−</button>
                    <span className="item-cantidad">{item.cantidad}</span>
                    <button onClick={() => cambiarCantidad(item.producto_id, item.cantidad + 1)}>+</button>
                    <button onClick={() => eliminarDelCarrito(item.producto_id)} className="btn-eliminar">
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Totales y método de pago */}
          {carrito.length > 0 && (
            <div className="carrito-totales">
              <div className="totales-linea">
                <span>Subtotal:</span>
                <span>${subtotal.toLocaleString()}</span>
              </div>
              <div className="totales-linea total">
                <span>Total:</span>
                <span>${subtotal.toLocaleString()}</span>
              </div>

              <div className="metodo-pago">
                <label>Método de pago:</label>
                <select
                  value={metodoPago}
                  onChange={(e) => setMetodoPago(e.target.value)}
                >
                  <option value="efectivo">Efectivo</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="otros">Otros</option>
                </select>
              </div>

              <button
                onClick={procesarVenta}
                className="btn-procesar-venta"
                disabled={loading}
              >
                {loading ? 'Procesando...' : '✅ Procesar Venta'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modal de factura */}
      {mostrarFactura && facturaData && (
        <div className="factura-modal" onClick={() => setMostrarFactura(false)}>
          <div className="factura-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="factura-modal-header">
              <h3>🧾 Factura</h3>
              <button onClick={() => setMostrarFactura(false)}>✕</button>
            </div>
            
            <div id="factura-content" className="factura-content">
              <div className="factura-header">
                <h2>{facturaData.negocio_nombre}</h2>
                <p>{facturaData.negocio_direccion}</p>
                <p>Tel: {facturaData.negocio_telefono}</p>
                <p>NIT: {facturaData.negocio_ruc_nit}</p>
                <p>Módulo: {facturaData.modulo_nombre}</p>
                <hr />
                <p><strong>Factura N°:</strong> {facturaData.numero_factura}</p>
                <p><strong>Fecha:</strong> {new Date(facturaData.fecha_venta).toLocaleString()}</p>
                <p><strong>Vendedor:</strong> {facturaData.vendedor_nombre}</p>
                <p><strong>Cliente:</strong> {facturaData.cliente_nombre}</p>
                {facturaData.cliente_documento && (
                  <p><strong>Documento:</strong> {facturaData.cliente_documento}</p>
                )}
              </div>

              <div className="factura-detalles">
                <table>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Cant</th>
                      <th>Precio</th>
                      <th>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facturaData.detalles.map((detalle, index) => (
                      <tr key={index}>
                        <td>{detalle.producto_nombre}</td>
                        <td>{detalle.cantidad}</td>
                        <td>${detalle.precio_unitario.toLocaleString()}</td>
                        <td>${detalle.subtotal.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="factura-totales">
                <div className="total-linea">
                  <span>Subtotal:</span>
                  <span>${facturaData.subtotal.toLocaleString()}</span>
                </div>
                <div className="total-linea total">
                  <span><strong>Total:</strong></span>
                  <span><strong>${facturaData.total.toLocaleString()}</strong></span>
                </div>
                <div className="total-linea">
                  <span>Método de pago:</span>
                  <span>{facturaData.metodo_pago}</span>
                </div>
              </div>

              <div className="factura-footer">
                <p>¡Gracias por tu compra!</p>
              </div>
            </div>

            <div className="factura-modal-footer">
              <button onClick={imprimirFactura} className="btn-imprimir">
                🖨️ Imprimir
              </button>
              <button onClick={() => setMostrarFactura(false)} className="btn-cerrar-factura">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Ventas;