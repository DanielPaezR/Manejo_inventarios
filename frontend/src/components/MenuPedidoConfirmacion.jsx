import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import apiPublico from '../services/apiPublico';
import './MenuPedidoConfirmacion.css';

const ESTADO_INFO = {
  pendiente: { icono: '⏳', label: 'Pendiente de confirmación', clase: 'pendiente' },
  confirmado: { icono: '✅', label: 'Pedido enviado, el negocio lo está revisando', clase: 'confirmado' },
  completado: { icono: '🎉', label: 'Completado', clase: 'completado' },
  cancelado: { icono: '❌', label: 'Cancelado', clase: 'cancelado' }
};

const MenuPedidoConfirmacion = () => {
  const { moduloId, token } = useParams();

  const [pedido, setPedido] = useState(null);
  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorAccion, setErrorAccion] = useState('');

  const [editando, setEditando] = useState(false);
  const [carritoEdit, setCarritoEdit] = useState({});
  const [mesaNombreEdit, setMesaNombreEdit] = useState('');
  const [montoRecibidoEdit, setMontoRecibidoEdit] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const cargarPedido = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await apiPublico.get(`/menu/pedido/${token}`);
      setPedido(response.data);
    } catch (err) {
      console.error('Error cargando pedido:', err);
      setError(err.response?.data?.error || 'No se pudo cargar este pedido');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    cargarPedido();
  }, [cargarPedido]);

  const iniciarEdicion = async () => {
    if (!pedido) return;
    const inicial = {};
    pedido.detalles.forEach(d => {
      inicial[d.producto_id] = d.cantidad;
    });
    setCarritoEdit(inicial);
    setMesaNombreEdit(pedido.mesa_nombre);
    setMontoRecibidoEdit(pedido.monto_recibido ? String(Number(pedido.monto_recibido)) : '');
    setErrorAccion('');
    setEditando(true);

    try {
      const response = await apiPublico.get(`/menu/${moduloId}`);
      setProductos(response.data.productos);
    } catch (err) {
      console.error('Error cargando productos para editar:', err);
    }
  };

  // Catálogo vigente (con stock actual) + cualquier producto del pedido
  // original que ya no aparezca ahí (se agotó entre que se hizo el
  // pedido y ahora) — se muestra igual, tope en la cantidad ya pedida,
  // para poder bajarlo/quitarlo aunque no se pueda subir más.
  const productosParaEditar = useMemo(() => {
    if (!pedido) return productos;
    const idsVigentes = new Set(productos.map(p => p.id));
    const extras = pedido.detalles
      .filter(d => !idsVigentes.has(d.producto_id))
      .map(d => ({
        id: d.producto_id,
        nombre: d.nombre_producto,
        descripcion: '',
        precio_venta: d.precio_unitario,
        stock_actual: d.cantidad,
        categoria_nombre: 'Ya en tu pedido'
      }));
    return [...productos, ...extras];
  }, [productos, pedido]);

  const productosPorCategoria = productosParaEditar.reduce((acc, producto) => {
    const categoria = producto.categoria_nombre || 'Otros';
    if (!acc[categoria]) acc[categoria] = [];
    acc[categoria].push(producto);
    return acc;
  }, {});

  const cambiarCantidadEdit = (producto, delta) => {
    setCarritoEdit(prev => {
      const actual = prev[producto.id] || 0;
      const nueva = Math.max(0, Math.min(producto.stock_actual, actual + delta));
      if (nueva === 0) {
        const copia = { ...prev };
        delete copia[producto.id];
        return copia;
      }
      return { ...prev, [producto.id]: nueva };
    });
  };

  const itemsEdit = Object.entries(carritoEdit)
    .filter(([, cantidad]) => cantidad > 0)
    .map(([productoId, cantidad]) => ({ producto_id: parseInt(productoId, 10), cantidad }));

  const totalEdit = itemsEdit.reduce((sum, item) => {
    const producto = productosParaEditar.find(p => p.id === item.producto_id);
    return sum + (producto ? item.cantidad * Number(producto.precio_venta) : 0);
  }, 0);

  const formatearMoneda = (valor) => `$${Number(valor || 0).toLocaleString('es-CO')}`;

  const handleGuardarEdicion = async () => {
    setErrorAccion('');

    if (!mesaNombreEdit.trim()) {
      setErrorAccion('⚠️ Ingresa tu nombre o el número de mesa');
      return;
    }
    if (itemsEdit.length === 0) {
      setErrorAccion('⚠️ Agrega al menos un producto');
      return;
    }

    try {
      setGuardando(true);
      await apiPublico.put(`/menu/pedido/${token}`, {
        mesa_nombre: mesaNombreEdit.trim(),
        monto_recibido: montoRecibidoEdit ? Number(montoRecibidoEdit) : undefined,
        items: itemsEdit
      });
      // Se recarga por GET en vez de usar la respuesta del PUT directamente:
      // el detalle que devuelve el PUT no trae `id` (solo lo trae la fila
      // real de pedidos_cliente_detalle que arma el GET), y ese `id` es la
      // key de la lista de productos — sin él, React tira warning de key
      // duplicada/faltante.
      await cargarPedido();
      setEditando(false);
    } catch (err) {
      console.error('Error guardando edición:', err);
      setErrorAccion(err.response?.data?.error || '❌ Error al guardar los cambios');
    } finally {
      setGuardando(false);
    }
  };

  const handleCancelar = async () => {
    if (!confirm('¿Seguro que quieres cancelar este pedido?')) return;

    try {
      setCancelando(true);
      setErrorAccion('');
      const response = await apiPublico.put(`/menu/pedido/${token}/cancelar`);
      // La respuesta de /cancelar no trae `detalles` (solo la fila de
      // pedidos_cliente) — se conserva el detalle que ya se tenía cargado.
      setPedido(prev => ({ ...prev, ...response.data }));
    } catch (err) {
      console.error('Error cancelando pedido:', err);
      setErrorAccion(err.response?.data?.error || '❌ Error al cancelar el pedido');
    } finally {
      setCancelando(false);
    }
  };

  // Confirma primero en la base de datos (cambio de estado real) y SOLO si
  // eso tiene éxito abre WhatsApp — así el pedido no puede quedar
  // "enviado por WhatsApp" pero todavía editable/cancelable del lado del
  // cliente, con el negocio mirando un mensaje que ya no refleja la
  // realidad. Si alguien más ya lo canceló mientras el cliente decidía,
  // el endpoint falla y NO se abre WhatsApp con un pedido inválido.
  const handleConfirmarWhatsApp = async () => {
    const telefono = pedido.negocio_telefono?.replace(/\D/g, '');
    if (!telefono) {
      setErrorAccion('⚠️ Este negocio no tiene un número de WhatsApp configurado. Contáctalo directamente.');
      return;
    }

    try {
      setConfirmando(true);
      setErrorAccion('');
      const response = await apiPublico.put(`/menu/pedido/${token}/confirmar`);
      // La respuesta de /confirmar no trae `detalles` (solo la fila de
      // pedidos_cliente) — se conserva el detalle que ya se tenía cargado.
      setPedido(prev => ({ ...prev, ...response.data }));

      // Sin emojis no-BMP (🛍️👤💰💵): la redirección propia de wa.me hacia
      // api.whatsapp.com los corrompe a "�" en el mensaje final (verificado
      // con una prueba real). El em dash (—) y el resto del texto sí llegan bien.
      let mensaje = `*PEDIDO*\n\n`;
      mensaje += `*Mesa/Nombre:* ${pedido.mesa_nombre}\n\n`;
      mensaje += `*Productos:*\n`;
      pedido.detalles.forEach(d => {
        mensaje += `- ${d.nombre_producto} x${d.cantidad} — ${formatearMoneda(d.subtotal)}\n`;
      });
      mensaje += `\n*Total:* ${formatearMoneda(pedido.total)}\n`;
      if (pedido.monto_recibido) {
        mensaje += `*Paga con:* ${formatearMoneda(pedido.monto_recibido)}\n`;
      }

      const url = `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;
      window.open(url, '_blank');
    } catch (err) {
      console.error('Error confirmando pedido:', err);
      setErrorAccion(err.response?.data?.error || '❌ Error al confirmar el pedido');
    } finally {
      setConfirmando(false);
    }
  };

  if (loading) {
    return (
      <div className="menu-confirmacion-container">
        <div className="menu-confirmacion-loading">Cargando pedido...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="menu-confirmacion-container">
        <div className="menu-confirmacion-error">⚠️ {error}</div>
      </div>
    );
  }

  const estadoInfo = ESTADO_INFO[pedido.estado] || ESTADO_INFO.pendiente;

  return (
    <div className="menu-confirmacion-container">
      <div className="menu-confirmacion-header">
        <h1>🧾 Tu pedido</h1>
        <span className={`estado-badge-pedido-cliente estado-${estadoInfo.clase}`}>
          {estadoInfo.icono} {estadoInfo.label}
        </span>
      </div>

      {!editando ? (
        <>
          <div className="menu-confirmacion-resumen">
            <p><strong>Mesa/Nombre:</strong> {pedido.mesa_nombre}</p>

            <div className="menu-confirmacion-productos">
              {pedido.detalles.map(detalle => (
                <div key={detalle.id} className="menu-confirmacion-item">
                  <span>{detalle.nombre_producto} x{detalle.cantidad}</span>
                  <span>{formatearMoneda(detalle.subtotal)}</span>
                </div>
              ))}
            </div>

            <div className="menu-confirmacion-total">
              <span>Total</span>
              <span>{formatearMoneda(pedido.total)}</span>
            </div>

            {pedido.monto_recibido && (
              <p className="menu-confirmacion-monto-recibido">
                💵 Paga con: {formatearMoneda(pedido.monto_recibido)}
              </p>
            )}
          </div>

          {errorAccion && <p className="menu-confirmacion-error-accion">{errorAccion}</p>}

          {pedido.estado === 'pendiente' && (
            <div className="menu-confirmacion-acciones">
              <button onClick={iniciarEdicion} disabled={cancelando || confirmando} className="btn-editar-pedido">
                ✏️ Editar
              </button>
              <button onClick={handleCancelar} disabled={cancelando || confirmando} className="btn-cancelar-pedido-cliente">
                {cancelando ? 'Cancelando...' : '❌ Cancelar pedido'}
              </button>
              <button onClick={handleConfirmarWhatsApp} disabled={cancelando || confirmando} className="btn-confirmar-pedido">
                {confirmando ? 'Confirmando...' : '✅ Confirmar y enviar'}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="menu-confirmacion-edicion">
          {Object.entries(productosPorCategoria).map(([categoria, items]) => (
            <div key={categoria} className="menu-categoria">
              <h2 className="menu-categoria-titulo">{categoria}</h2>
              {items.map(producto => {
                const cantidad = carritoEdit[producto.id] || 0;
                return (
                  <div key={producto.id} className="menu-producto-item">
                    <div className="menu-producto-info">
                      <span className="menu-producto-nombre">{producto.nombre}</span>
                      <span className="menu-producto-precio">{formatearMoneda(producto.precio_venta)}</span>
                    </div>
                    <div className="menu-producto-stepper">
                      <button
                        onClick={() => cambiarCantidadEdit(producto, -1)}
                        disabled={cantidad === 0}
                        className="btn-stepper"
                      >
                        −
                      </button>
                      <span className="menu-producto-cantidad">{cantidad}</span>
                      <button
                        onClick={() => cambiarCantidadEdit(producto, 1)}
                        disabled={cantidad >= producto.stock_actual}
                        className="btn-stepper"
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          <div className="menu-confirmacion-edicion-panel">
            <div className="menu-carrito-resumen">
              🛒 {itemsEdit.reduce((s, i) => s + i.cantidad, 0)} items · {formatearMoneda(totalEdit)}
            </div>
            <input
              type="text"
              placeholder="Mesa o tu nombre *"
              value={mesaNombreEdit}
              onChange={(e) => setMesaNombreEdit(e.target.value)}
              className="menu-carrito-input"
            />
            <input
              type="number"
              min="0"
              placeholder="¿Con qué billete vas a pagar? (opcional)"
              value={montoRecibidoEdit}
              onChange={(e) => setMontoRecibidoEdit(e.target.value)}
              className="menu-carrito-input"
            />

            {errorAccion && <p className="menu-confirmacion-error-accion">{errorAccion}</p>}

            <div className="menu-confirmacion-edicion-botones">
              <button onClick={handleGuardarEdicion} disabled={guardando} className="btn-guardar-edicion">
                {guardando ? 'Guardando...' : '💾 Guardar cambios'}
              </button>
              <button onClick={() => setEditando(false)} className="btn-cancelar-edicion">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MenuPedidoConfirmacion;
