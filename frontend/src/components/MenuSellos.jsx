import React, { useState, useEffect, useCallback } from 'react';
import apiPublico from '../services/apiPublico';
import TarjetaSellos from './TarjetaSellos';

// Contenido de la hoja "Mis sellos" del menú público: el cliente escribe
// su celular (se recuerda en este celular) y ve su tarjeta.
const CLAVE = 'sellos-telefono';
export const leerTelefonoSellos = () => { try { return localStorage.getItem(CLAVE) || ''; } catch { return ''; } };
export const guardarTelefonoSellos = (t) => { try { localStorage.setItem(CLAVE, t); } catch { /* modo privado */ } };

const MenuSellos = ({ moduloId, negocio, config }) => {
  const [telefono, setTelefono] = useState(leerTelefonoSellos);
  const [tarjeta, setTarjeta] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  const consultar = useCallback(async (numero) => {
    const limpio = String(numero || '').replace(/\D/g, '');
    if (limpio.length < 7) { setError('Escribe tu número de celular'); return; }
    try {
      setCargando(true);
      setError('');
      const r = await apiPublico.get(`/menu/${moduloId}/sellos`, { params: { telefono: limpio } });
      setTarjeta(r.data);
      guardarTelefonoSellos(limpio);
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo consultar tu tarjeta');
    } finally {
      setCargando(false);
    }
  }, [moduloId]);

  useEffect(() => {
    const guardado = leerTelefonoSellos();
    if (guardado) consultar(guardado);
  }, [consultar]);

  return (
    <div className="mv-sellos">
      <TarjetaSellos negocio={negocio} meta={tarjeta?.meta || config.meta} premio={tarjeta?.premio || config.premio}
        sellos={tarjeta?.sellos || 0} premios={tarjeta?.premios || 0} />

      <ul className="mv-sellos__como">
        <li><span>🛍️</span><div>Haz tu pedido desde este {config.textoMenu || 'menú'} con tu celular{config.minimo > 0 ? ` (desde $${config.minimo.toLocaleString('es-CO')})` : ''}.</div></li>
        <li><span>⭐</span><div>Cuando lo entreguemos, se suma un sello a tu tarjeta.</div></li>
        <li><span>🎁</span><div>Al completar {config.meta} sellos, reclama <b>{config.premio}</b> en caja.</div></li>
      </ul>

      <form className="mv-sellos__buscar" onSubmit={(e) => { e.preventDefault(); consultar(telefono); }}>
        <label className="mv-campo">
          <span>{tarjeta ? 'Tu celular' : 'Escribe tu celular para ver tus sellos'}</span>
          <input type="tel" inputMode="tel" autoComplete="tel" placeholder="Ej. 300 123 4567" value={telefono}
            onChange={(e) => setTelefono(e.target.value)} />
        </label>
        <button type="submit" className="mv-btn" disabled={cargando}>{cargando ? 'Buscando...' : 'Ver mi tarjeta'}</button>
      </form>
      {error && <p className="mv-error-envio" role="alert">{error}</p>}
    </div>
  );
};

export default MenuSellos;
