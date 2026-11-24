import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import apiPublico from '../../services/apiPublico';
import { JUEGOS, juegoPorId, leerPerfil, mejorLocal, obtenerCampeones, useJuegosActivos } from './comunes';
import './Juegos.css';
import './ZonaJuegos.css';

// Zona de juegos del negocio: juegos para el celular con podio semanal, y
// herramientas para los juegos de mesa (dominó; ajedrez y cartas después).
const HERRAMIENTAS = [
  { id: 'domino', nombre: 'Contador de dominó', icono: '🁫', descripcion: 'Marca las fichas que salen y mira cuántas quedan de cada número.', listo: true },
  { id: 'ajedrez', nombre: 'Reloj de ajedrez', icono: '♞', descripcion: 'Tiempo para dos jugadores.', listo: false },
  { id: 'cartas', nombre: 'Anotador de cartas', icono: '🂡', descripcion: 'Lleva los puntos de cada jugador.', listo: false }
];

const FLOTANTES = ['🎮', '🏆', '⭐', '🎲', '🍎', '🧠', '⚡', '🐍'];

const Juegos = () => {
  const { moduloId } = useParams();
  const [negocio, setNegocio] = useState('');
  const [campeones, setCampeones] = useState({});
  const perfil = leerPerfil();
  const activos = useJuegosActivos(moduloId);

  useEffect(() => {
    document.title = 'Zona de juegos';
    apiPublico.get(`/menu/${moduloId}`).then(r => setNegocio(r.data.modulo?.nombre_publico || '')).catch(() => {});
    obtenerCampeones(moduloId).then(setCampeones);
  }, [moduloId]);

  if (activos === false) {
    return (
      <div className="jg">
        <div className="jg-inicio" style={{ '--jg-c1': '#374151', '--jg-c2': '#1f2937' }}>
          <div className="jg-inicio__emoji">🎲</div>
          <p>Los juegos no están disponibles en este negocio.</p>
          <Link to={`/menu/${moduloId}`} className="jg-btn jg-btn--grande">Ver el menú</Link>
        </div>
      </div>
    );
  }

  const listaCampeones = Object.entries(campeones).map(([juego, c]) => ({ juego: juegoPorId(juego), ...c })).filter(c => c.juego);

  return (
    <div className="jg jg-zona">
      <header className="jz-hero">
        <div className="jz-flotantes" aria-hidden="true">
          {FLOTANTES.map((e, i) => <span key={i} style={{ '--i': i }}>{e}</span>)}
        </div>
        <Link to={`/menu/${moduloId}`} className="jg-volver jz-volver" aria-label="Volver al menú">‹</Link>
        <small>{negocio || 'Zona de juegos'}</small>
        <h1>Zona de<br />juegos</h1>
        <p>Juega desde tu celular, rompe récords y sube al podio de la semana.</p>
        {perfil.nombre && <span className="jz-jugador">{perfil.avatar} Hola, {perfil.nombre}</span>}
      </header>

      {listaCampeones.length > 0 && (
        <section className="jz-seccion">
          <h2>🏆 Campeones de la semana</h2>
          <div className="jz-campeones">
            {listaCampeones.map(c => (
              <Link key={c.juego.id} to={`/menu/${moduloId}/juegos/${c.juego.id}`} className="jz-campeon"
                style={{ '--jg-c1': c.juego.colores[0], '--jg-c2': c.juego.colores[1] }}>
                <span className="jz-campeon__avatar">{c.avatar}</span>
                <strong>{c.nombre}</strong>
                <small>{c.juego.emoji} {c.juego.nombre}</small>
                <b>{c.puntaje.toLocaleString('es-CO')}</b>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="jz-seccion">
        <h2>🎮 Juegos</h2>
        <div className="jz-juegos">
          {JUEGOS.map((j, i) => {
            const record = j.podio ? mejorLocal(j.id) : 0;
            return (
              <Link key={j.id} to={`/menu/${moduloId}/juegos/${j.id}`} className="jz-juego"
                style={{ '--jg-c1': j.colores[0], '--jg-c2': j.colores[1], '--i': i }}>
                <span className="jz-juego__emoji">{j.emoji}</span>
                <strong>{j.nombre}</strong>
                <small>{j.edades}</small>
                {record > 0 && <span className="jz-juego__record">Tu récord {record.toLocaleString('es-CO')}</span>}
                {j.podio && <span className="jz-juego__podio" title="Tiene podio">🏆</span>}
              </Link>
            );
          })}
        </div>
      </section>

      <section className="jz-seccion">
        <h2>🎲 Para la mesa</h2>
        <div className="jg-lista">
          {HERRAMIENTAS.map(h => (h.listo ? (
            <Link key={h.id} to={`/menu/${moduloId}/juegos/${h.id}`} className="jg-tarjeta">
              <span className="jg-tarjeta__icono" aria-hidden="true">{h.icono}</span>
              <span className="jg-tarjeta__texto"><strong>{h.nombre}</strong><small>{h.descripcion}</small></span>
              <span className="jg-tarjeta__ir" aria-hidden="true">›</span>
            </Link>
          ) : (
            <div key={h.id} className="jg-tarjeta jg-tarjeta--pronto" aria-disabled="true">
              <span className="jg-tarjeta__icono" aria-hidden="true">{h.icono}</span>
              <span className="jg-tarjeta__texto"><strong>{h.nombre}</strong><small>{h.descripcion}</small></span>
              <span className="jg-pronto">Pronto</span>
            </div>
          )))}
        </div>
      </section>

      <Link to={`/menu/${moduloId}`} className="jg-btn jg-btn--full">🍽️ ¿Hambre? Ver el menú y pedir</Link>
    </div>
  );
};

export default Juegos;
