import React, { useState, useEffect } from 'react';
import api from '../services/api';
import './Estadisticas.css';

const Estadisticas = ({ user }) => {
  const [estadisticas, setEstadisticas] = useState(null);
  const [alertasStock, setAlertasStock] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cargarEstadisticas();
    cargarAlertasStock();
  }, []);

  const cargarEstadisticas = async () => {
    try {
      const response = await api.get('/estadisticas');
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

  if (loading) {
    return <div className="loading">Cargando estadísticas...</div>;
  }

  if (!estadisticas) {
    return <div className="error">Error al cargar las estadísticas</div>;
  }

  return (
    <div className="estadisticas-container">
      <h1>Dashboard - Estadísticas</h1>

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

      {/* Métricas Principales */}
      <div className="metricas-grid">
        <div className="metrica-card">
          <div className="metrica-icon">💰</div>
          <div className="metrica-info">
            <h3>Ventas Hoy</h3>
            <p className="metrica-valor">${estadisticas.ventasHoy.monto.toLocaleString()}</p>
            <p className="metrica-desc">{estadisticas.ventasHoy.total} ventas</p>
          </div>
        </div>

        <div className="metrica-card">
          <div className="metrica-icon">📦</div>
          <div className="metrica-info">
            <h3>Stock Bajo</h3>
            <p className="metrica-valor">{estadisticas.productosStockBajo.total}</p>
            <p className="metrica-desc">productos</p>
          </div>
        </div>

        <div className="metrica-card">
          <div className="metrica-icon">🔥</div>
          <div className="metrica-info">
            <h3>Productos Más Vendidos</h3>
            <p className="metrica-valor">{estadisticas.topProductos.length}</p>
            <p className="metrica-desc">últimos 7 días</p>
          </div>
        </div>
      </div>

      {/* Top Productos */}
      <div className="top-productos-section">
        <h2>🔥 Productos Más Vendidos (7 días)</h2>
        <div className="top-productos-list">
          {estadisticas.topProductos.map((producto, index) => (
            <div key={index} className="top-producto-card">
              <span className="ranking">#{index + 1}</span>
              <div className="producto-info">
                <h4>{producto.nombre}</h4>
                <p>{producto.total_vendido} unidades vendidas</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ventas Última Semana */}
      <div className="ventas-semana-section">
        <h2>📈 Ventas Última Semana</h2>
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
    </div>
  );
};

export default Estadisticas;