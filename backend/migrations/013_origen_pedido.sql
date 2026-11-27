-- De dónde vino el pedido de cliente: 'menu' (lo hizo el cliente en el
-- menú en línea) o 'manual' (lo registró el negocio, ej. por WhatsApp).
ALTER TABLE pedidos_cliente ADD COLUMN IF NOT EXISTS origen VARCHAR(20) NOT NULL DEFAULT 'menu';
