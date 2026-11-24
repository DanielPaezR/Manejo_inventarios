import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useModulo } from '../hooks/useModulo';
import './ResumenNegocio.css';

// Pestaña Clientes de Estadísticas: solo los clientes que piden por el menú
// en línea (domicilios), que son los que dejan su celular. Las ventas del
// mostrador no se cuentan porque ahí casi nunca se registra quién compra.

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const hace = (d) => (d === 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`);
const whatsapp = (tel, nombre) =>
  `https://wa.me/57${tel}?text=${encodeURIComponent(`¡Hola ${nombre || ''}! Te extrañamos. ¿Te provoca algo hoy?`)}`;

const ListaClientes = ({ clientes, detalle, accion }) => (
  <div className="rn-alerta cl-lista">
    <ul>
      {clientes.map(c => (
        <li key={c.telefono}>
          <span>
            <b>{c.nombre || 'Sin nombre'}</b>
            <small>{detalle(c)}</small>
          </span>
          {accion ? accion(c) : <b>{pesos(c.total)}</b>}
        </li>
      ))}
    </ul>
  </div>
);

const ClientesEnLinea = () => {
  const { moduloActivo } = useModulo();
  const [datos, setDatos] = useState(null);

  useEffect(() => {
    if (!moduloActivo) return;
    api.get('/estadisticas/clientes-en-linea').then(r => setDatos(r.data)).catch(() => {});
  }, [moduloActivo]);

  if (!datos) {
    return <div className="loading-container"><div className="spinner"></div><p>Cargando clientes...</p></div>;
  }

  if (datos.total_clientes === 0) {
    return (
      <div className="rn">
        <section className="card rn-capitulo">
          <h3>🛵 Tus clientes en línea</h3>
          <p className="rn-texto">
            Aquí vas a ver a los clientes que te piden por el menú en línea: quiénes piden seguido, quiénes son nuevos y quiénes dejaron de pedir.
            Comparte el enlace de tu menú (en Configuración) para empezar a recibir pedidos.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="rn">
      <div className="rn-intro">
        <h2>Tus clientes en línea</h2>
        <p>Los que te piden por el menú en línea, reconocidos por su celular. Las ventas del mostrador no se cuentan aquí.</p>
      </div>

      <section className="card rn-capitulo">
        <div className="rn-metricas">
          <div className="rn-metrica">
            <small>Pedidos en línea (30 días)</small>
            <strong>{datos.pedidos_30}</strong>
            <span>{datos.domicilios_30} a domicilio</span>
          </div>
          <div className="rn-metrica">
            <small>Vendido en línea (30 días)</small>
            <strong>{pesos(datos.total_30)}</strong>
            <span>{datos.pedidos_30 > 0 ? `${pesos(datos.total_30 / datos.pedidos_30)} por pedido` : ''}</span>
          </div>
          <div className="rn-metrica">
            <small>Clientes distintos</small>
            <strong>{datos.total_clientes}</strong>
            <span>desde que usas el menú</span>
          </div>
        </div>
      </section>

      {datos.perdidos.length > 0 && (
        <section className="card rn-capitulo">
          <div className="rn-capitulo__cabecera">
            <span className="rn-capitulo__numero aa-icono">💔</span>
            <div><small>Pon atención</small><h3>{datos.perdidos.length} {datos.perdidos.length === 1 ? 'cliente dejó' : 'clientes dejaron'} de pedir</h3></div>
          </div>
          <p className="rn-texto">Pedían seguido y hace rato no aparecen. Un mensaje a tiempo puede traerlos de vuelta.</p>
          <ListaClientes
            clientes={datos.perdidos}
            detalle={(c) => `${c.pedidos} pedidos · último ${hace(c.dias_desde_ultimo)}`}
            accion={(c) => <a className="rn-link" href={whatsapp(c.telefono, c.nombre)} target="_blank" rel="noreferrer">Escribirle →</a>}
          />
        </section>
      )}

      <section className="card rn-capitulo">
        <div className="rn-capitulo__cabecera">
          <span className="rn-capitulo__numero aa-icono">⭐</span>
          <div><small>Tus mejores clientes</small><h3>Los que más te han comprado</h3></div>
        </div>
        <ListaClientes
          clientes={datos.mejores}
          detalle={(c) => `${c.pedidos} ${c.pedidos === 1 ? 'pedido' : 'pedidos'} · ${pesos(c.promedio)} por pedido${c.cada_dias ? ` · pide cada ~${c.cada_dias} días` : ''} · último ${hace(c.dias_desde_ultimo)}`}
        />
      </section>

      {datos.nuevos.length > 0 && (
        <section className="card rn-capitulo">
          <div className="rn-capitulo__cabecera">
            <span className="rn-capitulo__numero aa-icono">🌱</span>
            <div><small>Último mes</small><h3>{datos.nuevos.length} {datos.nuevos.length === 1 ? 'cliente nuevo' : 'clientes nuevos'}</h3></div>
          </div>
          <p className="rn-texto">Pidieron por primera vez en los últimos 30 días. Si vuelven a pedir, se convierten en clientes fijos.</p>
          <ListaClientes clientes={datos.nuevos} detalle={(c) => `primer pedido ${hace(c.dias_desde_primero)}`} />
        </section>
      )}
    </div>
  );
};

export default ClientesEnLinea;
