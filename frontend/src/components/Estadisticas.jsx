import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import GraficoLineas from './GraficoLineas';
import './Estadisticas.css';

// Aritmética de calendario pura en UTC (año/mes/día, sin horas): evita que
// sumar/restar días se corra un día por la zona horaria del navegador.
// Mismo criterio que sumarDias en Finanzas.jsx.
const sumarDiasUTC = (fechaStr, dias) => {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
};

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const formatearRangoFechas = (inicioStr, finStr) => {
  if (!inicioStr || !finStr) return '';
  const [, mi, di] = inicioStr.split('-').map(Number);
  const [, mf, df] = finStr.split('-').map(Number);
  if (mi === mf) return `${di} - ${df} ${MESES_CORTOS[mi - 1]}`;
  return `${di} ${MESES_CORTOS[mi - 1]} - ${df} ${MESES_CORTOS[mf - 1]}`;
};

const Estadisticas = ({ user }) => {
  const { moduloActivo } = useModulo();
  const [estadisticas, setEstadisticas] = useState(null);
  const [loading, setLoading] = useState(false);
  const [periodo, setPeriodo] = useState('hoy');
  const [fechas, setFechas] = useState({ inicio: '', fin: '' });
  const [vistaActiva, setVistaActiva] = useState('general'); // 'general', 'productos', 'ventas', 'finanzas', 'evolucion'
  const [hoveredProducto, setHoveredProducto] = useState(null);
  const [finanzasResumen, setFinanzasResumen] = useState(null);
  const [loadingFinanzas, setLoadingFinanzas] = useState(false);

  // Navegación ← → a bloques anteriores/siguientes cuando periodo es
  // 'semana' o 'mes' (rolling por defecto). periodoOffset 0 = el bloque
  // "actual" que ya devuelve el backend; -1 = el bloque inmediatamente
  // anterior, del mismo ancho, y así sucesivamente. periodoAnchorRef
  // guarda fecha_inicio/fecha_fin/dias del bloque en offset 0 la primera
  // vez que se carga (viene del backend, ya en hora Colombia), para poder
  // calcular los bloques anteriores con aritmética de fechas pura, sin
  // depender de la fecha del navegador. Es un ref (no state) para no
  // tener que incluirlo en las dependencias de los callbacks de carga.
  const [periodoOffset, setPeriodoOffset] = useState(0);
  const periodoAnchorRef = useRef(null);

  const cambiarPeriodo = (nuevoPeriodo) => {
    setPeriodo(nuevoPeriodo);
    setPeriodoOffset(0);
    periodoAnchorRef.current = null;
  };

  // Arma los params de periodo para /estadisticas y /finanzas/resumen-periodo.
  // Devuelve null si periodo='personalizado' y todavía faltan fechas.
  const construirParamsPeriodo = () => {
    if (periodo === 'personalizado') {
      if (!fechas.inicio || !fechas.fin) return null;
      return { periodo: 'personalizado', fecha_inicio: fechas.inicio, fecha_fin: fechas.fin };
    }
    if ((periodo === 'semana' || periodo === 'mes') && periodoOffset !== 0 && periodoAnchorRef.current) {
      const anchor = periodoAnchorRef.current;
      const fin = sumarDiasUTC(anchor.fin, periodoOffset * anchor.dias);
      const inicio = sumarDiasUTC(fin, -(anchor.dias - 1));
      return { periodo: 'personalizado', fecha_inicio: inicio, fecha_fin: fin };
    }
    return { periodo };
  };

  // Cargar estadísticas
  const cargarEstadisticas = useCallback(async () => {
    const params = construirParamsPeriodo();
    if (!params) {
      alert('Selecciona ambas fechas');
      return;
    }

    try {
      setLoading(true);
      const response = await api.get('/estadisticas', { params });
      setEstadisticas(response.data);

      // Ancla el bloque "actual" (offset 0) la primera vez que se carga,
      // para poder navegar a bloques anteriores más adelante.
      if ((periodo === 'semana' || periodo === 'mes') && periodoOffset === 0) {
        periodoAnchorRef.current = {
          inicio: response.data.periodoInfo.fecha_inicio,
          fin: response.data.periodoInfo.fecha_fin,
          dias: response.data.periodoInfo.dias
        };
      }
    } catch (error) {
      console.error('Error cargando estadísticas:', error);
    } finally {
      setLoading(false);
    }
  }, [periodo, fechas, periodoOffset]);

  useEffect(() => {
    if (moduloActivo) {
      cargarEstadisticas();
    }
  }, [moduloActivo, periodo, periodoOffset, cargarEstadisticas]);

  // movimientos_caja es del negocio completo, no por módulo, pero se
  // gatea igual por moduloActivo para ser consistente con el resto de la
  // página. Reutiliza el mismo estado de periodo/fechas/navegación, se
  // carga solo al entrar a la pestaña Finanzas (no en cada cambio de
  // periodo si no está activa).
  const cargarFinanzasResumen = useCallback(async () => {
    const params = construirParamsPeriodo();
    if (!params) {
      return;
    }

    try {
      setLoadingFinanzas(true);
      const response = await api.get('/finanzas/resumen-periodo', { params });
      setFinanzasResumen(response.data);
    } catch (error) {
      console.error('Error cargando resumen financiero:', error);
    } finally {
      setLoadingFinanzas(false);
    }
  }, [periodo, fechas, periodoOffset]);

  useEffect(() => {
    if (moduloActivo && vistaActiva === 'finanzas') {
      cargarFinanzasResumen();
    }
  }, [moduloActivo, vistaActiva, periodo, periodoOffset, cargarFinanzasResumen]);

  // Consumo propio: card independiente dentro de la vista 'ventas', con su
  // propio selector de periodo (no el general de la página) porque acá sí
  // queremos poder ver el histórico completo ('total'), algo que el
  // selector general no ofrece.
  const [consumoPropioPeriodo, setConsumoPropioPeriodo] = useState('hoy');
  const [consumoPropioData, setConsumoPropioData] = useState(null);
  const [loadingConsumoPropio, setLoadingConsumoPropio] = useState(false);

  const cargarConsumoPropio = useCallback(async () => {
    try {
      setLoadingConsumoPropio(true);
      const response = await api.get('/estadisticas/consumo-propio', {
        params: { periodo: consumoPropioPeriodo }
      });
      setConsumoPropioData(response.data);
    } catch (error) {
      console.error('Error cargando consumo propio:', error);
    } finally {
      setLoadingConsumoPropio(false);
    }
  }, [consumoPropioPeriodo]);

  useEffect(() => {
    if (moduloActivo && vistaActiva === 'ventas') {
      cargarConsumoPropio();
    }
  }, [moduloActivo, vistaActiva, consumoPropioPeriodo, cargarConsumoPropio]);

  // Evolución en el tiempo (balance acumulado + egresos por categoría):
  // pestaña independiente, con su propio selector de granularidad y de
  // rango — no reutiliza el periodo/fechas general de arriba porque acá
  // "todo el historial" (sin fecha_inicio/fecha_fin) es el default, no
  // "hoy".
  //
  // Modo 'ventana': navegación ← → por bloques de N buckets (ver
  // VENTANA_BUCKETS), del mismo ancho, hacia atrás/adelante — para
  // comparar un bloque de semanas/meses contra el anterior sin tener que
  // escribir fechas a mano. evolucionAnchor guarda la fecha del bucket
  // más reciente (la calcula el backend, ya en hora Colombia) la primera
  // vez que carga sin rango (modo 'todo', o la primera carga de
  // 'ventana' antes de tener ancla), para poder calcular los bloques
  // anteriores con aritmética de fechas pura, sin depender de la fecha
  // del navegador. Es state (no ref) a propósito: al capturarla por
  // primera vez en modo 'ventana' con offset 0, el cambio de estado
  // dispara un segundo fetch que ya sí llega con el rango calculado —
  // si fuera un ref, el primer fetch en 'ventana' se quedaría mostrando
  // todo el historial hasta el próximo clic en ← o →.
  const VENTANA_BUCKETS = { dia: 14, semana: 8, mes: 6 };
  const DIAS_POR_BUCKET = { dia: 1, semana: 7, mes: 30 };

  const [evolucionGranularidad, setEvolucionGranularidad] = useState('semana');
  const [evolucionModoRango, setEvolucionModoRango] = useState('todo'); // 'todo' | 'ventana' | 'personalizado'
  const [evolucionOffset, setEvolucionOffset] = useState(0);
  const [evolucionAnchor, setEvolucionAnchor] = useState(null);
  const [evolucionFechas, setEvolucionFechas] = useState({ inicio: '', fin: '' });
  const [evolucionBalance, setEvolucionBalance] = useState(null);
  const [evolucionEgresos, setEvolucionEgresos] = useState(null);
  const [loadingEvolucion, setLoadingEvolucion] = useState(false);

  const cambiarEvolucionGranularidad = (nuevaGranularidad) => {
    setEvolucionGranularidad(nuevaGranularidad);
    setEvolucionOffset(0);
    setEvolucionAnchor(null);
  };

  const cambiarEvolucionModoRango = (nuevoModo) => {
    setEvolucionModoRango(nuevoModo);
    setEvolucionOffset(0);
  };

  const cargarEvolucion = useCallback(async () => {
    if (evolucionModoRango === 'personalizado' && (!evolucionFechas.inicio || !evolucionFechas.fin)) {
      return;
    }

    const params = { granularidad: evolucionGranularidad };
    if (evolucionModoRango === 'personalizado') {
      params.fecha_inicio = evolucionFechas.inicio;
      params.fecha_fin = evolucionFechas.fin;
    } else if (evolucionModoRango === 'ventana' && evolucionAnchor) {
      const diasVentana = VENTANA_BUCKETS[evolucionGranularidad] * DIAS_POR_BUCKET[evolucionGranularidad];
      const fin = sumarDiasUTC(evolucionAnchor, evolucionOffset * diasVentana);
      const inicio = sumarDiasUTC(fin, -(diasVentana - 1));
      params.fecha_inicio = inicio;
      params.fecha_fin = fin;
    }
    // Si el modo es 'ventana' pero todavía no hay ancla (primera carga de
    // la pestaña), se pide sin fechas — igual que 'todo' — y de esa
    // respuesta se toma el ancla para las siguientes navegaciones.

    try {
      setLoadingEvolucion(true);
      const [balanceRes, egresosRes] = await Promise.all([
        api.get('/finanzas/evolucion-balance', { params }),
        api.get('/finanzas/evolucion-egresos', { params })
      ]);
      setEvolucionBalance(balanceRes.data);
      setEvolucionEgresos(egresosRes.data);

      if (!evolucionAnchor) {
        const puntos = balanceRes.data.puntos;
        if (puntos.length > 0) {
          setEvolucionAnchor(puntos[puntos.length - 1].fecha);
        }
      }
    } catch (error) {
      console.error('Error cargando evolución financiera:', error);
    } finally {
      setLoadingEvolucion(false);
    }
  }, [evolucionGranularidad, evolucionModoRango, evolucionOffset, evolucionFechas, evolucionAnchor]);

  useEffect(() => {
    if (moduloActivo && vistaActiva === 'evolucion' && evolucionModoRango !== 'personalizado') {
      cargarEvolucion();
    }
  }, [moduloActivo, vistaActiva, evolucionGranularidad, evolucionModoRango, evolucionOffset, cargarEvolucion]);

  // Calcular métricas adicionales
  const metricasAvanzadas = useMemo(() => {
    if (!estadisticas) return null;

    const ventas = estadisticas.ventasPeriodo || { total: 0, monto: 0 };
    const ventasPorDia = estadisticas.ventasPorDia || [];
    
    // Calcular promedio de ventas por día
    const promedioDiario = ventasPorDia.length > 0 
      ? ventas.monto / ventasPorDia.length 
      : 0;

    // Calcular ticket promedio
    const ticketPromedio = ventas.total > 0 
      ? ventas.monto / ventas.total 
      : 0;

    // Calcular crecimiento (comparar con período anterior)
    // Simulado - en producción vendría de la API

    return {
      promedioDiario,
      ticketPromedio,
      totalVentas: ventas.total,
      montoTotal: ventas.monto,
      diasConVentas: ventasPorDia.length
    };
  }, [estadisticas]);

  // Formatear moneda
  const formatearMoneda = (valor) => {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(valor || 0);
  };

  // Calcular porcentaje del total
  const calcularPorcentaje = (valor, total) => {
    if (!total || total === 0) return 0;
    return ((valor / total) * 100).toFixed(1);
  };

  // Obtener color según posición
  const getColorPorPosicion = (index) => {
    const colores = ['#4299e1', '#48bb78', '#ed8936', '#9f7aea', '#fc8181', '#68d391', '#f6ad55', '#63b3ed', '#b794f4', '#f687b3'];
    return colores[index % colores.length];
  };

  if (!moduloActivo) {
    return (
      <div className="estadisticas-container">
        <div className="alert alert-warning">
          ⚠️ No hay módulo activo. Selecciona un módulo para ver las estadísticas.
        </div>
      </div>
    );
  }

  return (
    <div className="estadisticas-container">
      {/* Header */}
      <div className="estadisticas-header">
        <div className="header-left">
          <h2>📊 Panel de Estadísticas</h2>
          <div className="modulo-indicador">
            <span className="badge">📁 {moduloActivo.nombre}</span>
          </div>
        </div>
        <div className="header-right">
          <button 
            className={`btn-vista ${vistaActiva === 'general' ? 'active' : ''}`}
            onClick={() => setVistaActiva('general')}
          >
            📊 General
          </button>
          <button 
            className={`btn-vista ${vistaActiva === 'productos' ? 'active' : ''}`}
            onClick={() => setVistaActiva('productos')}
          >
            📦 Productos
          </button>
          <button
            className={`btn-vista ${vistaActiva === 'ventas' ? 'active' : ''}`}
            onClick={() => setVistaActiva('ventas')}
          >
            💰 Ventas
          </button>
          <button
            className={`btn-vista ${vistaActiva === 'finanzas' ? 'active' : ''}`}
            onClick={() => setVistaActiva('finanzas')}
          >
            💰 Ingresos y Egresos
          </button>
          <button
            className={`btn-vista ${vistaActiva === 'evolucion' ? 'active' : ''}`}
            onClick={() => setVistaActiva('evolucion')}
          >
            📈 Evolución
          </button>
        </div>
      </div>

      {/* Filtros de período: no aplican a la pestaña "Evolución", que tiene
          su propio selector de granularidad/rango más abajo. */}
      {vistaActiva !== 'evolucion' && (
      <div className="filtros-periodo">
        <div className="periodo-selector">
          <button
            className={`btn-periodo ${periodo === 'hoy' ? 'active' : ''}`}
            onClick={() => cambiarPeriodo('hoy')}
          >
            Hoy
          </button>
          <button
            className={`btn-periodo ${periodo === 'semana' ? 'active' : ''}`}
            onClick={() => cambiarPeriodo('semana')}
          >
            Semana
          </button>
          <button
            className={`btn-periodo ${periodo === 'mes' ? 'active' : ''}`}
            onClick={() => cambiarPeriodo('mes')}
          >
            Mes
          </button>
          <button
            className={`btn-periodo ${periodo === 'personalizado' ? 'active' : ''}`}
            onClick={() => cambiarPeriodo('personalizado')}
          >
            Personalizado
          </button>
        </div>

        {/* Navegar a la semana/mes anterior o siguiente, del mismo ancho
            que el bloque "actual" — útil para comparar contra períodos
            pasados sin tener que escribir fechas a mano. */}
        {(periodo === 'semana' || periodo === 'mes') && (
          <div className="periodo-navegacion">
            <button
              type="button"
              onClick={() => setPeriodoOffset(o => o - 1)}
              disabled={loading}
              className="btn-icono"
              title={periodo === 'semana' ? 'Semana anterior' : 'Mes anterior'}
            >
              ←
            </button>
            {periodoOffset !== 0 && (
              <span className="periodo-navegacion-rango">
                {formatearRangoFechas(estadisticas?.periodoInfo?.fecha_inicio, estadisticas?.periodoInfo?.fecha_fin)}
              </span>
            )}
            <button
              type="button"
              onClick={() => setPeriodoOffset(o => Math.min(0, o + 1))}
              disabled={loading || periodoOffset === 0}
              className="btn-icono"
              title={periodo === 'semana' ? 'Semana siguiente' : 'Mes siguiente'}
            >
              →
            </button>
          </div>
        )}

        {periodo === 'personalizado' && (
          <div className="fechas-personalizadas">
            <input
              type="date"
              value={fechas.inicio}
              onChange={(e) => setFechas({ ...fechas, inicio: e.target.value })}
              className="input-fecha"
            />
            <span className="fecha-separador">→</span>
            <input
              type="date"
              value={fechas.fin}
              onChange={(e) => setFechas({ ...fechas, fin: e.target.value })}
              className="input-fecha"
            />
            <button
              onClick={() => {
                cargarEstadisticas();
                if (vistaActiva === 'finanzas') cargarFinanzasResumen();
              }}
              className="btn-aplicar"
            >
              ✅ Aplicar
            </button>
          </div>
        )}
      </div>
      )}

      {loading ? (
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Cargando estadísticas...</p>
        </div>
      ) : estadisticas ? (
        <>
          {/* ============================================================
              VISTA GENERAL
              ============================================================ */}
          {vistaActiva === 'general' && (
            <div className="estadisticas-grid">
              {/* Métricas principales */}
              <div className="card metricas-principales">
                <div className="metricas-grid">
                  <div className="metrica-item">
                    <div className="metrica-icono">💰</div>
                    <div className="metrica-info">
                      <span className="metrica-valor">{formatearMoneda(metricasAvanzadas?.montoTotal)}</span>
                      <span className="metrica-label">Ventas totales</span>
                      {typeof estadisticas.comparacionPeriodoAnterior?.cambioMontoPct === 'number' && (
                        <span className={`metrica-comparacion ${estadisticas.comparacionPeriodoAnterior.cambioMontoPct >= 0 ? 'positivo' : 'negativo'}`}>
                          {estadisticas.comparacionPeriodoAnterior.cambioMontoPct >= 0 ? '▲' : '▼'} {Math.abs(estadisticas.comparacionPeriodoAnterior.cambioMontoPct).toFixed(1)}% vs período anterior
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="metrica-item">
                    <div className="metrica-icono">📊</div>
                    <div className="metrica-info">
                      <span className="metrica-valor">{metricasAvanzadas?.totalVentas || 0}</span>
                      <span className="metrica-label">Transacciones</span>
                    </div>
                  </div>
                  <div className="metrica-item">
                    <div className="metrica-icono">🎫</div>
                    <div className="metrica-info">
                      <span className="metrica-valor">{formatearMoneda(metricasAvanzadas?.ticketPromedio)}</span>
                      <span className="metrica-label">Ticket promedio</span>
                    </div>
                  </div>
                  <div className="metrica-item">
                    <div className="metrica-icono">📅</div>
                    <div className="metrica-info">
                      <span className="metrica-valor">{formatearMoneda(metricasAvanzadas?.promedioDiario)}</span>
                      <span className="metrica-label">Promedio diario</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Valor en mercancía */}
              <div className="card valor-mercancia-card">
                <div className="metrica-item">
                  <div className="metrica-icono">💰</div>
                  <div className="metrica-info">
                    <span className="metrica-valor">{formatearMoneda(estadisticas.valor_mercancia)}</span>
                    <span className="metrica-label">Valor en mercancía</span>
                    <span className="metrica-nota">A precio de venta</span>
                  </div>
                </div>
              </div>

              {/* Gráfico de ventas por día */}
              <div className="card grafico-ventas-dia">
                <h3>📈 Ventas por día</h3>
                {estadisticas.ventasPorDia?.length > 0 ? (
                  <div className="grafico-container">
                    <div className="grafico-barras">
                      {estadisticas.ventasPorDia.map((dia, index) => {
                        const maxValor = Math.max(...estadisticas.ventasPorDia.map(d => d.total));
                        const altura = maxValor > 0 ? (dia.total / maxValor) * 100 : 0;
                        // dia.fecha llega como texto 'YYYY-MM-DD' (día ya
                        // calculado en hora Colombia por el backend). Se
                        // ancla a mediodía UTC antes de formatear para que
                        // ningún navegador, en ninguna zona horaria, le
                        // reste/sume un día por accidente al aplicar la
                        // zona horaria local del dispositivo.
                        const fechaSegura = new Date(`${dia.fecha}T12:00:00Z`);
                        return (
                          <div key={index} className="barra-container">
                            <div
                              className="barra"
                              style={{ height: `${Math.max(5, altura)}%` }}
                              title={`${fechaSegura.toLocaleDateString('es-CO', { timeZone: 'UTC' })}: ${formatearMoneda(dia.total)}`}
                            >
                              <span className="barra-valor">{formatearMoneda(dia.total)}</span>
                            </div>
                            <span className="barra-fecha">
                              {fechaSegura.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="sin-datos">No hay ventas en este período</p>
                )}
              </div>

              {/* Top productos */}
              <div className="card top-productos">
                <h3>🔥 Productos más vendidos</h3>
                {estadisticas.topProductos?.length > 0 ? (
                  <div className="top-productos-lista">
                    {estadisticas.topProductos.map((producto, index) => {
                      const maxVentas = estadisticas.topProductos[0]?.total_vendido || 1;
                      const porcentaje = (producto.total_vendido / maxVentas) * 100;
                      return (
                        <div 
                          key={index} 
                          className="producto-top-item"
                          onMouseEnter={() => setHoveredProducto(index)}
                          onMouseLeave={() => setHoveredProducto(null)}
                        >
                          <div className="producto-top-info">
                            <span className="producto-posicion">{index + 1}</span>
                            <span className="producto-top-nombre">{producto.nombre}</span>
                            <span className="producto-top-cantidad">{producto.total_vendido} uds</span>
                          </div>
                          <div className="producto-top-bar">
                            <div 
                              className="producto-top-progreso" 
                              style={{ 
                                width: `${porcentaje}%`,
                                background: getColorPorPosicion(index)
                              }}
                            />
                          </div>
                          <span className="producto-top-monto">{formatearMoneda(producto.monto_total)}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="sin-datos">No hay datos de productos vendidos</p>
                )}
              </div>

              {/* Métricas rápidas */}
              <div className="card metricas-rapidas">
                <h3>📊 Resumen rápido</h3>
                <div className="metricas-rapidas-grid">
                  <div className="rapida-item">
                    <span className="rapida-icono">📦</span>
                    <div>
                      <span className="rapida-valor">{estadisticas.totalProductos || 0}</span>
                      <span className="rapida-label">Productos activos</span>
                    </div>
                  </div>
                  <div className="rapida-item">
                    <span className="rapida-icono">⚠️</span>
                    <div>
                      <span className="rapida-valor">{estadisticas.productosStockBajo?.total || 0}</span>
                      <span className="rapida-label">Stock bajo</span>
                    </div>
                  </div>
                  <div className="rapida-item">
                    <span className="rapida-icono">💳</span>
                    <div>
                      <span className="rapida-valor">{estadisticas.metodoPagoPopular?.metodo_pago || 'N/A'}</span>
                      <span className="rapida-label">Método más usado</span>
                    </div>
                  </div>
                  <div className="rapida-item">
                    <span className="rapida-icono">📆</span>
                    <div>
                      <span className="rapida-valor">{estadisticas.periodoInfo?.dias || 0}</span>
                      <span className="rapida-label">Días analizados</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================
              VISTA DE PRODUCTOS
              ============================================================ */}
          {vistaActiva === 'productos' && (
            <div className="estadisticas-grid productos-view">
              <div className="card productos-detalle">
                <h3>📦 Análisis de Productos</h3>
                <div className="productos-stats">
                  <div className="stat-item">
                    <span>Total productos</span>
                    <strong>{estadisticas.totalProductos || 0}</strong>
                  </div>
                  <div className="stat-item">
                    <span>Con stock bajo</span>
                    <strong className="text-warning">{estadisticas.productosStockBajo?.total || 0}</strong>
                  </div>
                  <div className="stat-item">
                    <span>Sin stock</span>
                    <strong className="text-danger">
                      {estadisticas.productosStockBajo?.agotados || 0}
                    </strong>
                  </div>
                </div>

                <div className="productos-top-lista">
                  <h4>🏆 Top productos por ventas</h4>
                  {estadisticas.topProductos?.length > 0 ? (
                    <table className="tabla-top-productos">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Producto</th>
                          <th>Unidades</th>
                          <th>Total</th>
                          <th>%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {estadisticas.topProductos.map((producto, index) => {
                          const totalVentas = estadisticas.topProductos.reduce((sum, p) => sum + p.total_vendido, 0);
                          const porcentaje = totalVentas > 0 ? (producto.total_vendido / totalVentas) * 100 : 0;
                          return (
                            <tr key={index}>
                              <td>{index + 1}</td>
                              <td>{producto.nombre}</td>
                              <td>{producto.total_vendido}</td>
                              <td>{formatearMoneda(producto.monto_total)}</td>
                              <td>
                                <span className="porcentaje-badge">{porcentaje.toFixed(1)}%</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <p className="sin-datos">No hay datos de productos</p>
                  )}
                </div>

                <div className="productos-sin-venta">
                  <h4>😴 Sin movimiento en este período</h4>
                  {estadisticas.productosSinVenta?.length > 0 ? (
                    <table className="tabla-top-productos">
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th>Categoría</th>
                          <th>Stock actual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {estadisticas.productosSinVenta.map((producto) => (
                          <tr key={producto.id}>
                            <td>{producto.nombre}</td>
                            <td>{producto.categoria_nombre || 'Sin categoría'}</td>
                            <td>{producto.stock_actual}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="sin-datos">Todos los productos tuvieron ventas en este período 🎉</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ============================================================
              VISTA DE VENTAS
              ============================================================ */}
          {vistaActiva === 'ventas' && (
            <div className="estadisticas-grid ventas-view">
              <div className="card ventas-detalle">
                <h3>💰 Análisis de Ventas</h3>
                
                <div className="ventas-metricas-grid">
                  <div className="venta-metrica">
                    <span className="venta-metrica-icono">📊</span>
                    <div>
                      <span className="venta-metrica-valor">{estadisticas.ventasPeriodo?.total || 0}</span>
                      <span className="venta-metrica-label">Total ventas</span>
                    </div>
                  </div>
                  <div className="venta-metrica">
                    <span className="venta-metrica-icono">💰</span>
                    <div>
                      <span className="venta-metrica-valor">{formatearMoneda(estadisticas.ventasPeriodo?.monto)}</span>
                      <span className="venta-metrica-label">Monto total</span>
                    </div>
                  </div>
                  <div className="venta-metrica">
                    <span className="venta-metrica-icono">🎫</span>
                    <div>
                      <span className="venta-metrica-valor">{formatearMoneda(metricasAvanzadas?.ticketPromedio)}</span>
                      <span className="venta-metrica-label">Ticket promedio</span>
                    </div>
                  </div>
                </div>

                <div className="ventas-metodos">
                  <h4>💳 Métodos de pago</h4>
                  {estadisticas.metodoPagoPopular ? (
                    <div className="metodo-popular">
                      <span className="metodo-nombre">{estadisticas.metodoPagoPopular.metodo_pago}</span>
                      <span className="metodo-detalle">
                        {estadisticas.metodoPagoPopular.cantidad} ventas · {formatearMoneda(estadisticas.metodoPagoPopular.monto_total)}
                      </span>
                    </div>
                  ) : (
                    <p className="sin-datos">Sin datos de métodos de pago</p>
                  )}
                </div>

                <div className="ventas-periodo-info">
                  <h4>📆 Información del período</h4>
                  <div className="periodo-detalles">
                    <span><strong>Tipo:</strong> {estadisticas.periodoInfo?.tipo || 'N/A'}</span>
                    <span><strong>Desde:</strong> {estadisticas.periodoInfo?.fecha_inicio || 'N/A'}</span>
                    <span><strong>Hasta:</strong> {estadisticas.periodoInfo?.fecha_fin || 'N/A'}</span>
                    <span><strong>Días:</strong> {estadisticas.periodoInfo?.dias || 0}</span>
                  </div>
                </div>
              </div>

              {/* Consumo propio: mercancía retirada para uso personal, no
                  una venta real — por eso vive aparte del resto de esta
                  vista y tiene su propio selector de periodo (incluye
                  "Total", que el selector general de la página no ofrece). */}
              <div className="card consumo-propio-card">
                <h3>🏠 Consumo propio</h3>
                <div className="periodo-selector consumo-propio-periodo-selector">
                  <button
                    className={`btn-periodo ${consumoPropioPeriodo === 'hoy' ? 'active' : ''}`}
                    onClick={() => setConsumoPropioPeriodo('hoy')}
                  >
                    Hoy
                  </button>
                  <button
                    className={`btn-periodo ${consumoPropioPeriodo === 'semana' ? 'active' : ''}`}
                    onClick={() => setConsumoPropioPeriodo('semana')}
                  >
                    Semana
                  </button>
                  <button
                    className={`btn-periodo ${consumoPropioPeriodo === 'mes' ? 'active' : ''}`}
                    onClick={() => setConsumoPropioPeriodo('mes')}
                  >
                    Mes
                  </button>
                  <button
                    className={`btn-periodo ${consumoPropioPeriodo === 'total' ? 'active' : ''}`}
                    onClick={() => setConsumoPropioPeriodo('total')}
                  >
                    Total
                  </button>
                </div>

                {loadingConsumoPropio && !consumoPropioData ? (
                  <p className="sin-datos">Cargando...</p>
                ) : consumoPropioData?.totalRegistros > 0 ? (
                  <div className="ventas-metricas-grid">
                    <div className="venta-metrica">
                      <span className="venta-metrica-icono">📦</span>
                      <div>
                        <span className="venta-metrica-valor">{consumoPropioData.totalItems}</span>
                        <span className="venta-metrica-label">Items consumidos</span>
                      </div>
                    </div>
                    <div className="venta-metrica">
                      <span className="venta-metrica-icono">💵</span>
                      <div>
                        <span className="venta-metrica-valor">{formatearMoneda(consumoPropioData.valorTotal)}</span>
                        <span className="venta-metrica-label">Valor total</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="sin-datos">No hay consumo propio registrado en este período</p>
                )}
              </div>

              {/* Ventas por hora del día */}
              <div className="card grafico-ventas-hora">
                <h3>🕐 Ventas por hora del día</h3>
                {estadisticas.ventasPorHora?.some(h => Number(h.monto) > 0) ? (
                  <div className="grafico-container">
                    <div className="grafico-barras grafico-barras-compacto">
                      {estadisticas.ventasPorHora.map((h) => {
                        const maxValor = Math.max(...estadisticas.ventasPorHora.map(x => Number(x.monto)));
                        const altura = maxValor > 0 ? (Number(h.monto) / maxValor) * 100 : 0;
                        return (
                          <div key={h.hora} className="barra-container">
                            <div
                              className="barra"
                              style={{ height: `${Math.max(3, altura)}%` }}
                              title={`${h.hora}:00 · ${h.total_ventas} ventas · ${formatearMoneda(h.monto)}`}
                            >
                              <span className="barra-valor">{formatearMoneda(h.monto)}</span>
                            </div>
                            <span className="barra-fecha">{h.hora}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="sin-datos">No hay ventas en este período</p>
                )}
              </div>

              {/* Ventas por día de la semana */}
              <div className="card grafico-ventas-dia-semana">
                <h3>📅 Ventas por día de la semana</h3>
                {estadisticas.ventasPorDiaSemana?.some(d => Number(d.monto) > 0) ? (
                  <div className="grafico-container">
                    <div className="grafico-barras">
                      {[1, 2, 3, 4, 5, 6, 0].map((numeroDia) => {
                        const nombresDias = { 0: 'Dom', 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb' };
                        const dia = estadisticas.ventasPorDiaSemana.find(d => d.numero === numeroDia) || { numero: numeroDia, total_ventas: 0, monto: 0 };
                        const maxValor = Math.max(...estadisticas.ventasPorDiaSemana.map(x => Number(x.monto)));
                        const altura = maxValor > 0 ? (Number(dia.monto) / maxValor) * 100 : 0;
                        return (
                          <div key={numeroDia} className="barra-container">
                            <div
                              className="barra"
                              style={{ height: `${Math.max(3, altura)}%` }}
                              title={`${nombresDias[numeroDia]}: ${dia.total_ventas} ventas · ${formatearMoneda(dia.monto)}`}
                            >
                              <span className="barra-valor">{formatearMoneda(dia.monto)}</span>
                            </div>
                            <span className="barra-fecha">{nombresDias[numeroDia]}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="sin-datos">No hay ventas en este período</p>
                )}
              </div>
            </div>
          )}

          {/* ============================================================
              VISTA DE FINANZAS (ingresos y egresos)
              ============================================================ */}
          {vistaActiva === 'finanzas' && (
            <div className="estadisticas-grid">
              {loadingFinanzas && !finanzasResumen ? (
                <div className="loading-container">
                  <div className="spinner"></div>
                  <p>Cargando resumen financiero...</p>
                </div>
              ) : (
                <>
                  <div className="card finanzas-totales-card">
                    <div className="finanzas-total-item ingreso">
                      <span className="finanzas-total-label">💵 Total ingresos</span>
                      <span className="finanzas-total-valor">{formatearMoneda(finanzasResumen?.total_ingresos)}</span>
                    </div>
                    <div className="finanzas-total-item egreso">
                      <span className="finanzas-total-label">💸 Total egresos</span>
                      <span className="finanzas-total-valor">{formatearMoneda(finanzasResumen?.total_egresos)}</span>
                    </div>
                  </div>

                  <div className="card grafico-horizontal-card">
                    <h3>📉 Egresos por categoría</h3>
                    {finanzasResumen?.egresos_por_categoria?.length > 0 ? (
                      <div className="barras-horizontales">
                        {finanzasResumen.egresos_por_categoria.map((item, index) => (
                          <div key={index} className="barra-horizontal-item">
                            <div className="barra-horizontal-header">
                              <span className="barra-horizontal-nombre">{item.nombre}</span>
                              <span className="barra-horizontal-valor">
                                {formatearMoneda(item.monto)} ({item.porcentaje.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="barra-horizontal-track">
                              <div
                                className="barra-horizontal-fill egreso"
                                style={{ width: `${Math.max(2, item.porcentaje)}%` }}
                              ></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="sin-datos">No hay datos en este período</p>
                    )}
                  </div>

                  <div className="card grafico-horizontal-card">
                    <h3>📈 Ingresos por origen</h3>
                    {finanzasResumen?.ingresos_por_origen?.length > 0 ? (
                      <div className="barras-horizontales">
                        {finanzasResumen.ingresos_por_origen.map((item, index) => (
                          <div key={index} className="barra-horizontal-item">
                            <div className="barra-horizontal-header">
                              <span className="barra-horizontal-nombre">{item.nombre}</span>
                              <span className="barra-horizontal-valor">
                                {formatearMoneda(item.monto)} ({item.porcentaje.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="barra-horizontal-track">
                              <div
                                className="barra-horizontal-fill ingreso"
                                style={{ width: `${Math.max(2, item.porcentaje)}%` }}
                              ></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="sin-datos">No hay datos en este período</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ============================================================
              VISTA DE EVOLUCIÓN (balance acumulado + egresos en el tiempo)
              ============================================================ */}
          {vistaActiva === 'evolucion' && (
            <div className="estadisticas-grid">
              <div className="card evolucion-controles-card">
                <div className="periodo-selector">
                  <button
                    className={`btn-periodo ${evolucionGranularidad === 'dia' ? 'active' : ''}`}
                    onClick={() => cambiarEvolucionGranularidad('dia')}
                  >
                    Día
                  </button>
                  <button
                    className={`btn-periodo ${evolucionGranularidad === 'semana' ? 'active' : ''}`}
                    onClick={() => cambiarEvolucionGranularidad('semana')}
                  >
                    Semana
                  </button>
                  <button
                    className={`btn-periodo ${evolucionGranularidad === 'mes' ? 'active' : ''}`}
                    onClick={() => cambiarEvolucionGranularidad('mes')}
                  >
                    Mes
                  </button>
                </div>
                <div className="periodo-selector">
                  <button
                    className={`btn-periodo ${evolucionModoRango === 'todo' ? 'active' : ''}`}
                    onClick={() => cambiarEvolucionModoRango('todo')}
                  >
                    Todo el historial
                  </button>
                  <button
                    className={`btn-periodo ${evolucionModoRango === 'ventana' ? 'active' : ''}`}
                    onClick={() => cambiarEvolucionModoRango('ventana')}
                  >
                    Navegar por bloques
                  </button>
                  <button
                    className={`btn-periodo ${evolucionModoRango === 'personalizado' ? 'active' : ''}`}
                    onClick={() => cambiarEvolucionModoRango('personalizado')}
                  >
                    Rango personalizado
                  </button>
                </div>

                {/* Navegar al bloque anterior/siguiente de N periodos (ver
                    VENTANA_BUCKETS) — útil para comparar, por ejemplo, este
                    bloque de 8 semanas contra el anterior. */}
                {evolucionModoRango === 'ventana' && (
                  <div className="periodo-navegacion">
                    <button
                      type="button"
                      onClick={() => setEvolucionOffset(o => o - 1)}
                      disabled={loadingEvolucion}
                      className="btn-icono"
                      title="Bloque anterior"
                    >
                      ←
                    </button>
                    {evolucionBalance?.puntos?.length > 0 && (
                      <span className="periodo-navegacion-rango">
                        {formatearRangoFechas(
                          evolucionBalance.puntos[0].fecha,
                          evolucionBalance.puntos[evolucionBalance.puntos.length - 1].fecha
                        )}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setEvolucionOffset(o => Math.min(0, o + 1))}
                      disabled={loadingEvolucion || evolucionOffset === 0}
                      className="btn-icono"
                      title="Bloque siguiente"
                    >
                      →
                    </button>
                  </div>
                )}

                {evolucionModoRango === 'personalizado' && (
                  <div className="fechas-personalizadas">
                    <input
                      type="date"
                      value={evolucionFechas.inicio}
                      onChange={(e) => setEvolucionFechas({ ...evolucionFechas, inicio: e.target.value })}
                      className="input-fecha"
                    />
                    <span className="fecha-separador">→</span>
                    <input
                      type="date"
                      value={evolucionFechas.fin}
                      onChange={(e) => setEvolucionFechas({ ...evolucionFechas, fin: e.target.value })}
                      className="input-fecha"
                    />
                    <button onClick={cargarEvolucion} className="btn-aplicar">
                      ✅ Aplicar
                    </button>
                  </div>
                )}
              </div>

              {loadingEvolucion && !evolucionBalance ? (
                <div className="loading-container">
                  <div className="spinner"></div>
                  <p>Cargando evolución financiera...</p>
                </div>
              ) : (
                <>
                  <div className="card grafico-evolucion-card">
                    <h3>📈 Balance general en el tiempo</h3>
                    {evolucionBalance?.puntos?.length > 0 ? (
                      <GraficoLineas
                        altura={240}
                        series={[{
                          nombre: 'Balance',
                          color: evolucionBalance.balance_actual >= 0 ? '#48bb78' : '#fc8181',
                          datos: evolucionBalance.puntos.map(p => ({ fecha: p.fecha, valor: p.balance })),
                          total: evolucionBalance.balance_actual
                        }]}
                      />
                    ) : (
                      <p className="sin-datos">No hay datos en este período</p>
                    )}
                  </div>

                  <div className="card grafico-evolucion-card">
                    <h3>📉 Egresos por categoría en el tiempo</h3>
                    {evolucionEgresos?.puntos?.length > 0 ? (
                      <GraficoLineas
                        altura={240}
                        series={[
                          { nombre: 'Mercancía', color: '#4299e1', datos: evolucionEgresos.puntos.map(p => ({ fecha: p.fecha, valor: p.mercancia })) },
                          { nombre: 'Gastos fijos', color: '#ed8936', datos: evolucionEgresos.puntos.map(p => ({ fecha: p.fecha, valor: p.gastos_fijos })) },
                          { nombre: 'Gastos propios', color: '#9f7aea', datos: evolucionEgresos.puntos.map(p => ({ fecha: p.fecha, valor: p.gastos_propios })) },
                          { nombre: 'Otros', color: '#a0aec0', datos: evolucionEgresos.puntos.map(p => ({ fecha: p.fecha, valor: p.otros })) }
                        ]}
                      />
                    ) : (
                      <p className="sin-datos">No hay datos en este período</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="sin-datos">No hay estadísticas disponibles</div>
      )}
    </div>
  );
};

export default Estadisticas;