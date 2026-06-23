const PDFDocument = require('pdfkit');

module.exports = async function generarReporteInventario(pool, negocioId, moduloId) {
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

      // Obtener productos del módulo
      const productosResult = await pool.query(
        `SELECT p.*, c.nombre as categoria_nombre
         FROM productos p
         LEFT JOIN categorias c ON p.categoria_id = c.id
         WHERE p.modulo_id = $1 AND p.activo = true
         ORDER BY p.stock_actual ASC`,
        [moduloId]
      );

      const productos = productosResult.rows;

      // Calcular valor total del inventario
      const valorInventario = productos.reduce((total, producto) => {
        return total + (producto.precio_compra * producto.stock_actual);
      }, 0);

      const productosStockBajo = productos.filter(p => p.stock_actual <= p.stock_minimo);

      // GENERAR PDF
      doc.fontSize(20).text(`REPORTE DE INVENTARIO`, { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Negocio: ${negocio.nombre}`, { align: 'center' });
      doc.text(`Módulo: ${modulo.nombre}`, { align: 'center' });
      doc.text(`Generado: ${new Date().toLocaleDateString()}`, { align: 'center' });
      doc.moveDown();

      // Resumen
      doc.fontSize(14).text('RESUMEN DE INVENTARIO', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(12);
      doc.text(`Total Productos: ${productos.length}`);
      doc.text(`Productos con stock bajo: ${productosStockBajo.length}`);
      doc.text(`Valor total del inventario: $${Number(valorInventario).toLocaleString()}`);
      doc.moveDown();

      // Productos con stock bajo
      if (productosStockBajo.length > 0) {
        doc.fontSize(14).text('PRODUCTOS CON STOCK BAJO ⚠️', { underline: true });
        doc.moveDown(0.5);
        
        productosStockBajo.forEach(producto => {
          doc.fontSize(10);
          doc.text(`${producto.nombre} - Stock: ${producto.stock_actual} (Mínimo: ${producto.stock_minimo})`);
        });
        doc.moveDown();
      }

      // Lista completa de productos
      doc.fontSize(14).text('INVENTARIO COMPLETO', { underline: true });
      doc.moveDown(0.5);
      
      if (productos.length > 0) {
        productos.forEach((producto, index) => {
          doc.fontSize(9);
          doc.text(`${producto.nombre}`);
          doc.text(`  Código: ${producto.codigo_ean || 'N/A'} | Categoría: ${producto.categoria_nombre || 'General'}`);
          doc.text(`  Stock: ${producto.stock_actual} | Precio: $${Number(producto.precio_venta).toLocaleString()}`);
          doc.text(`  Valor: $${Number(producto.precio_compra * producto.stock_actual).toLocaleString()}`);
          
          if (index < productos.length - 1) {
            doc.moveDown(0.2);
          }
        });
      } else {
        doc.text('No hay productos registrados.');
      }

      doc.end();

    } catch (error) {
      reject(error);
    }
  });
};
