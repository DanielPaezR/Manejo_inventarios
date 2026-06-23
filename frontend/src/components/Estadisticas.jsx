import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import './Estadisticas.css';

const Estadisticas = ({ user }) => {
  const { moduloActivo } = useModulo();
  const [estadisticas, setEstadisticas] = useState(null);
  const [loading, setLoading] = useState(false);
  const [periodo, setPeriodo] = useState('hoy');
  const [fechas, setFechas] = useState({ inicio: '', fin: '' });

  useEffect(() => {
    if (moduloActivo) {
      cargarEstadisticas();
    }
  }, [moduloActivo, periodo]);

  const cargarEstadisticas = async () => {
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
      alert('Error al cargar estadísticas');
    } finally {
      setLoading(false);
    }
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
      <div className="estadisticas-header">
        <h2>📊 Estadísticas</h2>
        <div className="modulo-indicador">
          <span className="badge">Módulo: {moduloActivo.nombre}</span>
        </div>
      </div>

      <div className="filtros-periodo">
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
          <option value="hoy">Hoy</option>
          <option value="semana">Última semana</option>
          <option value="mes">Último mes</option>
          <option value="personalizado">Personalizado</option>
        </select>
        
        {periodo === 'personalizado' && (
          <div className="fechas-personalizadas">
            <input
              type="date"
              value={fechas.inicio}
              onChange={(e) => setFechas({ ...fechas, inicio: e.target.value })}
            />
            <span>a</span>
            <input
              type="date"
              value={fechas.fin}
              onChange={(e) => setFechas({ ...fechas, fin: e.target.value })}
            />
            <button onClick={cargarEstadisticas} className="btn-aplicar">
              Aplicar
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="loading">Cargando estadísticas...</div>
      ) : estadisticas ? (
        <div className="estadisticas-grid">
          {/* Resumen */}
          <div className="card resumen">
            <h3>📈 Resumen</h3>
            <div className="metricas">
              <div className="metrica">
                <span className="metrica-valor">{estadisticas.ventasPeriodo.total || 0}</span>
                <span className="metrica-label">Ventas</span>
              </div>
              <div className="metrica">
                <span className="metrica-valor">${(estadisticas.ventasPeriodo.monto || 0).toLocaleString()}</span>
                <span className="metrica-label">Monto total</span>
              </div>
              <div className="metrica">
                <span className="metrica-valor">{estadisticas.totalProductos || 0}</span>
                <span className="metrica-label">Productos</span>
              </div>
              <div className="metrica">
                <span className="metrica-valor">{estadisticas.productosStockBajo?.total || 0}</span>
                <span className="metrica-label">Stock bajo</span>
              </div>
            </div>
          </div>

          {/* Top productos */}
          <div className="card top-productos">
            <h3>🔥 Productos más vendidos</h3>
            {estadisticas.topProductos?.length > 0 ? (
              <ul>
                {estadisticas.topProductos.map((producto, index) => (
                  <li key={index}>
                    <span className="posicion">{index + 1}</span>
                    <span className="producto-nombre">{producto.nombre}</span>
                    <span className="producto-cantidad">{producto.total_vendido} uds</span>
                    <span className="producto-monto">${producto.monto_total.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sin-datos">No hay datos de ventas en este período</p>
            )}
          </div>

          {/* Ventas por día */}
          <div className="card ventas-dia">
            <h3>📅 Ventas por día</h3>
            {estadisticas.ventasPorDia?.length > 0 ? (
              <div className="grafico-barras">
                {estadisticas.ventasPorDia.map((dia, index) => (
                  <div key={index} className="barra-container">
                    <div 
                      className="barra" 
                      style={{ 
                        height: `${Math.max(5, (dia.total / Math.max(...estadisticas.ventasPorDia.map(d => d.total))) * 100)}%` 
                      }}
                    >
                      <span className="barra-valor">${dia.total.toLocaleString()}</span>
                    </div>
                    <span className="barra-fecha">{new Date(dia.fecha).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="sin-datos">No hay ventas en este período</p>
            )}
          </div>

          {/* Método de pago */}
          <div className="card metodo-pago">
            <h3>💳 Método de pago popular</h3>
            {estadisticas.metodoPagoPopular ? (
              <div className="metodo-info">
                <span className="metodo-nombre">{estadisticas.metodoPagoPopular.metodo_pago}</span>
                <span className="metodo-cantidad">{estadisticas.metodoPagoPopular.cantidad} ventas</span>
                <span className="metodo-monto">${estadisticas.metodoPagoPopular.monto_total.toLocaleString()}</span>
              </div>
            ) : (
              <p className="sin-datos">Sin datos de métodos de pago</p>
            )}
          </div>

          {/* Período */}
          <div className="card periodo-info">
            <h3>📆 Período analizado</h3>
            <p><strong>Tipo:</strong> {estadisticas.periodoInfo?.tipo || 'N/A'}</p>
            <p><strong>Desde:</strong> {estadisticas.periodoInfo?.fecha_inicio || 'N/A'}</p>
            <p><strong>Hasta:</strong> {estadisticas.periodoInfo?.fecha_fin || 'N/A'}</p>
            <p><strong>Días:</strong> {estadisticas.periodoInfo?.dias || 0}</p>
          </div>
        </div>
      ) : (
        <div className="sin-datos">No hay estadísticas disponibles</div>
      )}
    </div>
  );
};

export default Estadisticas;