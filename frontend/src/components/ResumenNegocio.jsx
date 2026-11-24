import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import './ResumenNegocio.css';

// Pestaña "Resumen" de Estadísticas: el negocio contado como una historia
// corta, en capítulos, para el dueño que saca un rato a mirar cómo va.
// Va de lo general (¿cómo me fue?) a lo que pide atención y termina en
// decisiones concretas. Los datos vienen de /api/estadisticas/resumen.

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const DIAS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const DIAS_CORTOS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const hora12 = (h) => {
  const sufijo = h < 12 ? 'a. m.' : 'p. m.';
  const valor = h % 12 === 0 ? 12 : h % 12;
  return `${valor} ${sufijo}`;
};

const variacion = (actual, base) => (base > 0 ? Math.round(((actual - base) / base) * 100) : null);

const fechaCorta = (f) => new Date(f).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });

const Cambio = ({ valor, invertir = false }) => {
  if (valor === null || valor === undefined) return null;
  const bueno = invertir ? valor < 0 : valor > 0;
  const neutro = Math.abs(valor) < 3;
  return (
    <span className={`rn-cambio ${neutro ? 'neutro' : bueno ? 'bueno' : 'malo'}`}>
      {valor > 0 ? '▲' : valor < 0 ? '▼' : '='} {Math.abs(valor)}%
    </span>
  );
};

const Capitulo = ({ id, numero, titulo, pregunta, children }) => (
  <section id={id} className="card rn-capitulo">
    <div className="rn-capitulo__cabecera">
      <span className="rn-capitulo__numero">{numero}</span>
      <div>
        <small>{pregunta}</small>
        <h3>{titulo}</h3>
      </div>
    </div>
    {children}
  </section>
);

const ResumenNegocio = ({ onIrAVista }) => {
  const { moduloActivo } = useModulo();
  const navigate = useNavigate();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!moduloActivo) return;
    setDatos(null);
    setError('');
    api.get('/estadisticas/resumen')
      .then(res => setDatos(res.data))
      .catch(err => setError(err.response?.data?.error || 'No se pudo cargar el resumen'));
  }, [moduloActivo]);

  const historia = useMemo(() => {
    if (!datos) return null;
    const { ventas, proveedores, atencion, productos, tiempo } = datos;

    const cambioVentas = variacion(ventas.ultimos_7, ventas.semana_promedio);
    const ticket7 = ventas.num_ventas_7 > 0 ? ventas.ultimos_7 / ventas.num_ventas_7 : 0;
    const ticketProm = ventas.num_ventas_semana_promedio > 0 ? ventas.semana_promedio / ventas.num_ventas_semana_promedio : 0;

    // Compras contra lo que costó lo vendido: si se compra bastante más de
    // lo que se repone, la plata se está quedando en inventario (o perdiendo).
    const comprasPor100 = proveedores.ventas_semanal > 0
      ? Math.round((proveedores.gasto_semanal / proveedores.ventas_semanal) * 100) : null;
    const costoPor100 = ventas.margen_28 !== null ? 100 - ventas.margen_28 : null;
    const comprandoDeMas = comprasPor100 !== null && costoPor100 !== null && comprasPor100 > costoPor100 + 5;
    const excesoSemanal = comprandoDeMas
      ? Math.round(proveedores.gasto_semanal - proveedores.ventas_semanal * (costoPor100 / 100)) : 0;

    const diasOrdenados = [...tiempo.dias].sort((a, b) => b.promedio - a.promedio);
    const mejorDia = diasOrdenados[0];
    const peorDia = diasOrdenados[diasOrdenados.length - 1];

    // Ventana de 3 horas seguidas con más ventas.
    let pico = null;
    const porHora = Object.fromEntries(tiempo.horas.map(h => [h.hora, h.total]));
    const totalHoras = tiempo.horas.reduce((s, h) => s + h.total, 0);
    for (let h = 5; h <= 21; h++) {
      const suma = (porHora[h] || 0) + (porHora[h + 1] || 0) + (porHora[h + 2] || 0);
      if (!pico || suma > pico.suma) pico = { desde: h, hasta: h + 3, suma };
    }

    // Lo que pide atención, de más a menos urgente.
    const alertas = [];
    if (atencion.por_agotarse.length > 0) alertas.push('agotarse');
    if (comprandoDeMas) alertas.push('compras');
    if (atencion.fiado.quietos.length > 0) alertas.push('fiado');
    if (atencion.plata_quieta.total > 0) alertas.push('quieta');
    if (atencion.sin_costo.cantidad > 0) alertas.push('sincosto');

    // Decisiones de la semana: máximo tres, concretas.
    const decisiones = [];
    const agotados = atencion.por_agotarse.filter(p => p.stock_actual <= 0);
    if (atencion.por_agotarse.length > 0) {
      decisiones.push({
        texto: `Pide ${atencion.por_agotarse.length === 1 ? atencion.por_agotarse[0].nombre : `${atencion.por_agotarse.length} productos que se están acabando`}${agotados.length > 0 ? ` (${agotados.length} ya ${agotados.length === 1 ? 'está agotado' : 'están agotados'})` : ''}.`,
        accion: 'Ir a Mis pedidos', ir: () => navigate('/pedidos')
      });
    }
    if (productos.margen_bajo.length > 0) {
      const p = productos.margen_bajo[0];
      decisiones.push({
        texto: `Revisa el precio de ${p.nombre.trim()}: lo vendes seguido pero solo te deja el ${p.margen}%.`,
        accion: 'Ir a Productos', ir: () => navigate('/productos')
      });
    }
    if (comprandoDeMas) {
      decisiones.push({
        texto: `Ajusta las cantidades de tus pedidos: estás comprando unos ${pesos(excesoSemanal)} por semana más de lo que vendes.`,
        accion: 'Ver proveedores', ir: () => document.getElementById('rn-proveedores')?.scrollIntoView({ behavior: 'smooth' })
      });
    }
    if (atencion.fiado.quietos.length > 0) {
      const c = atencion.fiado.quietos[0];
      decisiones.push({
        texto: `Cóbrale a ${c.nombre}: debe ${pesos(c.deuda)} y su cuenta no se mueve hace ${c.dias_sin_movimiento ?? 'más de 30'} días.`,
        accion: 'Ir a Clientes', ir: () => navigate('/clientes')
      });
    }
    if (atencion.plata_quieta.total > 0) {
      decisiones.push({
        texto: `Haz una promoción con lo que no se mueve, como ${atencion.plata_quieta.productos.slice(0, 2).map(p => p.nombre.trim()).join(' y ')}: ahí tienes ${pesos(atencion.plata_quieta.total)} quietos.`,
        accion: 'Ir a Productos', ir: () => navigate('/productos')
      });
    }
    if (atencion.sin_costo.cantidad > 0) {
      decisiones.push({
        texto: `Registra el costo de ${atencion.sin_costo.cantidad} ${atencion.sin_costo.cantidad === 1 ? 'producto' : 'productos'} para que tu ganancia sea exacta.`,
        accion: 'Ir a Inventario', ir: () => navigate('/inventario')
      });
    }

    return {
      cambioVentas, ticket7, ticketProm, comprasPor100, costoPor100, comprandoDeMas, excesoSemanal,
      mejorDia, peorDia, pico, totalHoras, alertas, decisiones: decisiones.slice(0, 3)
    };
  }, [datos, navigate]);

  if (error) return <div className="alert alert-warning">⚠️ {error}</div>;
  if (!datos || !historia) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Armando el resumen de tu negocio...</p>
      </div>
    );
  }

  const { ventas, proveedores, atencion, productos, tiempo } = datos;
  const h = historia;
  const maxDia = Math.max(...tiempo.dias.map(d => d.promedio), 1);
  const maxGanancia = Math.max(...productos.mas_ganancia.map(p => p.ganancia), 1);
  const maxProveedor = Math.max(...proveedores.lista.map(p => p.gasto_semanal), 1);
  const ir = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const capitulos = [
    { id: 'rn-como-va', titulo: 'Cómo te fue' },
    { id: 'rn-atencion', titulo: 'Pon atención', badge: h.alertas.length },
    { id: 'rn-proveedores', titulo: 'Proveedores' },
    { id: 'rn-ganancia', titulo: 'Qué te deja plata' },
    { id: 'rn-tiempo', titulo: 'Cuándo te compran' },
    { id: 'rn-decisiones', titulo: 'Para decidir' }
  ];

  return (
    <div className="rn">
      <div className="rn-intro">
        <h2>Así va {moduloActivo?.nombre || 'tu negocio'}</h2>
        <p>Un recorrido corto por tu negocio, de lo general a lo que puedes decidir hoy. Toca un capítulo para ir directo.</p>
        <nav className="rn-indice">
          {capitulos.map((c, i) => (
            <button key={c.id} type="button" onClick={() => ir(c.id)}>
              <span>{i + 1}</span> {c.titulo}
              {c.badge > 0 && <em>{c.badge}</em>}
            </button>
          ))}
        </nav>
      </div>

      {/* 1. Cómo te fue */}
      <Capitulo id="rn-como-va" numero={1} pregunta="¿Cómo te fue esta semana?" titulo={
        h.cambioVentas === null
          ? `En los últimos 7 días vendiste ${pesos(ventas.ultimos_7)}.`
          : `En los últimos 7 días vendiste ${pesos(ventas.ultimos_7)}, ${Math.abs(h.cambioVentas) < 3 ? 'igual que' : h.cambioVentas > 0 ? `un ${h.cambioVentas}% más que` : `un ${Math.abs(h.cambioVentas)}% menos que`} una semana normal.`
      }>
        <div className="rn-metricas">
          <div className="rn-metrica">
            <small>Vendido (7 días)</small>
            <strong>{pesos(ventas.ultimos_7)}</strong>
            <span>Semana normal: {pesos(ventas.semana_promedio)} <Cambio valor={h.cambioVentas} /></span>
          </div>
          <div className="rn-metrica">
            <small>Número de ventas</small>
            <strong>{ventas.num_ventas_7}</strong>
            <span>Normal: {ventas.num_ventas_semana_promedio} <Cambio valor={variacion(ventas.num_ventas_7, ventas.num_ventas_semana_promedio)} /></span>
          </div>
          <div className="rn-metrica">
            <small>Cada cliente gasta en promedio</small>
            <strong>{pesos(h.ticket7)}</strong>
            <span>Normal: {pesos(h.ticketProm)} <Cambio valor={variacion(h.ticket7, h.ticketProm)} /></span>
          </div>
          <div className="rn-metrica rn-metrica--destacada">
            <small>Ganancia estimada (4 semanas)</small>
            <strong>{pesos(ventas.ganancia_28)}</strong>
            <span>{ventas.margen_28 !== null ? `Te quedan ${ventas.margen_28} de cada $100 que vendes` : 'Registra costos para calcularla'}</span>
          </div>
        </div>
        <p className="rn-nota">
          "Semana normal" es el promedio de las 4 semanas anteriores. La ganancia es lo vendido menos lo que te costó cada producto
          {ventas.porcentaje_sin_costo > 0 && ` (el ${ventas.porcentaje_sin_costo}% de lo vendido no tiene costo registrado y no entra en la cuenta)`}.
        </p>
        <button type="button" className="rn-link" onClick={() => onIrAVista('historia')}>Ver cómo ha evolucionado →</button>
      </Capitulo>

      {/* 2. Pon atención */}
      <Capitulo id="rn-atencion" numero={2} pregunta="¿Qué necesita tu atención?" titulo={
        h.alertas.length === 0 ? 'Todo en orden por ahora 🎉' : `${h.alertas.length} ${h.alertas.length === 1 ? 'cosa merece' : 'cosas merecen'} que les eches un ojo.`
      }>
        <div className="rn-alertas">
          {atencion.por_agotarse.length > 0 && (
            <div className="rn-alerta rn-alerta--urgente">
              <h4>📦 Se te están acabando</h4>
              <p>Productos que se venden y alcanzan para menos de 4 días.</p>
              <ul>
                {atencion.por_agotarse.map(p => (
                  <li key={p.id}>
                    <span>{p.nombre}</span>
                    <b>{p.stock_actual <= 0 ? 'Agotado' : `Quedan ${p.stock_actual} · ~${p.dias_cobertura} ${p.dias_cobertura === 1 ? 'día' : 'días'}`}</b>
                  </li>
                ))}
              </ul>
              <button type="button" className="rn-link" onClick={() => navigate('/pedidos')}>Hacer pedido →</button>
            </div>
          )}

          {h.comprandoDeMas && (
            <div className="rn-alerta rn-alerta--urgente">
              <h4>🛒 Estás comprando más de lo que vendes</h4>
              <p>
                Por cada $100 que vendes, compras {pesos(h.comprasPor100)} en mercancía, pero lo vendido solo te costó unos {pesos(h.costoPor100)}.
                Son unos <b>{pesos(h.excesoSemanal)} por semana</b> que se quedan en el inventario.
              </p>
              <button type="button" className="rn-link" onClick={() => ir('rn-proveedores')}>Ver proveedores →</button>
            </div>
          )}

          {atencion.fiado.total > 0 && (
            <div className={`rn-alerta ${atencion.fiado.quietos.length > 0 ? 'rn-alerta--media' : ''}`}>
              <h4>📒 Fiado</h4>
              <p>Te deben <b>{pesos(atencion.fiado.total)}</b> entre {atencion.fiado.clientes} {atencion.fiado.clientes === 1 ? 'cliente' : 'clientes'}.</p>
              {atencion.fiado.quietos.length > 0 && (
                <>
                  <p>Estos llevan más de un mes sin comprar ni abonar:</p>
                  <ul>
                    {atencion.fiado.quietos.map(c => (
                      <li key={c.id}><span>{c.nombre}</span><b>{pesos(c.deuda)}</b></li>
                    ))}
                  </ul>
                </>
              )}
              <button type="button" className="rn-link" onClick={() => navigate('/clientes')}>Ver clientes →</button>
            </div>
          )}

          {atencion.plata_quieta.total > 0 && (
            <div className="rn-alerta rn-alerta--media">
              <h4>💤 Plata quieta en el inventario</h4>
              <p>
                Tienes <b>{pesos(atencion.plata_quieta.total)}</b> en {atencion.plata_quieta.cantidad} productos que no se venden hace más de un mes.
              </p>
              <ul>
                {atencion.plata_quieta.productos.map(p => (
                  <li key={p.id}><span>{p.nombre} ({p.stock_actual})</span><b>{pesos(p.valor)}</b></li>
                ))}
              </ul>
            </div>
          )}

          {atencion.sin_costo.cantidad > 0 && (
            <div className="rn-alerta">
              <h4>🏷️ Productos sin costo registrado</h4>
              <p>
                Vendiste {atencion.sin_costo.cantidad} {atencion.sin_costo.cantidad === 1 ? 'producto' : 'productos'} sin saber cuánto te costaron,
                así que no se sabe cuánto te dejaron. Por ejemplo: {atencion.sin_costo.productos.slice(0, 3).map(p => p.nombre.trim()).join(', ')}.
              </p>
              <button type="button" className="rn-link" onClick={() => navigate('/inventario')}>Completar costos →</button>
            </div>
          )}
        </div>
      </Capitulo>

      {/* 3. Proveedores */}
      <Capitulo id="rn-proveedores" numero={3} pregunta="¿En qué se te va la plata?" titulo={
        proveedores.lista.length === 0
          ? 'Todavía no hay pedidos recibidos en las últimas 8 semanas.'
          : `En promedio gastas ${pesos(proveedores.gasto_semanal)} a la semana en proveedores.`
      }>
        {proveedores.lista.length > 0 && (
          <>
            <div className="rn-metricas">
              <div className="rn-metrica">
                <small>Compras por semana</small>
                <strong>{pesos(proveedores.gasto_semanal)}</strong>
                <span>Promedio de las últimas 8 semanas</span>
              </div>
              <div className="rn-metrica">
                <small>Ventas por semana</small>
                <strong>{pesos(proveedores.ventas_semanal)}</strong>
                <span>Mismo periodo</span>
              </div>
              <div className={`rn-metrica ${h.comprandoDeMas ? 'rn-metrica--alerta' : ''}`}>
                <small>De cada $100 vendidos</small>
                <strong>{pesos(h.comprasPor100)}</strong>
                <span>se van en compras{h.costoPor100 !== null && ` (lo vendido costó ~${pesos(h.costoPor100)})`}</span>
              </div>
            </div>

            <div className="rn-proveedores">
              {proveedores.lista.map(p => {
                const tendencia = variacion(p.total_ultimas_4, p.total_previas_4);
                return (
                  <div key={p.id} className="rn-proveedor">
                    <div className="rn-proveedor__fila">
                      <strong>{p.nombre}</strong>
                      <span>{pesos(p.gasto_semanal)}<small>/semana</small></span>
                    </div>
                    <div className="rn-barra"><div style={{ width: `${(p.gasto_semanal / maxProveedor) * 100}%` }} /></div>
                    <div className="rn-proveedor__detalle">
                      <span>Pedido promedio <b>{pesos(p.pedido_promedio)}</b></span>
                      <span>{p.cada_dias ? <>Pides cada <b>~{p.cada_dias} días</b></> : <>{p.pedidos} pedido en 8 semanas</>}</span>
                      <span><b>{p.participacion}%</b> de tus compras</span>
                      <span>Último: {fechaCorta(p.ultimo_pedido)}</span>
                      {tendencia !== null && p.total_previas_4 > 0 && (
                        <span>Último mes <Cambio valor={tendencia} invertir /></span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="rn-nota">Solo cuentan los pedidos marcados como recibidos en Mis pedidos.</p>
            <button type="button" className="rn-link" onClick={() => navigate('/pedidos')}>Ir a Mis pedidos →</button>
          </>
        )}
      </Capitulo>

      {/* 4. Qué te deja plata */}
      <Capitulo id="rn-ganancia" numero={4} pregunta="¿Qué te deja plata?" titulo={
        productos.mas_ganancia.length === 0
          ? 'Registra el costo de tus productos para saber cuáles te dejan más.'
          : `${productos.mas_ganancia[0].nombre.trim()} es lo que más te deja: ${pesos(productos.mas_ganancia[0].ganancia)} en 4 semanas.`
      }>
        {productos.mas_ganancia.length > 0 && (
          <div className="rn-ranking">
            {productos.mas_ganancia.map((p, i) => (
              <div key={p.id} className="rn-ranking__item">
                <span className="rn-ranking__pos">{i + 1}</span>
                <div className="rn-ranking__info">
                  <div className="rn-proveedor__fila">
                    <span>{p.nombre}</span>
                    <b>{pesos(p.ganancia)}</b>
                  </div>
                  <div className="rn-barra rn-barra--verde"><div style={{ width: `${(p.ganancia / maxGanancia) * 100}%` }} /></div>
                  <small>{p.unidades} vendidos · te deja el {p.margen}%</small>
                </div>
              </div>
            ))}
          </div>
        )}
        {productos.margen_bajo.length > 0 && (
          <div className="rn-alerta rn-alerta--media rn-alerta--suelta">
            <h4>🤔 Se venden mucho pero dejan poco</h4>
            <ul>
              {productos.margen_bajo.map(p => (
                <li key={p.id}><span>{p.nombre} ({p.unidades} vendidos)</span><b>deja {p.margen}%</b></li>
              ))}
            </ul>
            <p>Vale la pena revisar su precio o buscar un proveedor más barato.</p>
          </div>
        )}
        <button type="button" className="rn-link" onClick={() => onIrAVista('productos')}>Ver todos los productos →</button>
      </Capitulo>

      {/* 5. Cuándo te compran */}
      <Capitulo id="rn-tiempo" numero={5} pregunta="¿Cuándo te compran?" titulo={
        h.mejorDia && h.peorDia
          ? `El ${DIAS[h.mejorDia.dia]} es tu mejor día y el ${DIAS[h.peorDia.dia]} el más flojo.`
          : 'Todavía no hay suficientes ventas para ver un patrón.'
      }>
        {tiempo.dias.length > 0 && (
          <div className="rn-dias">
            {[1, 2, 3, 4, 5, 6, 7].map(d => {
              const dia = tiempo.dias.find(x => x.dia === d);
              const valor = dia?.promedio || 0;
              return (
                <div key={d} className={`rn-dia ${h.mejorDia?.dia === d ? 'mejor' : ''} ${h.peorDia?.dia === d ? 'peor' : ''}`}>
                  <div className="rn-dia__barra"><div style={{ height: `${(valor / maxDia) * 100}%` }} /></div>
                  <small>{DIAS_CORTOS[d]}</small>
                  <span>{valor >= 1000 ? `${Math.round(valor / 1000)}k` : valor}</span>
                </div>
              );
            })}
          </div>
        )}
        {h.pico && h.totalHoras > 0 && (
          <p className="rn-texto">
            Un {DIAS[h.mejorDia.dia]} normal vendes unos <b>{pesos(h.mejorDia.promedio)}</b>, y un {DIAS[h.peorDia.dia]} unos <b>{pesos(h.peorDia.promedio)}</b>.
            La hora más movida es de <b>{hora12(h.pico.desde)} a {hora12(h.pico.hasta)}</b>: ahí se hace el {Math.round((h.pico.suma / h.totalHoras) * 100)}% de lo que vendes.
            Ten todo surtido antes del {DIAS[h.mejorDia.dia]} y aprovecha los días flojos para hacer pedidos, conteos o promociones.
          </p>
        )}
        <p className="rn-nota">Promedio de las últimas 8 semanas.</p>
      </Capitulo>

      {/* 6. Para decidir */}
      <Capitulo id="rn-decisiones" numero={6} pregunta="¿Y ahora qué?" titulo={
        h.decisiones.length === 0 ? 'No hay nada urgente. ¡Buen trabajo!' : 'Tres cosas que puedes hacer esta semana'
      }>
        <ol className="rn-decisiones">
          {h.decisiones.map((d, i) => (
            <li key={i}>
              <p>{d.texto}</p>
              <button type="button" className="rn-link" onClick={d.ir}>{d.accion} →</button>
            </li>
          ))}
        </ol>
      </Capitulo>
    </div>
  );
};

export default ResumenNegocio;
