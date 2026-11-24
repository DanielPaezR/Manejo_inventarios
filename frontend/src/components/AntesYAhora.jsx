import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import './ResumenNegocio.css';

// "Antes y ahora": los primeros 30 días con ventas contra los últimos 30,
// métrica por métrica y con una explicación en palabras de cada cambio,
// más la serie mes a mes. Datos de /api/estadisticas/antes-y-ahora.

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const DIAS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const METODOS = { efectivo: 'Efectivo', transferencia: 'Transferencia', credito: 'Fiado', tarjeta: 'Tarjeta' };

const fechaLarga = (f) => {
  const [y, m, d] = f.split('-').map(Number);
  return `${d} de ${MESES[m - 1]}${y !== new Date().getFullYear() ? ` de ${y}` : ''}`;
};
const nombreMes = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MESES[m - 1].slice(0, 3)} ${String(y).slice(2)}`;
};
const hora12 = (h) => (h === null || h === undefined ? '—' : `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'a. m.' : 'p. m.'}`);
const cambioPct = (antes, ahora) => (antes > 0 ? Math.round(((ahora - antes) / antes) * 100) : null);

const Chip = ({ valor, invertir = false }) => {
  if (valor === null) return <span className="rn-cambio neutro">nuevo</span>;
  const neutro = Math.abs(valor) < 3;
  const bueno = invertir ? valor < 0 : valor > 0;
  return (
    <span className={`rn-cambio ${neutro ? 'neutro' : bueno ? 'bueno' : 'malo'}`}>
      {neutro ? '≈ igual' : `${valor > 0 ? '▲' : '▼'} ${Math.abs(valor)}%`}
    </span>
  );
};

// Una fila de comparación: qué se mide, antes, ahora y qué significa.
const Fila = ({ titulo, antes, ahora, cambio, invertir, explicacion }) => (
  <div className="aa-fila">
    <div className="aa-fila__titulo">{titulo}</div>
    <div className="aa-fila__valores">
      <span className="aa-antes">{antes}</span>
      <span className="aa-flecha">→</span>
      <span className="aa-ahora">{ahora}</span>
      {cambio !== undefined && <Chip valor={cambio} invertir={invertir} />}
    </div>
    {explicacion && <p className="aa-fila__explicacion">{explicacion}</p>}
  </div>
);

const Bloque = ({ icono, titulo, children }) => (
  <section className="card rn-capitulo">
    <div className="rn-capitulo__cabecera">
      <span className="rn-capitulo__numero aa-icono">{icono}</span>
      <div><h3>{titulo}</h3></div>
    </div>
    {children}
  </section>
);

const subeBaja = (cambio, sube, baja, igual) => {
  if (cambio === null) return '';
  if (Math.abs(cambio) < 3) return igual;
  return cambio > 0 ? sube : baja;
};

const AntesYAhora = () => {
  const { moduloActivo } = useModulo();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!moduloActivo) return;
    setDatos(null);
    api.get('/estadisticas/antes-y-ahora')
      .then(res => setDatos(res.data))
      .catch(err => setError(err.response?.data?.error || 'No se pudo cargar la comparación'));
  }, [moduloActivo]);

  if (error) return <div className="alert alert-warning">⚠️ {error}</div>;
  if (!datos) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Comparando tu primer mes con el último...</p>
      </div>
    );
  }

  if (!datos.suficiente) {
    const faltan = Math.max(60 - datos.dias_con_datos, 0);
    return (
      <div className="card rn-capitulo">
        <h3>🔭 Antes y ahora</h3>
        <p className="rn-texto">
          Aquí vas a poder comparar tu primer mes con el mes más reciente, para ver con números qué ha mejorado y qué no.
          {datos.dias_con_datos > 0
            ? ` Llevas ${datos.dias_con_datos} días con ventas registradas; en ${faltan} días más tendrás dos meses completos para comparar.`
            : ' Empieza a registrar ventas y en dos meses tendrás tu primera comparación.'}
        </p>
      </div>
    );
  }

  const { antes, ahora, mensual } = datos;
  const cVentasDia = cambioPct(antes.ventas_por_dia, ahora.ventas_por_dia);
  const cClientesDia = cambioPct(antes.ventas_diarias, ahora.ventas_diarias);
  const cTicket = cambioPct(antes.ticket, ahora.ticket);
  const cCompras = cambioPct(antes.compras, ahora.compras);
  const comprasPor100Antes = antes.ventas > 0 ? Math.round((antes.compras / antes.ventas) * 100) : 0;
  const comprasPor100Ahora = ahora.ventas > 0 ? Math.round((ahora.compras / ahora.ventas) * 100) : 0;
  const antesSinCostos = antes.margen === null || antes.porcentaje_sin_costo > 50;

  const topAntes = antes.top.map(t => t.nombre);
  const topAhora = ahora.top.map(t => t.nombre);
  const nuevosTop = topAhora.filter(n => !topAntes.includes(n));
  const salieronTop = topAntes.filter(n => !topAhora.includes(n));

  const metodos = Array.from(new Set([...Object.keys(antes.metodos), ...Object.keys(ahora.metodos)]));

  // Serie mes a mes: promedio por día con ventas, para no castigar meses incompletos.
  const serie = mensual.map(m => ({ ...m, por_dia: m.dias > 0 ? Math.round(m.ventas / m.dias) : 0 }));
  const maxSerie = Math.max(...serie.map(m => m.por_dia), 1);
  const mejorMes = [...serie].sort((a, b) => b.por_dia - a.por_dia)[0];

  // Titular: dos o tres frases con lo esencial.
  const frases = [];
  frases.push(cVentasDia !== null && Math.abs(cVentasDia) >= 3
    ? `Hoy vendes ${pesos(ahora.ventas_por_dia)} al día, un ${Math.abs(cVentasDia)}% ${cVentasDia > 0 ? 'más' : 'menos'} que en tu primer mes (${pesos(antes.ventas_por_dia)}).`
    : `Hoy vendes lo mismo al día que en tu primer mes: unos ${pesos(ahora.ventas_por_dia)}.`);
  if (cClientesDia !== null && cTicket !== null && Math.sign(cClientesDia) !== Math.sign(cTicket) && Math.abs(cClientesDia) >= 3 && Math.abs(cTicket) >= 3) {
    frases.push(cClientesDia > 0
      ? `Te compran más veces (${antes.ventas_diarias} → ${ahora.ventas_diarias} ventas al día), pero cada compra es más pequeña (${pesos(antes.ticket)} → ${pesos(ahora.ticket)}).`
      : `Te compran menos veces, pero cada compra es más grande (${pesos(antes.ticket)} → ${pesos(ahora.ticket)}).`);
  }
  if (antesSinCostos && ahora.margen !== null) {
    frases.push(`Y algo que antes no podías saber: hoy te quedan ${ahora.margen} de cada $100 que vendes.`);
  }

  return (
    <div className="rn">
      <div className="rn-intro">
        <h2>Antes y ahora</h2>
        <p>
          Tus primeros 30 días ({fechaLarga(antes.desde)} al {fechaLarga(antes.hasta)}) contra los últimos 30
          ({fechaLarga(ahora.desde)} al {fechaLarga(ahora.hasta)}). Mismo número de días, para que la comparación sea justa.
        </p>
      </div>

      <section className="card rn-capitulo aa-titular">
        {frases.map((f, i) => <p key={i}>{f}</p>)}
        {antes.movidos.length > 0 && (
          <p className="rn-nota">
            Solo se comparan los productos que hoy son de este módulo. En tu primer mes también vendiste{' '}
            {antes.movidos.map(m => `${pesos(m.ventas)} de productos que hoy son de ${m.modulo}`).join(' y ')}; esos no se cuentan para no confundir.
          </p>
        )}
      </section>

      <Bloque icono="💵" titulo="Ventas">
        <Fila titulo="Vendido por día" antes={pesos(antes.ventas_por_dia)} ahora={pesos(ahora.ventas_por_dia)} cambio={cVentasDia}
          explicacion={subeBaja(cVentasDia, 'Entra más plata por ventas cada día.', 'Entra menos plata por ventas cada día. Mira abajo si es porque vienen menos clientes o porque compran menos cada vez.', 'Las ventas diarias se mantienen estables.')} />
        <Fila titulo="Ventas al día (clientes atendidos)" antes={antes.ventas_diarias} ahora={ahora.ventas_diarias} cambio={cClientesDia}
          explicacion={subeBaja(cClientesDia, 'Te visitan más veces: el negocio está atrayendo más movimiento.', 'Te visitan menos veces que al principio.', 'El número de clientes al día se mantiene.')} />
        <Fila titulo="Cada cliente gasta en promedio" antes={pesos(antes.ticket)} ahora={pesos(ahora.ticket)} cambio={cTicket}
          explicacion={subeBaja(cTicket, 'Cada compra es más grande: los clientes se llevan más cosas o más caras.', 'Cada compra es más pequeña. Ofrecer combos o productos complementarios puede subirla.', 'El valor de cada compra se mantiene.')} />
        <Fila titulo="Días con ventas" antes={`${antes.dias_con_ventas} de 30`} ahora={`${ahora.dias_con_ventas} de 30`} />
      </Bloque>

      <Bloque icono="📈" titulo="Ganancia">
        {antesSinCostos ? (
          <>
            <Fila titulo="Te quedan de cada $100 vendidos" antes="Sin datos" ahora={ahora.margen !== null ? pesos(ahora.margen) : 'Sin datos'} />
            <Fila titulo="Ganancia del mes" antes="Sin datos" ahora={pesos(ahora.ganancia)}
              explicacion={`En tu primer mes casi ningún producto tenía costo registrado (${antes.porcentaje_sin_costo}% de lo vendido), así que no había forma de saber cuánto ganabas. Hoy solo el ${ahora.porcentaje_sin_costo}% está sin costo: eso ya es una mejora en cómo manejas el negocio.`} />
          </>
        ) : (
          <>
            <Fila titulo="Te quedan de cada $100 vendidos" antes={pesos(antes.margen)} ahora={pesos(ahora.margen)} cambio={cambioPct(antes.margen, ahora.margen)}
              explicacion={subeBaja(cambioPct(antes.margen, ahora.margen), 'Tu margen mejoró: vendes con mejores precios o compras más barato.', 'Tu margen bajó: revisa si tus proveedores subieron precios y no ajustaste los tuyos.', 'Tu margen se mantiene.')} />
            <Fila titulo="Ganancia en 30 días" antes={pesos(antes.ganancia)} ahora={pesos(ahora.ganancia)} cambio={cambioPct(antes.ganancia, ahora.ganancia)} />
          </>
        )}
      </Bloque>

      <Bloque icono="📦" titulo="Productos">
        <Fila titulo="Productos distintos vendidos" antes={antes.productos_distintos} ahora={ahora.productos_distintos} cambio={cambioPct(antes.productos_distintos, ahora.productos_distintos)}
          explicacion={subeBaja(cambioPct(antes.productos_distintos, ahora.productos_distintos), 'Hoy rotan más productos: el surtido creció o los clientes prueban más cosas.', 'Hoy rotan menos productos: puede que algunos ya no se traigan o no se vendan.', 'La variedad que se vende es parecida.')} />
        <div className="aa-tops">
          <div>
            <h4>Lo que más vendías</h4>
            <ol>{antes.top.map(t => <li key={t.nombre} className={salieronTop.includes(t.nombre) ? 'aa-salio' : ''}>{t.nombre} <small>{pesos(t.ventas)}</small></li>)}</ol>
          </div>
          <div>
            <h4>Lo que más vendes hoy</h4>
            <ol>{ahora.top.map(t => <li key={t.nombre} className={nuevosTop.includes(t.nombre) ? 'aa-nuevo' : ''}>{t.nombre} <small>{pesos(t.ventas)}</small></li>)}</ol>
          </div>
        </div>
        {nuevosTop.length > 0 && (
          <p className="rn-nota">Nuevos en tu top: {nuevosTop.join(', ')}.{salieronTop.length > 0 && ` Salieron: ${salieronTop.join(', ')}.`}</p>
        )}
      </Bloque>

      <Bloque icono="💳" titulo="Cómo te pagan">
        {metodos.map(m => (
          <Fila key={m} titulo={METODOS[m] || m} antes={`${antes.metodos[m] || 0}%`} ahora={`${ahora.metodos[m] || 0}%`} />
        ))}
        {(ahora.metodos.transferencia || 0) > (antes.metodos.transferencia || 0) + 3 && (
          <p className="rn-nota">Cada vez más clientes pagan por transferencia; asegúrate de revisar tu Nequi en el cierre.</p>
        )}
        {(ahora.metodos.credito || 0) > (antes.metodos.credito || 0) + 3 && (
          <p className="rn-nota">El fiado pesa más que al principio: vale la pena estar pendiente de los cobros.</p>
        )}
      </Bloque>

      <Bloque icono="🛒" titulo="Compras a proveedores">
        <Fila titulo="Compras en 30 días" antes={pesos(antes.compras)} ahora={pesos(ahora.compras)} cambio={cCompras} invertir
          explicacion={antes.pedidos_proveedor < 3
            ? 'Al principio casi no registrabas pedidos en el sistema, así que esta comparación es aproximada.'
            : subeBaja(cCompras, 'Compras más que antes.', 'Compras menos que antes.', 'Compras parecido a antes.')} />
        <Fila titulo="De cada $100 vendidos, se van en compras" antes={pesos(comprasPor100Antes)} ahora={pesos(comprasPor100Ahora)} />
      </Bloque>

      <Bloque icono="🕐" titulo="Tus clientes">
        <Fila titulo="Mejor día de la semana" antes={DIAS[antes.mejor_dia] || '—'} ahora={DIAS[ahora.mejor_dia] || '—'} />
        <Fila titulo="Hora con más ventas" antes={hora12(antes.hora_pico)} ahora={hora12(ahora.hora_pico)} />
        <Fila titulo="Pedidos por el menú en línea" antes={antes.pedidos_cliente} ahora={ahora.pedidos_cliente} />
      </Bloque>

      <Bloque icono="📅" titulo="Mes a mes">
        <p className="rn-texto">
          Lo que vendes en promedio por cada día con ventas. Así los meses que no están completos se pueden comparar con los demás.
          {mejorMes && ` Tu mejor mes hasta ahora fue ${nombreMes(mejorMes.mes)}.`}
        </p>
        <div className="aa-meses">
          {serie.map(m => (
            <div key={m.mes} className="aa-mes">
              <span className="aa-mes__nombre">{nombreMes(m.mes)}</span>
              <div className="rn-barra"><div style={{ width: `${(m.por_dia / maxSerie) * 100}%` }} /></div>
              <span className="aa-mes__valor">{pesos(m.por_dia)}<small>/día</small></span>
              <span className="aa-mes__extra">{m.dias} días · {pesos(m.ventas)}{m.ganancia > 0 ? ` · ganancia ${pesos(m.ganancia)}` : ''}</span>
            </div>
          ))}
        </div>
      </Bloque>
    </div>
  );
};

export default AntesYAhora;
