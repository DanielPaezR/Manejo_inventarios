import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import apiPublico from '../services/apiPublico';
import './MenuPedidoConfirmacion.css';

// ============================================================
// Iconografía — mismos paths e iguales criterios que MenuPublico.jsx.
// Duplicados a propósito: no se agrega un archivo compartido nuevo
// (fuera del alcance pedido), y ambos archivos ya se mantienen
// coordinados a mano en el mismo sistema de diseño "Modernist".
// ============================================================
const IconoHoja = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M4 20c8 0 14-6 14-14 0-1 0-2-.5-3C10 4 4 10 4 18c0 .7 0 1.4.2 2z" />
    <path d="M4 20c3-6 7-10 13-13" />
  </svg>
);

const IconoMontana = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M3 20l5.5-9.5L12 16l3-5L21 20H3z" />
  </svg>
);

const IconoGota = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 3s6.5 7.5 6.5 12A6.5 6.5 0 015.5 15C5.5 10.5 12 3 12 3z" />
  </svg>
);

const IconoEspiga = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 21V9" />
    <path d="M12 9c-2.2 0-4-1.8-4-4M12 9c2.2 0 4-1.8 4-4M12 14c-2.2 0-4-1.8-4-4M12 14c2.2 0 4-1.8 4-4" />
  </svg>
);

const obtenerIconoCategoria = (nombreCategoria) => {
  const n = (nombreCategoria || '').toLowerCase();
  if (n.includes('entrada')) return IconoHoja;
  if (n.includes('fuerte') || n.includes('principal') || n.includes('plato')) return IconoMontana;
  if (n.includes('bebida') || n.includes('trago') || n.includes('jugo') || n.includes('gaseosa')) return IconoGota;
  if (n.includes('postre') || n.includes('dulce')) return IconoEspiga;
  return IconoHoja;
};

const ESTADO_INFO = {
  pendiente: { label: 'Pendiente de confirmación', pill: 'mp-pill--neutral' },
  confirmado: { label: 'Pedido enviado, el negocio lo está revisando', pill: 'mp-pill--accent' },
  completado: { label: 'Completado', pill: 'mp-pill--accent' },
  cancelado: { label: 'Cancelado', pill: 'mp-pill--outline' }
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

  // Edición in-place (no navega a /menu/:moduloId): mismo PUT
  // /menu/pedido/:token de siempre, mismo token, mismo pedido. Ver
  // decisión con el usuario — se descartó a propósito la alternativa de
  // navegar al menú principal con el carrito precargado, porque
  // "Generar pedido" allá crea un pedido NUEVO (POST), lo que hubiera
  // dejado este pedido original huérfano en 'pendiente' para siempre.
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
      {!editando ? (
        <div className="mp-checkout">
          <h1 className="mp-checkout__titulo">Pedido enviado</h1>
          <span className={`mp-pill ${estadoInfo.pill}`}>{estadoInfo.label}</span>

          <div className="mp-card mp-resumen">
            {pedido.detalles.map(detalle => (
              <div key={detalle.id} className="mp-resumen__fila">
                <span>{detalle.nombre_producto} × {detalle.cantidad}</span>
                <span>{formatearMoneda(detalle.subtotal)}</span>
              </div>
            ))}
            <div className="mp-resumen__total">
              <span>Total</span>
              <span>{formatearMoneda(pedido.total)}</span>
            </div>
          </div>

          {pedido.monto_recibido && (
            <p className="menu-confirmacion-monto-recibido">
              Paga con: {formatearMoneda(pedido.monto_recibido)}
            </p>
          )}

          {errorAccion && <p className="mp-error">{errorAccion}</p>}

          {pedido.estado === 'pendiente' && (
            <div className="mp-acciones-apiladas">
              <button onClick={iniciarEdicion} disabled={cancelando || confirmando} className="mp-btn mp-btn--secondary mp-btn--full">
                Editar pedido
              </button>
              <button onClick={handleCancelar} disabled={cancelando || confirmando} className="mp-btn mp-btn--secondary mp-btn--danger-text mp-btn--full">
                {cancelando ? 'Cancelando...' : 'Cancelar pedido'}
              </button>
              <button onClick={handleConfirmarWhatsApp} disabled={cancelando || confirmando} className="mp-btn mp-btn--primary mp-btn--full">
                <IconoHoja className="mp-btn__icono" />
                {confirmando ? 'Confirmando...' : 'Confirmar y enviar'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="mp-checkout">
          <h1 className="mp-checkout__titulo">Editar pedido</h1>

          <div className="mp-categorias">
            {Object.entries(productosPorCategoria).map(([categoria, items]) => {
              const IconoCategoria = obtenerIconoCategoria(categoria);
              return (
                <div key={categoria} className="mp-categoria">
                  <div className="mp-categoria__header mp-categoria__header--estatico">
                    <span className="mp-categoria__icono">
                      <IconoCategoria />
                    </span>
                    <span className="mp-categoria__nombre">{categoria}</span>
                  </div>
                  <div className="mp-categoria__productos">
                    {items.map(producto => {
                      const cantidad = carritoEdit[producto.id] || 0;
                      return (
                        <div key={producto.id} className="mp-producto-card">
                          <div className="mp-producto-card__body">
                            <div className="mp-producto-card__fila">
                              <span className="mp-producto-card__nombre">{producto.nombre}</span>
                              <span className="mp-producto-card__precio">{formatearMoneda(producto.precio_venta)}</span>
                            </div>
                            <div className="mp-producto-card__stepper-fila">
                              <div className="mp-stepper">
                                <button
                                  type="button"
                                  onClick={() => cambiarCantidadEdit(producto, -1)}
                                  disabled={cantidad === 0}
                                  className="mp-stepper__btn"
                                >
                                  −
                                </button>
                                <span className="mp-stepper__cantidad">{cantidad}</span>
                                <button
                                  type="button"
                                  onClick={() => cambiarCantidadEdit(producto, 1)}
                                  disabled={cantidad >= producto.stock_actual}
                                  className="mp-stepper__btn"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mp-card mp-resumen">
            <div className="mp-resumen__total">
              <span>{itemsEdit.reduce((s, i) => s + i.cantidad, 0)} items</span>
              <span>{formatearMoneda(totalEdit)}</span>
            </div>
          </div>

          <div className="mp-campos">
            <input
              type="text"
              placeholder="Mesa o tu nombre *"
              value={mesaNombreEdit}
              onChange={(e) => setMesaNombreEdit(e.target.value)}
              className="mp-input"
            />
            <input
              type="number"
              min="0"
              placeholder="¿Con qué billete vas a pagar? (opcional)"
              value={montoRecibidoEdit}
              onChange={(e) => setMontoRecibidoEdit(e.target.value)}
              className="mp-input"
            />
          </div>

          {errorAccion && <p className="mp-error">{errorAccion}</p>}

          <div className="mp-acciones-apiladas">
            <button onClick={handleGuardarEdicion} disabled={guardando} className="mp-btn mp-btn--primary mp-btn--full">
              {guardando ? 'Guardando...' : 'Guardar cambios'}
            </button>
            <button onClick={() => setEditando(false)} className="mp-btn mp-btn--secondary mp-btn--full">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MenuPedidoConfirmacion;
