# Backup & Restore

Automated daily backup of yumin-admin's Supabase data to Cloudflare R2.

## What gets backed up

| Source | Method | Destination |
|---|---|---|
| Postgres `public` schema | `pg_dump --schema=public` (gzipped) | `r2:yumin-admin-backup/db/db_YYYYMMDD_HHMMSS.sql.gz` |
| Storage `daily-photos` | rclone copy | `r2:yumin-admin-backup/storage-latest/daily-photos/` |
| Storage `signatures` | rclone copy | `r2:yumin-admin-backup/storage-latest/signatures/` |
| Storage `daily-log-pdfs` | rclone copy | `r2:yumin-admin-backup/storage-latest/daily-log-pdfs/` |

**Not backed up:** `fonts` bucket (static assets, re-uploadable).

**Excluded:** `auth.*`, `storage.*`, `realtime.*`, and other Supabase-managed schemas. The `public` schema dump includes all custom tables, indexes, RLS policies, triggers, and functions.

## Schedule

- **Cron:** daily 02:00 Asia/Taipei (`0 18 * * *` UTC)
- **Retention:** DB dumps pruned after 90 days; storage mirror keeps current state only

## Manual run

GitHub repo → **Actions** → **Daily Backup to R2** → **Run workflow**.

## Required GitHub secrets

Settings → Secrets and variables → Actions:

- `SUPABASE_DB_URL` — Session pooler URI
- `SUPABASE_S3_ENDPOINT`
- `SUPABASE_S3_REGION`
- `SUPABASE_S3_ACCESS_KEY`
- `SUPABASE_S3_SECRET_KEY`
- `R2_ENDPOINT`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Optional repo variable: `R2_BUCKET` (defaults to `yumin-admin-backup`).

## Email notifications

Two emails are sent to `yumindb@gmail.com` and `evelyn.evagor@gmail.com` via Gmail SMTP (`dawidd6/action-send-mail`):

1. **🚨 Failure alert** — fires on any failed run (any day). High priority. Subject: `🚨【裕民備份失敗】yyyy-mm-dd 請立即確認 🚨`.
2. **✅ Weekly heartbeat** — fires every **Monday** (Asia/Taipei) IF that day's backup succeeded. Reports last-7-day backup completion rate, latest dump filename, and R2 usage. Subject: `✅【裕民備份週報】yyyy-mm-dd — 過去一週備份正常`.

Combined behaviour:

| Day | Backup result | Email sent |
|---|---|---|
| Mon–Sun | ✅ success | nothing (quiet) |
| Mon | ✅ success | weekly heartbeat |
| Any day | ❌ failure | 🚨 failure alert |

Required secrets:

- `NOTIFY_EMAIL_USER` — Gmail address used as sender (e.g. `evelyn.evagor@gmail.com`)
- `NOTIFY_EMAIL_APP_PASSWORD` — 16-character Gmail App Password (NOT the account password). Generate at https://myaccount.google.com/apppasswords (requires 2-Step Verification enabled on the sender account)

If these secrets are missing, the notification steps skip silently — the backup itself still runs and still shows red in the Actions tab.

To change the heartbeat day, edit the `DOW=$(...)` check in `.github/workflows/backup.yml` (1 = Mon, 7 = Sun).

## Restore drill

### Restore database to a fresh Supabase project

```bash
# 1. Download latest dump (using rclone configured for r2)
rclone copy r2:yumin-admin-backup/db/db_YYYYMMDD_HHMMSS.sql.gz .
gunzip db_YYYYMMDD_HHMMSS.sql.gz

# 2. Restore to target project (use Session pooler URI of TARGET)
psql "$TARGET_DB_URL" < db_YYYYMMDD_HHMMSS.sql
```

### Restore Storage buckets

```bash
# 1. Configure rclone with target Supabase Storage as [target-storage]
# 2. Sync
rclone sync r2:yumin-admin-backup/storage-latest/daily-photos target-storage:daily-photos
rclone sync r2:yumin-admin-backup/storage-latest/signatures target-storage:signatures
```

### Verification checklist

After restore, smoke-test:
- [ ] Login as a known user (or reseed `seed-accounts.sql` if auth not restored)
- [ ] Open an existing case — verify work items, daily logs visible
- [ ] Open a daily log — verify photos load
- [ ] Open an approved log — verify signature renders

## Caveats

- **`auth.users` is NOT backed up.** Supabase-managed users live in `auth` schema; restoring them requires Supabase support or re-seeding. For POC this is acceptable (small user base, can rebuild from `seed-accounts.sql`).
- **Storage `latest mirror` overwrites on each run.** If a file is deleted in Supabase, it disappears from R2 on the next sync. To recover deleted files, enable R2 Object Versioning in Cloudflare dashboard (later).
- **Backup tests itself only on schedule.** Run a manual restore drill quarterly.
