# Running the sync on a Linux server (systemd + Docker)

Use this on the ergOS server when it does not run Kubernetes. With Kubernetes, use `../k8s/cronjobs.yaml`.

| Timer | Runs | What it copies |
|---|---|---|
| `ergos-view-sync-fast.timer` | every 15 min (:04, :19, :34, :49) | daily savings, meter data, trades, banking, prebid (last 2–10 days) |
| `ergos-view-sync-slow.timer` | hourly (:11) | clients, plants, tariffs, master tariffs, open access charges |
| `ergos-view-sync-freshness.timer` | every 10 min | fails if no successful fast run in 35 min |

## Install (once, as root, from the repo root)

```bash
# 1. image
docker build -t ergos-view-sync:1 sync/

# 2. settings: same variables as sync/.env. Readable by root only.
install -d -m 700 /etc/ergos-view-sync
install -m 600 sync/.env /etc/ergos-view-sync/sync.env
#    Docker's --env-file does not strip quotes: values must be written without quotes.

# 3. one manual run of each tier (also fills any gap since the last sync)
docker run --rm --network host --env-file /etc/ergos-view-sync/sync.env ergos-view-sync:1 --tier slow
docker run --rm --network host --env-file /etc/ergos-view-sync/sync.env ergos-view-sync:1 --tier fast --backfill-days 60

# 4. timers
cp sync/systemd/ergos-view-sync* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ergos-view-sync-fast.timer ergos-view-sync-slow.timer ergos-view-sync-freshness.timer
```

## Check

```bash
systemctl list-timers 'ergos-view-sync*'          # next and last run of each timer
journalctl -u ergos-view-sync@fast -n 30           # last fast run's log
systemctl status ergos-view-sync-freshness         # 'failed' means the data is stale
```

The app header shows the same thing: "Synced N min ago", or a warning once the last good fast run is
older than 35 minutes.

## Update after a code change

```bash
git pull && docker build -t ergos-view-sync:1 sync/      # next timer run uses the new image
```

## Stop

```bash
systemctl disable --now ergos-view-sync-fast.timer ergos-view-sync-slow.timer ergos-view-sync-freshness.timer
```
