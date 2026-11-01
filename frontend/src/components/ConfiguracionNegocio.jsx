import React, { useState, useEffect } from 'react';
import { Link2, Copy, Check, ExternalLink, Bike, Store, MessageCircle } from 'lucide-react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import SubidaImagen from './SubidaImagen';
import { IconoHoja, obtenerColorPlaceholder } from '../utils/menuVisual';
import { textosNegocio, tipoNegocioUsuario } from '../utils/tipoNegocio';
import './PedidosCliente.css';
import './ConfiguracionNegocio.css';

// Copia texto al portapapeles; si el navegador no deja (http o permisos),
// usa un textarea temporal.
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

// Configuración del módulo activo: cómo se ve su menú/catálogo público,
// el enlace para compartirlo y si ofrece domicilios.
const ConfiguracionNegocio = ({ user }) => {
  const { moduloActivo, refrescarModulos } = useModulo();
  const textos = textosNegocio(tipoNegocioUsuario());
  const esAdmin = user?.rol === 'admin' || user?.rol === 'super_admin';

  const [cargado, setCargado] = useState(false);
  const [nombrePublico, setNombrePublico] = useState('');
  const [fotoPortadaUrl, setFotoPortadaUrl] = useState('');
  const [negocioNombre, setNegocioNombre] = useState('');
  const [tieneDomicilio, setTieneDomicilio] = useState(true);
  const [editandoNombre, setEditandoNombre] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardandoDomicilio, setGuardandoDomicilio] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [mensaje, setMensaje] = useState('');

  const urlMenu = moduloActivo ? `${window.location.origin}/menu/${moduloActivo.id}` : '';

  useEffect(() => {
    if (!moduloActivo || !esAdmin) return;
    api.get(`/modulos/${moduloActivo.id}`)
      .then(res => {
        setNombrePublico(res.data.nombre_publico || '');
        setFotoPortadaUrl(res.data.foto_portada_url || '');
        setNegocioNombre(res.data.negocio_nombre || '');
        setTieneDomicilio(res.data.tiene_domicilio !== false);
        setCargado(true);
      })
      .catch(err => {
        console.error('Error cargando configuración del módulo:', err);
        setMensaje('❌ No se pudo cargar la configuración');
      });
  }, [moduloActivo, esAdmin]);

  const avisar = (texto) => {
    setMensaje(texto);
    setTimeout(() => setMensaje(''), 3500);
  };

  const guardarApariencia = async () => {
    try {
      setGuardando(true);
      await api.put(`/modulos/${moduloActivo.id}/portada`, {
        nombre_publico: nombrePublico.trim(),
        foto_portada_url: fotoPortadaUrl.trim()
      });
      avisar(`✅ ${textos.Menu} actualizado`);
    } catch (err) {
      avisar(`❌ ${err.response?.data?.error || 'No se pudo guardar'}`);
    } finally {
      setGuardando(false);
    }
  };

  // El interruptor guarda de inmediato y refresca los módulos de la sesión,
  // para que "Ruta de Entregas" aparezca o desaparezca del menú sin recargar.
  const cambiarDomicilio = async (activo) => {
    setTieneDomicilio(activo);
    try {
      setGuardandoDomicilio(true);
      await api.put(`/modulos/${moduloActivo.id}/portada`, { tiene_domicilio: activo });
      await refrescarModulos(moduloActivo.id);
      avisar(activo ? '✅ Domicilios activados' : '✅ Domicilios desactivados');
    } catch (err) {
      setTieneDomicilio(!activo);
      avisar(`❌ ${err.response?.data?.error || 'No se pudo cambiar'}`);
    } finally {
      setGuardandoDomicilio(false);
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

  const compartirWhatsApp = () => {
    const nombre = nombrePublico || moduloActivo.nombre;
    const texto = `Mira el ${textos.menu} de ${nombre} y haz tu pedido aquí: ${urlMenu}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank');
  };

  if (!esAdmin) {
    return <div className="alert alert-warning">⚠️ Solo los administradores pueden ver la configuración.</div>;
  }
  if (!moduloActivo) {
    return <div className="alert alert-warning">⚠️ Selecciona un módulo para configurarlo.</div>;
  }

  return (
    <div className="conf-container">
      {mensaje && (
        <div className={`mensaje-flotante ${mensaje.includes('✅') ? 'exito' : 'error'}`}>{mensaje}</div>
      )}

      {/* Enlace del menú/catálogo */}
      <div className="card conf-card">
        <h3 className="conf-titulo"><Link2 size={18} /> Enlace de tu {textos.menu}</h3>
        <p className="conf-ayuda">
          Compártelo con tus clientes (WhatsApp, redes, un código QR en el local) para que vean
          tus productos y te hagan pedidos. Los pedidos llegan a <strong>Pedidos de Clientes</strong>.
        </p>
        <div className="conf-enlace">
          <input type="text" readOnly value={urlMenu} onFocus={(e) => e.target.select()} aria-label={`Enlace del ${textos.menu}`} />
          <button type="button" className={`conf-btn conf-btn-primario ${copiado ? 'copiado' : ''}`} onClick={copiarEnlace}>
            {copiado ? <><Check size={16} /> Copiado</> : <><Copy size={16} /> Copiar</>}
          </button>
        </div>
        <div className="conf-acciones">
          <a className="conf-btn" href={urlMenu} target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> Abrir {textos.menu}
          </a>
          <button type="button" className="conf-btn" onClick={compartirWhatsApp}>
            <MessageCircle size={16} /> Compartir por WhatsApp
          </button>
        </div>
      </div>

      {/* Domicilios */}
      <div className="card conf-card">
        <div className="conf-switch-fila">
          <div>
            <h3 className="conf-titulo"><Bike size={18} /> Domicilios</h3>
            <p className="conf-ayuda">
              {tieneDomicilio
                ? 'Activos: el cliente puede pedir a domicilio con su dirección y ubicación en el mapa, y tienes la Ruta de Entregas para organizarlos.'
                : `Apagados: el cliente solo puede pedir para ${textos.sinDomicilio}. La Ruta de Entregas se oculta del menú.`}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={tieneDomicilio}
            aria-label="Domicilios"
            className={`conf-switch ${tieneDomicilio ? 'on' : ''}`}
            onClick={() => cambiarDomicilio(!tieneDomicilio)}
            disabled={!cargado || guardandoDomicilio}
          >
            <span />
          </button>
        </div>
      </div>

      {/* Apariencia del menú/catálogo */}
      <div className="card conf-card">
        <h3 className="conf-titulo"><Store size={18} /> Cómo se ve tu {textos.menu}</h3>
        <p className="conf-ayuda">Así lo ve tu cliente. Toca el nombre o la foto para cambiarlos.</p>

        <div
          className="mp-hero config-menu-preview"
          style={!fotoPortadaUrl ? { background: obtenerColorPlaceholder(nombrePublico || moduloActivo.nombre) } : undefined}
        >
          {fotoPortadaUrl && <img src={fotoPortadaUrl} alt="" className="mp-hero__foto" />}
          <div className="mp-hero__overlay" />
          <div className="config-menu-foto-control">
            <SubidaImagen valor={fotoPortadaUrl} onCambiar={setFotoPortadaUrl} botonTexto="📷 Cambiar foto" ocultarPreview />
          </div>
          <div className="mp-hero__contenido">
            <span className="mp-hero__icono-wrap"><IconoHoja className="mp-hero__icono" /></span>
            <div className="config-menu-nombre-wrap">
              {editandoNombre ? (
                <input
                  type="text"
                  className="mp-hero__nombre config-menu-nombre-input"
                  value={nombrePublico}
                  onChange={(e) => setNombrePublico(e.target.value)}
                  onBlur={() => setEditandoNombre(false)}
                  placeholder={moduloActivo.nombre}
                  autoFocus
                />
              ) : (
                <h1 className="mp-hero__nombre config-menu-nombre-editable" onClick={() => setEditandoNombre(true)} title="Clic para cambiar el nombre">
                  {nombrePublico || moduloActivo.nombre} <span className="config-menu-lapiz">✏️</span>
                </h1>
              )}
              <p className="mp-hero__tagline">{negocioNombre}</p>
            </div>
          </div>
        </div>

        <div className="conf-acciones conf-acciones-fin">
          <button type="button" onClick={guardarApariencia} disabled={guardando || !cargado} className="btn-guardar conf-btn-guardar">
            {guardando ? 'Guardando...' : '💾 Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfiguracionNegocio;
