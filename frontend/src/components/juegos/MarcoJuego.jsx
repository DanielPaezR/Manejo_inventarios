import React, { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import Podio from './Podio';
import { useJuegosActivos, juegoPorId, AVATARES, leerPerfil, guardarPerfil, mejorLocal, registrarMejorLocal, enviarPuntaje, guardarCodigo } from './comunes';
import JuegoMemoria from './JuegoMemoria';
import JuegoCulebrita from './JuegoCulebrita';
import JuegoToque from './JuegoToque';
import JuegoCalculo from './JuegoCalculo';
import JuegoFruta from './JuegoFruta';
import JuegoTriqui from './JuegoTriqui';
import './Juegos.css';
import './ZonaJuegos.css';

const COMPONENTES = {
  memoria: JuegoMemoria,
  culebrita: JuegoCulebrita,
  toque: JuegoToque,
  calculo: JuegoCalculo,
  fruta: JuegoFruta,
  triqui: JuegoTriqui
};

// Marco común de cada juego: cabecera, pantalla de inicio, el juego, y al
// terminar el puntaje con la opción de guardarlo en el podio del negocio.
const MarcoJuego = () => {
  const { moduloId, juegoId } = useParams();
  const juego = juegoPorId(juegoId);
  const Componente = COMPONENTES[juegoId];
  const activos = useJuegosActivos(moduloId);

  const [estado, setEstado] = useState('inicio'); // inicio | jugando | fin
  const [partida, setPartida] = useState(0);
  const [resultado, setResultado] = useState(null);
  const [perfil, setPerfil] = useState(leerPerfil);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(null);
  const [error, setError] = useState('');
  const [recargaPodio, setRecargaPodio] = useState(0);
  const [verPodio, setVerPodio] = useState(false);
  const [mejor, setMejor] = useState(() => mejorLocal(juegoId));

  useEffect(() => { if (juego) document.title = juego.nombre; }, [juego]);

  if (activos === false) {
    return (
      <div className="jg">
        <div className="jg-inicio" style={{ '--jg-c1': '#374151', '--jg-c2': '#1f2937' }}>
          <div className="jg-inicio__emoji">🎲</div>
          <p>Los juegos no están disponibles en este negocio.</p>
          <Link to={`/menu/${moduloId}`} className="jg-btn jg-btn--grande">Volver</Link>
        </div>
      </div>
    );
  }

  if (!juego || !Componente) {
    return (
      <div className="jg">
        <p>Este juego no existe.</p>
        <Link to={`/menu/${moduloId}/juegos`} className="jg-btn">Ver juegos</Link>
      </div>
    );
  }

  const empezar = () => {
    setResultado(null);
    setGuardado(null);
    setError('');
    setPartida(n => n + 1);
    setEstado('jugando');
  };

  const alTerminar = (res) => {
    const record = juego.podio && res.puntaje > 0 ? registrarMejorLocal(juegoId, res.puntaje) : false;
    if (record) setMejor(res.puntaje);
    setResultado({ ...res, record });
    setEstado('fin');
  };

  const guardar = async () => {
    try {
      setGuardando(true);
      setError('');
      guardarPerfil(perfil);
      const r = await enviarPuntaje(moduloId, {
        juego: juegoId, nombre: perfil.nombre, avatar: perfil.avatar,
        puntaje: resultado.puntaje, duracion: resultado.duracion
      });
      guardarCodigo(moduloId, r.codigo);
      setGuardado(r);
      setRecargaPodio(n => n + 1);
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo guardar el puntaje');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="jg jg-partida" style={{ '--jg-c1': juego.colores[0], '--jg-c2': juego.colores[1] }}>
      <header className="jg-cabecera">
        <Link to={`/menu/${moduloId}/juegos`} className="jg-volver" aria-label="Volver a juegos">‹</Link>
        <div>
          <h1>{juego.emoji} {juego.nombre}</h1>
          {juego.podio && <p>Tu récord: <b>{mejor.toLocaleString('es-CO')}</b></p>}
        </div>
        {juego.podio && (
          <button type="button" className="jg-volver" onClick={() => setVerPodio(v => !v)} aria-label="Ver podio">🏆</button>
        )}
      </header>

      {verPodio && estado !== 'fin' && <Podio moduloId={moduloId} juego={juegoId} recarga={recargaPodio} resaltarNombre={perfil.nombre} />}

      {estado === 'inicio' && (
        <div className="jg-inicio">
          <div className="jg-inicio__emoji">{juego.emoji}</div>
          <p>{juego.descripcion}</p>
          <button type="button" className="jg-btn jg-btn--grande" onClick={empezar}>¡Jugar!</button>
        </div>
      )}

      {estado !== 'inicio' && (
        <div className={`jg-area ${estado === 'fin' ? 'jg-area--fin' : ''}`}>
          <Componente key={partida} onFin={alTerminar} activo={estado === 'jugando'} />
        </div>
      )}

      {estado === 'fin' && resultado && (
        <div className="jg-fin" role="dialog" aria-modal="true" aria-label="Fin de la partida">
          <div className="jg-fin__caja">
            <span className="jg-fin__emoji">{resultado.record ? '🎉' : juego.emoji}</span>
            <h2>{resultado.titulo || (resultado.record ? '¡Nuevo récord!' : '¡Buena partida!')}</h2>
            {juego.podio && <div className="jg-fin__puntaje">{resultado.puntaje.toLocaleString('es-CO')}<small>puntos</small></div>}
            {resultado.detalle && <p className="jg-fin__detalle">{resultado.detalle}</p>}

            {juego.podio && resultado.puntaje > 0 && !guardado && (
              <div className="jg-guardar">
                <span>Guarda tu puntaje en el podio</span>
                <div className="jg-avatares" role="radiogroup" aria-label="Elige tu avatar">
                  {AVATARES.map(a => (
                    <button key={a} type="button" role="radio" aria-checked={perfil.avatar === a}
                      className={perfil.avatar === a ? 'activo' : ''} onClick={() => setPerfil(p => ({ ...p, avatar: a }))}>{a}</button>
                  ))}
                </div>
                <div className="jg-guardar__fila">
                  <input type="text" maxLength={18} placeholder="Tu nombre o apodo" value={perfil.nombre}
                    onChange={(e) => setPerfil(p => ({ ...p, nombre: e.target.value }))} />
                  <button type="button" className="jg-btn" onClick={guardar} disabled={guardando || perfil.nombre.trim().length < 2}>
                    {guardando ? '…' : 'Guardar'}
                  </button>
                </div>
                {error && <p className="jg-error">{error}</p>}
              </div>
            )}

            {guardado && (
              <p className="jg-fin__puesto">
                {guardado.puesto_semana <= 3 ? '🏆 ' : ''}Quedaste <b>#{guardado.puesto_semana}</b> esta semana
                {guardado.puesto_siempre <= 10 ? <> y <b>#{guardado.puesto_siempre}</b> de todos los tiempos</> : ''}.
              </p>
            )}

            {juego.podio && <Podio moduloId={moduloId} juego={juegoId} recarga={recargaPodio} resaltarNombre={guardado ? perfil.nombre : null} />}

            <div className="jg-fin__acciones">
              <Link to={`/menu/${moduloId}/juegos`} className="jg-btn jg-btn--suave">Otros juegos</Link>
              <button type="button" className="jg-btn" onClick={empezar}>Jugar otra vez</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MarcoJuego;
