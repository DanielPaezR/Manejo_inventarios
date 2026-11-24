import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import apiPublico from '../../services/apiPublico';
import './Juegos.css';

// Juegos del negocio: herramientas para los clientes mientras están en el
// local. Hoy el contador de dominó; los demás quedan listos para después
// (incluso para jugar entre clientes, cada uno desde su celular).
const JUEGOS = [
  { id: 'domino', nombre: 'Dominó', icono: '🁫', descripcion: 'Marca las fichas que van saliendo y mira cuántas quedan de cada número.', listo: true },
  { id: 'ajedrez', nombre: 'Ajedrez', icono: '♞', descripcion: 'Reloj de ajedrez para dos jugadores.', listo: false },
  { id: 'cartas', nombre: 'Cartas', icono: '🂡', descripcion: 'Lleva la cuenta de las cartas y los puntos.', listo: false }
];

const Juegos = () => {
  const { moduloId } = useParams();
  const [negocio, setNegocio] = useState('');

  useEffect(() => {
    document.title = 'Juegos';
    apiPublico.get(`/menu/${moduloId}`).then(r => setNegocio(r.data.modulo?.nombre_publico || '')).catch(() => {});
  }, [moduloId]);

  return (
    <div className="jg">
      <header className="jg-cabecera">
        <Link to={`/menu/${moduloId}`} className="jg-volver" aria-label="Volver al menú">‹</Link>
        <div>
          <h1>Juegos</h1>
          <p>{negocio ? `Para jugar en ${negocio}` : 'Para jugar en el local'}</p>
        </div>
      </header>

      <div className="jg-lista">
        {JUEGOS.map(j => (j.listo ? (
          <Link key={j.id} to={`/menu/${moduloId}/juegos/${j.id}`} className="jg-tarjeta">
            <span className="jg-tarjeta__icono" aria-hidden="true">{j.icono}</span>
            <span className="jg-tarjeta__texto">
              <strong>{j.nombre}</strong>
              <small>{j.descripcion}</small>
            </span>
            <span className="jg-tarjeta__ir" aria-hidden="true">›</span>
          </Link>
        ) : (
          <div key={j.id} className="jg-tarjeta jg-tarjeta--pronto" aria-disabled="true">
            <span className="jg-tarjeta__icono" aria-hidden="true">{j.icono}</span>
            <span className="jg-tarjeta__texto">
              <strong>{j.nombre}</strong>
              <small>{j.descripcion}</small>
            </span>
            <span className="jg-pronto">Pronto</span>
          </div>
        )))}
      </div>

      <Link to={`/menu/${moduloId}`} className="jg-btn jg-btn--suave jg-btn--full">Ver el menú y pedir algo</Link>
    </div>
  );
};

export default Juegos;
