import { useEffect, useState } from 'react';
import api from '../services/api';

// Plan del negocio (qué funciones incluye y los límites). Se pide una vez
// por sesión de la página y se comparte entre componentes.
let pendiente = null;

export const cargarPlan = (forzar = false) => {
  if (!pendiente || forzar) {
    pendiente = api.get('/mi-plan').then(r => r.data).catch(() => {
      pendiente = null;
      return null;
    });
  }
  return pendiente;
};

export const usePlan = () => {
  const [datos, setDatos] = useState(null);
  useEffect(() => {
    let vivo = true;
    cargarPlan().then(d => { if (vivo) setDatos(d); });
    return () => { vivo = false; };
  }, []);
  // Mientras carga (o si falla) no bloquea nada.
  const incluye = (funcion) => !datos?.plan?.funciones || datos.plan.funciones.includes(funcion);
  return { datos, plan: datos?.plan || null, incluye };
};
