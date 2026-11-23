"""Which ergOS tables are copied into the reporting database, and how.

Order matters: tables are synced in list order inside one target transaction, so a
table's foreign-key parents always come first.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Mode = Literal["upsert", "window", "replace"]
Source = Literal["ergos", "master"]

EVERY = frozenset({"fast", "slow"})
FAST = frozenset({"fast"})
SLOW = frozenset({"slow"})


@dataclass(frozen=True)
class Table:
    name: str
    mode: Mode
    tiers: frozenset[str]
    pk: tuple[str, ...]
    # window mode: rows with date_column >= today(IST) - window_days are replaced
    date_column: str | None = None
    window_days: int | None = None          # None -> SYNC_WINDOW_DAYS
    # facts are only copied for plants already present in the target
    plant_column: str | None = None
    plant_nullable: bool = False            # also copy rows whose plant column is NULL
    # extra SQL filter on the source query. May use %(plants)s, %(headers)s, %(since)s
    extra_where: str | None = None
    # which database the rows come from: ergOS (ERGOS_DATABASE_URL) or the regulatory master
    # (MASTER_DATABASE_URL). Master tables are skipped when MASTER_DATABASE_URL is not set.
    source: Source = "ergos"


TABLES: tuple[Table, ...] = (
    # ---- every run: tenancy and lookups ------------------------------------------------
    Table("client", "upsert", EVERY, ("client_id",)),
    Table("plant_type", "upsert", EVERY, ("id",)),
    Table("plant", "upsert", EVERY, ("plant_id",)),
    Table("markets", "upsert", EVERY, ("id",)),
    Table("market_types", "upsert", EVERY, ("id",)),
    Table("plant_gen_con_mapping", "upsert", EVERY, ("id",),
          plant_column="target_plant_id", extra_where="source_plant_id = ANY(%(plants)s)"),

    # ---- slow tier (hourly): charges and tariffs -------------------------------------------
    Table("plant_open_access_charges", "upsert", SLOW, ("id",),
          plant_column="plant_id", plant_nullable=True),
    Table("state_grid_discom_tariff", "upsert", SLOW, ("id",),
          plant_column="plant_id",
          extra_where="year >= extract(year FROM current_date)::int - 1"),
    Table("state_grid_solar_tariff", "upsert", SLOW, ("id",),
          plant_column="plant_id", plant_nullable=True,
          extra_where="year >= extract(year FROM current_date)::int - 1"),

    # regulatory master (ergos_master_db): current rows only, for the states of plants we hold.
    # "replace" deletes the whole copy and reloads it, so corrections and deletions come through.
    Table("master_grid_discom_tariff", "replace", SLOW, ("id",), source="master",
          extra_where="superseded_at IS NULL AND lower(trim(state)) = ANY(%(states)s)"
                      " AND year >= extract(year FROM current_date)::int - 1"),
    Table("master_solar_tariff", "replace", SLOW, ("id",), source="master",
          extra_where="superseded_at IS NULL AND lower(trim(state)) = ANY(%(states)s)"
                      " AND year >= extract(year FROM current_date)::int - 1"),

    # ---- fast tier (every 15 minutes): rolling windows ----------------------------------------
    Table("plant_processed_meter_data", "window", FAST, ("id",),
          date_column="date", plant_column="plant_id"),
    Table("trading_result", "window", FAST, ("id",),
          date_column="date", plant_column="plant_id"),
    # only blocks whose header was copied in this run (prevents FK failures on orphans)
    Table("trading_result_block", "window", FAST, ("id",),
          date_column="date", plant_column="plant_id",
          extra_where="trading_result_id = ANY(%(headers)s)"),
    Table("prebid_plan", "window", FAST, ("id",),          # includes future dates (date >= since)
          date_column="date", plant_column="plant_id"),
    Table("banking", "window", FAST, ("id",),
          date_column="date", plant_column="plant_id"),
    Table("optimization_results", "window", FAST, ("id",),
          date_column="date", plant_column="plant_id"),
    # savings are recalculated for a while after the trade day, so keep a 10-day window
    Table("iex_tod_daily_obligation", "window", FAST, ("id",),
          date_column="trade_date", window_days=10, plant_column="plant_id", plant_nullable=True),
)

BY_NAME = {t.name: t for t in TABLES}
