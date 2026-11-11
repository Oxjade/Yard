#!/usr/bin/env bash
# backup
#   Nightly (yard-backup.timer, 03:17 server time) and on demand, as root:
#   - pg_dump (custom format) of yard_production and yard_staging
#   - tar.gz of production uploads
#   - SHA256SUMS, into /var/backups/yard/YYYY-MM-DD/ (root only)
#   - keeps 14 days locally (YARD_BACKUP_KEEP_DAYS in /etc/yard/backup.env)
#   - optional off-server copy: set RCLONE_REMOTE in /etc/yard/backup.env (off by default; README)
# The encryption keys are NOT in these backups on purpose. Keep them separately (README).
set -euo pipefail
# shellcheck source=lib/common.sh
. "${YARD_COMMON:-/opt/yard/lib/common.sh}"
((EUID == 0)) || die "run as root"

RCLONE_REMOTE=""
YARD_BACKUP_KEEP_DAYS=14
RCLONE_KEEP_DAYS=30
if [[ -r "$YARD_ETC/backup.env" ]]; then
  RCLONE_REMOTE=$(env_get "$YARD_ETC/backup.env" RCLONE_REMOTE)
  v=$(env_get "$YARD_ETC/backup.env" YARD_BACKUP_KEEP_DAYS)
  [[ "$v" =~ ^[0-9]+$ ]] && YARD_BACKUP_KEEP_DAYS=$v
  v=$(env_get "$YARD_ETC/backup.env" RCLONE_KEEP_DAYS)
  [[ "$v" =~ ^[0-9]+$ ]] && RCLONE_KEEP_DAYS=$v
fi

exec 9>/run/yard-backup.lock
flock -n 9 || die "another backup is running"

day=$(date -u +%F)
dir="$YARD_BACKUPS/$day"
install -d -m 700 -o root -g root "$YARD_BACKUPS" "$dir"
avail=$(df -Pk "$YARD_BACKUPS" | awk 'NR==2 { print $4 }')
((avail > 3145728)) || warn "less than 3 GB free under $YARD_BACKUPS"
((avail > 524288)) || die "less than 512 MB free; not backing up"

failed=0
for env in "${YARD_ENVS[@]}"; do
  db=$(env_db "$env")
  if ! runuser -u postgres -- psql -Atqc "select 1 from pg_database where datname = '$db'" | grep -q 1; then
    warn "database $db does not exist; skipped"
    continue
  fi
  if runuser -u postgres -- pg_dump --format=custom --compress=6 --dbname="$db" >"$dir/$db.dump.part"; then
    mv "$dir/$db.dump.part" "$dir/$db.dump"
    log "dumped $db ($(du -h "$dir/$db.dump" | cut -f1))"
  else
    rm -f "$dir/$db.dump.part"
    warn "pg_dump of $db failed"
    failed=1
  fi
done

uploads_parent="$YARD_VAR/production"
if [[ -d "$uploads_parent/production/uploads" ]]; then
  if tar -czf "$dir/uploads-production.tar.gz.part" -C "$uploads_parent" --exclude=production/uploads/tmp production/uploads; then
    mv "$dir/uploads-production.tar.gz.part" "$dir/uploads-production.tar.gz"
    log "archived production uploads ($(du -h "$dir/uploads-production.tar.gz" | cut -f1))"
  else
    rm -f "$dir/uploads-production.tar.gz.part"
    warn "tar of production uploads failed"
    failed=1
  fi
else
  log "no production uploads yet; skipped"
fi

(cd "$dir" && find . -maxdepth 1 -type f \( -name '*.dump' -o -name '*.tar.gz' \) | sed 's|^\./||' | sort | xargs -r sha256sum >"$dir/.sums" && mv -f "$dir/.sums" "$dir/SHA256SUMS")
find "$dir" -maxdepth 1 -type f -exec chmod 600 {} +

# local retention: dated folders older than N days
cutoff=$(date -u -d "-$YARD_BACKUP_KEEP_DAYS days" +%F)
while IFS= read -r d; do
  name=$(basename "$d")
  if [[ "$name" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ && "$name" < "$cutoff" ]]; then
    rm -rf -- "$d"
    log "removed old backup $name"
  fi
done < <(find "$YARD_BACKUPS" -mindepth 1 -maxdepth 1 -type d)

if [[ -n "$RCLONE_REMOTE" ]]; then
  if command -v rclone >/dev/null; then
    log "copying $day to $RCLONE_REMOTE/yard/$day"
    if rclone --config /root/.config/rclone/rclone.conf copy "$dir" "$RCLONE_REMOTE/yard/$day" &&
      rclone --config /root/.config/rclone/rclone.conf delete --min-age "${RCLONE_KEEP_DAYS}d" "$RCLONE_REMOTE/yard" &&
      rclone --config /root/.config/rclone/rclone.conf rmdirs --leave-root "$RCLONE_REMOTE/yard"; then
      log "off-server copy done"
    else
      warn "off-server copy failed"
      failed=1
    fi
  else
    warn "RCLONE_REMOTE is set but rclone is not installed"
    failed=1
  fi
else
  log "off-server copy is off (RCLONE_REMOTE empty in $YARD_ETC/backup.env)"
fi

log "backup $day: $(du -sh "$dir" | cut -f1) in $dir"
exit "$failed"
