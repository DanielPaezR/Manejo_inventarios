import React, { useState } from 'react';
import api from '../services/api';
import './Reportes.css';

const Reportes = ({ user }) => {
  const [reporteSeleccionado, setReporteSeleccionado] = useState('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [loading, setLoading] = useState(false);
  const [mensaje, setMensaje] = useState('');

  const tiposReporte = [
    { id: 'ventas_diarias', nombre: '📊 Reporte de Ventas Diarias', formato: 'pdf' },
    { id: 'ventas_mensual', nombre: '💰 Reporte Financiero Mensual', formato: 'pdf' },
    { id: 'inventario', nombre: '📦 Reporte de Inventario', formato: 'pdf' },
    { id: 'productos_excel', nombre: '📈 Productos a Excel', formato: 'excel' },
    { id: 'ventas_excel', nombre: '💳 Ventas a Excel', formato: 'excel' }
  ];

  const generarReporte = async () => {
    if (!reporteSeleccionado) {
      setMensaje('❌ Selecciona un tipo de reporte');
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('tipo', reporteSeleccionado);
      
      if (fechaInicio) params.append('fecha_inicio', fechaInicio);
      if (fechaFin) params.append('fecha_fin', fechaFin);
      
      const response = await api.get(`/reportes?${params.toString()}`, {
        responseType: 'blob'
      });

      // Crear el archivo para descargar
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const reporte = tiposReporte.find(r => r.id === reporteSeleccionado);
      const extension = reporte.formato;
      link.download = `reporte_${reporteSeleccionado}_${new Date().toISOString().split('T')[0]}.${extension}`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      setMensaje('✅ Reporte generado exitosamente');
    } catch (error) {
      console.error('Error generando reporte:', error);
      setMensaje('❌ Error al generar el reporte');
    } finally {
      setLoading(false);
      setTimeout(() => setMensaje(''), 5000);
    }
  };

  return (
    <div className="reportes-container">
      <div className="reportes-header">
        <h1>📋 Sistema de Reportes</h1>
        <p>Genera reportes detallados de tu negocio en PDF y Excel</p>
      </div>

      {mensaje && <div className="mensaje">{mensaje}</div>}

      <div className="reportes-panel">
        <div className="filtros-section">
          <h3>⚙️ Configurar Reporte</h3>
          
          <div className="filtro-group">
            <label>Tipo de Reporte:</label>
            <select 
              value={reporteSeleccionado} 
              onChange={(e) => setReporteSeleccionado(e.target.value)}
            >
              <option value="">Seleccionar reporte...</option>
              {tiposReporte.map(reporte => (
                <option key={reporte.id} value={reporte.id}>
                  {reporte.nombre} (.{reporte.formato.toUpperCase()})
                </option>
              ))}
            </select>
          </div>

          <div className="fechas-group">
            <div className="filtro-group">
              <label>Fecha Inicio:</label>
              <input
                type="date"
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
              />
            </div>

            <div className="filtro-group">
              <label>Fecha Fin:</label>
              <input
                type="date"
                value={fechaFin}
                onChange={(e) => setFechaFin(e.target.value)}
              />
            </div>
          </div>

          <button 
            onClick={generarReporte}
            disabled={loading || !reporteSeleccionado}
            className="btn-generar"
          >
            {loading ? '🔄 Generando...' : '📥 Generar Reporte'}
          </button>
        </div>

        <div className="info-section">
          <h3>📖 Descripción de Reportes</h3>
          
          <div className="reportes-info">
            <div className="info-card">
              <h4>📊 Reporte de Ventas Diarias</h4>
              <p>• Ventas totales del día</p>
              <p>• Productos más vendidos</p>
              <p>• Métodos de pago utilizados</p>
              <p>• IVA recaudado</p>
            </div>

            <div className="info-card">
              <h4>💰 Reporte Financiero Mensual</h4>
              <p>• Ingresos totales del mes</p>
              <p>• Costos vs ganancias</p>
              <p>• Margen de utilidad</p>
              <p>• Tendencia de ventas</p>
            </div>

            <div className="info-card">
              <h4>📦 Reporte de Inventario</h4>
              <p>• Productos con stock bajo</p>
              <p>• Valor total del inventario</p>
              <p>• Productos sin movimiento</p>
              <p>• Rotación de productos</p>
            </div>

            <div className="info-card">
              <h4>📈 Exportar a Excel</h4>
              <p>• Lista completa de productos</p>
              <p>• Historial de ventas</p>
              <p>• Datos para análisis externo</p>
              <p>• Compatible con Excel/Google Sheets</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Reportes;