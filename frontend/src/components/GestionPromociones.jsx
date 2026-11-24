import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Gift, Plus, Trash2, Pencil, X } from 'lucide-react';
import api from '../services/api';
import SubidaImagen from './SubidaImagen';
import Burbuja from './Burbuja';
import './GestionPromociones.css';

// Promociones (combos): dos o más productos juntos a un precio especial.
// Salen destacadas en el menú público y en Ventas; al venderse descuentan
// cada producto del inventario (la lógica está en backend/src/helpers/promociones.js).

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const normalizar = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const VACIA = { nombre: '', descripcion: '', precio: '', foto_url: '', activo: true, fecha_inicio: '', fecha_fin: '', items: [] };

const GestionPromociones = ({ productos }) => {
  const [promos, setPromos] = useState(null);
  const [form, setForm] = useState(null); // null = cerrado
  const [editandoId, setEditandoId] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');

  const cargar = useCallback(() => {
    api.get('/promociones', { params: { todas: '1' } })
      .then(r => setPromos(r.data))
      .catch(err => {
        console.error('Error cargando promociones:', err);
        setPromos([]);
      });
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const porId = useMemo(() => new Map(productos.map(p => [p.id, p])), [productos]);
  const sugeridos = useMemo(() => {
    const q = normalizar(busqueda.trim());
    if (!q || !form) return [];
    return productos
      .filter(p => p.activo !== false && normalizar(p.nombre).includes(q) && !form.items.some(i => i.producto_id === p.id))
      .slice(0, 6);
  }, [busqueda, productos, form]);

  const abrirNueva = () => {
    setForm({ ...VACIA });
    setEditandoId(null);
    setError('');
  };

  const abrirEdicion = (p) => {
    setForm({
      nombre: p.nombre,
      descripcion: p.descripcion || '',
      precio: String(p.precio),
      foto_url: p.foto_url || '',
      activo: p.activo,
      fecha_inicio: p.fecha_inicio || '',
      fecha_fin: p.fecha_fin || '',
      items: p.items.map(i => ({ producto_id: i.producto_id, cantidad: i.cantidad }))
    });
    setEditandoId(p.id);
    setError('');
  };

  const cambiarItem = (productoId, cantidad) => setForm(f => ({
    ...f,
    items: cantidad <= 0 ? f.items.filter(i => i.producto_id !== productoId) : f.items.map(i => (i.producto_id === productoId ? { ...i, cantidad } : i))
  }));

  const avisar = (texto) => {
    setMensaje(texto);
    setTimeout(() => setMensaje(''), 3000);
  };

  const guardar = async () => {
    try {
      setGuardando(true);
      setError('');
      const cuerpo = { ...form, precio: Number(form.precio) };
      if (editandoId) await api.put(`/promociones/${editandoId}`, cuerpo);
      else await api.post('/promociones', cuerpo);
      setForm(null);
      avisar(editandoId ? '✅ Promoción actualizada' : '✅ Promoción creada');
      cargar();
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo guardar la promoción');
    } finally {
      setGuardando(false);
    }
  };

  const alternarActiva = async (p) => {
    try {
      await api.put(`/promociones/${p.id}`, { ...p, activo: !p.activo, items: p.items });
      cargar();
    } catch (err) {
      avisar(`❌ ${err.response?.data?.error || 'No se pudo cambiar'}`);
    }
  };

  const borrar = async (p) => {
    if (!window.confirm(`¿Borrar la promoción "${p.nombre}"? Las ventas que ya se hicieron con ella no cambian.`)) return;
    try {
      await api.delete(`/promociones/${p.id}`);
      avisar('✅ Promoción borrada');
      cargar();
    } catch (err) {
      avisar(`❌ ${err.response?.data?.error || 'No se pudo borrar'}`);
    }
  };

  // Cálculos en vivo del formulario.
  const resumen = useMemo(() => {
    if (!form) return null;
    let normal = 0;
    let costo = 0;
    let costoCompleto = true;
    let disponibles = Infinity;
    for (const i of form.items) {
      const p = porId.get(i.producto_id);
      if (!p) continue;
      normal += Number(p.precio_venta) * i.cantidad;
      if (Number(p.precio_compra) > 0) costo += Number(p.precio_compra) * i.cantidad;
      else costoCompleto = false;
      if (!p.ignora_stock) disponibles = Math.min(disponibles, Math.floor(Number(p.stock_actual) / i.cantidad));
    }
    const precio = Number(form.precio) || 0;
    return {
      normal,
      ahorro: normal - precio,
      ahorroPct: normal > 0 ? Math.round(((normal - precio) / normal) * 100) : 0,
      ganancia: costoCompleto && costo > 0 ? precio - costo : null,
      margen: costoCompleto && costo > 0 && precio > 0 ? Math.round(((precio - costo) / precio) * 100) : null,
      disponibles: disponibles === Infinity ? null : disponibles
    };
  }, [form, porId]);

  if (!promos) return null;

  return (
    <div className="card gp">
      {mensaje && <div className={`mensaje-flotante ${mensaje.includes('✅') ? 'exito' : 'error'}`}>{mensaje}</div>}
      <div className="gp__cabecera">
        <div>
          <h3><Gift size={18} /> Promociones</h3>
          <p>Combina dos o más productos a un precio especial. Salen destacadas en tu menú en línea y en Ventas, y al venderse descuentan cada producto del inventario.</p>
        </div>
        {!form && (
          <button type="button" className="btn-agregar" onClick={abrirNueva}><Plus size={16} /> Nueva promoción</button>
        )}
      </div>

      {form && (
        <div className="gp-form">
          <div className="gp-form__titulo">
            <h4>{editandoId ? 'Editar promoción' : 'Nueva promoción'}</h4>
            <button type="button" className="gp-icono" onClick={() => setForm(null)} aria-label="Cerrar"><X size={18} /></button>
          </div>

          <div className="gp-campos">
            <label className="gp-campo gp-campo--ancho">
              <span>Nombre</span>
              <input type="text" maxLength={120} placeholder="Ej. Combo empanada + gaseosa" value={form.nombre}
                onChange={(e) => setForm(f => ({ ...f, nombre: e.target.value }))} />
            </label>

            <div className="gp-campo gp-campo--ancho">
              <span>Productos del combo</span>
              <div className="gp-buscador">
                <input type="text" placeholder="Busca un producto para agregarlo..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                {sugeridos.length > 0 && (
                  <div className="gp-sugerencias">
                    {sugeridos.map(p => (
                      <button key={p.id} type="button" onClick={() => {
                        setForm(f => ({ ...f, items: [...f.items, { producto_id: p.id, cantidad: 1 }] }));
                        setBusqueda('');
                      }}>
                        <span>{p.nombre}</span>
                        <small>{pesos(p.precio_venta)}{!p.ignora_stock ? ` · ${p.stock_actual} en stock` : ''}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {form.items.length === 0 ? (
                <p className="gp-nota">Agrega al menos dos productos (o 2 unidades del mismo).</p>
              ) : (
                <ul className="gp-items">
                  {form.items.map(i => {
                    const p = porId.get(i.producto_id);
                    return (
                      <li key={i.producto_id}>
                        <span className="gp-items__nombre">{p?.nombre || 'Producto'}</span>
                        <small>{pesos(p?.precio_venta)} c/u</small>
                        <div className="gp-cantidad">
                          <button type="button" onClick={() => cambiarItem(i.producto_id, i.cantidad - 1)} aria-label="Quitar uno">−</button>
                          <span>{i.cantidad}</span>
                          <button type="button" onClick={() => cambiarItem(i.producto_id, i.cantidad + 1)} aria-label="Agregar uno">+</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <label className="gp-campo">
              <span>Precio de la promoción</span>
              <input type="number" min="0" inputMode="numeric" placeholder="Ej. 8000" value={form.precio}
                onChange={(e) => setForm(f => ({ ...f, precio: e.target.value }))} />
            </label>

            <div className="gp-campo gp-resumen">
              {resumen && resumen.normal > 0 && (
                <>
                  <span>Por separado: <b>{pesos(resumen.normal)}</b></span>
                  {Number(form.precio) > 0 && (
                    <span className={resumen.ahorro < 0 ? 'gp-malo' : ''}>
                      {resumen.ahorro >= 0 ? `El cliente ahorra ${pesos(resumen.ahorro)} (${resumen.ahorroPct}%)` : `Sale más caro que por separado (${pesos(-resumen.ahorro)})`}
                    </span>
                  )}
                </>
              )}
            </div>

            {resumen && Number(form.precio) > 0 && form.items.length > 0 && (
              <div className="gp-campo gp-campo--ancho">
                {resumen.ganancia === null ? (
                  <Burbuja compacta icono="🏷️">Algún producto no tiene costo registrado, así que no se puede calcular cuánto te deja el combo.</Burbuja>
                ) : (
                  <Burbuja compacta tono={resumen.ganancia <= 0 ? 'ojo' : resumen.margen < 15 ? 'ojo' : 'bien'} icono="💰">
                    {resumen.ganancia <= 0
                      ? <>Con este precio pierdes {pesos(-resumen.ganancia)} en cada combo.</>
                      : <>Cada combo te deja <b>{pesos(resumen.ganancia)}</b> ({resumen.margen}%).</>}
                    {resumen.disponibles !== null && <> Con el stock actual alcanza para {resumen.disponibles} {resumen.disponibles === 1 ? 'combo' : 'combos'}.</>}
                  </Burbuja>
                )}
              </div>
            )}

            <label className="gp-campo gp-campo--ancho">
              <span>Descripción (opcional)</span>
              <input type="text" maxLength={500} placeholder="Ej. Ideal para el almuerzo" value={form.descripcion}
                onChange={(e) => setForm(f => ({ ...f, descripcion: e.target.value }))} />
            </label>

            <label className="gp-campo">
              <span>Desde (opcional)</span>
              <input type="date" value={form.fecha_inicio} onChange={(e) => setForm(f => ({ ...f, fecha_inicio: e.target.value }))} />
            </label>
            <label className="gp-campo">
              <span>Hasta (opcional)</span>
              <input type="date" value={form.fecha_fin} onChange={(e) => setForm(f => ({ ...f, fecha_fin: e.target.value }))} />
            </label>

            <div className="gp-campo gp-campo--ancho">
              <span>Foto (opcional)</span>
              <SubidaImagen valor={form.foto_url} onCambiar={(url) => setForm(f => ({ ...f, foto_url: url }))} />
              <small className="gp-nota">Si no subes una, se muestran las fotos de los productos del combo.</small>
            </div>
          </div>

          {error && <p className="gp-error">{error}</p>}
          <div className="gp-acciones">
            <label className="gp-check">
              <input type="checkbox" checked={form.activo} onChange={(e) => setForm(f => ({ ...f, activo: e.target.checked }))} />
              Activa
            </label>
            <button type="button" className="btn-cancelar" onClick={() => setForm(null)} disabled={guardando}>Cancelar</button>
            <button type="button" className="btn-guardar gp-guardar" onClick={guardar} disabled={guardando}>
              {guardando ? 'Guardando...' : '💾 Guardar promoción'}
            </button>
          </div>
        </div>
      )}

      {promos.length === 0 && !form ? (
        <p className="gp-nota">Todavía no tienes promociones.</p>
      ) : (
        <div className="gp-lista">
          {promos.map(p => (
            <div key={p.id} className={`gp-promo ${!p.activo || !p.vigente ? 'gp-promo--apagada' : ''}`}>
              <div className="gp-promo__info">
                <strong>{p.nombre}</strong>
                <small>{p.items.map(i => `${i.cantidad > 1 ? `${i.cantidad} ` : ''}${i.nombre}`).join(' + ')}</small>
                <div className="gp-promo__datos">
                  <b>{pesos(p.precio)}</b>
                  {p.ahorro > 0 && <span className="gp-tachado">{pesos(p.precio_normal)}</span>}
                  {p.ahorro > 0 && <span className="gp-chip gp-chip--ahorro">-{p.ahorro_pct}%</span>}
                  {!p.activo && <span className="gp-chip">Apagada</span>}
                  {p.activo && !p.vigente && <span className="gp-chip">Fuera de fecha</span>}
                  {p.activo && p.vigente && p.disponibles === 0 && <span className="gp-chip gp-chip--ojo">Sin stock</span>}
                  {p.activo && p.vigente && p.disponibles > 0 && <span className="gp-chip">Alcanza para {p.disponibles}</span>}
                </div>
              </div>
              <div className="gp-promo__acciones">
                <button type="button" role="switch" aria-checked={p.activo} className={`conf-switch ${p.activo ? 'on' : ''}`}
                  onClick={() => alternarActiva(p)} aria-label={p.activo ? 'Apagar promoción' : 'Encender promoción'}><span /></button>
                <button type="button" className="gp-icono" onClick={() => abrirEdicion(p)} aria-label="Editar"><Pencil size={16} /></button>
                <button type="button" className="gp-icono gp-icono--borrar" onClick={() => borrar(p)} aria-label="Borrar"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default GestionPromociones;
