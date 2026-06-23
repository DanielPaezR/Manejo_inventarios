const excel = require('excel4node');
const moment = require('moment');

module.exports = async function generarExcelVentas(pool, moduloId, fechaInicio, fechaFin) {
  return new Promise(async (resolve, reject) => {
    try {
      const workbook = new excel.Workbook();
      const worksheet = workbook.createWorksheet('Ventas');

      // Obtener ventas
      const ventasResult = await pool.query(
        `SELECT v.*, u.nombre as vendedor_nombre
         FROM ventas v
         JOIN usuarios u ON v.usuario_id = u.id
         WHERE v.modulo_id = $1 
         AND DATE(v.fecha_venta) BETWEEN COALESCE($2, CURRENT_DATE - INTERVAL '7 days') AND COALESCE($3, CURRENT_DATE)
         ORDER BY v.fecha_venta DESC`,
        [moduloId, fechaInicio, fechaFin]
      );

      const ventas = ventasResult.rows;

      // Estilos
      const headerStyle = workbook.createStyle({
        font: { bold: true, color: '#FFFFFF' },
        fill: { type: 'pattern', patternType: 'solid', fgColor: '#27ae60' },
        alignment: { horizontal: 'center' }
      });

      const moneyStyle = workbook.createStyle({
        numberFormat: '$#,##0.00'
      });

      const dateStyle = workbook.createStyle({
        numberFormat: 'dd/mm/yyyy hh:mm'
      });

      // Encabezados
      worksheet.cell(1, 1).string('Factura').style(headerStyle);
      worksheet.cell(1, 2).string('Fecha').style(headerStyle);
      worksheet.cell(1, 3).string('Cliente').style(headerStyle);
      worksheet.cell(1, 4).string('Vendedor').style(headerStyle);
      worksheet.cell(1, 5).string('Subtotal').style(headerStyle);
      worksheet.cell(1, 6).string('Total').style(headerStyle);
      worksheet.cell(1, 7).string('Método Pago').style(headerStyle);

      // Datos
      ventas.forEach((venta, index) => {
        const row = index + 2;
        
        worksheet.cell(row, 1).string(venta.numero_factura);
        worksheet.cell(row, 2).date(new Date(venta.fecha_venta)).style(dateStyle);
        worksheet.cell(row, 3).string(venta.cliente_nombre || 'Consumidor Final');
        worksheet.cell(row, 4).string(venta.vendedor_nombre);
        worksheet.cell(row, 5).number(Number(venta.subtotal)).style(moneyStyle);
        worksheet.cell(row, 6).number(Number(venta.total)).style(moneyStyle);
        worksheet.cell(row, 7).string(venta.metodo_pago);
      });

      // Ajustar anchos
      worksheet.column(1).setWidth(15);
      worksheet.column(2).setWidth(20);
      worksheet.column(3).setWidth(25);
      worksheet.column(4).setWidth(20);
      worksheet.column(5).setWidth(12);
      worksheet.column(6).setWidth(12);
      worksheet.column(7).setWidth(15);

      workbook.writeToBuffer().then(buffer => {
        resolve(buffer);
      });

    } catch (error) {
      reject(error);
    }
  });
};