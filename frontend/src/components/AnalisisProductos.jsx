import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import './ResumenNegocio.css';

// Pestaña Productos de Estadísticas: simulador de precios ("¿qué pasa si
// subo el precio?") y mermas (lo que falta al contar el inventario).

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const normalizar = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const SimuladorPrecios = ({ productos }) => {
  const [busqueda, setBusqueda] = useState('');
  const [seleccionado, setSeleccionado] = useState(null);
  const [precio, setPrecio] = useState('');
  const [costo, setCosto] = useState('');

  const sugeridos = useMemo(() => {
    const q = normalizar(busqueda.trim());
    const lista = q ? productos.filter(p => normalizar(p.nombre).includes(q)) : productos.filter(p => p.unidades_28 > 0);
    return lista.slice(0, 6);
  }, [busqueda, productos]);

  const elegir = (p) => {
    setSeleccionado(p);
    setPrecio(String(p.precio_venta));
    setCosto(p.precio_compra ? String(p.precio_compra) : '');
    setBusqueda('');
  };

  let resultado = null;
  if (seleccionado) {
    const pv = seleccionado.precio_venta;
    const pc = Number(costo) || 0;
    const pn = Number(precio) || 0;
    const costoActual = seleccionado.precio_compra || 0;
    const unidades = seleccionado.unidades_28;
    const gananciaUnidadHoy = pv - costoActual;
    const gananciaUnidadNueva = pn - pc;
    const gananciaMesHoy = gananciaUnidadHoy * unidades;
    const gananciaMesNueva = gananciaUnidadNueva * unidades;
    const unidadesParaIgualar = gananciaUnidadNueva > 0 ? Math.ceil(gananciaMesHoy / gananciaUnidadNueva) : null;
    resultado = {
      margenHoy: pv > 0 ? Math.round((gananciaUnidadHoy / pv) * 100) : 0,
      margenNuevo: pn > 0 ? Math.round((gananciaUnidadNueva / pn) * 100) : 0,
      gananciaUnidadHoy, gananciaUnidadNueva, gananciaMesHoy, gananciaMesNueva, unidades, unidadesParaIgualar,
      sinCosto: !costoActual && !pc,
      cambio: pn !== pv || pc !== costoActual
    };
  }

  return (
    <section className="card rn-capitulo">
      <div className="rn-capitulo__cabecera">
        <span className="rn-capitulo__numero aa-icono">🧮</span>
        <div>
          <small>Simulador</small>
          <h3>¿Qué pasa si cambio el precio?</h3>
        </div>
      </div>
      <p className="rn-texto">
        Elige un producto y prueba otro precio (o el costo nuevo si el proveedor te subió). Te muestro cuánto ganarías al mes si vendes lo mismo,
        y cuántas unidades te bastarían para ganar lo mismo que hoy. No cambia nada en tu inventario.
      </p>

      <div className="sim-buscador">
        <input type="text" placeholder={seleccionado ? `Cambiar producto (${seleccionado.nombre})` : 'Busca un producto...'} value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)} />
        {(busqueda || !seleccionado) && sugeridos.length > 0 && (
          <div className="sim-sugerencias">
            {sugeridos.map(p => (
              <button key={p.id} type="button" onClick={() => elegir(p)}>
                <span>{p.nombre}</span>
                <small>{pesos(p.precio_venta)} · {p.unidades_28} vendidos en 4 semanas</small>
              </button>
            ))}
          </div>
        )}
      </div>

      {seleccionado && resultado && (
        <div className="sim-panel">
          <h4>{seleccionado.nombre}</h4>
          <div className="mn-campos">
            <label className="mn-campo">
              <span>Precio de venta</span>
              <input type="number" min="0" inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value)} />
              <small>Hoy: {pesos(seleccionado.precio_venta)}</small>
            </label>
            <label className="mn-campo">
              <span>Te cuesta</span>
              <input type="number" min="0" inputMode="numeric" value={costo} placeholder="Sin costo registrado" onChange={(e) => setCosto(e.target.value)} />
              <small>Hoy: {seleccionado.precio_compra ? pesos(seleccionado.precio_compra) : 'sin registrar'}</small>
            </label>
          </div>

          {resultado.sinCosto ? (
            <p className="rn-nota">Escribe cuánto te cuesta para poder calcular la ganancia.</p>
          ) : (
            <>
              <div className="rn-metricas sim-metricas">
                <div className="rn-metrica">
                  <small>Te deja por unidad</small>
                  <strong>{pesos(resultado.gananciaUnidadNueva)}</strong>
                  <span>Hoy: {pesos(resultado.gananciaUnidadHoy)} ({resultado.margenHoy}%) → {resultado.margenNuevo}%</span>
                </div>
                <div className={`rn-metrica ${resultado.gananciaMesNueva > resultado.gananciaMesHoy ? 'rn-metrica--destacada' : resultado.gananciaMesNueva < resultado.gananciaMesHoy ? 'rn-metrica--alerta' : ''}`}>
                  <small>Ganancia en 4 semanas (vendiendo {resultado.unidades})</small>
                  <strong>{pesos(resultado.gananciaMesNueva)}</strong>
                  <span>Hoy: {pesos(resultado.gananciaMesHoy)}</span>
                </div>
              </div>
              {resultado.cambio && resultado.unidades > 0 && (
                <p className="rn-texto">
                  {resultado.gananciaUnidadNueva <= 0
                    ? '⚠️ Con ese precio pierdes plata en cada unidad.'
                    : resultado.unidadesParaIgualar <= resultado.unidades
                      ? `Para ganar lo mismo que hoy te basta vender ${resultado.unidadesParaIgualar} unidades en 4 semanas (${resultado.unidades - resultado.unidadesParaIgualar} menos que ahora). Si al subir el precio dejas de vender menos de eso, sales ganando.`
                      : `Para ganar lo mismo que hoy tendrías que vender ${resultado.unidadesParaIgualar} unidades en 4 semanas (${resultado.unidadesParaIgualar - resultado.unidades} más que ahora).`}
                </p>
              )}
              {resultado.unidades === 0 && <p className="rn-nota">Este producto no se ha vendido en las últimas 4 semanas.</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
};

const Mermas = ({ datos }) => {
  const navigate = useNavigate();
  if (!datos) return null;
  return (
    <section className="card rn-capitulo">
      <div className="rn-capitulo__cabecera">
        <span className="rn-capitulo__numero aa-icono">🔍</span>
        <div>
          <small>Mermas</small>
          <h3>
            {datos.conteos === 0
              ? '¿Cuadra lo que dice el sistema con lo que hay?'
              : datos.valor < 0
                ? `En los conteos de los últimos 3 meses faltaron ${pesos(-datos.valor)} en mercancía.`
                : 'Tus conteos de los últimos 3 meses cuadraron bien.'}
          </h3>
        </div>
      </div>
      {datos.conteos === 0 ? (
        <>
          <p className="rn-texto">
            {datos.ultimo_conteo
              ? 'No has hecho conteos de inventario en los últimos 3 meses.'
              : 'Todavía no has hecho ningún conteo de inventario.'}{' '}
            Contar lo que hay en el estante y compararlo con el sistema es la única forma de saber cuánto se pierde
            por productos vencidos, dañados, consumidos sin registrar o que se llevan sin pagar.
            Empieza por los productos que más vendes: toma 10 minutos.
          </p>
          <button type="button" className="rn-link" onClick={() => navigate('/inventario')}>Hacer un conteo →</button>
        </>
      ) : (
        <>
          <p className="rn-texto">
            {datos.conteos} {datos.conteos === 1 ? 'conteo' : 'conteos'} en los últimos 3 meses.
            {datos.faltantes.length > 0 && ' Estos son los productos donde más falta mercancía:'}
          </p>
          {datos.faltantes.length > 0 && (
            <div className="rn-alerta rn-alerta--media">
              <ul>
                {datos.faltantes.map(f => (
                  <li key={f.nombre}>
                    <span>{f.nombre} ({f.unidades} uds{f.veces > 1 ? `, en ${f.veces} conteos` : ''})</span>
                    <b>{pesos(-f.valor)}</b>
                  </li>
                ))}
              </ul>
              <p>Si un producto aparece seguido, revisa cómo se guarda, si se vence o si alguien lo consume sin registrarlo.</p>
            </div>
          )}
          <button type="button" className="rn-link" onClick={() => navigate('/inventario')}>Ir a Inventario →</button>
        </>
      )}
    </section>
  );
};

const AnalisisProductos = () => {
  const { moduloActivo } = useModulo();
  const [productos, setProductos] = useState([]);
  const [mermas, setMermas] = useState(null);

  useEffect(() => {
    if (!moduloActivo) return;
    api.get('/estadisticas/productos-simulador').then(r => setProductos(r.data)).catch(() => {});
    api.get('/estadisticas/mermas').then(r => setMermas(r.data)).catch(() => {});
  }, [moduloActivo]);

  return (
    <div className="rn est-analisis">
      <SimuladorPrecios productos={productos} />
      <Mermas datos={mermas} />
    </div>
  );
};

export default AnalisisProductos;
