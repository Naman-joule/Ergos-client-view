"""ergOS -> reporting database sync.

    python sync.py --tier fast                 # every 15 minutes
    python sync.py --tier slow                 # hourly
    python sync.py --tier fast --backfill-days 40
    python sync.py --tier fast --tables banking,prebid_plan --dry-run
    python sync.py --freshness                 # exit 1 if the last good fast run is stale

Environment:
    ERGOS_DATABASE_URL   read-only ergOS user
    TARGET_DATABASE_URL  reporting DB as owner (Supabase session pooler, port 5432)
    SYNC_WINDOW_DAYS     default 2
    SYNC_STALE_MINUTES   default 35

One target transaction per tier: every table or none. Values are read as ::text and
streamed with COPY, so nothing is converted in Python.
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import os
import sys
import time
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import find_dotenv, load_dotenv
import psycopg
from psycopg import sql

# Ensure sync directory is in sys.path
sync_dir = Path(__file__).resolve().parent
if str(sync_dir) not in sys.path:
    sys.path.insert(0, str(sync_dir))

# Load .env file from current directory, sync directory, or project root
load_dotenv(find_dotenv(usecwd=True))
load_dotenv(sync_dir / ".env")
load_dotenv(sync_dir.parent / ".env")

from tables import BY_NAME, TABLES, Table

IST = ZoneInfo("Asia/Kolkata")
LOCK_KEY = 0x45435653  # "ECVS": one lock for all tiers, so runs never overlap
RUN_MARKER = "__run__"  # sync_runs row describing the whole tier run
BATCH = 5000

log = logging.getLogger("sync")


class SyncError(RuntimeError):
    pass


# ---------------------------------------------------------------------------- helpers
def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None or value == "":
        raise SystemExit(f"{name} is not set")
    return value


def today_ist() -> dt.date:
    return dt.datetime.now(IST).date()


def columns(conn: psycopg.Connection, table: str) -> dict[str, tuple[bool, bool]]:
    """column -> (not_null, has_default), in ordinal order."""
    rows = conn.execute(
        """
        SELECT column_name, is_nullable = 'NO', column_default IS NOT NULL OR is_identity = 'YES'
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
        ORDER BY ordinal_position
        """,
        (table,),
    ).fetchall()
    return {r[0]: (r[1], r[2]) for r in rows}


class RunLog:
    """Writes sync_runs through its own autocommit connection, so rows survive a rollback."""

    def __init__(self, url: str, tier: str, dry_run: bool):
        self.conn = psycopg.connect(url, autocommit=True)
        self.tier = tier
        self.dry_run = dry_run
        self.ids: list[int] = []

    def start(self, table: str, window_from: dt.date | None) -> int:
        rid = self.conn.execute(
            "INSERT INTO sync_runs (tier, table_name, window_from, status) VALUES (%s, %s, %s, 'running') RETURNING id",
            (self.tier, table, window_from),
        ).fetchone()[0]
        self.ids.append(rid)
        return rid

    def finish(self, rid: int, status: str, rows: int | None = None, error: str | None = None) -> None:
        if self.dry_run and status == "ok":
            error = "dry run: rolled back"
        self.conn.execute(
            "UPDATE sync_runs SET status = %s, rows_written = %s, error = %s, finished_at = now() WHERE id = %s",
            (status, rows, error, rid),
        )

    def mark_rolled_back(self, reason: str) -> None:
        if self.ids:
            self.conn.execute(
                """UPDATE sync_runs SET status = 'error', error = %s, finished_at = coalesce(finished_at, now())
                   WHERE id = ANY(%s) AND status IN ('ok', 'running')""",
                (f"rolled back: {reason}", self.ids),
            )

    def close(self) -> None:
        self.conn.close()


# ---------------------------------------------------------------------------- one table
def plan_columns(t: Table, src: psycopg.Connection, tgt: psycopg.Connection) -> list[str] | None:
    scols = columns(src, t.name)
    tcols = columns(tgt, t.name)
    if not tcols:
        raise SyncError(f"{t.name}: table missing in target")
    if not scols:
        return None  # skipped
    only_src = [c for c in scols if c not in tcols]
    only_tgt = [c for c in tcols if c not in scols]
    if only_src:
        log.info("%s: source-only columns ignored: %s", t.name, ", ".join(only_src))
    if only_tgt:
        log.info("%s: target-only columns left to defaults: %s", t.name, ", ".join(only_tgt))
    required = [c for c in only_tgt if tcols[c][0] and not tcols[c][1]]
    if required:
        raise SyncError(f"{t.name}: required target column(s) missing in source: {', '.join(required)}")
    missing_pk = [c for c in t.pk if c not in scols]
    if missing_pk:
        raise SyncError(f"{t.name}: primary key column(s) missing in source: {', '.join(missing_pk)}")
    return [c for c in tcols if c in scols]  # target order


def source_query(t: Table, cols: list[str], since: dt.date | None) -> sql.Composed:
    select = sql.SQL(", ").join(sql.SQL("{}::text").format(sql.Identifier(c)) for c in cols)
    where: list[sql.Composable] = []
    if t.mode == "window":
        where.append(sql.SQL("{} >= %(since)s").format(sql.Identifier(t.date_column)))
    if t.plant_column:
        cond = sql.SQL("{} = ANY(%(plants)s)").format(sql.Identifier(t.plant_column))
        if t.plant_nullable:
            cond = sql.SQL("({} IS NULL OR {})").format(sql.Identifier(t.plant_column), cond)
        where.append(cond)
    if t.extra_where:
        where.append(sql.SQL("(" + t.extra_where + ")"))
    q = sql.SQL("SELECT {} FROM {}").format(select, sql.Identifier(t.name))
    if where:
        q += sql.SQL(" WHERE ") + sql.SQL(" AND ").join(where)
    return q


def stream_copy(src: psycopg.Connection, tgt: psycopg.Connection, query: sql.Composed, params: dict,
                dest: sql.Composable, cols: list[str]) -> int:
    n = 0
    copy_sql = sql.SQL("COPY {} ({}) FROM STDIN").format(dest, sql.SQL(", ").join(map(sql.Identifier, cols)))
    with src.cursor(name="ecv_sync_src") as scur, tgt.cursor() as tcur:
        scur.itersize = BATCH
        scur.execute(query, params)
        with tcur.copy(copy_sql) as copy:
            while True:
                rows = scur.fetchmany(BATCH)
                if not rows:
                    break
                for row in rows:
                    copy.write_row(row)
                n += len(rows)
    return n


def sync_table(t: Table, src: psycopg.Connection, tgt: psycopg.Connection, runlog: RunLog,
               window_days: int, backfill: int | None) -> None:
    since = None
    if t.mode == "window":
        days = backfill if backfill is not None else (t.window_days or window_days)
        since = today_ist() - dt.timedelta(days=days)
    rid = runlog.start(t.name, since)
    started = time.monotonic()
    try:
        cols = plan_columns(t, src, tgt)
        if cols is None:
            log.warning("%s: missing in source, skipped", t.name)
            runlog.finish(rid, "skipped", 0, "table missing in source")
            return

        plants = [r[0] for r in tgt.execute("SELECT plant_id FROM plant").fetchall()]
        headers: list[int] = []
        if t.extra_where and "%(headers)s" in t.extra_where:
            headers = [r[0] for r in tgt.execute(
                "SELECT id FROM trading_result WHERE date >= %s", (since,)).fetchall()]
        params = {"since": since, "plants": plants, "headers": headers}
        query = source_query(t, cols, since)
        ident = sql.Identifier(t.name)

        if t.mode == "window":
            deleted = tgt.execute(
                sql.SQL("DELETE FROM {} WHERE {} >= %s").format(ident, sql.Identifier(t.date_column)), (since,)
            ).rowcount
            n = stream_copy(src, tgt, query, params, ident, cols)
            log.info("%s: window from %s, deleted %s, copied %s (%.1fs)", t.name, since, deleted, n,
                     time.monotonic() - started)
        else:
            stg = sql.Identifier(f"stg_{t.name}")
            tgt.execute(sql.SQL("CREATE TEMP TABLE {} (LIKE {}) ON COMMIT DROP").format(stg, ident))
            copied = stream_copy(src, tgt, query, params, stg, cols)
            non_pk = [c for c in cols if c not in t.pk]
            collist = sql.SQL(", ").join(map(sql.Identifier, cols))
            action = (sql.SQL("DO UPDATE SET ") + sql.SQL(", ").join(
                sql.SQL("{0} = EXCLUDED.{0}").format(sql.Identifier(c)) for c in non_pk)) if non_pk else sql.SQL("DO NOTHING")
            n = tgt.execute(sql.SQL("INSERT INTO {} ({}) SELECT {} FROM {} ON CONFLICT ({}) ").format(
                ident, collist, collist, stg, sql.SQL(", ").join(map(sql.Identifier, t.pk))) + action).rowcount
            log.info("%s: upserted %s of %s copied (%.1fs)", t.name, n, copied, time.monotonic() - started)
        runlog.finish(rid, "ok", n)
    except Exception as e:  # noqa: BLE001 - recorded, then re-raised
        runlog.finish(rid, "error", None, str(e)[:2000])
        raise


# ---------------------------------------------------------------------------- tiers
def run_tier(tier: str, backfill: int | None, only: set[str] | None, dry_run: bool) -> int:
    src_url = env("ERGOS_DATABASE_URL")
    tgt_url = env("TARGET_DATABASE_URL")
    window_days = int(os.environ.get("SYNC_WINDOW_DAYS") or 2)

    tables = [t for t in TABLES if tier in t.tiers and (only is None or t.name in only)]
    if only:
        unknown = only - set(BY_NAME)
        if unknown:
            raise SystemExit(f"unknown table(s): {', '.join(sorted(unknown))}")

    runlog = RunLog(tgt_url, tier, dry_run)
    run_id = runlog.start(RUN_MARKER, None)
    try:
        with psycopg.connect(src_url) as src, psycopg.connect(tgt_url) as tgt:
            src.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
            src.execute("SET statement_timeout = '300s'")
            src.execute("SET TimeZone = 'UTC'")
            src.commit()

            if not tgt.execute("SELECT pg_try_advisory_xact_lock(%s)", (LOCK_KEY,)).fetchone()[0]:
                log.warning("another sync run holds the lock; skipping")
                runlog.finish(run_id, "skipped", 0, "another run in progress")
                return 0

            failed: str | None = None
            total = 0
            for t in tables:
                try:
                    sync_table(t, src, tgt, runlog, window_days, backfill)
                except Exception as e:  # noqa: BLE001
                    failed = str(e) if str(e).startswith(t.name + ":") else f"{t.name}: {e}"
                    log.error("FAILED %s", failed)
                    break
            if failed:
                tgt.rollback()
                runlog.mark_rolled_back(failed)
                runlog.finish(run_id, "error", None, failed[:2000])
                return 1
            total = runlog.conn.execute(
                "SELECT coalesce(sum(rows_written), 0) FROM sync_runs WHERE id = ANY(%s) AND table_name <> %s",
                (runlog.ids, RUN_MARKER)).fetchone()[0]
            if dry_run:
                tgt.rollback()
                log.info("dry run: rolled back")
            else:
                tgt.commit()
            runlog.finish(run_id, "ok", total)
            log.info("%s tier done: %s rows", tier, total)
            return 0
    except Exception as e:  # noqa: BLE001 - connection-level failures
        log.exception("sync failed")
        runlog.mark_rolled_back(str(e))
        runlog.finish(run_id, "error", None, str(e)[:2000])
        return 1
    finally:
        runlog.close()


def freshness() -> int:
    stale = int(os.environ.get("SYNC_STALE_MINUTES") or 35)
    with psycopg.connect(env("TARGET_DATABASE_URL")) as conn:
        row = conn.execute(
            """SELECT extract(epoch FROM now() - max(finished_at)) / 60
               FROM sync_runs WHERE tier = 'fast' AND table_name = %s AND status = 'ok'
                 AND coalesce(error, '') NOT LIKE 'dry run%%'""",
            (RUN_MARKER,),
        ).fetchone()
    minutes = row[0]
    if minutes is None:
        print("no successful fast run recorded")
        return 1
    print(f"{float(minutes):.1f} minutes since the last successful fast run (limit {stale})")
    return 0 if minutes <= stale else 1


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--tier", choices=["fast", "slow"])
    p.add_argument("--backfill-days", type=int, help="override the window for window-mode tables")
    p.add_argument("--tables", help="comma-separated subset of tables")
    p.add_argument("--dry-run", action="store_true", help="do everything, then roll back")
    p.add_argument("--freshness", action="store_true", help="check the last successful fast run")
    a = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if a.freshness:
        return freshness()
    if not a.tier:
        p.error("--tier is required unless --freshness is given")
    only = {s.strip() for s in a.tables.split(",") if s.strip()} if a.tables else None
    return run_tier(a.tier, a.backfill_days, only, a.dry_run)


if __name__ == "__main__":
    sys.exit(main())
