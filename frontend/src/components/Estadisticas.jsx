import React, { useState, useEffect } from 'react';
import api from '../services/api';
import './Estadisticas.css';

const Estadisticas = ({ user }) => {
  const [estadisticas, setEstadisticas] = useState(null);
  const [alertasStock, setAlertasStock] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Estados para filtros
  const [filtroPeriodo, setFiltroPeriodo] = useState('hoy'); // hoy, semana, mes, personalizado
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [mostrarFiltrosAvanzados, setMostrarFiltrosAvanzados] = useState(false);

  useEffect(() => {
    cargarEstadisticas();
    cargarAlertasStock();
  }, []);

  // Actualizar estadísticas cuando cambia el filtro
  useEffect(() => {
    if (filtroPeriodo !== 'personalizado') {
      cargarEstadisticas();
    }
  }, [filtroPeriodo]);

  const cargarEstadisticas = async () => {
    setLoading(true);
    try {
      let url = '/estadisticas';
      const params = new URLSearchParams();

      if (filtroPeriodo === 'hoy') {
        // Por defecto ya es hoy
      } else if (filtroPeriodo === 'semana') {
        params.append('periodo', 'semana');
      } else if (filtroPeriodo === 'mes') {
        params.append('periodo', 'mes');
      } else if (filtroPeriodo === 'personalizado' && fechaInicio && fechaFin) {
        params.append('periodo', 'personalizado');
        params.append('fecha_inicio', fechaInicio);
        params.append('fecha_fin', fechaFin);
      }

      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const response = await api.get(url);
      setEstadisticas(response.data);
    } catch (error) {
      console.error('Error cargando estadísticas:', error);
    } finally {
      setLoading(false);
    }
  };

  const cargarAlertasStock = async () => {
    try {
      const response = await api.get('/alertas/stock-bajo');
      setAlertasStock(response.data);
    } catch (error) {
      console.error('Error cargando alertas:', error);
    }
  };

  const aplicarFiltros = () => {
    if (filtroPeriodo === 'personalizado') {
      if (!fechaInicio || !fechaFin) {
        alert('Por favor seleccione ambas fechas para el período personalizado');
        return;
      }
      if (new Date(fechaInicio) > new Date(fechaFin)) {
        alert('La fecha de inicio no puede ser mayor a la fecha de fin');
        return;
      }
    }
    cargarEstadisticas();
  };

  const limpiarFiltros = () => {
    setFiltroPeriodo('hoy');
    setFechaInicio('');
    setFechaFin('');
    cargarEstadisticas();
  };

  // Calcular fecha límite para seleccionar (máximo 1 año atrás)
  const getMinDate = () => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 1);
    return date.toISOString().split('T')[0];
  };

  const getMaxDate = () => {
    return new Date().toISOString().split('T')[0];
  };

  const getPeriodoTexto = () => {
    switch (filtroPeriodo) {
      case 'hoy':
        return 'Hoy';
      case 'semana':
        return 'Esta Semana';
      case 'mes':
        return 'Este Mes';
      case 'personalizado':
        return `Personalizado (${fechaInicio} al ${fechaFin})`;
      default:
        return 'Hoy';
    }
  };

  if (loading && !estadisticas) {
    return <div className="loading">Cargando estadísticas...</div>;
  }

  return (
    <div className="estadisticas-container">
      <div className="estadisticas-header">
        <h1>Dashboard - Estadísticas</h1>
        
        {/* Filtros de Período */}
        <div className="filtros-container">
          <div className="filtros-basicos">
            <div className="filtro-grupo">
              <label>Período:</label>
              <select 
                value={filtroPeriodo} 
                onChange={(e) => setFiltroPeriodo(e.target.value)}
                className="select-filtro"
              >
                <option value="hoy">Hoy</option>
                <option value="semana">Esta Semana</option>
                <option value="mes">Este Mes</option>
                <option value="personalizado">Personalizado</option>
              </select>
            </div>

            {filtroPeriodo === 'personalizado' && (
              <div className="fechas-personalizadas">
                <div className="filtro-grupo">
                  <label>Desde:</label>
                  <input
                    type="date"
                    value={fechaInicio}
                    onChange={(e) => setFechaInicio(e.target.value)}
                    min={getMinDate()}
                    max={getMaxDate()}
                  />
                </div>
                <div className="filtro-grupo">
                  <label>Hasta:</label>
                  <input
                    type="date"
                    value={fechaFin}
                    onChange={(e) => setFechaFin(e.target.value)}
                    min={fechaInicio || getMinDate()}
                    max={getMaxDate()}
                  />
                </div>
              </div>
            )}

            <div className="filtro-acciones">
              <button 
                onClick={aplicarFiltros} 
                className="btn-aplicar-filtros"
                disabled={filtroPeriodo === 'personalizado' && (!fechaInicio || !fechaFin)}
              >
                🔄 Aplicar Filtros
              </button>
              
              {filtroPeriodo !== 'hoy' && (
                <button 
                  onClick={limpiarFiltros} 
                  className="btn-limpiar-filtros"
                >
                  🗑️ Limpiar
                </button>
              )}
            </div>
          </div>
          
          <div className="periodo-activo">
            <span className="badge-periodo">
              📅 {getPeriodoTexto()}
            </span>
          </div>
        </div>
      </div>

      {/* Alertas de Stock Bajo */}
      {alertasStock.length > 0 && (
        <div className="alertas-section">
          <h2>⚠️ Alertas de Stock Bajo</h2>
          <div className="alertas-grid">
            {alertasStock.map(producto => (
              <div key={producto.id} className="alerta-card">
                <h4>{producto.nombre}</h4>
                <p>Stock actual: <strong>{producto.stock_actual}</strong></p>
                <p>Stock mínimo: {producto.stock_minimo}</p>
                <div className="alerta-progress">
                  <div 
                    className="progress-bar"
                    style={{
                      width: `${Math.min(100, (producto.stock_actual / producto.stock_minimo) * 100)}%`,
                      backgroundColor: producto.stock_actual === 0 ? '#e74c3c' : 
                                     producto.stock_actual <= producto.stock_minimo ? '#f39c12' : '#27ae60'
                    }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-data">Actualizando datos...</div>
      ) : !estadisticas ? (
        <div className="error">Error al cargar las estadísticas</div>
      ) : (
        <>
          {/* Métricas Principales */}
          <div className="metricas-grid">
            <div className="metrica-card">
              <div className="metrica-icon">💰</div>
              <div className="metrica-info">
                <h3>Ventas {getPeriodoTexto()}</h3>
                <p className="metrica-valor">${estadisticas.ventasHoy?.monto?.toLocaleString() || '0'}</p>
                <p className="metrica-desc">{estadisticas.ventasHoy?.total || 0} ventas</p>
              </div>
            </div>

            <div className="metrica-card">
              <div className="metrica-icon">📦</div>
              <div className="metrica-info">
                <h3>Stock Bajo</h3>
                <p className="metrica-valor">{estadisticas.productosStockBajo?.total || 0}</p>
                <p className="metrica-desc">productos</p>
              </div>
            </div>

            <div className="metrica-card">
              <div className="metrica-icon">🔥</div>
              <div className="metrica-info">
                <h3>Productos Más Vendidos</h3>
                <p className="metrica-valor">{estadisticas.topProductos?.length || 0}</p>
                <p className="metrica-desc">en el período</p>
              </div>
            </div>

            <div className="metrica-card">
              <div className="metrica-icon">📊</div>
              <div className="metrica-info">
                <h3>Total Productos</h3>
                <p className="metrica-valor">{estadisticas.totalProductos || 0}</p>
                <p className="metrica-desc">en inventario</p>
              </div>
            </div>
          </div>

          {/* Top Productos */}
          {estadisticas.topProductos && estadisticas.topProductos.length > 0 && (
            <div className="top-productos-section">
              <h2>🔥 Productos Más Vendidos</h2>
              <div className="top-productos-list">
                {estadisticas.topProductos.map((producto, index) => (
                  <div key={index} className="top-producto-card">
                    <span className="ranking">#{index + 1}</span>
                    <div className="producto-info">
                      <h4>{producto.nombre}</h4>
                      <p>{producto.total_vendido} unidades vendidas</p>
                      <p className="producto-monto">${producto.monto_total?.toLocaleString() || '0'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ventas por Día */}
          {estadisticas.ventasUltimaSemana && estadisticas.ventasUltimaSemana.length > 0 && (
            <div className="ventas-semana-section">
              <h2>📈 Ventas por Día</h2>
              <div className="ventas-semana-grid">
                {estadisticas.ventasUltimaSemana.map((dia, index) => (
                  <div key={index} className="venta-dia-card">
                    <h4>{new Date(dia.fecha).toLocaleDateString('es-ES', { weekday: 'short' })}</h4>
                    <p className="fecha">{new Date(dia.fecha).toLocaleDateString('es-ES')}</p>
                    <p className="ventas-cantidad">{dia.cantidad} ventas</p>
                    <p className="ventas-total">${dia.total.toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Información de Período */}
          <div className="info-periodo">
            <p>
              <strong>Período seleccionado:</strong> {getPeriodoTexto()}
              {filtroPeriodo === 'personalizado' && (
                <span className="dias-periodo">
                  ({Math.ceil((new Date(fechaFin) - new Date(fechaInicio)) / (1000 * 60 * 60 * 24)) + 1} días)
                </span>
              )}
            </p>
            <p className="actualizacion-info">
              Última actualización: {new Date().toLocaleTimeString('es-ES')}
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export default Estadisticas;