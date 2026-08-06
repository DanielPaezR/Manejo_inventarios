import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiPublico from '../services/apiPublico';
import './MenuPublico.css';

const MenuPublico = () => {
  const { moduloId } = useParams();
  const navigate = useNavigate();

  const [modulo, setModulo] = useState(null);
  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [carrito, setCarrito] = useState({}); // { [producto_id]: cantidad }
  const [mesaNombre, setMesaNombre] = useState('');
  const [montoRecibido, setMontoRecibido] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState('');

  const cargarMenu = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await apiPublico.get(`/menu/${moduloId}`);
      setModulo(response.data.modulo);
      setProductos(response.data.productos);
    } catch (err) {
      console.error('Error cargando menú:', err);
      setError(err.response?.data?.error || 'Este menú no está disponible en este momento');
    } finally {
      setLoading(false);
    }
  }, [moduloId]);

  useEffect(() => {
    cargarMenu();
  }, [cargarMenu]);

  const cambiarCantidad = (producto, delta) => {
    setCarrito(prev => {
      const actual = prev[producto.id] || 0;
      const nueva = Math.max(0, Math.min(producto.stock_actual, actual + delta));
      if (nueva === 0) {
        const copia = { ...prev };
        delete copia[producto.id];
        return copia;
      }
      return { ...prev, [producto.id]: nueva };
    });
  };

  const productosPorCategoria = productos.reduce((acc, producto) => {
    const categoria = producto.categoria_nombre || 'Otros';
    if (!acc[categoria]) acc[categoria] = [];
    acc[categoria].push(producto);
    return acc;
  }, {});

  const itemsCarrito = Object.entries(carrito).map(([productoId, cantidad]) => {
    const producto = productos.find(p => p.id === parseInt(productoId));
    return producto ? { producto, cantidad } : null;
  }).filter(Boolean);

  const totalItems = itemsCarrito.reduce((sum, item) => sum + item.cantidad, 0);
  const totalCarrito = itemsCarrito.reduce((sum, item) => sum + item.cantidad * Number(item.producto.precio_venta), 0);

  const handleGenerarPedido = async () => {
    setErrorEnvio('');

    if (!mesaNombre.trim()) {
      setErrorEnvio('⚠️ Ingresa tu nombre o el número de mesa');
      return;
    }
    if (itemsCarrito.length === 0) {
      setErrorEnvio('⚠️ Agrega al menos un producto');
      return;
    }

    try {
      setEnviando(true);
      const response = await apiPublico.post(`/menu/${moduloId}/pedidos`, {
        mesa_nombre: mesaNombre.trim(),
        monto_recibido: montoRecibido ? Number(montoRecibido) : undefined,
        items: itemsCarrito.map(item => ({
          producto_id: item.producto.id,
          cantidad: item.cantidad
        }))
      });

      navigate(`/menu/${moduloId}/pedido/${response.data.token_publico}`);
    } catch (err) {
      console.error('Error generando pedido:', err);
      setErrorEnvio(err.response?.data?.error || '❌ Error al generar el pedido');
    } finally {
      setEnviando(false);
    }
  };

  const formatearMoneda = (valor) => `$${Number(valor || 0).toLocaleString('es-CO')}`;

  if (loading) {
    return (
      <div className="menu-publico-container">
        <div className="menu-publico-loading">Cargando menú...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="menu-publico-container">
        <div className="menu-publico-error">⚠️ {error}</div>
      </div>
    );
  }

  return (
    <div className="menu-publico-container">
      <div className="menu-publico-header">
        <h1>🍽️ {modulo?.negocio_nombre}</h1>
        <p>{modulo?.nombre}</p>
      </div>

      {productos.length === 0 ? (
        <p className="menu-publico-sin-productos">No hay productos disponibles en este momento</p>
      ) : (
        <div className="menu-publico-lista">
          {Object.entries(productosPorCategoria).map(([categoria, items]) => (
            <div key={categoria} className="menu-categoria">
              <h2 className="menu-categoria-titulo">{categoria}</h2>
              {items.map(producto => {
                const cantidad = carrito[producto.id] || 0;
                return (
                  <div key={producto.id} className="menu-producto-item">
                    <div className="menu-producto-info">
                      <span className="menu-producto-nombre">{producto.nombre}</span>
                      {producto.descripcion && (
                        <span className="menu-producto-descripcion">{producto.descripcion}</span>
                      )}
                      <span className="menu-producto-precio">{formatearMoneda(producto.precio_venta)}</span>
                    </div>
                    <div className="menu-producto-stepper">
                      <button
                        onClick={() => cambiarCantidad(producto, -1)}
                        disabled={cantidad === 0}
                        className="btn-stepper"
                      >
                        −
                      </button>
                      <span className="menu-producto-cantidad">{cantidad}</span>
                      <button
                        onClick={() => cambiarCantidad(producto, 1)}
                        disabled={cantidad >= producto.stock_actual}
                        className="btn-stepper"
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {itemsCarrito.length > 0 && (
        <div className="menu-carrito-panel">
          <div className="menu-carrito-resumen">
            🛒 {totalItems} item{totalItems !== 1 ? 's' : ''} · {formatearMoneda(totalCarrito)}
          </div>

          <input
            type="text"
            placeholder="Mesa o tu nombre *"
            value={mesaNombre}
            onChange={(e) => setMesaNombre(e.target.value)}
            className="menu-carrito-input"
          />
          <input
            type="number"
            min="0"
            placeholder="¿Con qué billete vas a pagar? (opcional)"
            value={montoRecibido}
            onChange={(e) => setMontoRecibido(e.target.value)}
            className="menu-carrito-input"
          />

          {errorEnvio && <p className="menu-carrito-error">{errorEnvio}</p>}

          <button
            onClick={handleGenerarPedido}
            disabled={enviando}
            className="btn-generar-pedido"
          >
            {enviando ? 'Generando...' : '✅ Generar pedido'}
          </button>
        </div>
      )}
    </div>
  );
};

export default MenuPublico;
