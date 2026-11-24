-- Plan de suscripción de cada negocio. NULL = sin límites (los negocios que
-- ya existían siguen igual hasta que se les asigne un plan).
ALTER TABLE negocios ADD COLUMN IF NOT EXISTS plan VARCHAR(20);
ALTER TABLE negocios DROP CONSTRAINT IF EXISTS negocios_plan_valido;
ALTER TABLE negocios ADD CONSTRAINT negocios_plan_valido CHECK (plan IS NULL OR plan IN ('emprende', 'negocio', 'multisede'));
