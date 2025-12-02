import React, { useState, useEffect, useRef } from 'react';
import './GestionInventario.css';

const GestionInventario = ({ user }) => {
  const [codigoEAN, setCodigoEAN] = useState('');
  const [productoEncontrado, setProductoEncontrado] = useState(null);
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [tipoMovimiento, setTipoMovimiento] = useState('agregar'); // agregar, ajustar, devolucion
  const [mostrarModal, setMostrarModal] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [loading, setLoading] = useState(false);
  const [clienteInfo, setClienteInfo] = useState({
    nombre: '',
    documento: '',
    telefono: '',
    motivo_devolucion: ''
  });
  const eanInputRef = useRef(null);

  const API_BASE_URL = 'https://manejoinventarios-production.up.railway.app';

  useEffect(() => {
    if (mostrarModal && eanInputRef.current) {
      eanInputRef.current.focus();
    }
  }, [mostrarModal]);

  const buscarProductoPorEAN = async (ean) => {
    if (!ean) {
      setMensaje('❌ Ingrese un código EAN');
      return;
    }

    setLoading(true);
    setMensaje('🔍 Buscando producto...');
    
    try {
      const token = localStorage.getItem('token');
      
      const response = await fetch(`${API_BASE_URL}/api/productos?search=${encodeURIComponent(ean)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      let productos = [];
      try {
        const responseText = await response.text();
        productos = JSON.parse(responseText);
      } catch (parseError) {
        console.error('❌ Error parseando respuesta:', parseError);
        setMensaje('❌ Error del servidor');
        return;
      }

      if (response.ok) {
        const productoExacto = productos.find(p => p.codigo_ean === ean);
        
        if (productoExacto) {
          setProductoEncontrado(productoExacto);
          setMensaje(`✅ Producto encontrado: ${productoExacto.nombre}`);
          setTimeout(() => {
            const cantidadInput = document.querySelector('input[type="number"]');
            if (cantidadInput) cantidadInput.focus();
          }, 100);
        } else if (productos.length > 0) {
          setProductoEncontrado(null);
          setMensaje(`❌ No hay coincidencia exacta. Productos similares: ${productos.length}`);
        } else {
          setProductoEncontrado(null);
          setMensaje('❌ No se encontró ningún producto');
        }
      } else {
        setMensaje('❌ Error del servidor');
      }
    } catch (error) {
      console.error('❌ Error buscando producto:', error);
      setProductoEncontrado(null);
      setMensaje('❌ Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  const handleAgregarStock = async (e) => {
    e.preventDefault();
    
    if (!productoEncontrado) {
      setMensaje('❌ Primero debe buscar un producto válido');
      return;
    }

    if (!cantidad || cantidad < 1) {
      setMensaje('❌ Ingrese una cantidad válida');
      return;
    }

    setLoading(true);
    
    try {
      const token = localStorage.getItem('token');
      
      const response = await fetch(`${API_BASE_URL}/api/inventario/agregar-stock`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          producto_id: productoEncontrado.id,
          cantidad: parseInt(cantidad),
          motivo: motivo || 'Reabastecimiento'
        })
      });

      const data = await response.json();

      if (response.ok) {
        setMensaje(`✅ Stock agregado: ${productoEncontrado.nombre} +${cantidad} unidades`);
        // Actualizar el stock localmente
        setProductoEncontrado({
          ...productoEncontrado,
          stock_actual: productoEncontrado.stock_actual + parseInt(cantidad)
        });
        
        setTimeout(() => {
          setMostrarModal(false);
          limpiarFormulario();
        }, 2000);
      } else {
        setMensaje(`❌ Error: ${data.error}`);
      }
    } catch (error) {
      console.error('❌ Error:', error);
      setMensaje('❌ Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  const handleAjustarStock = async (e) => {
    e.preventDefault();
    
    if (!productoEncontrado) {
      setMensaje('❌ Primero debe buscar un producto válido');
      return;
    }

    if (!cantidad || cantidad < 0) {
      setMensaje('❌ Ingrese un stock válido');
      return;
    }

    setLoading(true);
    
    try {
      const token = localStorage.getItem('token');
      
      const response = await fetch(`${API_BASE_URL}/api/inventario/ajustar-stock`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          producto_id: productoEncontrado.id,
          nuevo_stock: parseInt(cantidad),
          motivo: motivo || 'Ajuste de inventario'
        })
      });

      const data = await response.json();

      if (response.ok) {
        setMensaje(`✅ Stock ajustado: ${productoEncontrado.nombre} → ${cantidad} unidades`);
        // Actualizar el stock localmente
        setProductoEncontrado({
          ...productoEncontrado,
          stock_actual: parseInt(cantidad)
        });
        
        setTimeout(() => {
          setMostrarModal(false);
          limpiarFormulario();
        }, 2000);
      } else {
        setMensaje(`❌ Error: ${data.error}`);
      }
    } catch (error) {
      console.error('❌ Error:', error);
      setMensaje('❌ Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  const handleDevolucion = async (e) => {
    e.preventDefault();
    
    if (!productoEncontrado) {
      setMensaje('❌ Primero debe buscar un producto válido');
      return;
    }

    if (!cantidad || cantidad < 1) {
      setMensaje('❌ Ingrese una cantidad válida');
      return;
    }

    if (!clienteInfo.nombre.trim()) {
      setMensaje('❌ Ingrese el nombre del cliente para la devolución');
      return;
    }

    setLoading(true);
    
    try {
      const token = localStorage.getItem('token');
      
      // PRIMERO: Agregar stock (devolución)
      const responseStock = await fetch(`${API_BASE_URL}/api/inventario/agregar-stock`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          producto_id: productoEncontrado.id,
          cantidad: parseInt(cantidad),
          motivo: `Devolución: ${clienteInfo.motivo_devolucion || 'Sin motivo especificado'}`
        })
      });

      const dataStock = await responseStock.json();

      if (!responseStock.ok) {
        throw new Error(dataStock.error || 'Error agregando stock');
      }

      // SEGUNDO: Crear venta negativa (devolución)
      const ventaData = {
        detalles: [{
          producto_id: productoEncontrado.id,
          producto_nombre: productoEncontrado.nombre,
          cantidad: parseInt(cantidad),
          precio_unitario: productoEncontrado.precio_venta,
          subtotal: productoEncontrado.precio_venta * parseInt(cantidad)
        }],
        cliente_nombre: clienteInfo.nombre,
        cliente_documento: clienteInfo.documento || '',
        cliente_telefono: clienteInfo.telefono || '',
        metodo_pago: 'devolucion',
        es_devolucion: true,
        motivo_devolucion: clienteInfo.motivo_devolucion || ''
      };

      const responseVenta = await fetch(`${API_BASE_URL}/api/ventas/devolucion`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(ventaData)
      });

      if (!responseVenta.ok) {
        const errorData = await responseVenta.json();
        throw new Error(errorData.error || 'Error registrando devolución');
      }

      setMensaje(`✅ Devolución registrada: ${productoEncontrado.nombre} +${cantidad} unidades`);
      
      // Actualizar el stock localmente
      setProductoEncontrado({
        ...productoEncontrado,
        stock_actual: productoEncontrado.stock_actual + parseInt(cantidad)
      });
      
      setTimeout(() => {
        setMostrarModal(false);
        limpiarFormulario();
        setClienteInfo({
          nombre: '',
          documento: '',
          telefono: '',
          motivo_devolucion: ''
        });
      }, 2000);

    } catch (error) {
      console.error('❌ Error en devolución:', error);
      setMensaje(`❌ Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const limpiarFormulario = () => {
    setCodigoEAN('');
    setProductoEncontrado(null);
    setCantidad('');
    setMotivo('');
    setTimeout(() => setMensaje(''), 5000);
  };

  const handleEANChange = (e) => {
    const value = e.target.value;
    setCodigoEAN(value);
    
    if (value.length === 13) {
      buscarProductoPorEAN(value);
    }
  };

  const handleEANKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      buscarProductoPorEAN(codigoEAN);
    }
  };

  const getTituloModal = () => {
    switch(tipoMovimiento) {
      case 'agregar': return '➕ Agregar Stock';
      case 'ajustar': return '📊 Ajustar Stock';
      case 'devolucion': return '↩️ Registrar Devolución';
      default: return '📦 Gestión de Inventario';
    }
  };

  const handleSubmit = (e) => {
    switch(tipoMovimiento) {
      case 'agregar': return handleAgregarStock(e);
      case 'ajustar': return handleAjustarStock(e);
      case 'devolucion': return handleDevolucion(e);
      default: e.preventDefault();
    }
  };

  return (
    <div className="gestion-inventario">
      <div className="inventario-header">
        <h2>📦 Gestión de Inventario</h2>
        
        {mensaje && <div className={`mensaje-alerta ${mensaje.includes('✅') ? 'success' : 'error'}`}>
          {mensaje}
        </div>}

        <div className="botones-accion">
          <button 
            className="btn btn-primary"
            onClick={() => { setTipoMovimiento('agregar'); setMostrarModal(true); }}
          >
            ➕ Agregar Stock
          </button>
          <button 
            className="btn btn-secondary"
            onClick={() => { setTipoMovimiento('ajustar'); setMostrarModal(true); }}
          >
            📊 Ajustar Stock
          </button>
          <button 
            className="btn btn-warning"
            onClick={() => { setTipoMovimiento('devolucion'); setMostrarModal(true); }}
          >
            ↩️ Registrar Devolución
          </button>
        </div>
      </div>

      {/* Modal para gestión de inventario */}
      {mostrarModal && (
        <div className="modal-overlay">
          <div className="modal inventario-modal">
            <div className="modal-header">
              <h3>{getTituloModal()}</h3>
              <button onClick={() => { setMostrarModal(false); limpiarFormulario(); }}>×</button>
            </div>
            
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>🔍 Código EAN:</label>
                <div className="ean-search-container">
                  <input 
                    ref={eanInputRef}
                    type="text" 
                    value={codigoEAN} 
                    onChange={handleEANChange}
                    onKeyPress={handleEANKeyPress}
                    placeholder="Escanear código EAN (13 dígitos)..."
                    className="ean-input"
                    required
                  />
                  <button 
                    type="button" 
                    onClick={() => buscarProductoPorEAN(codigoEAN)}
                    className="search-btn"
                    disabled={loading || !codigoEAN}
                  >
                    {loading ? '⏳' : '🔍'}
                  </button>
                </div>
                <small>Ingrese 13 dígitos o presione Enter después de escanear</small>
              </div>

              {productoEncontrado && (
                <div className="producto-info">
                  <div className="producto-card">
                    <h4>📦 Producto Encontrado</h4>
                    <div className="producto-details">
                      <strong>{productoEncontrado.nombre}</strong>
                      <div className="producto-meta">
                        <span>Código: {productoEncontrado.codigo_ean || 'N/A'}</span>
                        <span>Stock actual: <strong>{productoEncontrado.stock_actual}</strong></span>
                        <span>Precio: ${productoEncontrado.precio_venta?.toLocaleString() || '0'}</span>
                        {productoEncontrado.stock_minimo && (
                          <span>Mínimo: {productoEncontrado.stock_minimo}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="form-group">
                <label>
                  {tipoMovimiento === 'agregar' ? '📦 Cantidad a agregar:' : 
                   tipoMovimiento === 'ajustar' ? '🎯 Nuevo stock:' : 
                   '↩️ Cantidad devuelta:'}
                </label>
                <input 
                  type="number" 
                  value={cantidad} 
                  onChange={(e) => setCantidad(e.target.value)}
                  min={tipoMovimiento === 'devolucion' ? "1" : "0"}
                  required
                  disabled={!productoEncontrado}
                  placeholder={
                    tipoMovimiento === 'agregar' ? "Ej: 50" : 
                    tipoMovimiento === 'ajustar' ? "Ej: 100" : 
                    "Ej: 2"
                  }
                />
              </div>

              {tipoMovimiento === 'devolucion' && (
                <>
                  <div className="form-group">
                    <label>👤 Cliente (requerido):</label>
                    <input 
                      type="text" 
                      value={clienteInfo.nombre}
                      onChange={(e) => setClienteInfo({...clienteInfo, nombre: e.target.value})}
                      placeholder="Nombre del cliente"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>📄 Documento (opcional):</label>
                    <input 
                      type="text" 
                      value={clienteInfo.documento}
                      onChange={(e) => setClienteInfo({...clienteInfo, documento: e.target.value})}
                      placeholder="Número de documento"
                    />
                  </div>

                  <div className="form-group">
                    <label>📞 Teléfono (opcional):</label>
                    <input 
                      type="text" 
                      value={clienteInfo.telefono}
                      onChange={(e) => setClienteInfo({...clienteInfo, telefono: e.target.value})}
                      placeholder="Teléfono del cliente"
                    />
                  </div>
                </>
              )}

              <div className="form-group">
                <label>📝 {tipoMovimiento === 'devolucion' ? 'Motivo de devolución:' : 'Motivo (opcional):'}</label>
                <textarea 
                  value={tipoMovimiento === 'devolucion' ? clienteInfo.motivo_devolucion : motivo}
                  onChange={(e) => {
                    if (tipoMovimiento === 'devolucion') {
                      setClienteInfo({...clienteInfo, motivo_devolucion: e.target.value});
                    } else {
                      setMotivo(e.target.value);
                    }
                  }}
                  placeholder={
                    tipoMovimiento === 'agregar' 
                      ? "Ej: Compra a proveedor, Reabastecimiento..." 
                      : tipoMovimiento === 'ajustar'
                      ? "Ej: Ajuste por inventario físico, Corrección..."
                      : "Ej: Producto defectuoso, No le gustó, Talla incorrecta..."
                  }
                  disabled={!productoEncontrado}
                />
              </div>

              <div className="resumen-movimiento">
                {productoEncontrado && cantidad && (
                  <div className="resumen-card">
                    <h4>📋 Resumen del Movimiento</h4>
                    <p><strong>Producto:</strong> {productoEncontrado.nombre}</p>
                    <p><strong>Tipo:</strong> {getTituloModal()}</p>
                    {tipoMovimiento === 'agregar' && (
                      <p><strong>Stock resultante:</strong> {productoEncontrado.stock_actual} + {cantidad} = {productoEncontrado.stock_actual + parseInt(cantidad)}</p>
                    )}
                    {tipoMovimiento === 'ajustar' && (
                      <p><strong>Cambio:</strong> {productoEncontrado.stock_actual} → {cantidad} ({parseInt(cantidad) - productoEncontrado.stock_actual >= 0 ? '+' : ''}{parseInt(cantidad) - productoEncontrado.stock_actual})</p>
                    )}
                    {tipoMovimiento === 'devolucion' && (
                      <>
                        <p><strong>Cliente:</strong> {clienteInfo.nombre}</p>
                        <p><strong>Valor devuelto:</strong> ${(productoEncontrado.precio_venta * parseInt(cantidad)).toLocaleString()}</p>
                        <p><strong>Stock resultante:</strong> {productoEncontrado.stock_actual} + {cantidad} = {productoEncontrado.stock_actual + parseInt(cantidad)}</p>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button 
                  type="button" 
                  onClick={() => { setMostrarModal(false); limpiarFormulario(); }}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className={`btn-${tipoMovimiento === 'devolucion' ? 'warning' : 'primary'}`}
                  disabled={!productoEncontrado || !cantidad || loading}
                >
                  {loading ? 'Procesando...' : 
                   tipoMovimiento === 'agregar' ? 'Agregar Stock' : 
                   tipoMovimiento === 'ajustar' ? 'Ajustar Stock' : 
                   'Registrar Devolución'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default GestionInventario;