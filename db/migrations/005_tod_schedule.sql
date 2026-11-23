-- ToD schedule for a plant and day, with fallbacks. DISCOM ToD tariffs are set per state / DISCOM /
-- category, but ergOS files them under some plant_id, and not every month may be loaded. So:
--   rows of this plant  >  same state + DISCOM + category  >  same state + DISCOM  >  same state
--   the day's month     >  the latest earlier month         >  the earliest later month
-- Runs as SECURITY DEFINER so it can read another plant's tariff rows, but only for a plant the
-- caller can see, and it returns only the schedule (block, ToD period, rates), never other plants' rows.
-- Safe to re-run.

SET client_min_messages = warning;

BEGIN;

CREATE OR REPLACE FUNCTION app_tod_schedule(p_plant integer, p_day date)
RETURNS TABLE (
  block       integer,
  tod         text,        -- as stored, e.g. PEAK / NORMAL / OFFPEAK
  grid_rate   float8,      -- ₹/kWh for the plant's voltage level, incl. FPPCA
  solar_rate  float8,      -- ₹/kWh from state_grid_solar_tariff (plant or its mapped generators), or null
  source      text         -- 'plant' | 'discom_category' | 'discom' | 'state'
  , src_year  integer,
  src_month   integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH p AS (
    SELECT pl.plant_id, lower(trim(pl.state)) AS state, lower(trim(coalesce(pl.discom, ''))) AS discom,
           lower(trim(coalesce(pl.category_code, ''))) AS category, lower(coalesce(pl.voltage_level, '')) AS voltage,
           extract(year FROM p_day)::int * 12 + extract(month FROM p_day)::int AS ym
    FROM plant pl
    WHERE pl.plant_id = p_plant
      AND pl.plant_id IN (SELECT app_accessible_plant_ids())          -- callers only get plants they can see
  ),
  cand AS (
    SELECT t.*,
           CASE WHEN t.plant_id = p.plant_id THEN 1
                WHEN lower(trim(t.discom)) = p.discom AND lower(trim(t.category_code)) = p.category THEN 2
                WHEN lower(trim(t.discom)) = p.discom THEN 3
                ELSE 4 END AS pri,
           CASE WHEN t.year * 12 + t.month <= p.ym THEN p.ym - (t.year * 12 + t.month)         -- same or earlier month
                ELSE 1000 + (t.year * 12 + t.month) - p.ym END AS dist                         -- later months last
    FROM state_grid_discom_tariff t CROSS JOIN p
    WHERE t.plant_id = p.plant_id OR lower(trim(t.state)) = p.state
  ),
  best AS (
    SELECT c.pri, c.plant_id AS src_plant, c.year, c.month
    FROM cand c ORDER BY c.pri, c.dist, c.plant_id LIMIT 1
  ),
  sched AS (
    SELECT DISTINCT ON (c.block) c.block, c.tod_type, c.pri, c.year, c.month,
           (CASE (SELECT voltage FROM p) WHEN '132_kv' THEN c.tariff_132_kv WHEN '66_kv' THEN c.tariff_66_kv ELSE c.tariff_33_kv END
            + coalesce(c.fppca_charge, 0))::float8 AS rate
    FROM cand c JOIN best b ON c.plant_id = b.src_plant AND c.year = b.year AND c.month = b.month
    WHERE c.block BETWEEN 1 AND 96
    ORDER BY c.block, c.id
  ),
  solar AS (
    SELECT DISTINCT ON (s.block) s.block, s.tod_price::float8 AS price
    FROM state_grid_solar_tariff s CROSS JOIN p
    WHERE s.block BETWEEN 1 AND 96
      AND (s.plant_id = p.plant_id
           OR s.plant_id IN (SELECT m.source_plant_id FROM plant_gen_con_mapping m WHERE m.target_plant_id = p.plant_id))
    ORDER BY s.block,
             CASE WHEN s.year * 12 + s.month <= p.ym THEN p.ym - (s.year * 12 + s.month) ELSE 1000 + (s.year * 12 + s.month) - p.ym END,
             (s.plant_id = p.plant_id) DESC, s.id
  )
  SELECT s.block, s.tod_type::text, s.rate, so.price,
         CASE s.pri WHEN 1 THEN 'plant' WHEN 2 THEN 'discom_category' WHEN 3 THEN 'discom' ELSE 'state' END,
         s.year, s.month
  FROM sched s LEFT JOIN solar so ON so.block = s.block
  ORDER BY s.block
$$;

REVOKE ALL ON FUNCTION app_tod_schedule(integer, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_tod_schedule(integer, date) TO ergos_view_app;

-- Supports the state lookup above.
CREATE INDEX IF NOT EXISTS sgdt_state_month_idx ON state_grid_discom_tariff (lower(trim(state)), year, month);

COMMIT;
