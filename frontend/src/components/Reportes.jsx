import React, { useState } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import './Reportes.css';

const Reportes = ({ user }) => {
  const { moduloActivo } = useModulo();
  const [tipoReporte, setTipoReporte] = useState('ventas_diarias');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [loading, setLoading] = useState(false);
  const [mensaje, setMensaje] = useState('');

  // Verificar permisos (solo admin puede ver reportes)
  const puedeVerReportes = user?.rol === 'admin' || user?.rol === 'super_admin';

  if (!puedeVerReportes) {
    return (
      <div className="reportes-container">
        <div className="alert alert-warning">
          ⚠️ No tienes permisos para ver reportes. Solo administradores pueden acceder a esta sección.
        </div>
      </div>
    );
  }

  if (!moduloActivo) {
    return (
      <div className="reportes-container">
        <div className="alert alert-warning">
          ⚠️ No hay módulo activo. Selecciona un módulo para generar reportes.
        </div>
      </div>
    );
  }

  const handleGenerarReporte = async () => {
    // Validar fechas para reportes que las requieren
    if (tipoReporte !== 'inventario' && tipoReporte !== 'productos_excel') {
      if (!fechaInicio || !fechaFin) {
        alert('Selecciona ambas fechas para generar el reporte');
        return;
      }
      
      if (new Date(fechaInicio) > new Date(fechaFin)) {
        alert('La fecha de inicio debe ser anterior a la fecha de fin');
        return;
      }
    }

    try {
      setLoading(true);
      setMensaje('Generando reporte...');
      
      const params = {
        tipo: tipoReporte,
        fecha_inicio: fechaInicio,
        fecha_fin: fechaFin
      };

      const response = await api.get('/reportes', {
        params,
        responseType: 'blob' // Para manejar archivos
      });

      // Crear link de descarga
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      
      // Determinar extensión del archivo
      let extension = 'pdf';
      if (tipoReporte.includes('excel')) {
        extension = 'xlsx';
      }
      
      link.href = url;
      link.setAttribute('download', `reporte_${tipoReporte}.${extension}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      setMensaje('✅ Reporte generado y descargado correctamente');
      setTimeout(() => setMensaje(''), 3000);
    } catch (error) {
      console.error('Error generando reporte:', error);
      setMensaje('❌ Error al generar el reporte');
      setTimeout(() => setMensaje(''), 3000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="reportes-container">
      <div className="reportes-header">
        <h2>📄 Reportes</h2>
        <div className="modulo-indicador">
          <span className="badge">Módulo: {moduloActivo.nombre}</span>
        </div>
      </div>

      <div className="reportes-config">
        <div className="config-section">
          <h3>Configuración del Reporte</h3>
          
          <div className="form-group">
            <label>Tipo de Reporte</label>
            <select 
              value={tipoReporte} 
              onChange={(e) => setTipoReporte(e.target.value)}
            >
              <option value="ventas_diarias">📊 Ventas Diarias (PDF)</option>
              <option value="ventas_mensual">📈 Reporte Financiero Mensual (PDF)</option>
              <option value="inventario">📦 Reporte de Inventario (PDF)</option>
              <option value="productos_excel">📊 Productos (Excel)</option>
              <option value="ventas_excel">📊 Ventas (Excel)</option>
            </select>
          </div>

          {tipoReporte !== 'inventario' && tipoReporte !== 'productos_excel' && (
            <div className="fechas-group">
              <div className="form-group">
                <label>Fecha de Inicio</label>
                <input
                  type="date"
                  value={fechaInicio}
                  onChange={(e) => setFechaInicio(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Fecha de Fin</label>
                <input
                  type="date"
                  value={fechaFin}
                  onChange={(e) => setFechaFin(e.target.value)}
                />
              </div>
            </div>
          )}

          <button 
            onClick={handleGenerarReporte} 
            className="btn-generar"
            disabled={loading}
          >
            {loading ? 'Generando...' : '🚀 Generar Reporte'}
          </button>

          {mensaje && (
            <div className={`mensaje ${mensaje.includes('Error') ? 'error' : 'exito'}`}>
              {mensaje}
            </div>
          )}
        </div>

        <div className="info-section">
          <h3>ℹ️ Información</h3>
          <ul>
            <li><strong>Ventas Diarias:</strong> Reporte detallado de ventas por día</li>
            <li><strong>Reporte Financiero:</strong> Análisis mensual con métricas financieras</li>
            <li><strong>Inventario:</strong> Listado completo de productos con stock</li>
            <li><strong>Productos Excel:</strong> Exporta todos los productos a Excel</li>
            <li><strong>Ventas Excel:</strong> Exporta todas las ventas a Excel</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Reportes;