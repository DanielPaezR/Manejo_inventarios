import React, { useState, useEffect, useCallback } from 'react';
import { Stamp } from 'lucide-react';
import api from '../services/api';
import TarjetaSellos from './TarjetaSellos';
import './ConfigSellos.css';

// Tarjeta de sellos: configuración, buscar a un cliente por celular para
// sellarle a mano o entregarle el premio, y quiénes van más cerca.
const formatoTel = (t) => (t && t.length === 10 ? `${t.slice(0, 3)} ${t.slice(3, 6)} ${t.slice(6)}` : t);

const ConfigSellos = ({ moduloId, negocio, avisar }) => {
  const [datos, setDatos] = useState(null);
  const [form, setForm] = useState({ premio: '', meta: 10, minimo: 0 });
  const [guardando, setGuardando] = useState(false);
  const [telefono, setTelefono] = useState('');
  const [nombre, setNombre] = useState('');
  const [cliente, setCliente] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await api.get('/sellos');
      setDatos(res.data);
      setForm({ premio: res.data.config.premio, meta: res.data.config.meta, minimo: res.data.config.minimo });
    } catch (err) {
      console.error('Error cargando tarjeta de sellos:', err);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar, moduloId]);

  const guardar = async (activo) => {
    try {
      setGuardando(true);
      await api.put('/sellos/config', { ...form, meta: Number(form.meta), minimo: Number(form.minimo) || 0, activo });
      avisar(activo ? '✅ Tarjeta de sellos activa' : 'Tarjeta de sellos apagada');
      cargar();
    } catch (err) {
      avisar(`❌ ${err.response?.data?.error || 'No se pudo guardar'}`);
    } finally {
      setGuardando(false);
    }
  };

  const buscar = async (e) => {
    e?.preventDefault();
    try {
      setOcupado(true);
      const res = await api.get('/sellos', { params: { telefono } });
      if (!res.data.telefono) { avisar('❌ Escribe un número de celular válido'); return; }
      setCliente(res.data);
    } catch (err) {
      avisar(`❌ ${err.response?.data?.error || 'No se pudo buscar'}`);
    } finally {
      setOcupado(false);
    }
  };

  const accion = async (ruta, mensaje) => {
    try {
      setOcupado(true);
      const res = await api.post(`/sellos/${ruta}`, { telefono: cliente.telefono, nombre });
      setCliente(res.data);
      avisar(mensaje);
      cargar();
    } catch (err) {
      avisar(`❌ ${err.response?.data?.error || 'No se pudo guardar'}`);
    } finally {
      setOcupado(false);
    }
  };

  if (!datos) return null;
  const { config, clientes } = datos;

  return (
    <div className="card conf-card">
      <div className="conf-switch-fila">
        <div>
          <h3 className="conf-titulo"><Stamp size={18} /> Tarjeta de sellos</h3>
          <p className="conf-ayuda">
            Premia a los clientes que vuelven: cada pedido desde el menú en línea suma un sello a su celular y al completar
            la tarjeta se ganan un premio. También puedes sellar a mano las compras en el local.
          </p>
        </div>
        <button type="button" role="switch" aria-checked={config.activo} aria-label="Tarjeta de sellos"
          className={`conf-switch ${config.activo ? 'on' : ''}`} onClick={() => guardar(!config.activo)}
          disabled={guardando || (!config.activo && !form.premio.trim())}>
          <span />
        </button>
      </div>

      <div className="conf-campos">
        <label className="conf-campo conf-campo--ancho">
          <span>Premio al completar la tarjeta</span>
          <input type="text" maxLength={120} placeholder="Ej. Una empanada gratis" value={form.premio}
            onChange={(e) => setForm(f => ({ ...f, premio: e.target.value }))} />
        </label>
        <label className="conf-campo">
          <span>Sellos para el premio</span>
          <select value={form.meta} onChange={(e) => setForm(f => ({ ...f, meta: Number(e.target.value) }))} className="cs-select">
            {[5, 6, 8, 10, 12, 15, 20].map(n => <option key={n} value={n}>{n} sellos</option>)}
          </select>
        </label>
        <label className="conf-campo">
          <span>Compra mínima por sello</span>
          <input type="number" min="0" step="1000" inputMode="numeric" value={form.minimo}
            onChange={(e) => setForm(f => ({ ...f, minimo: e.target.value }))} placeholder="0 = cualquier pedido" />
        </label>
      </div>
      {!config.activo && !form.premio.trim() && <p className="conf-nota">Escribe el premio para poder activarla.</p>}
      <div className="conf-acciones conf-acciones-fin">
        <button type="button" className="btn-guardar conf-btn-guardar" onClick={() => guardar(config.activo || !!form.premio.trim())}
          disabled={guardando || !form.premio.trim()}>
          {guardando ? 'Guardando...' : config.activo ? '💾 Guardar' : '💾 Guardar y activar'}
        </button>
      </div>

      {config.activo && (
        <>
          <h4 className="conf-subtitulo">🔎 Buscar un cliente</h4>
          <form className="cs-buscar" onSubmit={buscar}>
            <input type="tel" inputMode="tel" placeholder="Celular del cliente" value={telefono}
              onChange={(e) => { setTelefono(e.target.value); setCliente(null); }} />
            <button type="submit" className="conf-btn conf-btn-primario" disabled={ocupado || telefono.replace(/\D/g, '').length < 7}>Buscar</button>
          </form>

          {cliente && (
            <div className="cs-cliente">
              <TarjetaSellos compacta negocio={negocio} meta={cliente.config.meta} premio={cliente.config.premio}
                sellos={cliente.sellos} premios={cliente.premios} />
              <p className="conf-ayuda">📱 {formatoTel(cliente.telefono)} · {cliente.canjes === 1 ? '1 premio entregado' : `${cliente.canjes} premios entregados`}</p>
              <div className="cs-acciones">
                <input type="text" placeholder="Nombre (opcional)" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} />
                <button type="button" className="conf-btn" disabled={ocupado} onClick={() => accion('sellar', '⭐ Sello sumado')}>⭐ Sumar sello</button>
                {cliente.premios > 0 && (
                  <button type="button" className="conf-btn conf-btn-primario" disabled={ocupado}
                    onClick={() => accion('canjear', `🎁 Premio entregado: ${cliente.config.premio}`)}>🎁 Entregar premio</button>
                )}
              </div>
            </div>
          )}

          <h4 className="conf-subtitulo">🏅 Clientes con sellos</h4>
          {clientes.length === 0 ? (
            <p className="conf-nota">Todavía nadie tiene sellos. Llegan solos cuando completes pedidos del menú en línea.</p>
          ) : (
            <div className="cs-lista">
              {clientes.slice(0, 30).map(c => (
                <button type="button" key={c.telefono} className="cs-fila"
                  onClick={() => { setTelefono(c.telefono); setNombre(c.nombre || ''); setCliente({ config, ...c, telefono: c.telefono }); }}>
                  <div className="cs-fila__info">
                    <strong>{c.nombre || formatoTel(c.telefono)}</strong>
                    <small>{c.nombre ? `${formatoTel(c.telefono)} · ` : ''}{c.canjes > 0 ? `${c.canjes} ${c.canjes === 1 ? 'premio' : 'premios'} · ` : ''}último {new Date(c.ultimo).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}</small>
                  </div>
                  <div className="cs-fila__barra" aria-label={`${c.sellos} de ${config.meta} sellos`}>
                    <span style={{ width: `${(c.sellos / config.meta) * 100}%` }} />
                  </div>
                  {c.premios > 0
                    ? <em className="cs-fila__premio">🎁 {c.premios}</em>
                    : <em>{c.sellos}/{config.meta}</em>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ConfigSellos;
