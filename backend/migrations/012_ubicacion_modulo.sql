-- Ubicación del local de cada módulo: centra el mapa del cliente al pedir a
-- domicilio y hace que la búsqueda de direcciones prefiera las cercanas.
ALTER TABLE modulos ADD COLUMN IF NOT EXISTS ubicacion_lat NUMERIC(10, 7);
ALTER TABLE modulos ADD COLUMN IF NOT EXISTS ubicacion_lng NUMERIC(10, 7);
