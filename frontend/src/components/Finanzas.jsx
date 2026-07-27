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

  // Verificar permisos
  const puedeGestionar = user?.rol === 'admin' || user?.rol === 'super_admin';

  const cargarDatos = useCallback(async () => {
    try {
      setLoading(true);
      const [balanceRes, movimientosRes] = await Promise.all([
        api.get('/finanzas/balance'),
        api.get('/finanzas/movimientos')
      ]);
      setBalance(balanceRes.data);
      setMovimientos(movimientosRes.data);
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
        categoria: formData.categoria.trim() || undefined
      });
      setFormData({ tipo: 'ingreso', monto: '', concepto: '', categoria: '' });
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
                <span>- Pedidos a proveedor (automático)</span>
                <strong>{formatearMoneda(balance?.total_pedidos)}</strong>
              </div>
              <div className="desglose-item negativo">
                <span>- Egresos manuales</span>
                <strong>{formatearMoneda(balance?.egresos_manuales)}</strong>
              </div>
            </div>
          </div>

          <div className="card form-card">
            <h3>✋ Registrar movimiento manual</h3>
            <form onSubmit={handleSubmit} className="finanzas-form">
              <div className="form-row">
                <div className="form-group">
                  <label>Tipo</label>
                  <select
                    value={formData.tipo}
                    onChange={(e) => setFormData({ ...formData, tipo: e.target.value })}
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
