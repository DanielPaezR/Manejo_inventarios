import React, { useState, useEffect } from 'react';
import { Users } from 'lucide-react';
import api from '../services/api';
import { PERMISOS } from '../utils/permisos';

// "Tu equipo": el administrador enciende o apaga, por trabajador, las
// secciones extra que puede usar (p. ej. Productos mientras registran el
// inventario). Cada cambio se guarda al instante y aplica de inmediato.
const EquipoPermisos = ({ avisar }) => {
  const [trabajadores, setTrabajadores] = useState(null);
  const [guardandoId, setGuardandoId] = useState(null);

  useEffect(() => {
    api.get('/equipo')
      .then(res => setTrabajadores(res.data))
      .catch(err => {
        console.error('Error cargando el equipo:', err);
        setTrabajadores([]);
      });
  }, []);

  const guardar = async (trabajador, permisos) => {
    const anteriores = trabajador.permisos;
    setTrabajadores(prev => prev.map(t => (t.id === trabajador.id ? { ...t, permisos } : t)));
    try {
      setGuardandoId(trabajador.id);
      await api.put(`/equipo/${trabajador.id}/permisos`, { permisos });
      avisar(`✅ Permisos de ${trabajador.nombre} actualizados`);
    } catch (err) {
      setTrabajadores(prev => prev.map(t => (t.id === trabajador.id ? { ...t, permisos: anteriores } : t)));
      avisar(`❌ ${err.response?.data?.error || 'No se pudieron guardar los permisos'}`);
    } finally {
      setGuardandoId(null);
    }
  };

  const alternar = (trabajador, clave) => {
    const permisos = { ...trabajador.permisos };
    if (permisos[clave]) delete permisos[clave];
    else permisos[clave] = true;
    guardar(trabajador, permisos);
  };

  if (!trabajadores) return null;

  return (
    <div className="card conf-card">
      <h3 className="conf-titulo"><Users size={18} /> Tu equipo</h3>
      <p className="conf-ayuda">
        Todos tus trabajadores pueden vender y atender pedidos. Aquí puedes darle a cada uno acceso a más
        secciones, por ejemplo <strong>Productos</strong> mientras registran el inventario, y quitárselo cuando terminen.
        Los cambios aplican de inmediato.
      </p>

      {trabajadores.length === 0 ? (
        <p className="conf-ayuda">Todavía no tienes trabajadores registrados.</p>
      ) : (
        <div className="equipo-lista">
          {trabajadores.map(t => {
            const activos = PERMISOS.filter(p => t.permisos?.[p.clave]).length;
            return (
              <div key={t.id} className={`equipo-item ${t.activo ? '' : 'equipo-item--inactivo'}`}>
                <div className="equipo-item__cabecera">
                  <div>
                    <strong>{t.nombre}</strong>
                    <small>{t.email}{!t.activo && ' · cuenta desactivada'}</small>
                  </div>
                  {activos > 0 && (
                    <button type="button" className="conf-link equipo-quitar"
                      onClick={() => guardar(t, {})} disabled={guardandoId === t.id}>
                      Quitar todos
                    </button>
                  )}
                </div>
                <div className="equipo-permisos">
                  {PERMISOS.map(p => {
                    const on = t.permisos?.[p.clave] === true;
                    return (
                      <button
                        key={p.clave}
                        type="button"
                        role="switch"
                        aria-checked={on}
                        className={`equipo-permiso ${on ? 'on' : ''}`}
                        onClick={() => alternar(t, p.clave)}
                        disabled={guardandoId === t.id}
                        title={p.descripcion}
                      >
                        <span className="equipo-permiso__check" aria-hidden="true">{on ? '✓' : '+'}</span>
                        <span>
                          <strong>{p.titulo}</strong>
                          <small>{p.descripcion}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default EquipoPermisos;
