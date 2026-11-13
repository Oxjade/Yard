#!/usr/bin/env bash
# Switch the Yard quick-start server from the built-in database to Postgres, then update to the
# latest v3. Run as root once. Test data in the built-in database is NOT carried over.
set -euo pipefail
say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

say "1/6 Install Postgres"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y postgresql postgresql-contrib
systemctl enable --now postgresql
PGV=$(ls /etc/postgresql | sort -V | tail -1)
CONF=/etc/postgresql/$PGV/main/postgresql.conf

say "2/6 Tune Postgres for a small server (1.6 GB RAM)"
cat > /etc/postgresql/$PGV/main/conf.d/yard.conf <<'EOF'
listen_addresses = 'localhost'
max_connections = 30
shared_buffers = 128MB
effective_cache_size = 384MB
work_mem = 4MB
maintenance_work_mem = 32MB
wal_buffers = 4MB
EOF
grep -q "^include_dir = 'conf.d'" "$CONF" || echo "include_dir = 'conf.d'" >> "$CONF"
systemctl restart postgresql

say "3/6 Create the yard database and user"
if ! grep -q '^DATABASE_URL=' /etc/yard.env; then
  PW=$(openssl rand -hex 24)
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE yard LOGIN PASSWORD '$PW';"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE yard OWNER yard;"
  echo "DATABASE_URL=postgresql://yard:$PW@127.0.0.1:5432/yard" >> /etc/yard.env
fi
grep -q '^YARD_PAYMENTS=' /etc/yard.env || echo "YARD_PAYMENTS=off" >> /etc/yard.env
chmod 700 /var/lib/yard

say "4/6 Pull and build the latest code (10-20 minutes)"
sudo -u yard bash -c 'cd ~/app && git pull --ff-only && npm ci --no-audit --no-fund && YARD_PUBLIC_URL=$(grep -m1 ^YARD_PUBLIC_URL= /etc/yard.env | cut -d= -f2-) YARD_SKIP_TYPECHECK=1 NODE_OPTIONS=--max-old-space-size=1536 npm run build'

say "5/6 Create the tables"
sudo -u yard bash -c 'set -a; . /etc/yard.env; cd ~/app && npm run db:migrate'

say "6/6 Nightly database backup (kept 14 days) and restart"
mkdir -p /var/backups/yard && chown postgres:postgres /var/backups/yard && chmod 700 /var/backups/yard
cat > /etc/cron.d/yard-backup <<'EOF'
15 3 * * * postgres pg_dump -Fc yard > /var/backups/yard/yard-$(date +\%F).dump && find /var/backups/yard -name 'yard-*.dump' -mtime +14 -delete
EOF
# yard-update now also runs migrations after each build.
cat > /usr/local/bin/yard-update <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
sudo -u yard bash -c 'cd ~/app && git pull --ff-only && npm ci --no-audit --no-fund && YARD_PUBLIC_URL=$(grep -m1 ^YARD_PUBLIC_URL= /etc/yard.env | cut -d= -f2-) YARD_SKIP_TYPECHECK=1 NODE_OPTIONS=--max-old-space-size=1536 npm run build'
sudo -u postgres pg_dump -Fc yard > /var/backups/yard/pre-update-$(date +%F-%H%M).dump
sudo -u yard bash -c 'set -a; . /etc/yard.env; cd ~/app && npm run db:migrate'
sudo -u yard bash -c 'set -a; . /etc/yard.env; cd ~/app && npm run geoip:update' || true
systemctl restart yard
sleep 8
curl -fsS http://127.0.0.1:3000/api/health && echo || { echo "Health check failed: journalctl -u yard -n 50"; exit 1; }
# Warm the main pages so the first visitor after a deploy does not wait for them to render.
for p in / /brands /drops /charts /around /sell /categories; do curl -s -o /dev/null http://127.0.0.1:3000$p || true; done
EOF
chmod 755 /usr/local/bin/yard-update
systemctl restart yard
sleep 10
curl -fsS http://127.0.0.1:3000/api/health && echo && echo "Done: Yard is on Postgres." || echo "Not healthy yet: run journalctl -u yard -n 50 and send me the output."
