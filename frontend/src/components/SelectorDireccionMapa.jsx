import React, { useState } from 'react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import apiPublico from '../services/apiPublico';
import './SelectorDireccionMapa.css';

// Bogotá, como punto de partida cuando Nominatim no encuentra la dirección
// escrita — el cliente arrastra el pin desde ahí hasta su ubicación real.
const CENTRO_DEFECTO = { lat: 4.7110, lng: -74.0721 };

// Mismo truco que RutaEntregas.jsx: L.divIcon en vez de los íconos por
// defecto de Leaflet, que no cargan bien empaquetados con Vite.
const iconoPin = L.divIcon({
  className: 'sdm-pin',
  html: '<div class="sdm-pin-gota"></div>',
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});

// Confirmación de dirección en mapa para el checkout del menú público
// (Tanda de domicilio con mapa): el cliente escribe la dirección a mano,
// este componente la geocodifica contra Nominatim (vía backend, que ya
// tiene el User-Agent y el rate-limit correctos — un fetch de navegador no
// puede fijar esos headers) y muestra un pin arrastrable para que la
// ajuste antes de confirmar. Así el pedido siempre lleva una ubicación que
// el propio cliente validó, no solo texto libre.
//
// Contrato con el padre: `direccion` es el texto actual del input (que el
// padre sigue controlando); `ubicacion` es `{ lat, lng, direccion } | null`
// que el padre guarda tal cual se lo pasa `onConfirmar`. Si `direccion`
// cambia después de confirmar (el cliente edita el texto), este
// componente deja de mostrarse como "confirmado" porque compara
// `ubicacion.direccion` contra `direccion` — no hace falta que el padre
// limpie nada a mano.
const SelectorDireccionMapa = ({ direccion, ubicacion, onConfirmar }) => {
  const [buscando, setBuscando] = useState(false);
  const [marcador, setMarcador] = useState(null); // { lat, lng } mientras se ajusta, antes de confirmar
  const [avisoNoEncontrada, setAvisoNoEncontrada] = useState(false);

  const direccionTrim = (direccion || '').trim();
  const yaConfirmada = !!ubicacion && ubicacion.direccion === direccionTrim;

  const buscarEnMapa = async () => {
    if (!direccionTrim) return;
    setBuscando(true);
    setAvisoNoEncontrada(false);
    try {
      const response = await apiPublico.get('/menu/geocodificar', { params: { direccion: direccionTrim } });
      setMarcador({ lat: response.data.lat, lng: response.data.lng });
    } catch (error) {
      setAvisoNoEncontrada(true);
      setMarcador({ ...CENTRO_DEFECTO });
    } finally {
      setBuscando(false);
    }
  };

  const confirmarUbicacion = () => {
    if (!marcador) return;
    onConfirmar({ lat: marcador.lat, lng: marcador.lng, direccion: direccionTrim });
    setMarcador(null);
    setAvisoNoEncontrada(false);
  };

  if (yaConfirmada && !marcador) {
    return (
      <div className="sdm-confirmado">
        <span>✅ Ubicación confirmada en el mapa</span>
        <button
          type="button"
          onClick={() => setMarcador({ lat: ubicacion.lat, lng: ubicacion.lng })}
          className="sdm-btn-ajustar"
        >
          ✏️ Ajustar
        </button>
      </div>
    );
  }

  if (!marcador) {
    return (
      <button
        type="button"
        onClick={buscarEnMapa}
        disabled={buscando || !direccionTrim}
        className="mp-btn sdm-btn-buscar"
      >
        {buscando ? 'Buscando...' : '📍 Confirmar ubicación en el mapa'}
      </button>
    );
  }

  return (
    <div className="sdm-mapa-wrapper">
      {avisoNoEncontrada && (
        <p className="sdm-aviso">No pudimos ubicar esa dirección automáticamente. Arrastra el pin hasta tu ubicación.</p>
      )}
      <div className="sdm-mapa">
        <MapContainer center={[marcador.lat, marcador.lng]} zoom={16} scrollWheelZoom={false}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Marker
            position={[marcador.lat, marcador.lng]}
            icon={iconoPin}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const { lat, lng } = e.target.getLatLng();
                setMarcador({ lat, lng });
              }
            }}
          />
        </MapContainer>
      </div>
      <p className="sdm-hint">Arrastra el pin si no cayó en el lugar correcto.</p>
      <button type="button" onClick={confirmarUbicacion} className="mp-btn mp-btn--primary sdm-btn-confirmar">
        ✅ Confirmar esta ubicación
      </button>
    </div>
  );
};

export default SelectorDireccionMapa;
