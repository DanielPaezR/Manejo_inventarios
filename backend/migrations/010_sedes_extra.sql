-- Sedes adicionales compradas aparte (plan Multisede: $39.900/mes cada una).
-- Se suman al límite de sedes del plan.
ALTER TABLE negocios ADD COLUMN IF NOT EXISTS sedes_extra INTEGER NOT NULL DEFAULT 0;
