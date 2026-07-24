import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import { Html5Qrcode } from 'html5-qrcode';
import './Ventas.css';


const Ventas = ({ user }) => {
  const { moduloActivo } = useModulo();
  const [productos, setProductos] = useState([]);
  const [carrito, setCarrito] = useState(() => {
    // Recuperar carrito del localStorage al iniciar. Si quedó corrupto
    // (escritura interrumpida, edición manual), no debe tumbar el render.
    try {
      const saved = localStorage.getItem('carrito');
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error('Error leyendo carrito de localStorage:', error);
      return [];
    }
  });
  const [busqueda, setBusqueda] = useState('');
  const [cliente, setCliente] = useState(() => {
    const clienteVacio = { nombre: '', documento: '', direccion: '', telefono: '' };
    try {
      const saved = localStorage.getItem('cliente');
      return saved ? JSON.parse(saved) : clienteVacio;
    } catch (error) {
      console.error('Error leyendo cliente de localStorage:', error);
      return clienteVacio;
    }
  });
  const [metodoPago, setMetodoPago] = useState('efectivo');
  const [loading, setLoading] = useState(false);
  const [mostrarFactura, setMostrarFactura] = useState(false);
  const [facturaData, setFacturaData] = useState(null);
  const [modoScanner, setModoScanner] = useState(false);
  const [scannerActivo, setScannerActivo] = useState(false);
  const [error, setError] = useState(null);
  const [scanToast, setScanToast] = useState(null); // { nombre, cantidad }
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
  const [clienteResultados, setClienteResultados] = useState([]);
  const [buscandoCliente, setBuscandoCliente] = useState(false);
  const [mostrarResultadosCliente, setMostrarResultadosCliente] = useState(false);
  const [mostrarNuevoCliente, setMostrarNuevoCliente] = useState(false);
  const [nuevoClienteForm, setNuevoClienteForm] = useState({ nombre: '', cedula: '', telefono: '' });
  const [guardandoCliente, setGuardandoCliente] = useState(false);
  const inputRef = useRef(null);
  const scannerRef = useRef(null);
  const carritoSectionRef = useRef(null);
  const pendingScanRef = useRef(null);
  const scanToastTimeoutRef = useRef(null);

  // Guardar carrito en localStorage cuando cambie
  useEffect(() => {
    localStorage.setItem('carrito', JSON.stringify(carrito));
  }, [carrito]);

  // Guardar cliente en localStorage cuando cambie
  useEffect(() => {
    localStorage.setItem('cliente', JSON.stringify(cliente));
  }, [cliente]);

  // Autocomplete de clientes: buscar con debounce mientras se escribe el
  // nombre, salvo que ya haya un cliente seleccionado (el texto entonces
  // coincide con el cliente elegido y no hace falta volver a buscar).
  useEffect(() => {
    if (clienteSeleccionado) {
      setClienteResultados([]);
      setMostrarResultadosCliente(false);
      return;
    }

    const termino = cliente.nombre.trim();
    if (termino.length < 2) {
      setClienteResultados([]);
      setMostrarResultadosCliente(false);
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        setBuscandoCliente(true);
        const response = await api.get('/clientes', { params: { search: termino } });
        setClienteResultados(response.data);
        setMostrarResultadosCliente(true);
      } catch (error) {
        console.error('Error buscando clientes:', error);
      } finally {
        setBuscandoCliente(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [cliente.nombre, clienteSeleccionado]);

  // Mostrar un toast cuando un escaneo agrega/incrementa un producto en el
  // carrito, aunque la cámara siga abierta tapando el carrito-section.
  useEffect(() => {
    const pending = pendingScanRef.current;
    if (!pending) return;
    const item = carrito.find(i => i.producto_id === pending.id);
    if (!item) return;

    pendingScanRef.current = null;
    setScanToast({ nombre: pending.nombre, cantidad: item.cantidad });
    if (scanToastTimeoutRef.current) clearTimeout(scanToastTimeoutRef.current);
    scanToastTimeoutRef.current = setTimeout(() => setScanToast(null), 1800);
  }, [carrito]);

  useEffect(() => {
    return () => {
      if (scanToastTimeoutRef.current) clearTimeout(scanToastTimeoutRef.current);
    };
  }, []);

  // Cargar productos al iniciar o cambiar de módulo
  useEffect(() => {
    if (moduloActivo) {
      cargarProductos();
      // Limpiar carrito al cambiar de módulo (opcional)
      // setCarrito([]);
    }
    return () => {
      // Limpiar scanner al desmontar
      if (scannerRef.current) {
        scannerRef.current.stop().catch(err => console.log('Scanner stopped'));
      }
    };
  }, [moduloActivo]);

  const cargarProductos = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get('/productos');
      setProductos(response.data);
    } catch (error) {
      console.error('Error cargando productos:', error);
      setError('Error al cargar productos. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Buscar productos con debounce
  const buscarProductos = useCallback(async (termino) => {
    if (!termino || termino.length < 2) {
      cargarProductos();
      return;
    }
    
    try {
      setLoading(true);
      setError(null);
      const response = await api.get('/productos', {
        params: { search: termino }
      });
      setProductos(response.data);
    } catch (error) {
      console.error('Error buscando productos:', error);
      setError('Error al buscar productos');
    } finally {
      setLoading(false);
    }
  }, [cargarProductos]);

  // Buscar producto por EAN (scanner)
  const buscarPorEAN = useCallback(async (ean) => {
    if (!ean || ean.trim() === '') return;
    
    try {
      setError(null);
      const response = await api.get(`/productos/buscar/${ean.trim()}`);
      if (response.data) {
        agregarAlCarrito(response.data);
        // Marca este producto como "pendiente de confirmar" para el toast
        // del scanner; el useEffect sobre `carrito` dispara el toast en
        // cuanto el estado del carrito refleje el resultado del escaneo.
        pendingScanRef.current = { id: response.data.id, nombre: response.data.nombre };
        setBusqueda('');
        // Feedback visual
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.style.borderColor = '#48bb78';
          setTimeout(() => {
            inputRef.current.style.borderColor = '';
          }, 500);
        }
      }
    } catch (error) {
      if (error.response?.status === 404) {
        setError(`❌ Producto con código ${ean} no encontrado`);
        // Vibración (si está disponible)
        if (navigator.vibrate) navigator.vibrate(200);
      } else {
        console.error('Error buscando producto:', error);
        setError('Error al buscar el producto');
      }
    }
  }, []);

  // Manejar búsqueda con debounce
  const handleSearch = useCallback((e) => {
    const valor = e.target.value;
    setBusqueda(valor);
    
    if (modoScanner) {
      // En modo scanner, buscar al presionar Enter
      if (e.key === 'Enter' && valor) {
        buscarPorEAN(valor);
        e.preventDefault();
      }
    } else {
      // Búsqueda normal con debounce
      const timeoutId = setTimeout(() => {
        if (valor.length > 2 || valor.length === 0) {
          buscarProductos(valor);
        }
      }, 300);
      return () => clearTimeout(timeoutId);
    }
  }, [modoScanner, buscarPorEAN, buscarProductos]);

  // Cerrar scanner: detiene la cámara y deja el carrito visible de inmediato
  // (sin que el usuario tenga que buscar/scrollear para verlo).
  const cerrarScanner = useCallback(() => {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(err => console.log('Scanner stopped'));
      scannerRef.current = null;
    }
    setScannerActivo(false);
    setModoScanner(false);
    setScanToast(null);
    requestAnimationFrame(() => {
      carritoSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  // Iniciar escaneo con cámara
  const iniciarScanner = useCallback(() => {
    if (!modoScanner) {
      setModoScanner(true);
      return;
    }

    // Si ya está activo, desactivar
    if (scannerActivo) {
      cerrarScanner();
      return;
    }

    // Iniciar scanner. El elemento #scanner-container debe existir en el DOM
    // en este punto; si la instanciación falla, mostramos el mismo error que
    // el .catch() de abajo en vez de fallar silenciosamente.
    let html5QrCode;
    try {
      const contenedor = document.getElementById('scanner-container');
      if (!contenedor) {
        throw new Error('El contenedor del scanner no está disponible en el DOM');
      }
      html5QrCode = new Html5Qrcode('scanner-container');
    } catch (err) {
      console.error('Error iniciando scanner:', err);
      setError('❌ No se pudo acceder a la cámara. Verifica los permisos.');
      setModoScanner(false);
      return;
    }
    scannerRef.current = html5QrCode;

    const config = {
      fps: 10,
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0
    };

    html5QrCode.start(
      { facingMode: "environment" },
      config,
      (decodedText) => {
        // Éxito: código escaneado
        buscarPorEAN(decodedText);
        // Vibrar para feedback
        if (navigator.vibrate) navigator.vibrate(50);
        // Opcional: detener scanner después de escanear
        // html5QrCode.stop();
        // setScannerActivo(false);
        // setModoScanner(false);
      },
      (errorMessage) => {
        // Error al escanear (ignorar, es normal)
        // console.log('Error escaneando:', errorMessage);
      }
    ).then(() => {
      setScannerActivo(true);
    }).catch((err) => {
      console.error('Error iniciando scanner:', err);
      setError('❌ No se pudo acceder a la cámara. Verifica los permisos.');
      setModoScanner(false);
    });
  }, [modoScanner, scannerActivo, buscarPorEAN, cerrarScanner]);

  // Agregar al carrito
  const agregarAlCarrito = useCallback((producto) => {
    if (producto.stock_actual <= 0) {
      setError(`❌ "${producto.nombre}" no tiene stock disponible`);
      if (navigator.vibrate) navigator.vibrate(200);
      return;
    }

    setCarrito(prev => {
      const existe = prev.find(item => item.producto_id === producto.id);
      if (existe) {
        if (existe.cantidad >= producto.stock_actual) {
          setError(`⚠️ Stock insuficiente. Solo hay ${producto.stock_actual} unidades`);
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
        stock_actual: producto.stock_actual,
        codigo_ean: producto.codigo_ean
      }];
    });
    
    // Limpiar error si existe
    setError(null);
  }, []);

  // Eliminar del carrito
  const eliminarDelCarrito = useCallback((productoId) => {
    setCarrito(prev => prev.filter(item => item.producto_id !== productoId));
  }, []);

  // Cambiar cantidad
  const cambiarCantidad = useCallback((productoId, cantidad) => {
    if (cantidad < 1) {
      eliminarDelCarrito(productoId);
      return;
    }
    
    setCarrito(prev => {
      const producto = prev.find(item => item.producto_id === productoId);
      if (producto && cantidad > producto.stock_actual) {
        setError(`⚠️ Stock insuficiente. Solo hay ${producto.stock_actual} unidades`);
        return prev;
      }
      return prev.map(item =>
        item.producto_id === productoId
          ? { ...item, cantidad }
          : item
      );
    });
  }, [eliminarDelCarrito]);

  // Atajo de teclado: F1 para activar scanner, Escape para limpiar
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'F1') {
        e.preventDefault();
        iniciarScanner();
      }
      if (e.key === 'Escape') {
        setError(null);
      }
      if (e.key === 'F2' && carrito.length > 0) {
        e.preventDefault();
        procesarVenta();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [carrito]);

  // Calcular totales
  const subtotal = carrito.reduce((sum, item) => sum + (item.precio_unitario * item.cantidad), 0);

  // Procesar venta
  const procesarVenta = useCallback(async () => {
    if (carrito.length === 0) {
      setError('⚠️ El carrito está vacío');
      return;
    }

    if (!cliente.nombre && !cliente.documento) {
      if (!confirm('¿Continuar sin datos del cliente?')) {
        return;
      }
    }

    try {
      setLoading(true);
      setError(null);
      
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
        metodo_pago: metodoPago,
        ...(clienteSeleccionado && { cliente_id: clienteSeleccionado.id })
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
        setClienteSeleccionado(null);
        // Recargar productos para actualizar stock
        cargarProductos();

        // Feedback de éxito
        if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
      }
    } catch (error) {
      console.error('Error procesando venta:', error);
      setError(error.response?.data?.error || '❌ Error al procesar la venta');
      if (navigator.vibrate) navigator.vibrate(200);
    } finally {
      setLoading(false);
    }
  }, [carrito, cliente, metodoPago, clienteSeleccionado, cargarProductos]);

  // Limpiar todo
  const limpiarTodo = useCallback(() => {
    if (carrito.length > 0 && !confirm('¿Limpiar todo el carrito?')) return;
    setCarrito([]);
    setError(null);
    setBusqueda('');
  }, [carrito]);

  // Seleccionar un cliente existente del autocomplete
  const seleccionarCliente = useCallback((clienteEncontrado) => {
    setClienteSeleccionado(clienteEncontrado);
    setCliente(prev => ({
      ...prev,
      nombre: clienteEncontrado.nombre,
      documento: clienteEncontrado.cedula || ''
    }));
    setClienteResultados([]);
    setMostrarResultadosCliente(false);
  }, []);

  const quitarClienteSeleccionado = useCallback(() => {
    setClienteSeleccionado(null);
  }, []);

  const abrirNuevoCliente = useCallback(() => {
    setNuevoClienteForm({ nombre: cliente.nombre || '', cedula: '', telefono: '' });
    setMostrarNuevoCliente(true);
  }, [cliente.nombre]);

  // Registrar un cliente nuevo rápido desde el POS y seleccionarlo
  const crearClienteRapido = useCallback(async (e) => {
    e.preventDefault();
    if (!nuevoClienteForm.nombre.trim()) {
      setError('⚠️ El nombre del cliente es requerido');
      return;
    }

    try {
      setGuardandoCliente(true);
      const response = await api.post('/clientes', nuevoClienteForm);
      seleccionarCliente(response.data);
      setMostrarNuevoCliente(false);
      setNuevoClienteForm({ nombre: '', cedula: '', telefono: '' });
    } catch (error) {
      console.error('Error creando cliente:', error);
      setError(error.response?.data?.error || '❌ Error al registrar el cliente');
    } finally {
      setGuardandoCliente(false);
    }
  }, [nuevoClienteForm, seleccionarCliente]);

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
        <div className="header-left">
          <h2>🛒 Punto de Venta</h2>
          <div className="modulo-indicador">
            <span className="badge">📁 {moduloActivo.nombre}</span>
          </div>
        </div>
        <div className="header-right">
          <div className="shortcuts-hint">
            <kbd>F1</kbd> Scanner <kbd>F2</kbd> Vender <kbd>Esc</kbd> Limpiar
          </div>
          <button onClick={limpiarTodo} className="btn-limpiar-todo" title="Limpiar carrito">
            🗑️
          </button>
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
            placeholder={modoScanner ? "📷 Escanea un código..." : "🔍 Buscar por nombre o código..."}
            className={modoScanner ? 'scanner-active' : ''}
            autoFocus
          />
          <button
            onClick={iniciarScanner}
            className={`btn-scanner ${modoScanner ? 'active' : ''}`}
            title="Activar/Desactivar scanner (F1)"
          >
            {modoScanner ? '📷' : '📷'}
          </button>
          <button onClick={cargarProductos} className="btn-refresh" title="Recargar productos">
            🔄
          </button>
        </div>
        
        {error && (
          <div className="error-message">
            {error}
            <button onClick={() => setError(null)} className="btn-cerrar-error">✕</button>
          </div>
        )}

        {modoScanner && (
          <div className="scanner-info">
            💡 Modo scanner activo. Apunta la cámara al código de barras.
            {!scannerActivo && (
              <button onClick={iniciarScanner} className="btn-iniciar-camara">
                📷 Iniciar Cámara
              </button>
            )}
          </div>
        )}
      </div>

      {/* Contenedor del scanner: debe existir en el DOM (con dimensiones)
          antes de instanciar Html5Qrcode y llamar a .start(). Por eso se
          renderiza en cuanto modoScanner es true, no cuando scannerActivo. */}
      {modoScanner && (
        <div className="scanner-container-wrapper">
          {/* Resumen del carrito siempre visible mientras el scanner está
              activo, para no tener que cerrar la cámara para saber cómo va */}
          <div className="scanner-carrito-resumen">
            🛒 {carrito.length} items · ${subtotal.toLocaleString()}
          </div>
          <div id="scanner-container" className="scanner-container"></div>
          {scanToast && (
            <div className="scanner-toast">
              ✅ {scanToast.nombre} agregado (x{scanToast.cantidad})
            </div>
          )}
          {scannerActivo && (
            <button onClick={cerrarScanner} className="btn-cerrar-scanner">
              ✕ Cerrar Scanner
            </button>
          )}
        </div>
      )}

      <div className="ventas-grid">
        {/* Lista de productos */}
        <div className="productos-lista">
          <h3>
            Productos
            <span className="productos-count">({productos.length})</span>
          </h3>
          {loading ? (
            <div className="loading">Cargando productos...</div>
          ) : productos.length === 0 ? (
            <div className="sin-productos">
              <p>No hay productos disponibles</p>
              <button onClick={cargarProductos} className="btn-refresh">🔄 Recargar</button>
            </div>
          ) : (
            <div className="productos-grid">
              {productos.map(producto => (
                <div
                  key={producto.id}
                  className={`producto-card ${producto.stock_actual <= 0 ? 'agotado' : ''}`}
                  onClick={() => agregarAlCarrito(producto)}
                >
                  <div className="producto-info">
                    <h4>{producto.nombre}</h4>
                    <p className="producto-precio">${producto.precio_venta.toLocaleString()}</p>
                    <p className={`producto-stock ${producto.stock_actual <= producto.stock_minimo ? 'bajo' : ''}`}>
                      Stock: {producto.stock_actual}
                      {producto.stock_actual <= 0 && ' ❌'}
                    </p>
                    {producto.codigo_ean && (
                      <small className="producto-ean">📷 {producto.codigo_ean}</small>
                    )}
                  </div>
                  <button 
                    className="btn-agregar"
                    disabled={producto.stock_actual <= 0}
                  >
                    {producto.stock_actual > 0 ? '+' : '🚫'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Carrito */}
        <div className="carrito-section" ref={carritoSectionRef}>
          <h3>
            Carrito
            <span className="carrito-count">({carrito.length} items)</span>
          </h3>
          
          {/* Datos del cliente */}
          <div className="cliente-form">
            <div className="cliente-busqueda-wrapper">
              <input
                type="text"
                placeholder="Buscar o escribir nombre del cliente"
                value={cliente.nombre}
                onChange={(e) => {
                  if (clienteSeleccionado) setClienteSeleccionado(null);
                  setCliente({ ...cliente, nombre: e.target.value });
                }}
                className="cliente-input"
                autoComplete="off"
              />
              {clienteSeleccionado && (
                <span className="cliente-seleccionado-badge">
                  ✓ Cliente #{clienteSeleccionado.numero_cliente}
                  <button type="button" onClick={quitarClienteSeleccionado} title="Quitar cliente seleccionado">✕</button>
                </span>
              )}
              {mostrarResultadosCliente && !clienteSeleccionado && (
                <div className="cliente-resultados">
                  {buscandoCliente ? (
                    <div className="cliente-resultado-info">Buscando...</div>
                  ) : clienteResultados.length > 0 ? (
                    clienteResultados.map(c => (
                      <div key={c.id} className="cliente-resultado-item" onClick={() => seleccionarCliente(c)}>
                        <strong>{c.nombre}</strong>
                        {c.cedula && <span> · {c.cedula}</span>}
                      </div>
                    ))
                  ) : (
                    <div className="cliente-resultado-info">
                      Sin coincidencias.
                      <button type="button" onClick={abrirNuevoCliente} className="btn-registrar-cliente">
                        ➕ Registrar nuevo cliente
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <input
              type="text"
              placeholder="Documento"
              value={cliente.documento}
              onChange={(e) => setCliente({ ...cliente, documento: e.target.value })}
              className="cliente-input"
            />
          </div>

          {/* Lista del carrito */}
          <div className="carrito-lista">
            {carrito.length === 0 ? (
              <p className="carrito-vacio">🛒 El carrito está vacío</p>
            ) : (
              carrito.map(item => (
                <div key={item.producto_id} className="carrito-item">
                  <div className="item-info">
                    <span className="item-nombre">{item.nombre}</span>
                    <span className="item-precio">${item.precio_unitario.toLocaleString()}</span>
                  </div>
                  <div className="item-controls">
                    <button 
                      onClick={() => cambiarCantidad(item.producto_id, item.cantidad - 1)}
                      className="btn-cantidad"
                    >
                      −
                    </button>
                    <span className="item-cantidad">{item.cantidad}</span>
                    <button 
                      onClick={() => cambiarCantidad(item.producto_id, item.cantidad + 1)}
                      className="btn-cantidad"
                      disabled={item.cantidad >= item.stock_actual}
                    >
                      +
                    </button>
                    <button 
                      onClick={() => eliminarDelCarrito(item.producto_id)} 
                      className="btn-eliminar"
                      title="Eliminar del carrito"
                    >
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
                <span><strong>Total:</strong></span>
                <span><strong>${subtotal.toLocaleString()}</strong></span>
              </div>

              <div className="metodo-pago">
                <label>💳 Método de pago:</label>
                <select
                  value={metodoPago}
                  onChange={(e) => setMetodoPago(e.target.value)}
                >
                  <option value="efectivo">💵 Efectivo</option>
                  <option value="tarjeta">💳 Tarjeta</option>
                  <option value="transferencia">🏦 Transferencia</option>
                  <option value="otros">📱 Otros</option>
                </select>
              </div>

              <button
                onClick={procesarVenta}
                className="btn-procesar-venta"
                disabled={loading}
              >
                {loading ? '⏳ Procesando...' : '✅ Procesar Venta (F2)'}
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

      {/* Mini-modal para registrar un cliente nuevo desde el POS */}
      {mostrarNuevoCliente && (
        <div className="cliente-modal" onClick={() => setMostrarNuevoCliente(false)}>
          <div className="cliente-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="cliente-modal-header">
              <h3>➕ Registrar Cliente</h3>
              <button onClick={() => setMostrarNuevoCliente(false)}>✕</button>
            </div>

            <form onSubmit={crearClienteRapido}>
              <div className="cliente-form-group">
                <label>Nombre *</label>
                <input
                  type="text"
                  value={nuevoClienteForm.nombre}
                  onChange={(e) => setNuevoClienteForm({ ...nuevoClienteForm, nombre: e.target.value })}
                  placeholder="Nombre del cliente"
                  required
                />
              </div>
              <div className="cliente-form-group">
                <label>Cédula</label>
                <input
                  type="text"
                  value={nuevoClienteForm.cedula}
                  onChange={(e) => setNuevoClienteForm({ ...nuevoClienteForm, cedula: e.target.value })}
                  placeholder="Número de documento"
                />
              </div>
              <div className="cliente-form-group">
                <label>Teléfono</label>
                <input
                  type="tel"
                  value={nuevoClienteForm.telefono}
                  onChange={(e) => setNuevoClienteForm({ ...nuevoClienteForm, telefono: e.target.value })}
                  placeholder="Ej: 3101234567"
                />
              </div>

              <div className="cliente-form-actions">
                <button type="submit" className="btn-guardar-cliente" disabled={guardandoCliente}>
                  {guardandoCliente ? 'Guardando...' : '✅ Guardar'}
                </button>
                <button type="button" onClick={() => setMostrarNuevoCliente(false)} className="btn-cancelar-cliente">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Ventas;