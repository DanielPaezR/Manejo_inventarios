// Geocodifica una dirección de texto a { lat, lng } usando Nominatim
// (OpenStreetMap) — gratis, sin API key. Nominatim exige un máximo de 1
// solicitud por segundo y un User-Agent identificable (política de uso).
// Como los pedidos se crean de a uno, en vez de un rate-limiter general
// basta con encolar las llamadas en una sola cadena secuencial, para
// nunca superar ese límite aunque lleguen a acumularse varias casi al
// mismo tiempo.
const USER_AGENT = 'AquiFueApp/1.0 (contacto@aquifue.com)';
const INTERVALO_MINIMO_MS = 1100;

let colaGeocodificacion = Promise.resolve();

async function geocodificar(direccion) {
  // Encadena esta llamada después de la anterior en la cola. .catch(() =>
  // {}) en la cola (no en el resultado que se devuelve) evita que un
  // rechazo acá rompa la cadena para las siguientes llamadas encoladas.
  const resultado = colaGeocodificacion.then(() => geocodificarInterno(direccion));
  colaGeocodificacion = resultado.catch(() => {});
  return resultado;
}

async function geocodificarInterno(direccion) {
  if (!direccion || !direccion.trim()) return null;

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(direccion)}&format=json&limit=1&countrycodes=co`;
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT }
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const lat = Number(data[0].lat);
    const lng = Number(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return { lat, lng };
  } catch (error) {
    // Una dirección sin geocodificar no debe tumbar nada — quien llama ya
    // trata null como "no se pudo ubicar", no como un error.
    console.error('Error geocodificando dirección:', error.message);
    return null;
  } finally {
    // La espera va en el finally (después de tener la respuesta) para no
    // demorar el resultado de ESTA llamada, pero sigue bloqueando la cola
    // el tiempo necesario antes de que arranque la siguiente.
    await new Promise(resolve => setTimeout(resolve, INTERVALO_MINIMO_MS));
  }
}

module.exports = { geocodificar };
