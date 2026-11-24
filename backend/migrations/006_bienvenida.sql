-- Asistente de bienvenida (primeros pasos): { oculto: bool, compartido: bool }
ALTER TABLE modulos ADD COLUMN IF NOT EXISTS bienvenida JSONB NOT NULL DEFAULT '{}'::jsonb;
