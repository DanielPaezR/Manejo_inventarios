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

// opciones.cerca = { lat, lng }: solo busca en unos 25 km alrededor (el
// local del negocio). Si ahí no la encuentra devuelve null: un resultado en
// otra ciudad es peor que dejar que el cliente ubique el pin.
async function geocodificar(direccion, opciones = {}) {
  // Encadena esta llamada después de la anterior en la cola. .catch(() =>
  // {}) en la cola (no en el resultado que se devuelve) evita que un
  // rechazo acá rompa la cadena para las siguientes llamadas encoladas.
  const resultado = colaGeocodificacion.then(() => geocodificarInterno(direccion, opciones));
  colaGeocodificacion = resultado.catch(() => {});
  return resultado;
}

// Ojo: Nominatim no entiende la placa colombiana ("# 20-30"), solo la
// calle: el resultado es un punto de esa calle, no la casa. Por eso el
// cliente siempre termina de ubicar el pin en el mapa.
async function geocodificarInterno(direccion, { cerca } = {}) {
  if (!direccion || !direccion.trim()) return null;

  const zona = cerca
    ? `&viewbox=${cerca.lng - 0.25},${cerca.lat + 0.25},${cerca.lng + 0.25},${cerca.lat - 0.25}&bounded=1`
    : '';
  try {
    return await consultarNominatim(direccion.trim(), zona);
  } finally {
    // La espera va en el finally (después de tener la respuesta) para no
    // demorar el resultado de ESTA llamada, pero sigue bloqueando la cola
    // el tiempo necesario antes de que arranque la siguiente.
    await new Promise(resolve => setTimeout(resolve, INTERVALO_MINIMO_MS));
  }
}

async function consultarNominatim(consulta, zona) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(consulta)}&format=json&limit=1&countrycodes=co${zona}`;
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
  }
}

module.exports = { geocodificar };
