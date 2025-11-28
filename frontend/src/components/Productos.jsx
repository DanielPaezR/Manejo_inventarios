import React, { useState, useEffect } from 'react';
import api from '../services/api';
import './Productos.css';

const Productos = ({ user }) => {
  const [productos, setProductos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mensaje, setMensaje] = useState('');

  const [formData, setFormData] = useState({
    codigo_ean: '',
    nombre: '',
    descripcion: '',
    precio_compra: '',
    precio_venta: '',
    stock_actual: '',
    stock_minimo: '5',
    categoria_id: ''
  });

  useEffect(() => {
    cargarProductos();
    cargarCategorias();
  }, []);

  const cargarProductos = async () => {
    try {
      const response = await api.get('/productos');
      setProductos(response.data);
    } catch (error) {
      console.error('Error cargando productos:', error);
      setMensaje('❌ Error al cargar productos');
    }
  };

  const cargarCategorias = async () => {
    try {
      const response = await api.get('/categorias');
      setCategorias(response.data);
    } catch (error) {
      console.error('Error cargando categorías:', error);
    }
  };

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const resetForm = () => {
    setFormData({
      codigo_ean: '',
      nombre: '',
      descripcion: '',
      precio_compra: '',
      precio_venta: '',
      stock_actual: '',
      stock_minimo: '5',
      categoria_id: ''
    });
    setEditingProduct(null);
    setShowForm(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const productoData = {
        ...formData,
        precio_compra: parseFloat(formData.precio_compra) || 0,
        precio_venta: parseFloat(formData.precio_venta),
        stock_actual: parseInt(formData.stock_actual) || 0,
        stock_minimo: parseInt(formData.stock_minimo) || 5,
        categoria_id: formData.categoria_id || null
      };

      if (editingProduct) {
        // USAR PUT PARA ACTUALIZAR
        await api.put(`/productos/${editingProduct.id}`, productoData);
        setMensaje('✅ Producto actualizado correctamente');
      } else {
        await api.post('/productos', productoData);
        setMensaje('✅ Producto creado correctamente');
      }

      resetForm();
      cargarProductos();
    } catch (error) {
      console.error('Error guardando producto:', error);
      setMensaje('❌ Error al guardar el producto');
    } finally {
      setLoading(false);
      setTimeout(() => setMensaje(''), 5000);
    }
  };

  const handleEdit = (producto) => {
    setFormData({
      codigo_ean: producto.codigo_ean || '',
      nombre: producto.nombre || '',
      descripcion: producto.descripcion || '',
      precio_compra: producto.precio_compra || '',
      precio_venta: producto.precio_venta || '',
      stock_actual: producto.stock_actual || '',
      stock_minimo: producto.stock_minimo || '5',
      categoria_id: producto.categoria_id || ''
    });
    setEditingProduct(producto);
    setShowForm(true);
  };

  const handleDelete = async (productoId) => {
    if (!window.confirm('¿Estás seguro de que quieres eliminar este producto?')) {
      return;
    }

    try {
      await api.delete(`/productos/${productoId}`);
      setMensaje('✅ Producto eliminado correctamente');
      cargarProductos();
    } catch (error) {
      console.error('Error eliminando producto:', error);
      setMensaje('❌ Error al eliminar el producto');
    }
  };

  const getEstadoStock = (stock, minimo) => {
    if (stock === 0) return 'agotado';
    if (stock <= minimo) return 'bajo';
    return 'normal';
  };

  return (
    <div className="productos-container">
      <div className="productos-header">
        <h1>Gestión de Productos</h1>
        <button 
          onClick={() => setShowForm(true)}
          className="btn-primary"
        >
          ➕ Nuevo Producto
        </button>
      </div>

      {mensaje && <div className="mensaje">{mensaje}</div>}

      {/* Formulario de Producto */}
      {showForm && (
        <div className="form-overlay">
          <div className="form-container">
            <h2>{editingProduct ? 'Editar Producto' : 'Nuevo Producto'}</h2>
            
            <form onSubmit={handleSubmit}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Código EAN:</label>
                  <input
                    type="text"
                    name="codigo_ean"
                    value={formData.codigo_ean}
                    onChange={handleInputChange}
                    placeholder="1234567890123"
                    maxLength="13"
                  />
                </div>

                <div className="form-group">
                  <label>Nombre *:</label>
                  <input
                    type="text"
                    name="nombre"
                    value={formData.nombre}
                    onChange={handleInputChange}
                    required
                    placeholder="Nombre del producto"
                  />
                </div>

                <div className="form-group full-width">
                  <label>Descripción:</label>
                  <textarea
                    name="descripcion"
                    value={formData.descripcion}
                    onChange={handleInputChange}
                    placeholder="Descripción del producto"
                    rows="3"
                  />
                </div>

                <div className="form-group">
                  <label>Precio Compra:</label>
                  <input
                    type="number"
                    name="precio_compra"
                    value={formData.precio_compra}
                    onChange={handleInputChange}
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                  />
                </div>

                <div className="form-group">
                  <label>Precio Venta *:</label>
                  <input
                    type="number"
                    name="precio_venta"
                    value={formData.precio_venta}
                    onChange={handleInputChange}
                    required
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                  />
                </div>

                <div className="form-group">
                  <label>Stock Actual:</label>
                  <input
                    type="number"
                    name="stock_actual"
                    value={formData.stock_actual}
                    onChange={handleInputChange}
                    min="0"
                    placeholder="0"
                  />
                </div>

                <div className="form-group">
                  <label>Stock Mínimo:</label>
                  <input
                    type="number"
                    name="stock_minimo"
                    value={formData.stock_minimo}
                    onChange={handleInputChange}
                    min="0"
                    placeholder="5"
                  />
                </div>

                <div className="form-group">
                  <label>Categoría:</label>
                  <select
                    name="categoria_id"
                    value={formData.categoria_id}
                    onChange={handleInputChange}
                  >
                    <option value="">Seleccionar categoría</option>
                    {categorias.map(cat => (
                      <option key={cat.id} value={cat.id}>
                        {cat.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-actions">
                <button type="submit" disabled={loading} className="btn-primary">
                  {loading ? 'Guardando...' : (editingProduct ? 'Actualizar' : 'Crear')}
                </button>
                <button type="button" onClick={resetForm} className="btn-secondary">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Lista de Productos */}
      <div className="productos-grid">
        {productos.map(producto => (
          <div key={producto.id} className={`producto-card ${getEstadoStock(producto.stock_actual, producto.stock_minimo)}`}>
            <div className="producto-header">
              <h3>{producto.nombre}</h3>
              <span className={`stock-badge ${getEstadoStock(producto.stock_actual, producto.stock_minimo)}`}>
                {producto.stock_actual} unidades
              </span>
            </div>
            
            <div className="producto-info">
              <p><strong>EAN:</strong> {producto.codigo_ean || 'N/A'}</p>
              <p><strong>Categoría:</strong> {producto.categoria_nombre || 'General'}</p>
              <p><strong>Precio Venta:</strong> ${producto.precio_venta?.toLocaleString()}</p>
              {producto.precio_compra && (
                <p><strong>Precio Compra:</strong> ${producto.precio_compra?.toLocaleString()}</p>
              )}
              <p><strong>Stock Mínimo:</strong> {producto.stock_minimo}</p>
              {producto.descripcion && (
                <p><strong>Descripción:</strong> {producto.descripcion}</p>
              )}
            </div>

            <div className="producto-actions">
              <button 
                onClick={() => handleEdit(producto)}
                className="btn-edit"
              >
                ✏️ Editar
              </button>
              <button 
                onClick={() => handleDelete(producto.id)}
                className="btn-delete"
              >
                🗑️ Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>

      {productos.length === 0 && (
        <div className="empty-state">
          <p>No hay productos registrados</p>
          <button 
            onClick={() => setShowForm(true)}
            className="btn-primary"
          >
            ➕ Crear Primer Producto
          </button>
        </div>
      )}
    </div>
  );
};

export default Productos;