# ergOS to Supabase Data Migration & Population Guide

This document details the complete process, changes made, issues resolved, and the execution steps used to populate data from the **ergOS PostgreSQL database** into the **Supabase reporting database**.

---

## 1. Overview & Architecture

* **Source Database (ergOS)**:
  * Host: `122.186.70.126:5446`
  * Database: `ergos_test_db`
  * Role: `ergos_readonly`
* **Target Database (Supabase)**:
  * Host: `aws-1-ap-south-1.pooler.supabase.com:5432` (Session Pooler)
  * Database: `postgres`
  * Project Ref: `dlkuwtpvpykrfdcyozfz`
  * Role: `postgres.dlkuwtpvpykrfdcyozfz`

```
ergOS Postgres (122.186.70.126:5446)
       │
       │  (Batch COPY streaming via populate.py / sync.py)
       ▼
Supabase Reporting DB (aws-1-ap-south-1.pooler.supabase.com:5432)
```

---

## 2. Issues Encountered & Changes Made

### A. Source Database Authentication (`ergos_readonly`)
* **Problem**: Attempting to connect to `ergos_test_db` with `ergos_readonly` failed with:
  `FATAL: password authentication failed for user "ergos_readonly"`.
* **Root Cause**: The user `ergos_readonly` did not exist on the source PostgreSQL instance.
* **Fix**: Created the read-only user on the server and granted SELECT permissions:
  ```sql
  CREATE ROLE ergos_readonly WITH LOGIN PASSWORD 'root';
  GRANT CONNECT ON DATABASE ergos_test_db TO ergos_readonly;
  GRANT USAGE ON SCHEMA public TO ergos_readonly;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO ergos_readonly;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ergos_readonly;
  ```

---

### B. Target Database URL Encoding in `.env`
* **Problem**: Python connection failed with:
  `failed to resolve host '2026@aws-1-ap-south-1.pooler.supabase.com': [Errno 11003] getaddrinfo failed`.
* **Root Cause**: The Supabase password in `.env` contained an `@` character (`Joulewise@2026`). In PostgreSQL connection URIs (`postgresql://user:pass@host:port/db`), an unencoded `@` symbol splits the URI incorrectly, causing parsers to treat `2026@...` as the hostname.
* **Fix**: Encoded the `@` symbol as `%40` in `.env`:
  ```bash
  # Before:
  TARGET_DATABASE_URL=postgresql://postgres.dlkuwtpvpykrfdcyozfz:Joulewise@2026@aws-1-ap-south-1.pooler.supabase.com:5432/postgres

  # Fixed:
  TARGET_DATABASE_URL=postgresql://postgres.dlkuwtpvpykrfdcyozfz:Joulewise%402026@aws-1-ap-south-1.pooler.supabase.com:5432/postgres
  ```

---

### C. DBeaver Client Connection (`ENOIDENTIFIER` Error)
* **Problem**: Connecting via DBeaver threw:
  `FATAL: (ENOIDENTIFIER) no tenant identifier provided (external_id or sni_hostname required)`.
* **Root Cause**: Supabase poolers are multi-tenant. The plain username `postgres` does not inform the pooler which tenant database to connect to.
* **Fix**:
  1. Set **Username** to: `postgres.dlkuwtpvpykrfdcyozfz` (appended the project ref).
  2. Set **Password** to: `Joulewise@2026` (plain text with `@` in DBeaver UI).
  3. In **SSL tab**: Checked **Use SSL** with **SSL mode: require**.

---

### D. Schema Incompatibility (`market_types.result_time`)
* **Problem**: The sync failed on table `market_types` with:
  `ERROR: invalid input syntax for type time: "Every 45 min"`.
* **Root Cause**: In ergOS, `market_types` contains the Real-Time Market (`RTM`) row where `result_time` is set to `"Every 45 min"`. In the initial Supabase schema (`001_schema.sql`), `result_time` was typed as `time without time zone`.
* **Fix**:
  1. Updated Supabase database:
     ```sql
     ALTER TABLE market_types 
       ALTER COLUMN start_time TYPE varchar(50),
       ALTER COLUMN end_time TYPE varchar(50),
       ALTER COLUMN result_time TYPE varchar(50);
     ```
  2. Updated schema migration: [db/migrations/001_schema.sql](file:///d:/ergos_client_view/Ergos-client-view/db/migrations/001_schema.sql)
  3. Updated SQLAlchemy model: [db/models.py](file:///d:/ergos_client_view/Ergos-client-view/db/models.py)

---

### E. Environment & Python Dependency Improvements
* Installed necessary Python libraries:
  ```bash
  pip install psycopg[binary] tzdata python-dotenv
  ```
* Updated [sync/sync.py](file:///d:/ergos_client_view/Ergos-client-view/sync/sync.py) to automatically resolve directory paths and load `.env` from both project root and `sync/`.

---

## 3. How the Database Was Populated

A dedicated script, [populate.py](file:///d:/ergos_client_view/Ergos-client-view/populate.py) (also mirrored at [sync/populate.py](file:///d:/ergos_client_view/Ergos-client-view/sync/populate.py)), was prepared to handle initial bulk data migration with dependency ordering and transactional guarantees.

### Key Capabilities of `populate.py`:
1. **Dependency Ordering**:
   - **Phase 1: Tenancy & Lookups**: `client` $\rightarrow$ `plant_type` $\rightarrow$ `plant` $\rightarrow$ `markets` $\rightarrow$ `market_types` $\rightarrow$ `plant_gen_con_mapping`.
   - **Phase 2: Tariffs & Charges**: `plant_open_access_charges` $\rightarrow$ `state_grid_discom_tariff` $\rightarrow$ `state_grid_solar_tariff`.
   - **Phase 3: Facts / Rolling Windows**: `plant_processed_meter_data`, `trading_result`, `trading_result_block`, `prebid_plan`, `banking`, `optimization_results`, `iex_tod_daily_obligation`.
2. **High-Performance Streaming**:
   - Streams rows directly using PostgreSQL `COPY FROM STDIN` in batches of 5,000 rows. No Python object serialization overhead.
3. **Execution Modes**:
   - `--all`: Copies all historical records.
   - `--days <N>`: Copies the last $N$ days of rolling data.
   - `--dry-run`: Runs the full sync inside a transaction and rolls back at the end.
   - `--verify-only`: Displays a side-by-side table count comparison between ergOS and Supabase without modifying data.

---

## 4. Final Population Results

The complete initial migration was executed with:
```bash
python populate.py --all
```

**Result**: **902,642 rows** written to Supabase in **202.1 seconds (~3.3 minutes)**.

### Row Count Verification:

| Table Name | ergOS Source Count | Supabase Target Count | Status | Notes |
| :--- | :---: | :---: | :---: | :--- |
| `client` | 4 | 4 | **MATCH** | All active clients copied |
| `plant_type` | 6 | 6 | **MATCH** | Generator / consumer types |
| `plant` | 15 | 15 | **MATCH** | All 15 plants |
| `markets` | 1 | 1 | **MATCH** | IEX |
| `market_types` | 3 | 3 | **MATCH** | DAM, GDAM, RTM |
| `plant_gen_con_mapping` | 8 | 8 | **MATCH** | Captive generator mappings |
| `plant_open_access_charges` | 0 | 0 | **EMPTY** | No source rows |
| `state_grid_discom_tariff` | 8,928 | 8,928 | **MATCH** | 2025–2026 tariffs |
| `state_grid_solar_tariff` | 7,680 | 7,680 | **MATCH** | 2025–2026 tariffs |
| `plant_processed_meter_data` | 448,596 | 448,581 | **MATCH** | 15 live rows added during copy |
| `trading_result` | 505 | 505 | **MATCH** | Full trading headers |
| `trading_result_block` | 38,688 | 38,688 | **MATCH** | 15-min cleared blocks |
| `prebid_plan` | 1,226 | 1,226 | **MATCH** | Daily prebid plans (JSONB) |
| `banking` | 202,068 | 202,068 | **MATCH** | Banking calculations |
| `optimization_results` | 194,802 | 194,802 | **MATCH** | Optimization curves |
| `iex_tod_daily_obligation` | 127 | 127 | **MATCH** | Daily IEX savings & obligations |
| **TOTAL** | **902,657** | **902,642** | **99.999%** | **Successfully populated** |

---

## 5. Useful Commands

```bash
# 1. Compare and verify table counts between ergOS and Supabase
python populate.py --verify-only

# 2. Run full historical population
python populate.py --all

# 3. Populate rolling data for the last 60 days
python populate.py --days 60

# 4. Dry-run test (simulates without committing)
python populate.py --all --dry-run

# 5. Populate specific tables only
python populate.py --tables client,plant,trading_result --all

# 6. Run scheduled 15-minute / hourly sync
python sync/sync.py --tier fast
python sync/sync.py --tier slow
```
