import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import './AdminJuegos.css';

// Dentro de la tarjeta "Zona de juegos" de Configuración: premio semanal
// para los campeones, entrega de premios con código y moderación del podio.
const AdminJuegos = ({ moduloId, avisar }) => {
  const [datos, setDatos] = useState(null);
  const [descripcion, setDescripcion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [canjeado, setCanjeado] = useState(null);
  const [verTodos, setVerTodos] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await api.get('/juegos/admin');
      setDatos(res.data);
      setDescripcion(res.data.premio.descripcion || '');
    } catch (err) {
      console.error('Error cargando administración de juegos:', err);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar, moduloId]);

  const guardarPremio = async (activo) => {
    try {
      setGuardando(true);
      await api.put('/juegos/admin/premio', { activo, descripcion });
      avisar(activo ? '✅ Premio semanal activado' : 'Premio semanal apagado');
      cargar();
    } catch (err) {
      avisar(`❌ ${err.response?.data?.error || 'No se pudo guardar'}`);
    } finally {
      setGuardando(false);
    }
  };

  const canjear = async (e) => {
    e.preventDefault();
    try {
      setCanjeado(null);
      const res = await api.post('/juegos/admin/canjear', { codigo });
      setCanjeado(res.data);
      setCodigo('');
      cargar();
    } catch (err) {
      avisar(`❌ ${err.response?.data?.error || 'No se pudo validar el código'}`);
    }
  };

  const moderar = async (p, oculto, todosDelNombre = false) => {
    try {
      const res = await api.put(`/juegos/admin/puntajes/${p.id}`, { oculto, todos_del_nombre: todosDelNombre });
      avisar(oculto
        ? `🙈 ${res.data.afectados === 1 ? 'Puntaje oculto' : `${res.data.afectados} puntajes ocultos`} del podio`
        : '👀 Puntaje visible otra vez');
      cargar();
    } catch (err) {
      avisar(`❌ ${err.response?.data?.error || 'No se pudo cambiar'}`);
    }
  };

  if (!datos) return null;
  const { premio, recientes, ganadores } = datos;
  const pendientes = ganadores.filter(g => !g.premio_canjeado_en);
  const lista = verTodos ? recientes : recientes.slice(0, 12);

  return (
    <div className="aj">
      <h4 className="conf-subtitulo">🎁 Premio para el campeón de la semana</h4>
      <p className="conf-ayuda">
        Motiva a tus clientes a volver: quien termine primero en el podio semanal de cada juego gana algo.
        Al ganar, en su celular le aparece un código que muestra en caja.
      </p>
      <div className="aj-premio">
        <input type="text" maxLength={120} placeholder="Ej. Una gaseosa personal gratis" value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)} />
        {premio.activo ? (
          <>
            <button type="button" className="conf-btn" onClick={() => guardarPremio(true)} disabled={guardando}>Guardar</button>
            <button type="button" className="conf-btn" onClick={() => guardarPremio(false)} disabled={guardando}>Apagar</button>
          </>
        ) : (
          <button type="button" className="conf-btn conf-btn-primario" onClick={() => guardarPremio(true)}
            disabled={guardando || !descripcion.trim()}>Activar premio</button>
        )}
      </div>
      {premio.activo && <p className="aj-estado">✅ Activo. Los clientes lo ven en la zona de juegos.</p>}

      <h4 className="conf-subtitulo">🎟️ Entregar un premio</h4>
      <form className="aj-premio" onSubmit={canjear}>
        <input type="text" placeholder="Código del cliente" value={codigo} className="aj-codigo"
          onChange={(e) => setCodigo(e.target.value.toUpperCase())} maxLength={12} autoCapitalize="characters" />
        <button type="submit" className="conf-btn conf-btn-primario" disabled={codigo.trim().length < 4}>Validar</button>
      </form>
      {canjeado && (
        <p className="aj-canjeado">
          ✅ Válido. Entrega el premio a <strong>{canjeado.avatar} {canjeado.nombre}</strong>, campeón de {canjeado.juego} con {canjeado.puntaje.toLocaleString('es-CO')} puntos.
        </p>
      )}
      {ganadores.length > 0 && (
        <div className="aj-ganadores">
          {ganadores.map(g => (
            <div key={g.id} className={`aj-ganador ${g.premio_canjeado_en ? 'entregado' : ''}`}>
              <span>{g.avatar}</span>
              <div><strong>{g.nombre}</strong><small>{g.juego_nombre} · semana del {new Date(`${g.semana}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}</small></div>
              <em>{g.premio_canjeado_en ? 'Entregado' : 'Pendiente'}</em>
            </div>
          ))}
          {pendientes.length > 0 && <p className="conf-nota">Los premios se pueden reclamar hasta 7 días después de cerrar la semana.</p>}
        </div>
      )}

      <h4 className="conf-subtitulo">🛡️ Moderar el podio</h4>
      <p className="conf-ayuda">Últimos puntajes guardados. Oculta los que tengan nombres feos o parezcan trampa: dejan de salir en el podio.</p>
      {recientes.length === 0 ? (
        <p className="conf-nota">Todavía nadie ha guardado puntajes.</p>
      ) : (
        <div className="aj-lista">
          {lista.map(p => (
            <div key={p.id} className={`aj-fila ${p.oculto ? 'oculto' : ''}`}>
              <span className="aj-avatar">{p.avatar}</span>
              <div className="aj-info">
                <strong>{p.nombre}</strong>
                <small>{p.juego_nombre} · {p.puntaje.toLocaleString('es-CO')} pts · {new Date(p.creado_en).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}</small>
              </div>
              {p.oculto ? (
                <button type="button" className="aj-btn" onClick={() => moderar(p, false)}>Mostrar</button>
              ) : (
                <div className="aj-acciones">
                  <button type="button" className="aj-btn aj-btn--ocultar" onClick={() => moderar(p, true)}>Ocultar</button>
                  <button type="button" className="aj-btn aj-btn--ocultar" title="Oculta todos los puntajes con este nombre"
                    onClick={() => moderar(p, true, true)}>Ocultar nombre</button>
                </div>
              )}
            </div>
          ))}
          {recientes.length > 12 && (
            <button type="button" className="conf-btn" onClick={() => setVerTodos(v => !v)}>
              {verTodos ? 'Ver menos' : `Ver los ${recientes.length} más recientes`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminJuegos;
