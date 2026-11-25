-- Tariffs as ergOS billing uses them (ergOS calculate_combined): per block, from ergOS's own tariff rows
--   grid rate    = tariff for the plant's voltage level × (1 + FPPCA % / 100) × (1 + electricity duty % / 100)
--   solar rate   = state_grid_solar_tariff of the mapped generation plant (else the plant itself)
--   ToD type     = as stored (e.g. NORMAL, or numbered like normal_1 / normal_2)
-- Which rows are used, in order (assumed until checked against ergOS fetch_all_block_tariffs_for_period):
--   the plant's own rows > same DISCOM + category > same DISCOM > same state; the day's month first,
--   then the nearest earlier month, then the nearest later one.
-- RLS-safe: SECURITY DEFINER, returns rows only for plants the caller can see. Safe to re-run.

SET client_min_messages = warning;
BEGIN;

CREATE OR REPLACE FUNCTION app_bill_tariff(p_plant integer, p_day date)
RETURNS TABLE (
  block        integer,
  tod          text,
  base_rate    float8,      -- ₹/kWh for the voltage level, before FPPCA and duty
  fppca_pct    float8,
  duty_pct     float8,
  grid_rate    float8,      -- base × (1 + fppca/100) × (1 + duty/100)
  solar_rate   float8,
  source       text,        -- plant | discom_category | discom | state
  src_year     integer,
  src_month    integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH p AS (
    SELECT pl.plant_id, lower(trim(pl.state)) AS state, lower(trim(coalesce(pl.discom, ''))) AS discom,
           lower(trim(coalesce(pl.category_code, ''))) AS category, lower(coalesce(pl.voltage_level, '')) AS voltage,
           extract(year FROM p_day)::int * 12 + extract(month FROM p_day)::int AS ym,
           coalesce((SELECT m.source_plant_id FROM plant_gen_con_mapping m
                     WHERE m.target_plant_id = pl.plant_id AND m.is_active ORDER BY m.id LIMIT 1), pl.plant_id) AS solar_plant
    FROM plant pl
    WHERE pl.plant_id = p_plant AND pl.plant_id IN (SELECT app_accessible_plant_ids())
  ),
  cand AS (
    SELECT t.*,
           CASE WHEN t.plant_id = p.plant_id THEN 1
                WHEN lower(trim(t.discom)) = p.discom AND lower(trim(t.category_code)) = p.category THEN 2
                WHEN lower(trim(t.discom)) = p.discom THEN 3
                ELSE 4 END AS pri,
           CASE WHEN t.year * 12 + t.month <= p.ym THEN p.ym - (t.year * 12 + t.month)
                ELSE 1000 + (t.year * 12 + t.month) - p.ym END AS dist
    FROM state_grid_discom_tariff t CROSS JOIN p
    WHERE t.plant_id = p.plant_id OR lower(trim(t.state)) = p.state
  ),
  best AS (SELECT c.plant_id AS src_plant, c.year, c.month FROM cand c ORDER BY c.pri, c.dist, c.plant_id LIMIT 1),
  sched AS (
    SELECT DISTINCT ON (c.block) c.block, c.tod_type::text AS tod, c.pri, c.year, c.month,
           (CASE WHEN (SELECT voltage FROM p) LIKE '132%' THEN c.tariff_132_kv
                 WHEN (SELECT voltage FROM p) LIKE '66%'  THEN c.tariff_66_kv
                 ELSE c.tariff_33_kv END)::float8 AS base,
           coalesce(c.fppca_charge, 0)::float8 AS fppca, coalesce(c.electricity_duty, 0)::float8 AS duty
    FROM cand c JOIN best b ON c.plant_id = b.src_plant AND c.year = b.year AND c.month = b.month
    WHERE c.block BETWEEN 1 AND 96
    ORDER BY c.block, c.id
  ),
  solar AS (
    SELECT DISTINCT ON (s.block) s.block, s.tod_price::float8 AS price
    FROM state_grid_solar_tariff s CROSS JOIN p
    WHERE s.block BETWEEN 1 AND 96
      AND (s.plant_id = p.solar_plant OR s.plant_id = p.plant_id OR (s.plant_id IS NULL AND lower(trim(s.state)) = p.state))
    ORDER BY s.block,
             CASE WHEN s.plant_id = p.solar_plant THEN 1 WHEN s.plant_id = p.plant_id THEN 2 ELSE 3 END,
             CASE WHEN s.year * 12 + s.month <= p.ym THEN p.ym - (s.year * 12 + s.month) ELSE 1000 + (s.year * 12 + s.month) - p.ym END,
             s.id
  )
  SELECT s.block, s.tod, s.base, s.fppca, s.duty,
         s.base * (1 + s.fppca / 100.0) * (1 + s.duty / 100.0),
         so.price,
         CASE s.pri WHEN 1 THEN 'plant' WHEN 2 THEN 'discom_category' WHEN 3 THEN 'discom' ELSE 'state' END,
         s.year, s.month
  FROM sched s LEFT JOIN solar so ON so.block = s.block
  ORDER BY s.block
$$;

REVOKE ALL ON FUNCTION app_bill_tariff(integer, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_bill_tariff(integer, date) TO ergos_view_app;

COMMIT;
