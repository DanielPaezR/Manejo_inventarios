-- Moderación del podio y premio semanal para el campeón de cada juego.
ALTER TABLE juego_puntajes
  ADD COLUMN IF NOT EXISTS oculto BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS codigo VARCHAR(12),
  ADD COLUMN IF NOT EXISTS premio_canjeado_en TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_juego_puntajes_codigo ON juego_puntajes (modulo_id, codigo);

-- { activo: bool, descripcion: texto del premio }
ALTER TABLE modulos ADD COLUMN IF NOT EXISTS premio_juegos JSONB NOT NULL DEFAULT '{}'::jsonb;
