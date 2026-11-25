// Rutas: Alertas y reportes descargables.
// Movidas desde server.js (secciones: RUTAS DE ALERTAS MEJORADAS · RUTAS DE REPORTES).
// Reciben ctx con lo que server.js prepara (app, pool, middlewares, helpers)
// y lo que exportan los grupos registrados antes; devuelven lo que otros usan.
module.exports = function registrarRutas(ctx) {
  const {
    authenticateToken, requireAdmin, checkAccess, generarReporteVentasDiarias,
    generarReporteInventario, generarReporteFinancieroMensual, generarExcelProductos,
    generarExcelVentas, app, pool, requirePermiso
  } = ctx;

  // ==================== RUTAS DE ALERTAS MEJORADAS ====================

  // Obtener productos con stock bajo Y sus proveedores
  app.get('/api/alertas/stock-bajo-completo', authenticateToken, checkAccess, requirePermiso('reportes'), async (req, res) => {
    try {
      const moduloId = req.moduloId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      const result = await pool.query(
        `SELECT p.*, 
              c.nombre as categoria_nombre,
              (p.stock_actual <= p.stock_minimo) as necesita_reponer,
              CASE 
                WHEN p.stock_actual = 0 THEN 'Agotado'
                WHEN p.stock_actual <= p.stock_minimo THEN 'Bajo'
                ELSE 'Normal'
              END as estado_stock,
              json_agg(
                json_build_object(
                  'id', prov.id,
                  'nombre', prov.nombre,
                  'telefono', prov.telefono,
                  'contacto', prov.contacto,
                  'precio_compra', pp.precio_compra,
                  'tiempo_entrega', pp.tiempo_entrega_dias,
                  'cantidad_minima', pp.cantidad_minima_pedido
                )
              ) as proveedores
       FROM productos p 
       LEFT JOIN categorias c ON p.categoria_id = c.id
       LEFT JOIN producto_proveedor pp ON p.id = pp.producto_id AND pp.activo = true
       LEFT JOIN proveedores prov ON pp.proveedor_id = prov.id AND prov.activo = true
       WHERE p.activo = true 
       AND p.modulo_id = $1
       AND p.stock_actual <= p.stock_minimo
       GROUP BY p.id, c.nombre
       ORDER BY p.stock_actual ASC`,
        [moduloId]
      );
      
      res.json(result.rows);
    } catch (error) {
      console.error('Error obteniendo alertas completas:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ==================== RUTAS DE REPORTES ====================

  app.get('/api/reportes', authenticateToken, checkAccess, requirePermiso('reportes'), async (req, res) => {
    try {
      const { tipo, fecha_inicio, fecha_fin } = req.query;
      const moduloId = req.moduloId;
      const negocioId = req.negocioId;

      if (!moduloId) {
        return res.status(400).json({ error: 'Se requiere un módulo' });
      }

      let reporteData;
      
      switch (tipo) {
        case 'ventas_diarias':
          reporteData = await generarReporteVentasDiarias(pool, negocioId, moduloId, fecha_inicio, fecha_fin);
          break;
        case 'ventas_mensual':
          reporteData = await generarReporteFinancieroMensual(pool, negocioId, moduloId, fecha_inicio, fecha_fin);
          break;
        case 'inventario':
          reporteData = await generarReporteInventario(pool, negocioId, moduloId);
          break;
        case 'productos_excel':
          reporteData = await generarExcelProductos(pool, moduloId);
          break;
        case 'ventas_excel':
          reporteData = await generarExcelVentas(pool, moduloId, fecha_inicio, fecha_fin);
          break;
        default:
          return res.status(400).json({ error: 'Tipo de reporte inválido' });
      }

      const extension = tipo.includes('excel') ? 'xlsx' : 'pdf';
      const contentType = tipo.includes('excel') ? 
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 
        'application/pdf';
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename=reporte_${tipo}.${extension}`);
      
      res.send(reporteData);

    } catch (error) {
      console.error('Error generando reporte:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  return {};
};
