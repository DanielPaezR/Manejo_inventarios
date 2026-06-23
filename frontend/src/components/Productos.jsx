import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import './Productos.css';

const Productos = ({ user }) => {
  const { moduloActivo } = useModulo();
  const [productos, setProductos] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editProducto, setEditProducto] = useState(null);
  const [formData, setFormData] = useState({
    codigo_ean: '',
    nombre: '',
    descripcion: '',
    precio_compra: '',
    precio_venta: '',
    stock_actual: '',
    stock_minimo: '',
    categoria_id: ''
  });

  // Cargar datos al iniciar o cambiar de módulo
  useEffect(() => {
    if (moduloActivo) {
      cargarProductos();
      cargarCategorias();
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

  const cargarCategorias = async () => {
    try {
      const response = await api.get('/categorias');
      setCategorias(response.data);
    } catch (error) {
      console.error('Error cargando categorías:', error);
    }
  };

  const buscarProductos = async () => {
    try {
      setLoading(true);
      const response = await api.get('/productos', {
        params: { search }
      });
      setProductos(response.data);
    } catch (error) {
      console.error('Error buscando productos:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      const data = {
        ...formData,
        precio_compra: parseFloat(formData.precio_compra) || 0,
        precio_venta: parseFloat(formData.precio_venta) || 0,
        stock_actual: parseInt(formData.stock_actual) || 0,
        stock_minimo: parseInt(formData.stock_minimo) || 5
      };

      if (editProducto) {
        await api.put(`/productos/${editProducto.id}`, data);
        alert('Producto actualizado correctamente');
      } else {
        await api.post('/productos', data);
        alert('Producto creado correctamente');
      }
      
      setShowModal(false);
      setEditProducto(null);
      setFormData({
        codigo_ean: '',
        nombre: '',
        descripcion: '',
        precio_compra: '',
        precio_venta: '',
        stock_actual: '',
        stock_minimo: '',
        categoria_id: ''
      });
      cargarProductos();
    } catch (error) {
      console.error('Error guardando producto:', error);
      alert(error.response?.data?.error || 'Error al guardar el producto');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Estás seguro de eliminar este producto?')) return;
    
    try {
      await api.delete(`/productos/${id}`);
      alert('Producto eliminado correctamente');
      cargarProductos();
    } catch (error) {
      console.error('Error eliminando producto:', error);
      alert('Error al eliminar el producto');
    }
  };

  const handleEdit = (producto) => {
    setEditProducto(producto);
    setFormData({
      codigo_ean: producto.codigo_ean || '',
      nombre: producto.nombre,
      descripcion: producto.descripcion || '',
      precio_compra: producto.precio_compra || '',
      precio_venta: producto.precio_venta || '',
      stock_actual: producto.stock_actual || '',
      stock_minimo: producto.stock_minimo || '',
      categoria_id: producto.categoria_id || ''
    });
    setShowModal(true);
  };

  // Verificar permisos
  const puedeEditar = user?.rol === 'admin' || user?.rol === 'super_admin';

  if (!moduloActivo) {
    return (
      <div className="productos-container">
        <div className="alert alert-warning">
          ⚠️ No hay módulo activo. Selecciona un módulo para ver los productos.
        </div>
      </div>
    );
  }

  return (
    <div className="productos-container">
      <div className="productos-header">
        <h2>📦 Gestión de Productos</h2>
        <div className="modulo-indicador">
          <span className="badge">Módulo: {moduloActivo.nombre}</span>
        </div>
      </div>

      <div className="productos-actions">
        <div className="search-box">
          <input
            type="text"
            placeholder="🔍 Buscar por nombre o código..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && buscarProductos()}
          />
          <button onClick={buscarProductos} className="btn-buscar">Buscar</button>
          <button onClick={cargarProductos} className="btn-limpiar">Limpiar</button>
        </div>
        
        {puedeEditar && (
          <button onClick={() => { setEditProducto(null); setFormData({ codigo_ean: '', nombre: '', descripcion: '', precio_compra: '', precio_venta: '', stock_actual: '', stock_minimo: '', categoria_id: '' }); setShowModal(true); }} className="btn-agregar">
            + Nuevo Producto
          </button>
        )}
      </div>

      {loading ? (
        <div className="loading">Cargando productos...</div>
      ) : (
        <div className="productos-table">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Categoría</th>
                <th>Stock</th>
                <th>Precio Compra</th>
                <th>Precio Venta</th>
                {puedeEditar && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {productos.map(producto => (
                <tr key={producto.id}>
                  <td>{producto.codigo_ean || 'N/A'}</td>
                  <td>{producto.nombre}</td>
                  <td>{producto.categoria_nombre || 'General'}</td>
                  <td className={producto.stock_actual <= producto.stock_minimo ? 'stock-bajo' : ''}>
                    {producto.stock_actual}
                    {producto.stock_actual <= producto.stock_minimo && ' ⚠️'}
                  </td>
                  <td>${Number(producto.precio_compra).toLocaleString()}</td>
                  <td>${Number(producto.precio_venta).toLocaleString()}</td>
                  {puedeEditar && (
                    <td>
                      <button onClick={() => handleEdit(producto)} className="btn-editar">✏️</button>
                      <button onClick={() => handleDelete(producto.id)} className="btn-eliminar">🗑️</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de producto */}
      {showModal && (
        <div className="modal" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editProducto ? 'Editar Producto' : 'Nuevo Producto'}</h3>
              <button onClick={() => setShowModal(false)}>✕</button>
            </div>
            
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label>Código EAN</label>
                  <input
                    type="text"
                    value={formData.codigo_ean}
                    onChange={(e) => setFormData({ ...formData, codigo_ean: e.target.value })}
                    placeholder="Código de barras"
                  />
                </div>
                <div className="form-group">
                  <label>Nombre *</label>
                  <input
                    type="text"
                    value={formData.nombre}
                    onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                    placeholder="Nombre del producto"
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Descripción</label>
                <textarea
                  value={formData.descripcion}
                  onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                  placeholder="Descripción del producto"
                  rows="2"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Precio Compra</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.precio_compra}
                    onChange={(e) => setFormData({ ...formData, precio_compra: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
                <div className="form-group">
                  <label>Precio Venta *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.precio_venta}
                    onChange={(e) => setFormData({ ...formData, precio_venta: e.target.value })}
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Stock Actual</label>
                  <input
                    type="number"
                    value={formData.stock_actual}
                    onChange={(e) => setFormData({ ...formData, stock_actual: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div className="form-group">
                  <label>Stock Mínimo</label>
                  <input
                    type="number"
                    value={formData.stock_minimo}
                    onChange={(e) => setFormData({ ...formData, stock_minimo: e.target.value })}
                    placeholder="5"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Categoría</label>
                <select
                  value={formData.categoria_id}
                  onChange={(e) => setFormData({ ...formData, categoria_id: e.target.value })}
                >
                  <option value="">Sin categoría</option>
                  {categorias.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.nombre}</option>
                  ))}
                </select>
              </div>

              <div className="form-actions">
                <button type="submit" className="btn-guardar">
                  {editProducto ? 'Actualizar' : 'Guardar'}
                </button>
                <button type="button" onClick={() => setShowModal(false)} className="btn-cancelar">
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

export default Productos;