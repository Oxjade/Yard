#!/usr/bin/env bash
# rollback ENV [SHA]
#   Switches ENV back to the previous release (or to SHA, any release still kept under
#   $YARD_SRV/ENV/releases), restarts it and waits for /api/health.
#   Code only: the database keeps any schema change of the newer release (migrations are additive).
#   To put the data back too, restore the pre-migration dump (see README, "Restore").
# Runs as root (owner) or as deploy (CI through deploy-gate, previous release only).
set -euo pipefail
# shellcheck source=lib/common.sh
. "${YARD_COMMON:-/opt/yard/lib/common.sh}"

env=${1:-}
target=${2:-}
require_env "$env"
base="$YARD_SRV/$env"
svc=$(env_service "$env")

exec 9>"$base/.release.lock"
flock -w 600 9 || die "a release of $env is running; try again when it finishes"

cur=$(current_release "$env")
if [[ -z "$target" ]]; then
  [[ -L "$base/previous" ]] || die "$env has no previous release to go back to"
  target=$(basename "$(readlink "$base/previous")")
fi
valid_sha "$target" || die "release id must be 7-40 lowercase hex characters" 64
[[ -f "$base/releases/$target/server.js" ]] || {
  log "kept releases of $env:"
  find "$base/releases" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '  %f  %TY-%Tm-%Td %TH:%TM\n' | sort -k2 -r >&2
  die "release $target is not on this server"
}
[[ "$target" != "$cur" ]] || die "$target is already current"

log "$env: switching current $cur -> $target"
[[ -n "$cur" ]] && switch_link "$env" previous "$cur"
switch_link "$env" current "$target"
as_root "$SYSTEMCTL" restart "$svc" || warn "systemctl restart $svc returned non-zero"
if body=$(wait_healthy "$env" "$target" 90); then
  printf '%s\n' "$body"
  log "$env: rolled back to $target and healthy. Schema changes made by $cur stay in the database."
  pre=$(find "$YARD_BACKUPS/pre-migrate/$env" -maxdepth 1 -name 'pre-*.dump' -printf '%f\n' 2>/dev/null | sort -r | head -n 1 || true)
  [[ -n "$pre" ]] && log "$env: newest pre-migration dump: $YARD_BACKUPS/pre-migrate/$env/$pre (restore.sh can load it)"
  exit 0
fi
printf '%s\n' "$body"
warn "$env: $target is not healthy"
if [[ -n "$cur" ]]; then
  switch_link "$env" current "$cur"
  switch_link "$env" previous "$target"
  as_root "$SYSTEMCTL" restart "$svc" || true
  if body=$(wait_healthy "$env" "$cur" 90); then
    printf '%s\n' "$body"
    die "$env: $target was unhealthy, so $env is back on $cur (healthy). Nothing changed." 2
  fi
fi
die "$env: neither $target nor ${cur:-the old release} is healthy. Check 'journalctl -u $svc -n 100' now." 3
