-- Regulatory master tariffs (ergos_master_db) copied into the reporting database, and the ToD schedule
-- lookup that prefers them.
--
-- The master DB keeps one row per state / DISCOM / category / month / block, bitemporally:
--   effective_from / effective_to   when the tariff applies
--   recorded_at / superseded_at     when we learned it; superseded rows are corrections we no longer believe
-- The sync copies only rows with superseded_at IS NULL, for the states of plants in this database, and
-- replaces the whole copy each slow run, so corrections and deletions in the master come through.
--
-- app_tod_schedule(plant, day) now picks, in order:
--   1. master, same state + DISCOM + category          source 'master'
--   2. master, same state + DISCOM                     source 'master_discom'
--   3. master, same state                              source 'master_state'
--   4. the ergOS rows used before (plant, DISCOM+category, DISCOM, state)
-- Within a level: rows effective on the day first, then the day's month, then the nearest earlier month,
-- then the nearest later one. Grid rate = energy rate for the plant's voltage + FPPCA (electricity duty
-- excluded, as before). Solar rate: the plant's own (or mapped generator's) solar tariff, else the master.
--
-- Client users never read these tables directly; they only get a plant's schedule through the function,
-- which checks app_accessible_plant_ids(). Safe to re-run.

SET client_min_messages = warning;

BEGIN;

CREATE TABLE IF NOT EXISTS master_grid_discom_tariff (
  id                            integer PRIMARY KEY,
  country                       varchar(100),
  state                         varchar(100),
  discom                        varchar(100),
  category_name                 varchar(100),
  category_code                 varchar(50),
  year                          integer,
  month                         integer,
  block                         integer,
  tod_type                      text,          -- enum in the master DB; stored as its label
  tariff_33_kv_inr_per_kwh      numeric,
  tariff_66_kv_inr_per_kwh      numeric,
  tariff_132_kv_inr_per_kwh     numeric,
  electricity_duty_inr_per_kwh  numeric,
  fppca_charge_inr_per_kwh      numeric,
  effective_from                timestamptz,
  effective_to                  timestamptz,
  recorded_at                   timestamptz,
  superseded_at                 timestamptz
);

CREATE TABLE IF NOT EXISTS master_solar_tariff (
  id                     integer PRIMARY KEY,
  country                varchar(100),
  state                  varchar(100),
  discom                 varchar(100),
  category_name          varchar(100),
  category_code          varchar(50),
  year                   integer,
  month                  integer,
  block                  integer,
  tod_type               text,
  tod_price_inr_per_kwh  numeric,
  effective_from         timestamptz,
  effective_to           timestamptz,
  recorded_at            timestamptz,
  superseded_at          timestamptz
);

CREATE INDEX IF NOT EXISTS mgdt_state_month_idx ON master_grid_discom_tariff (lower(trim(state)), year, month);
CREATE INDEX IF NOT EXISTS mst_state_month_idx  ON master_solar_tariff (lower(trim(state)), year, month);

-- reference data, but still: no direct access for the app role; RLS on with no policies
ALTER TABLE master_grid_discom_tariff ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_solar_tariff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON master_grid_discom_tariff, master_solar_tariff FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ergos_view_app') THEN
    EXECUTE 'REVOKE ALL ON master_grid_discom_tariff, master_solar_tariff FROM ergos_view_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON master_grid_discom_tariff, master_solar_tariff FROM anon, authenticated';
  END IF;
END $$;

-- same signature and columns as 005; only the body changes
CREATE OR REPLACE FUNCTION app_tod_schedule(p_plant integer, p_day date)
RETURNS TABLE (
  block       integer,
  tod         text,
  grid_rate   float8,
  solar_rate  float8,
  source      text,        -- master | master_discom | master_state | plant | discom_category | discom | state
  src_year    integer,
  src_month   integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH p AS (
    SELECT pl.plant_id, lower(trim(pl.state)) AS state, lower(trim(coalesce(pl.discom, ''))) AS discom,
           lower(trim(coalesce(pl.category_code, ''))) AS category, lower(coalesce(pl.voltage_level, '')) AS voltage,
           extract(year FROM p_day)::int * 12 + extract(month FROM p_day)::int AS ym
    FROM plant pl
    WHERE pl.plant_id = p_plant
      AND pl.plant_id IN (SELECT app_accessible_plant_ids())
  ),
  -- master rows in the plant's state, ranked
  mcand AS (
    SELECT m.id, m.block, m.tod_type, m.year, m.month,
           lower(trim(m.discom)) AS discom, lower(trim(m.category_code)) AS category,
           CASE (SELECT voltage FROM p) WHEN '132_kv' THEN m.tariff_132_kv_inr_per_kwh
                                        WHEN '66_kv'  THEN m.tariff_66_kv_inr_per_kwh
                                        ELSE m.tariff_33_kv_inr_per_kwh END
             + coalesce(m.fppca_charge_inr_per_kwh, 0) AS rate,
           CASE WHEN lower(trim(m.discom)) = p.discom AND lower(trim(m.category_code)) = p.category THEN 1
                WHEN lower(trim(m.discom)) = p.discom THEN 2
                ELSE 3 END AS pri,
           CASE WHEN (m.effective_from IS NULL OR m.effective_from::date <= p_day)
                 AND (m.effective_to IS NULL OR m.effective_to::date > p_day) THEN 0 ELSE 1 END AS off_window,
           CASE WHEN m.year * 12 + m.month <= p.ym THEN p.ym - (m.year * 12 + m.month)
                ELSE 1000 + (m.year * 12 + m.month) - p.ym END AS dist
    FROM master_grid_discom_tariff m CROSS JOIN p
    WHERE lower(trim(m.state)) = p.state AND m.superseded_at IS NULL AND m.block BETWEEN 1 AND 96
  ),
  mbest AS (
    SELECT pri, discom, category, year, month FROM mcand
    ORDER BY pri, off_window, dist, discom, category LIMIT 1
  ),
  msched AS (
    SELECT DISTINCT ON (c.block) c.block, c.tod_type, c.rate, c.pri, c.year, c.month
    FROM mcand c JOIN mbest b
      ON c.discom = b.discom AND c.category = b.category AND c.year = b.year AND c.month = b.month
    ORDER BY c.block, c.off_window, c.id
  ),
  -- ergOS rows (the 005 logic), used only when the master has nothing for the state
  cand AS (
    SELECT t.*,
           CASE WHEN t.plant_id = p.plant_id THEN 1
                WHEN lower(trim(t.discom)) = p.discom AND lower(trim(t.category_code)) = p.category THEN 2
                WHEN lower(trim(t.discom)) = p.discom THEN 3
                ELSE 4 END AS pri,
           CASE WHEN t.year * 12 + t.month <= p.ym THEN p.ym - (t.year * 12 + t.month)
                ELSE 1000 + (t.year * 12 + t.month) - p.ym END AS dist
    FROM state_grid_discom_tariff t CROSS JOIN p
    WHERE (t.plant_id = p.plant_id OR lower(trim(t.state)) = p.state)
      AND NOT EXISTS (SELECT 1 FROM msched)
  ),
  best AS (
    SELECT c.pri, c.plant_id AS src_plant, c.year, c.month FROM cand c ORDER BY c.pri, c.dist, c.plant_id LIMIT 1
  ),
  esched AS (
    SELECT DISTINCT ON (c.block) c.block, c.tod_type::text AS tod_type,
           (CASE (SELECT voltage FROM p) WHEN '132_kv' THEN c.tariff_132_kv WHEN '66_kv' THEN c.tariff_66_kv ELSE c.tariff_33_kv END
            + coalesce(c.fppca_charge, 0)) AS rate, c.pri, c.year, c.month
    FROM cand c JOIN best b ON c.plant_id = b.src_plant AND c.year = b.year AND c.month = b.month
    WHERE c.block BETWEEN 1 AND 96
    ORDER BY c.block, c.id
  ),
  sched AS (
    SELECT block, tod_type, rate::float8 AS rate, year, month,
           CASE pri WHEN 1 THEN 'master' WHEN 2 THEN 'master_discom' ELSE 'master_state' END AS source
    FROM msched
    UNION ALL
    SELECT block, tod_type, rate::float8, year, month,
           CASE pri WHEN 1 THEN 'plant' WHEN 2 THEN 'discom_category' WHEN 3 THEN 'discom' ELSE 'state' END
    FROM esched
  ),
  -- solar: the plant's own / mapped generator's tariff first, then the master
  psolar AS (
    SELECT DISTINCT ON (s.block) s.block, s.tod_price::float8 AS price
    FROM state_grid_solar_tariff s CROSS JOIN p
    WHERE s.block BETWEEN 1 AND 96
      AND (s.plant_id = p.plant_id
           OR s.plant_id IN (SELECT m.source_plant_id FROM plant_gen_con_mapping m WHERE m.target_plant_id = p.plant_id))
    ORDER BY s.block,
             CASE WHEN s.year * 12 + s.month <= p.ym THEN p.ym - (s.year * 12 + s.month) ELSE 1000 + (s.year * 12 + s.month) - p.ym END,
             (s.plant_id = p.plant_id) DESC, s.id
  ),
  msolar AS (
    SELECT DISTINCT ON (s.block) s.block, s.tod_price_inr_per_kwh::float8 AS price
    FROM master_solar_tariff s CROSS JOIN p
    WHERE s.block BETWEEN 1 AND 96 AND s.superseded_at IS NULL AND lower(trim(s.state)) = p.state
    ORDER BY s.block,
             CASE WHEN lower(trim(s.discom)) = p.discom AND lower(trim(s.category_code)) = p.category THEN 1
                  WHEN lower(trim(s.discom)) = p.discom THEN 2 ELSE 3 END,
             CASE WHEN (s.effective_from IS NULL OR s.effective_from::date <= p_day)
                   AND (s.effective_to IS NULL OR s.effective_to::date > p_day) THEN 0 ELSE 1 END,
             CASE WHEN s.year * 12 + s.month <= p.ym THEN p.ym - (s.year * 12 + s.month) ELSE 1000 + (s.year * 12 + s.month) - p.ym END,
             s.id
  )
  SELECT s.block, s.tod_type, s.rate, coalesce(ps.price, ms.price), s.source, s.year, s.month
  FROM sched s
  LEFT JOIN psolar ps ON ps.block = s.block
  LEFT JOIN msolar ms ON ms.block = s.block
  ORDER BY s.block
$$;

REVOKE ALL ON FUNCTION app_tod_schedule(integer, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_tod_schedule(integer, date) TO ergos_view_app;

COMMIT;
