import React, { useState, useEffect, useRef } from 'react';
import './GestionInventario.css';

const GestionInventario = ({ user }) => {
  const [codigoEAN, setCodigoEAN] = useState('');
  const [productoEncontrado, setProductoEncontrado] = useState(null);
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [costoUnitario, setCostoUnitario] = useState('');
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

  // Buscar producto por EAN
  const buscarProductoPorEAN = async (ean) => {
    if (!ean || ean.length < 3) {
      setProductoEncontrado(null);
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/productos?search=${ean}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const productos = await response.json();
        // Buscar por coincidencia exacta de EAN primero
        const productoExacto = productos.find(p => p.codigo_ean === ean);
        if (productoExacto) {
          setProductoEncontrado(productoExacto);
          setMensaje(`✅ Producto encontrado: ${productoExacto.nombre}`);
        } else if (productos.length > 0) {
          // Si no hay coincidencia exacta, usar el primero
          setProductoEncontrado(productos[0]);
          setMensaje(`⚠️ Producto similar: ${productos[0].nombre}`);
        } else {
          setProductoEncontrado(null);
          setMensaje('❌ No se encontró producto con ese código');
        }
      } else {
        setProductoEncontrado(null);
        setMensaje('❌ Error buscando producto');
      }
    } catch (error) {
      console.error('Error buscando producto:', error);
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
          motivo,
          costo_unitario: costoUnitario || null
        })
      });

      const data = await response.json();

      if (response.ok) {
        setMensaje(`✅ Stock agregado: ${productoEncontrado.nombre} +${cantidad} unidades`);
        setMostrarModal(false);
        limpiarFormulario();
      } else {
        setMensaje(`❌ Error: ${data.error}`);
      }
    } catch (error) {
      setMensaje('❌ Error de conexión');
    }
  };

  const handleAjustarStock = async (e) => {
    e.preventDefault();
    
    if (!productoEncontrado) {
      setMensaje('❌ Primero debe buscar un producto válido');
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
          motivo
        })
      });

      const data = await response.json();

      if (response.ok) {
        setMensaje(`✅ Stock ajustado: ${productoEncontrado.nombre} → ${cantidad} unidades`);
        setMostrarModal(false);
        limpiarFormulario();
      } else {
        setMensaje(`❌ Error: ${data.error}`);
      }
    } catch (error) {
      setMensaje('❌ Error de conexión');
    }
  };

  const limpiarFormulario = () => {
    setCodigoEAN('');
    setProductoEncontrado(null);
    setCantidad('');
    setMotivo('');
    setCostoUnitario('');
    setTimeout(() => setMensaje(''), 5000);
  };

  const handleEANChange = (e) => {
    const value = e.target.value;
    setCodigoEAN(value);
    
    // Buscar automáticamente cuando el EAN tenga 13 dígitos (EAN estándar)
    if (value.length === 13) {
      buscarProductoPorEAN(value);
    }
  };

  const handleEANKeyPress = (e) => {
    // Si presiona Enter, buscar producto
    if (e.key === 'Enter') {
      e.preventDefault();
      buscarProductoPorEAN(codigoEAN);
    }
  };

  return (
    <div className="gestion-inventario">
      <div className="inventario-header">
        <h2>📥 Gestión de Inventario</h2>
        {mensaje && <div className={`mensaje-alerta ${mensaje.includes('✅') ? 'success' : 'error'}`}>
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
                    placeholder="Escanear o ingresar código EAN..."
                    className="ean-input"
                    required
                  />
                  <button 
                    type="button" 
                    onClick={() => buscarProductoPorEAN(codigoEAN)}
                    className="search-btn"
                    disabled={loading}
                  >
                    {loading ? '🔍' : '🔍'}
                  </button>
                </div>
                <small>Presione Enter después de escanear o ingresar el código</small>
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
                />
              </div>

              {/* Costo unitario solo para agregar stock */}
              {modo === 'agregar' && (
                <div className="form-group">
                  <label>💰 Costo unitario (opcional):</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={costoUnitario} 
                    onChange={(e) => setCostoUnitario(e.target.value)}
                    placeholder="0.00"
                    disabled={!productoEncontrado}
                  />
                </div>
              )}

              {/* Motivo */}
              <div className="form-group">
                <label>📝 Motivo:</label>
                <textarea 
                  value={motivo} 
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder={
                    modo === 'agregar' 
                      ? "Ej: Compra a proveedor, Reabastecimiento, Devolución..." 
                      : "Ej: Ajuste por inventario físico, Corrección de stock, Pérdida..."
                  }
                  required
                  disabled={!productoEncontrado}
                />
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
                  disabled={!productoEncontrado || !cantidad || !motivo}
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
            <strong>1. Agregar Stock</strong>
            <p>Para reabastecimiento por compras a proveedores</p>
          </div>
          <div className="step">
            <strong>2. Ajustar Stock</strong>
            <p>Para correcciones después de inventario físico</p>
          </div>
          <div className="step">
            <strong>3. Escanear EAN</strong>
            <p>Use el lector de código de barras o ingrese manualmente</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GestionInventario;