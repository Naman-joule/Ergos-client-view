-- =============================================================================
-- DEMO DATA FOR A LOCAL / DEV DATABASE ONLY. NEVER RUN THIS AGAINST PRODUCTION.
-- =============================================================================
-- Fictional clients and plants, all ids start at 900001. Remove with demo_cleanup.sql.
-- Users (password for all: demo-password):
--   admin@demo.example     admin
--   manager@demo.example   manager, mapped to both clients
--   cement@demo.example    client_user, Demo Cement Ltd
--   films@demo.example     client_user, Demo Flexi Films
--   k2only@demo.example    client_user, Demo Cement Ltd but only plant DEMO CEMENT K2
-- Data: the last 30 days plus today up to the last completed IST block.
-- Requires 001-003 migrations. Run as the owner (it writes synced tables).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN PERFORM setseed(0.42); END $$;

-- Time anchors (IST)
CREATE TEMP TABLE demo_clock ON COMMIT DROP AS
SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date                                  AS today,
       floor(extract(epoch FROM ((now() AT TIME ZONE 'Asia/Kolkata')
             - (now() AT TIME ZONE 'Asia/Kolkata')::date)) / 900)::int             AS done_blocks; -- completed blocks today

-- Days covered: today-30 .. today
CREATE TEMP TABLE demo_days ON COMMIT DROP AS
SELECT d::date AS d, (c.today - d::date) AS ago
FROM demo_clock c, generate_series(c.today - 30, c.today, interval '1 day') d;

-- ---------------------------------------------------------------------------
-- Tenancy and lookups
-- ---------------------------------------------------------------------------
INSERT INTO client (client_id, name, email, key_contact_person, contact_number, alias_name, is_active) VALUES
  (900001, 'Demo Cement Ltd',  'ops@democement.example', 'Asha Verma', '+91 90000 00001', 'Demo Cement', true),
  (900002, 'Demo Flexi Films', 'ops@demofilms.example',  'Ravi Nair',  '+91 90000 00002', 'Demo Films',  true);

INSERT INTO plant_type (id, type, sub_type, description) VALUES
  (900001, 'consumer',  'cement',          'Cement grinding unit'),
  (900002, 'consumer',  'flexi_packaging', 'Flexible packaging films'),
  (900003, 'generator', 'solar',           'Captive solar');

INSERT INTO plant (plant_id, client_id, plant_type_id, name, state, discom, connected_load, voltage_level,
                   category_code, category_name, ct_pt_ratio, energy_multiplier, iex_contract_limit_kwh,
                   is_auto_trading_enabled, is_active) VALUES
  (900001, 900001, 900001, 'DEMO CEMENT K1', 'Rajasthan',     'JVVNL', 5.0, '132_kv', 'HT-5', 'Large industrial', '200/1', 1.0, 2500, true,  true),
  (900002, 900001, 900001, 'DEMO CEMENT K2', 'Rajasthan',     'JVVNL', 3.5, '66_kv',  'HT-5', 'Large industrial', '100/1', 1.0, 1500, false, true),
  (900003, 900002, 900002, 'DEMO FILMS F1',  'Uttar Pradesh', 'PVVNL', 2.5, '33_kv',  'HV-2', 'Industrial',       '100/1', 1.0, 1000, false, true),
  (900004, 900002, 900002, 'DEMO FILMS F2',  'Uttar Pradesh', 'PVVNL', 1.8, '33_kv',  'HV-2', 'Industrial',       '50/1',  1.0,  750, false, true),
  (900005, 900001, 900003, 'DEMO SOLAR S1',  'Rajasthan',     'JVVNL', 1.5, '33_kv',  'GEN',  'Captive solar',    '50/1',  1.0, NULL, false, true);

INSERT INTO markets (id, name) VALUES (900001, 'IEX');
INSERT INTO market_types (id, market_id, name, start_time, end_time, result_time) VALUES
  (900001, 900001, 'DAM',  '10:00', '12:00', '13:00'),
  (900002, 900001, 'RTM',  '00:00', '23:59', NULL),
  (900003, 900001, 'GDAM', '10:00', '12:00', '13:00');

INSERT INTO plant_gen_con_mapping (id, source_plant_id, target_plant_id, s_t_ratio, source_capacity, target_capacity,
                                   is_active, is_banking_enabled) VALUES
  (900001, 900005, 900001, 0.95, 1.5, 5.0, true, true);

-- Demo plant shape parameters (kW)
CREATE TEMP TABLE demo_shape ON COMMIT DROP AS
SELECT * FROM (VALUES
  (900001, 1, 1900.0, 4300.0, 2.0, 'DEMO-PF-K1'),
  (900002, 2, 1300.0, 3000.0, 1.2, 'DEMO-PF-K2'),
  (900003, 3,  700.0, 2100.0, 0.8, 'DEMO-PF-F1'),
  (900004, 4,  500.0, 1500.0, 0.6, 'DEMO-PF-F2')
) AS t(plant_id, idx, base_kw, day_kw, dam_mw, portfolio_id);

-- ---------------------------------------------------------------------------
-- Meter data: consumer curves + solar bell curve. Timestamps mark interval END.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE demo_meter ON COMMIT DROP AS
WITH blocks AS (
  SELECT dd.d, dd.ago, b
  FROM demo_days dd CROSS JOIN generate_series(1, 96) b, demo_clock c
  WHERE dd.d < c.today OR b <= c.done_blocks
), consumer AS (
  SELECT s.plant_id, s.idx, bl.d, bl.b,
         greatest(0, (
           s.base_kw
           + (s.day_kw - s.base_kw) * (
               CASE WHEN bl.b < 25 THEN 0
                    WHEN bl.b < 33 THEN (bl.b - 25) / 8.0          -- 06:00-08:00 ramp up
                    WHEN bl.b <= 76 THEN 1
                    WHEN bl.b < 85 THEN (85 - bl.b) / 8.0          -- 19:00-21:00 ramp down
                    ELSE 0 END)
             * CASE WHEN bl.b BETWEEN 49 AND 52 THEN 0.68 ELSE 1 END  -- lunch dip 12:00-13:00
           ) * CASE WHEN extract(isodow FROM bl.d) = 7 THEN 0.62 ELSE 1 END  -- Sundays lower
             * (0.95 + random() * 0.1)) AS kw
  FROM demo_shape s CROSS JOIN blocks bl
), solar AS (
  SELECT 900005 AS plant_id, 5 AS idx, bl.d, bl.b,
         CASE WHEN bl.b BETWEEN 25 AND 76
              THEN 1450 * exp(-power((bl.b - 50.5) / 11.0, 2))
                   * (0.72 + 0.28 * ((hashtext(bl.d::text) & 255) / 255.0))
              ELSE 0 END AS kw
  FROM blocks bl
)
SELECT * FROM consumer UNION ALL SELECT * FROM solar;

INSERT INTO plant_processed_meter_data (id, plant_id, date, meter_timestamp, kwh, kwh_delta, kvah, cumulative_pf, flags)
SELECT 900000000000 + m.idx * 100000000
         + (m.d - date '2000-01-01') * 100 + m.b                                  AS id,
       m.plant_id, m.d,
       ((m.d + make_interval(mins => m.b * 15)) AT TIME ZONE 'Asia/Kolkata')        AS meter_timestamp,
       round((sum(m.kw / 4) OVER (PARTITION BY m.plant_id ORDER BY m.d, m.b) + 100000)::numeric, 3),
       round((m.kw / 4)::numeric, 3),
       round((m.kw / 4 / 0.96)::numeric, 3),
       0.96,
       'real'
FROM demo_meter m;

-- ---------------------------------------------------------------------------
-- DAM trades, blocks 37-64 (09:00-16:00), every day incl. today. Price in ₹/MWh.
-- Day 5 ago is an expensive day, so one day shows negative savings.
-- ---------------------------------------------------------------------------
INSERT INTO trading_result (id, plant_id, date, market_type_id, result_data)
SELECT 900001 + (s.idx - 1) * 100 + dd.ago, s.plant_id, dd.d, 900001,
       jsonb_build_object('status', 'cleared', 'exchange', 'IEX', 'portfolio_id', s.portfolio_id)
FROM demo_shape s CROSS JOIN demo_days dd;

CREATE TEMP TABLE demo_trade ON COMMIT DROP AS
SELECT tr.id AS trading_result_id, s.plant_id, s.idx, tr.date, b AS block_no, s.portfolio_id,
       round((s.dam_mw * (0.9 + random() * 0.1))::numeric, 3)::float8 AS mw,
       round(((CASE WHEN tr.date = (SELECT today FROM demo_clock) - 5
                    THEN 9200 ELSE 3600 END)
              + 900 * sin((b - 37) / 27.0 * pi()) + random() * 400)::numeric, 2)::float8 AS price_mwh
FROM trading_result tr JOIN demo_shape s ON s.plant_id = tr.plant_id
CROSS JOIN generate_series(37, 64) b
WHERE tr.id BETWEEN 900001 AND 909999;

INSERT INTO trading_result_block (id, trading_result_id, plant_id, date, block_no, cleared_quantity_mw, cleared_quantity,
                                  cleared_price, landed_cost, landed_cost_rs_per_kwh, portfolio_id, type_)
SELECT trading_result_id::bigint * 100 + block_no, trading_result_id, plant_id, date, block_no,
       mw, mw * 250, price_mwh,
       round((mw * 250 * (price_mwh / 1000 + 1.10))::numeric, 4),
       round((price_mwh / 1000 + 1.10)::numeric, 4),
       portfolio_id, 'BUY'
FROM demo_trade;

-- ---------------------------------------------------------------------------
-- Prebid plans for today and tomorrow: {"blocks":[{"block":n,"mw":x,"price":y}]}
-- ---------------------------------------------------------------------------
INSERT INTO prebid_plan (id, plant_id, date, market_type, exhange_name, prebid_plan_data)
SELECT 900001 + (s.idx - 1) * 10 + k, s.plant_id, c.today + k, 'DAM', 'IEX',
       jsonb_build_object('blocks', (
         SELECT jsonb_agg(jsonb_build_object('block', b, 'mw', s.dam_mw,
                                             'price', round((4000 + 900 * sin((b - 37) / 27.0 * pi()))::numeric, 0))
                          ORDER BY b)
         FROM generate_series(37, 64) b))
FROM demo_shape s CROSS JOIN demo_clock c CROSS JOIN generate_series(0, 1) k;

-- ---------------------------------------------------------------------------
-- Banking for DEMO CEMENT K1: charge midday solar surplus, discharge in the evening peak
-- ---------------------------------------------------------------------------
INSERT INTO banking (id, plant_id, date, block, charge, discharge, adjusted_discharge, soc,
                     peak_balance, normal_balance, offpeak_balance, tod_type)
SELECT 900001 + (dd.ago * 96) + (b - 1), 900001, dd.d, b,
       ch, dis, round((dis * 0.97)::numeric, 3),
       round(sum(ch - dis) OVER (PARTITION BY dd.d ORDER BY b)::numeric + 400, 3),
       round(greatest(0, 600 - sum(dis) OVER (PARTITION BY dd.d ORDER BY b) * 0.4)::numeric, 3),
       round((300 + sum(ch) OVER (PARTITION BY dd.d ORDER BY b) * 0.5)::numeric, 3),
       round((200 + sum(ch) OVER (PARTITION BY dd.d ORDER BY b) * 0.2)::numeric, 3),
       CASE WHEN b BETWEEN 69 AND 92 THEN 'PEAK' WHEN b <= 24 THEN 'OFFPEAK' ELSE 'NORMAL' END
FROM demo_days dd CROSS JOIN demo_clock c CROSS JOIN generate_series(1, 96) b
CROSS JOIN LATERAL (SELECT CASE WHEN b BETWEEN 41 AND 60 THEN round((60 + random() * 20)::numeric, 3) ELSE 0 END::float8 AS ch,
                           CASE WHEN b BETWEEN 73 AND 88 THEN round((70 + random() * 15)::numeric, 3) ELSE 0 END::float8 AS dis) x
WHERE dd.d < c.today OR b <= c.done_blocks;

-- ---------------------------------------------------------------------------
-- DISCOM ToD tariffs, this month and last month (₹/kWh)
-- ---------------------------------------------------------------------------
INSERT INTO state_grid_discom_tariff (id, plant_id, country, state, discom, category_name, category_code, year, month,
                                      block, tod_type, tariff_33_kv, tariff_66_kv, tariff_132_kv, electricity_duty, fppca_charge)
SELECT 900001 + (s.idx - 1) * 1000 + mo.k * 100 + (b - 1), s.plant_id, 'India', p.state, p.discom, p.category_name, p.category_code,
       extract(year FROM mo.m)::int, extract(month FROM mo.m)::int, b, tod.t,
       round((tod.f * 7.20)::numeric, 4), round((tod.f * 7.05)::numeric, 4), round((tod.f * 6.90)::numeric, 4),
       7.5, 0.35
FROM demo_shape s JOIN plant p ON p.plant_id = s.plant_id
CROSS JOIN (SELECT 0 AS k, date_trunc('month', today) AS m FROM demo_clock
            UNION ALL SELECT 1, date_trunc('month', today) - interval '1 month' FROM demo_clock) mo
CROSS JOIN generate_series(1, 96) b
CROSS JOIN LATERAL (SELECT CASE WHEN b BETWEEN 69 AND 92 THEN 'PEAK' WHEN b <= 24 THEN 'OFFPEAK' ELSE 'NORMAL' END AS t,
                           CASE WHEN b BETWEEN 69 AND 92 THEN 1.20 WHEN b <= 24 THEN 0.85 ELSE 1.0 END AS f) tod;

INSERT INTO plant_open_access_charges (id, plant_id, portfolio_id, effective_from, ctu_rate_per_mwh, stu_rate_per_mwh,
                                       distribution_rate_per_mwh, sldc_charge, fees_rate_per_mwh, nldc_app_fee)
SELECT 900000 + s.idx, s.plant_id, s.portfolio_id, date '2026-01-01', 300, 280, 220, 20, 50, 5000
FROM demo_shape s;

-- ---------------------------------------------------------------------------
-- Locked daily savings for past days, computed from the trades above.
-- Charges total ₹1.10 / kWh, split per column; grid benchmark from the ToD tariff.
-- ---------------------------------------------------------------------------
INSERT INTO iex_tod_daily_obligation (
  id, plant_id, portfolio_id, trade_date, client_name, plant_name,
  volume_cleared_kwh, units_mwh, iex_energy_charge, iex_total_cost, avg_landed_iex_tariff,
  ctu_transmission_charges, stu_transmission_charges, distribution_charges, nldc_application_fees, nldc_scheduling_buy,
  sldc_scheduling_charges, fees, igst, css,
  grid_energy_cost, electricity_duty_amount, grid_total_cost, avg_grid_tariff,
  net_savings_per_day, percent_below_grid, pdf_report_path, zip_bundle_path, raw_summary, is_locked)
SELECT 900001 + (s.idx - 1) * 100 + (c.today - agg.date),
       s.plant_id, s.portfolio_id, agg.date, cl.name, p.name,
       agg.vol, agg.vol / 1000, agg.energy, agg.energy + agg.vol * 1.10, (agg.energy + agg.vol * 1.10) / agg.vol,
       agg.vol * 0.30, agg.vol * 0.28, agg.vol * 0.22, agg.vol * 0.01, agg.vol * 0.01,
       agg.vol * 0.02, agg.vol * 0.05, agg.vol * 0.01, agg.vol * 0.20,
       agg.grid, agg.grid * 0.075, agg.grid * 1.075, agg.grid * 1.075 / agg.vol,
       agg.grid * 1.075 - (agg.energy + agg.vol * 1.10),
       round(((agg.grid * 1.075 - (agg.energy + agg.vol * 1.10)) / (agg.grid * 1.075) * 100)::numeric, 4),
       CASE WHEN s.idx = 1 THEN 'https://reports.example.com/demo/' || s.portfolio_id || '/' || agg.date || '.pdf'
            ELSE '/var/ergos/reports/' || s.portfolio_id || '/' || agg.date || '.pdf' END,
       NULL,
       jsonb_build_object('source', 'demo_seed'),
       true
FROM demo_shape s
JOIN plant p ON p.plant_id = s.plant_id
JOIN client cl ON cl.client_id = p.client_id
CROSS JOIN demo_clock c
JOIN LATERAL (
  SELECT tb.date,
         sum(tb.cleared_quantity)::numeric                                AS vol,
         sum(tb.cleared_quantity * tb.cleared_price / 1000)::numeric      AS energy,
         sum(tb.cleared_quantity * (CASE p.voltage_level WHEN '132_kv' THEN t.tariff_132_kv
                                                         WHEN '66_kv'  THEN t.tariff_66_kv
                                                         ELSE t.tariff_33_kv END + t.fppca_charge))::numeric AS grid
  FROM trading_result_block tb
  JOIN state_grid_discom_tariff t ON t.plant_id = tb.plant_id AND t.block = tb.block_no
       AND t.year = extract(year FROM tb.date) AND t.month = extract(month FROM tb.date)
  WHERE tb.plant_id = s.plant_id AND tb.date < c.today
  GROUP BY tb.date
) agg ON true;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
INSERT INTO "user" (id, email, name, password_hash, role_id, is_active)
SELECT v.id, v.email, v.name, crypt('demo-password', gen_salt('bf', 10)), r.id, true
FROM (VALUES
  (900001, 'admin@demo.example',   'Demo Admin',    'admin'),
  (900002, 'manager@demo.example', 'Meera Manager', 'manager'),
  (900003, 'cement@demo.example',  'Chetan Cement', 'client_user'),
  (900004, 'films@demo.example',   'Fatima Films',  'client_user'),
  (900005, 'k2only@demo.example',  'Kiran K2',      'client_user')
) v(id, email, name, role) JOIN role r ON r.name = v.role;

INSERT INTO user_client_map (id, user_id, client_id) VALUES
  (900001, 900002, 900001), (900002, 900002, 900002),
  (900003, 900003, 900001),
  (900004, 900004, 900002),
  (900005, 900005, 900001);

INSERT INTO user_plant_map (id, user_id, plant_id, user_role) VALUES
  (900001, 900005, 900002, 'viewer');

-- ---------------------------------------------------------------------------
-- Per-client layout: Demo Flexi Films gets the Volt palette and no banking widget
-- ---------------------------------------------------------------------------
INSERT INTO dashboard_config (id, client_id, version, status, spec, note, created_by) VALUES
  (900001, 900002, 1, 'published', $json$
  {
    "version": 1,
    "theme": { "palette": "volt", "mode": "dark" },
    "pages": {
      "today": { "widgets": [
        { "type": "today.tiles", "span": "full", "tiles": ["demand", "grid", "iex", "peak"] },
        { "type": "today.supply", "span": "full" },
        { "type": "today.prebid", "span": "full", "title": "Bid against cleared" }
      ] },
      "savings": { "widgets": [
        { "type": "savings.folder", "span": "wide" },
        { "type": "savings.tiles", "span": "narrow", "tiles": ["volume", "landed", "benchmark"] },
        { "type": "savings.daily", "span": "full" },
        { "type": "savings.charges", "span": "full" },
        { "type": "savings.tod", "span": "full" },
        { "type": "savings.table", "span": "full" }
      ] }
    }
  }
  $json$::jsonb, 'Demo: Volt palette, no banking', 900001);

COMMIT;
