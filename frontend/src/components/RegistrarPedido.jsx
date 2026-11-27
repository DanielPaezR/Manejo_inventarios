import React, { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import { usePlan } from '../hooks/usePlan';
import SelectorDireccionMapa from './SelectorDireccionMapa';
import './RegistrarPedido.css';

const pesos = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
const sinTildes = (t) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Si pegan la ubicación que mandó el cliente por WhatsApp o un enlace de
// Google Maps con coordenadas ("…?q=5.54,-73.36" o "@5.54,-73.36"), se
// toma de ahí y no hace falta ubicarla en el mapa.
const coordsDeTexto = (texto) => {
  const m = (texto || '').match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
};

// "Registrar pedido": el negocio anota un pedido que le llegó por WhatsApp,
// llamada o en persona. Se crea igual que uno del menú en línea (mismos
// precios, stock y domicilio) pero ya confirmado, y sigue el mismo camino:
// empacar, enviar, avisar y entregar.
const RegistrarPedido = ({ onCerrar, onCreado }) => {
  const { moduloActivo } = useModulo();
  const { incluye } = usePlan();
  const [productos, setProductos] = useState(null);
  const [tienda, setTienda] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [carrito, setCarrito] = useState({}); // productoId -> cantidad
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [esDomicilio, setEsDomicilio] = useState(false);
  const [direccion, setDireccion] = useState('');
  const [detalle, setDetalle] = useState('');
  const [ubicacion, setUbicacion] = useState(null);
  const [ubicacionPegada, setUbicacionPegada] = useState('');
  const [montoRecibido, setMontoRecibido] = useState('');
  const [pagado, setPagado] = useState(false);
  const [metodoPago, setMetodoPago] = useState('transferencia');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  const puedeDomicilio = incluye('domicilios') && tienda?.tiene_domicilio !== false;

  useEffect(() => {
    if (!moduloActivo) return;
    api.get('/productos')
      // Solo los productos de este módulo (los compartidos por otro módulo
      // no se pueden pedir desde aquí, igual que en el menú en línea).
      .then(r => setProductos(r.data.filter(p => Number(p.modulo_id) === Number(moduloActivo.id))))
      .catch(() => setProductos([]));
    api.get(`/modulos/${moduloActivo.id}`).then(r => setTienda(r.data)).catch(() => {});
  }, [moduloActivo]);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const esc = (e) => { if (e.key === 'Escape' && !enviando) onCerrar(); };
    window.addEventListener('keydown', esc);
    return () => {
      document.body.style.overflow = original;
      window.removeEventListener('keydown', esc);
    };
  }, [onCerrar, enviando]);

  const porId = useMemo(() => new Map((productos || []).map(p => [p.id, p])), [productos]);
  const tope = (p) => (p.ignora_stock ? 999 : Number(p.stock_actual || 0));

  const filtrados = useMemo(() => {
    const q = sinTildes(busqueda.trim());
    const lista = (productos || []).filter(p => !q || sinTildes(`${p.nombre} ${p.categoria_nombre || ''} ${p.codigo_ean || ''}`).includes(q));
    return lista.slice(0, 60);
  }, [productos, busqueda]);

  const items = Object.entries(carrito)
    .map(([id, cantidad]) => ({ producto: porId.get(Number(id)), cantidad }))
    .filter(i => i.producto && i.cantidad > 0);
  const total = items.reduce((s, i) => s + i.cantidad * Number(i.producto.precio_venta), 0);

  const cambiar = (p, delta) => {
    setCarrito(prev => {
      const nueva = Math.max(0, Math.min(tope(p), (prev[p.id] || 0) + delta));
      const copia = { ...prev };
      if (nueva === 0) delete copia[p.id];
      else copia[p.id] = nueva;
      return copia;
    });
  };

  const pegarUbicacion = (texto) => {
    setUbicacionPegada(texto);
    const c = coordsDeTexto(texto);
    if (c) setUbicacion({ ...c, direccion: direccion.trim() });
  };

  const guardar = async () => {
    setError('');
    if (items.length === 0) return setError('Agrega al menos un producto');
    if (!nombre.trim()) return setError('Escribe el nombre del cliente');
    if (esDomicilio && !direccion.trim()) return setError('Escribe la dirección de entrega');
    try {
      setEnviando(true);
      const { data } = await api.post('/pedidos-cliente/manual', {
        mesa_nombre: nombre.trim(),
        telefono: telefono.trim(),
        monto_recibido: montoRecibido || undefined,
        items: items.map(i => ({ producto_id: i.producto.id, cantidad: i.cantidad })),
        es_domicilio: esDomicilio,
        direccion_entrega: esDomicilio ? [direccion.trim(), detalle.trim()].filter(Boolean).join(' - ') : undefined,
        lat: esDomicilio && ubicacion ? ubicacion.lat : undefined,
        lng: esDomicilio && ubicacion ? ubicacion.lng : undefined,
        pagado,
        metodo_pago: pagado ? metodoPago : undefined
      });
      onCreado(data);
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo registrar el pedido');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="rp-fondo" onClick={() => !enviando && onCerrar()}>
      <div className="rp" role="dialog" aria-modal="true" aria-label="Registrar pedido" onClick={(e) => e.stopPropagation()}>
        <div className="rp__cabecera">
          <h3>➕ Registrar pedido</h3>
          <button type="button" className="rp__cerrar" onClick={onCerrar} disabled={enviando} aria-label="Cerrar">✕</button>
        </div>
        <p className="rp__ayuda">Para los pedidos que llegan por WhatsApp, llamada o en persona. Queda confirmado y sigue el mismo proceso de empaque y entrega.</p>

        <div className="rp__cuerpo">
          <section>
            <h4>1. Productos</h4>
            <input
              type="search"
              className="rp__input"
              placeholder="Buscar producto, categoría o código"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              autoFocus
            />
            {productos === null ? (
              <p className="rp__nota">Cargando productos...</p>
            ) : (
              <ul className="rp__productos">
                {filtrados.map(p => {
                  const cant = carrito[p.id] || 0;
                  const agotado = tope(p) <= 0;
                  return (
                    <li key={p.id} className={cant ? 'elegido' : ''}>
                      <span className="rp__foto">
                        {p.foto_url ? <img src={p.foto_url} alt="" loading="lazy" /> : (p.nombre || '?').charAt(0).toUpperCase()}
                      </span>
                      <div className="rp__prod-info">
                        <span>{p.nombre}</span>
                        <small>{pesos(p.precio_venta)}{p.ignora_stock ? '' : ` · ${agotado ? 'agotado' : `quedan ${p.stock_actual}`}`}</small>
                      </div>
                      <div className="rp__stepper">
                        {cant > 0 && <button type="button" onClick={() => cambiar(p, -1)} aria-label={`Quitar ${p.nombre}`}>−</button>}
                        {cant > 0 && <b>{cant}</b>}
                        <button type="button" onClick={() => cambiar(p, 1)} disabled={cant >= tope(p)} aria-label={`Agregar ${p.nombre}`}>+</button>
                      </div>
                    </li>
                  );
                })}
                {filtrados.length === 0 && <li className="rp__vacio">No hay productos con esa búsqueda</li>}
              </ul>
            )}
          </section>

          <section>
            <h4>2. Cliente</h4>
            <div className="rp__fila">
              <label className="rp__campo">
                <span>Nombre *</span>
                <input className="rp__input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Laura Gómez" />
              </label>
              <label className="rp__campo">
                <span>Celular</span>
                <input className="rp__input" type="tel" inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Para avisarle por WhatsApp" />
              </label>
            </div>
            {puedeDomicilio && (
              <div className="rp__segmento" role="radiogroup" aria-label="Cómo recibe el pedido">
                <button type="button" role="radio" aria-checked={!esDomicilio} className={!esDomicilio ? 'activo' : ''} onClick={() => setEsDomicilio(false)}>🏪 Recoge</button>
                <button type="button" role="radio" aria-checked={esDomicilio} className={esDomicilio ? 'activo' : ''} onClick={() => setEsDomicilio(true)}>🛵 Domicilio</button>
              </div>
            )}
            {esDomicilio && (
              <>
                <label className="rp__campo">
                  <span>Dirección de entrega *</span>
                  <input className="rp__input" value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Ej. Calle 10 # 20-30" />
                </label>
                <label className="rp__campo">
                  <span>Apto, torre, barrio o indicaciones</span>
                  <input className="rp__input" value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Ej. Apto 201 · portón verde" />
                </label>
                <label className="rp__campo">
                  <span>¿El cliente mandó su ubicación? Pega aquí el enlace (opcional)</span>
                  <input className="rp__input" value={ubicacionPegada} onChange={(e) => pegarUbicacion(e.target.value)} placeholder="https://maps.google.com/?q=..." />
                </label>
                {ubicacionPegada && !coordsDeTexto(ubicacionPegada) && (
                  <p className="rp__nota">No se pudo leer la ubicación de ese enlace: ubícala en el mapa.</p>
                )}
                <SelectorDireccionMapa
                  direccion={direccion}
                  ubicacion={ubicacion}
                  onConfirmar={setUbicacion}
                  centro={tienda?.ubicacion_lat !== null && tienda?.ubicacion_lat !== undefined
                    ? { lat: Number(tienda.ubicacion_lat), lng: Number(tienda.ubicacion_lng) } : null}
                  textoConfirmar="✅ Entregar aquí"
                />
                {!ubicacion && <p className="rp__nota">Si no lo ubicas en el mapa, se busca solo con la dirección (menos exacto).</p>}
              </>
            )}
          </section>

          <section>
            <h4>3. Pago</h4>
            <label className="rp__check">
              <input type="checkbox" checked={pagado} onChange={(e) => setPagado(e.target.checked)} />
              <span>Ya pagó</span>
            </label>
            {pagado ? (
              <select className="rp__input" value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)}>
                <option value="transferencia">Transferencia / Nequi</option>
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
              </select>
            ) : (
              <label className="rp__campo">
                <span>¿Con cuánto paga? (opcional, para llevar el cambio)</span>
                <input className="rp__input" type="number" min="0" inputMode="numeric" value={montoRecibido} onChange={(e) => setMontoRecibido(e.target.value)} placeholder="Ej. 50000" />
              </label>
            )}
          </section>
        </div>

        <div className="rp__pie">
          <div className="rp__resumen">
            <span>{items.reduce((s, i) => s + i.cantidad, 0)} producto(s)</span>
            <strong>{pesos(total)}</strong>
          </div>
          {error && <p className="rp__error">⚠️ {error}</p>}
          <button type="button" className="rp__guardar" onClick={guardar} disabled={enviando || items.length === 0}>
            {enviando ? 'Registrando...' : '✅ Registrar pedido'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RegistrarPedido;
