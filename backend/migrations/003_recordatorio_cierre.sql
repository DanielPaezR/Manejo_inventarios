-- Recordatorio de cierre de caja: { activo: bool, hora: 18..23 }
ALTER TABLE modulos ADD COLUMN IF NOT EXISTS recordatorio_cierre JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Días en que se hizo el cierre (aunque no haya sobrado plata para la cartera).
CREATE TABLE IF NOT EXISTS cierres_caja_dia (
  modulo_id INTEGER NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  hecho_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (modulo_id, fecha)
);
