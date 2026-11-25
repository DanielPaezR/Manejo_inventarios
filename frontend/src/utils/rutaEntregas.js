// Cálculos de la Ruta de entregas: distancias y el orden sugerido de las
// paradas saliendo de la tienda. Son distancias en línea recta (no por
// calles): sirven para decidir el orden, no para medir el recorrido exacto.

const RADIO_TIERRA_KM = 6371;
const rad = (g) => (g * Math.PI) / 180;

export const distanciaKm = (a, b) => {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.sqrt(h));
};

// Largo del recorrido: inicio -> puntos[0] -> ... -> último.
export const largoRuta = (inicio, puntos) => {
  let total = 0;
  let anterior = inicio;
  for (const p of puntos) {
    if (anterior) total += distanciaKm(anterior, p);
    anterior = p;
  }
  return total;
};

// Hasta 8 paradas se prueban todos los órdenes (con poda): da el más corto.
const MAX_EXACTO = 8;

const ordenExacto = (inicio, puntos) => {
  let mejorKm = Infinity;
  let mejor = null;
  const usado = new Array(puntos.length).fill(false);
  const camino = [];
  const buscar = (anterior, km) => {
    if (km >= mejorKm) return;
    if (camino.length === puntos.length) {
      mejorKm = km;
      mejor = [...camino];
      return;
    }
    for (let i = 0; i < puntos.length; i++) {
      if (usado[i]) continue;
      usado[i] = true;
      camino.push(puntos[i]);
      buscar(puntos[i], km + (anterior ? distanciaKm(anterior, puntos[i]) : 0));
      camino.pop();
      usado[i] = false;
    }
  };
  buscar(inicio, 0);
  return mejor;
};

// Orden sugerido (más de 8 paradas): primero "la más cercana que falte" desde la tienda y
// luego se mejora invirtiendo tramos mientras acorte el recorrido (2-opt).
// Con las pocas paradas de un día queda muy cerca del mejor orden posible.
// `puntos`: [{ id, lat, lng }]; `inicio`: { lat, lng } | null (sin tienda,
// arranca en la primera parada). Devuelve los mismos objetos reordenados.
export const ordenarParadas = (inicio, puntos) => {
  if (puntos.length < 2) return [...puntos];
  if (puntos.length <= MAX_EXACTO) return ordenExacto(inicio, puntos);

  const pendientes = [...puntos];
  const orden = [];
  let actual = inicio || pendientes.shift();
  if (!inicio) orden.push(actual);
  while (pendientes.length) {
    let mejor = 0;
    for (let i = 1; i < pendientes.length; i++) {
      if (distanciaKm(actual, pendientes[i]) < distanciaKm(actual, pendientes[mejor])) mejor = i;
    }
    actual = pendientes.splice(mejor, 1)[0];
    orden.push(actual);
  }

  // 2-opt sobre un recorrido abierto que sale de `inicio` (fijo).
  const fijo = inicio ? 0 : 1;
  let mejoro = true;
  let vueltas = 0;
  while (mejoro && vueltas < 50) {
    mejoro = false;
    vueltas++;
    for (let i = fijo; i < orden.length - 1; i++) {
      for (let k = i + 1; k < orden.length; k++) {
        const antes = i === 0 ? inicio : orden[i - 1];
        const despues = orden[k + 1];
        const actualKm = distanciaKm(antes, orden[i]) + (despues ? distanciaKm(orden[k], despues) : 0);
        const nuevoKm = distanciaKm(antes, orden[k]) + (despues ? distanciaKm(orden[i], despues) : 0);
        if (nuevoKm + 1e-9 < actualKm) {
          const tramo = orden.slice(i, k + 1).reverse();
          orden.splice(i, tramo.length, ...tramo);
          mejoro = true;
        }
      }
    }
  }
  return orden;
};

// Google Maps acepta hasta 9 paradas intermedias en el enlace (en el
// celular); con más, se abre hasta la décima y se avisa.
export const MAX_PARADAS_GOOGLE = 10;

export const enlaceRutaGoogle = (inicio, puntos) => {
  const usar = puntos.slice(0, MAX_PARADAS_GOOGLE);
  if (usar.length === 0) return '';
  const txt = (p) => `${p.lat},${p.lng}`;
  const destino = usar[usar.length - 1];
  const intermedias = usar.slice(0, -1);
  const params = new URLSearchParams({ api: '1', destination: txt(destino), travelmode: 'driving' });
  if (inicio) params.set('origin', txt(inicio));
  if (intermedias.length) params.set('waypoints', intermedias.map(txt).join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
};
