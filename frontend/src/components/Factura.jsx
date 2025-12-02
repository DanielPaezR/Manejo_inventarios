import React, { useEffect, useRef } from 'react';
import './Factura.css';

const Factura = ({ venta, onClose }) => {
  const printButtonRef = useRef(null);
  const closeButtonRef = useRef(null);
  const [isPrinting, setIsPrinting] = React.useState(false);

  if (!venta) return null;

  // Enfocar el botón de imprimir cuando el componente se monta
  useEffect(() => {
    if (printButtonRef.current) {
      printButtonRef.current.focus();
    }
  }, []);

  const handlePrint = () => {
    setIsPrinting(true);
    window.print();
    // Después de imprimir, enfocar el botón de cerrar
    setTimeout(() => {
      if (closeButtonRef.current) {
        closeButtonRef.current.focus();
      }
      setIsPrinting(false);
    }, 100);
  };

  // Manejar teclas para mejorar la experiencia
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (document.activeElement === printButtonRef.current && !isPrinting) {
        handlePrint();
      } else if (document.activeElement === closeButtonRef.current) {
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Tab' && e.shiftKey && document.activeElement === printButtonRef.current) {
      // Prevenir tab hacia atrás desde el primer botón
      e.preventDefault();
      closeButtonRef.current.focus();
    }
  };

  return (
    <div className="factura-overlay" onKeyDown={handleKeyDown}>
      <div className="factura-container">
        <div className="factura-header">
          <h2>FACTURA DE VENTA</h2>
          <button 
            className="btn-close" 
            onClick={onClose}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
        
        <div className="factura-content" id="factura-print">
          {/* Encabezado de la factura */}
          <div className="factura-empresa">
            <h3>{venta.negocio_nombre}</h3>
            <p>NIT: {venta.negocio_ruc_nit}</p>
            <p>Dirección: {venta.negocio_direccion}</p>
            <p>Teléfono: {venta.negocio_telefono}</p>
          </div>
          
          {/* Información de la factura */}
          <div className="factura-info">
            <div className="factura-numero">
              <strong>Factura No:</strong> {venta.numero_factura}
            </div>
            <div className="factura-fecha">
              <strong>Fecha:</strong> {new Date(venta.fecha_venta).toLocaleDateString()}
            </div>
          </div>
          
          {/* Información del cliente */}
          <div className="factura-cliente">
            <h4>DATOS DEL CLIENTE</h4>
            <p><strong>Nombre:</strong> {venta.cliente_nombre || 'Consumidor Final'}</p>
            <p><strong>Documento:</strong> {venta.cliente_documento || 'No especificado'}</p>
            {venta.cliente_telefono && <p><strong>Teléfono:</strong> {venta.cliente_telefono}</p>}
          </div>
          
          {/* Detalles de los productos */}
          <table className="factura-detalles">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Precio Unitario</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {venta.detalles.map((detalle, index) => (
                <tr key={index}>
                  <td>{detalle.producto_nombre}</td>
                  <td>{detalle.cantidad}</td>
                  <td>${detalle.precio_unitario.toLocaleString()}</td>
                  <td>${detalle.subtotal.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {/* Totales */}
          <div className="factura-totales">
            <div className="total-line">
              <span>Subtotal:</span>
              <span>${venta.subtotal.toLocaleString()}</span>
            </div>
            <div className="total-line">
              <span>IVA (19%):</span>
              <span>${venta.iva.toLocaleString()}</span>
            </div>
            <div className="total-line total-final">
              <span>TOTAL:</span>
              <span>${venta.total.toLocaleString()}</span>
            </div>
          </div>
          
          {/* Información adicional */}
          <div className="factura-footer">
            <p><strong>Método de pago:</strong> {venta.metodo_pago}</p>
            <p><strong>Vendedor:</strong> {venta.vendedor_nombre}</p>
            <p className="factura-leyenda">¡Gracias por su compra!</p>
          </div>
        </div>
        
        <div className="factura-actions">
          <button 
            ref={printButtonRef}
            className="btn btn-primary" 
            onClick={handlePrint}
            autoFocus
          >
            🖨️ Imprimir Factura (Enter)
          </button>
          <button 
            ref={closeButtonRef}
            className="btn btn-secondary" 
            onClick={onClose}
          >
            Cerrar (Enter/Esc)
          </button>
        </div>
      </div>
    </div>
  );
};

export default Factura;