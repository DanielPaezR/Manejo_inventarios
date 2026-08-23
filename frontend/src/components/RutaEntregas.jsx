import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import './RutaEntregas.css';

// Vista especializada sobre pedidos_cliente: no es un sistema nuevo, solo
// filtra/ordena los pedidos a domicilio (es_domicilio=true) que ya trae
// GET /api/pedidos-cliente, y reutiliza los mismos endpoints de
// completar/cancelar que ya usa PedidosCliente.jsx.
const formatearMoneda = (valor) => `$${Number(valor || 0).toLocaleString('es-CO')}`;

const RutaEntregas = ({ user }) => {
  const { moduloActivo } = useModulo();
  const esAdmin = user?.rol === 'admin' || user?.rol === 'super_admin';

  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [accionEnCurso, setAccionEnCurso] = useState(null); // `${id}-${accion}` o 'reordenando'

  const [frecuenciaEntrega, setFrecuenciaEntrega] = useState(null);
  const [editandoFrecuencia, setEditandoFrecuencia] = useState(false);
  const [frecuenciaInput, setFrecuenciaInput] = useState('');
  const [guardandoFrecuencia, setGuardandoFrecuencia] = useState(false);

  const [modalCompletar, setModalCompletar] = useState(null); // { pedidoId }
  const [metodoPagoCompletar, setMetodoPagoCompletar] = useState('efectivo');
  const [clientes, setClientes] = useState([]);
  const [clienteIdCompletar, setClienteIdCompletar] = useState('');
  const [completando, setCompletando] = useState(false);

  const cargarPedidos = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get('/pedidos-cliente');
      setPedidos(response.data);
    } catch (error) {
      console.error('Error cargando pedidos:', error);
      setMensaje('❌ Error al cargar los pedidos');
    } finally {
      setLoading(false);
    }
  }, []);

  const cargarModulo = useCallback(async () => {
    if (!moduloActivo) return;
    try {
      const response = await api.get(`/modulos/${moduloActivo.id}`);
      setFrecuenciaEntrega(response.data.frecuencia_entrega_dias);
    } catch (error) {
      console.error('Error cargando datos del módulo:', error);
    }
  }, [moduloActivo]);

  useEffect(() => {
    if (moduloActivo) {
      cargarPedidos();
      cargarModulo();
    }
  }, [moduloActivo, cargarPedidos, cargarModulo]);

  const cargarClientes = async () => {
    try {
      const response = await api.get('/clientes');
      setClientes(response.data);
    } catch (error) {
      console.error('Error cargando clientes:', error);
    }
  };

  // Paradas pendientes de la ruta actual: domicilios sin completar ni
  // cancelar. Las que ya tienen orden_ruta asignado van primero (en ese
  // orden); las que no, al final, en el orden en que llegaron.
  const paradas = useMemo(() => {
    const filtradas = pedidos.filter(
      p => p.es_domicilio && (p.estado === 'pendiente' || p.estado === 'confirmado')
    );
    const conOrden = filtradas
      .filter(p => p.orden_ruta !== null && p.orden_ruta !== undefined)
      .sort((a, b) => a.orden_ruta - b.orden_ruta);
    const sinOrden = filtradas
      .filter(p => p.orden_ruta === null || p.orden_ruta === undefined)
      .sort((a, b) => new Date(a.fecha_creacion) - new Date(b.fecha_creacion));
    return [...conOrden, ...sinOrden];
  }, [pedidos]);

  // Consolidado de todos los productos de todas las paradas pendientes,
  // para que el repartidor sepa qué empacar antes de salir.
  const resumenProductos = useMemo(() => {
    const mapa = new Map();
    for (const parada of paradas) {
      for (const detalle of parada.detalles || []) {
        mapa.set(detalle.nombre_producto, (mapa.get(detalle.nombre_producto) || 0) + Number(detalle.cantidad));
      }
    }
    return Array.from(mapa.entries())
      .map(([nombre, cantidad]) => ({ nombre, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);
  }, [paradas]);

  // Mueve una parada un puesto arriba/abajo y renumera 1..N según la
  // nueva posición visual — así las paradas "sin asignar" también quedan
  // con un orden_ruta real la primera vez que se tocan, sin ambigüedad
  // con las que ya tenían uno.
  const moverParada = async (index, direccion) => {
    const nuevoIndex = index + direccion;
    if (nuevoIndex < 0 || nuevoIndex >= paradas.length) return;

    const reordenadas = [...paradas];
    [reordenadas[index], reordenadas[nuevoIndex]] = [reordenadas[nuevoIndex], reordenadas[index]];

    setAccionEnCurso('reordenando');
    try {
      const cambios = reordenadas
        .map((p, i) => ({ p, nuevoOrden: i + 1 }))
        .filter(({ p, nuevoOrden }) => p.orden_ruta !== nuevoOrden);

      await Promise.all(
        cambios.map(({ p, nuevoOrden }) =>
          api.put(`/pedidos-cliente/${p.id}/orden-ruta`, { orden_ruta: nuevoOrden })
        )
      );
      await cargarPedidos();
    } catch (error) {
      console.error('Error reordenando la ruta:', error);
      setMensaje('❌ Error al reordenar la ruta');
    } finally {
      setAccionEnCurso(null);
      setTimeout(() => setMensaje(''), 4000);
    }
  };

  const abrirComoLlegar = (direccion) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(direccion)}`;
    window.open(url, '_blank');
  };

  const cancelarParada = async (id) => {
    if (!confirm('¿Cancelar este pedido? Esta acción no se puede deshacer.')) return;
    try {
      setAccionEnCurso(`${id}-cancelar`);
      await api.put(`/pedidos-cliente/${id}/cancelar`);
      setMensaje('✅ Pedido cancelado');
      cargarPedidos();
    } catch (error) {
      console.error('Error cancelando pedido:', error);
      setMensaje(`❌ ${error.response?.data?.error || 'Error al cancelar el pedido'}`);
    } finally {
      setAccionEnCurso(null);
      setTimeout(() => setMensaje(''), 4000);
    }
  };

  const abrirModalCompletar = (id) => {
    setModalCompletar({ pedidoId: id });
    setMetodoPagoCompletar('efectivo');
    setClienteIdCompletar('');
    if (clientes.length === 0) cargarClientes();
  };

  // Mismo endpoint que ya usa PedidosCliente.jsx: descuenta stock y crea
  // la venta real — no se duplica esa lógica acá.
  const confirmarCompletar = async () => {
    if (metodoPagoCompletar === 'credito' && !clienteIdCompletar) {
      setMensaje('⚠️ Selecciona un cliente para completar como crédito');
      return;
    }

    try {
      setCompletando(true);
      await api.put(`/pedidos-cliente/${modalCompletar.pedidoId}/completar`, {
        metodo_pago: metodoPagoCompletar,
        ...(clienteIdCompletar && { cliente_id: parseInt(clienteIdCompletar, 10) })
      });
      setMensaje('✅ Entrega registrada, venta creada');
      setModalCompletar(null);
      cargarPedidos();
    } catch (error) {
      console.error('Error completando pedido:', error);
      setMensaje(`❌ ${error.response?.data?.error || 'Error al completar el pedido'}`);
    } finally {
      setCompletando(false);
      setTimeout(() => setMensaje(''), 4000);
    }
  };

  const iniciarEdicionFrecuencia = () => {
    setFrecuenciaInput(frecuenciaEntrega ? String(frecuenciaEntrega) : '');
    setEditandoFrecuencia(true);
  };

  const guardarFrecuencia = async () => {
    const val = parseInt(frecuenciaInput, 10);
    if (!Number.isFinite(val) || val <= 0) {
      setMensaje('⚠️ Ingresa un número de días válido');
      return;
    }

    try {
      setGuardandoFrecuencia(true);
      await api.put(`/modulos/${moduloActivo.id}/portada`, { frecuencia_entrega_dias: val });
      setFrecuenciaEntrega(val);
      setEditandoFrecuencia(false);
    } catch (error) {
      console.error('Error guardando frecuencia de entrega:', error);
      setMensaje('❌ Error al guardar la frecuencia de entrega');
    } finally {
      setGuardandoFrecuencia(false);
      setTimeout(() => setMensaje(''), 4000);
    }
  };

  if (!moduloActivo) {
    return (
      <div className="ruta-entregas-container">
        <div className="alert alert-warning">
          ⚠️ No hay módulo activo. Selecciona un módulo para ver la ruta de entregas.
        </div>
      </div>
    );
  }

  return (
    <div className="ruta-entregas-container">
      <div className="ruta-entregas-header">
        <div className="header-left">
          <h2>🛵 Ruta de Entregas</h2>
          <div className="modulo-indicador">
            <span className="badge">📁 {moduloActivo.nombre}</span>
          </div>
        </div>
      </div>

      {mensaje && (
        <div className={`mensaje-flotante ${mensaje.includes('✅') ? 'exito' : 'error'}`}>
          {mensaje}
          <button onClick={() => setMensaje('')} className="btn-cerrar-mensaje">✕</button>
        </div>
      )}

      <div className="card ruta-entregas-frecuencia-card">
        {editandoFrecuencia ? (
          <div className="ruta-entregas-frecuencia-form">
            <span>Frecuencia de entrega: cada</span>
            <input
              type="number"
              min="1"
              value={frecuenciaInput}
              onChange={(e) => setFrecuenciaInput(e.target.value)}
              className="ruta-entregas-frecuencia-input"
              autoFocus
            />
            <span>día(s)</span>
            <button onClick={guardarFrecuencia} disabled={guardandoFrecuencia} className="ruta-entregas-btn-chico ruta-entregas-btn-guardar-chico">
              {guardandoFrecuencia ? 'Guardando...' : '💾 Guardar'}
            </button>
            <button onClick={() => setEditandoFrecuencia(false)} disabled={guardandoFrecuencia} className="ruta-entregas-btn-chico">
              Cancelar
            </button>
          </div>
        ) : (
          <div className="ruta-entregas-frecuencia-texto">
            <span>
              📅 Frecuencia de entrega: {frecuenciaEntrega
                ? <strong>cada {frecuenciaEntrega} día(s)</strong>
                : <em>No configurada</em>}
            </span>
            {esAdmin && (
              <button onClick={iniciarEdicionFrecuencia} className="ruta-entregas-btn-chico">✏️ Editar</button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="loading">Cargando paradas...</div>
      ) : (
        <>
          {resumenProductos.length > 0 && (
            <div className="card ruta-entregas-resumen-card">
              <h3>📦 Resumen: qué llevar</h3>
              <ul className="ruta-entregas-resumen-lista">
                {resumenProductos.map((item) => (
                  <li key={item.nombre}>
                    <span className="ruta-entregas-resumen-cantidad">{item.cantidad}</span>
                    <span>{item.nombre}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card ruta-entregas-paradas-card">
            <h3>📍 Paradas pendientes ({paradas.length})</h3>
            {paradas.length === 0 ? (
              <p className="sin-datos">No hay domicilios pendientes ahora mismo</p>
            ) : (
              <div className="ruta-entregas-lista">
                {paradas.map((parada, index) => {
                  const enAccion = accionEnCurso === `${parada.id}-cancelar` || accionEnCurso === 'reordenando';
                  return (
                    <div key={parada.id} className="ruta-entregas-parada">
                      <div className="ruta-entregas-parada-orden">
                        <button
                          onClick={() => moverParada(index, -1)}
                          disabled={index === 0 || enAccion}
                          className="ruta-entregas-btn-mover"
                          title="Subir"
                        >
                          ↑
                        </button>
                        <span className="ruta-entregas-parada-numero">{index + 1}</span>
                        <button
                          onClick={() => moverParada(index, 1)}
                          disabled={index === paradas.length - 1 || enAccion}
                          className="ruta-entregas-btn-mover"
                          title="Bajar"
                        >
                          ↓
                        </button>
                      </div>

                      <div className="ruta-entregas-parada-info">
                        <div className="ruta-entregas-parada-nombre">{parada.mesa_nombre}</div>
                        <div className="ruta-entregas-parada-direccion">{parada.direccion_entrega}</div>
                        <div className="ruta-entregas-parada-datos">
                          <span>{parada.detalles?.length || 0} producto(s)</span>
                          <span>{formatearMoneda(parada.total)}</span>
                        </div>
                      </div>

                      <div className="ruta-entregas-parada-acciones">
                        <button onClick={() => abrirComoLlegar(parada.direccion_entrega)} className="ruta-entregas-btn-como-llegar">
                          📍 Cómo llegar
                        </button>
                        <button onClick={() => abrirModalCompletar(parada.id)} disabled={enAccion} className="ruta-entregas-btn-completar">
                          ✅ Marcar como entregado
                        </button>
                        <button onClick={() => cancelarParada(parada.id)} disabled={enAccion} className="ruta-entregas-btn-cancelar-parada">
                          {accionEnCurso === `${parada.id}-cancelar` ? 'Cancelando...' : '❌ Cancelar'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {modalCompletar && (
        <div className="modal" onClick={() => !completando && setModalCompletar(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>✅ Marcar como entregado</h3>
              <button onClick={() => setModalCompletar(null)} disabled={completando}>✕</button>
            </div>

            <div className="ruta-entregas-modal-completar">
              <div className="form-group">
                <label>💳 Método de pago</label>
                <select
                  value={metodoPagoCompletar}
                  onChange={(e) => setMetodoPagoCompletar(e.target.value)}
                >
                  <option value="efectivo">💵 Efectivo</option>
                  <option value="tarjeta">💳 Tarjeta</option>
                  <option value="transferencia">🏦 Transferencia</option>
                  <option value="credito">📒 Crédito</option>
                </select>
              </div>

              {metodoPagoCompletar === 'credito' && (
                <div className="form-group">
                  <label>Cliente</label>
                  <select
                    value={clienteIdCompletar}
                    onChange={(e) => setClienteIdCompletar(e.target.value)}
                  >
                    <option value="">Seleccionar cliente...</option>
                    {clientes.map(c => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button onClick={confirmarCompletar} className="btn-guardar" disabled={completando}>
                {completando ? 'Completando...' : '✅ Confirmar entrega'}
              </button>
              <button onClick={() => setModalCompletar(null)} className="btn-cancelar" disabled={completando}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RutaEntregas;
