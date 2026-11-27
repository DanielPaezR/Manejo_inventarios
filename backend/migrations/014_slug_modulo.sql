-- Enlace con nombre del menú público de cada módulo (ej. /menu/elixir en vez
-- de /menu/64). Los enlaces con el número siguen funcionando. Se llena al
-- arrancar el servidor (helpers/slugs.js) para los módulos que no lo tienen.
ALTER TABLE modulos ADD COLUMN IF NOT EXISTS slug VARCHAR(60);
CREATE UNIQUE INDEX IF NOT EXISTS modulos_slug_unico ON modulos (slug);
