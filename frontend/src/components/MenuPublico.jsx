import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiPublico from '../services/apiPublico';
import { IconoHoja, obtenerColorPlaceholder } from '../utils/menuVisual';
import './MenuPublico.css';

// ============================================================
// Iconografía — SVG en línea, paths tal cual especificados en el
// diseño "Modernist". stroke="currentColor" para heredar el color del
// contenedor vía CSS `color`.
// IconoHoja y obtenerColorPlaceholder viven en utils/menuVisual.js porque
// la vista previa editable de PedidosCliente.jsx también los necesita.
// ============================================================
const IconoMontana = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M3 20l5.5-9.5L12 16l3-5L21 20H3z" />
  </svg>
);

const IconoGota = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 3s6.5 7.5 6.5 12A6.5 6.5 0 015.5 15C5.5 10.5 12 3 12 3z" />
  </svg>
);

const IconoEspiga = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 21V9" />
    <path d="M12 9c-2.2 0-4-1.8-4-4M12 9c2.2 0 4-1.8 4-4M12 14c-2.2 0-4-1.8-4-4M12 14c2.2 0 4-1.8 4-4" />
  </svg>
);

const IconoChevronAbajo = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const IconoChevronIzquierda = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

const IconoChevronDerecha = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

// Categoría -> ícono temático. Sin coincidencia, la hoja sirve de
// genérico por defecto (pedido explícito del diseño).
const obtenerIconoCategoria = (nombreCategoria) => {
  const n = (nombreCategoria || '').toLowerCase();
  if (n.includes('entrada')) return IconoHoja;
  if (n.includes('fuerte') || n.includes('principal') || n.includes('plato')) return IconoMontana;
  if (n.includes('bebida') || n.includes('trago') || n.includes('jugo') || n.includes('gaseosa')) return IconoGota;
  if (n.includes('postre') || n.includes('dulce')) return IconoEspiga;
  return IconoHoja;
};

const obtenerIniciales = (nombre) =>
  nombre.trim().split(/\s+/).slice(0, 2).map(palabra => palabra[0]).join('').toUpperCase();

// Productos con ignora_stock = true (se preparan al pedir, ej.
// "Preparados") no dependen de stock_actual — se les da un tope fijo
// razonable en el stepper en vez de dejarlo sin límite por error.
const TOPE_CANTIDAD_SIN_STOCK = 20;
const obtenerTopeCantidad = (producto) => (producto.ignora_stock ? TOPE_CANTIDAD_SIN_STOCK : producto.stock_actual);

// Compartido entre las tarjetas de categoría y las del carrusel de
// Novedades: mismo criterio de placeholder (sin foto_url o si falla al
// cargar) en los dos lugares.
const ImagenProducto = ({ producto, conError, onError }) => {
  const mostrarFoto = producto.foto_url && !conError;
  return mostrarFoto ? (
    <img src={producto.foto_url} alt={producto.nombre} onError={onError} />
  ) : (
    <div
      className="mp-imagen-placeholder"
      style={{ background: obtenerColorPlaceholder(producto.nombre) }}
    >
      {obtenerIniciales(producto.nombre)}
    </div>
  );
};

const Stepper = ({ cantidad, onRestar, onSumar, disabledSumar }) => (
  <div className="mp-stepper">
    <button type="button" onClick={onRestar} disabled={cantidad === 0} className="mp-stepper__btn" aria-label="Quitar uno">
      −
    </button>
    <span className="mp-stepper__cantidad">{cantidad}</span>
    <button type="button" onClick={onSumar} disabled={disabledSumar} className="mp-stepper__btn" aria-label="Agregar uno">
      +
    </button>
  </div>
);

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
  const [esDomicilio, setEsDomicilio] = useState(false);
  const [direccionEntrega, setDireccionEntrega] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState('');
  const [categoriasAbiertas, setCategoriasAbiertas] = useState(new Set());
  const [imagenesConError, setImagenesConError] = useState(new Set());
  const [heroImagenConError, setHeroImagenConError] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  // Recuerda qué categorías estaban abiertas antes de buscar, para
  // restaurarlas tal cual al borrar el texto (en vez de volver siempre al
  // estado por defecto, todas cerradas).
  const categoriasAntesDeBuscarRef = useRef(null);
  // Vista interna (NO una ruta nueva): 'menu' es la vitrina de productos,
  // 'checkout' es el resumen antes de generar el pedido. Tocar la barra
  // de carrito cambia esta vista; el carrito en sí no se pierde porque
  // sigue siendo el mismo estado `carrito` del componente.
  const [pantallaActiva, setPantallaActiva] = useState('menu');

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

  const toggleCategoria = (categoria) => {
    setCategoriasAbiertas(prev => {
      const copia = new Set(prev);
      if (copia.has(categoria)) {
        copia.delete(categoria);
      } else {
        copia.add(categoria);
      }
      return copia;
    });
  };

  const marcarImagenConError = (productoId) => {
    setImagenesConError(prev => new Set(prev).add(productoId));
  };

  // Al empezar a buscar (primer caracter) se guarda una copia de qué
  // categorías estaban abiertas, y se cierran todas (no importa mientras
  // se muestra la lista plana de resultados). Al borrar el texto de
  // búsqueda, se restauran tal cual estaban.
  const handleBusquedaChange = (valor) => {
    const empezabaVacia = busqueda.trim() === '';
    const quedaVacia = valor.trim() === '';

    if (empezabaVacia && !quedaVacia) {
      categoriasAntesDeBuscarRef.current = categoriasAbiertas;
    } else if (!empezabaVacia && quedaVacia && categoriasAntesDeBuscarRef.current) {
      setCategoriasAbiertas(categoriasAntesDeBuscarRef.current);
      categoriasAntesDeBuscarRef.current = null;
    }

    setBusqueda(valor);
  };

  const cambiarCantidad = (producto, delta) => {
    setCarrito(prev => {
      const actual = prev[producto.id] || 0;
      const nueva = Math.max(0, Math.min(obtenerTopeCantidad(producto), actual + delta));
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

  // El carrusel es un destacado adicional: un producto marcado como novedad
  // sigue apareciendo también en su categoría normal más abajo.
  const productosNovedad = productos.filter(p => p.es_novedad);

  // Búsqueda 100% en el cliente (ya se tienen todos los productos
  // cargados) por nombre y, si tiene, descripción.
  const busquedaNormalizada = busqueda.trim().toLowerCase();
  const buscando = busquedaNormalizada.length > 0;
  const productosFiltrados = buscando
    ? productos.filter(p =>
        p.nombre.toLowerCase().includes(busquedaNormalizada) ||
        (p.descripcion && p.descripcion.toLowerCase().includes(busquedaNormalizada))
      )
    : [];

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
    if (esDomicilio && !direccionEntrega.trim()) {
      setErrorEnvio('⚠️ Ingresa la dirección de entrega');
      return;
    }

    try {
      setEnviando(true);
      const response = await apiPublico.post(`/menu/${moduloId}/pedidos`, {
        mesa_nombre: mesaNombre.trim(),
        monto_recibido: montoRecibido ? Number(montoRecibido) : undefined,
        es_domicilio: esDomicilio,
        direccion_entrega: esDomicilio ? direccionEntrega.trim() : undefined,
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

  const hayItemsEnCarrito = itemsCarrito.length > 0;

  return (
    <div className={`menu-publico-container ${hayItemsEnCarrito && pantallaActiva === 'menu' ? 'menu-publico-container--con-cartbar' : ''}`}>
      {pantallaActiva === 'checkout' ? (
        <div className="mp-checkout">
          <button type="button" className="mp-volver" onClick={() => setPantallaActiva('menu')}>
            <IconoChevronIzquierda className="mp-volver__icono" />
            Volver al menú
          </button>

          <h1 className="mp-checkout__titulo">Tu pedido</h1>

          <div className="mp-card mp-resumen">
            {itemsCarrito.map(item => (
              <div key={item.producto.id} className="mp-resumen__fila">
                <span>{item.producto.nombre} × {item.cantidad}</span>
                <span>{formatearMoneda(item.cantidad * item.producto.precio_venta)}</span>
              </div>
            ))}
            <div className="mp-resumen__total">
              <span>Total</span>
              <span>{formatearMoneda(totalCarrito)}</span>
            </div>
          </div>

          <div className="mp-campos">
            <input
              type="text"
              placeholder="Mesa o tu nombre *"
              value={mesaNombre}
              onChange={(e) => setMesaNombre(e.target.value)}
              className="mp-input"
            />
            <input
              type="number"
              min="0"
              placeholder="¿Con qué billete vas a pagar? (opcional)"
              value={montoRecibido}
              onChange={(e) => setMontoRecibido(e.target.value)}
              className="mp-input"
            />

            <label className="mp-checkbox">
              <input
                type="checkbox"
                checked={esDomicilio}
                onChange={(e) => setEsDomicilio(e.target.checked)}
              />
              <span>🛵 Es domicilio (necesito que me lo lleven)</span>
            </label>

            {esDomicilio && (
              <input
                type="text"
                placeholder="Dirección de entrega *"
                value={direccionEntrega}
                onChange={(e) => setDireccionEntrega(e.target.value)}
                className="mp-input"
              />
            )}
          </div>

          {errorEnvio && <p className="mp-error">{errorEnvio}</p>}

          <button
            onClick={handleGenerarPedido}
            disabled={enviando}
            className="mp-btn mp-btn--primary mp-btn--full"
          >
            <IconoHoja className="mp-btn__icono" />
            {enviando ? 'Generando...' : 'Generar pedido'}
          </button>
        </div>
      ) : (
        <>
          <div
            className="mp-hero"
            style={(!modulo?.foto_portada_url || heroImagenConError) ? { background: obtenerColorPlaceholder(modulo?.nombre_publico || '') } : undefined}
          >
            {modulo?.foto_portada_url && !heroImagenConError && (
              <img
                src={modulo.foto_portada_url}
                alt=""
                className="mp-hero__foto"
                onError={() => setHeroImagenConError(true)}
              />
            )}
            <IconoMontana className="mp-hero__silueta" aria-hidden="true" stroke="rgba(255,255,255,.14)" strokeWidth="1.4" />
            <div className="mp-hero__overlay" />
            <div className="mp-hero__contenido">
              <span className="mp-hero__icono-wrap">
                <IconoHoja className="mp-hero__icono" />
              </span>
              <div>
                <h1 className="mp-hero__nombre">{modulo?.nombre_publico}</h1>
                <p className="mp-hero__tagline">{modulo?.negocio_nombre}</p>
              </div>
            </div>
          </div>

          <div className="mp-busqueda">
            <input
              type="text"
              value={busqueda}
              onChange={(e) => handleBusquedaChange(e.target.value)}
              placeholder="Buscar en el menú..."
              className="mp-busqueda__input"
            />
          </div>

          {buscando ? (
            productosFiltrados.length === 0 ? (
              <p className="menu-publico-sin-productos">No encontramos productos con ese nombre</p>
            ) : (
              <div className="mp-seccion mp-resultados-busqueda">
                {productosFiltrados.map(producto => {
                  const cantidad = carrito[producto.id] || 0;

                  return (
                    <div key={producto.id} className="mp-producto-card mp-producto-card--busqueda">
                      <div className="mp-producto-card__foto">
                        <ImagenProducto
                          producto={producto}
                          conError={imagenesConError.has(producto.id)}
                          onError={() => marcarImagenConError(producto.id)}
                        />
                      </div>
                      <div className="mp-producto-card__body">
                        {producto.categoria_nombre && (
                          <span className="mp-pill mp-pill--neutral mp-resultado-categoria">{producto.categoria_nombre}</span>
                        )}
                        <div className="mp-producto-card__fila">
                          <span className="mp-producto-card__nombre">{producto.nombre}</span>
                          <span className="mp-producto-card__precio">{formatearMoneda(producto.precio_venta)}</span>
                        </div>
                        {producto.descripcion && (
                          <p className="mp-producto-card__descripcion">{producto.descripcion}</p>
                        )}
                        <div className="mp-producto-card__stepper-fila">
                          <Stepper
                            cantidad={cantidad}
                            onRestar={() => cambiarCantidad(producto, -1)}
                            onSumar={() => cambiarCantidad(producto, 1)}
                            disabledSumar={cantidad >= obtenerTopeCantidad(producto)}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            <>
              {productosNovedad.length > 0 && (
                <div className="mp-seccion">
                  <h2 className="mp-seccion__titulo">Prueba lo nuevo</h2>
                  <div className="mp-novedades-carrusel">
                    {productosNovedad.map(producto => {
                      const cantidad = carrito[producto.id] || 0;
                      return (
                        <div key={producto.id} className="mp-novedad-card">
                          <div className="mp-novedad-card__foto">
                            <ImagenProducto
                              producto={producto}
                              conError={imagenesConError.has(producto.id)}
                              onError={() => marcarImagenConError(producto.id)}
                            />
                            <span className="mp-pill mp-pill--accent mp-novedad-card__badge">NUEVO</span>
                          </div>
                          <div className="mp-novedad-card__body">
                            <span className="mp-novedad-card__nombre">{producto.nombre}</span>
                            <span className="mp-novedad-card__precio">{formatearMoneda(producto.precio_venta)}</span>
                            <Stepper
                              cantidad={cantidad}
                              onRestar={() => cambiarCantidad(producto, -1)}
                              onSumar={() => cambiarCantidad(producto, 1)}
                              disabledSumar={cantidad >= obtenerTopeCantidad(producto)}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {productos.length === 0 ? (
                <p className="menu-publico-sin-productos">No hay productos disponibles en este momento</p>
              ) : (
                <div className="mp-seccion mp-categorias">
                  {Object.entries(productosPorCategoria).map(([categoria, items]) => {
                    const abierta = categoriasAbiertas.has(categoria);
                    const cantidadCategoria = items.reduce((sum, p) => sum + (carrito[p.id] || 0), 0);
                    const IconoCategoria = obtenerIconoCategoria(categoria);

                    return (
                      <div key={categoria} className="mp-categoria">
                        <button
                          type="button"
                          className="mp-categoria__header"
                          onClick={() => toggleCategoria(categoria)}
                          aria-expanded={abierta}
                        >
                          <span className="mp-categoria__icono">
                            <IconoCategoria />
                          </span>
                          <span className="mp-categoria__nombre">{categoria}</span>
                          {cantidadCategoria > 0 && (
                            <span className="mp-pill mp-pill--accent">{cantidadCategoria}</span>
                          )}
                          <span className={`mp-chevron ${abierta ? 'mp-chevron--open' : ''}`}>
                            <IconoChevronAbajo />
                          </span>
                        </button>

                        {abierta && (
                          <div className="mp-categoria__productos">
                            {items.map(producto => {
                              const cantidad = carrito[producto.id] || 0;

                              return (
                                <div key={producto.id} className="mp-producto-card">
                                  <div className="mp-producto-card__foto">
                                    <ImagenProducto
                                      producto={producto}
                                      conError={imagenesConError.has(producto.id)}
                                      onError={() => marcarImagenConError(producto.id)}
                                    />
                                  </div>
                                  <div className="mp-producto-card__body">
                                    <div className="mp-producto-card__fila">
                                      <span className="mp-producto-card__nombre">{producto.nombre}</span>
                                      <span className="mp-producto-card__precio">{formatearMoneda(producto.precio_venta)}</span>
                                    </div>
                                    {producto.descripcion && (
                                      <p className="mp-producto-card__descripcion">{producto.descripcion}</p>
                                    )}
                                    <div className="mp-producto-card__stepper-fila">
                                      <Stepper
                                        cantidad={cantidad}
                                        onRestar={() => cambiarCantidad(producto, -1)}
                                        onSumar={() => cambiarCantidad(producto, 1)}
                                        disabledSumar={cantidad >= obtenerTopeCantidad(producto)}
                                      />
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {hayItemsEnCarrito && (
            <button type="button" className="mp-cartbar" onClick={() => setPantallaActiva('checkout')}>
              <span className="mp-cartbar__resumen">
                {totalItems} item{totalItems !== 1 ? 's' : ''} · {formatearMoneda(totalCarrito)}
              </span>
              <span className="mp-cartbar__cta">
                Ver pedido
                <IconoChevronDerecha className="mp-cartbar__icono" />
              </span>
            </button>
          )}
        </>
      )}
    </div>
  );
};

export default MenuPublico;
