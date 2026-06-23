const PDFDocument = require('pdfkit');

// Mejor: exportamos una función que recibe la conexión
module.exports = async function generarReporteVentasDiarias(pool, negocioId, moduloId, fechaInicio, fechaFin) {
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

      // Obtener ventas del período
      const ventasResult = await pool.query(
        `SELECT v.*, u.nombre as vendedor_nombre
         FROM ventas v
         JOIN usuarios u ON v.usuario_id = u.id
         WHERE v.modulo_id = $1 
         AND DATE(v.fecha_venta) BETWEEN COALESCE($2, CURRENT_DATE) AND COALESCE($3, CURRENT_DATE)
         ORDER BY v.fecha_venta DESC`,
        [moduloId, fechaInicio, fechaFin]
      );

      const ventas = ventasResult.rows;

      // Obtener totales
      const totalesResult = await pool.query(
        `SELECT 
           COUNT(*) as total_ventas,
           COALESCE(SUM(total), 0) as monto_total
         FROM ventas 
         WHERE modulo_id = $1 
         AND DATE(fecha_venta) BETWEEN COALESCE($2, CURRENT_DATE) AND COALESCE($3, CURRENT_DATE)`,
        [moduloId, fechaInicio, fechaFin]
      );

      const totales = totalesResult.rows[0];

      // GENERAR PDF
      doc.fontSize(20).text(`REPORTE DE VENTAS DIARIAS`, { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Negocio: ${negocio.nombre}`, { align: 'center' });
      doc.text(`Módulo: ${modulo.nombre}`, { align: 'center' });
      doc.text(`Período: ${fechaInicio || 'Hoy'} - ${fechaFin || 'Hoy'}`, { align: 'center' });
      doc.text(`Generado: ${new Date().toLocaleDateString()}`, { align: 'center' });
      doc.moveDown();

      // Resumen
      doc.fontSize(14).text('RESUMEN DEL DÍA', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(12);
      doc.text(`Total Ventas: ${totales.total_ventas}`);
      doc.text(`Monto Total: $${Number(totales.monto_total).toLocaleString()}`);
      doc.moveDown();

      // Detalle de ventas
      if (ventas.length > 0) {
        doc.fontSize(14).text('DETALLE DE VENTAS', { underline: true });
        doc.moveDown(0.5);
        
        ventas.forEach((venta, index) => {
          doc.fontSize(10);
          doc.text(`Factura: ${venta.numero_factura}`);
          doc.text(`Fecha: ${new Date(venta.fecha_venta).toLocaleString()}`);
          doc.text(`Cliente: ${venta.cliente_nombre || 'Consumidor Final'}`);
          doc.text(`Vendedor: ${venta.vendedor_nombre}`);
          doc.text(`Total: $${Number(venta.total).toLocaleString()}`);
          doc.text(`Método: ${venta.metodo_pago}`);
          doc.moveDown(0.3);
          
          if (index < ventas.length - 1) {
            doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
            doc.moveDown(0.3);
          }
        });
      } else {
        doc.text('No hay ventas registradas en este período.');
      }

      doc.end();

    } catch (error) {
      reject(error);
    }
  });
};