#!/usr/bin/env bash
# backup
#   Nightly (yard-backup.timer, 03:17 server time) and on demand, as root:
#   - pg_dump (custom format) of yard_production and yard_staging
#   - tar.gz of production uploads
#   - SHA256SUMS, into /var/backups/yard/YYYY-MM-DD/ (root only)
#   The folder is built as .partial-YYYY-MM-DD and renamed only when every dump and archive worked,
#   so a dated folder always holds a complete, verified backup. A failed run is kept as
#   YYYY-MM-DD.failed for inspection, the service ends "failed", and yard-status says so.
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
final="$YARD_BACKUPS/$day"
dir="$YARD_BACKUPS/.partial-$day"
rm -rf -- "$dir"
install -d -m 700 -o root -g root "$YARD_BACKUPS" "$dir"
result() { # ok|failed MESSAGE: one line yard-status reads
  printf '%s %s %s\n' "$1" "$(date -u +%FT%TZ)" "$2" >"$YARD_BACKUPS/.last-result.tmp" && mv -f "$YARD_BACKUPS/.last-result.tmp" "$YARD_BACKUPS/last-result"
}
# shellcheck disable=SC2317 # called by the EXIT trap
on_exit() {
  local rc=$?
  if ((rc != 0)) && [[ -d "$dir" && "$dir" != "$final" ]]; then
    rm -rf -- "$final.failed"
    mv -f "$dir" "$final.failed" 2>/dev/null || true
    result failed "backup stopped (exit $rc); see journalctl -u yard-backup"
  fi
}
trap on_exit EXIT
avail=$(df -Pk "$YARD_BACKUPS" | awk 'NR==2 { print $4 }')
((avail > 3145728)) || warn "less than 3 GB free under $YARD_BACKUPS"
((avail > 524288)) || die "less than 512 MB free; not backing up"
pg_isready -q -h /var/run/postgresql 2>/dev/null || runuser -u postgres -- pg_isready -q || die "PostgreSQL is not running"

failed=0
for env in "${YARD_ENVS[@]}"; do
  db=$(env_db "$env")
  exists=$(runuser -u postgres -- psql -Atqc "select 1 from pg_database where datname = '$db'") || {
    warn "could not ask PostgreSQL about $db"
    failed=1
    continue
  }
  if [[ -z "$exists" ]]; then
    if [[ "$env" == production ]]; then
      warn "database $db does not exist"
      failed=1
    else
      warn "database $db does not exist; skipped"
    fi
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
if ((failed == 0)) && [[ -s "$dir/yard_production.dump" ]] && (cd "$dir" && sha256sum --quiet -c SHA256SUMS); then
  rm -rf -- "$final" "$final.failed"
  mv -T "$dir" "$final"
  dir=$final
  result ok "$final"
else
  rm -rf -- "$final.failed"
  mv -T "$dir" "$final.failed"
  dir="$final.failed"
  result failed "incomplete backup kept in $dir"
  failed=1
  warn "backup $day is INCOMPLETE (kept as $dir); the last complete one is still in place"
fi

# local retention: dated folders older than N days
cutoff=$(date -u -d "-$YARD_BACKUP_KEEP_DAYS days" +%F)
while IFS= read -r d; do
  name=$(basename "$d")
  if [[ "$name" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.failed)?$ && "${name:0:10}" < "$cutoff" ]]; then
    rm -rf -- "$d"
    log "removed old backup $name"
  fi
done < <(find "$YARD_BACKUPS" -mindepth 1 -maxdepth 1 -type d)

if [[ -n "$RCLONE_REMOTE" && "$dir" == "$final" ]]; then
  if command -v rclone >/dev/null; then
    log "copying $day to $RCLONE_REMOTE/yard/$day"
    if rclone --config /root/.config/rclone/rclone.conf copy "$dir" "$RCLONE_REMOTE/yard/$day" &&
      rclone --config /root/.config/rclone/rclone.conf delete --min-age "${RCLONE_KEEP_DAYS}d" "$RCLONE_REMOTE/yard" &&
      rclone --config /root/.config/rclone/rclone.conf rmdirs --leave-root "$RCLONE_REMOTE/yard"; then
      log "off-server copy done"
    else
      warn "off-server copy failed"
      result failed "local backup $final is complete, but the off-server copy to $RCLONE_REMOTE failed"
      failed=1
    fi
  else
    warn "RCLONE_REMOTE is set but rclone is not installed"
    result failed "local backup $final is complete, but rclone is not installed for the off-server copy"
    failed=1
  fi
elif [[ -z "$RCLONE_REMOTE" ]]; then
  log "off-server copy is off (RCLONE_REMOTE empty in $YARD_ETC/backup.env)"
fi

log "backup $day: $(du -sh "$dir" | cut -f1) in $dir"
trap - EXIT
exit "$failed"
