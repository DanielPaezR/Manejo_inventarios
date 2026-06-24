import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import './Estadisticas.css';

const Estadisticas = ({ user }) => {
  const { moduloActivo } = useModulo();
  const [estadisticas, setEstadisticas] = useState(null);
  const [loading, setLoading] = useState(false);
  const [periodo, setPeriodo] = useState('hoy');
  const [fechas, setFechas] = useState({ inicio: '', fin: '' });
  const [vistaActiva, setVistaActiva] = useState('general'); // 'general', 'productos', 'ventas', 'clientes'
  const [hoveredProducto, setHoveredProducto] = useState(null);

  // Cargar estadísticas
  const cargarEstadisticas = useCallback(async () => {
    try {
      setLoading(true);
      
      let params = { periodo };
      
      if (periodo === 'personalizado') {
        if (!fechas.inicio || !fechas.fin) {
          alert('Selecciona ambas fechas');
          setLoading(false);
          return;
        }
        params.fecha_inicio = fechas.inicio;
        params.fecha_fin = fechas.fin;
      }

      const response = await api.get('/estadisticas', { params });
      setEstadisticas(response.data);
    } catch (error) {
      console.error('Error cargando estadísticas:', error);
    } finally {
      setLoading(false);
    }
  }, [periodo, fechas]);

  useEffect(() => {
    if (moduloActivo) {
      cargarEstadisticas();
    }
  }, [moduloActivo, periodo, cargarEstadisticas]);

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
        </div>
      </div>

      {/* Filtros de período */}
      <div className="filtros-periodo">
        <div className="periodo-selector">
          <button 
            className={`btn-periodo ${periodo === 'hoy' ? 'active' : ''}`}
            onClick={() => setPeriodo('hoy')}
          >
            Hoy
          </button>
          <button 
            className={`btn-periodo ${periodo === 'semana' ? 'active' : ''}`}
            onClick={() => setPeriodo('semana')}
          >
            Semana
          </button>
          <button 
            className={`btn-periodo ${periodo === 'mes' ? 'active' : ''}`}
            onClick={() => setPeriodo('mes')}
          >
            Mes
          </button>
          <button 
            className={`btn-periodo ${periodo === 'personalizado' ? 'active' : ''}`}
            onClick={() => setPeriodo('personalizado')}
          >
            Personalizado
          </button>
        </div>
        
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
            <button onClick={cargarEstadisticas} className="btn-aplicar">
              ✅ Aplicar
            </button>
          </div>
        )}
      </div>

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

              {/* Gráfico de ventas por día */}
              <div className="card grafico-ventas-dia">
                <h3>📈 Ventas por día</h3>
                {estadisticas.ventasPorDia?.length > 0 ? (
                  <div className="grafico-container">
                    <div className="grafico-barras">
                      {estadisticas.ventasPorDia.map((dia, index) => {
                        const maxValor = Math.max(...estadisticas.ventasPorDia.map(d => d.total));
                        const altura = maxValor > 0 ? (dia.total / maxValor) * 100 : 0;
                        return (
                          <div key={index} className="barra-container">
                            <div 
                              className="barra" 
                              style={{ height: `${Math.max(5, altura)}%` }}
                              title={`${new Date(dia.fecha).toLocaleDateString()}: ${formatearMoneda(dia.total)}`}
                            >
                              <span className="barra-valor">{formatearMoneda(dia.total)}</span>
                            </div>
                            <span className="barra-fecha">
                              {new Date(dia.fecha).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' })}
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
                      {estadisticas.productosStockBajo?.filter(p => p.estado === 'Agotado').length || 0}
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