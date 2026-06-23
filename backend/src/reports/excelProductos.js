const excel = require('excel4node');

module.exports = async function generarExcelProductos(pool, moduloId) {
  return new Promise(async (resolve, reject) => {
    try {
      const workbook = new excel.Workbook();
      const worksheet = workbook.createWorksheet('Productos');

      // Obtener productos
      const productosResult = await pool.query(
        `SELECT p.*, c.nombre as categoria_nombre
         FROM productos p
         LEFT JOIN categorias c ON p.categoria_id = c.id
         WHERE p.modulo_id = $1 AND p.activo = true
         ORDER BY p.nombre`,
        [moduloId]
      );

      const productos = productosResult.rows;

      // Estilos
      const headerStyle = workbook.createStyle({
        font: { bold: true, color: '#FFFFFF' },
        fill: { type: 'pattern', patternType: 'solid', fgColor: '#3498db' },
        alignment: { horizontal: 'center' }
      });

      const moneyStyle = workbook.createStyle({
        numberFormat: '$#,##0.00'
      });

      // Encabezados
      worksheet.cell(1, 1).string('Nombre').style(headerStyle);
      worksheet.cell(1, 2).string('Código EAN').style(headerStyle);
      worksheet.cell(1, 3).string('Categoría').style(headerStyle);
      worksheet.cell(1, 4).string('Stock Actual').style(headerStyle);
      worksheet.cell(1, 5).string('Stock Mínimo').style(headerStyle);
      worksheet.cell(1, 6).string('Precio Compra').style(headerStyle);
      worksheet.cell(1, 7).string('Precio Venta').style(headerStyle);
      worksheet.cell(1, 8).string('Valor Inventario').style(headerStyle);

      // Datos
      productos.forEach((producto, index) => {
        const row = index + 2;
        const valorInventario = producto.precio_compra * producto.stock_actual;
        
        worksheet.cell(row, 1).string(producto.nombre);
        worksheet.cell(row, 2).string(producto.codigo_ean || 'N/A');
        worksheet.cell(row, 3).string(producto.categoria_nombre || 'General');
        worksheet.cell(row, 4).number(producto.stock_actual);
        worksheet.cell(row, 5).number(producto.stock_minimo);
        worksheet.cell(row, 6).number(Number(producto.precio_compra)).style(moneyStyle);
        worksheet.cell(row, 7).number(Number(producto.precio_venta)).style(moneyStyle);
        worksheet.cell(row, 8).number(Number(valorInventario)).style(moneyStyle);
      });

      // Ajustar anchos
      worksheet.column(1).setWidth(30);
      worksheet.column(2).setWidth(15);
      worksheet.column(3).setWidth(15);
      worksheet.column(4).setWidth(12);
      worksheet.column(5).setWidth(12);
      worksheet.column(6).setWidth(15);
      worksheet.column(7).setWidth(15);
      worksheet.column(8).setWidth(18);

      workbook.writeToBuffer().then(buffer => {
        resolve(buffer);
      });

    } catch (error) {
      reject(error);
    }
  });
};