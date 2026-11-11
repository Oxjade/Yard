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
#
# Once started it always runs to the end, health check and automatic rollback included: a dropped
# SSH connection (SIGHUP, then SIGPIPE on the next message) is ignored. CI runs it detached through
# deploy-gate anyway; everything is also written to $YARD_SRV/ENV/logs/.
set -euo pipefail
trap '' PIPE HUP
# shellcheck source=lib/common.sh
. "${YARD_COMMON:-/opt/yard/lib/common.sh}"
# stdout that survives a closed pipe (and lands in the log file too)
out() {
  { printf '%s\n' "$@"; } 2>/dev/null || true
  if [[ -n "${YARD_LOG_FILE:-}" ]]; then { printf '%s\n' "$@" >>"$YARD_LOG_FILE"; } 2>/dev/null || true; fi
}

env=${1:-}
sha=${2:-}
require_env "$env"
valid_sha "$sha" || die "commit id must be 7-40 lowercase hex characters" 64
base="$YARD_SRV/$env"
svc=$(env_service "$env")
[[ -d "$base/releases" ]] || die "$base/releases is missing; run setup.sh first"

release_lock "$env"
# A copy of every message in the environment's log folder (deploy-gate already captures the whole
# run there, so it sets YARD_DETACHED and this is skipped).
if [[ -z "${YARD_DETACHED:-}" && -z "${YARD_LOG_FILE:-}" && -d "$base/logs" && -w "$base/logs" ]]; then
  YARD_LOG_FILE="$base/logs/release-$(date -u +%Y%m%dT%H%M%SZ)-$sha.log"
  export YARD_LOG_FILE
fi

umask 027
started=$SECONDS
prev=$(current_release "$env")
log "$env: releasing $sha (current: ${prev:-none})"

if [[ "$prev" == "$sha" ]]; then
  log "$env: $sha is already current; restarting and checking health"
  svc_restart "$svc"
  rm -f -- "$base/incoming/$sha.tar.gz" "$base/incoming/$sha.sha256"
  if body=$(wait_healthy "$env" "$sha" 90); then
    out "$body"
    exit 0
  fi
  out "$body"
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
# Refuse anything but plain files, folders and links that stay inside the release. A link with an
# absolute target, one that climbs out of the release, or one that goes through another link of the
# archive could point the steps below (or the server) at another tree. Next's standalone output does
# carry relative links (.next/node_modules/<pkg>-<hash> -> ../../node_modules/<pkg>), so relative
# targets are allowed as long as they resolve inside.
if ! bad=$(python3 -I - "$tarball" <<'PY'
import sys, tarfile

def norm(path):
    return [p for p in path.split("/") if p not in ("", ".")]

problems = []
with tarfile.open(sys.argv[1], "r:gz") as t:
    members = t.getmembers()
links = {"/".join(norm(m.name)) for m in members if m.issym()}
for m in members:
    parts = norm(m.name)
    if m.name.startswith("/") or ".." in parts:
        problems.append(f"unsafe path: {m.name}")
    elif any("/".join(parts[:i]) in links for i in range(1, len(parts))):
        problems.append(f"path goes through a link: {m.name}")
    elif m.islnk():
        if m.linkname.startswith("/") or ".." in norm(m.linkname):
            problems.append(f"hard link {m.name} -> {m.linkname}")
    elif m.issym():
        target = m.linkname
        if target.startswith("/") or not target:
            problems.append(f"symlink {m.name} -> {target} (absolute)")
            continue
        stack = parts[:-1]
        comps = norm(target)
        for i, c in enumerate(comps):
            if c == "..":
                if not stack:
                    problems.append(f"symlink {m.name} -> {target} (leaves the release)")
                    break
                stack.pop()
            else:
                stack.append(c)
                if i < len(comps) - 1 and "/".join(stack) in links:
                    problems.append(f"symlink {m.name} -> {target} (goes through another link)")
                    break
    elif not (m.isfile() or m.isdir()):
        problems.append(f"special file: {m.name}")
    if len(problems) >= 10:
        break
print("\n".join(problems))
sys.exit(1 if problems else 0)
PY
); then
  die "the tarball contains entries that are not allowed in a release:
$bad"
fi
mkdir -p "$tmp"
tar -xzf "$tarball" -C "$tmp" --no-same-owner --no-same-permissions --delay-directory-restore
chmod -R u+rwX,g+rX,g-w,o-rwx "$tmp"
# The folders the steps below write into must be real folders of this release, never links.
for d in "$tmp/.next" "$tmp/.next/static" "$tmp/.next/cache" "$tmp/public" "$tmp/tools" "$tmp/drizzle"; do
  [[ ! -L "$d" ]] || { rm -rf -- "$tmp"; die "${d#"$tmp"/} is a symbolic link in the tarball; refusing"; }
done
# Belt and braces: every link that was unpacked must really resolve inside the release.
while IFS= read -r -d '' l; do
  t=$(realpath -m -- "$l")
  if [[ "$t" != "$tmp" && "$t" != "$tmp/"* ]]; then
    rm -rf -- "$tmp"
    die "the unpacked release contains a link that leaves it (${l#"$tmp"/}); refusing"
  fi
done < <(find "$tmp" -type l -print0)
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

# Browsers still running the previous build ask for its hashed chunks for a while; keep them. Only
# that build's OWN files (listed in its .next/own-static.txt when it was unpacked) are carried, never
# what it carried itself, so a release holds at most two builds' chunks and size stays flat.
if [[ -d "$tmp/.next/static" ]]; then
  (cd "$tmp/.next/static" && find . -type f -printf '%P\n' | LC_ALL=C sort) >"$tmp/.next/own-static.txt"
else
  : >"$tmp/.next/own-static.txt"
fi
prev_static="$base/releases/$prev/.next/static"
prev_list="$base/releases/$prev/.next/own-static.txt"
if [[ -n "$prev" && -d "$prev_static" && ! -L "$prev_static" && -f "$prev_list" && -d "$tmp/.next/static" ]]; then
  carried=0
  while IFS= read -r f; do
    [[ -n "$f" && "$f" != /* && "/$f/" != */../* ]] || continue
    [[ -e "$tmp/.next/static/$f" || ! -f "$prev_static/$f" || -L "$prev_static/$f" ]] && continue
    mkdir -p "$tmp/.next/static/$(dirname "$f")"
    cp -p "$prev_static/$f" "$tmp/.next/static/$f"
    carried=$((carried + 1))
  done <"$prev_list"
  log "$env: carried $carried static files of the previous build ($prev)"
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
svc_restart "$svc" || warn "systemctl restart $svc returned non-zero"

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
  # release logs: keep the newest 20
  if [[ -d "$base/logs" ]]; then
    find "$base/logs" -maxdepth 1 -type f -name 'release-*' -printf '%T@ %p\n' 2>/dev/null | sort -rn | tail -n +41 | cut -d' ' -f2- | xargs -r rm -f --
  fi
  out "$body"
  exit 0
fi

# --- 5. automatic rollback -----------------------------------------------------------------------
bad=$body
warn "$env: $sha is unhealthy after 90 s. Health said: $bad"
journal=$(as_root journalctl -u "$svc" -n 50 --no-pager 2>/dev/null || true)
if [[ -z "$prev" ]]; then
  log "--- last 50 log lines of $svc ---"$'\n'"$journal"
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
svc_restart "$svc" || true
if body=$(wait_healthy "$env" "$prev" 90); then
  log "--- last 50 log lines of $svc while $sha was running ---"$'\n'"$journal"
  out "$body"
  log "$env: rolled back to $prev and it is healthy. The database keeps the schema of $sha (migrations are additive)."
  log "$env: pre-migration dump if the data must go back too: ${dump:-none}"
  exit 2
fi
log "--- last 50 log lines of $svc ---"$'\n'"$journal"
out "$body"
die "$env: rollback to $prev is unhealthy too. Run 'sudo /opt/yard/bin/yard-status' on the server now." 3
