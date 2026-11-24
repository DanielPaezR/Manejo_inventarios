import React, { useState, useEffect } from 'react';
import { Link2, Copy, Check, ExternalLink, Bike, Store, MessageCircle, Gamepad2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import SubidaImagen from './SubidaImagen';
import ConfigAsistente from './ConfigAsistente';
import EquipoPermisos from './EquipoPermisos';
import AdminJuegos from './AdminJuegos';
import ConfigRecordatorios from './ConfigRecordatorios';
import ConfigSellos from './ConfigSellos';
import { VolverPrimerosPasos } from './PrimerosPasos';
import ConfigResumenSemanal from './ConfigResumenSemanal';
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
  const [juegosActivos, setJuegosActivos] = useState(true);
  const [guardandoJuegos, setGuardandoJuegos] = useState(false);
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
        setJuegosActivos(res.data.juegos_activos !== false);
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

  const cambiarJuegos = async (activo) => {
    setJuegosActivos(activo);
    try {
      setGuardandoJuegos(true);
      await api.put(`/modulos/${moduloActivo.id}/portada`, { juegos_activos: activo });
      avisar(activo ? '✅ Zona de juegos activada' : '✅ Zona de juegos desactivada');
    } catch (err) {
      setJuegosActivos(!activo);
      avisar(`❌ ${err.response?.data?.error || 'No se pudo cambiar'}`);
    } finally {
      setGuardandoJuegos(false);
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

      <div className="card conf-card conf-aviso-marketing">
        <p className="conf-ayuda">
          📣 El enlace de tu {textos.menu}, el código QR, la foto de portada y los flyers para redes ahora están en{' '}
          <Link to="/marketing"><strong>Marketing</strong></Link>.
        </p>
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

      {/* Zona de juegos */}
      <div className="card conf-card">
        <div className="conf-switch-fila">
          <div>
            <h3 className="conf-titulo"><Gamepad2 size={18} /> Zona de juegos</h3>
            <p className="conf-ayuda">
              {juegosActivos
                ? `Activa: tus clientes ven el botón "🎲 Juegos" en tu ${textos.menu} (juegos para el celular con podio semanal y el contador de dominó).`
                : `Apagada: el botón de juegos no aparece en tu ${textos.menu}.`}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={juegosActivos}
            aria-label="Zona de juegos"
            className={`conf-switch ${juegosActivos ? 'on' : ''}`}
            onClick={() => cambiarJuegos(!juegosActivos)}
            disabled={!cargado || guardandoJuegos}
          >
            <span />
          </button>
        </div>
        {juegosActivos && <AdminJuegos key={`juegos-${moduloActivo.id}`} moduloId={moduloActivo.id} avisar={avisar} />}
      </div>

      <ConfigSellos key={`sellos-${moduloActivo.id}`} moduloId={moduloActivo.id}
        negocio={moduloActivo.nombre_publico || moduloActivo.nombre} avisar={avisar} />

      <ConfigResumenSemanal key={`resumen-${moduloActivo.id}`} moduloId={moduloActivo.id} avisar={avisar} />

      <ConfigRecordatorios key={`recordatorios-${moduloActivo.id}`} moduloId={moduloActivo.id} avisar={avisar} />

      <EquipoPermisos avisar={avisar} />

      <VolverPrimerosPasos key={`pasos-${moduloActivo.id}`} avisar={avisar} />

      <ConfigAsistente key={moduloActivo.id} moduloId={moduloActivo.id} textos={textos} avisar={avisar} />

    </div>
  );
};

export default ConfiguracionNegocio;
