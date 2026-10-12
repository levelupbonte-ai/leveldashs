# Restoring a database backup

Daily backups come from the GitHub Actions workflow
[`.github/workflows/db-backup.yml`](../.github/workflows/db-backup.yml): `supabase db dump`
of the **roles**, the **schema** and the **data** (`--data-only --use-copy`), compressed
and encrypted with `gpg --symmetric` (AES-256), kept 30 days as a workflow artifact (and
in a private R2/S3 bucket when those secrets are set).

> What is **not** in a backup: Storage files (images in the `brand` and `media` buckets;
> only their database rows are), Auth settings, Edge Function code, secrets and the
> Supabase dashboard configuration. Keep those documented separately.

## 0. One-time setup (owner)

GitHub → repository → *Settings → Secrets and variables → Actions → New repository secret*:

| Secret | Value |
|---|---|
| `SUPABASE_DB_URL` | Supabase → *Connect* → **Session pooler** connection string (IPv4; GitHub runners have no IPv6, so not the direct `db.<ref>.supabase.co` one): `postgresql://postgres.rncuhmvykrmtxfzqpitc:<db password>@aws-0-<region>.pooler.supabase.com:5432/postgres` |
| `BACKUP_PASSPHRASE` | a long random passphrase (`openssl rand -base64 48`). **Store it in the password manager too**: without it the backups cannot be opened. |
| `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `BACKUP_S3_REGION` | optional, for an off-GitHub copy (Cloudflare R2: endpoint `https://<account>.r2.cloudflarestorage.com`, region left empty). Use a key limited to that one bucket, and a lifecycle rule (e.g. delete after 90 days). |

Then run it once by hand: *Actions → Database backup → Run workflow*, and check that an
artifact named `levelup-db-<date>` appears.

## 1. Download and decrypt

```bash
# Artifact: Actions → Database backup → the run → Artifacts (a .zip around the file)
unzip levelup-db-20261011T061700Z.zip
# or from the bucket:
# aws s3 cp s3://<bucket>/supabase/levelup-db-20261011T061700Z.tar.gz.gpg . --endpoint-url <endpoint>

gpg --decrypt levelup-db-20261011T061700Z.tar.gz.gpg > backup.tar.gz   # asks for BACKUP_PASSPHRASE
mkdir backup && tar -xzf backup.tar.gz -C backup
cd backup && sha256sum -c SHA256SUMS                                  # roles.sql schema.sql data.sql: OK
```

Never commit these files: they contain every customer's data.

## 2. Restore

Restore into a **new** Supabase project (or a branch) first and check it, rather than
over the live database. You need `psql` (PostgreSQL 15+ client).

```bash
export NEW_DB_URL='postgresql://postgres.<new-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'

psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file roles.sql \
  --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --dbname "$NEW_DB_URL"
```

`session_replication_role = replica` turns triggers and foreign-key checks off while the
data loads (rows come in table order, not dependency order). If `roles.sql` fails because
a role already exists (it usually does on a fresh project), remove that statement from
the file and run again.

## 3. After restoring

1. Compare a few counts with production (`organizations`, `websites`, `access_requests`,
   `auth.users`).
2. Re-run the SQL test suites in `supabase/tests` (they roll back; expect `0 failed`).
3. Re-upload Storage files if the old project is gone (they are not in the dump).
4. Point the apps at the new project only if it replaces production: environment
   variables (`NEXT_PUBLIC_SUPABASE_URL`, publishable key) on Vercel, Auth URL
   configuration, Google provider, Send Email Hook, CAPTCHA (see `docs/auth.md`).
