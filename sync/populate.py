"""ergOS to Supabase data population script.

Pushes data from the ergOS database to the Supabase reporting database.

Usage:
    # Full initial population (all tables, all historical data):
    python populate.py --all

    # Populate last 60 days of rolling data + all tenancy/tariffs:
    python populate.py --days 60

    # Dry-run test (simulates full push and rolls back):
    python populate.py --all --dry-run

    # Verify / compare row counts between ergOS and Supabase:
    python populate.py --verify-only

    # Populate specific tables:
    python populate.py --tables client,plant,plant_processed_meter_data --days 30
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import os
import sys
import time
from pathlib import Path
from urllib.parse import quote_plus, urlparse, urlunparse
from zoneinfo import ZoneInfo

from dotenv import find_dotenv, load_dotenv
import psycopg
from psycopg import sql

# Ensure sync folder is importable
BASE_DIR = Path(__file__).resolve().parent
SYNC_DIR = BASE_DIR / "sync"
if str(SYNC_DIR) not in sys.path:
    sys.path.insert(0, str(SYNC_DIR))
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Load .env
load_dotenv(find_dotenv(usecwd=True))
load_dotenv(BASE_DIR / ".env")
load_dotenv(SYNC_DIR / ".env")

from tables import BY_NAME, TABLES, Table

IST = ZoneInfo("Asia/Kolkata")
BATCH_SIZE = 5000
LOCK_KEY = 0x45435653

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("populate")


def sanitize_db_url(url_str: str) -> str:
    """Ensure passwords with special characters like '@' are safely encoded."""
    if not url_str:
        return url_str
    try:
        # Check if already parseable
        parsed = urlparse(url_str)
        if parsed.hostname and not ("@" in parsed.hostname):
            return url_str
    except Exception:
        pass

    # Custom regex / manual split for user:password@host
    prefix, _, rest = url_str.partition("://")
    if "@" in rest:
        auth_part, _, host_part = rest.rpartition("@")
        user, _, passwd = auth_part.partition(":")
        encoded_passwd = quote_plus(passwd)
        return f"{prefix}://{user}:{encoded_passwd}@{host_part}"
    return url_str


def get_source_url() -> str:
    raw = os.environ.get("ERGOS_DATABASE_URL")
    if not raw:
        sys.exit("Error: ERGOS_DATABASE_URL is not set in .env")
    return sanitize_db_url(raw)


def get_target_url() -> str:
    raw = os.environ.get("TARGET_DATABASE_URL")
    if not raw:
        sys.exit("Error: TARGET_DATABASE_URL is not set in .env")
    return sanitize_db_url(raw)


def today_ist() -> dt.date:
    return dt.datetime.now(IST).date()


def get_columns(conn: psycopg.Connection, table: str) -> dict[str, tuple[bool, bool]]:
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


def plan_columns(t: Table, src: psycopg.Connection, tgt: psycopg.Connection) -> list[str] | None:
    scols = get_columns(src, t.name)
    tcols = get_columns(tgt, t.name)
    if not tcols:
        raise RuntimeError(f"Table '{t.name}' missing in target database")
    if not scols:
        return None
    only_src = [c for c in scols if c not in tcols]
    only_tgt = [c for c in tcols if c not in scols]
    if only_src:
        log.debug("%s: source-only columns ignored: %s", t.name, ", ".join(only_src))
    if only_tgt:
        log.debug("%s: target-only columns left to defaults: %s", t.name, ", ".join(only_tgt))
    required = [c for c in only_tgt if tcols[c][0] and not tcols[c][1]]
    if required:
        raise RuntimeError(f"{t.name}: required target column(s) missing in source: {', '.join(required)}")
    missing_pk = [c for c in t.pk if c not in scols]
    if missing_pk:
        raise RuntimeError(f"{t.name}: primary key column(s) missing in source: {', '.join(missing_pk)}")
    return [c for c in tcols if c in scols]


def build_source_query(t: Table, cols: list[str], since: dt.date | None) -> sql.Composed:
    select_clause = sql.SQL(", ").join(sql.SQL("{}::text").format(sql.Identifier(c)) for c in cols)
    where_clauses: list[sql.Composable] = []

    if t.mode == "window" and since is not None and t.date_column:
        where_clauses.append(sql.SQL("{} >= %(since)s").format(sql.Identifier(t.date_column)))

    if t.plant_column:
        cond = sql.SQL("{} = ANY(%(plants)s)").format(sql.Identifier(t.plant_column))
        if t.plant_nullable:
            cond = sql.SQL("({} IS NULL OR {})").format(sql.Identifier(t.plant_column), cond)
        where_clauses.append(cond)

    if t.extra_where:
        where_clauses.append(sql.SQL("(" + t.extra_where + ")"))

    query = sql.SQL("SELECT {} FROM {}").format(select_clause, sql.Identifier(t.name))
    if where_clauses:
        query += sql.SQL(" WHERE ") + sql.SQL(" AND ").join(where_clauses)
    return query


def stream_copy(
    src: psycopg.Connection,
    tgt: psycopg.Connection,
    query: sql.Composed,
    params: dict,
    dest: sql.Composable,
    cols: list[str],
) -> int:
    n = 0
    copy_sql = sql.SQL("COPY {} ({}) FROM STDIN").format(dest, sql.SQL(", ").join(map(sql.Identifier, cols)))
    with src.cursor(name="ecv_populate_cursor") as scur, tgt.cursor() as tcur:
        scur.itersize = BATCH_SIZE
        scur.execute(query, params)
        with tcur.copy(copy_sql) as copy_stream:
            while True:
                rows = scur.fetchmany(BATCH_SIZE)
                if not rows:
                    break
                for row in rows:
                    copy_stream.write_row(row)
                n += len(rows)
    return n


def sync_table_data(
    t: Table,
    src: psycopg.Connection,
    tgt: psycopg.Connection,
    since: dt.date | None,
) -> int:
    t0 = time.monotonic()
    cols = plan_columns(t, src, tgt)
    if cols is None:
        log.warning("Table '%s' missing in source, skipped", t.name)
        return 0

    plants = [r[0] for r in tgt.execute("SELECT plant_id FROM plant").fetchall()]
    headers: list[int] = []
    if t.extra_where and "%(headers)s" in t.extra_where:
        if since is not None:
            headers = [r[0] for r in tgt.execute("SELECT id FROM trading_result WHERE date >= %s", (since,)).fetchall()]
        else:
            headers = [r[0] for r in tgt.execute("SELECT id FROM trading_result").fetchall()]

    params = {"since": since, "plants": plants, "headers": headers}
    query = build_source_query(t, cols, since)
    ident = sql.Identifier(t.name)

    if t.mode == "window":
        if since is not None and t.date_column:
            tgt.execute(sql.SQL("DELETE FROM {} WHERE {} >= %s").format(ident, sql.Identifier(t.date_column)), (since,))
        else:
            tgt.execute(sql.SQL("DELETE FROM {}").format(ident))
        n = stream_copy(src, tgt, query, params, ident, cols)
        elapsed = time.monotonic() - t0
        log.info("  %-28s : copied %6d rows (window >= %s, %.1fs)", t.name, n, since or "ALL", elapsed)
    else:
        stg = sql.Identifier(f"stg_{t.name}")
        tgt.execute(sql.SQL("CREATE TEMP TABLE {} (LIKE {}) ON COMMIT DROP").format(stg, ident))
        copied = stream_copy(src, tgt, query, params, stg, cols)
        non_pk = [c for c in cols if c not in t.pk]
        collist = sql.SQL(", ").join(map(sql.Identifier, cols))
        action = (
            (sql.SQL("DO UPDATE SET ") + sql.SQL(", ").join(sql.SQL("{0} = EXCLUDED.{0}").format(sql.Identifier(c)) for c in non_pk))
            if non_pk
            else sql.SQL("DO NOTHING")
        )
        upsert_stmt = (
            sql.SQL("INSERT INTO {} ({}) SELECT {} FROM {} ON CONFLICT ({}) ").format(
                ident, collist, collist, stg, sql.SQL(", ").join(map(sql.Identifier, t.pk))
            )
            + action
        )
        n = tgt.execute(upsert_stmt).rowcount
        elapsed = time.monotonic() - t0
        log.info("  %-28s : upserted %6d rows (%.1fs)", t.name, n, elapsed)
    return n


def verify_tables(src_url: str, tgt_url: str) -> None:
    print("\n" + "=" * 80)
    print(f"{'TABLE NAME':<30} | {'SOURCE COUNT':>14} | {'TARGET COUNT':>14} | {'STATUS':<10}")
    print("-" * 80)
    with psycopg.connect(src_url) as src, psycopg.connect(tgt_url) as tgt:
        total_src = 0
        total_tgt = 0
        for t in TABLES:
            try:
                scnt = src.execute(f'SELECT count(*) FROM "{t.name}"').fetchone()[0]
            except Exception:
                scnt = -1
                src.rollback()
            try:
                tcnt = tgt.execute(f'SELECT count(*) FROM "{t.name}"').fetchone()[0]
            except Exception:
                tcnt = -1
                tgt.rollback()

            s_str = str(scnt) if scnt >= 0 else "MISSING"
            t_str = str(tcnt) if tcnt >= 0 else "MISSING"
            status = "MATCH" if scnt == tcnt and scnt > 0 else ("PARTIAL" if tcnt > 0 else "EMPTY")
            if scnt >= 0:
                total_src += scnt
            if tcnt >= 0:
                total_tgt += tcnt
            print(f"{t.name:<30} | {s_str:>14} | {t_str:>14} | {status:<10}")

    print("-" * 80)
    print(f"{'TOTAL':<30} | {total_src:>14} | {total_tgt:>14} |")
    print("=" * 80 + "\n")


def run_populate(
    sync_all: bool,
    days: int | None,
    tier_choice: str,
    selected_tables: list[str] | None,
    dry_run: bool,
) -> int:
    src_url = get_source_url()
    tgt_url = get_target_url()

    log.info("Source : %s", src_url.split("@")[-1])
    log.info("Target : %s", tgt_url.split("@")[-1])

    if sync_all:
        default_since = None
        log.info("Mode   : FULL HISTORICAL POPULATION (--all)")
    elif days is not None:
        default_since = today_ist() - dt.timedelta(days=days)
        log.info("Mode   : WINDOW POPULATION (last %d days >= %s)", days, default_since)
    else:
        window_days = int(os.environ.get("SYNC_WINDOW_DAYS", "2"))
        default_since = today_ist() - dt.timedelta(days=window_days)
        log.info("Mode   : DEFAULT WINDOW (last %d days >= %s)", window_days, default_since)

    if dry_run:
        log.info("Flags  : DRY-RUN ENABLED (changes will be rolled back)")

    # Filter tables
    tables_to_sync: list[Table] = []
    for t in TABLES:
        if tier_choice == "slow" and "slow" not in t.tiers and "fast" in t.tiers:
            continue
        if tier_choice == "fast" and "fast" not in t.tiers:
            continue
        if selected_tables and t.name not in selected_tables:
            continue
        if t.source != "ergos":
            log.info("%s: from the %s DB; loaded by `python sync.py`", t.name, t.source)
            continue
        tables_to_sync.append(t)

    log.info("Tables to process (%d): %s", len(tables_to_sync), ", ".join(t.name for t in tables_to_sync))

    with psycopg.connect(src_url) as src, psycopg.connect(tgt_url) as tgt:
        src.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
        src.execute("SET statement_timeout = '600s'")
        src.execute("SET TimeZone = 'UTC'")
        src.commit()

        # ergOS stores IST wall-clock times in "timestamp without time zone" columns. Read as text, they
        # carry no offset, so tell the target to interpret them as IST, or every reading lands 5h30m late.
        # Columns that already carry an offset (timestamptz) are unaffected.
        tgt.execute("SET TimeZone = 'Asia/Kolkata'")

        if not tgt.execute("SELECT pg_try_advisory_xact_lock(%s)", (LOCK_KEY,)).fetchone()[0]:
            log.error("Another sync or population process currently holds the lock.")
            return 1

        total_rows = 0
        overall_start = time.monotonic()
        try:
            for t in tables_to_sync:
                since = default_since
                # If table specifies a custom window and we're not in --all mode
                if t.mode == "window" and not sync_all and days is None and t.window_days:
                    since = today_ist() - dt.timedelta(days=t.window_days)

                rows = sync_table_data(t, src, tgt, since)
                total_rows += rows

            if dry_run:
                tgt.rollback()
                log.info("DRY-RUN COMPLETE: Processed %d rows successfully (ROLLED BACK).", total_rows)
            else:
                tgt.commit()
                log.info("POPULATION COMPLETE: %d rows written to Supabase in %.1fs.", total_rows, time.monotonic() - overall_start)

        except Exception as e:
            tgt.rollback()
            log.exception("Population failed: %s", e)
            return 1

    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--all", action="store_true", help="Populate all historical data (no date restriction on rolling tables)")
    p.add_argument("--days", type=int, help="Number of days to backfill for rolling/window tables")
    p.add_argument("--tier", choices=["all", "slow", "fast"], default="all", help="Tier to populate (default: all)")
    p.add_argument("--tables", help="Comma-separated subset of tables (e.g. client,plant,trading_result)")
    p.add_argument("--dry-run", action="store_true", help="Simulate population inside a transaction and roll back")
    p.add_argument("--verify-only", action="store_true", help="Compare row counts between ergOS and Supabase without writing")

    args = p.parse_args()

    src_url = get_source_url()
    tgt_url = get_target_url()

    if args.verify_only:
        verify_tables(src_url, tgt_url)
        return 0

    tables = [s.strip() for s in args.tables.split(",") if s.strip()] if args.tables else None
    if tables:
        unknown = set(tables) - set(BY_NAME)
        if unknown:
            sys.exit(f"Unknown table(s): {', '.join(sorted(unknown))}")

    rc = run_populate(
        sync_all=args.all,
        days=args.days,
        tier_choice=args.tier,
        selected_tables=tables,
        dry_run=args.dry_run,
    )

    if rc == 0 and not args.dry_run:
        verify_tables(src_url, tgt_url)

    return rc


if __name__ == "__main__":
    sys.exit(main())
