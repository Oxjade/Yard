#!/usr/bin/env bash
# restore ENV DUMP [UPLOADS.tar.gz] [--yes]
#   Replaces ENV's database with DUMP (a pg_dump custom-format file from backup.sh, yard-predump or
#   a restore safety dump) and, optionally, its uploads with UPLOADS.tar.gz. Run as root.
#
#   A production dump can be restored into STAGING to rehearse a restore without touching
#   production: `restore staging /var/backups/yard/<day>/yard_production.dump`.
#
#   1. asks you to type the environment name (or pass --yes)
#   2. stops yard-ENV and takes a safety dump of the database as it is now
#   3. drops and recreates the database, pg_restore (owned by role yard_ENV), single transaction
#   4. uploads: the current folder is kept as uploads.before-restore-<time>
#   5. migrates (brings an older dump up to the current release), starts, waits for /api/health
set -euo pipefail
# shellcheck source=lib/common.sh
. "${YARD_COMMON:-/opt/yard/lib/common.sh}"
((EUID == 0)) || die "run as root"

usage() { die "usage: restore production|staging DUMP [UPLOADS.tar.gz] [--yes]" 64; }
yes=0
args=()
for a in "$@"; do
  case "$a" in
    --yes) yes=1 ;;
    -h | --help) usage ;;
    *) args+=("$a") ;;
  esac
done
((${#args[@]} >= 2 && ${#args[@]} <= 3)) || usage
env=${args[0]}
dump=${args[1]}
uploads=${args[2]:-}
require_env "$env"
[[ -f "$dump" ]] || die "$dump not found"
[[ -z "$uploads" || -f "$uploads" ]] || die "$uploads not found"
dump=$(readlink -f "$dump")
[[ -n "$uploads" ]] && uploads=$(readlink -f "$uploads")

db=$(env_db "$env")
svc=$(env_service "$env")
sha=$(current_release "$env")
[[ -n "$sha" ]] || die "$env has no release deployed yet; deploy once, then restore"

# Validate the archive before touching anything.
pg_restore --list "$dump" >/dev/null || die "$dump is not a pg_dump custom-format archive"
if [[ -n "$uploads" ]]; then
  tar -tzf "$uploads" | grep -qE '^(\./)?production/uploads/?$' || die "$uploads does not contain production/uploads/ (made by backup.sh?)"
fi

cat >&2 <<MSG

  RESTORE INTO $(tr '[:lower:]' '[:upper:]' <<<"$env")
    database  $db  <-  $dump
    uploads   ${uploads:-unchanged}
  $svc will be stopped for the duration. A safety dump of the current database is taken first.
MSG
if [[ "$env" == staging ]] && pg_restore --list "$dump" 2>/dev/null | head -n 20 | grep -q 'yard_production'; then
  cat >&2 <<'MSG'
  Note: this is a production dump going into staging. Staging has its own encryption key, so
  encrypted fields (social tokens, payout details) will not decrypt there, and staging now holds
  real customer emails: keep EMAIL_* unset in /etc/yard/staging.env.
MSG
fi
if ((yes == 0)); then
  [[ -t 0 ]] || die "not a terminal: pass --yes to confirm"
  read -r -p "  Type '$env' to continue: " answer
  [[ "$answer" == "$env" ]] || die "not confirmed; nothing changed"
fi

was_active=0
"$SYSTEMCTL" is-active --quiet "$svc" && was_active=1
log "stopping $svc"
"$SYSTEMCTL" stop "$svc" || true

safety_dir="$YARD_BACKUPS/pre-restore"
install -d -m 700 -o root -g root "$YARD_BACKUPS" "$safety_dir"
safety="$safety_dir/$db-$(date -u +%Y%m%dT%H%M%SZ).dump"
if [[ -n "$(psql_root -Atc "select 1 from pg_database where datname = '$db'")" ]]; then
  runuser -u postgres -- pg_dump --format=custom --dbname="$db" >"$safety"
  chmod 600 "$safety"
  log "safety dump of the current database: $safety"
fi

log "recreating $db"
psql_root -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$db' and pid <> pg_backend_pid()" >/dev/null
psql_root -c "drop database if exists $db"
pg_create_db "$env"
log "restoring $(basename "$dump")"
# runuser cannot read root-only files as postgres; feed the archive on stdin.
if ! runuser -u postgres -- pg_restore --no-owner --no-privileges --role="$db" --dbname="$db" \
  --single-transaction --exit-on-error <"$dump"; then
  warn "pg_restore failed. The database is empty now; the previous state is in $safety"
  warn "to put it back: restore $env $safety --yes"
  exit 1
fi

if [[ -n "$uploads" ]]; then
  parent="$YARD_VAR/$env/production"
  install -d -m 700 -o yard -g yard "$YARD_VAR/$env" "$parent"
  stage=$(mktemp -d "$parent/.restore.XXXXXX")
  tar -xzf "$uploads" -C "$stage" --no-same-owner
  [[ -d "$stage/production/uploads" ]] || die "archive did not unpack production/uploads"
  if [[ -d "$parent/uploads" ]]; then
    keep="$parent/uploads.before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
    mv "$parent/uploads" "$keep"
    log "previous uploads kept at $keep (delete it once you are happy)"
  fi
  mv "$stage/production/uploads" "$parent/uploads"
  rm -rf -- "$stage"
  chown -R yard:yard "$parent/uploads"
  chmod -R go-rwx "$parent/uploads"
  log "uploads restored"
fi

log "migrating the restored database to release $sha"
"$YARD_OPT/bin/yard-migrate" "$env" current
log "starting $svc"
"$SYSTEMCTL" start "$svc"
if body=$(wait_healthy "$env" "$sha" 90); then
  printf '%s\n' "$body"
  log "restore of $env done"
  if [[ "$env" == staging && $was_active -eq 0 ]]; then
    log "staging was stopped before the restore; it is running now (sudo systemctl stop yard-staging to free memory)"
  fi
  exit 0
fi
printf '%s\n' "$body"
die "$env restored but not healthy; check journalctl -u $svc -n 100" 3
