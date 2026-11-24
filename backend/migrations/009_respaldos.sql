-- Copias de seguridad automáticas de toda la base (JSON comprimido).
CREATE TABLE IF NOT EXISTS respaldos (
  id SERIAL PRIMARY KEY,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  origen VARCHAR(12) NOT NULL DEFAULT 'automatico', -- 'automatico' | 'manual'
  tablas INTEGER NOT NULL,
  filas INTEGER NOT NULL,
  tamano_bytes INTEGER NOT NULL,
  datos BYTEA NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_respaldos_fecha ON respaldos (creado_en DESC);
