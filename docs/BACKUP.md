# Backup & Restore

Automated daily backup of yumin-admin's Supabase data to Cloudflare R2.

## What gets backed up

| Source | Method | Destination |
|---|---|---|
| Postgres `public` schema | `pg_dump --schema=public` (gzipped) | `r2:yumin-admin-backup/db/db_YYYYMMDD_HHMMSS.sql.gz` |
| **Login accounts** `auth.users` + `auth.identities` (2026-09-27) | `pg_dump --data-only`, gzipped, **encrypted** (see below) | `r2:yumin-admin-backup/auth/auth_YYYYMMDD_HHMMSS.sql.gz.cms` |
| Storage bucket settings + `storage.objects` policies (2026-09-27) | generated SQL from the live config (idempotent) | `r2:yumin-admin-backup/db/storage_bootstrap_YYYYMMDD_HHMMSS.sql` |
| Storage `daily-photos` | rclone copy | `r2:yumin-admin-backup/storage-latest/daily-photos/` |
| Storage `signatures` | rclone copy | `r2:yumin-admin-backup/storage-latest/signatures/` |
| Storage `daily-log-pdfs` | rclone copy | `r2:yumin-admin-backup/storage-latest/daily-log-pdfs/` |
| Storage `fonts` (2026-09-27) | rclone copy — the PDF's Noto Sans CJK subsets are **not in the repo**, only here | `r2:yumin-admin-backup/storage-latest/fonts/` |

**Not backed up (not needed):** auth sessions / refresh tokens / audit log (everyone just logs in again after a restore), `realtime.*` and other Supabase-managed schemas. The `public` dump includes all custom tables, indexes, RLS policies, triggers and functions — but **not** the `on_auth_user_created` trigger (it lives on `auth.users`; the restore steps recreate it).

Step order in `backup.yml`: public dump → storage mirror → uploads → **then** login accounts → storage bootstrap. The two newer steps run last on purpose: if one of them fails, the database and files are already safe in R2, and the run still turns red and sends the 🚨 email.

## Schedule

- **Cron:** daily 02:00 Asia/Taipei (`0 18 * * *` UTC)
- **Retention:** DB dumps, login-account dumps and storage bootstraps pruned after 90 days; storage mirror keeps current state only

## Login accounts — encryption and the key (2026-09-27)

The account dump contains the bcrypt password hashes (minimum password length is only 6), so it is encrypted before upload:
OpenSSL CMS, RSA-OAEP key transport + AES-256-CBC, to a self-signed certificate.

| Piece | Where | Secret? |
|---|---|---|
| Certificate (public key) | embedded in `backup.yml` (`AUTH_BACKUP_CERT`), copy at `D:\Evelyn\_secrets\yumin-backup-auth-cert.pem` | no |
| **Private key** | `D:\Evelyn\_secrets\yumin-backup-auth-key.pem` — **nowhere else**: not in GitHub, R2 or Supabase | **yes** |

Certificate SHA-256 fingerprint: `36:07:D9:C4:0D:90:73:AC:D5:E4:DC:9B:59:96:02:29:C3:A6:D6:0A:49:BD:C7:F9:65:92:20:48:AA:CF:F9:43`
(check with `openssl x509 -in yumin-backup-auth-cert.pem -noout -fingerprint -sha256`).

⚠ **Keep a second copy of the private key with 裕民** (e.g. a password-manager secure note or a USB stick kept with company documents).
If the only copy is lost, the encrypted account dumps can't be opened. The fallback then is: recreate the accounts with the same
UUIDs (`public.profiles.id`) and reset every password in `/staff` — the business data is unaffected.

Check that a backup opens (part of the quarterly drill — takes a minute, touches nothing):

```bash
rclone copy r2:yumin-admin-backup/auth/auth_YYYYMMDD_HHMMSS.sql.gz.cms .
openssl cms -decrypt -binary -inform DER -in auth_YYYYMMDD_HHMMSS.sql.gz.cms \
  -inkey yumin-backup-auth-key.pem | gunzip | grep -c '^COPY auth\.'   # → 2 (users, identities)
```

**Rotating the key** (key leaked, or someone who had it leaves):

```bash
# Git Bash on Windows: prefix with MSYS_NO_PATHCONV=1 so "/O=..." isn't turned into a path
openssl req -x509 -newkey rsa:4096 -sha256 -days 36500 -nodes \
  -subj "/O=Yu Min Admin/CN=yumin-admin login-account backup" \
  -keyout yumin-backup-auth-key.pem -out yumin-backup-auth-cert.pem
```

Paste the new certificate into `AUTH_BACKUP_CERT` in `backup.yml` (and update the fingerprint above).
Keep the **old** private key for 90 days — dumps made before the switch still need it.

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

## Restore into a new Supabase project

Same sequence that moved production Sydney → Tokyo on 2026-08-16 (`migrate-to-tokyo.yml`), written out here so it
survives that workflow being deleted. Needs: `psql` **17.6 or newer** (the dumps contain `\restrict` lines that older psql
rejects), rclone with the `r2` remote, OpenSSL, and the private key. `$TARGET_DB_URL` = the new project's Session pooler URI.

```bash
TS=YYYYMMDD_HHMMSS    # pick one night; use the SAME TS for all three files
rclone copy r2:yumin-admin-backup/db/db_${TS}.sql.gz .
rclone copy r2:yumin-admin-backup/db/storage_bootstrap_${TS}.sql .
rclone copy r2:yumin-admin-backup/auth/auth_${TS}.sql.gz.cms .
openssl cms -decrypt -binary -inform DER -in auth_${TS}.sql.gz.cms \
  -inkey yumin-backup-auth-key.pem -out auth_${TS}.sql.gz
gunzip db_${TS}.sql.gz auth_${TS}.sql.gz

# The public schema already exists in a new project and isn't owned by postgres —
# drop the schema-level statements, otherwise psql stops at the first one
sed -i -E '/^(DROP|CREATE|COMMENT ON) SCHEMA /d' db_${TS}.sql

# 1. Storage buckets + policies (buckets must exist before files are uploaded)
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f storage_bootstrap_${TS}.sql

# 2. Login accounts FIRST (public.profiles references auth.users). No trigger may fire here,
#    or every restored account would also insert a profile and clash with step 3.
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -c 'drop trigger if exists on_auth_user_created on auth.users;'
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f auth_${TS}.sql

# 3. Business data
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -c 'create extension if not exists pgcrypto with schema extensions;'
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f db_${TS}.sql

# 4. Post-restore fixes (identical to the Tokyo move)
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
-- NULL token columns break GoTrue logins
update auth.users set
  confirmation_token         = coalesce(confirmation_token, ''),
  recovery_token             = coalesce(recovery_token, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change               = coalesce(email_change, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change               = coalesce(phone_change, ''),
  phone_change_token         = coalesce(phone_change_token, ''),
  reauthentication_token     = coalesce(reauthentication_token, '');
-- new account → profile (the trigger lives on auth.users, so the public dump can't carry it)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
-- supabase_auth_admin must be able to read public, or logins fail with "Database error querying schema"
grant usage on schema public to supabase_auth_admin;
grant select on all tables in schema public to supabase_auth_admin;
grant select on all sequences in schema public to supabase_auth_admin;
grant execute on all functions in schema public to supabase_auth_admin;
do $$
declare r record;
begin
  for r in
    select t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e'
  loop
    execute format('grant usage on type public.%I to supabase_auth_admin', r.typname);
  end loop;
end $$;
SQL

# 5. Files — rclone remote [target-storage] = the new project's S3 endpoint + S3 access keys
#    (the Python uploader in migrate-to-tokyo.yml's "Storage 3/3" step is an alternative)
for b in daily-photos signatures daily-log-pdfs fonts; do
  rclone sync "r2:yumin-admin-backup/storage-latest/$b" "target-storage:$b"
done
```

Then point the app at the new project: Vercel env `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` → redeploy; GitHub secrets `SUPABASE_DB_URL` + `SUPABASE_S3_*` so the next night backs up the
new project; Auth settings as in SECURITY.md item 3 (sign-ups off), JWT signing keys asymmetric like production
(`getClaims()` verifies ES256 locally — see PROJECT.md 鐵則 9).

Accounts come back with the same UUIDs and password hashes → **everyone logs in with their existing username and password**.

### Verification checklist

- [ ] Row counts: `select count(*) from auth.users` = the `users` number in that night's run summary; spot-check big tables
- [ ] A normal account (not only `admin`) logs in with its old password
- [ ] Open an existing case — work items and daily logs visible
- [ ] Open a daily log — photos load; an approved log — signature renders, PDF downloads (needs the `fonts` bucket)
- [ ] Upload a photo as a site supervisor (checks the storage policies from step 1)

## Caveats

- **Login accounts are backed up since 2026-09-27 — encrypted.** Without the private key they can't be restored (see "Login accounts — encryption and the key").
- **Restore into a newer Supabase auth version:** the account dump lists its columns explicitly, so columns Supabase *adds* later are fine; a *renamed/removed* column would need a manual edit of `auth_*.sql`. The quarterly drill is what catches this.
- **Storage `latest mirror` overwrites on each run.** If a file is deleted in Supabase, it disappears from R2 on the next sync. To recover deleted files, enable R2 Object Versioning in Cloudflare dashboard (later).
- **Backup tests itself only on schedule.** Run a manual restore drill quarterly.
