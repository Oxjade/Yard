# shellcheck shell=bash
# Shared helpers for the Yard deploy kit. Sourced by every script in /opt/yard/bin.
# Installed to /opt/yard/lib/common.sh by setup.sh (root-owned, 0644).

YARD_ETC=${YARD_ETC:-/etc/yard}
YARD_SRV=${YARD_SRV:-/srv/yard}
YARD_VAR=${YARD_VAR:-/var/lib/yard}
YARD_BACKUPS=${YARD_BACKUPS:-/var/backups/yard}
YARD_OPT=${YARD_OPT:-/opt/yard}
# shellcheck disable=SC2034 # used by the scripts that source this file
YARD_ENVS=(production staging)
YARD_KEEP_RELEASES=${YARD_KEEP_RELEASES:-5}

# Messages go to stderr and, when YARD_LOG_FILE is set (release/rollback), to that file too. A write
# to a closed stderr (the CI's SSH connection dropped) is ignored, never fatal: with SIGPIPE ignored
# the script carries on to its health check and automatic rollback.
_yard_say() {
  local line
  line=$(printf '[yard %s] %s' "$(date -u +%H:%M:%S)" "$*")
  { printf '%s\n' "$line" >&2; } 2>/dev/null || true
  if [[ -n "${YARD_LOG_FILE:-}" ]]; then { printf '%s\n' "$line" >>"$YARD_LOG_FILE"; } 2>/dev/null || true; fi
}
log() { _yard_say "$*"; }
warn() { _yard_say "WARNING: $*"; }
die() { _yard_say "ERROR: $1"; exit "${2:-1}"; }

# valid_env NAME: production or staging, nothing else.
valid_env() {
  case "${1:-}" in
    production | staging) return 0 ;;
    *) return 1 ;;
  esac
}
require_env() { valid_env "${1:-}" || die "environment must be 'production' or 'staging' (got '${1:-}')" 64; }

# A git commit id: 7 to 40 lowercase hex characters.
valid_sha() { [[ "${1:-}" =~ ^[0-9a-f]{7,40}$ ]]; }

env_port() {
  case "$1" in
    production) echo 3000 ;;
    staging) echo 3001 ;;
  esac
}
env_service() { echo "yard-$1"; }
env_db() { echo "yard_$1"; }
# One Unix user per environment, so staging code can never read production's secrets or data:
#   yard-ENV    runs the app (no login); owns /var/lib/yard/ENV; group of /etc/yard/ENV.env (0640)
#   deploy-ENV  the CI deploy user of ENV (forced command deploy-gate ENV); owns /srv/yard/ENV
env_user() { echo "yard-$1"; }
env_deploy_user() { echo "deploy-$1"; }
env_heap() { if [[ "$1" == staging ]]; then echo 256; else echo 384; fi; }
env_memmax() { if [[ "$1" == staging ]]; then echo 400M; else echo 550M; fi; }
other_env() { if [[ "$1" == staging ]]; then echo production; else echo staging; fi; }

# load_env_file FILE: exports KEY=VALUE lines (the subset of systemd EnvironmentFile syntax the kit
# writes: no inline comments, optional matching single or double quotes). Never evals anything.
load_env_file() {
  local file=$1 line key value
  [[ -r "$file" ]] || die "cannot read $file"
  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    [[ -z "${line//[[:space:]]/}" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ ! "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      warn "ignoring malformed line in $file"
      continue
    fi
    key=${BASH_REMATCH[1]}
    value=${BASH_REMATCH[2]}
    if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then value=${BASH_REMATCH[1]}; fi
    export "$key=$value"
  done <"$file"
}

# env_get FILE KEY: prints the value of KEY from an env file ('' when absent).
env_get() {
  local file=$1 key=$2 line value=""
  [[ -r "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^[[:space:]]*${key}=(.*)$ ]]; then
      value=${BASH_REMATCH[1]}
      if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then value=${BASH_REMATCH[1]}; fi
    fi
  done <"$file"
  printf '%s' "$value"
}

# env_set FILE KEY VALUE: replaces KEY's line in place (keeping owner and mode) or appends it.
env_set() {
  local file=$1 key=$2 value=$3 tmp
  tmp=$(mktemp "${file}.XXXXXX")
  if grep -qE "^[[:space:]]*${key}=" "$file"; then
    awk -v k="$key" -v v="$value" 'BEGIN { re = "^[[:space:]]*" k "=" } $0 ~ re { print k "=" v; next } { print }' "$file" >"$tmp"
  else
    cat "$file" >"$tmp"
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
  fi
  chown --reference="$file" "$tmp"
  chmod --reference="$file" "$tmp"
  mv -f "$tmp" "$file"
}

# current_release ENV: the sha the 'current' symlink points at ('' when none).
current_release() {
  local link="$YARD_SRV/$1/current"
  [[ -L "$link" ]] || return 0
  basename "$(readlink "$link")"
}

# switch_link ENV NAME SHA: atomically points $YARD_SRV/ENV/NAME at releases/SHA.
switch_link() {
  local base="$YARD_SRV/$1" name=$2 sha=$3
  ln -sfn "releases/$sha" "$base/.$name.tmp"
  mv -T "$base/.$name.tmp" "$base/$name"
}

# health_json ENV: one GET of /api/health; prints the body (or nothing) and returns 0 on HTTP 200.
health_json() {
  local port code body
  port=$(env_port "$1")
  body=$(curl -sS --max-time 5 -o - -w '\n%{http_code}' "http://127.0.0.1:${port}/api/health" 2>/dev/null) || {
    return 1
  }
  code=${body##*$'\n'}
  body=${body%$'\n'*}
  printf '%s' "$body"
  [[ "$code" == "200" ]]
}

# wait_healthy ENV SHA [SECONDS]: polls /api/health until status ok and the version matches SHA
# (either may be a prefix of the other, at least 7 characters). Prints the last body seen.
wait_healthy() {
  local env=$1 sha=$2 limit=${3:-90} start body status version
  start=$SECONDS
  body=""
  while ((SECONDS - start < limit)); do
    if body=$(health_json "$env"); then
      status=$(jq -r '.status // empty' <<<"$body" 2>/dev/null || true)
      version=$(jq -r '.version // empty' <<<"$body" 2>/dev/null || true)
      if [[ "$status" == "ok" && ${#version} -ge 7 && ("$sha" == "$version"* || "$version" == "$sha"*) ]]; then
        printf '%s\n' "$body"
        return 0
      fi
    fi
    sleep 2
  done
  printf '%s\n' "${body:-<no response from 127.0.0.1:$(env_port "$env")/api/health>}"
  return 1
}

# The systemctl binary (setup.sh writes the same path into the sudoers rule).
SYSTEMCTL=${SYSTEMCTL:-$(command -v systemctl || echo /usr/bin/systemctl)}

# as_root CMD...: runs CMD directly when already root, else through sudo -n (the fixed rules in
# /etc/sudoers.d/yard-deploy; anything else fails instead of prompting).
as_root() {
  if ((EUID == 0)); then "$@"; else sudo -n "$@"; fi
}

# app_sandbox_props ENV: the systemd sandbox of the yard-ENV unit (deploy/systemd/yard-ENV.service),
# as `systemd-run -p` arguments, one per line. Keep the two in step.
app_sandbox_props() {
  local env=$1 other
  other=$(other_env "$env")
  printf '%s\n' "User=$(env_user "$env")" "Group=$(env_user "$env")" \
    "UMask=0077" "NoNewPrivileges=yes" "ProtectSystem=strict" "ReadWritePaths=$YARD_VAR/$env" \
    "ProtectHome=yes" "PrivateTmp=yes" "PrivateDevices=yes" "ProtectProc=invisible" \
    "ProtectKernelTunables=yes" "ProtectKernelModules=yes" "ProtectKernelLogs=yes" "ProtectControlGroups=yes" \
    "ProtectClock=yes" "ProtectHostname=yes" "RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX" \
    "RestrictNamespaces=yes" "RestrictRealtime=yes" "RestrictSUIDSGID=yes" "LockPersonality=yes" \
    "SystemCallArchitectures=native" "CapabilityBoundingSet=" \
    "InaccessiblePaths=-$YARD_ETC/$other.env -$YARD_VAR/$other -$YARD_SRV/$other -$YARD_ETC/backup.env -$YARD_BACKUPS" \
    "MemoryMax=$(env_memmax "$env")"
}

# run_as_app ENV DIR CMD...: runs CMD in DIR as yard-ENV with exactly the variables of
# /etc/yard/ENV.env (plus PATH, HOME, LANG and the unit's memory settings), inside the same systemd
# sandbox as the yard-ENV service (systemd-run), so a release's tools (migrate, create-admin) get no
# more reach than its server. Secrets travel through the environment only, never a command line.
# Without systemd as PID 1 (container rehearsals) it falls back to setpriv as the same user.
# Must be called as root. Returns CMD's exit code.
run_as_app() {
  local env=$1 dir=$2
  shift 2
  ((EUID == 0)) || die "run_as_app needs root"
  local user heap
  user=$(env_user "$env")
  heap=$(env_heap "$env")
  if [[ "$(cat /proc/1/comm 2>/dev/null)" == systemd && -z "${YARD_NO_SYSTEMD_RUN:-}" ]]; then
    local props=() p
    while IFS= read -r p; do props+=(-p "$p"); done < <(app_sandbox_props "$env")
    systemd-run --quiet --wait --pipe --collect --service-type=exec \
      --unit="yard-$env-tool-$$-$RANDOM" --description="Yard $env tool: $*" \
      "${props[@]}" -p "EnvironmentFile=$YARD_ETC/$env.env" -p "WorkingDirectory=$dir" \
      -p "Environment=PATH=/usr/local/bin:/usr/bin:/bin HOME=$YARD_VAR/$env LANG=C.UTF-8 NODE_OPTIONS=--max-old-space-size=$heap MALLOC_ARENA_MAX=2" \
      -- "$@"
    return $?
  fi
  # shellcheck disable=SC2016 # the inner shell expands these
  env -i PATH=/usr/local/bin:/usr/bin:/bin HOME="$YARD_VAR/$env" LANG=C.UTF-8 \
    NODE_OPTIONS="--max-old-space-size=$heap" MALLOC_ARENA_MAX=2 \
    YARD_LIB="$YARD_OPT/lib/common.sh" YARD_ENV_FILE="$YARD_ETC/$env.env" YARD_RUN_DIR="$dir" YARD_RUN_USER="$user" \
    /bin/bash -c '
      set -euo pipefail
      # shellcheck source=/dev/null
      . "$YARD_LIB"
      load_env_file "$YARD_ENV_FILE"
      cd "$YARD_RUN_DIR"
      u=$YARD_RUN_USER
      unset YARD_LIB YARD_ENV_FILE YARD_RUN_DIR YARD_RUN_USER
      umask 077
      exec setpriv --reuid="$u" --regid="$u" --init-groups -- "$@"
    ' yard-run "$@"
}

# psql_root ARGS...: psql as the postgres superuser over the local socket.
psql_root() { runuser -u postgres -- psql -v ON_ERROR_STOP=1 -X -q "$@"; }

# pg_create_db ENV: creates yard_ENV owned by role yard_ENV with the collation PGlite uses
# (C / C.UTF-8) and UTC, and lets only that role connect. No-op when it exists.
pg_create_db() {
  local db
  db=$(env_db "$1")
  if [[ -z "$(psql_root -Atc "select 1 from pg_database where datname = '$db'")" ]]; then
    psql_root -c "create database $db owner $db template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C.UTF-8'"
  fi
  psql_root -c "alter database $db set timezone to 'UTC'" \
    -c "revoke connect, temporary on database $db from public" \
    -c "grant connect, temporary on database $db to $db"
}

# svc_restart SERVICE: clears a start-limit-hit state first (several deploys in a few minutes count
# as "restarting too quickly" for StartLimitBurst), then restarts. Stopped staging starts too.
svc_restart() {
  as_root "$SYSTEMCTL" reset-failed "$1" >/dev/null 2>&1 || true
  as_root "$SYSTEMCTL" restart "$1"
}

# release_lock ENV [WAIT_SECONDS]: one release/rollback per environment at a time (fd 9).
# Opened read-only so root and deploy can both lock the same deploy-owned file.
release_lock() {
  local f="$YARD_SRV/$1/.release.lock"
  if [[ ! -e "$f" ]]; then
    : >"$f"
    ((EUID == 0)) && chown "$(env_deploy_user "$1"):$(env_deploy_user "$1")" "$f" 2>/dev/null
  fi
  exec 9<"$f"
  flock -n 9 && return 0
  log "another release of $1 is running; waiting"
  flock -w "${2:-600}" 9 || die "timed out waiting for the release lock of $1"
}
