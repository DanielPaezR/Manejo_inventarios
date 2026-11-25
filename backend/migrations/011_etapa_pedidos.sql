-- Etapa de preparación de un pedido de cliente mientras está activo
-- (estado 'confirmado'): empacado -> en_camino (solo domicilios). NULL =
-- recibido, todavía sin empacar. 'completado' sigue siendo "entregado".
ALTER TABLE pedidos_cliente ADD COLUMN IF NOT EXISTS etapa VARCHAR(20);
ALTER TABLE pedidos_cliente ADD COLUMN IF NOT EXISTS fecha_empacado TIMESTAMP;
ALTER TABLE pedidos_cliente ADD COLUMN IF NOT EXISTS fecha_en_camino TIMESTAMP;
ALTER TABLE pedidos_cliente DROP CONSTRAINT IF EXISTS pedidos_cliente_etapa_valida;
ALTER TABLE pedidos_cliente ADD CONSTRAINT pedidos_cliente_etapa_valida CHECK (etapa IS NULL OR etapa IN ('empacado', 'en_camino'));
