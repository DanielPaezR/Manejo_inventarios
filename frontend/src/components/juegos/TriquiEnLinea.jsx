import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import apiPublico from '../../services/apiPublico';
import { AVATARES, leerPerfil, guardarPerfil, vibrar } from './comunes';

// Tres en raya entre dos celulares: uno crea la sala y comparte el código
// (o el enlace), el otro entra con él. El estado se consulta cada segundo.
const claveToken = (moduloId, codigo) => `sala-${moduloId}-${codigo}`;
const leerToken = (moduloId, codigo) => { try { return localStorage.getItem(claveToken(moduloId, codigo)) || ''; } catch { return ''; } };
const guardarToken = (moduloId, codigo, token) => { try { localStorage.setItem(claveToken(moduloId, codigo), token); } catch { /* modo privado */ } };

const TriquiEnLinea = ({ codigoInicial = '', onSalir }) => {
  const { moduloId } = useParams();
  const [perfil, setPerfil] = useState(leerPerfil);
  const [codigo, setCodigo] = useState(codigoInicial.toUpperCase());
  const [sala, setSala] = useState(null);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const versionRef = useRef(0);

  const base = `/menu/${moduloId}/salas`;
  const aplicar = useCallback((nueva) => {
    if (nueva.version !== versionRef.current) {
      // Vibra cuando el rival juega o entra.
      if (versionRef.current && nueva.estado.turno === nueva.yo && !nueva.estado.resultado) vibrar(15);
      versionRef.current = nueva.version;
      setError('');
      setSala(nueva);
    }
  }, []);

  // Volver a una sala de este celular (ej. recargó la página).
  useEffect(() => {
    if (!codigoInicial) return;
    const guardado = leerToken(moduloId, codigoInicial.toUpperCase());
    if (guardado) entrar(codigoInicial, guardado);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Consulta el estado cada segundo mientras se está en la sala.
  useEffect(() => {
    if (!sala) return undefined;
    let vivo = true;
    const id = setInterval(async () => {
      if (document.hidden) return;
      try {
        const r = await apiPublico.get(`${base}/${sala.codigo}`, { params: { token } });
        if (vivo) aplicar(r.data);
      } catch (err) {
        if (vivo && err.response?.status === 404) setError('La sala se cerró.');
      }
    }, 1100);
    return () => { vivo = false; clearInterval(id); };
  }, [sala?.codigo, token, base, aplicar]); // eslint-disable-line react-hooks/exhaustive-deps

  const validarPerfil = () => {
    if (perfil.nombre.trim().length < 2) { setError('Escribe tu nombre (mínimo 2 letras)'); return false; }
    guardarPerfil(perfil);
    return true;
  };

  const crear = async () => {
    if (!validarPerfil()) return;
    try {
      setOcupado(true); setError('');
      const r = await apiPublico.post(base, { juego: 'triqui', nombre: perfil.nombre, avatar: perfil.avatar });
      guardarToken(moduloId, r.data.sala.codigo, r.data.token);
      setToken(r.data.token);
      aplicar(r.data.sala);
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo crear la sala');
    } finally {
      setOcupado(false);
    }
  };

  const entrar = async (cod = codigo, tokenGuardado = '') => {
    const limpio = String(cod).toUpperCase().replace(/[^A-Z]/g, '');
    if (limpio.length < 4) { setError('Escribe el código de 4 letras'); return; }
    if (!tokenGuardado && !validarPerfil()) return;
    try {
      setOcupado(true); setError('');
      const r = await apiPublico.post(`${base}/${limpio}/unirse`, {
        nombre: perfil.nombre, avatar: perfil.avatar, token: tokenGuardado || leerToken(moduloId, limpio)
      });
      guardarToken(moduloId, limpio, r.data.token);
      setToken(r.data.token);
      aplicar(r.data.sala);
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo entrar a la sala');
    } finally {
      setOcupado(false);
    }
  };

  const jugar = async (i) => {
    if (!sala || sala.estado.resultado || sala.estado.turno !== sala.yo || sala.estado.tablero[i] || !sala.o) return;
    vibrar(8);
    // Se pinta de una vez; si el servidor lo rechaza, se corrige en la próxima consulta.
    setSala(s => ({ ...s, estado: { ...s.estado, tablero: s.estado.tablero.map((v, k) => (k === i ? s.yo : v)), turno: s.yo === 'X' ? 'O' : 'X' } }));
    try {
      const r = await apiPublico.post(`${base}/${sala.codigo}/jugar`, { token, casilla: i });
      aplicar(r.data);
      if (r.data.estado.resultado) vibrar(r.data.estado.resultado.quien === sala.yo ? 80 : 30);
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo jugar');
      versionRef.current = 0;
    }
  };

  const revancha = async () => {
    try {
      const r = await apiPublico.post(`${base}/${sala.codigo}/revancha`, { token });
      aplicar(r.data);
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo empezar otra');
    }
  };

  const compartir = async () => {
    const enlace = `${window.location.origin}/menu/${moduloId}/juegos/triqui?sala=${sala.codigo}`;
    const texto = `¿Una de tres en raya? Entra con el código ${sala.codigo}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'Tres en raya', text: texto, url: enlace }); return; }
      await navigator.clipboard.writeText(`${texto}: ${enlace}`);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { /* canceló */ }
  };

  // ---------- Antes de entrar a una sala ----------
  if (!sala) {
    return (
      <div className="jtl">
        <p className="jtl__intro">Juega con alguien de otra mesa, cada uno desde su celular.</p>
        <label className="jtl__campo">
          <span>Tu nombre</span>
          <input type="text" maxLength={18} value={perfil.nombre} placeholder="Ej. Laura"
            onChange={(e) => setPerfil(p => ({ ...p, nombre: e.target.value }))} />
        </label>
        <div className="jtl__avatares" role="radiogroup" aria-label="Elige tu avatar">
          {AVATARES.slice(0, 12).map(a => (
            <button key={a} type="button" role="radio" aria-checked={perfil.avatar === a}
              className={perfil.avatar === a ? 'activo' : ''} onClick={() => setPerfil(p => ({ ...p, avatar: a }))}>{a}</button>
          ))}
        </div>
        <button type="button" className="jg-btn jg-btn--full" onClick={crear} disabled={ocupado}>🎲 Crear sala y compartir código</button>
        <div className="jtl__o"><span>o entra a una sala</span></div>
        <form className="jtl__unirse" onSubmit={(e) => { e.preventDefault(); entrar(); }}>
          <input type="text" inputMode="text" autoCapitalize="characters" maxLength={4} placeholder="CÓDIGO" value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} aria-label="Código de la sala" />
          <button type="submit" className="jg-btn" disabled={ocupado || codigo.length < 4}>Entrar</button>
        </form>
        {error && <p className="jtl__error" role="alert">{error}</p>}
        <button type="button" className="jg-btn jg-btn--suave" onClick={onSalir}>‹ Otras formas de jugar</button>
      </div>
    );
  }

  const { estado, x, o, yo } = sala;
  const rival = yo === 'X' ? o : x;
  const r = estado.resultado;
  const mensaje = !o ? 'Esperando a tu rival…'
    : r ? (r.quien === 'empate' ? '¡Empate!' : r.quien === yo ? '¡Ganaste! 🎉' : `Ganó ${rival?.nombre}`)
      : estado.turno === yo ? 'Tu turno' : `Turno de ${rival?.nombre}`;

  // ---------- Esperando al rival ----------
  if (!o) {
    return (
      <div className="jtl jtl--espera">
        <p>Comparte este código con quien quieras retar:</p>
        <div className="jtl__codigo" aria-label={`Código ${sala.codigo}`}>
          {sala.codigo.split('').map((l, i) => <span key={i}>{l}</span>)}
        </div>
        <button type="button" className="jg-btn jg-btn--full" onClick={compartir}>{copiado ? '✓ Enlace copiado' : '📤 Compartir enlace'}</button>
        <p className="jtl__esperando"><span className="jtl__puntos" aria-hidden="true"><i /><i /><i /></span> Esperando a tu rival…</p>
        {error && <p className="jtl__error" role="alert">{error}</p>}
      </div>
    );
  }

  // ---------- Partida ----------
  return (
    <div className="jtr jtl--partida">
      <div className="jtl__marcador">
        <div className={`jtl__jugador ${estado.turno === 'X' && !r ? 'turno' : ''} ${yo === 'X' ? 'yo' : ''}`}>
          <span>{x.avatar}</span><b>{x.nombre}</b><small>✕ · {estado.marcador.X}</small>
        </div>
        <span className="jtl__vs">{estado.marcador.empates > 0 ? `${estado.marcador.empates} emp.` : 'vs'}</span>
        <div className={`jtl__jugador ${estado.turno === 'O' && !r ? 'turno' : ''} ${yo === 'O' ? 'yo' : ''}`}>
          <span>{o.avatar}</span><b>{o.nombre}</b><small>◯ · {estado.marcador.O}</small>
        </div>
      </div>
      <p className={`jtl__estado ${estado.turno === yo && !r ? 'mio' : ''}`}>{mensaje}</p>
      <div className="jtr-tablero">
        {estado.tablero.map((v, i) => (
          <button key={i} type="button" className={`jtr-celda ${v ? `jtr-celda--${v}` : ''} ${r?.linea.includes(i) ? 'gana' : ''}`}
            onClick={() => jugar(i)} aria-label={v || `Casilla ${i + 1}`} disabled={!!v || !!r || estado.turno !== yo}>
            {v === 'X' ? '✕' : v === 'O' ? '◯' : ''}
          </button>
        ))}
      </div>
      {r && <button type="button" className="jg-btn jg-btn--full" onClick={revancha}>🔁 Revancha</button>}
      {error && <p className="jtl__error" role="alert">{error}</p>}
      <p className="jtl__sala">Sala {sala.codigo}</p>
    </div>
  );
};

export default TriquiEnLinea;
