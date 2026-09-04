import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import './GestionModulos.css';

// Modal de administración de módulos de un negocio: crear módulos nuevos,
// eliminarlos y dar/quitar acceso de los trabajadores a cada uno. Es
// función exclusiva de super_admin (ver Negocios.jsx, que la abre pasando
// el negocio elegido) — un admin normal ya no puede gestionar sus propios
// módulos, para que la creación de módulos y el acceso a ellos quede
// centralizado en super_admin.
const GestionModulos = ({ negocioId, negocioNombre, onClose }) => {
  const [modulos, setModulos] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [formNuevoModulo, setFormNuevoModulo] = useState({ nombre: '', descripcion: '' });
  const [creando, setCreando] = useState(false);
  // Guarda qué checkbox (usuarioId-moduloId) está en vuelo, para
  // deshabilitarlo individualmente y no toda la tabla mientras carga.
  const [checkboxesEnVuelo, setCheckboxesEnVuelo] = useState({});

  const cargarDatos = useCallback(async () => {
    if (!negocioId) return;
    try {
      setLoading(true);
      const [modulosRes, usuariosRes] = await Promise.all([
        api.get(`/negocios/${negocioId}/modulos`),
        api.get(`/negocios/${negocioId}/usuarios`)
      ]);
      setModulos(modulosRes.data);
      setUsuarios(usuariosRes.data);
    } catch (error) {
      console.error('Error cargando datos de módulos:', error);
      setMensaje('❌ Error al cargar módulos/usuarios');
    } finally {
      setLoading(false);
    }
  }, [negocioId]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  const handleCrearModulo = async (e) => {
    e.preventDefault();
    if (!formNuevoModulo.nombre.trim()) return;

    try {
      setCreando(true);
      const response = await api.post(`/negocios/${negocioId}/modulos`, {
        nombre: formNuevoModulo.nombre.trim(),
        descripcion: formNuevoModulo.descripcion.trim() || null
      });
      const nuevoModulo = response.data;

      setFormNuevoModulo({ nombre: '', descripcion: '' });
      setMensaje(`✅ Módulo "${nuevoModulo.nombre}" creado`);
      await cargarDatos();
    } catch (error) {
      console.error('Error creando módulo:', error);
      setMensaje(error.response?.data?.error || '❌ Error al crear el módulo');
    } finally {
      setCreando(false);
      setTimeout(() => setMensaje(''), 4000);
    }
  };

  const tieneAcceso = (usuario, moduloId) => {
    return usuario.modulos_asignados.some(m => m.id === moduloId);
  };

  // El backend decide si borra de verdad o solo desactiva (según si el
  // módulo tiene productos/ventas/clientes/proveedores) — eliminado:false
  // no es un error, es el resultado esperado para un módulo con datos.
  const handleEliminarModulo = async (modulo) => {
    if (!window.confirm(`¿Eliminar el módulo "${modulo.nombre}"?\n\nSi tiene productos, ventas, clientes o proveedores asociados, se desactivará en vez de eliminarse.`)) {
      return;
    }

    try {
      const response = await api.delete(`/modulos/${modulo.id}`);
      setMensaje(response.data.eliminado ? `✅ ${response.data.message}` : `⚠️ ${response.data.message}`);
      await cargarDatos();
    } catch (error) {
      console.error('Error eliminando módulo:', error);
      setMensaje(error.response?.data?.error || '❌ Error al eliminar el módulo');
    } finally {
      setTimeout(() => setMensaje(''), 6000);
    }
  };

  const toggleAcceso = async (usuario, modulo) => {
    const key = `${usuario.id}-${modulo.id}`;
    const yaAsignado = tieneAcceso(usuario, modulo.id);

    setCheckboxesEnVuelo(prev => ({ ...prev, [key]: true }));
    try {
      if (yaAsignado) {
        await api.delete(`/usuarios/${usuario.id}/modulos/${modulo.id}`);
      } else {
        await api.post(`/usuarios/${usuario.id}/modulos/${modulo.id}`);
      }

      // Actualiza en memoria en vez de recargar todo, para que la tabla no
      // parpadee con cada clic.
      setUsuarios(prev => prev.map(u => {
        if (u.id !== usuario.id) return u;
        return {
          ...u,
          modulos_asignados: yaAsignado
            ? u.modulos_asignados.filter(m => m.id !== modulo.id)
            : [...u.modulos_asignados, { id: modulo.id, nombre: modulo.nombre }]
        };
      }));
    } catch (error) {
      console.error('Error cambiando acceso a módulo:', error);
      setMensaje(error.response?.data?.error || '❌ Error al cambiar el acceso');
      setTimeout(() => setMensaje(''), 4000);
    } finally {
      setCheckboxesEnVuelo(prev => {
        const resto = { ...prev };
        delete resto[key];
        return resto;
      });
    }
  };

  return (
    <div className="gestion-modulos-overlay" onClick={onClose}>
      <div className="gestion-modulos-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gestion-modulos-header">
          <h3>🧩 Gestión de módulos{negocioNombre ? ` — ${negocioNombre}` : ''}</h3>
          <button className="gestion-modulos-cerrar" onClick={onClose}>×</button>
        </div>

        {mensaje && <div className="gestion-modulos-mensaje">{mensaje}</div>}

        <div className="gestion-modulos-body">
          <section className="gestion-modulos-seccion">
            <h4>➕ Crear nuevo módulo</h4>
            <form onSubmit={handleCrearModulo} className="gestion-modulos-form">
              <input
                type="text"
                placeholder="Nombre del módulo *"
                value={formNuevoModulo.nombre}
                onChange={(e) => setFormNuevoModulo({ ...formNuevoModulo, nombre: e.target.value })}
                required
              />
              <input
                type="text"
                placeholder="Descripción (opcional)"
                value={formNuevoModulo.descripcion}
                onChange={(e) => setFormNuevoModulo({ ...formNuevoModulo, descripcion: e.target.value })}
              />
              <button type="submit" disabled={creando} className="gestion-modulos-btn-crear">
                {creando ? 'Creando...' : 'Crear módulo'}
              </button>
            </form>
          </section>

          <section className="gestion-modulos-seccion">
            <h4>📦 Módulos existentes</h4>
            {modulos.length === 0 ? (
              <p className="gestion-modulos-info">Todavía no hay módulos creados.</p>
            ) : (
              <ul className="gestion-modulos-lista">
                {modulos.map(modulo => (
                  <li key={modulo.id} className="gestion-modulos-lista-item">
                    <div>
                      <strong>{modulo.nombre}</strong>
                      {modulo.descripcion && <span className="gestion-modulos-lista-desc"> — {modulo.descripcion}</span>}
                    </div>
                    <button
                      onClick={() => handleEliminarModulo(modulo)}
                      className="gestion-modulos-btn-eliminar"
                    >
                      🗑️ Eliminar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="gestion-modulos-seccion">
            <h4>👥 Acceso de usuarios a módulos</h4>
            {loading ? (
              <p className="gestion-modulos-info">Cargando...</p>
            ) : modulos.length === 0 ? (
              <p className="gestion-modulos-info">Todavía no hay módulos creados.</p>
            ) : usuarios.length === 0 ? (
              <p className="gestion-modulos-info">Este negocio no tiene otros usuarios registrados.</p>
            ) : (
              <div className="gestion-modulos-tabla-wrapper">
                <table className="gestion-modulos-tabla">
                  <thead>
                    <tr>
                      <th>Usuario</th>
                      {modulos.map(modulo => (
                        <th key={modulo.id}>{modulo.nombre}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {usuarios.map(usuario => (
                      <tr key={usuario.id}>
                        <td className="gestion-modulos-usuario-nombre">
                          {usuario.nombre}
                          <span className={`gestion-modulos-rol-badge ${usuario.rol}`}>{usuario.rol}</span>
                        </td>
                        {usuario.rol === 'admin' ? (
                          <td colSpan={modulos.length} className="gestion-modulos-admin-nota">
                            Administrador: acceso a todos los módulos del negocio
                          </td>
                        ) : (
                          modulos.map(modulo => {
                            const key = `${usuario.id}-${modulo.id}`;
                            return (
                              <td key={modulo.id} className="gestion-modulos-checkbox-celda">
                                <input
                                  type="checkbox"
                                  checked={tieneAcceso(usuario, modulo.id)}
                                  disabled={!!checkboxesEnVuelo[key]}
                                  onChange={() => toggleAcceso(usuario, modulo)}
                                />
                              </td>
                            );
                          })
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="gestion-modulos-footer">
          <button onClick={onClose} className="gestion-modulos-btn-cerrar">Cerrar</button>
        </div>
      </div>
    </div>
  );
};

export default GestionModulos;
