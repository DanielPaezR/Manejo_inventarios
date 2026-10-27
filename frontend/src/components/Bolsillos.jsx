import React, { useState, useEffect, useCallback } from 'react';
import {
  Banknote, Wallet, Smartphone, Store, Moon, ArrowLeftRight, Scale,
  History, CalendarClock, Undo2, Plus, X, ArrowRight
} from 'lucide-react';
import api from '../services/api';
import './Bolsillos.css';

const pesos = (valor) => {
  const n = Math.round(Number(valor || 0));
  return `${n < 0 ? '−' : ''}$ ${Math.abs(n).toLocaleString('es-CO')}`;
};

const formatearFecha = (fecha) => new Date(fecha).toLocaleString('es-CO', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
});

const BOLSILLOS = {
  caja: { nombre: 'Caja', icono: Banknote, ayuda: 'Base en billetes + monedas' },
  cartera: { nombre: 'Cartera', icono: Wallet, ayuda: 'Lo guardado de la caja' },
  nequi: { nombre: 'Nequi', icono: Smartphone, ayuda: 'Transferencias' }
};
const MANUALES = ['caja', 'cartera', 'nequi'];

// Movimientos frecuentes entre bolsillos. 'favor' permite anotar una
// ganancia (comisión) que entra al bolsillo que recibe.
const ATAJOS = [
  { id: 'nequi_a_efectivo', etiqueta: 'Me transfirieron y entregué efectivo', origen: 'caja', destino: 'nequi', tipo: 'favor' },
  { id: 'efectivo_a_nequi', etiqueta: 'Me dieron efectivo y transferí o recargué', origen: 'nequi', destino: 'caja', tipo: 'favor' },
  { id: 'monedas', etiqueta: 'Cambié monedas', origen: 'caja', destino: 'cartera', tipo: 'monedas' },
  { id: 'guardar_nequi', etiqueta: 'Pasé de la cartera a Nequi', origen: 'cartera', destino: 'nequi', tipo: 'traslado' },
  { id: 'sacar_nequi', etiqueta: 'Saqué de Nequi a la cartera', origen: 'nequi', destino: 'cartera', tipo: 'traslado' },
  { id: 'otro', etiqueta: 'Otro movimiento', origen: 'cartera', destino: 'caja', tipo: 'traslado' }
];

const ETIQUETA_TRASLADO = {
  favor: 'Favor', monedas: 'Monedas', traslado: 'Traslado', cierre: 'Cierre',
  apertura: 'Apertura', pago_cruzada: 'Otros módulos'
};
const DESHACIBLES = ['traslado', 'favor', 'monedas', 'cierre'];

const nombreBolsillo = (b) => (b ? BOLSILLOS[b]?.nombre || 'Otros módulos' : 'Sin asignar');

const leerBase = () => {
  try { return localStorage.getItem('baseCaja') || '60000'; } catch { return '60000'; }
};

// ---------- Apertura ----------
const Apertura = ({ datos, onListo }) => {
  const [valores, setValores] = useState({ caja: '', cartera: '', nequi: '' });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const saldoApp = datos.total;
  const cruzadas = datos.cruzadas_hoy;
  const completo = MANUALES.every(b => valores[b] !== '');
  const totalReal = MANUALES.reduce((s, b) => s + Number(valores[b] || 0), 0);
  const diferencia = totalReal - saldoApp;

  const arrancar = async () => {
    const texto = Math.round(diferencia) === 0
      ? 'El total coincide con la app.'
      : `La app ${diferencia > 0 ? 'sumará' : 'restará'} ${pesos(Math.abs(diferencia))} como ${diferencia > 0 ? 'sobrante' : 'faltante'}.`;
    if (!window.confirm(`¿Arrancar los bolsillos con ${pesos(totalReal)} en total?\n\n${texto}`)) return;
    try {
      setGuardando(true);
      setError('');
      await api.post('/finanzas/bolsillos/apertura', valores);
      onListo();
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo arrancar');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="card bol-card">
      <h3 className="bol-titulo"><Wallet size={18} /> Arranca tus bolsillos</h3>
      <p className="bol-ayuda">
        Cuenta el dinero que hay ahora en cada lugar, mejor después del cierre de la noche y de entregar
        lo de los otros módulos. Desde aquí la app lleva cada bolsillo por separado: las ventas en
        efectivo caen en la caja y las transferencias en Nequi.
      </p>
      {cruzadas && !cruzadas.pagado && cruzadas.total > 0 && (
        <p className="bol-aviso">
          Lo vendido hoy de otros módulos ({cruzadas.modulos.map(m => `${m.nombre} ${pesos(m.monto)}`).join(', ')})
          quedará marcado como entregado. Sácalo antes de contar.
        </p>
      )}
      <div className="bol-campos">
        {MANUALES.map(b => {
          const Icono = BOLSILLOS[b].icono;
          return (
            <label key={b} className="bol-campo">
              <span><Icono size={15} /> {BOLSILLOS[b].nombre}</span>
              <small>{b === 'caja' ? 'Billetes + monedas' : BOLSILLOS[b].ayuda}</small>
              <input
                type="number" min="0" inputMode="numeric" placeholder="0"
                value={valores[b]}
                onChange={(e) => setValores(v => ({ ...v, [b]: e.target.value }))}
              />
            </label>
          );
        })}
      </div>
      <div className="bol-resumen">
        <span>Según la app: <strong>{pesos(saldoApp)}</strong></span>
        <span>Contado: <strong>{pesos(totalReal)}</strong></span>
        {completo && (
          <span className={Math.round(diferencia) === 0 ? 'bol-ok' : diferencia < 0 ? 'bol-neg' : 'bol-pos'}>
            {Math.round(diferencia) === 0 ? 'Cuadra' : `${diferencia < 0 ? 'Faltan' : 'Sobran'} ${pesos(Math.abs(diferencia))}`}
          </span>
        )}
      </div>
      {error && <p className="bol-error">{error}</p>}
      <div className="bol-acciones">
        <button className="btn-guardar" onClick={arrancar} disabled={!completo || guardando}>
          {guardando ? 'Guardando...' : 'Arrancar bolsillos'}
        </button>
      </div>
    </div>
  );
};

// ---------- Cierre de la noche ----------
const Cierre = ({ datos, onListo, onCerrar }) => {
  const [base, setBase] = useState(leerBase);
  const [billetes, setBilletes] = useState('');
  const cruzadas = datos.cruzadas_hoy;
  const hayCruzadas = cruzadas && cruzadas.pendiente > 0;
  const [entregar, setEntregar] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState(null);

  const excedente = billetes === '' ? null : Math.max(0, Number(billetes) - Number(base || 0));

  const guardar = async () => {
    try {
      setGuardando(true);
      setError('');
      try { localStorage.setItem('baseCaja', String(base)); } catch { /* sin almacenamiento */ }
      const res = await api.post('/finanzas/bolsillos/cierre', {
        billetes: Number(billetes), base: Number(base), entregar_cruzadas: hayCruzadas && entregar
      });
      setResultado(res.data);
      onListo();
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo registrar el cierre');
    } finally {
      setGuardando(false);
    }
  };

  if (resultado) {
    return (
      <div className="bol-panel">
        <div className="bol-panel-header">
          <strong><Moon size={16} /> Cierre registrado</strong>
          <button className="bol-cerrar" onClick={onCerrar} aria-label="Cerrar"><X size={16} /></button>
        </div>
        <ul className="bol-lista-resultado">
          {resultado.entregado_otros_modulos > 0 && (
            <li><span>Entregado a otros módulos</span><strong>{pesos(resultado.entregado_otros_modulos)}</strong></li>
          )}
          <li><span>Pasó a la cartera</span><strong>{pesos(resultado.excedente)}</strong></li>
          <li><span>Monedas que deberían quedar en la caja</span><strong>{pesos(resultado.monedas_estimadas)}</strong></li>
          {resultado.falta_para_base > 0 && (
            <li className="bol-neg"><span>Faltan billetes para completar la base</span><strong>{pesos(resultado.falta_para_base)}</strong></li>
          )}
        </ul>
        {resultado.monedas_estimadas < 0 && (
          <p className="bol-aviso">
            Las monedas dan negativo: hay menos efectivo del que la app esperaba. Cuando puedas, cuenta toda la caja
            (billetes + monedas) con el botón "Contar".
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="bol-panel">
      <div className="bol-panel-header">
        <strong><Moon size={16} /> Cierre de la noche</strong>
        <button className="bol-cerrar" onClick={onCerrar} aria-label="Cerrar"><X size={16} /></button>
      </div>

      {hayCruzadas && (
        <label className="bol-check">
          <input type="checkbox" checked={entregar} onChange={(e) => setEntregar(e.target.checked)} />
          <span>
            {cruzadas.entregado > 0 ? (
              <>
                Saqué y entregué <strong>{pesos(cruzadas.pendiente)}</strong> más a otros módulos
                <small>Ventas de sus productos después de marcar el día como pagado</small>
              </>
            ) : (
              <>
                Saqué y entregué hoy <strong>{pesos(cruzadas.pendiente)}</strong> a otros módulos
                <small>{cruzadas.modulos.map(m => `${m.nombre} ${pesos(m.monto)}`).join(' · ')}</small>
              </>
            )}
          </span>
        </label>
      )}
      {cruzadas && cruzadas.pendiente === 0 && cruzadas.total > 0 && (
        <p className="bol-nota">Lo de los otros módulos de hoy ya está marcado como entregado.</p>
      )}

      <div className="bol-campos bol-campos-2">
        <label className="bol-campo">
          <span>Billetes contados en la caja</span>
          <small>{hayCruzadas && entregar ? 'Después de sacar lo de los otros módulos' : 'Sin contar monedas'}</small>
          <input type="number" min="0" inputMode="numeric" placeholder="Ej. 245000" autoFocus
            value={billetes} onChange={(e) => setBilletes(e.target.value)} />
        </label>
        <label className="bol-campo">
          <span>Base que se queda</span>
          <small>Billetes para devueltas</small>
          <input type="number" min="0" inputMode="numeric" value={base} onChange={(e) => setBase(e.target.value)} />
        </label>
      </div>

      {excedente !== null && (
        <p className="bol-preview">
          Pasa a la cartera: <strong>{pesos(excedente)}</strong>
          {Number(billetes) < Number(base || 0) && <span className="bol-neg"> · faltan {pesos(Number(base) - Number(billetes))} para la base</span>}
        </p>
      )}
      {error && <p className="bol-error">{error}</p>}
      <div className="bol-acciones">
        <button className="btn-guardar" onClick={guardar} disabled={billetes === '' || base === '' || guardando}>
          {guardando ? 'Guardando...' : 'Registrar cierre'}
        </button>
      </div>
    </div>
  );
};

// ---------- Mover dinero ----------
const Mover = ({ onListo, onCerrar }) => {
  const [atajo, setAtajo] = useState(ATAJOS[0]);
  const [origen, setOrigen] = useState(ATAJOS[0].origen);
  const [destino, setDestino] = useState(ATAJOS[0].destino);
  const [monto, setMonto] = useState('');
  const [ganancia, setGanancia] = useState('');
  const [concepto, setConcepto] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const elegir = (a) => {
    setAtajo(a);
    setOrigen(a.origen);
    setDestino(a.destino);
    if (a.tipo !== 'favor') setGanancia('');
  };

  const guardar = async () => {
    try {
      setGuardando(true);
      setError('');
      await api.post('/finanzas/bolsillos/traslados', {
        origen, destino, monto: Number(monto), tipo: atajo.tipo,
        ganancia: atajo.tipo === 'favor' && ganancia !== '' ? Number(ganancia) : undefined,
        concepto: concepto.trim() || atajo.etiqueta
      });
      setMonto('');
      setGanancia('');
      setConcepto('');
      onListo('Movimiento registrado');
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo registrar');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="bol-panel">
      <div className="bol-panel-header">
        <strong><ArrowLeftRight size={16} /> Mover dinero entre bolsillos</strong>
        <button className="bol-cerrar" onClick={onCerrar} aria-label="Cerrar"><X size={16} /></button>
      </div>

      <div className="bol-atajos">
        {ATAJOS.map(a => (
          <button key={a.id} type="button"
            className={`bol-atajo ${atajo.id === a.id ? 'activo' : ''}`}
            onClick={() => elegir(a)}>
            {a.etiqueta}
          </button>
        ))}
      </div>

      <div className="bol-flujo">
        {atajo.id === 'otro' ? (
          <>
            <select value={origen} onChange={(e) => setOrigen(e.target.value)}>
              {MANUALES.map(b => <option key={b} value={b}>Sale de {BOLSILLOS[b].nombre}</option>)}
            </select>
            <ArrowRight size={16} />
            <select value={destino} onChange={(e) => setDestino(e.target.value)}>
              {MANUALES.map(b => <option key={b} value={b}>Entra a {BOLSILLOS[b].nombre}</option>)}
            </select>
          </>
        ) : (
          <span>Sale de <strong>{BOLSILLOS[origen].nombre}</strong> <ArrowRight size={14} /> entra a <strong>{BOLSILLOS[destino].nombre}</strong></span>
        )}
      </div>

      <div className={`bol-campos ${atajo.tipo === 'favor' ? '' : 'bol-campos-2'}`}>
        <label className="bol-campo">
          <span>Monto</span>
          <small>{atajo.tipo === 'favor' ? 'Lo que entregaste / transferiste' : 'Cuánto se movió'}</small>
          <input type="number" min="0" inputMode="numeric" placeholder="0" value={monto} onChange={(e) => setMonto(e.target.value)} />
        </label>
        {atajo.tipo === 'favor' && (
          <label className="bol-campo">
            <span>Ganancia (opcional)</span>
            <small>Si te dejaron algo de más</small>
            <input type="number" min="0" inputMode="numeric" placeholder="0" value={ganancia} onChange={(e) => setGanancia(e.target.value)} />
          </label>
        )}
        <label className="bol-campo">
          <span>Nota (opcional)</span>
          <small>Ej. giro para doña Marta</small>
          <input type="text" maxLength={120} value={concepto} onChange={(e) => setConcepto(e.target.value)} />
        </label>
      </div>

      {error && <p className="bol-error">{error}</p>}
      <div className="bol-acciones">
        <button className="btn-guardar" onClick={guardar}
          disabled={!monto || Number(monto) <= 0 || origen === destino || guardando}>
          {guardando ? 'Guardando...' : 'Registrar'}
        </button>
      </div>
    </div>
  );
};

// ---------- Contar un bolsillo (cuadre) ----------
const Contar = ({ bolsillo, saldoApp, onListo, onCerrar }) => {
  const [contado, setContado] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const diferencia = contado === '' ? null : Number(contado) - saldoApp;

  const guardar = async () => {
    const texto = Math.round(diferencia) === 0
      ? 'Coincide con la app.'
      : `Se registrará un ${diferencia < 0 ? 'faltante' : 'sobrante'} de ${pesos(Math.abs(diferencia))}.`;
    if (!window.confirm(`¿Registrar ${pesos(contado)} en ${BOLSILLOS[bolsillo].nombre}?\n\n${texto}`)) return;
    try {
      setGuardando(true);
      setError('');
      await api.post('/finanzas/cuadres', { bolsillo, saldo_real: Number(contado), nota });
      onListo('Cuadre registrado');
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo registrar');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="bol-panel">
      <div className="bol-panel-header">
        <strong><Scale size={16} /> Contar {BOLSILLOS[bolsillo].nombre}</strong>
        <button className="bol-cerrar" onClick={onCerrar} aria-label="Cerrar"><X size={16} /></button>
      </div>
      <p className="bol-nota">
        {bolsillo === 'caja'
          ? 'Cuenta todo lo que hay en la caja: billetes y monedas.'
          : bolsillo === 'nequi' ? 'Escribe el saldo que muestra la app de Nequi.' : 'Cuenta todo lo que hay en la cartera.'}
      </p>
      <div className="bol-campos">
        <div className="bol-campo bol-dato"><span>Según la app</span><strong>{pesos(saldoApp)}</strong></div>
        <label className="bol-campo">
          <span>Contado</span>
          <input type="number" min="0" inputMode="numeric" autoFocus value={contado} onChange={(e) => setContado(e.target.value)} />
        </label>
        <div className={`bol-campo bol-dato ${diferencia === null ? '' : Math.round(diferencia) === 0 ? 'ok' : diferencia < 0 ? 'neg' : 'pos'}`}>
          <span>Diferencia</span>
          <strong>{diferencia === null ? '—' : Math.round(diferencia) === 0 ? 'Cuadra' : `${diferencia < 0 ? 'Faltan' : 'Sobran'} ${pesos(Math.abs(diferencia))}`}</strong>
        </div>
      </div>
      <input className="bol-input-nota" type="text" maxLength={200} placeholder="Nota opcional"
        value={nota} onChange={(e) => setNota(e.target.value)} />
      {error && <p className="bol-error">{error}</p>}
      <div className="bol-acciones">
        <button className="btn-guardar" onClick={guardar} disabled={contado === '' || guardando}>
          {guardando ? 'Guardando...' : 'Registrar cuadre'}
        </button>
      </div>
    </div>
  );
};

// ---------- Pagos fijos ----------
const FORM_FIJO_VACIO = { nombre: '', monto: '', dia_mes: '', bolsillo: 'nequi', categoria_gasto_id: '' };

const PagosFijos = ({ categoriasGasto, onPagado }) => {
  const [pagos, setPagos] = useState([]);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const hoy = new Date().getDate();

  const cargar = useCallback(async () => {
    try {
      const res = await api.get('/finanzas/pagos-fijos');
      setPagos(res.data);
    } catch (err) {
      console.error('Error cargando pagos fijos:', err);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async (e) => {
    e.preventDefault();
    try {
      setError('');
      const datos = { ...form, monto: Number(form.monto), dia_mes: Number(form.dia_mes), categoria_gasto_id: form.categoria_gasto_id || null };
      if (form.id) await api.put(`/finanzas/pagos-fijos/${form.id}`, datos);
      else await api.post('/finanzas/pagos-fijos', datos);
      setForm(null);
      cargar();
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo guardar');
    }
  };

  const eliminar = async (pago) => {
    if (!window.confirm(`¿Quitar "${pago.nombre}" de los pagos fijos? Los pagos ya registrados se conservan.`)) return;
    await api.delete(`/finanzas/pagos-fijos/${pago.id}`);
    setForm(null);
    cargar();
  };

  const pagar = async (pago) => {
    const valor = window.prompt(`¿Cuánto pagaste de ${pago.nombre}? (sale de ${BOLSILLOS[pago.bolsillo].nombre})`, String(Math.round(pago.monto)));
    if (valor === null) return;
    try {
      await api.post(`/finanzas/pagos-fijos/${pago.id}/pagar`, { monto: Number(valor) });
      cargar();
      onPagado(`${pago.nombre} pagado`);
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo registrar el pago');
    }
  };

  const estado = (p) => {
    if (p.pagado_este_mes) return { clase: 'ok', texto: 'Pagado este mes' };
    if (hoy > p.dia_mes) return { clase: 'neg', texto: `Venció el día ${p.dia_mes}` };
    if (p.dia_mes - hoy <= 3) return { clase: 'pos', texto: p.dia_mes === hoy ? 'Vence hoy' : `Vence el día ${p.dia_mes}` };
    return { clase: '', texto: `Día ${p.dia_mes}` };
  };

  return (
    <div className="bol-fijos">
      <div className="bol-seccion-header">
        <strong><CalendarClock size={16} /> Pagos fijos del mes</strong>
        {!form && (
          <button type="button" className="bol-link" onClick={() => setForm(FORM_FIJO_VACIO)}>
            <Plus size={14} /> Agregar
          </button>
        )}
      </div>

      {pagos.length === 0 && !form && (
        <p className="bol-nota">Agrega lo que pagas cada mes (Claude, Railway, Spotify, plan de datos...) y la app te avisa cuándo vence.</p>
      )}

      {pagos.map(p => {
        const e = estado(p);
        return (
          <div key={p.id} className="bol-fijo">
            <button type="button" className="bol-fijo-info" onClick={() => setForm({ ...p, categoria_gasto_id: p.categoria_gasto_id || '' })} title="Editar">
              <strong>{p.nombre}</strong>
              <small>
                {pesos(p.monto)} · {BOLSILLOS[p.bolsillo].nombre}{p.categoria_nombre ? ` · ${p.categoria_nombre}` : ''}
              </small>
            </button>
            <span className={`bol-estado ${e.clase}`}>{e.texto}</span>
            {!p.pagado_este_mes && (
              <button type="button" className="bol-btn-pagar" onClick={() => pagar(p)}>Pagar</button>
            )}
          </div>
        );
      })}

      {form && (
        <form className="bol-form-fijo" onSubmit={guardar}>
          <input type="text" placeholder="Nombre (ej. Spotify)" maxLength={80} required
            value={form.nombre} onChange={(e) => setForm(f => ({ ...f, nombre: e.target.value }))} />
          <input type="number" min="1" placeholder="Monto" inputMode="numeric" required
            value={form.monto} onChange={(e) => setForm(f => ({ ...f, monto: e.target.value }))} />
          <input type="number" min="1" max="31" placeholder="Día del mes" inputMode="numeric" required
            value={form.dia_mes} onChange={(e) => setForm(f => ({ ...f, dia_mes: e.target.value }))} />
          <select value={form.bolsillo} onChange={(e) => setForm(f => ({ ...f, bolsillo: e.target.value }))}>
            {MANUALES.map(b => <option key={b} value={b}>Se paga desde {BOLSILLOS[b].nombre}</option>)}
          </select>
          <select value={form.categoria_gasto_id} onChange={(e) => setForm(f => ({ ...f, categoria_gasto_id: e.target.value }))}>
            <option value="">Sin categoría</option>
            {categoriasGasto.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <div className="bol-form-acciones">
            {form.id && <button type="button" className="btn-cancelar" onClick={() => eliminar(form)}>Quitar</button>}
            <button type="button" className="btn-cancelar" onClick={() => { setForm(null); setError(''); }}>Cancelar</button>
            <button type="submit" className="btn-guardar">Guardar</button>
          </div>
        </form>
      )}
      {error && <p className="bol-error">{error}</p>}
    </div>
  );
};

// ---------- Historial de movimientos entre bolsillos ----------
const HistorialTraslados = ({ traslados, onDeshecho }) => {
  const [ver, setVer] = useState(false);

  const deshacer = async (t) => {
    if (!window.confirm(`¿Deshacer este movimiento de ${pesos(t.monto)}?${t.ganancia ? ` También se quita la ganancia de ${pesos(t.ganancia)}.` : ''}`)) return;
    try {
      await api.delete(`/finanzas/bolsillos/traslados/${t.id}`);
      onDeshecho('Movimiento deshecho');
    } catch (err) {
      window.alert(err.response?.data?.error || 'No se pudo deshacer');
    }
  };

  if (traslados.length === 0) return null;
  return (
    <>
      <button type="button" className="bol-link bol-toggle" onClick={() => setVer(v => !v)}>
        <History size={14} /> {ver ? 'Ocultar movimientos entre bolsillos' : 'Ver movimientos entre bolsillos'}
      </button>
      {ver && (
        <div className="bol-historial">
          {traslados.map(t => (
            <div key={t.id} className="bol-historial-item">
              <div>
                <span className="bol-tag">{ETIQUETA_TRASLADO[t.tipo] || t.tipo}</span>
                <strong>{nombreBolsillo(t.origen)} → {nombreBolsillo(t.destino)}</strong>
                <small>{t.concepto ? `${t.concepto} · ` : ''}{formatearFecha(t.fecha)}</small>
              </div>
              <div className="bol-historial-monto">
                <strong>{pesos(t.monto)}</strong>
                {t.ganancia && <small className="bol-ok">+{pesos(t.ganancia)} ganancia</small>}
              </div>
              {DESHACIBLES.includes(t.tipo) ? (
                <button type="button" className="bol-cerrar" onClick={() => deshacer(t)} title="Deshacer"><Undo2 size={15} /></button>
              ) : <span className="bol-cerrar-espacio" />}
            </div>
          ))}
        </div>
      )}
    </>
  );
};

// ---------- Principal ----------
const Bolsillos = ({ categoriasGasto, onCambio }) => {
  const [datos, setDatos] = useState(null);
  const [traslados, setTraslados] = useState([]);
  const [panel, setPanel] = useState(null);
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async () => {
    try {
      const [b, t] = await Promise.all([
        api.get('/finanzas/bolsillos'),
        api.get('/finanzas/bolsillos/traslados')
      ]);
      setDatos(b.data);
      setTraslados(t.data);
    } catch (err) {
      console.error('Error cargando bolsillos:', err);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const refrescar = async (texto) => {
    await cargar();
    onCambio?.();
    if (texto) {
      setPanel(null);
      setAviso(texto);
      setTimeout(() => setAviso(''), 3000);
    }
  };

  if (!datos) return null;
  if (!datos.activo) return <Apertura datos={datos} onListo={() => refrescar('Bolsillos listos')} />;

  const { saldos } = datos;
  const otros = saldos.otros_modulos;
  const cierreHoy = datos.ultimo_cierre &&
    new Date(datos.ultimo_cierre.fecha).toDateString() === new Date().toDateString();

  return (
    <div className="card bol-card">
      <div className="bol-seccion-header">
        <h3 className="bol-titulo"><Wallet size={18} /> Dónde está el dinero</h3>
        <span className="bol-total">Total <strong>{pesos(datos.total)}</strong></span>
      </div>

      <div className="bol-grid">
        {MANUALES.map(b => {
          const Icono = BOLSILLOS[b].icono;
          return (
            <div key={b} className={`bol-tile ${saldos[b] < 0 ? 'neg' : ''}`}>
              <span className="bol-tile-nombre"><Icono size={15} /> {BOLSILLOS[b].nombre}</span>
              <strong>{pesos(saldos[b])}</strong>
              <small>{BOLSILLOS[b].ayuda}</small>
              <button type="button" className="bol-link" onClick={() => setPanel({ tipo: 'contar', bolsillo: b })}>
                <Scale size={13} /> Contar
              </button>
            </div>
          );
        })}
      </div>

      {(Math.round(otros) !== 0 || Math.round(saldos.sin_asignar) !== 0) && (
        <div className="bol-extras">
          {Math.round(otros) !== 0 && (
            <span className={otros < 0 ? 'bol-neg' : ''}>
              <Store size={14} /> {otros < 0 ? `Por entregar a otros módulos: ${pesos(-otros)}` : `Otros módulos te deben: ${pesos(otros)}`}
            </span>
          )}
          {Math.round(saldos.sin_asignar) !== 0 && (
            <span>Sin bolsillo (movimientos viejos): {pesos(saldos.sin_asignar)}</span>
          )}
        </div>
      )}

      <div className="bol-botones">
        <button type="button" className={`bol-boton ${panel?.tipo === 'cierre' ? 'activo' : ''}`} onClick={() => setPanel({ tipo: 'cierre' })}>
          <Moon size={16} /> Cierre de la noche
          {cierreHoy && <span className="bol-badge">hecho</span>}
        </button>
        <button type="button" className={`bol-boton ${panel?.tipo === 'mover' ? 'activo' : ''}`} onClick={() => setPanel({ tipo: 'mover' })}>
          <ArrowLeftRight size={16} /> Mover dinero
        </button>
      </div>

      {aviso && <p className="bol-aviso-ok">{aviso}</p>}

      {panel?.tipo === 'cierre' && <Cierre datos={datos} onListo={() => refrescar()} onCerrar={() => setPanel(null)} />}
      {panel?.tipo === 'mover' && <Mover onListo={refrescar} onCerrar={() => setPanel(null)} />}
      {panel?.tipo === 'contar' && (
        <Contar key={panel.bolsillo} bolsillo={panel.bolsillo} saldoApp={saldos[panel.bolsillo]}
          onListo={refrescar} onCerrar={() => setPanel(null)} />
      )}

      <PagosFijos categoriasGasto={categoriasGasto} onPagado={refrescar} />

      <HistorialTraslados traslados={traslados} onDeshecho={refrescar} />
    </div>
  );
};

export default Bolsillos;
