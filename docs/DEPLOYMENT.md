# Installation and deployment

> Not a developer? Use **[GO_LIVE.md](GO_LIVE.md)**: one-click hosting on Render.

## Requirements

- Node.js 20.19 or newer (22 LTS recommended)
- PostgreSQL 14 or newer (developed and tested on 16)
- `pg_dump` / `pg_restore` for backups

## Local development

```bash
git clone https://github.com/marioibay19-tech/FUEL-REQUISITION-AND-LOG-BOOK.git
cd FUEL-REQUISITION-AND-LOG-BOOK
npm install                       # installs both workspaces and generates the Prisma client
cp .env.example server/.env       # then edit DATABASE_URL, SESSION_SECRET, SEED_ADMIN_PASSWORD
```

Create the databases (once):

```bash
sudo -u postgres psql -c "CREATE USER fueltrack WITH PASSWORD 'choose-a-password' CREATEDB;"
sudo -u postgres createdb -O fueltrack fueltrack
sudo -u postgres createdb -O fueltrack fueltrack_test
```

Apply migrations, seed and run:

```bash
npm run db:deploy
npm run db:seed          # admin + reference data; demo data if SEED_DEMO_DATA=true
npm run dev              # API on :4000, web app on http://localhost:5173
```

## Tests

```bash
npm test
```

The API tests use `TEST_DATABASE_URL`. That database is **dropped and recreated on every run**, and the setup refuses any database whose name does not end in `_test`.

## Production (single server)

```bash
npm ci
npm run build                 # builds the API (server/dist) and the web client (client/dist)
NODE_ENV=production npm run start:prod
# start:prod applies pending migrations, creates the reference data and the first
# administrator (from SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD) if missing, then
# serves the API and the web client on PORT. It is safe to run on every start.
```

Production environment (in `server/.env` or the process manager):

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Use a dedicated database user that owns only this database (least privilege) |
| `SESSION_SECRET` | At least 32 random characters: `openssl rand -hex 32`. Required |
| `NODE_ENV=production` | |
| `TRUST_PROXY=true` | When behind Nginx / a load balancer terminating HTTPS. Enables secure cookies |
| `APP_ORIGIN` | Public URL, e.g. `https://fueltrack.example.gov.ph` |
| `SEED_ADMIN_PASSWORD` | First administrator's password (10+ characters). Used only if the account does not exist yet |
| `UPLOAD_DIR` | Only needed for documents uploaded by versions before 1.1. New uploads are stored in the database |
| `SEED_DEMO_DATA=false` | Never load demo data in production |

Run it behind HTTPS (for example Nginx with a certificate) and keep the process alive with systemd or pm2. Example Nginx location:

```nginx
location / {
  proxy_pass http://127.0.0.1:4000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  client_max_body_size 6m;
}
```

## Docker

`Dockerfile` and `docker-compose.yml` build one image that applies migrations on start and serves everything on port 4000:

```bash
printf "POSTGRES_PASSWORD=%s\nSESSION_SECRET=%s\nSEED_ADMIN_PASSWORD=%s\n" "$(openssl rand -hex 16)" "$(openssl rand -hex 32)" "Choose-A-Strong-1" > .env
docker compose up -d --build     # first start creates the admin account
```

> The container files follow the same steps as the verified single-server procedure, but they were **not built in the development environment** (no Docker daemon was available). Test them in your environment before relying on them.

## Backups

```bash
npm run backup --workspace server          # BACKUP_DIR=./backups by default
```

This writes a `pg_dump` custom-format file, which includes uploaded documents (they are stored in the database), plus a `.tar.gz` of the legacy upload folder if one exists. It keeps the latest 30 of each. Schedule it daily (cron or systemd timer) and copy the files off the server.

Restore into an empty database:

```bash
pg_restore --no-owner --dbname "$DATABASE_URL" backups/fueltrack-db-YYYY-MM-DDTHH-MM-SS.dump
tar -xzf backups/fueltrack-uploads-….tar.gz -C /path/to/parent-of-uploads
```

Test a restore periodically on a separate database.

## Upgrades

```bash
git pull && npm ci && npm run build && npm run db:deploy && <restart the service>
```

Take a backup before applying migrations.

## Security checklist before go-live

- [ ] Strong `SESSION_SECRET`; `.env` readable only by the service account
- [ ] HTTPS with `TRUST_PROXY=true`
- [ ] Database user limited to the FUELTRACK database; PostgreSQL not exposed to the internet
- [ ] Demo data not loaded; seeded admin password changed
- [ ] Daily backups scheduled and a restore tested
- [ ] Workflow settings reviewed against office policy (self-approval, attachments, receipts)
- [ ] Independent security review and user acceptance testing completed
