-- Tariffs as ergOS billing uses them (ergOS calculate_combined): per block,
--   grid rate    = base rate for the plant's voltage level × (1 + FPPCA % / 100) × (1 + electricity duty % / 100)
--   solar rate   = state_grid_solar_tariff (mapped generator > plant > state), else master_solar_tariff
--   ToD type     = as stored (e.g. NORMAL, or numbered like normal_1 / normal_2)
--
-- Base ToD schedule & rate follow 006_master_tariffs: regulatory master first (state+DISCOM+category >
-- state+DISCOM > state, in effective window, nearest month), falling back to state_grid_discom_tariff when
-- the master has no rows for the state.
--
-- FPPCA % & electricity duty %:
--   * FPPCA %: the plant's own state_grid_discom_tariff row for that exact month > non-zero master FPPCA >
--     the plant's own latest earlier row within 3 months (for plants whose FPPCA override is carried in
--     state_grid_discom_tariff) > 0.
--   * Duty % : the plant's own row for that exact month (if non-null) > non-zero master duty > nearest
--     non-zero state_grid_discom_tariff duty (plant > DISCOM+category > DISCOM > state) > latest earlier
--     non-zero master duty for that state+DISCOM+category > 0.
--
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
  source       text,        -- master | master_discom | master_state | plant | discom_category | discom | state
  src_year     integer,
  src_month    integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH p AS (
    SELECT pl.plant_id,
           lower(trim(pl.state)) AS state,
           lower(trim(coalesce(pl.discom, ''))) AS discom,
           lower(trim(coalesce(pl.category_code, ''))) AS category,
           lower(coalesce(pl.voltage_level, '')) AS voltage,
           extract(year FROM p_day)::int AS yr,
           extract(month FROM p_day)::int AS mo,
           extract(year FROM p_day)::int * 12 + extract(month FROM p_day)::int AS ym,
           coalesce((SELECT m.source_plant_id FROM plant_gen_con_mapping m
                     WHERE m.target_plant_id = pl.plant_id AND m.is_active ORDER BY m.id LIMIT 1), pl.plant_id) AS solar_plant
    FROM plant pl
    WHERE pl.plant_id = p_plant AND pl.plant_id IN (SELECT app_accessible_plant_ids())
  ),
  -- Regulatory master (preferred for ToD schedule and base rates)
  mcand AS (
    SELECT m.id, m.block, m.tod_type, m.year, m.month,
           lower(trim(m.discom)) AS discom, lower(trim(m.category_code)) AS category,
           (CASE WHEN p.voltage LIKE '132%' THEN m.tariff_132_kv_inr_per_kwh
                 WHEN p.voltage LIKE '66%'  THEN m.tariff_66_kv_inr_per_kwh
                 ELSE m.tariff_33_kv_inr_per_kwh END)::float8 AS base,
           coalesce(m.fppca_charge_inr_per_kwh, 0)::float8 AS fppca,
           coalesce(m.electricity_duty_inr_per_kwh, 0)::float8 AS duty,
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
    SELECT pri, discom, category, year, month
    FROM mcand
    ORDER BY pri, off_window, dist, discom, category
    LIMIT 1
  ),
  msched AS (
    SELECT DISTINCT ON (c.block)
           c.block, c.tod_type::text AS tod, c.base, c.fppca, c.duty, c.pri, c.year, c.month
    FROM mcand c JOIN mbest b
      ON c.discom = b.discom AND c.category = b.category AND c.year = b.year AND c.month = b.month
    ORDER BY c.block, c.off_window, c.id
  ),
  -- ergOS rows fallback (only when master has nothing for the state)
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
  best AS (SELECT c.plant_id AS src_plant, c.year, c.month FROM cand c ORDER BY c.pri, c.dist, c.plant_id LIMIT 1),
  esched AS (
    SELECT DISTINCT ON (c.block) c.block, c.tod_type::text AS tod,
           (CASE WHEN (SELECT voltage FROM p) LIKE '132%' THEN c.tariff_132_kv
                 WHEN (SELECT voltage FROM p) LIKE '66%'  THEN c.tariff_66_kv
                 ELSE c.tariff_33_kv END)::float8 AS base,
           coalesce(c.fppca_charge, 0)::float8 AS fppca,
           coalesce(c.electricity_duty, 0)::float8 AS duty,
           c.pri, c.year, c.month
    FROM cand c JOIN best b ON c.plant_id = b.src_plant AND c.year = b.year AND c.month = b.month
    WHERE c.block BETWEEN 1 AND 96
    ORDER BY c.block, c.id
  ),
  sched AS (
    SELECT block, tod, base, fppca, duty, year, month,
           CASE pri WHEN 1 THEN 'master' WHEN 2 THEN 'master_discom' ELSE 'master_state' END AS source
    FROM msched
    UNION ALL
    SELECT block, tod, base, fppca, duty, year, month,
           CASE pri WHEN 1 THEN 'plant' WHEN 2 THEN 'discom_category' WHEN 3 THEN 'discom' ELSE 'state' END AS source
    FROM esched
  ),
  -- Plant-specific FPPCA / duty from state_grid_discom_tariff (exact month, or recent <= 3 months)
  own_exact AS (
    SELECT t.fppca_charge::float8 AS fppca, t.electricity_duty::float8 AS duty
    FROM state_grid_discom_tariff t CROSS JOIN p
    WHERE t.plant_id = p.plant_id AND t.year = p.yr AND t.month = p.mo AND t.block BETWEEN 1 AND 96
    ORDER BY t.id LIMIT 1
  ),
  own_recent AS (
    SELECT t.fppca_charge::float8 AS fppca, t.electricity_duty::float8 AS duty
    FROM state_grid_discom_tariff t CROSS JOIN p
    WHERE t.plant_id = p.plant_id AND t.block BETWEEN 1 AND 96
      AND t.year * 12 + t.month <= p.ym
      AND p.ym - (t.year * 12 + t.month) <= 3
    ORDER BY (t.year * 12 + t.month) DESC, t.id LIMIT 1
  ),
  -- Nearest non-zero duty for the plant / DISCOM / state when the month's master row has duty = 0
  duty_fb AS (
    SELECT coalesce(
      (SELECT t.electricity_duty::float8
       FROM state_grid_discom_tariff t CROSS JOIN p
       WHERE (t.plant_id = p.plant_id OR lower(trim(t.state)) = p.state)
         AND t.block BETWEEN 1 AND 96
         AND coalesce(t.electricity_duty, 0) <> 0
       ORDER BY
         CASE WHEN t.plant_id = p.plant_id THEN 1
              WHEN lower(trim(t.discom)) = p.discom AND lower(trim(t.category_code)) = p.category THEN 2
              WHEN lower(trim(t.discom)) = p.discom THEN 3
              ELSE 4 END,
         CASE WHEN t.year * 12 + t.month <= p.ym THEN p.ym - (t.year * 12 + t.month)
              ELSE 1000 + (t.year * 12 + t.month) - p.ym END,
         t.id
       LIMIT 1),
      (SELECT m.duty FROM mcand m CROSS JOIN p
       WHERE m.duty <> 0 AND m.year * 12 + m.month <= p.ym
       ORDER BY m.pri, (p.ym - (m.year * 12 + m.month)), m.id
       LIMIT 1),
      0.0
    ) AS duty
  ),
  -- Solar: plant's / mapped generator's state_grid_solar_tariff first, else master_solar_tariff
  psolar AS (
    SELECT DISTINCT ON (s.block) s.block, s.tod_price::float8 AS price
    FROM state_grid_solar_tariff s CROSS JOIN p
    WHERE s.block BETWEEN 1 AND 96
      AND (s.plant_id = p.solar_plant OR s.plant_id = p.plant_id OR (s.plant_id IS NULL AND lower(trim(s.state)) = p.state))
    ORDER BY s.block,
             CASE WHEN s.plant_id = p.solar_plant THEN 1 WHEN s.plant_id = p.plant_id THEN 2 ELSE 3 END,
             CASE WHEN s.year * 12 + s.month <= p.ym THEN p.ym - (s.year * 12 + s.month) ELSE 1000 + (s.year * 12 + s.month) - p.ym END,
             s.id
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
  ),
  eff AS (
    SELECT s.block, s.tod, s.base,
           coalesce(
             (SELECT oe.fppca FROM own_exact oe),
             CASE WHEN s.fppca <> 0 THEN s.fppca ELSE (SELECT orw.fppca FROM own_recent orw) END,
             0.0
           )::float8 AS fppca,
           coalesce(
             (SELECT oe.duty FROM own_exact oe WHERE oe.duty IS NOT NULL),
             CASE WHEN s.duty <> 0 THEN s.duty ELSE (SELECT df.duty FROM duty_fb df) END,
             0.0
           )::float8 AS duty,
           coalesce(ps.price, ms.price) AS solar_rate,
           s.source, s.year, s.month
    FROM sched s
    LEFT JOIN psolar ps ON ps.block = s.block
    LEFT JOIN msolar ms ON ms.block = s.block
  )
  SELECT e.block, e.tod, e.base, e.fppca, e.duty,
         e.base * (1 + e.fppca / 100.0) * (1 + e.duty / 100.0),
         e.solar_rate, e.source, e.year, e.month
  FROM eff e
  ORDER BY e.block
$$;

REVOKE ALL ON FUNCTION app_bill_tariff(integer, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_bill_tariff(integer, date) TO ergos_view_app;

COMMIT;
