import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import { Html5Qrcode } from 'html5-qrcode';
import './Ventas.css';

const clienteVacio = () => ({ nombre: '', documento: '', direccion: '', telefono: '' });

const crearCuentaVacia = (id, nombre) => ({
  id,
  nombre,
  carrito: [],
  cliente: clienteVacio(),
  clienteSeleccionado: null,
  metodoPago: 'efectivo',
  montoRecibido: ''
});

// Se llama una sola vez, desde los inicializadores lazy de useState (nunca
// en cada render). Si ya existe el formato nuevo ('cuentasActivas') lo usa
// tal cual; si no, migra el formato viejo (carrito/cliente planos, una
// sola cuenta) envolviéndolo en "Cuenta 1" para no perder nada que ya
// estuviera en progreso.
const resolverCuentasIniciales = () => {
  try {
    const savedCuentas = localStorage.getItem('cuentasActivas');
    if (savedCuentas) {
      const parsed = JSON.parse(savedCuentas);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (error) {
    console.error('Error leyendo cuentas de localStorage:', error);
  }

  const cuenta = crearCuentaVacia('cuenta-1', 'Cuenta 1');
  try {
    const carritoViejo = localStorage.getItem('carrito');
    if (carritoViejo) {
      const parsedCarrito = JSON.parse(carritoViejo);
      if (Array.isArray(parsedCarrito)) cuenta.carrito = parsedCarrito;
    }
    const clienteViejo = localStorage.getItem('cliente');
    if (clienteViejo) {
      const parsedCliente = JSON.parse(clienteViejo);
      if (parsedCliente && typeof parsedCliente === 'object') cuenta.cliente = parsedCliente;
    }
  } catch (error) {
    console.error('Error migrando carrito/cliente del formato anterior:', error);
  }
  return [cuenta];
};

const Ventas = ({ user }) => {
  const { moduloActivo } = useModulo();
  const [productos, setProductos] = useState([]);
  // Varias "cuentas" (mesas/personas) en simultáneo, cada una con su propio
  // carrito/cliente/método de pago. Ver crearCuentaVacia y
  // resolverCuentasIniciales.
  const [cuentas, setCuentas] = useState(() => resolverCuentasIniciales());
  const [cuentaActivaId, setCuentaActivaId] = useState(() => {
    const inicial = resolverCuentasIniciales();
    try {
      const saved = localStorage.getItem('cuentaActivaId');
      if (saved && inicial.some(c => c.id === saved)) return saved;
    } catch (error) {
      console.error('Error leyendo cuentaActivaId de localStorage:', error);
    }
    return inicial[0]?.id || 'cuenta-1';
  });
  const [cuentaEditandoId, setCuentaEditandoId] = useState(null);
  const [nombreEditando, setNombreEditando] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [loading, setLoading] = useState(false);
  const [mostrarFactura, setMostrarFactura] = useState(false);
  const [facturaData, setFacturaData] = useState(null);
  const [modoScanner, setModoScanner] = useState(false);
  const [scannerActivo, setScannerActivo] = useState(false);
  const [error, setError] = useState(null);
  const [scanToast, setScanToast] = useState(null); // { nombre, cantidad }
  const [clienteResultados, setClienteResultados] = useState([]);
  const [buscandoCliente, setBuscandoCliente] = useState(false);
  const [mostrarResultadosCliente, setMostrarResultadosCliente] = useState(false);
  const [mostrarNuevoCliente, setMostrarNuevoCliente] = useState(false);
  const [nuevoClienteForm, setNuevoClienteForm] = useState({ nombre: '', cedula: '', telefono: '' });
  const [guardandoCliente, setGuardandoCliente] = useState(false);
  const [numeroClienteBusqueda, setNumeroClienteBusqueda] = useState('');
  const [buscandoPorNumero, setBuscandoPorNumero] = useState(false);
  const [errorNumeroCliente, setErrorNumeroCliente] = useState('');
  // Pestañas solo para móvil (≤768px): en desktop ambas secciones siguen
  // mostrándose lado a lado sin depender de este estado.
  const [vistaMobileActiva, setVistaMobileActiva] = useState('productos');
  // Alto ocupado por el teclado en móvil (para fijar la barra de búsqueda
  // justo encima de él en vez de que quede tapada). Solo se actualiza si
  // el navegador soporta visualViewport; en los que no, queda en 0 y la
  // barra usa el comportamiento de respaldo definido en CSS.
  const [tecladoAltura, setTecladoAltura] = useState(0);
  const inputRef = useRef(null);
  const scannerRef = useRef(null);
  const carritoSectionRef = useRef(null);
  const pendingScanRef = useRef(null);
  const scanToastTimeoutRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const productosRequestIdRef = useRef(0);
  // Último código leído por la cámara + cuándo, para ignorar relecturas
  // del mismo código mientras el usuario sigue apuntando al producto.
  const ultimoEscaneoRef = useRef({ codigo: null, timestamp: 0 });
  // Siempre refleja el cuentaActivaId más reciente, incluso dentro de
  // closures viejos (ej. buscarPorEAN tiene deps [] y nunca se vuelve a
  // crear) — así agregarAlCarrito/eliminarDelCarrito/cambiarCantidad
  // pueden mantener sus mismos deps de siempre y seguir operando sobre la
  // cuenta activa REAL en vez de una capturada al montar.
  const cuentaActivaIdRef = useRef(cuentaActivaId);
  useEffect(() => {
    cuentaActivaIdRef.current = cuentaActivaId;
  }, [cuentaActivaId]);
  // Numeración de "Mesa N" para cuentas nuevas: nunca reutiliza un número
  // aunque se hayan cerrado cuentas antes (persiste en localStorage, no
  // depende de cuántas cuentas hay abiertas ahora mismo).
  const contadorMesaRef = useRef(null);
  if (contadorMesaRef.current === null) {
    try {
      const saved = localStorage.getItem('mesaContador');
      contadorMesaRef.current = saved ? parseInt(saved, 10) : 2;
    } catch (error) {
      contadorMesaRef.current = 2;
    }
  }

  // Valores derivados de la cuenta activa: el resto del componente sigue
  // leyendo/escribiendo carrito/cliente/clienteSeleccionado/metodoPago
  // exactamente igual que antes, solo que ahora viven dentro de `cuentas`.
  const cuentaActiva = cuentas.find(c => c.id === cuentaActivaId);
  const carrito = cuentaActiva?.carrito || [];
  const cliente = cuentaActiva?.cliente || clienteVacio();
  const clienteSeleccionado = cuentaActiva?.clienteSeleccionado || null;
  const metodoPago = cuentaActiva?.metodoPago || 'efectivo';
  const montoRecibido = cuentaActiva?.montoRecibido || '';

  const actualizarCuentaPorId = useCallback((id, cambios) => {
    setCuentas(prev => prev.map(c => (c.id === id ? { ...c, ...cambios } : c)));
  }, []);

  const actualizarCuentaActiva = useCallback((cambios) => {
    actualizarCuentaPorId(cuentaActivaId, cambios);
  }, [cuentaActivaId, actualizarCuentaPorId]);

  // Guardar cuentas + cuál está activa en localStorage cuando cambien
  useEffect(() => {
    localStorage.setItem('cuentasActivas', JSON.stringify(cuentas));
    localStorage.setItem('cuentaActivaId', cuentaActivaId);
  }, [cuentas, cuentaActivaId]);

  // Autocomplete de clientes: buscar con debounce mientras se escribe el
  // nombre, salvo que ya haya un cliente seleccionado (el texto entonces
  // coincide con el cliente elegido y no hace falta volver a buscar).
  useEffect(() => {
    if (clienteSeleccionado) {
      setClienteResultados([]);
      setMostrarResultadosCliente(false);
      return;
    }

    const termino = cliente.nombre.trim();
    if (termino.length < 2) {
      setClienteResultados([]);
      setMostrarResultadosCliente(false);
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        setBuscandoCliente(true);
        const response = await api.get('/clientes', { params: { search: termino } });
        setClienteResultados(response.data);
        setMostrarResultadosCliente(true);
      } catch (error) {
        console.error('Error buscando clientes:', error);
      } finally {
        setBuscandoCliente(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [cliente.nombre, clienteSeleccionado]);

  // Mostrar un toast cuando un escaneo agrega/incrementa un producto en el
  // carrito, aunque la cámara siga abierta tapando el carrito-section.
  useEffect(() => {
    const pending = pendingScanRef.current;
    if (!pending) return;
    const item = carrito.find(i => i.producto_id === pending.id);
    if (!item) return;

    pendingScanRef.current = null;
    setScanToast({ nombre: pending.nombre, cantidad: item.cantidad });
    if (scanToastTimeoutRef.current) clearTimeout(scanToastTimeoutRef.current);
    scanToastTimeoutRef.current = setTimeout(() => setScanToast(null), 1800);
  }, [carrito]);

  useEffect(() => {
    return () => {
      if (scanToastTimeoutRef.current) clearTimeout(scanToastTimeoutRef.current);
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  // Sigue el espacio que tapa el teclado en móvil (vía visualViewport) para
  // que la barra de búsqueda fija pueda subirse justo encima de él.
  useEffect(() => {
    if (!window.visualViewport) return;

    const actualizarAlturaTeclado = () => {
      const alturaTeclado = Math.max(
        0,
        window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop
      );
      setTecladoAltura(alturaTeclado);
      document.documentElement.style.setProperty('--teclado-alto', `${alturaTeclado}px`);
    };

    actualizarAlturaTeclado();
    window.visualViewport.addEventListener('resize', actualizarAlturaTeclado);
    window.visualViewport.addEventListener('scroll', actualizarAlturaTeclado);

    return () => {
      window.visualViewport.removeEventListener('resize', actualizarAlturaTeclado);
      window.visualViewport.removeEventListener('scroll', actualizarAlturaTeclado);
    };
  }, []);

  // Cargar productos al iniciar o cambiar de módulo
  useEffect(() => {
    if (moduloActivo) {
      cargarProductos();
      // Limpiar cuentas al cambiar de módulo (opcional)
      // setCuentas([crearCuentaVacia('cuenta-1', 'Cuenta 1')]);
    }
    return () => {
      // Limpiar scanner al desmontar
      if (scannerRef.current) {
        scannerRef.current.stop().catch(err => console.log('Scanner stopped'));
      }
    };
  }, [moduloActivo]);

  // Tanto cargarProductos como buscarProductos escriben en el mismo estado
  // `productos`. Como el input tiene autoFocus, el usuario puede empezar a
  // escribir una búsqueda antes de que responda la carga inicial (disparada
  // al montar). Sin esta guarda, si esa respuesta "vieja" (sin filtro)
  // llega DESPUÉS que la de la búsqueda, pisa los resultados filtrados con
  // la lista completa — se ve como si la búsqueda no hiciera nada. Solo se
  // aplica la respuesta de la solicitud más reciente.
  const cargarProductos = useCallback(async () => {
    const requestId = ++productosRequestIdRef.current;
    try {
      setLoading(true);
      setError(null);
      const response = await api.get('/productos');
      if (requestId !== productosRequestIdRef.current) return;
      setProductos(response.data);
    } catch (error) {
      if (requestId !== productosRequestIdRef.current) return;
      console.error('Error cargando productos:', error);
      setError('Error al cargar productos. Intenta de nuevo.');
    } finally {
      if (requestId === productosRequestIdRef.current) setLoading(false);
    }
  }, []);

  // Buscar productos con debounce
  const buscarProductos = useCallback(async (termino) => {
    if (!termino || termino.length < 2) {
      cargarProductos();
      return;
    }

    const requestId = ++productosRequestIdRef.current;
    try {
      setLoading(true);
      setError(null);
      const response = await api.get('/productos', {
        params: { search: termino }
      });
      if (requestId !== productosRequestIdRef.current) return;
      setProductos(response.data);
    } catch (error) {
      if (requestId !== productosRequestIdRef.current) return;
      console.error('Error buscando productos:', error);
      setError('Error al buscar productos');
    } finally {
      if (requestId === productosRequestIdRef.current) setLoading(false);
    }
  }, [cargarProductos]);

  // Buscar producto por EAN (scanner)
  const buscarPorEAN = useCallback(async (ean) => {
    if (!ean || ean.trim() === '') return;
    
    try {
      setError(null);
      const response = await api.get(`/productos/buscar/${ean.trim()}`);
      if (response.data) {
        agregarAlCarrito(response.data);
        // Marca este producto como "pendiente de confirmar" para el toast
        // del scanner; el useEffect sobre `carrito` dispara el toast en
        // cuanto el estado del carrito refleje el resultado del escaneo.
        pendingScanRef.current = { id: response.data.id, nombre: response.data.nombre };
        setBusqueda('');
        // Feedback visual
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.style.borderColor = '#48bb78';
          setTimeout(() => {
            inputRef.current.style.borderColor = '';
          }, 500);
        }
      }
    } catch (error) {
      if (error.response?.status === 404) {
        setError(`❌ Producto con código ${ean} no encontrado`);
        // Vibración (si está disponible)
        if (navigator.vibrate) navigator.vibrate(200);
      } else {
        console.error('Error buscando producto:', error);
        setError('Error al buscar el producto');
      }
    }
  }, []);

  // Búsqueda con debounce (nombre/código, modo normal). Antes este mismo
  // handler estaba conectado a la vez a onChange y onKeyPress: cada tecla
  // disparaba dos veces la función (una con el valor del input ANTES de
  // aplicarse la tecla, vía keypress, y otra con el valor ya actualizado,
  // vía onChange/input), y cada llamada creaba su propio setTimeout. Como
  // esto no es un efecto sino un handler de evento normal, el
  // `return () => clearTimeout(...)` nunca se ejecutaba como limpieza -
  // React solo hace eso dentro de useEffect. El resultado: cada tecla
  // dejaba temporizadores viejos sin cancelar, y la última respuesta en
  // llegar (no necesariamente la del texto actual) era la que se mostraba.
  const handleSearch = useCallback((e) => {
    const valor = e.target.value;
    setBusqueda(valor);

    if (modoScanner) return; // en modo scanner se busca con Enter, no por tecla

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      buscarProductos(valor);
    }, 300);
  }, [modoScanner, buscarProductos]);

  // Buscar por EAN al presionar Enter (modo scanner)
  const handleScannerKeyDown = useCallback((e) => {
    if (modoScanner && e.key === 'Enter' && e.target.value) {
      buscarPorEAN(e.target.value);
      e.preventDefault();
    }
  }, [modoScanner, buscarPorEAN]);

  // Cerrar scanner: detiene la cámara y deja el carrito visible de inmediato
  // (sin que el usuario tenga que buscar/scrollear para verlo).
  const cerrarScanner = useCallback(() => {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(err => console.log('Scanner stopped'));
      scannerRef.current = null;
    }
    setScannerActivo(false);
    setModoScanner(false);
    setScanToast(null);
    requestAnimationFrame(() => {
      carritoSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  // Cuánto esperar antes de aceptar una relectura del MISMO código. Sin esto,
  // a fps:10 la cámara puede disparar el callback de éxito varias veces por
  // segundo mientras el usuario sigue apuntando al mismo producto, agregando
  // varias unidades de golpe. Un código distinto sí se procesa de inmediato.
  const COOLDOWN_ESCANEO_MS = 2000;

  // Arranca la cámara. Requiere que #scanner-container ya exista en el DOM
  // (se renderiza en cuanto modoScanner es true), por eso se dispara desde
  // el useEffect de más abajo en vez de desde el mismo click que activa
  // modoScanner.
  const iniciarCamara = useCallback(() => {
    if (scannerRef.current) return; // ya está iniciando/iniciado

    let html5QrCode;
    try {
      const contenedor = document.getElementById('scanner-container');
      if (!contenedor) {
        throw new Error('El contenedor del scanner no está disponible en el DOM');
      }
      html5QrCode = new Html5Qrcode('scanner-container');
    } catch (err) {
      console.error('Error iniciando scanner:', err);
      setError('❌ No se pudo acceder a la cámara. Verifica los permisos.');
      setModoScanner(false);
      return;
    }
    scannerRef.current = html5QrCode;

    const config = {
      fps: 10,
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0
    };

    html5QrCode.start(
      { facingMode: "environment" },
      config,
      (decodedText) => {
        const ahora = Date.now();
        const ultimo = ultimoEscaneoRef.current;
        if (decodedText === ultimo.codigo && (ahora - ultimo.timestamp) < COOLDOWN_ESCANEO_MS) {
          return; // mismo código leído hace poco, ignorar relectura
        }
        ultimoEscaneoRef.current = { codigo: decodedText, timestamp: ahora };
        buscarPorEAN(decodedText);
        if (navigator.vibrate) navigator.vibrate(50);
      },
      (errorMessage) => {
        // Error al escanear (ignorar, es normal)
        // console.log('Error escaneando:', errorMessage);
      }
    ).then(() => {
      setScannerActivo(true);
    }).catch((err) => {
      console.error('Error iniciando scanner:', err);
      setError('❌ No se pudo acceder a la cámara. Verifica los permisos.');
      scannerRef.current = null;
      setModoScanner(false);
    });
  }, [buscarPorEAN]);

  // Activar/desactivar el modo scanner con un solo click: activarlo ya
  // dispara la cámara automáticamente (vía el useEffect de abajo), sin el
  // paso intermedio de un botón "Iniciar Cámara".
  const iniciarScanner = useCallback(() => {
    if (!modoScanner) {
      setModoScanner(true);
      return;
    }

    if (scannerActivo) {
      cerrarScanner();
      return;
    }

    // modoScanner ya estaba activo pero la cámara no llegó a arrancar
    // (ej. reintento manual tras un error de permisos)
    iniciarCamara();
  }, [modoScanner, scannerActivo, cerrarScanner, iniciarCamara]);

  // Dispara automáticamente el arranque de la cámara en cuanto modoScanner
  // pasa a true y #scanner-container ya está montado en el DOM.
  useEffect(() => {
    if (modoScanner && !scannerActivo && !scannerRef.current) {
      iniciarCamara();
    }
  }, [modoScanner, scannerActivo, iniciarCamara]);

  // Agregar al carrito. Usa cuentaActivaIdRef (no el estado cuentaActivaId)
  // para poder mantener deps [] igual que antes de las cuentas — así sigue
  // siendo seguro llamarla desde closures viejos como buscarPorEAN.
  const agregarAlCarrito = useCallback((producto) => {
    if (producto.stock_actual <= 0) {
      setError(`❌ "${producto.nombre}" no tiene stock disponible`);
      if (navigator.vibrate) navigator.vibrate(200);
      return;
    }

    setCuentas(prev => prev.map(c => {
      if (c.id !== cuentaActivaIdRef.current) return c;

      const existe = c.carrito.find(item => item.producto_id === producto.id);
      if (existe) {
        if (existe.cantidad >= producto.stock_actual) {
          setError(`⚠️ Stock insuficiente. Solo hay ${producto.stock_actual} unidades`);
          return c;
        }
        return {
          ...c,
          carrito: c.carrito.map(item =>
            item.producto_id === producto.id
              ? { ...item, cantidad: item.cantidad + 1 }
              : item
          )
        };
      }
      return {
        ...c,
        carrito: [...c.carrito, {
          producto_id: producto.id,
          nombre: producto.nombre,
          precio_unitario: producto.precio_venta,
          cantidad: 1,
          stock_actual: producto.stock_actual,
          codigo_ean: producto.codigo_ean
        }]
      };
    }));

    // Limpiar error si existe
    setError(null);
  }, []);

  // Eliminar del carrito
  const eliminarDelCarrito = useCallback((productoId) => {
    setCuentas(prev => prev.map(c =>
      c.id === cuentaActivaIdRef.current
        ? { ...c, carrito: c.carrito.filter(item => item.producto_id !== productoId) }
        : c
    ));
  }, []);

  // Cambiar cantidad
  const cambiarCantidad = useCallback((productoId, cantidad) => {
    if (cantidad < 1) {
      eliminarDelCarrito(productoId);
      return;
    }

    setCuentas(prev => prev.map(c => {
      if (c.id !== cuentaActivaIdRef.current) return c;

      const producto = c.carrito.find(item => item.producto_id === productoId);
      if (producto && cantidad > producto.stock_actual) {
        setError(`⚠️ Stock insuficiente. Solo hay ${producto.stock_actual} unidades`);
        return c;
      }
      return {
        ...c,
        carrito: c.carrito.map(item =>
          item.producto_id === productoId
            ? { ...item, cantidad }
            : item
        )
      };
    }));
  }, [eliminarDelCarrito]);

  // Atajo de teclado: F1 para activar scanner, Escape para limpiar
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'F1') {
        e.preventDefault();
        iniciarScanner();
      }
      if (e.key === 'Escape') {
        setError(null);
      }
      if (e.key === 'F2' && carrito.length > 0 && !(metodoPago === 'credito' && !clienteSeleccionado)) {
        e.preventDefault();
        procesarVenta();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // metodoPago/clienteSeleccionado deben estar en las dependencias: si no,
    // este closure queda con sus valores viejos hasta que carrito cambie, y
    // el guard de "crédito sin cliente" del atajo F2 podría no reflejar la
    // selección actual del usuario.
  }, [carrito, metodoPago, clienteSeleccionado]);

  // Calcular totales
  const subtotal = carrito.reduce((sum, item) => sum + (item.precio_unitario * item.cantidad), 0);

  // Procesar venta
  const procesarVenta = useCallback(async () => {
    if (carrito.length === 0) {
      setError('⚠️ El carrito está vacío');
      return;
    }

    if (metodoPago === 'credito' && !clienteSeleccionado) {
      setError('⚠️ Selecciona o registra un cliente para vender a crédito');
      return;
    }

    if (!cliente.nombre && !cliente.documento) {
      if (!confirm('¿Continuar sin datos del cliente?')) {
        return;
      }
    }

    try {
      setLoading(true);
      setError(null);
      
      const ventaData = {
        detalles: carrito.map(item => ({
          producto_id: item.producto_id,
          cantidad: item.cantidad,
          precio_unitario: item.precio_unitario
        })),
        cliente_nombre: cliente.nombre || 'Consumidor Final',
        cliente_documento: cliente.documento || '',
        cliente_direccion: cliente.direccion || '',
        cliente_telefono: cliente.telefono || '',
        metodo_pago: metodoPago,
        ...(clienteSeleccionado && { cliente_id: clienteSeleccionado.id })
      };

      const response = await api.post('/ventas', ventaData);

      if (response.data) {
        setFacturaData(response.data);
        setMostrarFactura(true);

        // Si es la única cuenta, se resetea en el mismo lugar (igual que
        // antes). Si hay más, la cuenta que acaba de pagar se cierra (la
        // "mesa" ya se liberó) y se cambia a otra cuenta existente.
        if (cuentas.length <= 1) {
          actualizarCuentaActiva({
            carrito: [],
            cliente: clienteVacio(),
            clienteSeleccionado: null,
            montoRecibido: ''
          });
        } else {
          const restantes = cuentas.filter(c => c.id !== cuentaActivaId);
          setCuentas(restantes);
          setCuentaActivaId(restantes[0].id);
        }

        // Recargar productos para actualizar stock
        cargarProductos();

        // Feedback de éxito
        if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
      }
    } catch (error) {
      console.error('Error procesando venta:', error);
      setError(error.response?.data?.error || '❌ Error al procesar la venta');
      if (navigator.vibrate) navigator.vibrate(200);
    } finally {
      setLoading(false);
    }
  }, [carrito, cliente, metodoPago, clienteSeleccionado, cargarProductos, cuentas, cuentaActivaId, actualizarCuentaActiva]);

  // Cerrar el modal de factura (siempre sigue a una venta exitosa, es lo
  // único que lo abre) y volver a la pestaña de productos en móvil, lista
  // para la siguiente venta.
  const cerrarModalFactura = useCallback(() => {
    setMostrarFactura(false);
    setVistaMobileActiva('productos');
  }, []);

  // Limpiar todo
  const limpiarTodo = useCallback(() => {
    if (carrito.length > 0 && !confirm('¿Limpiar todo el carrito?')) return;
    actualizarCuentaActiva({ carrito: [] });
    setError(null);
    setBusqueda('');
  }, [carrito, actualizarCuentaActiva]);

  // Nueva cuenta ("Mesa N", N incremental sin repetir) y la activa de una vez
  const agregarCuenta = useCallback(() => {
    const numero = contadorMesaRef.current;
    contadorMesaRef.current += 1;
    try {
      localStorage.setItem('mesaContador', String(contadorMesaRef.current));
    } catch (error) {
      console.error('Error guardando el contador de mesas:', error);
    }

    const nuevaCuenta = crearCuentaVacia(`cuenta-${Date.now()}`, `Mesa ${numero}`);
    setCuentas(prev => [...prev, nuevaCuenta]);
    setCuentaActivaId(nuevaCuenta.id);
  }, []);

  // Cierra una cuenta (excepto si es la única que queda). Si tiene items
  // sin procesar, pide confirmación antes. Si era la activa, cambia a la
  // primera cuenta restante.
  const cerrarCuenta = useCallback((id) => {
    if (cuentas.length <= 1) return;

    const cuenta = cuentas.find(c => c.id === id);
    if (!cuenta) return;

    if (cuenta.carrito.length > 0) {
      if (!confirm('Esta cuenta tiene productos sin procesar, ¿cerrar de todas formas?')) return;
    }

    const restantes = cuentas.filter(c => c.id !== id);
    setCuentas(restantes);
    if (cuentaActivaId === id) {
      setCuentaActivaId(restantes[0].id);
    }
  }, [cuentas, cuentaActivaId]);

  const iniciarRenombreCuenta = useCallback((cuenta) => {
    setCuentaEditandoId(cuenta.id);
    setNombreEditando(cuenta.nombre);
  }, []);

  const confirmarRenombreCuenta = useCallback((id) => {
    const nombreLimpio = nombreEditando.trim();
    if (nombreLimpio) {
      actualizarCuentaPorId(id, { nombre: nombreLimpio });
    }
    setCuentaEditandoId(null);
  }, [nombreEditando, actualizarCuentaPorId]);

  // Seleccionar un cliente existente del autocomplete
  const seleccionarCliente = useCallback((clienteEncontrado) => {
    actualizarCuentaActiva({
      clienteSeleccionado: clienteEncontrado,
      cliente: {
        ...cliente,
        nombre: clienteEncontrado.nombre,
        documento: clienteEncontrado.cedula || ''
      }
    });
    setClienteResultados([]);
    setMostrarResultadosCliente(false);
    setErrorNumeroCliente('');
  }, [cliente, actualizarCuentaActiva]);

  const quitarClienteSeleccionado = useCallback(() => {
    actualizarCuentaActiva({ clienteSeleccionado: null });
  }, [actualizarCuentaActiva]);

  const abrirNuevoCliente = useCallback(() => {
    setNuevoClienteForm({ nombre: cliente.nombre || '', cedula: '', telefono: '' });
    setMostrarNuevoCliente(true);
  }, [cliente.nombre]);

  // Registrar un cliente nuevo rápido desde el POS y seleccionarlo
  const crearClienteRapido = useCallback(async (e) => {
    e.preventDefault();
    if (!nuevoClienteForm.nombre.trim()) {
      setError('⚠️ El nombre del cliente es requerido');
      return;
    }

    try {
      setGuardandoCliente(true);
      const response = await api.post('/clientes', nuevoClienteForm);
      seleccionarCliente(response.data);
      setMostrarNuevoCliente(false);
      setNuevoClienteForm({ nombre: '', cedula: '', telefono: '' });
    } catch (error) {
      console.error('Error creando cliente:', error);
      setError(error.response?.data?.error || '❌ Error al registrar el cliente');
    } finally {
      setGuardandoCliente(false);
    }
  }, [nuevoClienteForm, seleccionarCliente]);

  // Búsqueda exacta por número de cliente: selecciona automáticamente sin
  // lista de confirmación (prioriza velocidad sobre el flujo de nombre).
  const buscarPorNumeroCliente = useCallback(async () => {
    const valor = numeroClienteBusqueda.trim();
    if (!valor) return;

    try {
      setBuscandoPorNumero(true);
      setErrorNumeroCliente('');
      const response = await api.get('/clientes', { params: { numero_cliente: valor } });
      if (response.data && response.data.length > 0) {
        seleccionarCliente(response.data[0]);
        setNumeroClienteBusqueda('');
      } else {
        setErrorNumeroCliente('Cliente no encontrado con ese número');
      }
    } catch (error) {
      console.error('Error buscando cliente por número:', error);
      setErrorNumeroCliente('Cliente no encontrado con ese número');
    } finally {
      setBuscandoPorNumero(false);
    }
  }, [numeroClienteBusqueda, seleccionarCliente]);

  // Si no hay módulo activo
  if (!moduloActivo) {
    return (
      <div className="ventas-container">
        <div className="alert alert-warning">
          ⚠️ No hay módulo activo. Selecciona un módulo para comenzar a vender.
        </div>
      </div>
    );
  }

  return (
    <div className="ventas-container">
      <div className="ventas-header">
        <div className="header-left">
          <h2>🛒 Punto de Venta</h2>
          <div className="modulo-indicador">
            <span className="badge">📁 {moduloActivo.nombre}</span>
          </div>
        </div>
        <div className="header-right">
          <div className="shortcuts-hint">
            <kbd>F1</kbd> Scanner <kbd>F2</kbd> Vender <kbd>Esc</kbd> Limpiar
          </div>
          <button onClick={limpiarTodo} className="btn-limpiar-todo" title="Limpiar carrito">
            🗑️
          </button>
        </div>
      </div>

      {/* Scanner y búsqueda */}
      <div className={`busqueda-section ${vistaMobileActiva === 'productos' && !modoScanner ? 'busqueda-fija-movil' : ''}`}>
        <div className="busqueda-input">
          <input
            ref={inputRef}
            type="text"
            value={busqueda}
            onChange={handleSearch}
            onKeyDown={handleScannerKeyDown}
            placeholder={modoScanner ? "📷 Escanea un código..." : "🔍 Buscar por nombre o código..."}
            className={modoScanner ? 'scanner-active' : ''}
            autoFocus
          />
          <button
            onClick={iniciarScanner}
            className={`btn-scanner ${modoScanner ? 'active' : ''}`}
            title="Activar/Desactivar scanner (F1)"
          >
            {modoScanner ? '📷' : '📷'}
          </button>
          <button onClick={cargarProductos} className="btn-refresh" title="Recargar productos">
            🔄
          </button>
        </div>
        
        {error && (
          <div className="error-message">
            {error}
            <button onClick={() => setError(null)} className="btn-cerrar-error">✕</button>
          </div>
        )}

        {modoScanner && (
          <div className="scanner-info">
            {scannerActivo
              ? '💡 Modo scanner activo. Apunta la cámara al código de barras.'
              : '📷 Iniciando cámara...'}
          </div>
        )}
      </div>

      {/* Contenedor del scanner: debe existir en el DOM (con dimensiones)
          antes de instanciar Html5Qrcode y llamar a .start(). Por eso se
          renderiza en cuanto modoScanner es true, no cuando scannerActivo. */}
      {modoScanner && (
        <div className="scanner-container-wrapper">
          {/* Resumen del carrito siempre visible mientras el scanner está
              activo, para no tener que cerrar la cámara para saber cómo va */}
          <div className="scanner-carrito-resumen">
            🛒 {carrito.length} items · ${subtotal.toLocaleString()}
          </div>
          <div id="scanner-container" className="scanner-container"></div>
          {scanToast && (
            <div className="scanner-toast">
              ✅ {scanToast.nombre} agregado (x{scanToast.cantidad})
            </div>
          )}
          {scannerActivo && (
            <button onClick={cerrarScanner} className="btn-cerrar-scanner">
              ✕ Cerrar Scanner
            </button>
          )}
        </div>
      )}

      {/* Pestañas solo visibles en móvil (CSS las oculta en desktop/tablet) */}
      <div className="ventas-mobile-tabs">
        <button
          className={`ventas-mobile-tab ${vistaMobileActiva === 'productos' ? 'active' : ''}`}
          onClick={() => setVistaMobileActiva('productos')}
        >
          🛍️ Productos
        </button>
        <button
          className={`ventas-mobile-tab ${vistaMobileActiva === 'carrito' ? 'active' : ''}`}
          onClick={() => setVistaMobileActiva('carrito')}
        >
          🛒 Carrito{carrito.length > 0 ? ` (${carrito.length})` : ''}
        </button>
      </div>

      <div className={`ventas-grid mobile-vista-${vistaMobileActiva}`}>
        {/* Lista de productos */}
        <div className="productos-lista">
          <h3>
            Productos
            <span className="productos-count">({productos.length})</span>
          </h3>
          {loading ? (
            <div className="loading">Cargando productos...</div>
          ) : productos.length === 0 ? (
            <div className="sin-productos">
              <p>No hay productos disponibles</p>
              <button onClick={cargarProductos} className="btn-refresh">🔄 Recargar</button>
            </div>
          ) : (
            <div className="productos-grid">
              {productos.map(producto => (
                <div
                  key={producto.id}
                  className={`producto-card ${producto.stock_actual <= 0 ? 'agotado' : ''}`}
                  onClick={() => agregarAlCarrito(producto)}
                >
                  <div className="producto-info">
                    <h4>{producto.nombre}</h4>
                    <p className="producto-precio">${producto.precio_venta.toLocaleString()}</p>
                    <p className={`producto-stock ${producto.stock_actual <= producto.stock_minimo ? 'bajo' : ''}`}>
                      Stock: {producto.stock_actual}
                      {producto.stock_actual <= 0 && ' ❌'}
                    </p>
                    {producto.codigo_ean && (
                      <small className="producto-ean">📷 {producto.codigo_ean}</small>
                    )}
                  </div>
                  <button
                    className="btn-agregar-carrito-item"
                    disabled={producto.stock_actual <= 0}
                  >
                    {producto.stock_actual > 0 ? '+' : '🚫'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Carrito */}
        <div className="carrito-section" ref={carritoSectionRef}>
          <h3>
            Carrito
            <span className="carrito-count">({carrito.length} items)</span>
          </h3>

          {/* Cuentas (mesas/personas) en simultáneo */}
          <div className="cuentas-tabs">
            {cuentas.map(cuenta => (
              <div
                key={cuenta.id}
                className={`cuenta-pill ${cuenta.id === cuentaActivaId ? 'active' : ''}`}
                onClick={() => setCuentaActivaId(cuenta.id)}
              >
                {cuentaEditandoId === cuenta.id ? (
                  <input
                    type="text"
                    value={nombreEditando}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setNombreEditando(e.target.value)}
                    onBlur={() => confirmarRenombreCuenta(cuenta.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') confirmarRenombreCuenta(cuenta.id);
                      if (e.key === 'Escape') setCuentaEditandoId(null);
                    }}
                    className="cuenta-pill-input"
                  />
                ) : (
                  <span
                    className="cuenta-pill-nombre"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      iniciarRenombreCuenta(cuenta);
                    }}
                  >
                    {cuenta.nombre}
                    {cuenta.carrito.length > 0 ? ` (${cuenta.carrito.length})` : ''}
                  </span>
                )}
                <button
                  type="button"
                  className="cuenta-pill-editar"
                  onClick={(e) => {
                    e.stopPropagation();
                    iniciarRenombreCuenta(cuenta);
                  }}
                  title="Renombrar"
                >
                  ✏️
                </button>
                {cuentas.length > 1 && (
                  <button
                    type="button"
                    className="cuenta-pill-cerrar"
                    onClick={(e) => {
                      e.stopPropagation();
                      cerrarCuenta(cuenta.id);
                    }}
                    title="Cerrar cuenta"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="cuenta-pill-nueva" onClick={agregarCuenta}>
              + Nueva
            </button>
          </div>

          {/* Datos del cliente */}
          <div className="cliente-form">
            <div className="cliente-busqueda-wrapper">
              <input
                type="text"
                placeholder="Buscar o escribir nombre del cliente"
                value={cliente.nombre}
                onChange={(e) => {
                  actualizarCuentaActiva({
                    cliente: { ...cliente, nombre: e.target.value },
                    ...(clienteSeleccionado ? { clienteSeleccionado: null } : {})
                  });
                }}
                className="cliente-input"
                autoComplete="off"
              />
              {clienteSeleccionado && (
                <span className="cliente-seleccionado-badge">
                  ✓ Cliente #{clienteSeleccionado.numero_cliente}
                  <button type="button" onClick={quitarClienteSeleccionado} title="Quitar cliente seleccionado">✕</button>
                </span>
              )}
              {mostrarResultadosCliente && !clienteSeleccionado && (
                <div className="cliente-resultados">
                  {buscandoCliente ? (
                    <div className="cliente-resultado-info">Buscando...</div>
                  ) : clienteResultados.length > 0 ? (
                    clienteResultados.map(c => (
                      <div key={c.id} className="cliente-resultado-item" onClick={() => seleccionarCliente(c)}>
                        <strong>{c.nombre}</strong>
                        {c.cedula && <span> · {c.cedula}</span>}
                      </div>
                    ))
                  ) : (
                    <div className="cliente-resultado-info">
                      Sin coincidencias.
                      <button type="button" onClick={abrirNuevoCliente} className="btn-registrar-cliente">
                        ➕ Registrar nuevo cliente
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="cliente-numero-wrapper">
              <input
                type="text"
                inputMode="numeric"
                placeholder="N° cliente"
                value={numeroClienteBusqueda}
                onChange={(e) => {
                  setNumeroClienteBusqueda(e.target.value);
                  if (errorNumeroCliente) setErrorNumeroCliente('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    buscarPorNumeroCliente();
                  }
                }}
                className="cliente-input cliente-input-numero"
                title="Buscar cliente por su número exacto (Enter)"
              />
              {buscandoPorNumero && <span className="cliente-numero-info">Buscando...</span>}
              {errorNumeroCliente && <span className="cliente-numero-error">{errorNumeroCliente}</span>}
            </div>

            <input
              type="text"
              placeholder="Documento"
              value={cliente.documento}
              onChange={(e) => actualizarCuentaActiva({ cliente: { ...cliente, documento: e.target.value } })}
              className="cliente-input"
            />
          </div>

          {metodoPago === 'credito' && !clienteSeleccionado && (
            <p className="credito-sin-cliente-warning">
              ⚠️ Selecciona o registra un cliente para vender a crédito
            </p>
          )}

          {/* Lista del carrito */}
          <div className="carrito-lista">
            {carrito.length === 0 ? (
              <p className="carrito-vacio">🛒 El carrito está vacío</p>
            ) : (
              carrito.map(item => (
                <div key={item.producto_id} className="carrito-item">
                  <div className="item-info">
                    <span className="item-nombre">{item.nombre}</span>
                    <span className="item-precio">${item.precio_unitario.toLocaleString()}</span>
                  </div>
                  <div className="item-controls">
                    <button 
                      onClick={() => cambiarCantidad(item.producto_id, item.cantidad - 1)}
                      className="btn-cantidad"
                    >
                      −
                    </button>
                    <span className="item-cantidad">{item.cantidad}</span>
                    <button 
                      onClick={() => cambiarCantidad(item.producto_id, item.cantidad + 1)}
                      className="btn-cantidad"
                      disabled={item.cantidad >= item.stock_actual}
                    >
                      +
                    </button>
                    <button 
                      onClick={() => eliminarDelCarrito(item.producto_id)} 
                      className="btn-eliminar"
                      title="Eliminar del carrito"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Totales y método de pago */}
          {carrito.length > 0 && (
            <div className="carrito-totales">
              <div className="totales-linea">
                <span>Subtotal:</span>
                <span>${subtotal.toLocaleString()}</span>
              </div>
              <div className="totales-linea total">
                <span><strong>Total:</strong></span>
                <span><strong>${subtotal.toLocaleString()}</strong></span>
              </div>

              <div className="metodo-pago">
                <label>💳 Método de pago:</label>
                <select
                  value={metodoPago}
                  onChange={(e) => actualizarCuentaActiva({ metodoPago: e.target.value })}
                >
                  <option value="efectivo">💵 Efectivo</option>
                  <option value="tarjeta">💳 Tarjeta</option>
                  <option value="transferencia">🏦 Transferencia</option>
                  <option value="credito">📒 Crédito</option>
                  <option value="consumo_propio">🏠 Consumo propio</option>
                  <option value="otros">📱 Otros</option>
                </select>
              </div>

              {metodoPago === 'efectivo' && (
                <div className="calculadora-cambio">
                  <label>💵 Paga con:</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="Valor del billete/monto recibido"
                    value={montoRecibido}
                    onChange={(e) => actualizarCuentaActiva({ montoRecibido: e.target.value })}
                  />
                  {montoRecibido && Number(montoRecibido) > 0 && (
                    Number(montoRecibido) >= subtotal ? (
                      <div className="cambio-resultado positivo">
                        Cambio a devolver: <strong>${(Number(montoRecibido) - subtotal).toLocaleString()}</strong>
                      </div>
                    ) : (
                      <div className="cambio-resultado negativo">
                        ⚠️ Falta ${(subtotal - Number(montoRecibido)).toLocaleString()}
                      </div>
                    )
                  )}
                </div>
              )}

              <button
                onClick={procesarVenta}
                className="btn-procesar-venta"
                disabled={loading || (metodoPago === 'credito' && !clienteSeleccionado)}
              >
                {loading ? '⏳ Procesando...' : '✅ Procesar Venta (F2)'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Botón flotante solo visible en móvil (CSS lo oculta en
          desktop/tablet). Siempre lleva a la pestaña de carrito, sin
          importar dónde esté el usuario (incluida la pestaña de productos
          con el scanner activo). */}
      {carrito.length > 0 && (
        <button
          className="carrito-fab"
          onClick={() => setVistaMobileActiva('carrito')}
        >
          🛒 {carrito.length} · ${subtotal.toLocaleString()}
        </button>
      )}

      {/* Modal de factura */}
      {mostrarFactura && facturaData && (
        <div className="factura-modal" onClick={cerrarModalFactura}>
          <div className="factura-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="factura-modal-header">
              <h3>🧾 Factura</h3>
              <button onClick={cerrarModalFactura}>✕</button>
            </div>

            <div className="factura-confirmacion">
              ✅ Venta registrada correctamente
            </div>

            <div id="factura-content" className="factura-content">
              <div className="factura-header">
                <h2>{facturaData.negocio_nombre}</h2>
                <p>{facturaData.negocio_direccion}</p>
                <p>Tel: {facturaData.negocio_telefono}</p>
                <p>NIT: {facturaData.negocio_ruc_nit}</p>
                <p>Módulo: {facturaData.modulo_nombre}</p>
                <hr />
                <p><strong>Factura N°:</strong> {facturaData.numero_factura}</p>
                <p><strong>Fecha:</strong> {new Date(facturaData.fecha_venta).toLocaleString()}</p>
                <p><strong>Vendedor:</strong> {facturaData.vendedor_nombre}</p>
                <p><strong>Cliente:</strong> {facturaData.cliente_nombre}</p>
                {facturaData.cliente_documento && (
                  <p><strong>Documento:</strong> {facturaData.cliente_documento}</p>
                )}
              </div>

              <div className="factura-detalles">
                <table>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Cant</th>
                      <th>Precio</th>
                      <th>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facturaData.detalles.map((detalle, index) => (
                      <tr key={index}>
                        <td>{detalle.producto_nombre}</td>
                        <td>{detalle.cantidad}</td>
                        <td>${detalle.precio_unitario.toLocaleString()}</td>
                        <td>${detalle.subtotal.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="factura-totales">
                <div className="total-linea">
                  <span>Subtotal:</span>
                  <span>${facturaData.subtotal.toLocaleString()}</span>
                </div>
                <div className="total-linea total">
                  <span><strong>Total:</strong></span>
                  <span><strong>${facturaData.total.toLocaleString()}</strong></span>
                </div>
                <div className="total-linea">
                  <span>Método de pago:</span>
                  <span>{facturaData.metodo_pago}</span>
                </div>
              </div>

              <div className="factura-footer">
                <p>¡Gracias por tu compra!</p>
              </div>
            </div>

            <div className="factura-modal-footer">
              <button onClick={cerrarModalFactura} className="btn-cerrar-factura">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mini-modal para registrar un cliente nuevo desde el POS */}
      {mostrarNuevoCliente && (
        <div className="cliente-modal" onClick={() => setMostrarNuevoCliente(false)}>
          <div className="cliente-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="cliente-modal-header">
              <h3>➕ Registrar Cliente</h3>
              <button onClick={() => setMostrarNuevoCliente(false)}>✕</button>
            </div>

            <form onSubmit={crearClienteRapido}>
              <div className="cliente-form-group">
                <label>Nombre *</label>
                <input
                  type="text"
                  value={nuevoClienteForm.nombre}
                  onChange={(e) => setNuevoClienteForm({ ...nuevoClienteForm, nombre: e.target.value })}
                  placeholder="Nombre del cliente"
                  required
                />
              </div>
              <div className="cliente-form-group">
                <label>Cédula</label>
                <input
                  type="text"
                  value={nuevoClienteForm.cedula}
                  onChange={(e) => setNuevoClienteForm({ ...nuevoClienteForm, cedula: e.target.value })}
                  placeholder="Número de documento"
                />
              </div>
              <div className="cliente-form-group">
                <label>Teléfono</label>
                <input
                  type="tel"
                  value={nuevoClienteForm.telefono}
                  onChange={(e) => setNuevoClienteForm({ ...nuevoClienteForm, telefono: e.target.value })}
                  placeholder="Ej: 3101234567"
                />
              </div>

              <div className="cliente-form-actions">
                <button type="submit" className="btn-guardar-cliente" disabled={guardandoCliente}>
                  {guardandoCliente ? 'Guardando...' : '✅ Guardar'}
                </button>
                <button type="button" onClick={() => setMostrarNuevoCliente(false)} className="btn-cancelar-cliente">
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

export default Ventas;