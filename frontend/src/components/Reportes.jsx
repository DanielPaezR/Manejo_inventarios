import React, { useState, useEffect } from 'react';
import api from '../services/api';
import './Reportes.css';

const Reportes = ({ user }) => {
  const [reporteSeleccionado, setReporteSeleccionado] = useState('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [loading, setLoading] = useState(false);
  const [mensaje, setMensaje] = useState('');
  
  // Estados para búsqueda de facturas
  const [busquedaFactura, setBusquedaFactura] = useState('');
  const [facturaEncontrada, setFacturaEncontrada] = useState(null);
  const [buscandoFactura, setBuscandoFactura] = useState(false);
  const [mostrarBusqueda, setMostrarBusqueda] = useState(false);

  const tiposReporte = [
    { id: 'ventas_diarias', nombre: '📊 Reporte de Ventas Diarias', formato: 'pdf' },
    { id: 'ventas_mensual', nombre: '💰 Reporte Financiero Mensual', formato: 'pdf' },
    { id: 'inventario', nombre: '📦 Reporte de Inventario', formato: 'pdf' },
    { id: 'productos_excel', nombre: '📈 Productos a Excel', formato: 'excel' },
    { id: 'ventas_excel', nombre: '💳 Ventas a Excel', formato: 'excel' }
  ];

  // Cargar fecha actual por defecto
  useEffect(() => {
    const hoy = new Date().toISOString().split('T')[0];
    if (!fechaInicio) setFechaInicio(hoy);
    if (!fechaFin) setFechaFin(hoy);
  }, []);

  const generarReporte = async () => {
    if (!reporteSeleccionado) {
      setMensaje('❌ Selecciona un tipo de reporte');
      return;
    }

    setLoading(true);
    setMensaje('🔄 Generando reporte...');
    
    try {
      const params = new URLSearchParams();
      params.append('tipo', reporteSeleccionado);
      
      if (fechaInicio) params.append('fecha_inicio', fechaInicio);
      if (fechaFin) params.append('fecha_fin', fechaFin);
      
      console.log('📋 Generando reporte:', reporteSeleccionado);
      
      const response = await api.get(`/reportes?${params.toString()}`, {
        responseType: 'blob'
      });

      // Verificar que sea un blob válido
      if (!(response.data instanceof Blob)) {
        throw new Error('Respuesta no es un archivo válido');
      }

      // Crear el archivo para descargar
      const blob = response.data;
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      const reporte = tiposReporte.find(r => r.id === reporteSeleccionado);
      const extension = reporte.formato;
      const fecha = new Date().toISOString().split('T')[0];
      const nombreArchivo = `reporte_${reporteSeleccionado}_${fecha}.${extension}`;
      
      link.download = nombreArchivo;
      link.style.display = 'none';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      setMensaje('✅ Reporte generado exitosamente');
      
    } catch (error) {
      console.error('❌ Error generando reporte:', error);
      
      if (error.response?.status === 404) {
        setMensaje('❌ La ruta de reportes no está disponible en el servidor');
      } else if (error.message.includes('blob')) {
        setMensaje('❌ Error al procesar el archivo del reporte');
      } else {
        setMensaje('❌ Error al generar el reporte');
      }
    } finally {
      setLoading(false);
      setTimeout(() => setMensaje(''), 5000);
    }
  };

  const buscarFactura = async () => {
    if (!busquedaFactura.trim()) {
      setMensaje('❌ Ingresa un número de factura');
      return;
    }

    setBuscandoFactura(true);
    setMensaje('🔍 Buscando factura...');
    
    try {
      // Primero buscamos en la lista de ventas
      const response = await api.get(`/ventas?limit=100`);
      const ventas = response.data;
      
      // Buscar por número de factura exacto o parcial
      const factura = ventas.find(v => 
        v.numero_factura.toLowerCase().includes(busquedaFactura.toLowerCase()) ||
        v.id.toString() === busquedaFactura
      );

      if (factura) {
        // Obtener detalles completos de la factura
        const detalleResponse = await api.get(`/ventas/${factura.id}/factura`);
        setFacturaEncontrada(detalleResponse.data);
        setMensaje('✅ Factura encontrada');
        setMostrarBusqueda(true);
      } else {
        setFacturaEncontrada(null);
        setMensaje('❌ No se encontró la factura');
        setMostrarBusqueda(true);
      }
    } catch (error) {
      console.error('❌ Error buscando factura:', error);
      setFacturaEncontrada(null);
      setMensaje('❌ Error al buscar la factura');
    } finally {
      setBuscandoFactura(false);
      setTimeout(() => setMensaje(''), 5000);
    }
  };

  const imprimirFactura = () => {
    if (!facturaEncontrada) return;
    
    const ventanaImpresion = window.open('', '_blank');
    
    const contenido = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Factura ${facturaEncontrada.numero_factura}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .factura { max-width: 800px; margin: 0 auto; border: 1px solid #ccc; padding: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .empresa h2 { margin: 0; color: #333; }
          .info { display: flex; justify-content: space-between; margin: 20px 0; }
          .detalle table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          .detalle th, .detalle td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          .detalle th { background-color: #f5f5f5; }
          .totales { text-align: right; margin-top: 30px; }
          .total-line { margin: 5px 0; }
          .total-final { font-size: 18px; font-weight: bold; }
          @media print {
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="factura">
          <div class="header">
            <div class="empresa">
              <h2>${facturaEncontrada.negocio_nombre || 'Negocio'}</h2>
              <p>NIT: ${facturaEncontrada.negocio_ruc_nit || ''}</p>
              <p>Dirección: ${facturaEncontrada.negocio_direccion || ''}</p>
              <p>Teléfono: ${facturaEncontrada.negocio_telefono || ''}</p>
            </div>
          </div>
          
          <div class="info">
            <div>
              <strong>Factura No:</strong> ${facturaEncontrada.numero_factura}
            </div>
            <div>
              <strong>Fecha:</strong> ${new Date(facturaEncontrada.fecha_venta).toLocaleDateString()}
            </div>
          </div>
          
          <div class="cliente">
            <h4>Datos del Cliente</h4>
            <p><strong>Nombre:</strong> ${facturaEncontrada.cliente_nombre || 'Consumidor Final'}</p>
            ${facturaEncontrada.cliente_documento ? `<p><strong>Documento:</strong> ${facturaEncontrada.cliente_documento}</p>` : ''}
            ${facturaEncontrada.cliente_telefono ? `<p><strong>Teléfono:</strong> ${facturaEncontrada.cliente_telefono}</p>` : ''}
          </div>
          
          <div class="detalle">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Precio Unitario</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${Array.isArray(facturaEncontrada.detalles) ? facturaEncontrada.detalles.map(detalle => `
                  <tr>
                    <td>${detalle.producto_nombre}</td>
                    <td>${detalle.cantidad}</td>
                    <td>$${detalle.precio_unitario?.toLocaleString() || '0'}</td>
                    <td>$${detalle.subtotal?.toLocaleString() || '0'}</td>
                  </tr>
                `).join('') : ''}
              </tbody>
            </table>
          </div>
          
          <div class="totales">
            <div class="total-line">
              <span>Subtotal: </span>
              <span>$${facturaEncontrada.subtotal?.toLocaleString() || '0'}</span>
            </div>
            <div class="total-line">
              <span>IVA (19%): </span>
              <span>$${facturaEncontrada.iva?.toLocaleString() || '0'}</span>
            </div>
            <div class="total-line total-final">
              <span>TOTAL: </span>
              <span>$${facturaEncontrada.total?.toLocaleString() || '0'}</span>
            </div>
            <div class="metodo-pago">
              <p><strong>Método de pago:</strong> ${facturaEncontrada.metodo_pago || 'Efectivo'}</p>
              <p><strong>Vendedor:</strong> ${facturaEncontrada.vendedor_nombre || 'Sistema'}</p>
            </div>
          </div>
          
          <div style="margin-top: 30px; text-align: center;">
            <button onclick="window.print()" style="padding: 10px 20px; background: #007bff; color: white; border: none; cursor: pointer; margin-right: 10px;">
              🖨️ Imprimir Factura
            </button>
            <button onclick="window.close()" style="padding: 10px 20px; background: #6c757d; color: white; border: none; cursor: pointer;">
              Cerrar
            </button>
          </div>
        </div>
      </body>
      </html>
    `;
    
    ventanaImpresion.document.write(contenido);
    ventanaImpresion.document.close();
  };

  const limpiarBusqueda = () => {
    setBusquedaFactura('');
    setFacturaEncontrada(null);
    setMostrarBusqueda(false);
  };

  return (
    <div className="reportes-container">
      <div className="reportes-header">
        <h1>📋 Sistema de Reportes</h1>
        <p>Genera reportes detallados y busca facturas de tu negocio</p>
      </div>

      {mensaje && <div className={`mensaje ${mensaje.includes('✅') ? 'success' : mensaje.includes('❌') ? 'error' : 'info'}`}>
        {mensaje}
      </div>}

      {/* Sección de Búsqueda de Facturas */}
      <div className="busqueda-facturas-section">
        <h3>🔍 Búsqueda de Facturas</h3>
        <div className="busqueda-form">
          <input
            type="text"
            placeholder="Ingrese número de factura o ID..."
            value={busquedaFactura}
            onChange={(e) => setBusquedaFactura(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && buscarFactura()}
          />
          <button 
            onClick={buscarFactura}
            disabled={buscandoFactura || !busquedaFactura.trim()}
            className="btn-buscar"
          >
            {buscandoFactura ? '🔍 Buscando...' : '🔍 Buscar Factura'}
          </button>
          <button 
            onClick={limpiarBusqueda}
            className="btn-limpiar"
          >
            🗑️ Limpiar
          </button>
        </div>

        {mostrarBusqueda && (
          <div className="resultado-busqueda">
            {facturaEncontrada ? (
              <div className="factura-encontrada">
                <h4>✅ Factura Encontrada</h4>
                <div className="factura-info">
                  <p><strong>Número:</strong> {facturaEncontrada.numero_factura}</p>
                  <p><strong>Fecha:</strong> {new Date(facturaEncontrada.fecha_venta).toLocaleDateString()}</p>
                  <p><strong>Cliente:</strong> {facturaEncontrada.cliente_nombre || 'Consumidor Final'}</p>
                  <p><strong>Total:</strong> ${facturaEncontrada.total?.toLocaleString() || '0'}</p>
                  <p><strong>Método pago:</strong> {facturaEncontrada.metodo_pago}</p>
                </div>
                <div className="factura-acciones">
                  <button onClick={imprimirFactura} className="btn-imprimir">
                    🖨️ Ver/Imprimir Factura
                  </button>
                </div>
              </div>
            ) : (
              <div className="sin-resultados">
                <p>❌ No se encontró ninguna factura con ese número</p>
                <small>Intenta con el número completo de factura o el ID de venta</small>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="reportes-panel">
        <div className="filtros-section">
          <h3>⚙️ Configurar Reporte</h3>
          
          <div className="filtro-group">
            <label>Tipo de Reporte:</label>
            <select 
              value={reporteSeleccionado} 
              onChange={(e) => setReporteSeleccionado(e.target.value)}
              disabled={loading}
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
                disabled={loading}
              />
            </div>

            <div className="filtro-group">
              <label>Fecha Fin:</label>
              <input
                type="date"
                value={fechaFin}
                onChange={(e) => setFechaFin(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <div className="nota-fechas">
            <small>💡 Si dejas las fechas vacías, se generará con datos de hoy</small>
          </div>

          <button 
            onClick={generarReporte}
            disabled={loading || !reporteSeleccionado}
            className="btn-generar"
          >
            {loading ? '🔄 Generando...' : '📥 Generar Reporte'}
          </button>

          <div className="consejo-reportes">
            <p><strong>💡 Consejos para reportes:</strong></p>
            <ul>
              <li><strong>PDF:</strong> Para imprimir o archivar</li>
              <li><strong>Excel:</strong> Para análisis de datos</li>
              <li>Las ventas incluyen IVA (19%) calculado automáticamente</li>
              <li>El inventario muestra productos con stock bajo</li>
            </ul>
          </div>
        </div>

        <div className="info-section">
          <h3>📖 Descripción de Reportes</h3>
          
          <div className="reportes-info">
            <div className="info-card">
              <h4>📊 Reporte de Ventas Diarias</h4>
              <p>• Ventas totales del período</p>
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