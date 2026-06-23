const PDFDocument = require('pdfkit');
const moment = require('moment');

module.exports = async function generarReporteFinancieroMensual(pool, negocioId, moduloId, fechaInicio, fechaFin) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument();
      const buffers = [];
      
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // Obtener datos del negocio y módulo
      const negocioResult = await pool.query(
        'SELECT * FROM negocios WHERE id = $1',
        [negocioId]
      );
      const negocio = negocioResult.rows[0];

      const moduloResult = await pool.query(
        'SELECT * FROM modulos WHERE id = $1',
        [moduloId]
      );
      const modulo = moduloResult.rows[0];

      // Obtener fechas
      let startDate = fechaInicio || moment().startOf('month').format('YYYY-MM-DD');
      let endDate = fechaFin || moment().endOf('month').format('YYYY-MM-DD');

      // Obtener ventas
      const ventasResult = await pool.query(
        `SELECT 
            COUNT(*) as total_ventas,
            COALESCE(SUM(total), 0) as monto_total,
            COALESCE(SUM(subtotal), 0) as subtotal_total
         FROM ventas 
         WHERE modulo_id = $1 
         AND fecha_venta BETWEEN $2 AND $3`,
        [moduloId, startDate, endDate]
      );

      // Ventas por día
      const ventasPorDia = await pool.query(
        `SELECT 
            DATE(fecha_venta) as fecha,
            COUNT(*) as ventas_dia,
            SUM(total) as monto_dia
         FROM ventas
         WHERE modulo_id = $1 
         AND fecha_venta BETWEEN $2 AND $3
         GROUP BY DATE(fecha_venta)
         ORDER BY fecha_venta`,
        [moduloId, startDate, endDate]
      );

      // Métodos de pago
      const metodosPago = await pool.query(
        `SELECT 
            metodo_pago,
            COUNT(*) as cantidad_ventas,
            SUM(total) as monto_total,
            ROUND((COUNT(*) * 100.0 / (SELECT COUNT(*) FROM ventas WHERE modulo_id = $1 AND fecha_venta BETWEEN $2 AND $3)), 2) as porcentaje
         FROM ventas
         WHERE modulo_id = $1 
         AND fecha_venta BETWEEN $2 AND $3
         GROUP BY metodo_pago
         ORDER BY monto_total DESC`,
        [moduloId, startDate, endDate]
      );

      // Productos más vendidos
      const productosTop = await pool.query(
        `SELECT 
            p.nombre,
            SUM(dv.cantidad) as cantidad_vendida,
            SUM(dv.subtotal) as monto_total
         FROM detalle_venta dv
         JOIN productos p ON dv.producto_id = p.id
         JOIN ventas v ON dv.venta_id = v.id
         WHERE v.modulo_id = $1 
         AND v.fecha_venta BETWEEN $2 AND $3
         GROUP BY p.id, p.nombre
         ORDER BY cantidad_vendida DESC
         LIMIT 10`,
        [moduloId, startDate, endDate]
      );

      const ventas = ventasResult.rows[0];
      const ticketPromedio = ventas.total_ventas > 0 ? 
        ventas.monto_total / ventas.total_ventas : 0;

      // Generar PDF
      doc.fontSize(20).text(`REPORTE FINANCIERO MENSUAL`, { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Negocio: ${negocio.nombre}`, { align: 'center' });
      doc.text(`Módulo: ${modulo.nombre}`, { align: 'center' });
      doc.text(`Período: ${moment(startDate).format('DD/MM/YYYY')} - ${moment(endDate).format('DD/MM/YYYY')}`, { align: 'center' });
      doc.text(`Generado: ${new Date().toLocaleDateString()}`, { align: 'center' });
      doc.moveDown();

      // Resumen ejecutivo
      doc.fontSize(16).text('📊 RESUMEN EJECUTIVO', { underline: true });
      doc.moveDown(0.5);
      
      doc.fontSize(12);
      doc.text(`Período analizado: ${moment(startDate).format('DD/MM/YYYY')} - ${moment(endDate).format('DD/MM/YYYY')}`);
      doc.text(`Total de días con ventas: ${ventasPorDia.rows.length}`);
      doc.moveDown();

      // Métricas financieras
      doc.fontSize(14).text('💰 MÉTRICAS FINANCIERAS', { underline: true });
      doc.moveDown(0.5);
      
      doc.text(`Ventas Totales: $${Number(ventas.monto_total).toLocaleString()}`);
      doc.text(`• Subtotal: $${Number(ventas.subtotal_total).toLocaleString()}`);
      doc.text(`Total Ventas: ${ventas.total_ventas} transacciones`);
      doc.text(`Ticket Promedio: $${Number(ticketPromedio).toLocaleString()}`);
      doc.moveDown();

      // Métodos de pago
      if (metodosPago.rows.length > 0) {
        doc.fontSize(14).text('💳 DISTRIBUCIÓN DE MÉTODOS DE PAGO', { underline: true });
        doc.moveDown(0.5);
        
        metodosPago.rows.forEach(metodo => {
          doc.text(`${metodo.metodo_pago}: ${metodo.cantidad_ventas} ventas (${metodo.porcentaje}%) - $${Number(metodo.monto_total).toLocaleString()}`);
        });
        doc.moveDown();
      }

      // Productos más vendidos
      if (productosTop.rows.length > 0) {
        doc.fontSize(14).text('🔥 TOP 10 PRODUCTOS MÁS VENDIDOS', { underline: true });
        doc.moveDown(0.5);
        
        productosTop.rows.forEach((producto, index) => {
          doc.fontSize(10);
          doc.text(`${index + 1}. ${producto.nombre}`);
          doc.text(`   Vendidos: ${producto.cantidad_vendida} unidades - $${Number(producto.monto_total).toLocaleString()}`);
        });
        doc.moveDown();
      }

      doc.end();

    } catch (error) {
      reject(error);
    }
  });
};