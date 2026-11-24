import React, { useState, useEffect } from 'react';
import api from '../services/api';
import './InformeMes.css';

// "Tu mes en una página": informe de un mes contra el anterior, pensado para
// imprimir o guardar en PDF (Imprimir → Guardar como PDF).

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const METODOS = { efectivo: 'Efectivo', transferencia: 'Transferencia', credito: 'Fiado', tarjeta: 'Tarjeta' };
const nombreMes = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MESES[m - 1]} ${y}`;
};
const hora12 = (h) => (h === null || h === undefined ? '—' : `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'a. m.' : 'p. m.'}`);
const cambio = (antes, ahora) => (antes > 0 ? Math.round(((ahora - antes) / antes) * 100) : null);

const ultimosMeses = () => {
  const lista = [];
  const d = new Date(Date.now() - 5 * 3600 * 1000);
  d.setUTCDate(1);
  for (let i = 0; i < 12; i++) {
    lista.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return lista;
};

const Comparar = ({ titulo, actual, anterior, formato = pesos, invertir = false }) => {
  const c = cambio(anterior, actual);
  const clase = c === null || Math.abs(c) < 3 ? '' : (invertir ? c < 0 : c > 0) ? 'sube' : 'baja';
  return (
    <div className="im-dato">
      <small>{titulo}</small>
      <strong>{formato(actual)}</strong>
      <span className={clase}>
        {c === null ? 'sin datos del mes anterior' : `${c > 0 ? '▲' : c < 0 ? '▼' : '='} ${Math.abs(c)}% vs. ${formato(anterior)}`}
      </span>
    </div>
  );
};

const InformeMes = ({ negocio, onCerrar }) => {
  const meses = ultimosMeses();
  const [mes, setMes] = useState(meses[0]);
  const [datos, setDatos] = useState(null);

  useEffect(() => {
    setDatos(null);
    api.get('/estadisticas/informe-mes', { params: { mes } }).then(r => setDatos(r.data)).catch(() => setDatos({ error: true }));
  }, [mes]);

  const a = datos?.actual;
  const b = datos?.anterior;

  return (
    <div className="im-overlay" onClick={onCerrar}>
      <div className="im-ventana" onClick={(e) => e.stopPropagation()}>
        <div className="im-barra no-imprimir">
          <select value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mes del informe">
            {meses.map(m => <option key={m} value={m}>{nombreMes(m)}</option>)}
          </select>
          <button type="button" className="mn-btn" onClick={() => window.print()} disabled={!a}>🖨️ Imprimir o guardar PDF</button>
          <button type="button" className="im-cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>

        <div className="im-hoja">
          {!datos ? (
            <p className="im-cargando">Armando el informe...</p>
          ) : datos.error ? (
            <p className="im-cargando">No se pudo cargar el informe.</p>
          ) : (
            <>
              <header className="im-encabezado">
                <div>
                  <small>Informe mensual</small>
                  <h1>{negocio}</h1>
                </div>
                <div className="im-mes">
                  <strong>{nombreMes(datos.mes)}</strong>
                  {!datos.completo && <small>Mes en curso (hasta hoy)</small>}
                </div>
              </header>

              {a.ventas === 0 ? (
                <p className="im-cargando">No hay ventas registradas en este mes.</p>
              ) : (
                <>
                  <h2>Ventas</h2>
                  <div className="im-grid">
                    <Comparar titulo="Vendido en el mes" actual={a.ventas} anterior={b.ventas} />
                    <Comparar titulo="Promedio por día" actual={a.ventas_por_dia} anterior={b.ventas_por_dia} />
                    <Comparar titulo="Número de ventas" actual={a.num_ventas} anterior={b.num_ventas} formato={(n) => Math.round(n).toLocaleString('es-CO')} />
                    <Comparar titulo="Cada cliente gastó" actual={a.ticket} anterior={b.ticket} />
                  </div>

                  <h2>Ganancia</h2>
                  <div className="im-grid">
                    <Comparar titulo="Ganancia estimada" actual={a.ganancia} anterior={b.ganancia} />
                    <div className="im-dato">
                      <small>De cada $100 vendidos te quedan</small>
                      <strong>{a.margen !== null ? pesos(a.margen) : '—'}</strong>
                      <span>{a.porcentaje_sin_costo > 0 ? `${a.porcentaje_sin_costo}% de lo vendido sin costo registrado` : 'Todos los productos con costo'}</span>
                    </div>
                    <Comparar titulo="Compras a proveedores" actual={a.compras} anterior={b.compras} invertir />
                    <div className="im-dato">
                      <small>De cada $100 vendidos, en compras</small>
                      <strong>{a.ventas > 0 ? pesos((a.compras / a.ventas) * 100) : '—'}</strong>
                      <span>{a.pedidos_proveedor} pedidos recibidos</span>
                    </div>
                  </div>

                  <div className="im-columnas">
                    <div>
                      <h2>Lo que más se vendió</h2>
                      <ol className="im-lista">
                        {a.top.map(t => <li key={t.nombre}><span>{t.nombre}</span><b>{pesos(t.ventas)}</b></li>)}
                      </ol>
                    </div>
                    <div>
                      <h2>Proveedores</h2>
                      {datos.proveedores.length === 0 ? <p className="im-nota">Sin pedidos recibidos.</p> : (
                        <ul className="im-lista">
                          {datos.proveedores.map(p => <li key={p.nombre}><span>{p.nombre} ({p.pedidos})</span><b>{pesos(p.total)}</b></li>)}
                        </ul>
                      )}
                    </div>
                  </div>

                  <div className="im-columnas">
                    <div>
                      <h2>Cómo te pagaron</h2>
                      <ul className="im-lista">
                        {Object.entries(a.metodos).sort((x, y) => y[1] - x[1]).map(([m, pct]) => (
                          <li key={m}><span>{METODOS[m] || m}</span><b>{pct}%</b></li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h2>Tus clientes</h2>
                      <ul className="im-lista">
                        <li><span>Mejor día</span><b>{DIAS[a.mejor_dia] || '—'}</b></li>
                        <li><span>Hora con más ventas</span><b>{hora12(a.hora_pico)}</b></li>
                        <li><span>Días con ventas</span><b>{a.dias_con_ventas} de {a.dias}</b></li>
                        <li><span>Pedidos por el menú en línea</span><b>{a.pedidos_cliente}</b></li>
                      </ul>
                    </div>
                  </div>
                  <p className="im-nota">
                    Comparado con {datos.completo ? nombreMes(b.desde.slice(0, 7)) : `los primeros ${b.dias} días de ${nombreMes(b.desde.slice(0, 7))}`}. Solo cuentan los productos que hoy son de este módulo, sin consumo propio ni ajustes.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default InformeMes;
