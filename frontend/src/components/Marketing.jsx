import React, { useState, useEffect, useRef, useMemo } from 'react';
import QRCode from 'qrcode';
import { Link2, Copy, Check, ExternalLink, MessageCircle, Store, QrCode, Sparkles, Download, Share2 } from 'lucide-react';
import api from '../services/api';
import { tienePermiso } from '../utils/permisos';
import { useModulo } from '../hooks/useModulo';
import SubidaImagen from './SubidaImagen';
import { IconoHoja, obtenerColorPlaceholder } from '../utils/menuVisual';
import { textosNegocio, tipoNegocioUsuario } from '../utils/tipoNegocio';
import { dibujarFlyer, PLANTILLAS, FORMATOS, cargarFuentes } from '../utils/flyer';
import './PedidosCliente.css';
import './ConfiguracionNegocio.css';
import './Marketing.css';
import { BloqueoPlan } from './PlanNegocio';

// Marketing: todo lo que ve el cliente y cómo llegarle. El enlace del menú
// (copiar, compartir, QR para imprimir), cómo se ve el menú, y el creador
// de flyers para redes con 4 plantillas.

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const normalizar = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const COLORES = ['#b5533c', '#e4572e', '#2f6f4f', '#1f4e79', '#6b3fa0', '#c0306b', '#d4a017', '#141312'];

const copiarTexto = async (texto) => {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = texto;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  }
};

const descargarBlob = (blob, nombre) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

const nombreArchivo = (texto) => normalizar(texto).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'flyer';

// Miniatura de una plantilla con los mismos datos del flyer.
const Miniatura = ({ plantilla, formato, datos, activa, onElegir }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !datos) return undefined;
    const t = setTimeout(() => { dibujarFlyer(ref.current, { plantilla: plantilla.id, formato, datos }).catch(() => {}); }, 250);
    return () => clearTimeout(t);
  }, [plantilla.id, formato, datos]);
  return (
    <button type="button" className={`mk-plantilla ${activa ? 'activa' : ''}`} onClick={onElegir} aria-pressed={activa}>
      <canvas ref={ref} className={`mk-plantilla__canvas mk-plantilla__canvas--${formato}`} />
      <strong>{plantilla.nombre}</strong>
      <small>{plantilla.descripcion}</small>
    </button>
  );
};

const Marketing = ({ user }) => {
  const { moduloActivo } = useModulo();
  const tipoNegocio = tipoNegocioUsuario();
  const textos = textosNegocio(tipoNegocio);
  // Administrador o trabajador con permiso de Marketing (ver "Tu equipo").
  const esAdmin = tienePermiso(user, 'marketing');

  const [modulo, setModulo] = useState(null);
  const [extrasNegocio, setExtrasNegocio] = useState({ horario: null, envio: null });
  const [productos, setProductos] = useState([]);
  const [promociones, setPromociones] = useState([]);
  const [qrUrl, setQrUrl] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [mensajeAviso, setMensajeAviso] = useState('');

  // Apariencia del menú
  const [nombrePublico, setNombrePublico] = useState('');
  const [fotoPortadaUrl, setFotoPortadaUrl] = useState('');
  const [editandoNombre, setEditandoNombre] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Flyer
  const [tipoFlyer, setTipoFlyer] = useState('menu');
  const [elegidoId, setElegidoId] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [plantilla, setPlantilla] = useState('editorial');
  const [formato, setFormato] = useState('post');
  const [color, setColor] = useState('');
  const [titulo, setTitulo] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [cta, setCta] = useState('Pide aquí');
  const [mostrarPrecio, setMostrarPrecio] = useState(true);
  const [mostrarQR, setMostrarQR] = useState(true);
  const [dibujando, setDibujando] = useState(false);
  const lienzoRef = useRef(null);

  const urlMenu = moduloActivo ? `${window.location.origin}/menu/${moduloActivo.id}` : '';

  useEffect(() => {
    if (!moduloActivo || !esAdmin) return;
    cargarFuentes();
    api.get(`/modulos/${moduloActivo.id}`).then(res => {
      setModulo(res.data);
      setNombrePublico(res.data.nombre_publico || '');
      setFotoPortadaUrl(res.data.foto_portada_url || '');
    }).catch(() => avisar('❌ No se pudo cargar la información del módulo'));
    api.get(`/modulos/${moduloActivo.id}/bot`).then(res => setExtrasNegocio({
      horario: res.data.bot_horario || null,
      envio: res.data.bot_envio_costo !== null && res.data.bot_envio_costo !== undefined ? Number(res.data.bot_envio_costo) : null
    })).catch(() => {});
    api.get('/productos').then(res => setProductos(res.data.filter(p => p.activo !== false))).catch(() => {});
    api.get('/promociones', { params: { todas: '1' } }).then(res => setPromociones(res.data.filter(p => p.activo && p.vigente))).catch(() => {});
  }, [moduloActivo, esAdmin]);

  useEffect(() => {
    if (!urlMenu) return;
    QRCode.toDataURL(urlMenu, { width: 640, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#141312', light: '#ffffff' } })
      .then(setQrUrl).catch(() => setQrUrl(''));
  }, [urlMenu]);

  function avisar(texto) {
    setMensajeAviso(texto);
    setTimeout(() => setMensajeAviso(''), 3500);
  }

  const nombreNegocio = nombrePublico || moduloActivo?.nombre || '';
  const colorMarca = color || obtenerColorPlaceholder(nombreNegocio);

  // ---------- Qué se promociona ----------
  const opciones = useMemo(() => {
    if (tipoFlyer === 'producto') {
      const q = normalizar(busqueda.trim());
      return productos.filter(p => !q || normalizar(p.nombre).includes(q))
        .sort((a, b) => (b.foto_url ? 1 : 0) - (a.foto_url ? 1 : 0)).slice(0, 40);
    }
    if (tipoFlyer === 'promo') return promociones;
    return [];
  }, [tipoFlyer, productos, promociones, busqueda]);

  const elegido = tipoFlyer === 'producto'
    ? productos.find(p => String(p.id) === String(elegidoId))
    : tipoFlyer === 'promo' ? promociones.find(p => String(p.id) === String(elegidoId)) : null;

  // Textos sugeridos al cambiar lo que se promociona (se pueden editar).
  useEffect(() => {
    if (tipoFlyer === 'menu') {
      setTitulo(tipoNegocio === 'tienda' ? 'Nuestro catálogo' : 'Nuestro menú');
      setMensaje('Haz tu pedido en línea, fácil y rápido');
      setCta('Pide aquí');
    } else if (elegido) {
      setTitulo(elegido.nombre.trim());
      if (tipoFlyer === 'promo') {
        setMensaje(elegido.descripcion || (elegido.ahorro > 0 ? `Ahorra ${pesos(elegido.ahorro)} llevando el combo` : 'Combo a precio especial'));
        setCta('Pídelo ya');
      } else {
        setMensaje(elegido.descripcion || '');
        setCta('Pídelo aquí');
      }
    }
  }, [tipoFlyer, elegidoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const extras = [
    modulo?.tiene_domicilio !== false && (extrasNegocio.envio === 0 ? '🛵 Domicilio gratis' : '🛵 Domicilios'),
    extrasNegocio.horario ? `🕐 ${extrasNegocio.horario}` : null
  ].filter(Boolean).slice(0, 2);

  const datosFlyer = useMemo(() => {
    if (!moduloActivo) return null;
    const portada = fotoPortadaUrl || null;
    const conFoto = productos.filter(p => p.foto_url);
    let base;
    if (tipoFlyer === 'menu') {
      const destacados = [...productos.filter(p => p.es_novedad), ...conFoto, ...productos]
        .filter((p, i, arr) => arr.findIndex(x => x.id === p.id) === i);
      base = {
        tipo: 'menu',
        fotos: portada ? [portada] : conFoto.slice(0, 4).map(p => p.foto_url),
        items: destacados.slice(0, 7).map(p => ({ nombre: p.nombre.trim(), precio: p.precio_venta })),
        precio: null
      };
    } else if (tipoFlyer === 'producto' && elegido) {
      base = { tipo: 'producto', fotos: elegido.foto_url ? [elegido.foto_url] : (portada ? [portada] : []), items: [], precio: elegido.precio_venta };
    } else if (tipoFlyer === 'promo' && elegido) {
      base = {
        tipo: 'promo',
        fotos: elegido.foto_url ? [elegido.foto_url] : elegido.items.map(i => i.foto_url).filter(Boolean),
        items: elegido.items,
        precio: elegido.precio,
        precioAntes: elegido.ahorro > 0 ? elegido.precio_normal : null,
        ahorroPct: elegido.ahorro_pct
      };
    } else {
      return null;
    }
    return {
      ...base,
      negocio: nombreNegocio,
      titulo: titulo || base.titulo || '',
      mensaje,
      cta,
      nombreMenu: textos.Menu,
      color: colorMarca,
      mostrarPrecio: tipoFlyer !== 'menu' && mostrarPrecio,
      mostrarQR,
      qrUrl,
      extras
    };
  }, [moduloActivo, fotoPortadaUrl, productos, tipoFlyer, elegido, nombreNegocio, titulo, mensaje, cta, colorMarca, mostrarPrecio, mostrarQR, qrUrl, extras.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Vista grande del flyer.
  useEffect(() => {
    if (!lienzoRef.current || !datosFlyer) return undefined;
    setDibujando(true);
    const t = setTimeout(() => {
      dibujarFlyer(lienzoRef.current, { plantilla, formato, datos: datosFlyer })
        .catch(err => console.error('Error dibujando el flyer:', err))
        .finally(() => setDibujando(false));
    }, 150);
    return () => clearTimeout(t);
  }, [datosFlyer, plantilla, formato]);

  const obtenerImagen = () => new Promise((resolve, reject) => {
    try {
      lienzoRef.current.toBlob(b => (b ? resolve(b) : reject(new Error('vacío'))), 'image/png');
    } catch (e) {
      reject(e);
    }
  });

  const descargarFlyer = async () => {
    try {
      descargarBlob(await obtenerImagen(), `${nombreArchivo(titulo || nombreNegocio)}-${formato}.png`);
      avisar('✅ Flyer descargado');
    } catch {
      avisar('❌ No se pudo generar la imagen. Si usas fotos de otra página, súbelas de nuevo desde la app.');
    }
  };

  const compartirFlyer = async () => {
    try {
      const blob = await obtenerImagen();
      const archivo = new File([blob], `${nombreArchivo(titulo || nombreNegocio)}.png`, { type: 'image/png' });
      const texto = `${titulo}${mensaje ? ` · ${mensaje}` : ''}\nPide aquí: ${urlMenu}`;
      if (navigator.canShare?.({ files: [archivo] })) {
        await navigator.share({ files: [archivo], title: titulo, text: texto });
      } else {
        descargarBlob(blob, archivo.name);
        window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank');
        avisar('✅ Flyer descargado; adjúntalo en el chat que se abrió');
      }
    } catch (err) {
      if (err?.name !== 'AbortError') avisar('❌ No se pudo compartir el flyer');
    }
  };

  const descargarQR = async () => {
    try {
      const url = await QRCode.toDataURL(urlMenu, { width: 1200, margin: 2, errorCorrectionLevel: 'M' });
      const blob = await (await fetch(url)).blob();
      descargarBlob(blob, `qr-${nombreArchivo(nombreNegocio)}.png`);
    } catch {
      avisar('❌ No se pudo descargar el QR');
    }
  };

  const copiarEnlace = async () => {
    if (await copiarTexto(urlMenu)) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } else {
      avisar('❌ No se pudo copiar; selecciona el enlace y cópialo a mano');
    }
  };

  const guardarApariencia = async () => {
    try {
      setGuardando(true);
      await api.put(`/modulos/${moduloActivo.id}/portada`, { nombre_publico: nombrePublico.trim(), foto_portada_url: fotoPortadaUrl.trim() });
      avisar(`✅ ${textos.Menu} actualizado`);
    } catch (err) {
      avisar(`❌ ${err.response?.data?.error || 'No se pudo guardar'}`);
    } finally {
      setGuardando(false);
    }
  };

  if (!esAdmin) return <div className="alert alert-warning">⚠️ No tienes acceso a Marketing. Pídeselo al administrador.</div>;
  if (!moduloActivo) return <div className="alert alert-warning">⚠️ Selecciona un módulo.</div>;

  return (
    <div className="conf-container mk">
      {mensajeAviso && <div className={`mensaje-flotante ${mensajeAviso.includes('✅') ? 'exito' : 'error'}`}>{mensajeAviso}</div>}

      {/* ========== Enlace y QR ========== */}
      <div className="card conf-card">
        <h3 className="conf-titulo"><Link2 size={18} /> Tu {textos.menu} en línea</h3>
        <p className="conf-ayuda">Compártelo por WhatsApp y redes, o imprime el QR para ponerlo en tu local, la vitrina o el mostrador. Los pedidos llegan a <strong>Pedidos de Clientes</strong>.</p>
        <div className="mk-enlace">
          <div className="mk-enlace__datos">
            <div className="conf-enlace">
              <input type="text" readOnly value={urlMenu} onFocus={(e) => e.target.select()} aria-label={`Enlace del ${textos.menu}`} />
              <button type="button" className={`conf-btn conf-btn-primario ${copiado ? 'copiado' : ''}`} onClick={copiarEnlace}>
                {copiado ? <><Check size={16} /> Copiado</> : <><Copy size={16} /> Copiar</>}
              </button>
            </div>
            <div className="conf-acciones">
              <a className="conf-btn" href={urlMenu} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Abrir {textos.menu}</a>
              <button type="button" className="conf-btn" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`Mira el ${textos.menu} de ${nombreNegocio} y haz tu pedido aquí: ${urlMenu}`)}`, '_blank')}>
                <MessageCircle size={16} /> Compartir por WhatsApp
              </button>
              <button type="button" className="conf-btn" onClick={descargarQR}><QrCode size={16} /> Descargar QR para imprimir</button>
            </div>
          </div>
          {qrUrl && <img className="mk-enlace__qr" src={qrUrl} alt={`Código QR del ${textos.menu}`} />}
        </div>
      </div>

      {/* ========== Creador de flyers ========== */}
      <BloqueoPlan titulo="Flyers para redes" funcion="marketing">
      <div className="card conf-card">
        <h3 className="conf-titulo"><Sparkles size={18} /> Crea un flyer para redes</h3>
        <p className="conf-ayuda">Elige qué quieres promocionar, una plantilla y el formato. Puedes cambiar los textos; el flyer se actualiza al instante y lo descargas o lo compartes directo.</p>

        <div className="mk-flyer">
          <div className="mk-controles">
            <div className="mk-paso">
              <span className="mk-paso__titulo">1. ¿Qué quieres promocionar?</span>
              <div className="mk-segmento">
                {[['menu', `${textos.Menu} completo`], ['producto', 'Un producto'], ['promo', 'Una promoción']].map(([v, l]) => (
                  <button key={v} type="button" className={tipoFlyer === v ? 'activo' : ''} onClick={() => { setTipoFlyer(v); setElegidoId(''); setBusqueda(''); }}
                    disabled={v === 'promo' && promociones.length === 0}>
                    {l}
                  </button>
                ))}
              </div>
              {tipoFlyer === 'promo' && promociones.length === 0 && <small className="mk-nota">Crea promociones en Productos → Promociones.</small>}

              {tipoFlyer === 'producto' && (
                <>
                  <input type="text" className="mk-input" placeholder="Busca el producto..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                  <div className="mk-opciones">
                    {opciones.map(p => (
                      <button key={p.id} type="button" className={String(elegidoId) === String(p.id) ? 'activa' : ''} onClick={() => setElegidoId(String(p.id))}>
                        {p.foto_url ? <img src={p.foto_url} alt="" /> : <span className="mk-opciones__sin">{p.nombre.slice(0, 2).toUpperCase()}</span>}
                        <span>{p.nombre}</span>
                        <small>{pesos(p.precio_venta)}</small>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {tipoFlyer === 'promo' && promociones.length > 0 && (
                <div className="mk-opciones">
                  {opciones.map(p => (
                    <button key={p.id} type="button" className={String(elegidoId) === String(p.id) ? 'activa' : ''} onClick={() => setElegidoId(String(p.id))}>
                      <span className="mk-opciones__sin">🎁</span>
                      <span>{p.nombre}</span>
                      <small>{pesos(p.precio)}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {datosFlyer && (
              <>
                <div className="mk-paso">
                  <span className="mk-paso__titulo">2. Plantilla</span>
                  <div className="mk-plantillas">
                    {PLANTILLAS.map(p => (
                      <Miniatura key={p.id} plantilla={p} formato={formato} datos={datosFlyer} activa={plantilla === p.id} onElegir={() => setPlantilla(p.id)} />
                    ))}
                  </div>
                </div>

                <div className="mk-paso">
                  <span className="mk-paso__titulo">3. Formato y color</span>
                  <div className="mk-segmento">
                    {Object.entries(FORMATOS).map(([id, f]) => (
                      <button key={id} type="button" className={formato === id ? 'activo' : ''} onClick={() => setFormato(id)}>{f.nombre}</button>
                    ))}
                  </div>
                  <div className="mk-colores" role="radiogroup" aria-label="Color del flyer">
                    {[obtenerColorPlaceholder(nombreNegocio), ...COLORES.filter(c => c !== obtenerColorPlaceholder(nombreNegocio))].map(c => (
                      <button key={c} type="button" role="radio" aria-checked={colorMarca === c} className={colorMarca === c ? 'activo' : ''}
                        style={{ background: c }} onClick={() => setColor(c)} aria-label={`Color ${c}`} />
                    ))}
                  </div>
                </div>

                <div className="mk-paso">
                  <span className="mk-paso__titulo">4. Textos</span>
                  <label className="mk-campo"><span>Título</span>
                    <input type="text" maxLength={60} value={titulo} onChange={(e) => setTitulo(e.target.value)} />
                  </label>
                  <label className="mk-campo"><span>Mensaje</span>
                    <input type="text" maxLength={90} value={mensaje} onChange={(e) => setMensaje(e.target.value)} placeholder="Opcional" />
                  </label>
                  <label className="mk-campo"><span>Llamado a la acción</span>
                    <input type="text" maxLength={24} value={cta} onChange={(e) => setCta(e.target.value)} />
                  </label>
                  <div className="mk-checks">
                    {tipoFlyer !== 'menu' && (
                      <label><input type="checkbox" checked={mostrarPrecio} onChange={(e) => setMostrarPrecio(e.target.checked)} /> Mostrar precio</label>
                    )}
                    <label><input type="checkbox" checked={mostrarQR} onChange={(e) => setMostrarQR(e.target.checked)} /> Mostrar QR del {textos.menu}</label>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="mk-vista">
            {datosFlyer ? (
              <>
                <div className={`mk-vista__marco mk-vista__marco--${formato} ${dibujando ? 'dibujando' : ''}`}>
                  <canvas ref={lienzoRef} />
                </div>
                <div className="mk-vista__acciones">
                  <button type="button" className="conf-btn conf-btn-primario" onClick={compartirFlyer}><Share2 size={16} /> Compartir</button>
                  <button type="button" className="conf-btn" onClick={descargarFlyer}><Download size={16} /> Descargar</button>
                </div>
              </>
            ) : (
              <div className="mk-vista__vacia">
                <Sparkles size={28} />
                <p>Elige {tipoFlyer === 'producto' ? 'un producto' : 'una promoción'} para ver tu flyer.</p>
              </div>
            )}
          </div>
        </div>
      </div>
      </BloqueoPlan>

      {/* ========== Apariencia del menú ========== */}
      <div className="card conf-card">
        <h3 className="conf-titulo"><Store size={18} /> Cómo se ve tu {textos.menu}</h3>
        <p className="conf-ayuda">La foto de portada aparece grande al abrir el {textos.menu} y en tus flyers. Toca el nombre o la foto para cambiarlos. Si no subes portada, el {textos.menu} arma un mosaico con las fotos de tus productos.</p>
        <div className="mp-hero config-menu-preview" style={!fotoPortadaUrl ? { background: obtenerColorPlaceholder(nombreNegocio) } : undefined}>
          {fotoPortadaUrl && <img src={fotoPortadaUrl} alt="" className="mp-hero__foto" />}
          <div className="mp-hero__overlay" />
          <div className="config-menu-foto-control">
            <SubidaImagen valor={fotoPortadaUrl} onCambiar={setFotoPortadaUrl} botonTexto="📷 Cambiar foto" ocultarPreview />
          </div>
          <div className="mp-hero__contenido">
            <span className="mp-hero__icono-wrap"><IconoHoja className="mp-hero__icono" /></span>
            <div className="config-menu-nombre-wrap">
              {editandoNombre ? (
                <input type="text" className="mp-hero__nombre config-menu-nombre-input" value={nombrePublico}
                  onChange={(e) => setNombrePublico(e.target.value)} onBlur={() => setEditandoNombre(false)} placeholder={moduloActivo.nombre} autoFocus />
              ) : (
                <h1 className="mp-hero__nombre config-menu-nombre-editable" onClick={() => setEditandoNombre(true)} title="Clic para cambiar el nombre">
                  {nombreNegocio} <span className="config-menu-lapiz">✏️</span>
                </h1>
              )}
              <p className="mp-hero__tagline">{modulo?.negocio_nombre}</p>
            </div>
          </div>
        </div>
        <div className="conf-acciones conf-acciones-fin">
          <button type="button" onClick={guardarApariencia} disabled={guardando || !modulo} className="btn-guardar conf-btn-guardar">
            {guardando ? 'Guardando...' : '💾 Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Marketing;
