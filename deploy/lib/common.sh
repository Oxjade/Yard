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

log() { printf '[yard %s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
warn() { printf '[yard %s] WARNING: %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() { printf '[yard %s] ERROR: %s\n' "$(date -u +%H:%M:%S)" "$1" >&2; exit "${2:-1}"; }

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

# run_as_yard ENV DIR CMD...: runs CMD in DIR as the 'yard' user with exactly the variables of
# /etc/yard/ENV.env (plus PATH, HOME, LANG and the unit's memory settings). Secrets are passed
# through the environment only, never on a command line. Must be called as root.
run_as_yard() {
  local env=$1 dir=$2
  shift 2
  ((EUID == 0)) || die "run_as_yard needs root"
  local heap=384
  [[ "$env" == staging ]] && heap=256
  # shellcheck disable=SC2016 # the inner shell expands these
  env -i PATH=/usr/local/bin:/usr/bin:/bin HOME="$YARD_VAR" LANG=C.UTF-8 \
    NODE_OPTIONS="--max-old-space-size=$heap" MALLOC_ARENA_MAX=2 \
    YARD_LIB="$YARD_OPT/lib/common.sh" YARD_ENV_FILE="$YARD_ETC/$env.env" YARD_RUN_DIR="$dir" \
    /bin/bash -c '
      set -euo pipefail
      # shellcheck source=/dev/null
      . "$YARD_LIB"
      load_env_file "$YARD_ENV_FILE"
      cd "$YARD_RUN_DIR"
      unset YARD_LIB YARD_ENV_FILE YARD_RUN_DIR
      umask 077
      exec setpriv --reuid=yard --regid=yard --init-groups -- "$@"
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
