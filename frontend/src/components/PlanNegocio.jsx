import React from 'react';
import { BadgeCheck, Lock } from 'lucide-react';
import { usePlan } from '../hooks/usePlan';
import './PlanNegocio.css';

export const pesos = (n) => `$${Number(n || 0).toLocaleString('es-CO')}`;

// Tarjeta "Tu plan" en Configuración: qué incluye y cuánto se está usando.
export const TarjetaPlan = () => {
  const { datos } = usePlan();
  if (!datos) return null;
  const { plan, uso, funciones, condiciones } = datos;
  const barra = (usado, limite) => (limite ? Math.min(100, Math.round((usado / limite) * 100)) : null);
  const limites = [
    { etiqueta: 'Sedes', usado: uso.sedes, limite: plan.sedes },
    { etiqueta: 'Usuarios', usado: uso.usuarios, limite: plan.usuarios }
  ];

  return (
    <div className="card conf-card pn">
      <div className="pn__cabecera">
        <div>
          <small>Tu plan</small>
          <h3><BadgeCheck size={20} /> {plan.nombre}</h3>
          <p className="conf-ayuda">{plan.descripcion}</p>
          {plan.precios && (
            <p className="pn__precio">
              <b>{pesos(plan.precios.mensual)}</b> al mes, sin IVA
              {plan.sedes_extra ? ` · ${plan.sedes_extra} sede${plan.sedes_extra === 1 ? '' : 's'} adicional${plan.sedes_extra === 1 ? '' : 'es'} de ${pesos(condiciones?.sede_adicional)}` : ''}
              {plan.soporte && <span> · Soporte: {plan.soporte}</span>}
            </p>
          )}
        </div>
      </div>
      <div className="pn__limites">
        {limites.map(l => (
          <div key={l.etiqueta} className="pn__limite">
            <span>{l.etiqueta}</span>
            <b>{l.usado}{l.limite ? ` de ${l.limite}` : ''}</b>
            {l.limite ? (
              <div className={`pn__barra ${l.usado >= l.limite ? 'lleno' : ''}`}><span style={{ width: `${barra(l.usado, l.limite)}%` }} /></div>
            ) : <small>Sin límite</small>}
          </div>
        ))}
      </div>
      <p className="pn__base">
        Todos los planes incluyen ventas, inventario y conteo físico, clientes y fiado, catálogo en línea,
        registro de ingresos y gastos, y reportes en Excel y PDF.
      </p>
      <ul className="pn__funciones">
        {Object.entries(funciones).map(([id, nombre]) => {
          const si = plan.funciones.includes(id);
          return (
            <li key={id} className={si ? 'si' : 'no'}>
              <span aria-hidden="true">{si ? '✓' : <Lock size={13} />}</span>{nombre}
            </li>
          );
        })}
      </ul>
      {plan.id !== 'multisede' && plan.id !== null && (
        <p className="conf-nota">¿Necesitas algo con candado? Escríbenos para cambiar de plan.</p>
      )}
      {plan.id === 'multisede' && (
        <p className="conf-nota">¿Necesitas más sedes? Cada sede adicional cuesta {pesos(condiciones?.sede_adicional)} al mes.</p>
      )}
    </div>
  );
};

// Reemplaza una función que el plan no incluye.
export const BloqueoPlan = ({ titulo, funcion, children }) => {
  const { datos, plan, incluye } = usePlan();
  if (incluye(funcion)) return children ?? null;
  const desde = datos?.desde?.[funcion];
  return (
    <div className="card conf-card pn-bloqueo">
      <span className="pn-bloqueo__icono" aria-hidden="true"><Lock size={18} /></span>
      <div>
        <h3 className="conf-titulo">{titulo}</h3>
        <p className="conf-ayuda">
          No está incluido en tu plan {plan?.nombre}.
          {desde ? ` Está disponible desde el plan ${desde}.` : ''} Escríbenos si quieres activarlo.
        </p>
      </div>
    </div>
  );
};
