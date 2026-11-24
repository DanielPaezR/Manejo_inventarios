import React, { useState, useEffect } from 'react';
import api from '../services/api';
import Burbuja from './Burbuja';
import './MiDiaVentas.css';

// Arriba de Ventas, para cualquier persona que venda: cómo va su día, su
// puesto en el podio de la semana y el avance del equipo en la meta (en %).
// Se refresca después de cada venta con el evento "ventaRegistrada".

const DIAS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MEDALLAS = ['🥇', '🥈', '🥉'];
const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;

const MiDiaVentas = ({ esAdmin }) => {
  const [datos, setDatos] = useState(null);
  const [verPodio, setVerPodio] = useState(false);

  useEffect(() => {
    let vivo = true;
    const cargar = () => api.get('/ventas/mi-dia').then(r => { if (vivo) setDatos(r.data); }).catch(() => {});
    cargar();
    const intervalo = setInterval(cargar, 5 * 60 * 1000);
    window.addEventListener('ventaRegistrada', cargar);
    return () => { vivo = false; clearInterval(intervalo); window.removeEventListener('ventaRegistrada', cargar); };
  }, []);

  if (!datos) return null;
  const { hoy, semana, normal_a_esta_hora: normal, podio, mi_posicion: puesto, vendedores } = datos;
  const hayEquipo = vendedores > 1;

  // El admin ya ve los totales del negocio en la barra de arriba; aquí solo
  // lo suyo y el podio, y solo si hay más de una persona vendiendo.
  if (esAdmin && !hayEquipo) return null;

  const dif = normal > 0 ? Math.round(((hoy.total - normal) / normal) * 100) : null;
  const tono = dif !== null && dif >= 5 ? 'bien' : 'info';

  return (
    <div className="mdv">
      <Burbuja icono="🙋" tono={tono} className="mdv__burbuja">
        <span>
          {hoy.ventas === 0
            ? 'Hoy todavía no has registrado ventas.'
            : <>Hoy llevas <b>{pesos(hoy.total)}</b> en {hoy.ventas} {hoy.ventas === 1 ? 'venta' : 'ventas'}.</>}
          {!esAdmin && normal > 0 && <> Un {DIAS[datos.dia_semana]} normal, a esta hora, llevas {pesos(normal)}{dif >= 5 ? ' 🎉' : ''}.</>}
          {!esAdmin && semana.ventas > 0 && <> En la semana: {pesos(semana.total)}.</>}
          {!esAdmin && datos.meta_equipo_pct !== null && (
            <> El equipo va en el <b>{datos.meta_equipo_pct}%</b> de la meta de la semana{datos.meta_equipo_pct >= 100 ? ' 🏆' : ''}.</>
          )}
        </span>
        {hayEquipo && (
          <button type="button" className="mdv__podio-btn" onClick={() => setVerPodio(v => !v)} aria-expanded={verPodio}>
            🏆 {puesto ? `Vas #${puesto} de ${vendedores}` : 'Podio'}
          </button>
        )}
      </Burbuja>

      {verPodio && hayEquipo && (
        <div className="mdv__podio" role="list" aria-label="Podio de la semana">
          <small>Podio de la semana (desde el lunes)</small>
          {podio.map(p => (
            <div key={p.posicion} role="listitem" className={`mdv__puesto ${p.soy_yo ? 'mdv__puesto--yo' : ''}`}>
              <span className="mdv__medalla">{MEDALLAS[p.posicion - 1] || `#${p.posicion}`}</span>
              <span className="mdv__nombre">{p.nombre}{p.soy_yo ? ' (tú)' : ''}</span>
              <span className="mdv__dato">{p.ventas} {p.ventas === 1 ? 'venta' : 'ventas'}</span>
              <b>{pesos(p.total)}</b>
            </div>
          ))}
          {puesto > podio.length && <p className="mdv__nota">Tú vas en el puesto #{puesto}. ¡A darle!</p>}
        </div>
      )}
    </div>
  );
};

export default MiDiaVentas;
