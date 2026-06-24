import React, { useRef, useState } from 'react';
import './Factura.css';

const Factura = ({ venta, onClose }) => {
  const facturaRef = useRef();
  const [copiando, setCopiando] = useState(false);

  if (!venta) return null;

  // Formatear fecha
  const formatearFecha = (fecha) => {
    if (!fecha) return '';
    const date = new Date(fecha);
    return date.toLocaleDateString('es-CO', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Formatear número
  const formatearNumero = (numero) => {
    return Number(numero || 0).toLocaleString('es-CO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  // Número en letras (para montos)
  const numeroALetras = (numero) => {
    const unidades = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
    const decenas = ['', 'DIEZ', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
    const centenas = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

    // Función simple para convertir números (solo hasta 999)
    const convertirTresDigitos = (n) => {
      if (n === 0) return 'CERO';
      let resultado = '';
      const centena = Math.floor(n / 100);
      const decena = Math.floor((n % 100) / 10);
      const unidad = n % 10;

      if (centena > 0) {
        resultado += centenas[centena] + ' ';
      }

      if (decena > 0) {
        if (decena === 1 && unidad > 0) {
          const especiales = ['', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
          resultado += especiales[unidad] + ' ';
          return resultado.trim();
        }
        resultado += decenas[decena] + ' ';
        if (unidad > 0) {
          resultado += 'Y ' + unidades[unidad] + ' ';
        }
      } else if (unidad > 0) {
        resultado += unidades[unidad] + ' ';
      }

      return resultado.trim();
    };

    const entero = Math.floor(numero);
    const decimal = Math.round((numero - entero) * 100);

    if (entero === 0) {
      return decimal > 0 ? `CERO CON ${decimal.toString().padStart(2, '0')}/100` : 'CERO';
    }

    // Convertir parte entera (hasta millones)
    let parteEntera = '';
    const millones = Math.floor(entero / 1000000);
    const miles = Math.floor((entero % 1000000) / 1000);
    const resto = entero % 1000;

    if (millones > 0) {
      parteEntera += convertirTresDigitos(millones) + ' MILLONES ';
    }

    if (miles > 0) {
      parteEntera += convertirTresDigitos(miles) + ' MIL ';
    }

    if (resto > 0) {
      parteEntera += convertirTresDigitos(resto);
    }

    if (decimal > 0) {
      return `${parteEntera.trim()} CON ${decimal.toString().padStart(2, '0')}/100`;
    }

    return parteEntera.trim();
  };

  // Imprimir factura
  const imprimirFactura = () => {
    const contenido = facturaRef.current;
    if (!contenido) return;
    
    const ventana = window.open('', '_blank', 'width=420,height=600');
    if (!ventana) {
      alert('Por favor, permite las ventanas emergentes para imprimir');
      return;
    }
    
    ventana.document.write(`
      <html>
        <head>
          <title>Factura ${venta.numero_factura}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: 'Courier New', monospace; 
              padding: 20px; 
              max-width: 380px; 
              margin: 0 auto; 
              background: white;
            }
            .factura-print { 
              background: white; 
              padding: 10px;
            }
            .factura-header { 
              text-align: center; 
              border-bottom: 2px double #000; 
              padding-bottom: 10px; 
              margin-bottom: 10px; 
            }
            .factura-header h2 { 
              font-size: 18px; 
              margin-bottom: 4px;
            }
            .factura-header .negocio-datos {
              font-size: 11px;
              color: #444;
              line-height: 1.4;
            }
            .factura-cliente { 
              margin: 10px 0; 
              padding: 8px 10px; 
              background: #f5f5f5; 
              border-radius: 4px; 
              font-size: 12px;
            }
            .factura-items { 
              margin: 10px 0; 
            }
            .factura-items table { 
              width: 100%; 
              border-collapse: collapse; 
              font-size: 12px;
            }
            .factura-items th { 
              background: #f0f0f0; 
              padding: 5px 4px; 
              text-align: left; 
              border-bottom: 1px solid #000; 
              font-size: 11px;
            }
            .factura-items td { 
              padding: 4px; 
              border-bottom: 1px solid #ddd; 
            }
            .factura-items .text-right { text-align: right; }
            .factura-totales { 
              margin-top: 10px; 
              text-align: right; 
              border-top: 2px solid #000; 
              padding-top: 10px;
            }
            .factura-totales .total-linea {
              display: flex;
              justify-content: space-between;
              padding: 2px 0;
              font-size: 13px;
            }
            .factura-totales .total-linea.total {
              font-size: 16px;
              font-weight: bold;
              border-top: 1px solid #000;
              padding-top: 5px;
              margin-top: 5px;
            }
            .factura-footer { 
              text-align: center; 
              margin-top: 15px; 
              padding-top: 10px;
              border-top: 1px dashed #000; 
              font-size: 12px; 
            }
            .factura-footer p { margin: 2px 0; }
            .factura-numero-letras {
              font-size: 11px;
              color: #555;
              margin: 5px 0;
              text-align: right;
              font-style: italic;
            }
            @media print {
              .no-print { display: none !important; }
              body { padding: 10px; }
            }
          </style>
        </head>
        <body>
          <div class="factura-print">
            ${contenido.innerHTML}
          </div>
          <div class="no-print" style="text-align:center;margin-top:20px;display:flex;gap:10px;justify-content:center;">
            <button onclick="window.print()" style="padding:8px 20px;cursor:pointer;background:#4299e1;color:white;border:none;border-radius:5px;font-size:14px;">🖨️ Imprimir</button>
            <button onclick="window.close()" style="padding:8px 20px;cursor:pointer;background:#e2e8f0;color:#2d3748;border:none;border-radius:5px;font-size:14px;">Cerrar</button>
          </div>
          <script>
            // Auto-imprimir al cargar
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 500);
            };
          <\/script>
        </body>
      </html>
    `);
    ventana.document.close();
  };

  // Copiar al portapapeles
  const copiarFactura = async () => {
    const contenido = facturaRef.current;
    if (!contenido) return;
    
    try {
      setCopiando(true);
      // Extraer texto plano de la factura
      const texto = contenido.textContent || '';
      await navigator.clipboard.writeText(texto);
      setTimeout(() => setCopiando(false), 2000);
    } catch (error) {
      console.error('Error copiando factura:', error);
      alert('No se pudo copiar la factura');
      setCopiando(false);
    }
  };

  // Descargar como TXT
  const descargarTXT = () => {
    const contenido = facturaRef.current;
    if (!contenido) return;
    
    const texto = contenido.textContent || '';
    const blob = new Blob([texto], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `factura_${venta.numero_factura}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="factura-modal" onClick={onClose}>
      <div className="factura-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="factura-modal-header">
          <div className="header-left">
            <h3>🧾 Factura</h3>
            <span className="factura-numero">{venta.numero_factura}</span>
          </div>
          <div className="header-actions">
            <button onClick={copiarFactura} className="btn-copiar" title="Copiar al portapapeles" disabled={copiando}>
              {copiando ? '✅' : '📋'}
            </button>
            <button onClick={descargarTXT} className="btn-descargar" title="Descargar como TXT">
              💾
            </button>
            <button onClick={onClose} className="btn-cerrar">✕</button>
          </div>
        </div>
        
        <div ref={facturaRef} className="factura-content">
          {/* Cabecera de la factura */}
          <div className="factura-header">
            <h2>{venta.negocio_nombre || 'Mi Negocio'}</h2>
            <div className="negocio-datos">
              <p>{venta.negocio_direccion || ''}</p>
              <p>Tel: {venta.negocio_telefono || ''} | NIT: {venta.negocio_ruc_nit || ''}</p>
              {venta.modulo_nombre && (
                <p><strong>Módulo:</strong> {venta.modulo_nombre}</p>
              )}
            </div>
            <hr />
            <div className="factura-metadatos">
              <p><strong>Factura N°:</strong> {venta.numero_factura}</p>
              <p><strong>Fecha:</strong> {formatearFecha(venta.fecha_venta)}</p>
              <p><strong>Vendedor:</strong> {venta.vendedor_nombre || 'N/A'}</p>
            </div>
          </div>

          {/* Datos del cliente */}
          <div className="factura-cliente">
            <p><strong>Cliente:</strong> {venta.cliente_nombre || 'Consumidor Final'}</p>
            {venta.cliente_documento && <p><strong>Documento:</strong> {venta.cliente_documento}</p>}
            {venta.cliente_direccion && <p><strong>Dirección:</strong> {venta.cliente_direccion}</p>}
            {venta.cliente_telefono && <p><strong>Teléfono:</strong> {venta.cliente_telefono}</p>}
          </div>

          {/* Detalles de la factura */}
          <div className="factura-items">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th style={{textAlign: 'center'}}>Cant</th>
                  <th style={{textAlign: 'right'}}>Precio</th>
                  <th style={{textAlign: 'right'}}>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {venta.detalles && venta.detalles.map((detalle, index) => (
                  <tr key={index}>
                    <td>{detalle.producto_nombre}</td>
                    <td style={{textAlign: 'center'}}>{detalle.cantidad}</td>
                    <td style={{textAlign: 'right'}}>${formatearNumero(detalle.precio_unitario)}</td>
                    <td style={{textAlign: 'right'}}>${formatearNumero(detalle.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totales */}
          <div className="factura-totales">
            <div className="total-linea">
              <span>Subtotal:</span>
              <span>${formatearNumero(venta.subtotal || 0)}</span>
            </div>
            <div className="total-linea total">
              <span><strong>Total:</strong></span>
              <span><strong>${formatearNumero(venta.total || 0)}</strong></span>
            </div>
            {venta.metodo_pago && (
              <div className="total-linea">
                <span>Método de pago:</span>
                <span>{venta.metodo_pago}</span>
              </div>
            )}
            <div className="factura-numero-letras">
              <span>Son: {numeroALetras(venta.total || 0)}</span>
            </div>
          </div>

          {/* Pie de factura */}
          <div className="factura-footer">
            <p>¡Gracias por tu compra!</p>
            <p style={{fontSize: '10px', color: '#888'}}>
              Factura generada automáticamente • {new Date().toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="factura-modal-footer">
          <button onClick={imprimirFactura} className="btn-imprimir">
            🖨️ Imprimir
          </button>
          <button onClick={descargarTXT} className="btn-descargar-footer">
            💾 Descargar TXT
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