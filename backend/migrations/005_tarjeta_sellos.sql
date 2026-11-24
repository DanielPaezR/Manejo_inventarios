-- Tarjeta de sellos digital: { activo, meta, premio, minimo }
ALTER TABLE modulos ADD COLUMN IF NOT EXISTS sellos JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Cada sello ganado (+1) o premio entregado (-meta) por teléfono del cliente.
CREATE TABLE IF NOT EXISTS sellos_movimientos (
  id SERIAL PRIMARY KEY,
  modulo_id INTEGER NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
  telefono VARCHAR(20) NOT NULL,
  cantidad INTEGER NOT NULL,
  tipo VARCHAR(12) NOT NULL, -- 'pedido' | 'manual' | 'canje'
  pedido_cliente_id INTEGER UNIQUE REFERENCES pedidos_cliente(id) ON DELETE SET NULL,
  nombre VARCHAR(120),
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sellos_modulo_telefono ON sellos_movimientos (modulo_id, telefono);
