#!/usr/bin/env bash
# release ENV SHA
#   Installs the uploaded build $YARD_SRV/ENV/incoming/SHA.tar.gz (+ SHA.sha256) and switches ENV to it.
#   Runs as the 'deploy' user (CI, through deploy-gate) or as root.
#
#   1. one release at a time (flock), checksum, unpack into releases/SHA, link the writable cache
#   2. 'next' -> releases/SHA; pre-migration pg_dump; db:migrate (check-env first)
#      a failed migration stops here: 'current' is untouched and the old release keeps serving
#   3. 'current' -> releases/SHA atomically ('previous' remembers the old one), restart the service
#   4. poll /api/health until status ok and version == SHA (90 s)
#   5. unhealthy: switch back to the previous release, restart, report both health bodies, exit 2
#   6. healthy: keep the newest 5 releases, delete the tarball, print the health JSON
#
# Exit codes: 0 deployed, 1 failed before the switch (nothing changed), 2 unhealthy and rolled back,
# 3 unhealthy and the rollback is unhealthy too (look now), 64 bad arguments.
set -euo pipefail
# shellcheck source=lib/common.sh
. "${YARD_COMMON:-/opt/yard/lib/common.sh}"

env=${1:-}
sha=${2:-}
require_env "$env"
valid_sha "$sha" || die "commit id must be 7-40 lowercase hex characters" 64
base="$YARD_SRV/$env"
svc=$(env_service "$env")
[[ -d "$base/releases" ]] || die "$base/releases is missing; run setup.sh first"

exec 9>"$base/.release.lock"
flock -n 9 || { log "another release of $env is running; waiting up to 10 minutes"; flock -w 600 9 || die "timed out waiting for the release lock"; }

umask 027
started=$SECONDS
prev=$(current_release "$env")
log "$env: releasing $sha (current: ${prev:-none})"

if [[ "$prev" == "$sha" ]]; then
  log "$env: $sha is already current; restarting and checking health"
  as_root "$SYSTEMCTL" restart "$svc"
  if body=$(wait_healthy "$env" "$sha" 90); then
    printf '%s\n' "$body"
    exit 0
  fi
  printf '%s\n' "$body"
  die "$sha is current but unhealthy" 3
fi

# --- 1. unpack ---------------------------------------------------------------------------------
tarball="$base/incoming/$sha.tar.gz"
sumfile="$base/incoming/$sha.sha256"
[[ -f "$tarball" ]] || die "$tarball not found (upload it first)"
[[ -f "$sumfile" ]] || die "$sumfile not found"
want=$(awk '{ print $1; exit }' "$sumfile")
[[ "$want" =~ ^[0-9a-f]{64}$ ]] || die "$sumfile does not hold a sha256"
have=$(sha256sum "$tarball" | awk '{ print $1 }')
[[ "$have" == "$want" ]] || die "checksum mismatch for $tarball (have $have, want $want)"

avail=$(df -Pk "$base" | awk 'NR==2 { print $4 }')
((avail > 1048576)) || die "less than 1 GB free under $base"

rel="$base/releases/$sha"
tmp="$base/releases/.$sha.tmp"
rm -rf -- "$tmp"
if [[ -e "$rel" ]]; then
  log "$env: replacing an earlier unpack of $sha"
  rm -rf -- "$rel"
fi
mkdir -p "$tmp"
tar -xzf "$tarball" -C "$tmp" --no-same-owner --no-same-permissions --delay-directory-restore
chmod -R u+rwX,g+rX,g-w,o-rwx "$tmp"
[[ -f "$tmp/server.js" ]] || die "the tarball has no server.js at its root (not a standalone build)"
[[ -f "$tmp/release.json" ]] || die "the tarball has no release.json"
rsha=$(jq -r '.sha // empty' "$tmp/release.json")
[[ "$rsha" == "$sha"* || "$sha" == "$rsha"* ]] || die "release.json says sha '$rsha', expected $sha"
renv=$(jq -r '.env // empty' "$tmp/release.json")
[[ -z "$renv" || "$renv" == "$env" ]] || die "this build was made for '$renv' (its public URL is baked in), not $env"
if compgen -G "$tmp/.env*" >/dev/null; then die "the tarball contains .env files; refusing (secrets live in $YARD_ETC only)"; fi

# The image optimiser and ISR write under .next/cache; the release itself stays read-only to 'yard'.
mkdir -p "$tmp/.next"
rm -rf -- "$tmp/.next/cache"
ln -s "$YARD_VAR/$env/next-cache" "$tmp/.next/cache"

# Browsers still running the previous build ask for its hashed chunks for a while; keep them.
if [[ -n "$prev" && -d "$base/releases/$prev/.next/static" && -d "$tmp/.next/static" ]]; then
  cp -a --update=none "$base/releases/$prev/.next/static/." "$tmp/.next/static/" 2>/dev/null ||
    cp -an "$base/releases/$prev/.next/static/." "$tmp/.next/static/"
fi
mv -T "$tmp" "$rel"
log "$env: unpacked $(du -sh "$rel" | cut -f1) into $rel"

# --- 2. migrate ----------------------------------------------------------------------------------
switch_link "$env" next "$sha"
if dump=$(as_root "$YARD_OPT/bin/yard-predump" "$env"); then
  log "$env: pre-migration backup: $dump"
else
  rm -f "$base/next"
  die "pre-migration backup failed; nothing changed ($svc still runs ${prev:-nothing})"
fi
if ! as_root "$YARD_OPT/bin/yard-migrate" "$env" next; then
  rm -f "$base/next"
  die "migration failed; nothing switched ($svc still runs ${prev:-nothing}). Database before the attempt: $dump"
fi

# --- 3. switch + restart -------------------------------------------------------------------------
old_previous=""
[[ -L "$base/previous" ]] && old_previous=$(basename "$(readlink "$base/previous")")
if [[ -n "$prev" ]]; then switch_link "$env" previous "$prev"; fi
switch_link "$env" current "$sha"
rm -f "$base/next"
log "$env: current -> $sha; restarting $svc"
as_root "$SYSTEMCTL" restart "$svc" || warn "systemctl restart $svc returned non-zero"

# --- 4. health -----------------------------------------------------------------------------------
if body=$(wait_healthy "$env" "$sha" 90); then
  log "$env: healthy on $sha after $((SECONDS - started)) s"
  # --- 6. tidy -----------------------------------------------------------------------------------
  keep=$YARD_KEEP_RELEASES
  mapfile -t all < <(find "$base/releases" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%T@ %f\n' | sort -rn | awk '{ print $2 }')
  n=0
  for r in "${all[@]}"; do
    n=$((n + 1))
    [[ "$r" == "$sha" || "$r" == "$prev" ]] && continue
    if ((n > keep)); then
      rm -rf -- "${base:?}/releases/$r"
      log "$env: pruned release $r"
    fi
  done
  rm -f -- "$tarball" "$sumfile"
  printf '%s\n' "$body"
  exit 0
fi

# --- 5. automatic rollback -----------------------------------------------------------------------
bad=$body
warn "$env: $sha is unhealthy after 90 s. Health said: $bad"
journal=$(as_root journalctl -u "$svc" -n 50 --no-pager 2>/dev/null || true)
if [[ -z "$prev" ]]; then
  printf '%s\n' "$journal" >&2
  die "$env: first release is unhealthy and there is nothing to roll back to" 3
fi
switch_link "$env" current "$prev"
# 'previous' goes back to what it was, so a later rollback still means "the release before $prev".
if [[ -n "$old_previous" && -d "$base/releases/$old_previous" ]]; then
  switch_link "$env" previous "$old_previous"
else
  rm -f "$base/previous"
fi
log "$env: rolled current back to $prev; restarting $svc"
as_root "$SYSTEMCTL" restart "$svc" || true
if body=$(wait_healthy "$env" "$prev" 90); then
  printf '%s\n' "--- last 50 log lines of $svc while $sha was running ---" "$journal" >&2
  printf '%s\n' "$body"
  log "$env: rolled back to $prev and it is healthy. The database keeps the schema of $sha (migrations are additive)."
  log "$env: pre-migration dump if the data must go back too: ${dump:-none}"
  exit 2
fi
printf '%s\n' "$journal" >&2
printf '%s\n' "$body"
die "$env: rollback to $prev is unhealthy too. Run 'sudo /opt/yard/bin/yard-status' on the server now." 3
