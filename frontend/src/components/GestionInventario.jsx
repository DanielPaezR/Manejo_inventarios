import React, { useState, useEffect } from 'react';
import './GestionInventario.css';

const GestionInventario = ({ user }) => {
  const [productos, setProductos] = useState([]);
  const [movimientos, setMovimientos] = useState([]);
  const [productoSeleccionado, setProductoSeleccionado] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [costoUnitario, setCostoUnitario] = useState('');
  const [modo, setModo] = useState('agregar');
  const [mostrarModal, setMostrarModal] = useState(false);
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    cargarProductos();
    cargarMovimientos();
  }, []);

  const cargarProductos = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/productos', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setProductos(data);
      } else {
        console.error('Error cargando productos');
      }
    } catch (error) {
      console.error('Error cargando productos:', error);
    }
  };

  const cargarMovimientos = async () => {
    try {
      // Por ahora vacío hasta que implementemos la tabla de movimientos
      setMovimientos([]);
    } catch (error) {
      console.error('Error cargando movimientos:', error);
    }
  };

  const handleAgregarStock = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/inventario/agregar-stock', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          producto_id: productoSeleccionado,
          cantidad: parseInt(cantidad),
          motivo,
          costo_unitario: costoUnitario || null
        })
      });

      const data = await response.json();

      if (response.ok) {
        setMensaje('✅ Stock agregado correctamente');
        setMostrarModal(false);
        limpiarFormulario();
        cargarProductos();
        cargarMovimientos();
      } else {
        setMensaje(`❌ Error: ${data.error}`);
      }
    } catch (error) {
      setMensaje('❌ Error de conexión');
    }
  };

  const handleAjustarStock = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/inventario/ajustar-stock', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          producto_id: productoSeleccionado,
          nuevo_stock: parseInt(cantidad),
          motivo
        })
      });

      const data = await response.json();

      if (response.ok) {
        setMensaje('✅ Stock ajustado correctamente');
        setMostrarModal(false);
        limpiarFormulario();
        cargarProductos();
        cargarMovimientos();
      } else {
        setMensaje(`❌ Error: ${data.error}`);
      }
    } catch (error) {
      setMensaje('❌ Error de conexión');
    }
  };

  const limpiarFormulario = () => {
    setProductoSeleccionado('');
    setCantidad('');
    setMotivo('');
    setCostoUnitario('');
    setTimeout(() => setMensaje(''), 5000);
  };

  const productoActual = productos.find(p => p.id == productoSeleccionado);

  return (
    <div className="gestion-inventario">
      <div className="inventario-header">
        <h2>Gestión de Inventario</h2>
        {mensaje && <div className="mensaje-alerta">{mensaje}</div>}
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
          <div className="modal">
            <div className="modal-header">
              <h3>{modo === 'agregar' ? 'Agregar Stock' : 'Ajustar Stock'}</h3>
              <button onClick={() => setMostrarModal(false)}>×</button>
            </div>
            
            <form onSubmit={modo === 'agregar' ? handleAgregarStock : handleAjustarStock}>
              <div className="form-group">
                <label>Producto:</label>
                <select 
                  value={productoSeleccionado} 
                  onChange={(e) => setProductoSeleccionado(e.target.value)}
                  required
                >
                  <option value="">Seleccionar producto</option>
                  {productos.map(producto => (
                    <option key={producto.id} value={producto.id}>
                      {producto.nombre} (Stock actual: {producto.stock_actual})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>
                  {modo === 'agregar' ? 'Cantidad a agregar:' : 'Nuevo stock:'}
                </label>
                <input 
                  type="number" 
                  value={cantidad} 
                  onChange={(e) => setCantidad(e.target.value)}
                  min="1"
                  required
                />
              </div>

              {modo === 'agregar' && (
                <div className="form-group">
                  <label>Costo unitario (opcional):</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={costoUnitario} 
                    onChange={(e) => setCostoUnitario(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              )}

              <div className="form-group">
                <label>Motivo:</label>
                <textarea 
                  value={motivo} 
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ej: Compra a proveedor, Ajuste por inventario físico, etc."
                  required
                />
              </div>

              <div className="modal-actions">
                <button type="button" onClick={() => setMostrarModal(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
                  {modo === 'agregar' ? 'Agregar Stock' : 'Ajustar Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Información de productos con stock bajo */}
      <div className="stock-section">
        <h3>Productos con Stock Bajo</h3>
        <div className="productos-lista">
          {productos.filter(p => p.stock_actual <= p.stock_minimo).map(producto => (
            <div key={producto.id} className="producto-alerta">
              <span className="producto-nombre">{producto.nombre}</span>
              <span className="stock-info">
                Stock: <strong>{producto.stock_actual}</strong> / Mínimo: {producto.stock_minimo}
              </span>
            </div>
          ))}
          {productos.filter(p => p.stock_actual <= p.stock_minimo).length === 0 && (
            <p>✅ Todos los productos tienen stock suficiente</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default GestionInventario;