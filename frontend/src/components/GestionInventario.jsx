import React, { useState, useEffect, useRef } from 'react';
import './GestionInventario.css';

const GestionInventario = ({ user }) => {
  const [codigoEAN, setCodigoEAN] = useState('');
  const [productoEncontrado, setProductoEncontrado] = useState(null);
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [modo, setModo] = useState('agregar');
  const [mostrarModal, setMostrarModal] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [loading, setLoading] = useState(false);
  const eanInputRef = useRef(null);

  useEffect(() => {
    if (mostrarModal && eanInputRef.current) {
      eanInputRef.current.focus();
    }
  }, [mostrarModal]);

  // Buscar producto por EAN - VERSIÓN SIMPLIFICADA
  const buscarProductoPorEAN = async (ean) => {
    if (!ean || ean.length < 3) {
      setProductoEncontrado(null);
      setMensaje('❌ Ingrese un código EAN válido');
      return;
    }

    setLoading(true);
    setMensaje('🔍 Buscando producto...');
    
    try {
      const token = localStorage.getItem('token');
      
      // ✅ USAR LA RUTA QUE SABEMOS QUE FUNCIONA
      const response = await fetch(`/api/productos?search=${encodeURIComponent(ean)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('🔍 Response status:', response.status);
      console.log('🔍 Response headers:', response.headers.get('content-type'));
      
      // Verificar si la respuesta es JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('El servidor no devolvió JSON');
      }
      
      if (response.ok) {
        const productos = await response.json();
        console.log('🔍 Productos encontrados:', productos);
        
        // Buscar coincidencia exacta por EAN
        const productoExacto = productos.find(p => p.codigo_ean === ean);
        
        if (productoExacto) {
          setProductoEncontrado(productoExacto);
          setMensaje(`✅ Producto encontrado: ${productoExacto.nombre}`);
          // Auto-focus en cantidad
          setTimeout(() => {
            const cantidadInput = document.querySelector('input[type="number"]');
            if (cantidadInput) cantidadInput.focus();
          }, 100);
        } else if (productos.length > 0) {
          // Mostrar el primer producto encontrado (puede ser por nombre)
          setProductoEncontrado(productos[0]);
          setMensaje(`⚠️ Producto similar: ${productos[0].nombre}`);
        } else {
          setProductoEncontrado(null);
          setMensaje('❌ No se encontró ningún producto con ese código');
        }
      } else {
        const errorText = await response.text();
        console.error('❌ Error response:', errorText);
        setMensaje('❌ Error del servidor al buscar producto');
      }
    } catch (error) {
      console.error('❌ Error buscando producto:', error);
      setProductoEncontrado(null);
      setMensaje('❌ Error de conexión: ' + error.message);
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

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/inventario/agregar-stock', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          producto_id: productoEncontrado.id,
          cantidad: parseInt(cantidad),
          motivo: motivo || (modo === 'agregar' ? 'Reabastecimiento' : 'Ajuste de inventario')
        })
      });

      // Verificar si es JSON
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();

        if (response.ok) {
          setMensaje(`✅ Stock agregado: ${productoEncontrado.nombre} +${cantidad} unidades`);
          setMostrarModal(false);
          limpiarFormulario();
        } else {
          setMensaje(`❌ Error: ${data.error}`);
        }
      } else {
        const errorText = await response.text();
        console.error('❌ Non-JSON response:', errorText);
        setMensaje('❌ Error del servidor');
      }
    } catch (error) {
      console.error('❌ Error:', error);
      setMensaje('❌ Error de conexión con el servidor');
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

    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/inventario/ajustar-stock', {
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

      // Verificar si es JSON
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();

        if (response.ok) {
          setMensaje(`✅ Stock ajustado: ${productoEncontrado.nombre} → ${cantidad} unidades`);
          setMostrarModal(false);
          limpiarFormulario();
        } else {
          setMensaje(`❌ Error: ${data.error}`);
        }
      } else {
        const errorText = await response.text();
        console.error('❌ Non-JSON response:', errorText);
        setMensaje('❌ Error del servidor');
      }
    } catch (error) {
      console.error('❌ Error:', error);
      setMensaje('❌ Error de conexión con el servidor');
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
    
    // Buscar automáticamente cuando el EAN tenga 13 dígitos
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

  return (
    <div className="gestion-inventario">
      <div className="inventario-header">
        <h2>📥 Gestión de Inventario</h2>
        {mensaje && <div className={`mensaje-alerta ${mensaje.includes('✅') ? 'success' : mensaje.includes('❌') ? 'error' : 'info'}`}>
          {mensaje}
        </div>}
        <div className="botones-accion">
          <button 
            className="btn btn-primary"
            onClick={() => { setModo('agregar'); setMostrarModal(true); }}
          >
            ➕ Agregar Stock
          </button>
          <button 
            className="btn btn-secondary"
            onClick={() => { setModo('ajustar'); setMostrarModal(true); }}
          >
            📊 Ajustar Stock
          </button>
        </div>
      </div>

      {/* Modal para agregar/ajustar stock */}
      {mostrarModal && (
        <div className="modal-overlay">
          <div className="modal inventario-modal">
            <div className="modal-header">
              <h3>{modo === 'agregar' ? '➕ Agregar Stock' : '📊 Ajustar Stock'}</h3>
              <button onClick={() => { setMostrarModal(false); limpiarFormulario(); }}>×</button>
            </div>
            
            <form onSubmit={modo === 'agregar' ? handleAgregarStock : handleAjustarStock}>
              {/* Búsqueda por EAN */}
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

              {/* Información del producto encontrado */}
              {productoEncontrado && (
                <div className="producto-info">
                  <div className="producto-card">
                    <h4>📦 Producto Encontrado</h4>
                    <div className="producto-details">
                      <strong>{productoEncontrado.nombre}</strong>
                      <div className="producto-meta">
                        <span>Código: {productoEncontrado.codigo_ean || 'N/A'}</span>
                        <span>Stock actual: <strong>{productoEncontrado.stock_actual}</strong></span>
                        {productoEncontrado.stock_minimo && (
                          <span>Mínimo: {productoEncontrado.stock_minimo}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Cantidad */}
              <div className="form-group">
                <label>
                  {modo === 'agregar' ? '📦 Cantidad a agregar:' : '🎯 Nuevo stock:'}
                </label>
                <input 
                  type="number" 
                  value={cantidad} 
                  onChange={(e) => setCantidad(e.target.value)}
                  min="1"
                  required
                  disabled={!productoEncontrado}
                  placeholder={modo === 'agregar' ? "Ej: 50" : "Ej: 100"}
                />
              </div>

              {/* Motivo - OPCIONAL */}
              <div className="form-group">
                <label>📝 Motivo (opcional):</label>
                <textarea 
                  value={motivo} 
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder={
                    modo === 'agregar' 
                      ? "Ej: Compra a proveedor, Reabastecimiento..." 
                      : "Ej: Ajuste por inventario físico, Corrección..."
                  }
                  disabled={!productoEncontrado}
                />
                <small>Dejar vacío para usar motivo por defecto</small>
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
                  className="btn-primary"
                  disabled={!productoEncontrado || !cantidad}
                >
                  {modo === 'agregar' ? 'Agregar Stock' : 'Ajustar Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Información de uso rápido */}
      <div className="quick-guide">
        <h3>💡 Guía Rápida</h3>
        <div className="guide-steps">
          <div className="step">
            <strong>1. Escanear EAN</strong>
            <p>Use el lector de código de barras (13 dígitos)</p>
          </div>
          <div className="step">
            <strong>2. Ingresar cantidad</strong>
            <p>Solo este campo es obligatorio</p>
          </div>
          <div className="step">
            <strong>3. Confirmar</strong>
            <p>El motivo es opcional</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GestionInventario;