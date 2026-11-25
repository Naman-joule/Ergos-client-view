-- ergOS's daily savings statement (iex_tod_daily_obligation) records the loss and charge rates it applied that
-- day. Keep them in the client view too, so Billing can price exchange energy with the same rates ergOS used.
-- The sync copies every column both sides have, so after this runs the next sync fills them in; no data is
-- generated here. Re-runnable.
ALTER TABLE iex_tod_daily_obligation
  ADD COLUMN IF NOT EXISTS trading_entity        varchar(200),
  ADD COLUMN IF NOT EXISTS distribution_loss_pct numeric,
  ADD COLUMN IF NOT EXISTS ctu_loss_pct          numeric,
  ADD COLUMN IF NOT EXISTS stu_loss_pct          numeric,
  ADD COLUMN IF NOT EXISTS css_rate_per_kwh      numeric,
  ADD COLUMN IF NOT EXISTS electricity_duty_pct  numeric;
