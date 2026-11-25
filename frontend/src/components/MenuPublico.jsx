import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiPublico from '../services/apiPublico';
import { textosNegocio } from '../utils/tipoNegocio';
import { obtenerColorPlaceholder } from '../utils/menuVisual';
import SelectorDireccionMapa from './SelectorDireccionMapa';
import AsistenteMenu from './AsistenteMenu';
import MenuSellos, { guardarTelefonoSellos } from './MenuSellos';
import { leerMisPedidos, recordarPedido } from '../utils/etapaPedido';
import './MenuPublico.css';
import './MenuVitrina.css';

// ============================================================
// Menú / catálogo público ("vitrina"). Portada grande, barra fija con
// buscador y categorías que se marcan solas al bajar, cuadrícula de
// productos con fotos grandes, ficha del producto en una hoja que sube
// desde abajo, foto a pantalla completa y carrito flotante. El botón
// "atrás" del celular cierra la capa abierta en vez de salir del menú.
// Los estilos nuevos están en MenuVitrina.css (clases mv-*); MenuPublico.css
// se mantiene porque sus primitivos (mp-btn, mp-input...) los usa también
// la pantalla de confirmación del pedido.
// ============================================================

const Icono = {
  buscar: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>),
  cerrar: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>),
  bolsa: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 8h14l-1.2 11.2a2 2 0 01-2 1.8H8.2a2 2 0 01-2-1.8L5 8z" /><path d="M9 8V6a3 3 0 016 0v2" /></svg>),
  flechaAbajo: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 5v14M6 13l6 6 6-6" /></svg>),
  atras: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M15 18l-6-6 6-6" /></svg>),
  ampliar: (p) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>)
};

const TOPE_CANTIDAD_SIN_STOCK = 50;
const obtenerTopeCantidad = (producto) => (producto.ignora_stock ? TOPE_CANTIDAD_SIN_STOCK : producto.stock_actual);
const pesos = (valor) => `$${Math.round(Number(valor || 0)).toLocaleString('es-CO')}`;
const iniciales = (nombre) => nombre.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
const normalizar = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const idSeccion = (nombre) => `mv-cat-${normalizar(nombre).replace(/[^a-z0-9]+/g, '-')}`;
const reducirMovimiento = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Foto con brillo de espera mientras carga y aparición suave; si no hay
// foto o falla, un fondo de color con las iniciales.
const Foto = ({ producto, className = '' }) => {
  const [estado, setEstado] = useState(producto.foto_url ? 'cargando' : 'sin');
  if (estado === 'sin' || estado === 'error') {
    return (
      <div className={`mv-foto mv-foto--placeholder ${className}`} style={{ '--mv-ph': obtenerColorPlaceholder(producto.nombre) }}>
        <span>{iniciales(producto.nombre)}</span>
      </div>
    );
  }
  return (
    <div className={`mv-foto ${estado === 'cargando' ? 'mv-foto--cargando' : ''} ${className}`}>
      <img src={producto.foto_url} alt={producto.nombre} loading="lazy" decoding="async"
        onLoad={() => setEstado('lista')} onError={() => setEstado('error')} />
    </div>
  );
};

const Stepper = ({ cantidad, onRestar, onSumar, disabledSumar, grande = false }) => (
  <div className={`mv-stepper ${grande ? 'mv-stepper--grande' : ''}`}>
    <button type="button" onClick={onRestar} disabled={cantidad === 0} aria-label="Quitar uno">−</button>
    <span aria-live="polite">{cantidad}</span>
    <button type="button" onClick={onSumar} disabled={disabledSumar} aria-label="Agregar uno">+</button>
  </div>
);

// Tarjeta de la cuadrícula. Tocarla abre la ficha; el "+" agrega directo.
const TarjetaProducto = ({ producto, cantidad, onAbrir, onCambiar, destacada = false }) => {
  const tope = obtenerTopeCantidad(producto);
  const pocas = !producto.ignora_stock && producto.stock_actual <= 3;
  return (
    <article className={`mv-card ${destacada ? 'mv-card--destacada' : ''} ${cantidad > 0 ? 'mv-card--en-bolsa' : ''}`} data-revelar>
      <button type="button" className="mv-card__foto-btn" onClick={() => onAbrir(producto)} aria-label={`Ver ${producto.nombre}`}>
        <Foto producto={producto} />
        {producto.es_novedad && <span className="mv-badge mv-badge--nuevo">Nuevo</span>}
        {pocas && <span className="mv-badge mv-badge--pocas">{producto.stock_actual === 1 ? '¡Última unidad!' : `¡Últimas ${producto.stock_actual}!`}</span>}
        {cantidad > 0 && <span className="mv-card__cantidad">{cantidad}</span>}
      </button>
      <div className="mv-card__body" onClick={() => onAbrir(producto)}>
        <h3 className="mv-card__nombre">{producto.nombre}</h3>
        {producto.descripcion && <p className="mv-card__desc">{producto.descripcion}</p>}
      </div>
      <div className="mv-card__pie">
        <span className="mv-card__precio">{pesos(producto.precio_venta)}</span>
        {cantidad === 0 ? (
          <button type="button" className="mv-mas" onClick={() => onCambiar(producto, 1)} disabled={tope <= 0} aria-label={`Agregar ${producto.nombre}`}>+</button>
        ) : (
          <Stepper cantidad={cantidad} onRestar={() => onCambiar(producto, -1)} onSumar={() => onCambiar(producto, 1)} disabledSumar={cantidad >= tope} />
        )}
      </div>
    </article>
  );
};

// Tarjeta de promoción: collage de los productos (o su propia foto), precio
// especial, precio normal tachado y cuánto se ahorra.
const TarjetaPromo = ({ promo, cantidad, onCambiar }) => {
  const fotos = promo.foto_url ? [promo.foto_url] : promo.items.map(i => i.foto_url).filter(Boolean).slice(0, 4);
  return (
    <article className={`mv-card mv-promo ${cantidad > 0 ? 'mv-card--en-bolsa' : ''}`} data-revelar>
      <div className={`mv-promo__fotos mv-promo__fotos--${Math.min(fotos.length, 4)}`}>
        {fotos.length === 0 ? (
          <div className="mv-foto mv-foto--placeholder" style={{ '--mv-ph': obtenerColorPlaceholder(promo.nombre) }}><span>🎁</span></div>
        ) : fotos.map((url, i) => <img key={i} src={url} alt="" loading="lazy" />)}
        {promo.ahorro_pct > 0 && <span className="mv-promo__ahorro">-{promo.ahorro_pct}%</span>}
        {cantidad > 0 && <span className="mv-card__cantidad">{cantidad}</span>}
      </div>
      <div className="mv-card__body">
        <span className="mv-promo__etiqueta">Promoción</span>
        <h3 className="mv-card__nombre">{promo.nombre}</h3>
        <p className="mv-promo__items">{promo.items.map(i => `${i.cantidad > 1 ? `${i.cantidad} × ` : ''}${i.nombre}`).join(' + ')}</p>
      </div>
      <div className="mv-card__pie">
        <span className="mv-promo__precios">
          <span className="mv-card__precio">{pesos(promo.precio)}</span>
          {promo.ahorro > 0 && <s>{pesos(promo.precio_normal)}</s>}
        </span>
        {cantidad === 0 ? (
          <button type="button" className="mv-mas" onClick={() => onCambiar(promo, 1)} aria-label={`Agregar ${promo.nombre}`}>+</button>
        ) : (
          <Stepper cantidad={cantidad} onRestar={() => onCambiar(promo, -1)} onSumar={() => onCambiar(promo, 1)} disabledSumar={cantidad >= promo.disponibles} />
        )}
      </div>
    </article>
  );
};

const MenuPublico = () => {
  const { moduloId } = useParams();
  const navigate = useNavigate();

  const [modulo, setModulo] = useState(null);
  const [productos, setProductos] = useState([]);
  const [promociones, setPromociones] = useState([]);
  const [carritoPromos, setCarritoPromos] = useState({}); // { [promocion_id]: cantidad }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [carrito, setCarrito] = useState({}); // { [producto_id]: cantidad }
  const [mesaNombre, setMesaNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [montoRecibido, setMontoRecibido] = useState('');
  const [esDomicilio, setEsDomicilio] = useState(false);
  const [direccionEntrega, setDireccionEntrega] = useState('');
  const [ubicacionDomicilio, setUbicacionDomicilio] = useState(null);
  const [detalleDireccion, setDetalleDireccion] = useState('');

  // La dirección del último domicilio queda guardada en este celular: el
  // cliente que repite no tiene que volver a escribirla ni ubicarla.
  const claveDireccion = `menu_direccion_${moduloId}`;
  useEffect(() => {
    if (!esDomicilio || direccionEntrega || ubicacionDomicilio) return;
    try {
      const guardada = JSON.parse(localStorage.getItem(claveDireccion) || 'null');
      if (guardada?.direccion) {
        setDireccionEntrega(guardada.direccion);
        setDetalleDireccion(guardada.detalle || '');
        if (Number.isFinite(guardada.lat) && Number.isFinite(guardada.lng)) {
          setUbicacionDomicilio({ lat: guardada.lat, lng: guardada.lng, direccion: guardada.direccion });
        }
      }
    } catch { /* sin almacenamiento */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esDomicilio]);
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [heroConError, setHeroConError] = useState(false);
  const [categoriaActiva, setCategoriaActiva] = useState(null);
  const [navCompacta, setNavCompacta] = useState(false);
  // Capas que se abren encima del menú: ficha de producto, foto ampliada y
  // el pedido. Cada una agrega un paso al historial para que "atrás" la cierre.
  const [productoAbierto, setProductoAbierto] = useState(null);
  const [cantidadFicha, setCantidadFicha] = useState(1);
  const [fotoAmpliada, setFotoAmpliada] = useState(null);
  const [verPedido, setVerPedido] = useState(false);
  const [verSellos, setVerSellos] = useState(false);
  const [saltoBolsa, setSaltoBolsa] = useState(0);

  const heroRef = useRef(null);
  const chipsRef = useRef(null);
  const carruselRef = useRef(null);
  const textos = textosNegocio(modulo?.negocio_tipo);

  const cargarMenu = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await apiPublico.get(`/menu/${moduloId}`);
      setModulo(response.data.modulo);
      setProductos(response.data.productos);
      setPromociones(response.data.promociones || []);
    } catch (err) {
      console.error('Error cargando menú:', err);
      setError(err.response?.data?.error || 'Este catálogo no está disponible en este momento');
    } finally {
      setLoading(false);
    }
  }, [moduloId]);

  useEffect(() => { cargarMenu(); }, [cargarMenu]);

  useEffect(() => {
    if (modulo?.nombre_publico) document.title = modulo.nombre_publico;
  }, [modulo]);

  // ---------- Datos derivados ----------
  const categorias = useMemo(() => {
    const mapa = new Map();
    for (const p of productos) {
      const c = p.categoria_nombre || 'Otros';
      if (!mapa.has(c)) mapa.set(c, []);
      mapa.get(c).push(p);
    }
    return Array.from(mapa.entries());
  }, [productos]);
  const novedades = useMemo(() => productos.filter(p => p.es_novedad), [productos]);

  const q = normalizar(busqueda.trim());
  const buscando = q.length > 0;
  const resultados = useMemo(() => (buscando
    ? productos.filter(p => normalizar(p.nombre).includes(q) || normalizar(p.descripcion).includes(q) || normalizar(p.categoria_nombre).includes(q))
    : []), [buscando, productos, q]);

  const itemsCarrito = Object.entries(carrito).map(([id, cantidad]) => {
    const producto = productos.find(p => p.id === parseInt(id, 10));
    return producto ? { producto, cantidad } : null;
  }).filter(Boolean);
  const itemsPromos = Object.entries(carritoPromos).map(([id, cantidad]) => {
    const promo = promociones.find(p => p.id === parseInt(id, 10));
    return promo ? { promo, cantidad } : null;
  }).filter(Boolean);
  const totalItems = itemsCarrito.reduce((s, i) => s + i.cantidad, 0) + itemsPromos.reduce((s, i) => s + i.cantidad, 0);
  const totalCarrito = itemsCarrito.reduce((s, i) => s + i.cantidad * Number(i.producto.precio_venta), 0)
    + itemsPromos.reduce((s, i) => s + i.cantidad * i.promo.precio, 0);

  // ---------- Carrito ----------
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
    if (delta > 0) setSaltoBolsa(n => n + 1);
  };

  const cambiarPromo = (promo, delta) => {
    setCarritoPromos(prev => {
      const nueva = Math.max(0, Math.min(promo.disponibles, (prev[promo.id] || 0) + delta));
      const copia = { ...prev };
      if (nueva === 0) delete copia[promo.id];
      else copia[promo.id] = nueva;
      return copia;
    });
    if (delta > 0) setSaltoBolsa(n => n + 1);
  };

  const agregarDesdeFicha = () => {
    const p = productoAbierto;
    const actual = carrito[p.id] || 0;
    const nueva = Math.min(obtenerTopeCantidad(p), actual + cantidadFicha);
    setCarrito(prev => ({ ...prev, [p.id]: nueva }));
    setSaltoBolsa(n => n + 1);
    cerrarCapa();
  };

  // ---------- Capas + botón atrás ----------
  const capaAbierta = Boolean(productoAbierto || fotoAmpliada || verPedido || verSellos);
  const abrirCapa = (accion) => {
    window.history.pushState({ mvCapa: true }, '');
    accion();
  };
  const cerrarCapa = () => {
    if (window.history.state?.mvCapa) window.history.back();
    else { setFotoAmpliada(null); setProductoAbierto(null); setVerPedido(false); setVerSellos(false); }
  };
  useEffect(() => {
    const alVolver = () => {
      // Cierra la capa de más arriba primero.
      if (fotoAmpliada) setFotoAmpliada(null);
      else if (productoAbierto) setProductoAbierto(null);
      else if (verPedido) setVerPedido(false);
      else if (verSellos) setVerSellos(false);
    };
    window.addEventListener('popstate', alVolver);
    return () => window.removeEventListener('popstate', alVolver);
  }, [fotoAmpliada, productoAbierto, verPedido, verSellos]);

  useEffect(() => {
    document.body.style.overflow = capaAbierta ? 'hidden' : '';
    const conEscape = (e) => { if (e.key === 'Escape' && capaAbierta) cerrarCapa(); };
    window.addEventListener('keydown', conEscape);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', conEscape); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const abrirProducto = (producto) => abrirCapa(() => {
    setProductoAbierto(producto);
    setCantidadFicha(1);
  });

  // ---------- Efectos de scroll ----------
  // Profundidad de la portada y barra compacta cuando la portada sale.
  useEffect(() => {
    if (loading) return undefined;
    let pendiente = false;
    const alHacerScroll = () => {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(() => {
        pendiente = false;
        const alto = heroRef.current?.offsetHeight || 1;
        const y = window.scrollY;
        if (!reducirMovimiento()) heroRef.current?.style.setProperty('--mv-scroll', String(Math.min(y / alto, 1)));
        setNavCompacta(y > alto - 80);
      });
    };
    window.addEventListener('scroll', alHacerScroll, { passive: true });
    alHacerScroll();
    return () => window.removeEventListener('scroll', alHacerScroll);
  }, [loading]);

  // Categoría activa según la sección visible.
  useEffect(() => {
    if (loading || buscando) return undefined;
    const secciones = Array.from(document.querySelectorAll('[data-seccion]'));
    if (secciones.length === 0) return undefined;
    const observador = new IntersectionObserver((entradas) => {
      const visibles = entradas.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visibles[0]) setCategoriaActiva(visibles[0].target.dataset.seccion);
    }, { rootMargin: '-140px 0px -55% 0px' });
    secciones.forEach(s => observador.observe(s));
    return () => observador.disconnect();
  }, [loading, buscando, categorias]);

  // Mantiene visible el chip activo dentro de la barra.
  useEffect(() => {
    const chip = chipsRef.current?.querySelector('[data-activo="true"]');
    chip?.scrollIntoView({ behavior: reducirMovimiento() ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
  }, [categoriaActiva]);

  // Las tarjetas aparecen con animación al entrar en pantalla.
  useEffect(() => {
    if (loading) return undefined;
    const tarjetas = document.querySelectorAll('[data-revelar]:not(.mv-visible)');
    if (reducirMovimiento() || !('IntersectionObserver' in window)) {
      tarjetas.forEach(t => t.classList.add('mv-visible'));
      return undefined;
    }
    const observador = new IntersectionObserver((entradas) => {
      entradas.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('mv-visible');
          observador.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -40px 0px' });
    tarjetas.forEach(t => observador.observe(t));
    return () => observador.disconnect();
  });

  // Vitrina de "Lo nuevo": el producto del centro se ve grande y nítido; los
  // de los lados se achican y se desenfocan (como un perchero).
  useEffect(() => {
    const carrusel = carruselRef.current;
    if (!carrusel || reducirMovimiento()) return undefined;
    let pendiente = false;
    const actualizar = () => {
      pendiente = false;
      const centro = carrusel.scrollLeft + carrusel.clientWidth / 2;
      for (const tarjeta of carrusel.children) {
        const medio = tarjeta.offsetLeft + tarjeta.offsetWidth / 2;
        const distancia = Math.min(Math.abs(centro - medio) / tarjeta.offsetWidth, 1.5);
        tarjeta.style.setProperty('--mv-lejos', distancia.toFixed(3));
      }
    };
    const alMover = () => { if (!pendiente) { pendiente = true; requestAnimationFrame(actualizar); } };
    actualizar();
    carrusel.addEventListener('scroll', alMover, { passive: true });
    window.addEventListener('resize', alMover);
    return () => { carrusel.removeEventListener('scroll', alMover); window.removeEventListener('resize', alMover); };
  }, [loading, buscando, novedades.length]);

  const irASeccion = (nombre) => {
    setBusqueda('');
    setTimeout(() => {
      document.getElementById(idSeccion(nombre))?.scrollIntoView({ behavior: reducirMovimiento() ? 'auto' : 'smooth', block: 'start' });
    }, 0);
  };
  const irAlMenu = () => {
    document.getElementById('mv-inicio-menu')?.scrollIntoView({ behavior: reducirMovimiento() ? 'auto' : 'smooth' });
  };

  // ---------- Enviar pedido (misma lógica de siempre) ----------
  const handleGenerarPedido = async () => {
    setErrorEnvio('');
    if (!mesaNombre.trim()) return setErrorEnvio(`⚠️ ${textos.faltaNombrePedido}`);
    if (!telefono.trim()) return setErrorEnvio('⚠️ Ingresa tu número de teléfono');
    if (itemsCarrito.length === 0 && itemsPromos.length === 0) return setErrorEnvio('⚠️ Agrega al menos un producto');
    if (esDomicilio && !direccionEntrega.trim()) return setErrorEnvio('⚠️ Ingresa la dirección de entrega');
    if (esDomicilio && !ubicacionDomicilio) {
      return setErrorEnvio('⚠️ Marca en el mapa dónde te entregamos (usa tu ubicación o busca la dirección)');
    }
    const direccionCompleta = esDomicilio
      ? [direccionEntrega.trim(), detalleDireccion.trim()].filter(Boolean).join(' - ')
      : undefined;
    try {
      setEnviando(true);
      const response = await apiPublico.post(`/menu/${moduloId}/pedidos`, {
        mesa_nombre: mesaNombre.trim(),
        telefono: telefono.trim(),
        monto_recibido: montoRecibido ? Number(montoRecibido) : undefined,
        es_domicilio: esDomicilio,
        direccion_entrega: direccionCompleta,
        lat: esDomicilio ? ubicacionDomicilio.lat : undefined,
        lng: esDomicilio ? ubicacionDomicilio.lng : undefined,
        items: [
          ...itemsCarrito.map(item => ({ producto_id: item.producto.id, cantidad: item.cantidad })),
          ...itemsPromos.map(item => ({ promocion_id: item.promo.id, cantidad: item.cantidad }))
        ]
      });
      document.body.style.overflow = '';
      if (modulo?.sellos) guardarTelefonoSellos(telefono.replace(/\D/g, ''));
      recordarPedido(moduloId, response.data.token_publico);
      if (esDomicilio) {
        try {
          localStorage.setItem(claveDireccion, JSON.stringify({
            direccion: direccionEntrega.trim(), detalle: detalleDireccion.trim(),
            lat: ubicacionDomicilio.lat, lng: ubicacionDomicilio.lng
          }));
        } catch { /* sin almacenamiento */ }
      }
      navigate(`/menu/${moduloId}/pedido/${response.data.token_publico}`, { replace: true });
    } catch (err) {
      console.error('Error generando pedido:', err);
      setErrorEnvio(err.response?.data?.error || '❌ Error al generar el pedido');
    } finally {
      setEnviando(false);
    }
  };

  // ---------- Pantallas de carga / error ----------
  if (loading) {
    return (
      <div className="mv mv--cargando">
        <div className="mv-hero mv-hero--esqueleto" />
        <div className="mv-contenido">
          <div className="mv-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="mv-card mv-card--esqueleto mv-visible"><div className="mv-foto mv-foto--cargando" /><span /><span /></div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="mv mv-error">
        <div className="mv-error__caja">
          <span className="mv-error__icono" aria-hidden="true">😕</span>
          <h1>Uy, no pudimos abrir este {textos.menu}</h1>
          <p>{error}</p>
          <button type="button" className="mv-btn" onClick={cargarMenu}>Intentar de nuevo</button>
        </div>
      </div>
    );
  }

  const nombre = modulo?.nombre_publico || '';
  const colorMarca = obtenerColorPlaceholder(nombre);
  const conFoto = modulo?.foto_portada_url && !heroConError;
  const hayCarrito = totalItems > 0;
  // Hasta 12 fotos de productos (primero las novedades) para el mosaico.
  const fotosMosaico = [...novedades, ...productos.filter(p => !p.es_novedad)]
    .filter(p => p.foto_url).slice(0, 12).map(p => p.foto_url);
  const cantidadProductos = productos.length;

  const renderGrid = (lista) => (
    <div className="mv-grid">
      {lista.map(p => (
        <TarjetaProducto key={p.id} producto={p} cantidad={carrito[p.id] || 0} onAbrir={abrirProducto} onCambiar={cambiarCantidad} />
      ))}
    </div>
  );

  return (
    <div className={`mv ${hayCarrito ? 'mv--con-bolsa' : ''}`} style={{ '--mv-marca': colorMarca }}>
      {/* ================= Portada ================= */}
      <header ref={heroRef} className={`mv-hero ${conFoto ? '' : 'mv-hero--sin-foto'} ${!conFoto && fotosMosaico.length >= 3 ? 'mv-hero--mosaico' : ''}`}>
        <div className="mv-hero__fondo">
          {conFoto ? (
            <img src={modulo.foto_portada_url} alt="" onError={() => setHeroConError(true)} />
          ) : fotosMosaico.length >= 3 ? (
            // Sin portada: un mosaico de los propios productos que se desliza lento.
            <div className="mv-hero__mosaico" aria-hidden="true">
              {[0, 1, 2].map(col => {
                const fotos = fotosMosaico.filter((_, i) => i % 3 === col);
                return (
                  <div key={col} className={`mv-mosaico__col mv-mosaico__col--${col}`}>
                    {[...fotos, ...fotos].map((url, i) => <img key={i} src={url} alt="" loading="lazy" />)}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mv-hero__patron" aria-hidden="true">{iniciales(nombre || 'M')}</div>
          )}
        </div>
        <div className="mv-hero__velo" />
        <div className="mv-hero__contenido">
          {modulo?.negocio_nombre && modulo.negocio_nombre !== nombre && <span className="mv-hero__eyebrow">{modulo.negocio_nombre}</span>}
          <h1 className="mv-hero__nombre">{nombre}</h1>
          <div className="mv-hero__chips">
            <span className="mv-chip-hero">🛍️ {cantidadProductos} {cantidadProductos === 1 ? 'producto' : 'productos'}</span>
            {modulo?.tiene_domicilio && (
              <span className="mv-chip-hero">🛵 Domicilios{modulo.envio_costo !== null ? ` · ${modulo.envio_costo === 0 ? 'gratis' : pesos(modulo.envio_costo)}` : ''}</span>
            )}
            {modulo?.horario && <span className="mv-chip-hero">🕐 {modulo.horario}</span>}
            {modulo?.juegos_activos !== false && (
              <button type="button" className="mv-chip-hero mv-chip-hero--boton" onClick={() => navigate(`/menu/${moduloId}/juegos`)}>🎲 Juegos</button>
            )}
            {modulo?.sellos && (
              <button type="button" className="mv-chip-hero mv-chip-hero--boton" onClick={() => abrirCapa(() => setVerSellos(true))}>🎟️ Mis sellos</button>
            )}
            {leerMisPedidos(moduloId).length > 0 && (
              <button type="button" className="mv-chip-hero mv-chip-hero--boton" onClick={() => navigate(`/menu/${moduloId}/mis-pedidos`)}>📦 Mis pedidos</button>
            )}
          </div>
          <button type="button" className="mv-hero__cta" onClick={irAlMenu}>
            Ver el {textos.menu}
            <Icono.flechaAbajo className="mv-hero__cta-icono" />
          </button>
        </div>
      </header>

      {/* ================= Barra fija: buscador + categorías ================= */}
      <nav id="mv-inicio-menu" className={`mv-nav ${navCompacta ? 'mv-nav--compacta' : ''}`} aria-label={`Categorías del ${textos.menu}`}>
        <div className="mv-nav__fila">
          <span className="mv-nav__nombre" aria-hidden={!navCompacta}>{nombre}</span>
          <label className="mv-buscador">
            <Icono.buscar className="mv-buscador__icono" />
            <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
              placeholder={`Buscar en el ${textos.menu}...`} aria-label={`Buscar en el ${textos.menu}`} />
            {busqueda && (
              <button type="button" className="mv-buscador__limpiar" onClick={() => setBusqueda('')} aria-label="Borrar búsqueda">
                <Icono.cerrar />
              </button>
            )}
          </label>
        </div>
        {!buscando && categorias.length > 1 && (
          <div className="mv-chips" ref={chipsRef}>
            {promociones.length > 0 && (
              <button type="button" className="mv-chip mv-chip--promo" data-activo={categoriaActiva === 'Promociones'} onClick={() => irASeccion('Promociones')}>🔥 Promociones</button>
            )}
            {novedades.length > 0 && (
              <button type="button" className="mv-chip" data-activo={categoriaActiva === 'Lo nuevo'} onClick={() => irASeccion('Lo nuevo')}>✨ Lo nuevo</button>
            )}
            {categorias.map(([c, items]) => (
              <button key={c} type="button" className="mv-chip" data-activo={categoriaActiva === c} onClick={() => irASeccion(c)}>
                {c} <small>{items.length}</small>
              </button>
            ))}
          </div>
        )}
      </nav>

      {/* ================= Contenido ================= */}
      <main className="mv-contenido">
        {buscando ? (
          <section className="mv-seccion">
            <h2 className="mv-seccion__titulo">
              {resultados.length === 0 ? 'Sin resultados' : `${resultados.length} ${resultados.length === 1 ? 'resultado' : 'resultados'}`}
              <small>para “{busqueda.trim()}”</small>
            </h2>
            {resultados.length === 0 ? (
              <div className="mv-vacio">
                <span aria-hidden="true">🔎</span>
                <p>No encontramos nada con ese nombre. Prueba con otra palabra o explora las categorías.</p>
                <button type="button" className="mv-btn mv-btn--suave" onClick={() => setBusqueda('')}>Ver todo el {textos.menu}</button>
              </div>
            ) : renderGrid(resultados)}
          </section>
        ) : cantidadProductos === 0 && promociones.length === 0 ? (
          <div className="mv-vacio">
            <span aria-hidden="true">🧺</span>
            <p>No hay productos disponibles en este momento. Vuelve pronto.</p>
          </div>
        ) : (
          <>
            {promociones.length > 0 && (
              <section id={idSeccion('Promociones')} data-seccion="Promociones" className="mv-seccion">
                <h2 className="mv-seccion__titulo">🔥 Promociones <small>Combos a precio especial</small></h2>
                <div className="mv-grid mv-grid--promos">
                  {promociones.map(p => (
                    <TarjetaPromo key={p.id} promo={p} cantidad={carritoPromos[p.id] || 0} onCambiar={cambiarPromo} />
                  ))}
                </div>
              </section>
            )}
            {novedades.length > 0 && (
              <section id={idSeccion('Lo nuevo')} data-seccion="Lo nuevo" className="mv-seccion">
                <h2 className="mv-seccion__titulo">✨ Lo nuevo <small>Recién llegado</small></h2>
                <div className="mv-carrusel" ref={carruselRef}>
                  {novedades.map(p => (
                    <TarjetaProducto key={p.id} producto={p} cantidad={carrito[p.id] || 0} onAbrir={abrirProducto} onCambiar={cambiarCantidad} destacada />
                  ))}
                </div>
              </section>
            )}
            {categorias.map(([c, items]) => (
              <section key={c} id={idSeccion(c)} data-seccion={c} className="mv-seccion">
                <h2 className="mv-seccion__titulo">{c} <small>{items.length} {items.length === 1 ? 'producto' : 'productos'}</small></h2>
                {renderGrid(items)}
              </section>
            ))}
          </>
        )}

        <footer className="mv-pie">
          <strong>{nombre}</strong>
          {modulo?.horario && <span>🕐 {modulo.horario}</span>}
          <small>Haz tu pedido aquí y te avisamos cuando esté listo.</small>
          {leerMisPedidos(moduloId).length > 0 && (
            <button type="button" className="mv-btn mv-btn--suave mv-pie__juegos" onClick={() => navigate(`/menu/${moduloId}/mis-pedidos`)}>
              📦 Ver mis pedidos y en qué van
            </button>
          )}
          {modulo?.sellos && (
            <button type="button" className="mv-btn mv-btn--suave mv-pie__juegos" onClick={() => abrirCapa(() => setVerSellos(true))}>
              🎟️ Junta {modulo.sellos.meta} sellos y gana {modulo.sellos.premio}
            </button>
          )}
          {modulo?.juegos_activos !== false && (
            <button type="button" className="mv-btn mv-btn--suave mv-pie__juegos" onClick={() => navigate(`/menu/${moduloId}/juegos`)}>
              🎲 ¿Un rato libre? Entra a la zona de juegos
            </button>
          )}
        </footer>
      </main>

      {/* ================= Bolsa flotante ================= */}
      {hayCarrito && !verPedido && (
        <button type="button" key={saltoBolsa} className="mv-bolsa" onClick={() => abrirCapa(() => setVerPedido(true))}>
          <span className="mv-bolsa__icono"><Icono.bolsa /><b>{totalItems}</b></span>
          <span className="mv-bolsa__texto">Ver pedido</span>
          <span className="mv-bolsa__total">{pesos(totalCarrito)}</span>
        </button>
      )}

      {/* ================= Ficha del producto ================= */}
      {productoAbierto && (
        <div className="mv-capa" onClick={cerrarCapa}>
          <div className="mv-hoja mv-ficha" role="dialog" aria-modal="true" aria-label={productoAbierto.nombre} onClick={(e) => e.stopPropagation()}>
            <span className="mv-hoja__agarre" aria-hidden="true" />
            <button type="button" className="mv-cerrar" onClick={cerrarCapa} aria-label="Cerrar"><Icono.cerrar /></button>
            <button type="button" className="mv-ficha__foto" onClick={() => productoAbierto.foto_url && abrirCapa(() => setFotoAmpliada(productoAbierto))}
              aria-label={productoAbierto.foto_url ? 'Ver foto en grande' : undefined} disabled={!productoAbierto.foto_url}>
              <Foto producto={productoAbierto} />
              {productoAbierto.foto_url && <span className="mv-ficha__ampliar"><Icono.ampliar /> Ampliar</span>}
            </button>
            <div className="mv-ficha__info">
              {productoAbierto.categoria_nombre && <span className="mv-ficha__categoria">{productoAbierto.categoria_nombre}</span>}
              <h2>{productoAbierto.nombre}</h2>
              <span className="mv-ficha__precio">{pesos(productoAbierto.precio_venta)}</span>
              {productoAbierto.descripcion && <p>{productoAbierto.descripcion}</p>}
              {!productoAbierto.ignora_stock && productoAbierto.stock_actual <= 3 && (
                <p className="mv-ficha__aviso">Quedan pocas unidades: {productoAbierto.stock_actual}.</p>
              )}
              {(carrito[productoAbierto.id] || 0) > 0 && (
                <p className="mv-ficha__ya">Ya tienes {carrito[productoAbierto.id]} en tu pedido.</p>
              )}
            </div>
            <div className="mv-ficha__acciones">
              <Stepper grande cantidad={cantidadFicha}
                onRestar={() => setCantidadFicha(c => Math.max(1, c - 1))}
                onSumar={() => setCantidadFicha(c => Math.min(obtenerTopeCantidad(productoAbierto) - (carrito[productoAbierto.id] || 0), c + 1))}
                disabledSumar={cantidadFicha >= obtenerTopeCantidad(productoAbierto) - (carrito[productoAbierto.id] || 0)} />
              <button type="button" className="mv-btn mv-btn--grande" onClick={agregarDesdeFicha}
                disabled={(carrito[productoAbierto.id] || 0) >= obtenerTopeCantidad(productoAbierto)}>
                Agregar · {pesos(cantidadFicha * productoAbierto.precio_venta)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= Foto a pantalla completa ================= */}
      {fotoAmpliada && (
        <div className="mv-visor" onClick={cerrarCapa} role="dialog" aria-modal="true" aria-label={`Foto de ${fotoAmpliada.nombre}`}>
          <button type="button" className="mv-cerrar mv-cerrar--claro" onClick={cerrarCapa} aria-label="Cerrar"><Icono.cerrar /></button>
          <img src={fotoAmpliada.foto_url} alt={fotoAmpliada.nombre} onClick={(e) => e.stopPropagation()} />
          <span className="mv-visor__nombre">{fotoAmpliada.nombre} · {pesos(fotoAmpliada.precio_venta)}</span>
        </div>
      )}

      {/* ================= Tu pedido ================= */}
      {verPedido && (
        <div className="mv-capa" onClick={cerrarCapa}>
          <div className="mv-hoja mv-pedido" role="dialog" aria-modal="true" aria-label="Tu pedido" onClick={(e) => e.stopPropagation()}>
            <span className="mv-hoja__agarre" aria-hidden="true" />
            <div className="mv-pedido__cabecera">
              <button type="button" className="mv-atras" onClick={cerrarCapa}><Icono.atras /> Seguir viendo</button>
              <h2>Tu pedido</h2>
            </div>

            <div className="mv-pedido__scroll">
              {itemsCarrito.length === 0 && itemsPromos.length === 0 ? (
                <div className="mv-vacio">
                  <span aria-hidden="true">🛍️</span>
                  <p>Tu pedido está vacío.</p>
                </div>
              ) : (
                <ul className="mv-lista">
                  {itemsPromos.map(({ promo, cantidad }) => (
                    <li key={`promo-${promo.id}`} className="mv-lista__item">
                      <div className="mv-foto mv-foto--placeholder mv-lista__foto" style={{ '--mv-ph': obtenerColorPlaceholder(promo.nombre) }}><span>🎁</span></div>
                      <div className="mv-lista__info">
                        <span>{promo.nombre}</span>
                        <small>{promo.items.map(i => `${i.cantidad > 1 ? `${i.cantidad} × ` : ''}${i.nombre}`).join(' + ')}</small>
                      </div>
                      <div className="mv-lista__lado">
                        <b>{pesos(cantidad * promo.precio)}</b>
                        <Stepper cantidad={cantidad} onRestar={() => cambiarPromo(promo, -1)} onSumar={() => cambiarPromo(promo, 1)} disabledSumar={cantidad >= promo.disponibles} />
                      </div>
                    </li>
                  ))}
                  {itemsCarrito.map(({ producto, cantidad }) => (
                    <li key={producto.id} className="mv-lista__item">
                      <Foto producto={producto} className="mv-lista__foto" />
                      <div className="mv-lista__info">
                        <span>{producto.nombre}</span>
                        <small>{pesos(producto.precio_venta)} c/u</small>
                      </div>
                      <div className="mv-lista__lado">
                        <b>{pesos(cantidad * producto.precio_venta)}</b>
                        <Stepper cantidad={cantidad} onRestar={() => cambiarCantidad(producto, -1)} onSumar={() => cambiarCantidad(producto, 1)}
                          disabledSumar={cantidad >= obtenerTopeCantidad(producto)} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {modulo?.tiene_domicilio && (
                <div className="mv-segmento" role="radiogroup" aria-label="¿Cómo recibes tu pedido?">
                  <button type="button" role="radio" aria-checked={!esDomicilio} className={!esDomicilio ? 'activo' : ''} onClick={() => setEsDomicilio(false)}>
                    🏪 Recoger
                  </button>
                  <button type="button" role="radio" aria-checked={esDomicilio} className={esDomicilio ? 'activo' : ''} onClick={() => setEsDomicilio(true)}>
                    🛵 Domicilio
                  </button>
                </div>
              )}

              <div className="mv-form">
                <label className="mv-campo">
                  <span>{textos.etiquetaNombrePedido === 'Cliente' ? 'Tu nombre' : 'Mesa o tu nombre'}</span>
                  <input type="text" value={mesaNombre} onChange={(e) => setMesaNombre(e.target.value)} autoComplete="name"
                    placeholder={textos.etiquetaNombrePedido === 'Cliente' ? 'Ej. Laura Gómez' : 'Ej. Mesa 4 o Laura'} />
                </label>
                <label className="mv-campo">
                  <span>Celular</span>
                  <input type="tel" inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} autoComplete="tel" placeholder="Ej. 300 123 4567" />
                </label>
                {esDomicilio && (
                  <>
                    <label className="mv-campo">
                      <span>Dirección de entrega</span>
                      <input type="text" value={direccionEntrega} onChange={(e) => setDireccionEntrega(e.target.value)} autoComplete="street-address"
                        placeholder="Ej. Calle 10 # 20-30" />
                    </label>
                    <label className="mv-campo">
                      <span>Apto, torre, barrio o indicaciones <small>(opcional)</small></span>
                      <input type="text" value={detalleDireccion} onChange={(e) => setDetalleDireccion(e.target.value)}
                        placeholder="Ej. Apto 201, torre 3 · portón verde" />
                    </label>
                    <SelectorDireccionMapa direccion={direccionEntrega} ubicacion={ubicacionDomicilio} onConfirmar={setUbicacionDomicilio}
                      centro={modulo?.ubicacion || null} />
                  </>
                )}
                <label className="mv-campo">
                  <span>¿Con cuánto vas a pagar? <small>(opcional, para llevarte el cambio)</small></span>
                  <input type="number" min="0" inputMode="numeric" value={montoRecibido} onChange={(e) => setMontoRecibido(e.target.value)} placeholder="Ej. 50000" />
                </label>
              </div>

              <div className="mv-totales">
                <div><span>Productos ({totalItems})</span><span>{pesos(totalCarrito)}</span></div>
                {esDomicilio && modulo?.envio_costo !== null && modulo?.envio_costo !== undefined && (
                  <div><span>Domicilio</span><span>{modulo.envio_costo === 0 ? 'Gratis' : pesos(modulo.envio_costo)}</span></div>
                )}
                <div className="mv-totales__total"><span>Total</span><span>{pesos(totalCarrito + (esDomicilio && modulo?.envio_costo ? modulo.envio_costo : 0))}</span></div>
                {esDomicilio && modulo?.envio_costo && <small>El negocio confirmará el valor final del domicilio.</small>}
              </div>
              {modulo?.sellos && (
                <p className="mv-sellos__aviso">
                  🎟️ {totalCarrito >= modulo.sellos.minimo
                    ? <>Este pedido suma <b>1 sello</b> a tu tarjeta (con el celular que escribiste).</>
                    : <>Desde {pesos(modulo.sellos.minimo)} tu pedido suma un sello a tu tarjeta.</>}
                </p>
              )}
            </div>

            <div className="mv-pedido__pie">
              {errorEnvio && <p className="mv-error-envio" role="alert">{errorEnvio}</p>}
              <button type="button" className="mv-btn mv-btn--grande mv-btn--full" onClick={handleGenerarPedido} disabled={enviando || (itemsCarrito.length === 0 && itemsPromos.length === 0)}>
                {enviando ? 'Enviando tu pedido...' : `Enviar pedido · ${pesos(totalCarrito)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= Tarjeta de sellos ================= */}
      {verSellos && modulo?.sellos && (
        <div className="mv-capa" onClick={cerrarCapa}>
          <div className="mv-hoja mv-ficha" role="dialog" aria-modal="true" aria-label="Tarjeta de sellos" onClick={(e) => e.stopPropagation()}>
            <span className="mv-hoja__agarre" aria-hidden="true" />
            <div className="mv-pedido__cabecera">
              <button type="button" className="mv-atras" onClick={cerrarCapa}><Icono.atras /> Volver</button>
              <h2>Mis sellos</h2>
            </div>
            <MenuSellos moduloId={moduloId} negocio={nombre} config={{ ...modulo.sellos, textoMenu: textos.menu }} />
          </div>
        </div>
      )}

      {modulo?.bot_activo && !capaAbierta && (
        <AsistenteMenu moduloId={moduloId} modulo={modulo} subirPorCarrito={hayCarrito} />
      )}
    </div>
  );
};

export default MenuPublico;
