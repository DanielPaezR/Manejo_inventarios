import React, { useRef } from 'react';
import './Factura.css';

const Factura = ({ venta, onClose }) => {
  const facturaRef = useRef();

  if (!venta) return null;

  const imprimirFactura = () => {
    const contenido = facturaRef.current;
    if (!contenido) return;
    
    const ventana = window.open('', '_blank', 'width=400,height=600');
    if (!ventana) {
      alert('Por favor, permite las ventanas emergentes para imprimir');
      return;
    }
    
    ventana.document.write(`
      <html>
        <head>
          <title>Factura ${venta.numero_factura}</title>
          <style>
            body { font-family: monospace; padding: 20px; max-width: 350px; margin: 0 auto; }
            .factura-header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px; }
            .factura-detalle { border-bottom: 1px solid #ddd; padding: 5px 0; }
            .factura-total { font-weight: bold; font-size: 1.2em; text-align: right; margin-top: 10px; }
            .factura-pie { text-align: center; margin-top: 20px; font-size: 0.9em; }
            .factura-cliente { margin: 10px 0; padding: 10px; background: #f5f5f5; border-radius: 5px; }
            .factura-items table { width: 100%; border-collapse: collapse; }
            .factura-items th, .factura-items td { padding: 5px; text-align: left; border-bottom: 1px solid #ddd; }
            .factura-items th { background: #f0f0f0; }
            .factura-totales { margin-top: 10px; text-align: right; }
            @media print { .no-print { display: none; } }
          </style>
        </head>
        <body>
          <div id="factura-print">
            ${contenido.innerHTML}
          </div>
          <div class="no-print" style="text-align:center;margin-top:20px;">
            <button onclick="window.print()">🖨️ Imprimir</button>
            <button onclick="window.close()">Cerrar</button>
          </div>
          <script>
            window.print();
          <\/script>
        </body>
      </html>
    `);
    ventana.document.close();
  };

  return (
    <div className="factura-modal" onClick={onClose}>
      <div className="factura-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="factura-modal-header">
          <h3>🧾 Factura</h3>
          <button onClick={onClose}>✕</button>
        </div>
        
        <div ref={facturaRef} className="factura-content">
          {/* Cabecera de la factura */}
          <div className="factura-header">
            <h2>{venta.negocio_nombre || 'Mi Negocio'}</h2>
            <p>{venta.negocio_direccion || ''}</p>
            <p>Tel: {venta.negocio_telefono || ''}</p>
            <p>NIT: {venta.negocio_ruc_nit || ''}</p>
            {venta.modulo_nombre && (
              <p><strong>Módulo:</strong> {venta.modulo_nombre}</p>
            )}
            <hr />
            <p><strong>Factura N°:</strong> {venta.numero_factura}</p>
            <p><strong>Fecha:</strong> {new Date(venta.fecha_venta).toLocaleString()}</p>
            <p><strong>Vendedor:</strong> {venta.vendedor_nombre || 'N/A'}</p>
          </div>

          {/* Datos del cliente */}
          {venta.cliente_nombre && (
            <div className="factura-cliente">
              <p><strong>Cliente:</strong> {venta.cliente_nombre}</p>
              {venta.cliente_documento && <p><strong>Documento:</strong> {venta.cliente_documento}</p>}
              {venta.cliente_direccion && <p><strong>Dirección:</strong> {venta.cliente_direccion}</p>}
              {venta.cliente_telefono && <p><strong>Teléfono:</strong> {venta.cliente_telefono}</p>}
            </div>
          )}

          {/* Detalles de la factura */}
          <div className="factura-items">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cant</th>
                  <th>Precio</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {venta.detalles && venta.detalles.map((detalle, index) => (
                  <tr key={index}>
                    <td>{detalle.producto_nombre}</td>
                    <td>{detalle.cantidad}</td>
                    <td>${Number(detalle.precio_unitario).toLocaleString()}</td>
                    <td>${Number(detalle.subtotal).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totales (sin IVA) */}
          <div className="factura-totales">
            <div className="total-linea">
              <span>Subtotal:</span>
              <span>${Number(venta.subtotal || 0).toLocaleString()}</span>
            </div>
            <div className="total-linea total">
              <span><strong>Total:</strong></span>
              <span><strong>${Number(venta.total || 0).toLocaleString()}</strong></span>
            </div>
            {venta.metodo_pago && (
              <div className="total-linea">
                <span>Método de pago:</span>
                <span>{venta.metodo_pago}</span>
              </div>
            )}
          </div>

          {/* Pie de factura */}
          <div className="factura-footer">
            <p>¡Gracias por tu compra!</p>
          </div>
        </div>

        <div className="factura-modal-footer">
          <button onClick={imprimirFactura} className="btn-imprimir">
            🖨️ Imprimir
          </button>
          <button onClick={onClose} className="btn-cerrar-factura">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

export default Factura;