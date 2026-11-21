# ergOS client view

A read-only, multi-tenant energy dashboard for JouleWise's industrial clients.

```
ergOS Postgres ──(Python sync, every 15 min, in our k8s cluster)──▶ Supabase Postgres (reporting DB, RLS) ◀── Next.js app on Vercel
```

| Path | What it is |
| --- | --- |
| `db/migrations/` | `001_schema.sql` tables, `002_security.sql` app role, grants, helper functions and RLS policies, `003_seed_rbac.sql` roles and permissions |
| `db/seed/` | `demo_seed.sql` / `demo_cleanup.sql`: fictional demo data for a **local** database only |
| `db/tests/rls_isolation.sql` | Tenant isolation checks, run as the app role. Every line must say `ok` |
| `sync/` | ergOS → reporting DB copy job (Python 3.12, psycopg 3), Dockerfile, k8s CronJobs |
| `web/` | Next.js 15 app (App Router, React 19, TypeScript strict), ergOS Harmony design system |

**Tenant isolation lives in PostgreSQL.** The app connects as `ergos_view_app`, which is subject to row-level
security; every request runs in a transaction that sets `app.user_id`. A buggy query in the app cannot return
another client's rows. The sync job connects as the table owner (RLS is enabled but not forced, so it bypasses it).

---

## 1. Reporting database (Supabase)

In the Supabase SQL editor (or `psql` as the `postgres` owner), run in order:

```bash
psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f db/migrations/001_schema.sql
psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f db/migrations/002_security.sql
psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f db/migrations/003_seed_rbac.sql
psql "$OWNER_URL" -c "ALTER ROLE ergos_view_app LOGIN PASSWORD '<a long random password>'"
```

`002` and `003` are safe to re-run. Never run `db/seed/demo_seed.sql` against production.

Connection strings (Supabase → Project settings → Database → Connection pooling):

| Who | Pooler | Port | User |
| --- | --- | --- | --- |
| Web app (`DATABASE_URL`) | transaction | 6543 | `ergos_view_app.<project-ref>` |
| Sync job, `create-user` script | session | 5432 | `postgres.<project-ref>` |

The direct `db.<ref>.supabase.co` host is IPv6-only, so use the pooler hosts.

## 2. Sync job

```bash
cd sync && cp .env.example .env    # fill in, never commit
pip install -r requirements.txt
python sync.py --tier slow                     # tariffs and charges (hourly)
python sync.py --tier fast --backfill-days 40  # first load
python sync.py --tier fast                     # every 15 minutes
python sync.py --freshness                     # exit 1 if the last good fast run is > SYNC_STALE_MINUTES old
```

Use a **read-only** ergOS user for `ERGOS_DATABASE_URL`. Each tier runs in one target transaction (all tables or
none), takes an advisory lock so runs never overlap, and records every table in `sync_runs` on a separate
autocommit connection, so failures stay visible after the rollback.

Deploy: build `sync/Dockerfile`, push it to your registry, set the image in `sync/k8s/cronjobs.yaml`, then

```bash
kubectl create secret generic ergos-view-sync --from-env-file=sync/.env
kubectl apply -f sync/k8s/cronjobs.yaml
```

## 3. Web app on Vercel

In the Vercel project: **Settings → Build and Deployment → Root Directory = `web`**, framework preset Next.js.
Environment variables (Production and Preview):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | transaction pooler URL for `ergos_view_app` (port 6543) |
| `SESSION_SECRET` | 32+ random characters (`openssl rand -base64 48`) |
| `DATABASE_SSL_CA` | optional: Supabase CA certificate PEM, to verify the database certificate |
| `METER_TS_CONVENTION` | `end` (default) or `start`, see assumptions below |

Do **not** put `ADMIN_DATABASE_URL` or any owner credentials on Vercel. Add a Vercel Firewall rate-limit rule on
`/login`: the in-app throttle only covers one warm instance.

Create users from your machine (owner connection):

```bash
cd web
ADMIN_DATABASE_URL=... npm run create-user -- ops@client.com "Asha Verma" --role client_user --clients 12
ADMIN_DATABASE_URL=... npm run create-user -- viewer@client.com "One Plant" --role client_user --clients 12 --plants 34
ADMIN_DATABASE_URL=... npm run create-user -- ops@client.com --deactivate
```

Roles: `admin` (everything), `manager` (all views + `manage_dashboards`), `client_user` (all views).
A user with `user_plant_map` rows for a client sees only those plants of that client.

### Per-client layouts

`dashboard_config` holds a published JSON spec per client (or a global one with `client_id` NULL). The contract is
`web/lib/dashboard/schema.ts`: palette (`harmony`, `volt`, `verdant`, `aurora`), light/dark default, and the
widget list for Today and Savings with spans `full | wide | narrow | half | third`. An invalid stored spec falls
back to the built-in default, and only users with `manage_dashboards` see the error.

## 4. Local development

```bash
# Postgres 16 with stub Supabase roles
createdb ecv
psql ecv -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;"
for f in db/migrations/*.sql; do psql ecv -v ON_ERROR_STOP=1 -f $f; done
psql ecv -v ON_ERROR_STOP=1 -f db/seed/demo_seed.sql
psql ecv -c "ALTER ROLE ergos_view_app LOGIN PASSWORD 'app-local'"
psql "postgresql://ergos_view_app:app-local@localhost/ecv" -f db/tests/rls_isolation.sql

cd web
cat > .env.local <<EOF
DATABASE_URL=postgresql://ergos_view_app:app-local@localhost:5432/ecv
DATABASE_SSL=disable
SESSION_SECRET=$(openssl rand -base64 48)
EOF
npm install && npm run typecheck && npm test && npm run dev
```

Demo logins (password `demo-password`): `admin@`, `manager@`, `cement@`, `films@`, `k2only@demo.example`.

## Assumptions to confirm against real ergOS data

1. **Meter timestamp convention**: `meter_timestamp` marks the *end* of the 15-minute interval
   (`METER_TS_CONVENTION=end`). If it marks the start, set `start`, or every block shifts by one.
2. **`kwh_delta` already includes `energy_multiplier`**: the app does not apply it again.
3. **`cleared_price` units**: values above 100 are treated as ₹/MWh and divided by 1000.
4. **`prebid_plan_data` shape**: the parser in `web/lib/prebid.ts` accepts several shapes; anything else shows
   "Plan format not recognised".
5. **Savings rows with a NULL `plant_id`** are visible to admins only.
6. **Grid supply is derived** as `max(0, demand − IEX − solar)`, not metered, and is labelled that way.
7. Upsert-mode tables (clients, plants, tariffs…) never delete rows that disappear from ergOS; deactivate them
   in ergOS (`is_active = false`) instead.
