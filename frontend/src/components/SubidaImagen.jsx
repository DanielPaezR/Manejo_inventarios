import React, { useRef, useState } from 'react';
import { subirImagenCloudinary } from '../utils/cloudinaryUpload';
import './SubidaImagen.css';

// Botón de subida + vista previa + estado de carga/error, reutilizado
// tal cual (mismo comportamiento) en Productos.jsx (foto de producto) y
// PedidosCliente.jsx (foto de portada del menú). El componente es
// "controlado": no guarda la URL en su propio estado, solo la sube y
// avisa al padre vía onCambiar — el padre decide dónde vive ese string
// (formData.foto_url, etc.).
const SubidaImagen = ({ valor, onCambiar, botonTexto = '📷 Subir foto' }) => {
  const inputRef = useRef(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');

  const handleSeleccionarArchivo = async (e) => {
    const file = e.target.files?.[0];
    // Se limpia el valor del input ya en este punto (no solo al final):
    // así, si el usuario vuelve a elegir el MISMO archivo después de un
    // error, el evento onChange se dispara igual.
    e.target.value = '';
    if (!file) return;

    setError('');
    try {
      setSubiendo(true);
      const url = await subirImagenCloudinary(file);
      onCambiar(url);
    } catch (err) {
      console.error('Error subiendo imagen a Cloudinary:', err);
      setError(err.message || 'Error al subir la imagen');
    } finally {
      setSubiendo(false);
    }
  };

  return (
    <div className="subida-imagen">
      <div className="subida-imagen-fila">
        {valor && (
          <img src={valor} alt="Vista previa" className="subida-imagen-preview" />
        )}

        <div className="subida-imagen-botones">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleSeleccionarArchivo}
            className="subida-imagen-input-oculto"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={subiendo}
            className="btn-subida-imagen"
          >
            {subiendo ? 'Subiendo...' : botonTexto}
          </button>

          {valor && (
            <button
              type="button"
              onClick={() => onCambiar('')}
              disabled={subiendo}
              className="btn-quitar-imagen"
            >
              ✕ Quitar foto
            </button>
          )}
        </div>
      </div>

      {error && <p className="subida-imagen-error">{error}</p>}
    </div>
  );
};

export default SubidaImagen;
