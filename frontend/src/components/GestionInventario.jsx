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

  // ✅ URL del backend - CAMBIA ESTA URL POR LA DE TU BACKEND EN RAILWAY
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
      
      // ✅ USAR URL COMPLETA DEL BACKEND
      const response = await fetch(`${API_BASE_URL}/api/productos?search=${encodeURIComponent(ean)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('🔍 Response status:', response.status);
      console.log('🔍 Response URL:', `${API_BASE_URL}/api/productos?search=${encodeURIComponent(ean)}`);
      
      const responseText = await response.text();
      console.log('🔍 Response text (first 200 chars):', responseText.substring(0, 200));
      
      let productos = [];
      try {
        productos = JSON.parse(responseText);
      } catch (parseError) {
        console.error('❌ No se pudo parsear como JSON:', parseError);
        setMensaje('❌ El servidor está devolviendo HTML en lugar de JSON. Verifica la configuración de Railway.');
        return;
      }

      if (response.ok) {
        console.log('🔍 Productos encontrados:', productos);
        
        const productoExacto = productos.find(p => p.codigo_ean === ean);
        
        if (productoExacto) {
          setProductoEncontrado(productoExacto);
          setMensaje(`✅ Producto encontrado: ${productoExacto.nombre}`);
          setTimeout(() => {
            const cantidadInput = document.querySelector('input[type="number"]');
            if (cantidadInput) cantidadInput.focus();
          }, 100);
        } else if (productos.length > 0) {
          console.log('🔍 Productos disponibles:', productos.map(p => ({ nombre: p.nombre, ean: p.codigo_ean })));
          setProductoEncontrado(null);
          setMensaje(`❌ No hay coincidencia exacta. Productos similares: ${productos.length}`);
        } else {
          setProductoEncontrado(null);
          setMensaje('❌ No se encontró ningún producto');
        }
      } else {
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
      
      // ✅ USAR URL COMPLETA DEL BACKEND
      const response = await fetch(`${API_BASE_URL}/api/inventario/agregar-stock`, {
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

      const responseText = await response.text();
      console.log('📦 Response agregar stock:', responseText);

      try {
        const data = JSON.parse(responseText);

        if (response.ok) {
          setMensaje(`✅ Stock agregado: ${productoEncontrado.nombre} +${cantidad} unidades`);
          setMostrarModal(false);
          limpiarFormulario();
        } else {
          setMensaje(`❌ Error: ${data.error}`);
        }
      } catch (parseError) {
        console.error('❌ Error parseando respuesta:', parseError);
        setMensaje('❌ Error del servidor - respuesta no válida');
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
      
      // ✅ USAR URL COMPLETA DEL BACKEND
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

      const responseText = await response.text();
      console.log('📊 Response ajustar stock:', responseText);

      try {
        const data = JSON.parse(responseText);

        if (response.ok) {
          setMensaje(`✅ Stock ajustado: ${productoEncontrado.nombre} → ${cantidad} unidades`);
          setMostrarModal(false);
          limpiarFormulario();
        } else {
          setMensaje(`❌ Error: ${data.error}`);
        }
      } catch (parseError) {
        console.error('❌ Error parseando respuesta:', parseError);
        setMensaje('❌ Error del servidor - respuesta no válida');
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
        
        {/* Información de debugging */}
        <div className="debug-info">
          <small>🔗 Backend: {API_BASE_URL}</small>
        </div>
        
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

      <div className="quick-guide">
        <h3>⚠️ Configuración Requerida</h3>
        <div className="guide-steps">
          <div className="step">
            <strong>Problema Detectado</strong>
            <p>Railway está sirviendo el frontend en lugar del backend para las rutas /api/</p>
          </div>
          <div className="step">
            <strong>Solución 1 (Recomendada)</strong>
            <p>Configurar dos servicios separados en Railway: backend y frontend</p>
          </div>
          <div className="step">
            <strong>Solución 2 (Temporal)</strong>
            <p>Usar URL completa del backend: {API_BASE_URL}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GestionInventario;