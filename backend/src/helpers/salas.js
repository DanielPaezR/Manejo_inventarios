// Jugar entre clientes: salas de Tres en raya con un código de 4 letras.
// Cada jugador tiene un token secreto (guardado en su celular) que lo
// identifica en la sala; los demás nunca lo ven. El estado se consulta
// cada segundo (sin websockets) y cada jugada sube la versión, así dos
// jugadas al mismo tiempo no se pisan. Las salas viejas se borran solas.
const crypto = require('crypto');
const { limpiarNombre, AVATARES } = require('./juegos');

const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I ni O para no confundir
const HORAS_VIDA = 6;
const LINEAS = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

const nuevoCodigo = () => Array.from(crypto.randomBytes(4), b => LETRAS[b % LETRAS.length]).join('');
const nuevoToken = () => crypto.randomBytes(16).toString('hex');
const limpiarCodigo = (c) => String(c || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8);

const ganadorDe = (t) => {
  for (const [a, b, c] of LINEAS) if (t[a] && t[a] === t[b] && t[a] === t[c]) return { quien: t[a], linea: [a, b, c] };
  return t.every(Boolean) ? { quien: 'empate', linea: [] } : null;
};

const estadoInicial = (empieza = 'X', marcador = { X: 0, O: 0, empates: 0 }) => ({
  tablero: Array(9).fill(null), turno: empieza, empezo: empieza, resultado: null, marcador
});

// Límite por IP para crear salas: 15 cada 10 minutos.
const creadasPorIp = new Map();
const puedeCrear = (ip) => {
  const ahora = Date.now();
  const recientes = (creadasPorIp.get(ip) || []).filter(t => ahora - t < 10 * 60 * 1000);
  if (recientes.length >= 15) return false;
  recientes.push(ahora);
  creadasPorIp.set(ip, recientes);
  if (creadasPorIp.size > 5000) creadasPorIp.clear();
  return true;
};

const jugador = (body) => {
  const { nombre, error } = limpiarNombre(body.nombre);
  if (error) return { error };
  return { datos: { nombre, avatar: AVATARES.includes(body.avatar) ? body.avatar : AVATARES[0], token: nuevoToken() } };
};

// Lo que ve cada jugador: sin tokens, con "yo" = X, O o null (espectador).
const vista = (sala, token) => ({
  codigo: sala.codigo,
  juego: sala.juego,
  version: sala.version,
  estado: sala.estado,
  x: { nombre: sala.jugador_x.nombre, avatar: sala.jugador_x.avatar },
  o: sala.jugador_o ? { nombre: sala.jugador_o.nombre, avatar: sala.jugador_o.avatar } : null,
  yo: token && sala.jugador_x.token === token ? 'X' : token && sala.jugador_o?.token === token ? 'O' : null
});

async function leerSala(pool, moduloId, codigo) {
  const { rows: [sala] } = await pool.query(
    `SELECT * FROM juego_salas WHERE modulo_id = $1 AND codigo = $2
       AND actualizado_en > now() - ($3 || ' hours')::interval`,
    [moduloId, limpiarCodigo(codigo), HORAS_VIDA]);
  return sala || null;
}

async function crearSala(pool, moduloId, ip, body) {
  if (body.juego && body.juego !== 'triqui') return { status: 400, error: 'Juego no disponible para jugar en línea' };
  const j = jugador(body);
  if (j.error) return { status: 400, error: j.error };
  if (!puedeCrear(ip)) return { status: 429, error: 'Creaste muchas salas seguidas. Espera unos minutos.' };
  await pool.query(`DELETE FROM juego_salas WHERE actualizado_en < now() - ($1 || ' hours')::interval`, [HORAS_VIDA]);
  for (let intento = 0; intento < 6; intento++) {
    const codigo = nuevoCodigo();
    const { rows: [sala] } = await pool.query(
      `INSERT INTO juego_salas (modulo_id, codigo, juego, estado, jugador_x)
       VALUES ($1, $2, 'triqui', $3, $4) ON CONFLICT (codigo) DO NOTHING RETURNING *`,
      [moduloId, codigo, JSON.stringify(estadoInicial()), JSON.stringify(j.datos)]);
    if (sala) return { status: 201, datos: { token: j.datos.token, sala: vista(sala, j.datos.token) } };
  }
  return { status: 503, error: 'No se pudo crear la sala, intenta de nuevo' };
}

async function unirse(pool, moduloId, codigo, body) {
  const sala = await leerSala(pool, moduloId, codigo);
  if (!sala) return { status: 404, error: 'No encontramos esa sala. Revisa el código.' };
  // Volver a entrar desde el mismo celular.
  if (body.token && (sala.jugador_x.token === body.token || sala.jugador_o?.token === body.token)) {
    return { status: 200, datos: { token: body.token, sala: vista(sala, body.token) } };
  }
  if (sala.jugador_o) return { status: 409, error: 'Esa sala ya tiene dos jugadores' };
  const j = jugador(body);
  if (j.error) return { status: 400, error: j.error };
  const { rows: [nueva] } = await pool.query(
    `UPDATE juego_salas SET jugador_o = $1, version = version + 1, actualizado_en = now()
     WHERE id = $2 AND jugador_o IS NULL RETURNING *`,
    [JSON.stringify(j.datos), sala.id]);
  if (!nueva) return { status: 409, error: 'Esa sala ya tiene dos jugadores' };
  return { status: 200, datos: { token: j.datos.token, sala: vista(nueva, j.datos.token) } };
}

async function consultar(pool, moduloId, codigo, token) {
  const sala = await leerSala(pool, moduloId, codigo);
  if (!sala) return { status: 404, error: 'La sala ya no existe' };
  return { status: 200, datos: vista(sala, token) };
}

// Guarda el nuevo estado solo si nadie más jugó entretanto (versión).
async function guardar(pool, sala, estado) {
  const { rows: [nueva] } = await pool.query(
    `UPDATE juego_salas SET estado = $1, version = version + 1, actualizado_en = now()
     WHERE id = $2 AND version = $3 RETURNING *`,
    [JSON.stringify(estado), sala.id, sala.version]);
  return nueva;
}

async function jugar(pool, moduloId, codigo, token, casilla) {
  const sala = await leerSala(pool, moduloId, codigo);
  if (!sala) return { status: 404, error: 'La sala ya no existe' };
  const yo = vista(sala, token).yo;
  if (!yo) return { status: 403, error: 'No eres jugador de esta sala' };
  if (!sala.jugador_o) return { status: 409, error: 'Espera a que entre tu rival' };
  const e = sala.estado;
  const i = Number(casilla);
  if (e.resultado) return { status: 409, error: 'La partida terminó' };
  if (e.turno !== yo) return { status: 409, error: 'No es tu turno' };
  if (!Number.isInteger(i) || i < 0 || i > 8 || e.tablero[i]) return { status: 400, error: 'Casilla no válida' };

  const tablero = [...e.tablero];
  tablero[i] = yo;
  const resultado = ganadorDe(tablero);
  const marcador = { ...e.marcador };
  if (resultado) {
    if (resultado.quien === 'empate') marcador.empates += 1;
    else marcador[resultado.quien] += 1;
  }
  const nueva = await guardar(pool, sala, { ...e, tablero, turno: yo === 'X' ? 'O' : 'X', resultado, marcador });
  if (!nueva) return { status: 409, error: 'Tu rival jugó al mismo tiempo, intenta de nuevo' };
  return { status: 200, datos: vista(nueva, token) };
}

// Otra partida: empieza quien no empezó la anterior; el marcador sigue.
async function revancha(pool, moduloId, codigo, token) {
  const sala = await leerSala(pool, moduloId, codigo);
  if (!sala) return { status: 404, error: 'La sala ya no existe' };
  if (!vista(sala, token).yo) return { status: 403, error: 'No eres jugador de esta sala' };
  if (!sala.estado.resultado) return { status: 200, datos: vista(sala, token) }; // ya empezó otra
  const empieza = sala.estado.empezo === 'X' ? 'O' : 'X';
  const nueva = await guardar(pool, sala, estadoInicial(empieza, sala.estado.marcador));
  const actual = nueva || await leerSala(pool, moduloId, codigo);
  return { status: 200, datos: vista(actual, token) };
}

module.exports = { crearSala, unirse, consultar, jugar, revancha, ganadorDe };
