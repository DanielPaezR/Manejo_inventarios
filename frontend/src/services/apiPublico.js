import axios from 'axios';

// Cliente HTTP separado de services/api.js para las páginas públicas del
// Menú QR (sin login). api.js inyecta el token/modulo_id de la sesión
// admin y redirige a /login ante un 401/403 — un cliente sin cuenta
// nunca debe arrastrar ni disparar nada de eso.
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const apiPublico = axios.create({
  baseURL: `${API_BASE_URL}/api`,
});

export default apiPublico;
