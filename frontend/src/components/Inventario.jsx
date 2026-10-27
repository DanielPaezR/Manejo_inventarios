import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Save, CircleCheck, TriangleAlert } from 'lucide-react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import './Inventario.css';

const pesos = (valor) => {
  const n = Math.round(Number(valor || 0));
  return `${n < 0 ? '−' : ''}$ ${Math.abs(n).toLocaleString('es-CO')}`;
};

const formatearFecha = (fecha) => new Date(fecha).toLocaleString('es-CO', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
});

const normalizar = (texto) => (texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// ============================================================
// PESTAÑA 1: completar precio de compra y proveedor
// ============================================================
const CompletarDatos = ({ proveedores }) => {
  const [productos, setProductos] = useState([]);
  const [cambios, setCambios] = useState({});
  const [guardando, setGuardando] = useState({});
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState('todos');
  const [busqueda, setBusqueda] = useState('');
  const [mensaje, setMensaje] = useState('');

  const cargar = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/inventario/productos-incompletos');
      setProductos(res.data);
      setMensaje('');
    } catch (err) {
      console.error('Error cargando productos incompletos:', err);
      setMensaje('No se pudieron cargar los productos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const faltaPrecio = (p) => !p.precio_compra;
  const faltaProveedor = (p) => !p.proveedor_id;

  const visibles = useMemo(() => productos.filter(p => {
    if (filtro === 'precio' && !faltaPrecio(p)) return false;
    if (filtro === 'proveedor' && !faltaProveedor(p)) return false;
    if (busqueda && !normalizar(p.nombre).includes(normalizar(busqueda)) && !(p.codigo_ean || '').includes(busqueda)) return false;
    return true;
  }), [productos, filtro, busqueda]);

  const valor = (p, campo) => (cambios[p.id]?.[campo] !== undefined ? cambios[p.id][campo] : (p[campo] ?? ''));

  const cambiar = (id, campo, v) => setCambios(prev => ({ ...prev, [id]: { ...prev[id], [campo]: v } }));

  const guardar = async (p) => {
    const c = cambios[p.id] || {};
    const body = {};
    if (c.precio_compra !== undefined && c.precio_compra !== '') body.precio_compra = Number(c.precio_compra);
    if (c.proveedor_id !== undefined && c.proveedor_id !== '') body.proveedor_id = Number(c.proveedor_id);
    if (Object.keys(body).length === 0) return;

    try {
      setGuardando(prev => ({ ...prev, [p.id]: true }));
      await api.put(`/inventario/productos/${p.id}/datos-compra`, body);
      const actualizado = {
        ...p,
        precio_compra: body.precio_compra ?? p.precio_compra,
        proveedor_id: body.proveedor_id ?? p.proveedor_id
      };
      setCambios(prev => { const n = { ...prev }; delete n[p.id]; return n; });
      // Si ya quedó completo sale de la lista; si no, se actualiza en su lugar.
      setProductos(prev => (actualizado.precio_compra && actualizado.proveedor_id
        ? prev.filter(x => x.id !== p.id)
        : prev.map(x => (x.id === p.id ? actualizado : x))));
    } catch (err) {
      console.error('Error guardando datos de compra:', err);
      setMensaje(err.response?.data?.error || 'No se pudo guardar el producto');
    } finally {
      setGuardando(prev => ({ ...prev, [p.id]: false }));
    }
  };

  const nPrecio = productos.filter(faltaPrecio).length;
  const nProveedor = productos.filter(faltaProveedor).length;

  if (loading) return <div className="inv-vacio">Cargando productos...</div>;

  if (productos.length === 0) {
    return (
      <div className="inv-vacio inv-vacio-ok">
        <CircleCheck size={28} />
        <p>Todos los productos tienen precio de compra y proveedor.</p>
      </div>
    );
  }

  return (
    <div className="card inv-card">
      <p className="inv-ayuda">
        Sin precio de compra la app no puede calcular cuánto cuesta un pedido ni cuánto ganas; sin proveedor no sabe a quién
        pedirle cada cosa. Llena lo que falte y guarda cada fila: cuando un producto queda completo sale de la lista.
      </p>
      <div className="inv-toolbar">
        <div className="periodo-selector">
          <button className={`btn-periodo ${filtro === 'todos' ? 'active' : ''}`} onClick={() => setFiltro('todos')}>Todos ({productos.length})</button>
          <button className={`btn-periodo ${filtro === 'precio' ? 'active' : ''}`} onClick={() => setFiltro('precio')}>Sin precio de compra ({nPrecio})</button>
          <button className={`btn-periodo ${filtro === 'proveedor' ? 'active' : ''}`} onClick={() => setFiltro('proveedor')}>Sin proveedor ({nProveedor})</button>
        </div>
        <label className="inv-busqueda">
          <Search size={16} />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar producto..." />
        </label>
      </div>
      {mensaje && <p className="inv-error" onClick={() => setMensaje('')}>{mensaje}</p>}

      <div className="inv-tabla-wrap">
        <table className="inv-tabla inv-tabla-completar">
          <thead>
            <tr>
              <th>Producto</th>
              <th className="num">Precio venta</th>
              <th>Precio compra</th>
              <th className="num">Margen</th>
              <th>Proveedor</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visibles.map(p => {
              const compra = Number(valor(p, 'precio_compra'));
              const margen = compra > 0 && p.precio_venta > 0 ? ((p.precio_venta - compra) / p.precio_venta) * 100 : null;
              const hayCambios = cambios[p.id] && Object.values(cambios[p.id]).some(v => v !== '' && v !== undefined);
              return (
                <tr key={p.id}>
                  <td>
                    <span className="inv-nombre">{p.nombre}</span>
                    <small>{[p.categoria_nombre, p.ignora_stock ? 'Preparado' : null].filter(Boolean).join(' · ')}</small>
                  </td>
                  <td className="num" data-label="Venta">{pesos(p.precio_venta)}</td>
                  <td data-label="Compra">
                    <input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      className={`inv-input ${faltaPrecio(p) && !valor(p, 'precio_compra') ? 'falta' : ''}`}
                      value={valor(p, 'precio_compra') || ''}
                      placeholder="Falta"
                      onChange={(e) => cambiar(p.id, 'precio_compra', e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && guardar(p)}
                    />
                  </td>
                  <td className={`num ${margen !== null && margen < 0 ? 'inv-neg' : ''}`} data-label="Margen">
                    {margen === null ? '—' : `${margen.toFixed(0)}%`}
                  </td>
                  <td data-label="Proveedor">
                    <select
                      className={`inv-input ${faltaProveedor(p) && !valor(p, 'proveedor_id') ? 'falta' : ''}`}
                      value={valor(p, 'proveedor_id') || ''}
                      onChange={(e) => cambiar(p.id, 'proveedor_id', e.target.value)}
                    >
                      <option value="">Falta</option>
                      {proveedores.map(pr => <option key={pr.id} value={pr.id}>{pr.nombre}</option>)}
                    </select>
                  </td>
                  <td>
                    <button
                      className="btn-guardar inv-btn-fila"
                      disabled={!hayCambios || guardando[p.id]}
                      onClick={() => guardar(p)}
                      aria-label={`Guardar ${p.nombre}`}
                    >
                      <Save size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visibles.length === 0 && <div className="inv-vacio">No hay productos con ese filtro.</div>}
      </div>
    </div>
  );
};

// ============================================================
// PESTAÑA 2: conteo físico
// ============================================================
const ConteoFisico = ({ proveedores, onConteoGuardado }) => {
  const [proveedor, setProveedor] = useState('');
  const [productos, setProductos] = useState([]);
  const [contados, setContados] = useState({});
  const [busqueda, setBusqueda] = useState('');
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/inventario/conteo', { params: proveedor ? { proveedor } : {} });
      setProductos(res.data);
      setError('');
    } catch (err) {
      console.error('Error cargando productos para conteo:', err);
      setError('No se pudieron cargar los productos');
    } finally {
      setLoading(false);
    }
  }, [proveedor]);

  useEffect(() => { cargar(); }, [cargar]);

  const cambiarProveedor = (valorNuevo) => {
    if (Object.keys(contados).length > 0 && !window.confirm('Tienes cantidades sin guardar. ¿Cambiar de proveedor y descartarlas?')) return;
    setContados({});
    setProveedor(valorNuevo);
  };

  const visibles = useMemo(() => productos.filter(p =>
    !busqueda || normalizar(p.nombre).includes(normalizar(busqueda)) || (p.codigo_ean || '').includes(busqueda)
  ), [productos, busqueda]);

  const items = Object.entries(contados)
    .filter(([, v]) => v !== '' && Number.isInteger(Number(v)) && Number(v) >= 0)
    .map(([id, v]) => ({ producto_id: Number(id), stock_contado: Number(v) }));

  const resumen = items.reduce((acc, it) => {
    const p = productos.find(x => x.id === it.producto_id);
    if (!p) return acc;
    const dif = it.stock_contado - p.stock_actual;
    return { unidades: acc.unidades + dif, valor: acc.valor + dif * p.precio_compra };
  }, { unidades: 0, valor: 0 });

  const guardar = async () => {
    if (items.length === 0) return;
    if (!window.confirm(`¿Guardar el conteo de ${items.length} producto(s)? El stock de la app quedará igual a lo que contaste.`)) return;
    try {
      setGuardando(true);
      setError('');
      const res = await api.post('/inventario/conteos', { items, proveedor_id: proveedor || null });
      setResultado(res.data);
      setContados({});
      await cargar();
      onConteoGuardado?.();
    } catch (err) {
      console.error('Error guardando conteo:', err);
      setError(err.response?.data?.error || 'No se pudo guardar el conteo');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="card inv-card">
      <p className="inv-ayuda">
        Cuenta lo que hay de verdad en el estante y escríbelo. Deja en blanco lo que no contaste: solo se ajustan los
        productos con cantidad. Así la app sabe cuánto hay realmente y cuánto se ha ido sin registrar.
      </p>

      {resultado && (
        <div className={`inv-resultado ${resultado.valor_diferencia < 0 ? 'neg' : 'ok'}`}>
          <div className="inv-resultado-titulo">
            {resultado.valor_diferencia < 0 ? <TriangleAlert size={18} /> : <CircleCheck size={18} />}
            <strong>
              Conteo guardado: {resultado.productos_contados} producto(s).{' '}
              {resultado.detalle.length === 0
                ? 'Todo coincidía con la app.'
                : resultado.valor_diferencia < 0
                  ? `Faltaban ${Math.abs(resultado.unidades_diferencia)} unidades por ${pesos(Math.abs(resultado.valor_diferencia))} a precio de compra.`
                  : `Neto: ${resultado.unidades_diferencia >= 0 ? '+' : ''}${resultado.unidades_diferencia} unidades (${pesos(resultado.valor_diferencia)}).`}
            </strong>
            <button className="inv-cerrar" onClick={() => setResultado(null)} aria-label="Cerrar">✕</button>
          </div>
          {resultado.detalle.length > 0 && (
            <ul>
              {resultado.detalle.slice(0, 8).map(d => (
                <li key={d.producto_id}>
                  <span>{d.nombre}</span>
                  <span>{d.stock_sistema} → {d.stock_contado} ({d.diferencia > 0 ? '+' : ''}{d.diferencia}) · {pesos(d.valor)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="inv-toolbar">
        <select className="inv-select" value={proveedor} onChange={(e) => cambiarProveedor(e.target.value)}>
          <option value="">Todos los productos</option>
          {proveedores.map(pr => <option key={pr.id} value={pr.id}>{pr.nombre}</option>)}
          <option value="sin">Sin proveedor</option>
        </select>
        <label className="inv-busqueda">
          <Search size={16} />
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar producto..." />
        </label>
      </div>
      {error && <p className="inv-error">{error}</p>}

      {loading ? (
        <div className="inv-vacio">Cargando productos...</div>
      ) : (
        <div className="inv-tabla-wrap">
          <table className="inv-tabla inv-tabla-conteo">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num" data-corto="App">En la app</th>
                <th>Contado</th>
                <th className="num" data-corto="Dif.">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map(p => {
                const v = contados[p.id] ?? '';
                const dif = v === '' ? null : Number(v) - p.stock_actual;
                return (
                  <tr key={p.id} className={v !== '' ? 'inv-fila-contada' : ''}>
                    <td>
                      <span className="inv-nombre">{p.nombre}</span>
                      <small>{p.categoria_nombre}</small>
                    </td>
                    <td className="num">{p.stock_actual}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        className="inv-input inv-input-corto"
                        value={v}
                        onChange={(e) => setContados(prev => ({ ...prev, [p.id]: e.target.value }))}
                      />
                    </td>
                    <td className={`num ${dif === null ? '' : dif < 0 ? 'inv-neg' : dif > 0 ? 'inv-pos' : 'inv-ok'}`}>
                      {dif === null ? '' : dif === 0 ? 'Igual' : `${dif > 0 ? '+' : ''}${dif}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visibles.length === 0 && <div className="inv-vacio">No hay productos para contar con ese filtro.</div>}
        </div>
      )}

      <div className="inv-barra">
        <span>
          {items.length === 0
            ? 'Escribe la cantidad contada de cada producto'
            : <>{items.length} contado(s) · diferencia <strong className={resumen.valor < 0 ? 'inv-neg' : ''}>{resumen.unidades > 0 ? '+' : ''}{resumen.unidades} unidades ({pesos(resumen.valor)})</strong></>}
        </span>
        <button className="btn-guardar" onClick={guardar} disabled={guardando || items.length === 0}>
          {guardando ? 'Guardando...' : 'Guardar conteo'}
        </button>
      </div>
    </div>
  );
};

// ============================================================
// PESTAÑA 3: historial de conteos
// ============================================================
const HistorialConteos = ({ recarga }) => {
  const [conteos, setConteos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await api.get('/inventario/conteos');
        setConteos(res.data);
      } catch (err) {
        console.error('Error cargando historial de conteos:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [recarga]);

  if (loading) return <div className="inv-vacio">Cargando historial...</div>;
  if (conteos.length === 0) return <div className="inv-vacio">Todavía no hay conteos registrados.</div>;

  const totalPerdido = conteos.reduce((s, c) => s + Math.min(0, c.valor_diferencia), 0);

  return (
    <div className="card inv-card">
      {totalPerdido < 0 && (
        <p className="inv-ayuda">
          En estos conteos han faltado productos por <strong className="inv-neg">{pesos(Math.abs(totalPerdido))}</strong> a precio
          de compra: consumo, pérdidas o ventas sin registrar.
        </p>
      )}
      <div className="inv-tabla-wrap">
        <table className="inv-tabla">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Qué se contó</th>
              <th className="num">Productos</th>
              <th className="num">Unidades</th>
              <th className="num">Valor</th>
            </tr>
          </thead>
          <tbody>
            {conteos.map(c => (
              <tr key={c.id}>
                <td>{formatearFecha(c.fecha)}<small>{c.usuario_nombre}</small></td>
                <td>{c.proveedor_nombre || 'Varios'}</td>
                <td className="num">{c.productos_contados}</td>
                <td className={`num ${c.unidades_diferencia < 0 ? 'inv-neg' : ''}`}>{c.unidades_diferencia > 0 ? '+' : ''}{c.unidades_diferencia}</td>
                <td className={`num ${c.valor_diferencia < 0 ? 'inv-neg' : ''}`}>{pesos(c.valor_diferencia)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ============================================================
// PÁGINA
// ============================================================
const Inventario = () => {
  const { moduloActivo } = useModulo();
  const [tab, setTab] = useState('completar');
  const [proveedores, setProveedores] = useState([]);
  const [recargaHistorial, setRecargaHistorial] = useState(0);

  useEffect(() => {
    if (!moduloActivo) return;
    api.get('/proveedores')
      .then(res => setProveedores(res.data.filter(p => p.activo !== false)))
      .catch(err => console.error('Error cargando proveedores:', err));
  }, [moduloActivo]);

  if (!moduloActivo) {
    return <div className="inv-vacio">Selecciona un módulo para ver el inventario.</div>;
  }

  return (
    <div className="inventario-container">
      <div className="inv-tabs">
        <button className={`btn-vista ${tab === 'completar' ? 'active' : ''}`} onClick={() => setTab('completar')}>Completar datos de compra</button>
        <button className={`btn-vista ${tab === 'conteo' ? 'active' : ''}`} onClick={() => setTab('conteo')}>Conteo físico</button>
        <button className={`btn-vista ${tab === 'historial' ? 'active' : ''}`} onClick={() => setTab('historial')}>Historial de conteos</button>
      </div>

      {tab === 'completar' && <CompletarDatos proveedores={proveedores} />}
      {tab === 'conteo' && <ConteoFisico proveedores={proveedores} onConteoGuardado={() => setRecargaHistorial(n => n + 1)} />}
      {tab === 'historial' && <HistorialConteos recarga={recargaHistorial} />}
    </div>
  );
};

export default Inventario;
