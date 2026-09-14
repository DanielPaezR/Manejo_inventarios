import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DndContext, useDraggable, useDroppable, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import api from '../services/api';
import './FinanzasNegocio.css';

// Vista CONSOLIDADA de todo el negocio (todos los módulos juntos) para
// planeación financiera familiar — distinta de Finanzas.jsx, que es por
// módulo para el día a día operativo. Ver backend/server.js, sección
// "RUTAS DE FINANZAS DEL NEGOCIO (CONSOLIDADO)".

const formatearMoneda = (valor) => {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(valor || 0);
};

const formatearPct = (valor) => {
  if (valor === null || valor === undefined) return '—';
  return `${valor >= 0 ? '' : ''}${valor.toFixed(1)}%`;
};

// Misma aritmética de calendario en UTC que Estadisticas.jsx (sumarDiasUTC):
// evita que sumar/restar días se corra por la zona horaria del navegador.
const sumarDiasUTC = (fechaStr, dias) => {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
};

const sumarMesesUTC = (fechaStr, meses) => {
  const [y, m] = fechaStr.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1 + meses, 1));
  return fecha.toISOString().slice(0, 10);
};

const hoyLocal = () => {
  const ahora = new Date();
  const y = ahora.getFullYear();
  const m = String(ahora.getMonth() + 1).padStart(2, '0');
  const d = String(ahora.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Lunes de la semana ISO que contiene la fecha dada (o de hoy, sin argumento).
const lunesDeLaSemana = (fechaStr) => {
  const [y, m, d] = (fechaStr || hoyLocal()).split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  const diaSemana = fecha.getUTCDay() || 7; // domingo=0 -> 7
  fecha.setUTCDate(fecha.getUTCDate() - (diaSemana - 1));
  return fecha.toISOString().slice(0, 10);
};

const primerDiaDelMes = (fechaStr) => {
  const [y, m] = (fechaStr || hoyLocal()).split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-01`;
};

const TIPOS_CATEGORIA = [
  { value: 'ingreso', label: '💵 Ingreso (ventas)' },
  { value: 'mercancia', label: '📦 Mercancía' },
  { value: 'servicios', label: '💡 Servicios' },
  { value: 'fijo', label: '🏠 Gasto fijo' },
  { value: 'personal', label: '👤 Gastos personales' },
  { value: 'ahorro', label: '🐷 Ahorro' },
  { value: 'reinversion', label: '📈 Reinversión' },
  { value: 'otro', label: '🗂️ Otro' }
];

const nombreTipo = (tipo) => TIPOS_CATEGORIA.find(t => t.value === tipo)?.label || tipo;

const FinanzasNegocio = ({ user }) => {
  const [tab, setTab] = useState('resumen');

  return (
    <div className="fn-container">
      <div className="fn-header">
        <h2>🧮 Finanzas del Negocio</h2>
        <p className="fn-subtitulo">Vista consolidada de todos los módulos — para planear, no para el día a día operativo (eso sigue en Finanzas).</p>
      </div>

      <div className="fn-tabs">
        <button className={`fn-tab ${tab === 'resumen' ? 'active' : ''}`} onClick={() => setTab('resumen')}>📊 Resumen mensual</button>
        <button className={`fn-tab ${tab === 'simulador' ? 'active' : ''}`} onClick={() => setTab('simulador')}>🧩 Simulador</button>
        <button className={`fn-tab ${tab === 'activos-deudas' ? 'active' : ''}`} onClick={() => setTab('activos-deudas')}>🏦 Activos y Deudas</button>
        <button className={`fn-tab ${tab === 'configuracion' ? 'active' : ''}`} onClick={() => setTab('configuracion')}>⚙️ Configuración</button>
      </div>

      {tab === 'resumen' && <ResumenMensual />}
      {tab === 'simulador' && <Simulador />}
      {tab === 'activos-deudas' && <ActivosYDeudas />}
      {tab === 'configuracion' && <Configuracion />}
    </div>
  );
};

// ==================== RESUMEN MENSUAL ====================

const ResumenMensual = () => {
  const ahora = new Date();
  const [anio, setAnio] = useState(ahora.getFullYear());
  const [mes, setMes] = useState(ahora.getMonth() + 1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await api.get('/finanzas-negocio/resumen-mensual', { params: { anio, mes } });
      setData(response.data);
    } catch (err) {
      console.error('Error cargando resumen mensual:', err);
      setError(err.response?.data?.error || 'Error al cargar el resumen');
    } finally {
      setLoading(false);
    }
  }, [anio, mes]);

  useEffect(() => { cargar(); }, [cargar]);

  const cambiarMes = (delta) => {
    let nuevoMes = mes + delta;
    let nuevoAnio = anio;
    if (nuevoMes > 12) { nuevoMes = 1; nuevoAnio += 1; }
    if (nuevoMes < 1) { nuevoMes = 12; nuevoAnio -= 1; }
    setMes(nuevoMes);
    setAnio(nuevoAnio);
  };

  const nombreMes = data ? new Date(`${data.periodo.fecha_inicio}T12:00:00`).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }) : '';

  return (
    <div className="fn-seccion">
      <div className="fn-nav-periodo">
        <button onClick={() => cambiarMes(-1)}>← Mes anterior</button>
        <strong>{nombreMes}</strong>
        <button onClick={() => cambiarMes(1)}>Mes siguiente →</button>
      </div>

      {loading && <p className="fn-info">Cargando...</p>}
      {error && <p className="fn-error">❌ {error}</p>}

      {data && !loading && (
        <div className="fn-grid-resumen">
          <div className="fn-card">
            <h3>🏦 Balance General</h3>
            <div className="fn-linea"><span>Efectivo en caja</span><strong>{formatearMoneda(data.balance_general.efectivo_en_caja)}</strong></div>
            <div className="fn-linea"><span>+ Inventario a costo</span><strong>{formatearMoneda(data.balance_general.inventario_a_costo)}</strong></div>
            <div className="fn-linea"><span>+ Activos fijos</span><strong>{formatearMoneda(data.balance_general.activos_fijos)}</strong></div>
            <div className="fn-linea"><span>- Deudas</span><strong>{formatearMoneda(data.balance_general.deudas)}</strong></div>
            <div className="fn-linea fn-linea-total"><span>= Patrimonio</span><strong>{formatearMoneda(data.balance_general.patrimonio)}</strong></div>
            <p className="fn-nota">Inventario y deudas son el valor actual, no el histórico de ese mes exacto.</p>
          </div>

          <div className="fn-card">
            <h3>📈 Estado de Resultados</h3>
            <div className="fn-linea"><span>Ventas del mes</span><strong>{formatearMoneda(data.estado_resultados.ventas_del_mes)}</strong></div>
            <div className="fn-linea"><span>- Costo mercancía vendida</span><strong>{formatearMoneda(data.estado_resultados.costo_mercancia_vendida)}</strong></div>
            <div className="fn-linea"><span>- Gastos fijos (+ servicios)</span><strong>{formatearMoneda(data.estado_resultados.gastos_fijos)}</strong></div>
            <div className="fn-linea"><span>- Gastos personales</span><strong>{formatearMoneda(data.estado_resultados.gastos_personales)}</strong></div>
            <div className="fn-linea fn-linea-total"><span>= Utilidad neta</span><strong>{formatearMoneda(data.estado_resultados.utilidad_neta)}</strong></div>
          </div>

          <div className="fn-card">
            <h3>📊 Indicadores</h3>
            <div className="fn-linea"><span>Margen bruto</span><strong>{formatearPct(data.indicadores.margen_bruto_pct)}</strong></div>
            <div className="fn-linea"><span>Crecimiento vs. mes anterior</span><strong>{formatearPct(data.indicadores.crecimiento_ventas_pct)}</strong></div>
            <div className="fn-linea"><span>Rotación de inventario</span><strong>{data.indicadores.rotacion_inventario !== null ? data.indicadores.rotacion_inventario.toFixed(2) : '—'}</strong></div>
          </div>

          <div className="fn-card fn-card-destacada">
            <h3>💰 Disponible para reinvertir</h3>
            <div className="fn-linea"><span>Utilidad neta</span><strong>{formatearMoneda(data.estado_resultados.utilidad_neta)}</strong></div>
            <div className="fn-linea"><span>- Reserva de seguridad</span><strong>{formatearMoneda(data.reserva_seguridad)}</strong></div>
            <div className="fn-linea fn-linea-total"><span>= Disponible</span><strong>{formatearMoneda(data.disponible_para_reinvertir)}</strong></div>
          </div>

          <div className="fn-card">
            <h3>🗂️ Informativo (no afecta la utilidad)</h3>
            <div className="fn-linea"><span>Mercancía comprada</span><strong>{formatearMoneda(data.informativo.gastos_mercancia_comprada)}</strong></div>
            <div className="fn-linea"><span>Ahorro</span><strong>{formatearMoneda(data.informativo.gastos_ahorro)}</strong></div>
            <div className="fn-linea"><span>Reinversión</span><strong>{formatearMoneda(data.informativo.gastos_reinversion)}</strong></div>
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== SIMULADOR ("ÁBACO INVERTIDO") ====================

const Simulador = () => {
  const [granularidad, setGranularidad] = useState('mes');
  const [periodoInicio, setPeriodoInicio] = useState(primerDiaDelMes());
  const [data, setData] = useState(null);
  const [asignaciones, setAsignaciones] = useState({});
  const [loading, setLoading] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [mostrarCategorias, setMostrarCategorias] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState(false);
  const primerCarga = useRef(true);

  const cargar = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setErrorGuardado(false);
      primerCarga.current = true;
      const response = await api.get('/finanzas-negocio/simulador', { params: { granularidad, periodo_inicio: periodoInicio } });
      setData(response.data);
      const inicial = {};
      response.data.categorias.forEach(c => {
        if (c.tipo !== 'ingreso') inicial[c.id] = c.bloques_asignados;
      });
      setAsignaciones(inicial);
    } catch (err) {
      console.error('Error cargando el simulador:', err);
      setError(err.response?.data?.error || 'Error al cargar el simulador');
      setData(null);
    } finally {
      setLoading(false);
      // Deja pasar un tick para que el useEffect de autosave no dispare
      // guardando los mismos valores que se acaban de cargar.
      setTimeout(() => { primerCarga.current = false; }, 0);
    }
  }, [granularidad, periodoInicio]);

  useEffect(() => { cargar(); }, [cargar]);

  // Internet en zona rural puede ser inestable — un guardado fallido en
  // silencio haría que el plan se vea guardado en pantalla pero no lo esté
  // realmente. errorGuardado deja un botón para reintentar con los mismos
  // datos en vez de perder el cambio.
  const guardarAsignaciones = useCallback(async (asignacionesAGuardar) => {
    try {
      setGuardando(true);
      setErrorGuardado(false);
      await api.put('/finanzas-negocio/simulador', {
        granularidad,
        periodo_inicio: periodoInicio,
        asignaciones: Object.entries(asignacionesAGuardar).map(([categoria_gasto_id, bloques_asignados]) => ({ categoria_gasto_id, bloques_asignados }))
      });
    } catch (err) {
      console.error('Error guardando asignaciones:', err);
      setErrorGuardado(true);
    } finally {
      setGuardando(false);
    }
  }, [granularidad, periodoInicio]);

  // Autosave: guarda 900ms después del último cambio, no en cada arrastre
  // individual (evita golpear la API en cada micro-movimiento).
  useEffect(() => {
    if (primerCarga.current || !data) return;
    const timeout = setTimeout(() => guardarAsignaciones(asignaciones), 900);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asignaciones]);

  const cambiarGranularidad = (nueva) => {
    setGranularidad(nueva);
    if (nueva === 'dia') setPeriodoInicio(hoyLocal());
    else if (nueva === 'semana') setPeriodoInicio(lunesDeLaSemana());
    else setPeriodoInicio(primerDiaDelMes());
  };

  const navegar = (direccion) => {
    if (granularidad === 'dia') setPeriodoInicio(sumarDiasUTC(periodoInicio, direccion));
    else if (granularidad === 'semana') setPeriodoInicio(sumarDiasUTC(periodoInicio, direccion * 7));
    else setPeriodoInicio(sumarMesesUTC(periodoInicio, direccion));
  };

  const handleReiniciar = async () => {
    if (!window.confirm('¿Reiniciar las asignaciones de este período? Esto no afecta datos reales, solo el plan.')) return;
    try {
      await api.post('/finanzas-negocio/simulador/reset', { granularidad, periodo_inicio: periodoInicio });
      await cargar();
    } catch (err) {
      console.error('Error reiniciando:', err);
      alert(err.response?.data?.error || 'Error al reiniciar');
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over) return;
    const origen = active.data.current?.zoneKey;
    const destino = over.id;
    if (!origen || origen === destino) return;

    setAsignaciones(prev => {
      const next = { ...prev };
      if (origen !== 'banco') {
        next[origen] = Math.max(0, (next[origen] || 0) - 1);
      }
      if (destino !== 'banco') {
        next[destino] = (next[destino] || 0) + 1;
      }
      return next;
    });
  };

  const categoriaIngreso = (data?.categorias || []).find(c => c.tipo === 'ingreso');
  const categoriasEgreso = (data?.categorias || []).filter(c => c.tipo !== 'ingreso');
  const totalAsignado = Object.values(asignaciones).reduce((a, b) => a + b, 0);
  const bloquesSinAsignar = data ? data.total_bloques_ingresos - totalAsignado : 0;

  // Escala compartida por TODO el ábaco (ingreso + cada columna de gasto),
  // para que las alturas de barra sean comparables entre sí — si cada
  // barra usara su propio máximo, dos montos iguales se verían distintos.
  const bloquesIngresoActual = data ? data.ingresos_reales / data.valor_bloque : 0;
  const bloquesIngresoAnterior = data ? data.ingresos_periodo_anterior / data.valor_bloque : 0;
  const maxBloques = Math.max(
    1,
    bloquesIngresoActual,
    bloquesIngresoAnterior,
    ...categoriasEgreso.flatMap(c => [c.bloques_reales, c.bloques_periodo_anterior, asignaciones[c.id] || 0])
  );
  const ALTURA_MAX_PX = 180;
  const pxPorBloque = ALTURA_MAX_PX / maxBloques;
  const alturaPx = (bloques) => Math.max(0, bloques) * pxPorBloque;

  const etiquetaPeriodo = () => {
    if (!data) return '';
    if (granularidad === 'dia') return new Date(`${periodoInicio}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
    if (granularidad === 'semana') return `Semana del ${periodoInicio} al ${data.periodo.fecha_fin}`;
    return new Date(`${periodoInicio}T12:00:00`).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  };

  return (
    <div className="fn-seccion">
      <div className="fn-simulador-toolbar">
        <div className="fn-granularidad-selector">
          <button className={granularidad === 'dia' ? 'active' : ''} onClick={() => cambiarGranularidad('dia')}>Día</button>
          <button className={granularidad === 'semana' ? 'active' : ''} onClick={() => cambiarGranularidad('semana')}>Semana</button>
          <button className={granularidad === 'mes' ? 'active' : ''} onClick={() => cambiarGranularidad('mes')}>Mes</button>
        </div>
        <div className="fn-nav-periodo">
          <button onClick={() => navegar(-1)}>← Anterior</button>
          <strong>{etiquetaPeriodo()}</strong>
          <button onClick={() => navegar(1)}>Siguiente →</button>
        </div>
      </div>

      {loading && <p className="fn-info">Cargando...</p>}
      {error && (
        <div className="fn-error-box">
          <p>❌ {error}</p>
          {error.includes('Configura') && <p className="fn-nota">Ve a la pestaña ⚙️ Configuración para definir el valor del bloque.</p>}
        </div>
      )}

      {data && !loading && (
        <>
          <div className="fn-simulador-acciones">
            <button onClick={() => setMostrarCategorias(!mostrarCategorias)} className="fn-btn-secundario">
              🗂️ {mostrarCategorias ? 'Ocultar' : 'Gestionar'} categorías
            </button>
            <button onClick={handleReiniciar} className="fn-btn-peligro">🔄 Reiniciar este período</button>
            {guardando && <span className="fn-guardando">Guardando...</span>}
            {errorGuardado && !guardando && (
              <span className="fn-guardado-error">
                ⚠️ No se pudo guardar (revisa tu conexión)
                <button onClick={() => guardarAsignaciones(asignaciones)}>Reintentar</button>
              </span>
            )}
          </div>

          {mostrarCategorias && <GestionCategoriasSimulador onCambio={cargar} />}

          <div className="fn-abaco-leyenda">
            <span><i className="fn-swatch fn-swatch-gris" /> Período anterior</span>
            <span><i className="fn-swatch fn-swatch-verde" /> Ventas reales (hoy)</span>
            <span><i className="fn-swatch fn-swatch-rojo" /> Gasto real (hoy)</span>
            <span><i className="fn-swatch fn-swatch-azul" /> Tu simulación (arrastra bloques)</span>
          </div>

          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="fn-abaco">
              {/* Eje X: la línea que separa ingresos (arriba) de gastos (abajo) */}
              <div className="fn-abaco-eje-x" />

              {categoriaIngreso && (
                <div className="fn-abaco-slot fn-abaco-slot-ingreso">
                  <div className="fn-abaco-zona-arriba">
                    <div
                      className="fn-barra fn-barra-gris"
                      style={{ height: alturaPx(bloquesIngresoAnterior) }}
                      title={`Período anterior: ${formatearMoneda(data.ingresos_periodo_anterior)}`}
                    />
                    <div
                      className="fn-barra fn-barra-verde"
                      style={{ height: alturaPx(bloquesIngresoActual) }}
                      title={`Ventas reales: ${formatearMoneda(data.ingresos_reales)}`}
                    />
                  </div>
                  <div className="fn-abaco-etiqueta">
                    <strong>💵 Ventas</strong>
                    <span className="fn-abaco-cifra fn-abaco-cifra-verde">{formatearMoneda(data.ingresos_reales)}</span>
                    <span className="fn-abaco-cifra fn-abaco-cifra-gris">{formatearMoneda(data.ingresos_periodo_anterior)} antes</span>
                  </div>
                  <div className="fn-abaco-zona-abajo" />
                </div>
              )}

              {categoriasEgreso.map(cat => {
                const asignado = asignaciones[cat.id] || 0;
                return (
                  <div className="fn-abaco-slot" key={cat.id}>
                    <div className="fn-abaco-zona-arriba" />
                    <div className="fn-abaco-etiqueta">
                      <strong>{cat.nombre}</strong>
                      <span className="fn-abaco-tipo">{nombreTipo(cat.tipo)}</span>
                    </div>
                    {/* La zona de drop cubre TODA la columna (no solo la pila azul):
                        con 0 bloques asignados, el objetivo de soltar sería casi
                        invisible si solo fuera del tamaño de la pila actual. */}
                    <ZonaDrop id={String(cat.id)}>
                      <div className="fn-abaco-zona-abajo">
                        <div
                          className="fn-barra fn-barra-gris"
                          style={{ height: alturaPx(cat.bloques_periodo_anterior) }}
                          title={`Período anterior: ${formatearMoneda(cat.monto_periodo_anterior)}`}
                        />
                        <div
                          className="fn-barra fn-barra-rojo"
                          style={{ height: alturaPx(cat.bloques_reales) }}
                          title={`Gasto real: ${formatearMoneda(cat.monto_real)}`}
                        />
                        <div className="fn-barra-azul-pila" style={{ minHeight: alturaPx(asignado) }}>
                          {Array.from({ length: asignado }).map((_, i) => (
                            <Bloque key={`cat-${cat.id}-${i}`} id={`cat-${cat.id}-${i}`} zoneKey={String(cat.id)} altura={pxPorBloque} />
                          ))}
                        </div>
                      </div>
                    </ZonaDrop>
                    <div className="fn-abaco-cifras-abajo">
                      <span className="fn-abaco-cifra-gris">{formatearMoneda(cat.monto_periodo_anterior)}</span>
                      <span className="fn-abaco-cifra-rojo">{formatearMoneda(cat.monto_real)}</span>
                      <span className="fn-abaco-cifra-azul">{asignado} bloques</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="fn-banco-wrapper">
              <div className="fn-banco-header">
                <strong>🧩 Bloques para simular</strong>
                <span>{data.total_bloques_ingresos} bloques de {formatearMoneda(data.valor_bloque)} (según las ventas del período anterior) · {bloquesSinAsignar} sin asignar</span>
              </div>
              <ZonaDrop id="banco">
                <div className="fn-bloques-fila">
                  {Array.from({ length: Math.max(bloquesSinAsignar, 0) }).map((_, i) => (
                    <Bloque key={`banco-${i}`} id={`banco-${i}`} zoneKey="banco" />
                  ))}
                  {bloquesSinAsignar < 0 && <span className="fn-error">Sobreasignado por {Math.abs(bloquesSinAsignar)} bloques</span>}
                  {bloquesSinAsignar === 0 && <span className="fn-nota">Todo asignado</span>}
                </div>
              </ZonaDrop>
            </div>
          </DndContext>

          {categoriasEgreso.length === 0 && (
            <p className="fn-info">Todavía no hay categorías del simulador. Usa "Gestionar categorías" para crear la primera (ej. Mercancía, Servicios, Personal...).</p>
          )}
        </>
      )}
    </div>
  );
};

// altura: alto en px de este bloque puntual — en el banco es fijo (cuadrito),
// dentro de una columna de gasto usa pxPorBloque para que la pila azul
// quede a la misma escala que las barras gris/rojo de al lado.
const Bloque = ({ id, zoneKey, altura }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, data: { zoneKey } });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10 }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="fn-bloque"
      style={{ ...style, opacity: isDragging ? 0.4 : 1, ...(altura ? { height: Math.max(4, altura - 2), width: '100%' } : {}) }}
    />
  );
};

const ZonaDrop = ({ id, children }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`fn-zona-drop ${isOver ? 'sobre' : ''}`}>
      {children}
    </div>
  );
};

// Ya no se crean categorías "propias" del simulador: usa las MISMAS
// categorias_gasto que se registran en Finanzas por módulo (donde se
// etiquetan los movimientos_caja reales). Aquí solo se decide cuáles de
// esas categorías reales aparecen como columna del ábaco.
const GestionCategoriasSimulador = ({ onCambio }) => {
  const [categorias, setCategorias] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState('');

  const cargar = useCallback(async () => {
    try {
      setCargando(true);
      const response = await api.get('/finanzas-negocio/categorias-gasto');
      setCategorias(response.data);
    } catch (error) {
      console.error('Error cargando categorías de gasto:', error);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const handleToggle = async (cat) => {
    const nuevoValor = !cat.mostrar_en_simulador;
    setCategorias(prev => prev.map(c => c.id === cat.id ? { ...c, mostrar_en_simulador: nuevoValor } : c));
    try {
      await api.put(`/finanzas-negocio/categorias-gasto/${cat.id}/mostrar-en-simulador`, { mostrar_en_simulador: nuevoValor });
      onCambio();
    } catch (error) {
      console.error('Error actualizando categoría:', error);
      setCategorias(prev => prev.map(c => c.id === cat.id ? { ...c, mostrar_en_simulador: !nuevoValor } : c));
      setMensaje(error.response?.data?.error || 'Error al actualizar la categoría');
      setTimeout(() => setMensaje(''), 4000);
    }
  };

  return (
    <div className="fn-card fn-gestion-categorias">
      <h4>Categorías en el simulador</h4>
      <p className="fn-nota">
        Marca cuáles categorías de gasto (las mismas que usas en Finanzas de cada módulo) quieres ver como columna en el ábaco.
        Para crear una categoría nueva, ve a Finanzas dentro del módulo correspondiente.
      </p>
      {mensaje && <p className="fn-error">{mensaje}</p>}
      {cargando && <p className="fn-info">Cargando...</p>}

      <ul className="fn-lista-categorias">
        {categorias.map(cat => (
          <li key={cat.id}>
            <label className="fn-checkbox-linea">
              <input
                type="checkbox"
                checked={cat.mostrar_en_simulador}
                onChange={() => handleToggle(cat)}
              />
              <span>{cat.nombre} <em>({nombreTipo(cat.tipo)} · {cat.modulo_nombre})</em></span>
            </label>
          </li>
        ))}
        {categorias.length === 0 && !cargando && (
          <p className="fn-info">No hay categorías de gasto creadas todavía. Créalas desde Finanzas dentro de cada módulo.</p>
        )}
      </ul>
    </div>
  );
};

// ==================== ACTIVOS FIJOS Y DEUDAS ====================

const ActivosYDeudas = () => {
  return (
    <div className="fn-seccion fn-grid-2">
      <ListaActivosFijos />
      <ListaDeudas />
    </div>
  );
};

const ListaActivosFijos = () => {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ nombre: '', valor: '', fecha_adquisicion: '' });
  const [editandoId, setEditandoId] = useState(null);
  const [mensaje, setMensaje] = useState('');

  const cargar = useCallback(async () => {
    try {
      const response = await api.get('/finanzas-negocio/activos-fijos');
      setItems(response.data);
    } catch (error) {
      console.error('Error cargando activos fijos:', error);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = { nombre: form.nombre, valor: parseFloat(form.valor), fecha_adquisicion: form.fecha_adquisicion || null };
      if (editandoId) {
        await api.put(`/finanzas-negocio/activos-fijos/${editandoId}`, payload);
      } else {
        await api.post('/finanzas-negocio/activos-fijos', payload);
      }
      setForm({ nombre: '', valor: '', fecha_adquisicion: '' });
      setEditandoId(null);
      await cargar();
    } catch (error) {
      setMensaje(error.response?.data?.error || 'Error al guardar');
      setTimeout(() => setMensaje(''), 4000);
    }
  };

  const iniciarEdicion = (item) => {
    setEditandoId(item.id);
    setForm({ nombre: item.nombre, valor: item.valor, fecha_adquisicion: item.fecha_adquisicion || '' });
  };

  const handleEliminar = async (id) => {
    if (!window.confirm('¿Eliminar este activo?')) return;
    await api.delete(`/finanzas-negocio/activos-fijos/${id}`);
    await cargar();
  };

  const total = items.reduce((sum, i) => sum + Number(i.valor), 0);

  return (
    <div className="fn-card">
      <h3>🏗️ Activos Fijos <span className="fn-total-card">{formatearMoneda(total)}</span></h3>
      {mensaje && <p className="fn-error">{mensaje}</p>}
      <form onSubmit={handleSubmit} className="fn-form-stack">
        <input type="text" placeholder="Nombre (ej. Nevera, mesas)" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
        <input type="number" min="0" placeholder="Valor" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} required />
        <input type="date" value={form.fecha_adquisicion} onChange={(e) => setForm({ ...form, fecha_adquisicion: e.target.value })} />
        <button type="submit">{editandoId ? 'Actualizar' : '+ Agregar'}</button>
      </form>
      <ul className="fn-lista-items">
        {items.map(item => (
          <li key={item.id}>
            <span>{item.nombre} — {formatearMoneda(item.valor)}</span>
            <span>
              <button onClick={() => iniciarEdicion(item)}>✏️</button>
              <button onClick={() => handleEliminar(item.id)}>🗑️</button>
            </span>
          </li>
        ))}
        {items.length === 0 && <li className="fn-info">Sin activos registrados</li>}
      </ul>
    </div>
  );
};

const ListaDeudas = () => {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ nombre: '', monto_total: '', saldo_pendiente: '', cuota_mensual: '' });
  const [editandoId, setEditandoId] = useState(null);
  const [mensaje, setMensaje] = useState('');

  const cargar = useCallback(async () => {
    try {
      const response = await api.get('/finanzas-negocio/deudas');
      setItems(response.data);
    } catch (error) {
      console.error('Error cargando deudas:', error);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        nombre: form.nombre,
        monto_total: parseFloat(form.monto_total),
        saldo_pendiente: form.saldo_pendiente !== '' ? parseFloat(form.saldo_pendiente) : parseFloat(form.monto_total),
        cuota_mensual: form.cuota_mensual !== '' ? parseFloat(form.cuota_mensual) : null
      };
      if (editandoId) {
        await api.put(`/finanzas-negocio/deudas/${editandoId}`, payload);
      } else {
        await api.post('/finanzas-negocio/deudas', payload);
      }
      setForm({ nombre: '', monto_total: '', saldo_pendiente: '', cuota_mensual: '' });
      setEditandoId(null);
      await cargar();
    } catch (error) {
      setMensaje(error.response?.data?.error || 'Error al guardar');
      setTimeout(() => setMensaje(''), 4000);
    }
  };

  const iniciarEdicion = (item) => {
    setEditandoId(item.id);
    setForm({
      nombre: item.nombre,
      monto_total: item.monto_total,
      saldo_pendiente: item.saldo_pendiente,
      cuota_mensual: item.cuota_mensual || ''
    });
  };

  const handleEliminar = async (id) => {
    if (!window.confirm('¿Eliminar esta deuda?')) return;
    await api.delete(`/finanzas-negocio/deudas/${id}`);
    await cargar();
  };

  const total = items.reduce((sum, i) => sum + Number(i.saldo_pendiente), 0);

  return (
    <div className="fn-card">
      <h3>💳 Deudas <span className="fn-total-card">{formatearMoneda(total)}</span></h3>
      {mensaje && <p className="fn-error">{mensaje}</p>}
      <form onSubmit={handleSubmit} className="fn-form-stack">
        <input type="text" placeholder="Nombre (ej. Préstamo banco)" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
        <input type="number" min="0" placeholder="Monto total" value={form.monto_total} onChange={(e) => setForm({ ...form, monto_total: e.target.value })} required />
        <input type="number" min="0" placeholder="Saldo pendiente (si es distinto al total)" value={form.saldo_pendiente} onChange={(e) => setForm({ ...form, saldo_pendiente: e.target.value })} />
        <input type="number" min="0" placeholder="Cuota mensual (opcional)" value={form.cuota_mensual} onChange={(e) => setForm({ ...form, cuota_mensual: e.target.value })} />
        <button type="submit">{editandoId ? 'Actualizar' : '+ Agregar'}</button>
      </form>
      <ul className="fn-lista-items">
        {items.map(item => (
          <li key={item.id}>
            <span>{item.nombre} — {formatearMoneda(item.saldo_pendiente)} pendiente</span>
            <span>
              <button onClick={() => iniciarEdicion(item)}>✏️</button>
              <button onClick={() => handleEliminar(item.id)}>🗑️</button>
            </span>
          </li>
        ))}
        {items.length === 0 && <li className="fn-info">Sin deudas registradas</li>}
      </ul>
    </div>
  );
};

// ==================== CONFIGURACIÓN ====================

const Configuracion = () => {
  const [form, setForm] = useState({ valor_bloque: '', reserva_seguridad_pct: '', gastos_personales_minimos: '' });
  const [mensaje, setMensaje] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const response = await api.get('/finanzas-negocio/configuracion');
        setForm({
          valor_bloque: response.data.valor_bloque || '',
          reserva_seguridad_pct: response.data.reserva_seguridad_pct || '',
          gastos_personales_minimos: response.data.gastos_personales_minimos || ''
        });
      } catch (error) {
        console.error('Error cargando configuración:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.put('/finanzas-negocio/configuracion', {
        valor_bloque: parseFloat(form.valor_bloque),
        reserva_seguridad_pct: parseFloat(form.reserva_seguridad_pct),
        gastos_personales_minimos: parseFloat(form.gastos_personales_minimos)
      });
      setMensaje('✅ Configuración guardada');
      setTimeout(() => setMensaje(''), 3000);
    } catch (error) {
      setMensaje(error.response?.data?.error || '❌ Error al guardar');
      setTimeout(() => setMensaje(''), 4000);
    }
  };

  if (loading) return <p className="fn-info">Cargando...</p>;

  return (
    <div className="fn-seccion">
      <div className="fn-card" style={{ maxWidth: 480 }}>
        <h3>⚙️ Configuración financiera</h3>
        {mensaje && <p className={mensaje.startsWith('✅') ? 'fn-exito' : 'fn-error'}>{mensaje}</p>}
        <form onSubmit={handleSubmit} className="fn-form-stack">
          <label>
            Valor de cada bloque (simulador)
            <input type="number" min="1" value={form.valor_bloque} onChange={(e) => setForm({ ...form, valor_bloque: e.target.value })} placeholder="Ej. 50000" required />
          </label>
          <label>
            Reserva de seguridad (% de gastos fijos)
            <input type="number" min="0" max="100" value={form.reserva_seguridad_pct} onChange={(e) => setForm({ ...form, reserva_seguridad_pct: e.target.value })} placeholder="Ej. 15" required />
          </label>
          <label>
            Gastos personales mínimos mensuales
            <input type="number" min="0" value={form.gastos_personales_minimos} onChange={(e) => setForm({ ...form, gastos_personales_minimos: e.target.value })} placeholder="Ej. 800000" required />
          </label>
          <button type="submit">Guardar configuración</button>
        </form>
      </div>
    </div>
  );
};

export default FinanzasNegocio;
