import React, { useState } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import apiPublico from '../services/apiPublico';
import './SelectorDireccionMapa.css';

// Si el negocio no ha marcado dónde queda su local, el mapa arranca en
// Bogotá y el cliente se mueve desde ahí.
const CENTRO_DEFECTO = { lat: 4.7110, lng: -74.0721 };

// El pin queda fijo en el centro y lo que se mueve es el mapa (como en las
// apps de domicilios): en el celular es mucho más fácil que arrastrar un
// pin chiquito. Tocar un punto del mapa también lo lleva al centro.
const SeguirCentro = ({ onMover }) => {
  const map = useMapEvents({
    move: () => {
      const c = map.getCenter();
      onMover({ lat: c.lat, lng: c.lng });
    },
    click: (e) => map.panTo(e.latlng)
  });
  return null;
};

const Recentrar = ({ centro, zoom }) => {
  const map = useMap();
  React.useEffect(() => {
    map.setView([centro.lat, centro.lng], zoom ?? map.getZoom());
  }, [centro, zoom, map]);
  return null;
};

// Ubicación de entrega para un domicilio (menú público) o del local
// (configuración del negocio). Dos formas de llegar al punto:
// - "Usar mi ubicación actual": el GPS del celular (lo más preciso).
// - "Buscar en el mapa": busca lo escrito en `direccion` cerca de `centro`
//   (el local del negocio). La búsqueda ubica la calle, no la casa, así que
//   siempre se termina de ajustar moviendo el mapa.
//
// Contrato con el padre: `direccion` es el texto del input (lo controla el
// padre); `ubicacion` es `{ lat, lng, direccion } | null` y el padre la
// guarda tal cual se la pasa `onConfirmar`. Una vez confirmado, el punto
// vale aunque el cliente siga editando el texto (ej. agrega el apto); solo
// se le avisa por si cambió de dirección.
const SelectorDireccionMapa = ({
  direccion, ubicacion, onConfirmar, centro = null,
  textoConfirmar = '✅ Mi casa está aquí', textoConfirmado = '✅ Ubicación marcada en el mapa'
}) => {
  const [abierto, setAbierto] = useState(false);
  const [vista, setVista] = useState(null); // { lat, lng, zoom } a donde mover el mapa
  const [punto, setPunto] = useState(null); // centro actual del mapa
  const [buscando, setBuscando] = useState('');
  const [aviso, setAviso] = useState('');

  const direccionTrim = (direccion || '').trim();
  const cambioTexto = !!ubicacion && !!ubicacion.direccion && ubicacion.direccion !== direccionTrim;

  const abrirEn = (lat, lng, zoom, mensaje = '') => {
    setVista({ lat, lng, zoom });
    setPunto({ lat, lng });
    setAviso(mensaje);
    setAbierto(true);
  };

  const usarGps = () => {
    if (!navigator.geolocation) {
      setAviso('Este navegador no deja usar la ubicación. Busca tu dirección o mueve el mapa.');
      return;
    }
    setBuscando('gps');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBuscando('');
        const precision = Math.round(pos.coords.accuracy || 0);
        abrirEn(pos.coords.latitude, pos.coords.longitude, 18,
          precision > 80 ? `Tu celular te ubicó con unos ${precision} m de margen: revisa que el pin quede en tu casa.` : '');
      },
      (err) => {
        setBuscando('');
        const base = centro || CENTRO_DEFECTO;
        abrirEn(base.lat, base.lng, centro ? 15 : 12, err.code === 1
          ? 'No diste permiso para usar tu ubicación. Mueve el mapa hasta tu casa.'
          : 'No pudimos obtener tu ubicación. Mueve el mapa hasta tu casa.');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  };

  const buscarDireccion = async () => {
    if (!direccionTrim) return;
    setBuscando('direccion');
    try {
      const params = { direccion: direccionTrim };
      if (centro) Object.assign(params, { cerca_lat: centro.lat, cerca_lng: centro.lng });
      const { data } = await apiPublico.get('/menu/geocodificar', { params });
      abrirEn(data.lat, data.lng, 17, 'Encontramos la calle: mueve el mapa para dejar el pin justo en tu casa.');
    } catch {
      const base = centro || CENTRO_DEFECTO;
      abrirEn(base.lat, base.lng, centro ? 15 : 12, 'No encontramos esa dirección. Mueve el mapa hasta tu casa.');
    } finally {
      setBuscando('');
    }
  };

  const confirmar = () => {
    if (!punto) return;
    onConfirmar({ lat: punto.lat, lng: punto.lng, direccion: direccionTrim });
    setAbierto(false);
    setAviso('');
  };

  if (ubicacion && !abierto) {
    return (
      <div className="sdm-confirmado-caja">
        <div className="sdm-confirmado">
          <span>{textoConfirmado}</span>
          <button type="button" onClick={() => abrirEn(ubicacion.lat, ubicacion.lng, 18)} className="sdm-btn-ajustar">
            ✏️ Ajustar
          </button>
        </div>
        {cambioTexto && (
          <p className="sdm-nota">¿Cambiaste de dirección? Toca "Ajustar" y revisa que el pin siga en el lugar correcto.</p>
        )}
      </div>
    );
  }

  if (!abierto) {
    return (
      <div className="sdm-opciones">
        <button type="button" onClick={usarGps} disabled={!!buscando} className="mp-btn mp-btn--primary sdm-btn-buscar">
          {buscando === 'gps' ? 'Buscando tu ubicación...' : '🎯 Usar mi ubicación actual'}
        </button>
        <button
          type="button"
          onClick={buscarDireccion}
          disabled={!!buscando || !direccionTrim}
          className="mp-btn sdm-btn-buscar"
          title={!direccionTrim ? 'Escribe primero la dirección' : ''}
        >
          {buscando === 'direccion' ? 'Buscando...' : '📍 Buscar la dirección en el mapa'}
        </button>
        {aviso && <p className="sdm-aviso">{aviso}</p>}
      </div>
    );
  }

  return (
    <div className="sdm-mapa-wrapper">
      {aviso && <p className="sdm-aviso">{aviso}</p>}
      <div className="sdm-mapa">
        <MapContainer center={[vista.lat, vista.lng]} zoom={vista.zoom} scrollWheelZoom={false}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Recentrar centro={vista} zoom={vista.zoom} />
          <SeguirCentro onMover={setPunto} />
        </MapContainer>
        <div className="sdm-pin-sombra" aria-hidden="true" />
        <div className="sdm-pin-fijo" aria-hidden="true"><div className="sdm-pin-gota" /></div>
      </div>
      <p className="sdm-hint">Mueve el mapa o toca un punto hasta que el pin quede en la entrada.</p>
      <div className="sdm-acciones">
        <button type="button" onClick={usarGps} disabled={!!buscando} className="mp-btn sdm-btn-gps" title="Usar mi ubicación actual">
          {buscando === 'gps' ? '...' : '🎯'}
        </button>
        <button type="button" onClick={confirmar} className="mp-btn mp-btn--primary sdm-btn-confirmar">
          {textoConfirmar}
        </button>
      </div>
      {ubicacion && (
        <button type="button" className="sdm-btn-ajustar sdm-btn-cancelar" onClick={() => { setAbierto(false); setAviso(''); }}>
          Cancelar
        </button>
      )}
    </div>
  );
};

export default SelectorDireccionMapa;
