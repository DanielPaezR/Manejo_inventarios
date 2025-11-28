import React, { useState } from 'react';
import api from '../services/api';
import './CambiarPassword.css';

const CambiarPassword = ({ onClose }) => {
  const [formData, setFormData] = useState({
    passwordActual: '',
    nuevaPassword: '',
    confirmarPassword: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    // Validaciones
    if (formData.nuevaPassword !== formData.confirmarPassword) {
      setError('Las contraseñas nuevas no coinciden');
      setLoading(false);
      return;
    }

    if (formData.nuevaPassword.length < 6) {
      setError('La nueva contraseña debe tener al menos 6 caracteres');
      setLoading(false);
      return;
    }

    try {
      const response = await api.put('/usuarios/cambiar-password', {
        passwordActual: formData.passwordActual,
        nuevaPassword: formData.nuevaPassword
      });

      setSuccess('Contraseña actualizada correctamente');
      setFormData({
        passwordActual: '',
        nuevaPassword: '',
        confirmarPassword: ''
      });

      // Cerrar automáticamente después de 2 segundos
      setTimeout(() => {
        if (onClose) onClose();
      }, 2000);

    } catch (error) {
      setError(error.response?.data?.error || 'Error al cambiar contraseña');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cambiar-password-modal">
      <div className="cambiar-password-content">
        <div className="modal-header">
          <h3>Cambiar Contraseña</h3>
          {onClose && (
            <button className="close-btn" onClick={onClose}>×</button>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Contraseña Actual:</label>
            <input
              type="password"
              name="passwordActual"
              value={formData.passwordActual}
              onChange={handleChange}
              required
              placeholder="Ingresa tu contraseña actual"
            />
          </div>

          <div className="form-group">
            <label>Nueva Contraseña:</label>
            <input
              type="password"
              name="nuevaPassword"
              value={formData.nuevaPassword}
              onChange={handleChange}
              required
              placeholder="Mínimo 6 caracteres"
              minLength="6"
            />
          </div>

          <div className="form-group">
            <label>Confirmar Nueva Contraseña:</label>
            <input
              type="password"
              name="confirmarPassword"
              value={formData.confirmarPassword}
              onChange={handleChange}
              required
              placeholder="Repite la nueva contraseña"
            />
          </div>

          {error && <div className="error-message">{error}</div>}
          {success && <div className="success-message">{success}</div>}

          <div className="modal-actions">
            <button 
              type="button" 
              className="btn btn-secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancelar
            </button>
            <button 
              type="submit" 
              className="btn btn-primary" 
              disabled={loading}
            >
              {loading ? 'Cambiando...' : 'Cambiar Contraseña'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CambiarPassword;