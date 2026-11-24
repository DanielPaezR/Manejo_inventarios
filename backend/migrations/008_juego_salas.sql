-- Salas para jugar entre clientes (en celulares distintos) con un código.
CREATE TABLE IF NOT EXISTS juego_salas (
  id SERIAL PRIMARY KEY,
  modulo_id INTEGER NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
  codigo VARCHAR(8) NOT NULL UNIQUE,
  juego VARCHAR(30) NOT NULL,
  estado JSONB NOT NULL,
  jugador_x JSONB NOT NULL,
  jugador_o JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_juego_salas_actualizado ON juego_salas (actualizado_en);
