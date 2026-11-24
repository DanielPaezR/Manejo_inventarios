import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';

// Copias de seguridad de toda la base (solo super admin, en Negocios).
const kb = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
const fecha = (f) => new Date(f).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const RespaldosPanel = () => {
  const [lista, setLista] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState('');

  const cargar = useCallback(async () => {
    try {
      const r = await api.get('/respaldos');
      setLista(r.data);
    } catch { setLista([]); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const crear = async () => {
    try {
      setOcupado(true);
      setMensaje('');
      const r = await api.post('/respaldos');
      setMensaje(`✅ Copia creada: ${r.data.filas.toLocaleString('es-CO')} registros`);
      cargar();
    } catch (err) {
      setMensaje(`❌ ${err.response?.data?.error || 'No se pudo crear la copia'}`);
    } finally {
      setOcupado(false);
    }
  };

  const descargar = async (r) => {
    try {
      const res = await api.get(`/respaldos/${r.id}/descargar`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `respaldo-${new Date(r.creado_en).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json.gz`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setMensaje('❌ No se pudo descargar');
    }
  };

  return (
    <div className="respaldos-panel">
      <div className="respaldos-panel__cabecera">
        <div>
          <h3>💾 Copias de seguridad</h3>
          <p>Cada noche se guarda una copia de toda la base (se conservan las últimas 14). Descarga una de vez en cuando y guárdala fuera (Drive, correo): si se pierde la base completa, solo esa te salva.</p>
        </div>
        <button type="button" className="btn-primary" onClick={crear} disabled={ocupado}>{ocupado ? 'Creando…' : 'Crear copia ahora'}</button>
      </div>
      {mensaje && <p className="respaldos-panel__mensaje">{mensaje}</p>}
      {lista.length === 0 ? (
        <p className="respaldos-panel__vacio">Todavía no hay copias. La primera automática se hace esta noche a las 3 a. m.</p>
      ) : (
        <ul className="respaldos-panel__lista">
          {lista.map(r => (
            <li key={r.id}>
              <span>
                <strong>{fecha(r.creado_en)}</strong>
                <small>{r.origen === 'manual' ? 'Manual' : 'Automática'} · {r.filas.toLocaleString('es-CO')} registros · {kb(r.tamano_bytes)}</small>
              </span>
              <button type="button" onClick={() => descargar(r)}>Descargar</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default RespaldosPanel;
