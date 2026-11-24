import { useEffect, useState } from 'react';
import apiPublico from '../../services/apiPublico';

// ¿Este negocio tiene la zona de juegos encendida? null mientras carga.
export const useJuegosActivos = (moduloId) => {
  const [activos, setActivos] = useState(null);
  useEffect(() => {
    apiPublico.get(`/menu/${moduloId}`)
      .then(r => setActivos(r.data.modulo?.juegos_activos !== false))
      .catch(() => setActivos(false));
  }, [moduloId]);
  return activos;
};

// Catálogo de la zona de juegos. Los juegos con podio guardan puntaje.
export const JUEGOS = [
  { id: 'memoria', nombre: 'Memoria', emoji: '🧠', descripcion: 'Encuentra las parejas con la menor cantidad de jugadas.', edades: 'Todas las edades', colores: ['#7c3aed', '#c026d3'], podio: true },
  { id: 'fruta', nombre: 'Atrapa la fruta', emoji: '🍎', descripcion: 'Mueve la canasta, recoge frutas y esquiva las bombas.', edades: 'Niños y grandes', colores: ['#16a34a', '#65a30d'], podio: true },
  { id: 'culebrita', nombre: 'Culebrita', emoji: '🐍', descripcion: 'Come, crece y no te muerdas la cola.', edades: 'Clásico', colores: ['#0d9488', '#0284c7'], podio: true },
  { id: 'toque', nombre: 'Toque rápido', emoji: '⚡', descripcion: 'Toca los círculos antes de que desaparezcan. ¡30 segundos!', edades: 'Reflejos', colores: ['#f59e0b', '#ef4444'], podio: true },
  { id: 'calculo', nombre: 'Cálculo veloz', emoji: '➕', descripcion: 'Resuelve sumas, restas y multiplicaciones contra el reloj.', edades: 'Mente ágil', colores: ['#2563eb', '#4f46e5'], podio: true },
  { id: 'triqui', nombre: 'Tres en raya', emoji: '❌', descripcion: 'Juega contra el celular o con un amigo al lado.', edades: 'Para dos', colores: ['#e11d48', '#db2777'], podio: false }
];

export const AVATARES = ['🦊', '🐼', '🐯', '🦁', '🐸', '🐵', '🐙', '🦄', '🐲', '🦖', '🐧', '🦉', '🐝', '🐞', '🐬', '🦈', '👾', '🤖', '👻', '🎃', '⚽', '🎸', '🚀', '⭐'];

export const juegoPorId = (id) => JUEGOS.find(j => j.id === id);

// Perfil del jugador guardado en el celular (para no escribirlo cada vez).
export const leerPerfil = () => {
  try {
    const p = JSON.parse(localStorage.getItem('juegos-perfil') || 'null');
    return p && typeof p.nombre === 'string' ? p : { nombre: '', avatar: AVATARES[0] };
  } catch {
    return { nombre: '', avatar: AVATARES[0] };
  }
};
export const guardarPerfil = (perfil) => {
  try { localStorage.setItem('juegos-perfil', JSON.stringify(perfil)); } catch { /* modo privado */ }
};

// Mejor puntaje personal (en este celular) por juego.
export const mejorLocal = (juego) => {
  try { return Number(localStorage.getItem(`juegos-mejor-${juego}`)) || 0; } catch { return 0; }
};
export const registrarMejorLocal = (juego, puntaje) => {
  const antes = mejorLocal(juego);
  if (puntaje > antes) {
    try { localStorage.setItem(`juegos-mejor-${juego}`, String(puntaje)); } catch { /* modo privado */ }
    return true;
  }
  return false;
};

export const obtenerPodio = (moduloId, juego, periodo) =>
  apiPublico.get(`/menu/${moduloId}/juegos/podio`, { params: { juego, periodo } }).then(r => r.data).catch(() => []);

export const obtenerCampeones = (moduloId) =>
  apiPublico.get(`/menu/${moduloId}/juegos/campeones`).then(r => r.data).catch(() => ({}));

export const enviarPuntaje = (moduloId, datos) =>
  apiPublico.post(`/menu/${moduloId}/juegos/puntajes`, datos).then(r => r.data);

export const vibrar = (ms = 12) => { try { navigator.vibrate?.(ms); } catch { /* sin vibración */ } };

export const aleatorio = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
export const barajar = (lista) => {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
};
