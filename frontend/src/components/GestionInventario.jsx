import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import './GestionInventario.css';

const GestionInventario = ({ user }) => {
  const { moduloActivo } = useModulo();
  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedProducto, setSelectedProducto] = useState(null);
  const [cantidad, setCantidad] = useState('');
  const [nuevoStock, setNuevoStock] = useState('');
  const [motivo, setMotivo] = useState('');
  const [tipoOperacion, setTipoOperacion] = useState('agregar'); // 'agregar' o 'ajustar'
  const [mensaje, setMensaje] = useState('');

  // Verificar permisos (solo admin)
  const puedeGestionar = user?.rol === 'admin' || user?.rol === 'super_admin';

  useEffect(() => {
    if (moduloActivo && puedeGestionar) {
      cargarProductos();
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

  const handleAgregarStock = async () => {
    if (!selectedProducto) {
      alert('Selecciona un producto');
      return;
    }

    if (!cantidad || parseInt(cantidad) <= 0) {
      alert('Ingresa una cantidad válida');
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
      alert(error.response?.data?.error || 'Error al agregar stock');
    } finally {
      setLoading(false);
    }
  };

  const handleAjustarStock = async () => {
    if (!selectedProducto) {
      alert('Selecciona un producto');
      return;
    }

    if (!nuevoStock || parseInt(nuevoStock) < 0) {
      alert('Ingresa un stock válido');
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
      alert(error.response?.data?.error || 'Error al ajustar stock');
    } finally {
      setLoading(false);
    }
  };

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
          <span className="badge">Módulo: {moduloActivo.nombre}</span>
        </div>
      </div>

      {mensaje && (
        <div className="mensaje-flotante exito">
          {mensaje}
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
                  <p><strong>Stock actual:</strong> {selectedProducto.stock_actual}</p>
                  <p><strong>Stock mínimo:</strong> {selectedProducto.stock_minimo}</p>
                  <p><strong>Precio compra:</strong> ${Number(selectedProducto.precio_compra).toLocaleString()}</p>
                  <p><strong>Precio venta:</strong> ${Number(selectedProducto.precio_venta).toLocaleString()}</p>
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
                {loading ? 'Procesando...' : '✅ Agregar Stock'}
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
                {loading ? 'Procesando...' : '✅ Ajustar Stock'}
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
                  </tr>
                </thead>
                <tbody>
                  {productos
                    .filter(p => p.stock_actual <= p.stock_minimo)
                    .map(producto => (
                      <tr key={producto.id} className="alerta-row">
                        <td>{producto.nombre}</td>
                        <td className="stock-critico">{producto.stock_actual}</td>
                        <td>{producto.stock_minimo}</td>
                        <td>
                          <span className={`estado-badge ${producto.stock_actual === 0 ? 'agotado' : 'bajo'}`}>
                            {producto.stock_actual === 0 ? 'Agotado' : 'Stock Bajo'}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : (
              <p className="sin-alertas">✅ Todos los productos tienen stock adecuado</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default GestionInventario;