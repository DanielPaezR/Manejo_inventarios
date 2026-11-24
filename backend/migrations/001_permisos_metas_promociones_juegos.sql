-- Cambios que antes se corrían a mano. Son idempotentes (IF NOT EXISTS):
-- en una base que ya los tiene no hacen nada; en una base nueva los crean.

-- Permisos por trabajador
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permisos JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Metas y resumen semanal
ALTER TABLE modulos ADD COLUMN IF NOT EXISTS metas JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE modulos ADD COLUMN IF NOT EXISTS resumen_semanal JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS resumen_envios (
  id SERIAL PRIMARY KEY,
  modulo_id INTEGER NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
  semana DATE NOT NULL,
  canal VARCHAR(20) NOT NULL,
  destino TEXT NOT NULL,
  ok BOOLEAN NOT NULL DEFAULT false,
  detalle TEXT,
  fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (modulo_id, semana, canal, destino)
);

-- Promociones (combos)
CREATE TABLE IF NOT EXISTS promociones (
  id SERIAL PRIMARY KEY,
  modulo_id INTEGER NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
  nombre VARCHAR(120) NOT NULL,
  descripcion TEXT,
  precio NUMERIC(12,2) NOT NULL CHECK (precio > 0),
  foto_url TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  fecha_inicio DATE,
  fecha_fin DATE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS promocion_items (
  id SERIAL PRIMARY KEY,
  promocion_id INTEGER NOT NULL REFERENCES promociones(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  cantidad INTEGER NOT NULL CHECK (cantidad > 0)
);
CREATE INDEX IF NOT EXISTS idx_promociones_modulo ON promociones(modulo_id);
CREATE INDEX IF NOT EXISTS idx_promocion_items_promo ON promocion_items(promocion_id);
ALTER TABLE detalle_venta
  ADD COLUMN IF NOT EXISTS promocion_id INTEGER REFERENCES promociones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promocion_nombre VARCHAR(120);
ALTER TABLE pedidos_cliente_detalle
  ADD COLUMN IF NOT EXISTS promocion_id INTEGER REFERENCES promociones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promocion_nombre VARCHAR(120);

-- Zona de juegos
CREATE TABLE IF NOT EXISTS juego_puntajes (
  id SERIAL PRIMARY KEY,
  modulo_id INTEGER NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
  juego VARCHAR(30) NOT NULL,
  nombre VARCHAR(20) NOT NULL,
  avatar VARCHAR(16) NOT NULL,
  puntaje INTEGER NOT NULL CHECK (puntaje > 0),
  duracion_seg INTEGER,
  ip_hash VARCHAR(64),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_juego_puntajes_podio ON juego_puntajes (modulo_id, juego, puntaje DESC);
CREATE INDEX IF NOT EXISTS idx_juego_puntajes_fecha ON juego_puntajes (modulo_id, creado_en);
ALTER TABLE modulos ADD COLUMN IF NOT EXISTS juegos_activos BOOLEAN NOT NULL DEFAULT true;
