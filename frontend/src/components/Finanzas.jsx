import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import './Finanzas.css';

const Finanzas = ({ user }) => {
  const [balance, setBalance] = useState(null);
  const [movimientos, setMovimientos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [formData, setFormData] = useState({ tipo: 'ingreso', monto: '', concepto: '', categoria: '' });
  const [pedidosSinRegistrar, setPedidosSinRegistrar] = useState([]);
  const [pedidoSeleccionadoId, setPedidoSeleccionadoId] = useState('');
  // Categorías de gasto: clasificación propia para egresos, independiente
  // del campo de texto libre `categoria` (ese sigue igual, incluye
  // 'abono_credito').
  const [categoriasGasto, setCategoriasGasto] = useState([]);
  const [categoriaGastoId, setCategoriaGastoId] = useState('');
  const [mostrarGestionCategorias, setMostrarGestionCategorias] = useState(false);
  const [nuevaCategoriaNombre, setNuevaCategoriaNombre] = useState('');
  const [guardandoCategoria, setGuardandoCategoria] = useState(false);
  const [categoriaEditandoId, setCategoriaEditandoId] = useState(null);
  const [categoriaEditandoNombre, setCategoriaEditandoNombre] = useState('');

  // Verificar permisos
  const puedeGestionar = user?.rol === 'admin' || user?.rol === 'super_admin';

  const cargarDatos = useCallback(async () => {
    try {
      setLoading(true);
      const [balanceRes, movimientosRes, pedidosRes, categoriasRes] = await Promise.all([
        api.get('/finanzas/balance'),
        api.get('/finanzas/movimientos'),
        api.get('/finanzas/pedidos-sin-registrar'),
        api.get('/categorias-gasto')
      ]);
      setBalance(balanceRes.data);
      setMovimientos(movimientosRes.data);
      setPedidosSinRegistrar(pedidosRes.data);
      setCategoriasGasto(categoriasRes.data);
    } catch (error) {
      console.error('Error cargando finanzas:', error);
      setMensaje('❌ Error al cargar la información financiera');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (puedeGestionar) {
      cargarDatos();
    }
  }, [puedeGestionar, cargarDatos]);

  // El saldo inicial ya está registrado si la suma es mayor a 0 (el
  // constraint monto > 0 en la tabla garantiza que, si existe, es positivo).
  const tieneSaldoInicial = Number(balance?.saldo_inicial || 0) > 0;

  // Cambiar de tipo: si deja de ser 'egreso', descarta el pedido
  // seleccionado para no arrastrar un pedido_id obsoleto a un ingreso o
  // saldo inicial.
  const handleTipoChange = (nuevoTipo) => {
    setFormData(prev => ({ ...prev, tipo: nuevoTipo }));
    if (nuevoTipo !== 'egreso') {
      setPedidoSeleccionadoId('');
      setCategoriaGastoId('');
    }
  };

  // Autocompletar concepto/monto con los datos del pedido; siguen siendo
  // editables por si el precio realmente pagado fue distinto.
  const handleSeleccionarPedido = (pedidoId) => {
    setPedidoSeleccionadoId(pedidoId);
    if (!pedidoId) return;

    const pedido = pedidosSinRegistrar.find(p => p.id === parseInt(pedidoId));
    if (!pedido) return;

    setFormData(prev => ({
      ...prev,
      concepto: `Pago pedido a ${pedido.proveedor_nombre} #${pedido.id}`,
      monto: pedido.total
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.monto || Number(formData.monto) <= 0) {
      setMensaje('⚠️ Ingresa un monto válido');
      return;
    }
    if (!formData.concepto.trim()) {
      setMensaje('⚠️ El concepto es requerido');
      return;
    }

    try {
      setGuardando(true);
      await api.post('/finanzas/movimientos', {
        tipo: formData.tipo,
        monto: Number(formData.monto),
        concepto: formData.concepto.trim(),
        categoria: formData.categoria.trim() || undefined,
        pedido_id: formData.tipo === 'egreso' && pedidoSeleccionadoId ? pedidoSeleccionadoId : undefined,
        categoria_gasto_id: formData.tipo === 'egreso' && categoriaGastoId ? categoriaGastoId : undefined
      });
      setFormData({ tipo: 'ingreso', monto: '', concepto: '', categoria: '' });
      setPedidoSeleccionadoId('');
      setCategoriaGastoId('');
      setMensaje('✅ Movimiento registrado correctamente');
      cargarDatos();
      setTimeout(() => setMensaje(''), 3000);
    } catch (error) {
      console.error('Error registrando movimiento:', error);
      setMensaje(error.response?.data?.error || '❌ Error al registrar el movimiento');
    } finally {
      setGuardando(false);
    }
  };

  const handleAgregarCategoria = async (e) => {
    e.preventDefault();
    if (!nuevaCategoriaNombre.trim()) return;

    try {
      setGuardandoCategoria(true);
      await api.post('/categorias-gasto', { nombre: nuevaCategoriaNombre.trim() });
      setNuevaCategoriaNombre('');
      const res = await api.get('/categorias-gasto');
      setCategoriasGasto(res.data);
    } catch (error) {
      console.error('Error creando categoría de gasto:', error);
      setMensaje(error.response?.data?.error || '❌ Error al crear la categoría');
    } finally {
      setGuardandoCategoria(false);
    }
  };

  const iniciarEdicionCategoria = (categoria) => {
    setCategoriaEditandoId(categoria.id);
    setCategoriaEditandoNombre(categoria.nombre);
  };

  const handleRenombrarCategoria = async (id) => {
    if (!categoriaEditandoNombre.trim()) return;

    try {
      await api.put(`/categorias-gasto/${id}`, { nombre: categoriaEditandoNombre.trim() });
      setCategoriaEditandoId(null);
      setCategoriaEditandoNombre('');
      const res = await api.get('/categorias-gasto');
      setCategoriasGasto(res.data);
    } catch (error) {
      console.error('Error renombrando categoría de gasto:', error);
      setMensaje(error.response?.data?.error || '❌ Error al renombrar la categoría');
    }
  };

  const handleEliminarCategoria = async (id) => {
    if (!confirm('¿Eliminar esta categoría de gasto? Los movimientos que ya la usan la conservan.')) return;

    try {
      await api.delete(`/categorias-gasto/${id}`);
      setCategoriasGasto(prev => prev.filter(c => c.id !== id));
      if (categoriaGastoId === String(id)) setCategoriaGastoId('');
    } catch (error) {
      console.error('Error eliminando categoría de gasto:', error);
      setMensaje('❌ Error al eliminar la categoría');
    }
  };

  const formatearMoneda = (valor) => `$${Number(valor || 0).toLocaleString('es-CO')}`;

  const origenInfo = (origen) => {
    if (origen === 'venta') return { icono: '🛒', label: 'Venta' };
    if (origen === 'pedido') return { icono: '📦', label: 'Pedido' };
    return { icono: '✋', label: 'Manual' };
  };

  if (!puedeGestionar) {
    return (
      <div className="finanzas-container">
        <div className="alert-warning">
          ⚠️ No tienes permisos para ver Finanzas. Solo administradores pueden acceder a esta sección.
        </div>
      </div>
    );
  }

  return (
    <div className="finanzas-container">
      <div className="finanzas-header">
        <h2>💰 Finanzas</h2>
      </div>

      {mensaje && (
        <div className={`mensaje-flotante ${mensaje.includes('✅') ? 'exito' : 'error'}`}>
          {mensaje}
          <button onClick={() => setMensaje('')} className="btn-cerrar-mensaje">✕</button>
        </div>
      )}

      {loading && !balance ? (
        <div className="loading">Cargando información financiera...</div>
      ) : (
        <>
          <div className="card balance-card">
            <span className="balance-label">Balance actual</span>
            <span className={`balance-valor ${Number(balance?.balance_actual) < 0 ? 'negativo' : ''}`}>
              {formatearMoneda(balance?.balance_actual)}
            </span>
          </div>

          <div className="card desglose-card">
            <h3>📊 Desglose</h3>
            <div className="desglose-lista">
              <div className="desglose-item">
                <span>Saldo inicial</span>
                <strong>{formatearMoneda(balance?.saldo_inicial)}</strong>
              </div>
              <div className="desglose-item positivo">
                <span>+ Ventas (automático)</span>
                <strong>{formatearMoneda(balance?.total_ventas)}</strong>
              </div>
              <div className="desglose-item positivo">
                <span>+ Ingresos manuales</span>
                <strong>{formatearMoneda(balance?.ingresos_manuales)}</strong>
              </div>
              <div className="desglose-item negativo">
                <span>- Pedidos a proveedor (pagados)</span>
                <strong>{formatearMoneda(balance?.total_pedidos)}</strong>
              </div>
              <div className="desglose-item negativo">
                <span>- Egresos manuales</span>
                <strong>{formatearMoneda(balance?.egresos_manuales)}</strong>
              </div>
            </div>
          </div>

          <div className="card categorias-gasto-card">
            <div className="categorias-gasto-header" onClick={() => setMostrarGestionCategorias(prev => !prev)}>
              <h3>🗂️ Categorías de gasto</h3>
              <span className="categorias-gasto-toggle">{mostrarGestionCategorias ? '▲' : '▼'}</span>
            </div>

            {mostrarGestionCategorias && (
              <div className="categorias-gasto-body">
                {categoriasGasto.length === 0 ? (
                  <p className="sin-datos">Aún no hay categorías de gasto</p>
                ) : (
                  <div className="categorias-gasto-lista">
                    {categoriasGasto.map(cat => (
                      <div key={cat.id} className="categoria-gasto-item">
                        {categoriaEditandoId === cat.id ? (
                          <>
                            <input
                              type="text"
                              value={categoriaEditandoNombre}
                              onChange={(e) => setCategoriaEditandoNombre(e.target.value)}
                              autoFocus
                            />
                            <button onClick={() => handleRenombrarCategoria(cat.id)} className="btn-icono" title="Guardar">
                              ✅
                            </button>
                            <button onClick={() => setCategoriaEditandoId(null)} className="btn-icono" title="Cancelar">
                              ✕
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="categoria-gasto-nombre">{cat.nombre}</span>
                            <button onClick={() => iniciarEdicionCategoria(cat)} className="btn-icono" title="Renombrar">
                              ✏️
                            </button>
                            <button onClick={() => handleEliminarCategoria(cat.id)} className="btn-icono" title="Eliminar">
                              🗑️
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <form onSubmit={handleAgregarCategoria} className="categoria-gasto-form">
                  <input
                    type="text"
                    value={nuevaCategoriaNombre}
                    onChange={(e) => setNuevaCategoriaNombre(e.target.value)}
                    placeholder="Ej: Servicios públicos, arriendo..."
                  />
                  <button type="submit" className="btn-guardar" disabled={guardandoCategoria}>
                    {guardandoCategoria ? 'Agregando...' : '+ Agregar'}
                  </button>
                </form>
              </div>
            )}
          </div>

          <div className="card form-card">
            <h3>✋ Registrar movimiento manual</h3>
            <form onSubmit={handleSubmit} className="finanzas-form">
              <div className="form-row">
                <div className="form-group">
                  <label>Tipo</label>
                  <select
                    value={formData.tipo}
                    onChange={(e) => handleTipoChange(e.target.value)}
                  >
                    {!tieneSaldoInicial && <option value="saldo_inicial">Saldo inicial</option>}
                    <option value="ingreso">Ingreso</option>
                    <option value="egreso">Egreso</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Monto *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={formData.monto}
                    onChange={(e) => setFormData({ ...formData, monto: e.target.value })}
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>

              {formData.tipo === 'egreso' && (
                <div className="form-group">
                  <label>Vincular a un pedido (opcional)</label>
                  <select
                    value={pedidoSeleccionadoId}
                    onChange={(e) => handleSeleccionarPedido(e.target.value)}
                  >
                    <option value="">Ninguno</option>
                    {pedidosSinRegistrar.map(pedido => (
                      <option key={pedido.id} value={pedido.id}>
                        {pedido.proveedor_nombre} — {formatearMoneda(pedido.total)} — {new Date(pedido.fecha_pedido).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {formData.tipo === 'egreso' && (
                <div className="form-group">
                  <label>Categoría de gasto (opcional)</label>
                  <select
                    value={categoriaGastoId}
                    onChange={(e) => setCategoriaGastoId(e.target.value)}
                  >
                    <option value="">Ninguna</option>
                    {categoriasGasto.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.nombre}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label>Concepto *</label>
                <input
                  type="text"
                  value={formData.concepto}
                  onChange={(e) => setFormData({ ...formData, concepto: e.target.value })}
                  placeholder="Ej: Aporte de capital, pago de arriendo..."
                  required
                />
              </div>
              <div className="form-group">
                <label>Categoría (opcional)</label>
                <input
                  type="text"
                  value={formData.categoria}
                  onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                  placeholder="Ej: Servicios, arriendo, capital..."
                />
              </div>
              <button type="submit" className="btn-guardar" disabled={guardando}>
                {guardando ? 'Guardando...' : '✅ Registrar movimiento'}
              </button>
            </form>
          </div>

          <div className="card movimientos-card">
            <h3>📋 Movimientos recientes</h3>
            {movimientos.length === 0 ? (
              <p className="sin-datos">Aún no hay movimientos registrados</p>
            ) : (
              <div className="movimientos-lista">
                {movimientos.map(mov => {
                  const { icono, label } = origenInfo(mov.origen);
                  const esIngreso = mov.tipo === 'ingreso' || mov.tipo === 'saldo_inicial';
                  return (
                    <div key={mov.id} className="movimiento-item">
                      <div className="movimiento-info">
                        <span className="movimiento-origen-badge">{icono} {label}</span>
                        <span className="movimiento-concepto">{mov.concepto}</span>
                        {mov.categoria && <span className="movimiento-categoria">{mov.categoria}</span>}
                        {mov.categoria_gasto_nombre && (
                          <span className="movimiento-categoria-gasto">🗂️ {mov.categoria_gasto_nombre}</span>
                        )}
                        <span className="movimiento-fecha">{new Date(mov.fecha).toLocaleString()}</span>
                      </div>
                      <span className={`movimiento-monto ${esIngreso ? 'positivo' : 'negativo'}`}>
                        {esIngreso ? '+' : '-'} {formatearMoneda(mov.monto)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default Finanzas;
