-- Recordatorios por negocio en un solo lugar:
-- { cierre: { activo, hora }, pedidos: { activo }, pagos: { activo } }
ALTER TABLE modulos ADD COLUMN IF NOT EXISTS recordatorios JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Reemplazada por "recordatorios" antes de usarse.
ALTER TABLE modulos DROP COLUMN IF EXISTS recordatorio_cierre;
