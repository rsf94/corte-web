-- Add web-first ownership key for expenses.
ALTER TABLE `gastos.expenses`
ADD COLUMN user_id STRING;

-- Recomendación (futuro): configurar clustering por (user_id, purchase_date)
-- para mejorar costos y performance de consultas en dashboard web-first.
