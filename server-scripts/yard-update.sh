#!/usr/bin/env bash
# shellcheck disable=SC2016 # node -e snippets are JavaScript, single-quoted on purpose
# yard-update: deploy the latest code without taking the site down.
#
# The live site keeps running from one copy of the app while the next release is prepared in a
# second copy beside it (/home/yard/app-a and /home/yard/app-b; /home/yard/app is a symlink to the
# live one). Only when the new release is complete does the symlink switch and Yard restart, which
# takes a few seconds; Caddy holds requests during that gap (lb_try_duration) instead of showing
# an error. If the new release doesn't come up healthy, it switches straight back.
#
# Where the build comes from (docs/DEPLOY.md):
#   ci     (YARD_BUILD_SOURCE=ci in /etc/yard.env; the default when GITHUB_TOKEN_DEPLOY is set there)
#          GitHub Actions builds every push to v3 (.github/workflows/build-release.yml). This
#          script waits for the build of the exact commit it fetched, downloads it, checks its
#          sha256 and unpacks it: the server never builds.
#   local  (YARD_BUILD_SOURCE=local, no token, or --local) the server builds itself, as before.
#
#   sudo yard-update            deploy the branch the live copy is on
#   sudo yard-update --local    same, but build on this server even when CI builds are set up
#   sudo yard-update --rollback switch back to the previous release
#   sudo yard-update --status   is a deploy running? which step, how long, last log lines
#   sudo yard-update --follow   watch the running deploy live (Ctrl+C only stops watching)
#
# Every run is logged to /var/log/yard-update.log, and the current step is kept in
# /run/yard-update.status, so a second SSH window can always see what is happening.
#
# Install / refresh (docs/DEPLOY.md):
#   runuser -u yard -- git -C /home/yard/app fetch origin v3 && runuser -u yard -- git -C /home/yard/app show origin/v3:server-scripts/yard-update.sh > /usr/local/bin/yard-update && chmod 755 /usr/local/bin/yard-update
set -euo pipefail

HOME_DIR=${YARD_HOME:-/home/yard}
LINK=$HOME_DIR/app
A=$HOME_DIR/app-a
B=$HOME_DIR/app-b
SERVICE=${YARD_SERVICE:-yard}
HEALTH=${YARD_HEALTH:-http://127.0.0.1:3000/api/health}
RUN_AS=${YARD_USER:-yard}
ENV_FILE=${YARD_ENV_FILE:-/etc/yard.env}
# How the service is restarted (tests point this at a stand-in).
RESTART_CMD=${YARD_RESTART_CMD:-systemctl restart $SERVICE}
BACKUP_DIR=${YARD_BACKUP_DIR:-/var/backups/yard}

# CI builds.
GITHUB_API=${YARD_GITHUB_API:-https://api.github.com}
WORKFLOW_FILE=build-release.yml
CI_TIMEOUT=${YARD_CI_TIMEOUT:-1200}  # seconds to wait for the GitHub build (20 min)
CI_POLL=${YARD_CI_POLL:-15}          # seconds between checks
DOWNLOADS=${YARD_DOWNLOADS:-$HOME_DIR/.yard-downloads}

LOCK=${YARD_LOCK:-/run/yard-update.lock}
STATUS=${YARD_STATUS:-/run/yard-update.status}
LOG=${YARD_LOG:-/var/log/yard-update.log}
TOTAL_STEPS=6

fmt_secs() { local s=$1; printf '%dm%02ds' $((s / 60)) $((s % 60)); }

show_status() {
  if [ -f "$STATUS" ]; then
    # shellcheck disable=SC1090
    . "$STATUS"
    local now; now=$(date +%s)
    if [ "${STATE:-}" = "running" ] && kill -0 "${PID:-0}" 2>/dev/null; then
      echo "yard-update is RUNNING (pid $PID)"
      echo "  step:    $STEP"
      echo "  total:   $(fmt_secs $((now - STARTED))) since start"
      echo "  in step: $(fmt_secs $((now - STEP_STARTED)))"
    elif [ "${STATE:-}" = "running" ]; then
      echo "yard-update stopped unexpectedly during: $STEP (its process is gone)."
    else
      echo "No deploy running. Last run: ${STATE:-unknown} at $(date -d @"${ENDED:-$STARTED}" '+%F %T' 2>/dev/null) — ${STEP:-}"
    fi
  else
    echo "No deploy has been recorded yet."
  fi
  if [ -f "$LOG" ]; then echo; echo "Last log lines ($LOG):"; tail -n 15 "$LOG"; fi
}

ACTION=deploy
FORCE_LOCAL=0
for arg in "$@"; do
  case "$arg" in
    --status) show_status; exit 0 ;;
    --follow) show_status; echo; echo "Following the log (Ctrl+C stops watching, not the deploy)..."; exec tail -n 0 -F "$LOG" ;;
    --rollback) ACTION=rollback ;;
    --local) FORCE_LOCAL=1 ;;
    -h|--help) sed -n '3,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (see yard-update --help)"; exit 2 ;;
  esac
done

# One value from the env file (KEY=value, optional surrounding quotes, as systemd reads it).
# Never printed by this script for the token.
env_value() {
  local v
  v=$(grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-) || true
  v=${v%$'\r'}
  case "$v" in \"*\") v=${v#\"}; v=${v%\"} ;; \'*\') v=${v#\'}; v=${v%\'} ;; esac
  printf '%s' "$v"
}

# One deploy at a time: a second run while one is building would fight over the same folders.
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "Another yard-update is already running — not starting a second one."
  echo
  show_status
  echo
  echo "Watch it live:  sudo yard-update --follow"
  exit 1
fi

# From here on, everything is shown on screen AND appended to the log.
mkdir -p "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1
STARTED=$(date +%s)
STEP_NO=0
STEP="starting"
STEP_STARTED=$STARTED

write_status() {
  printf 'STATE=%q\nPID=%q\nSTEP=%q\nSTARTED=%q\nSTEP_STARTED=%q\nENDED=%q\n' \
    "$1" "$$" "$STEP" "$STARTED" "$STEP_STARTED" "${2:-}" > "$STATUS.tmp" && mv -f "$STATUS.tmp" "$STATUS"
}

say() {
  STEP_NO=$((STEP_NO + 1))
  STEP="[$STEP_NO/$TOTAL_STEPS] $*"
  STEP_STARTED=$(date +%s)
  write_status running
  printf '\n== %s   (%s · %s elapsed)\n' "$STEP" "$(date '+%H:%M:%S')" "$(fmt_secs $((STEP_STARTED - STARTED)))"
}

# A heartbeat every 30 s so a quiet step never looks frozen. (The GitHub wait prints its own.)
# (sleep's output goes nowhere, so it never holds the log pipe open after the deploy ends.)
( while sleep 30 >/dev/null 2>&1; do
    [ -f "$STATUS" ] || continue
    # shellcheck disable=SC1090
    . "$STATUS"
    [ "${STATE:-}" = "running" ] || break
    case "$STEP" in *"GitHub build"*) continue ;; esac
    printf '   … still working on %s (%s in this step)\n' "$STEP" "$(fmt_secs $(( $(date +%s) - STEP_STARTED )))"
  done ) 9>&- &
HEARTBEAT=$!

WORK=""
on_exit() {
  local code=$?
  kill "$HEARTBEAT" 2>/dev/null || true
  [ -z "$WORK" ] || rm -rf "$WORK"
  local now; now=$(date +%s)
  if [ "$code" -eq 0 ]; then
    write_status "done" "$now"
    printf '\n✓ yard-update finished in %s\n' "$(fmt_secs $((now - STARTED)))"
  else
    write_status failed "$now"
    printf '\n✗ yard-update FAILED during %s after %s (exit %s). Live site unchanged unless the switch step had run.\n' "$STEP" "$(fmt_secs $((now - STARTED)))" "$code"
  fi
}
trap on_exit EXIT
write_status running
printf '== yard-update started %s (log: %s)\n' "$(date '+%F %T')" "$LOG"

# runuser instead of sudo: it can't hang on a stuck login/PAM session (which froze a deploy once).
as_yard() { runuser -u "$RUN_AS" -- bash -c "$1"; }

restart_service() { bash -c "$RESTART_CMD" 9>&-; }

healthy() {
  for _ in $(seq 1 60); do
    if curl -fs -o /dev/null --max-time 5 "$HEALTH"; then return 0; fi
    sleep 1
  done
  return 1
}

switch_to() {
  # Atomic: a new symlink renamed over the old one.
  ln -sfn "$1" "$LINK.next"
  mv -T "$LINK.next" "$LINK"
  chown -h "$RUN_AS:$RUN_AS" "$LINK"
}

# First run: turn the existing app folder into release A, with app as a symlink to it. The running
# process keeps working (its files don't move on disk, only the name does).
if [ -d "$LINK" ] && [ ! -L "$LINK" ]; then
  echo "== One-time setup: $LINK becomes $A (symlinked)"
  mv "$LINK" "$A"
  switch_to "$A"
fi

LIVE=$(readlink -f "$LINK")
if [ "$LIVE" = "$A" ]; then NEXT=$B; else NEXT=$A; fi

if [ "$ACTION" = "rollback" ]; then
  [ -d "$NEXT/.next" ] || { echo "No previous release in $NEXT to roll back to."; exit 1; }
  TOTAL_STEPS=1; say "Rolling back: $LIVE -> $NEXT"
  switch_to "$NEXT"
  restart_service
  if healthy; then echo "Rolled back; Yard is healthy."; else echo "Yard isn't healthy: journalctl -u $SERVICE -n 80"; exit 1; fi
  exit 0
fi

# Build source: --local wins, then YARD_BUILD_SOURCE (environment, then env file), then ci when a
# deploy token is configured, else local.
GITHUB_TOKEN_DEPLOY=${GITHUB_TOKEN_DEPLOY:-$(env_value GITHUB_TOKEN_DEPLOY)}
# Tokens are only letters, digits and _. Drop anything else a paste can bring along (terminal
# bracketed-paste markers, carriage returns, spaces), which curl would reject as a bad header.
GITHUB_TOKEN_DEPLOY=$(printf '%s' "$GITHUB_TOKEN_DEPLOY" | sed 's/\x1b\[20[01]~//g' | tr -cd 'A-Za-z0-9_')
case "$GITHUB_TOKEN_DEPLOY" in ""|github_pat_*|ghp_*) ;; *) echo "Warning: GITHUB_TOKEN_DEPLOY in $ENV_FILE doesn't look like a GitHub token (expected github_pat_…)." ;; esac
BUILD_SOURCE=${YARD_BUILD_SOURCE:-$(env_value YARD_BUILD_SOURCE)}
if [ "$FORCE_LOCAL" = 1 ]; then BUILD_SOURCE=local; fi
if [ -z "$BUILD_SOURCE" ]; then
  if [ -n "$GITHUB_TOKEN_DEPLOY" ]; then BUILD_SOURCE=ci; else BUILD_SOURCE=local; fi
fi
case "$BUILD_SOURCE" in
  ci) [ -n "$GITHUB_TOKEN_DEPLOY" ] || { echo "YARD_BUILD_SOURCE=ci needs GITHUB_TOKEN_DEPLOY in $ENV_FILE (docs/DEPLOY.md), or run: sudo yard-update --local"; exit 1; } ;;
  local) ;;
  *) echo "YARD_BUILD_SOURCE must be ci or local (it is '$BUILD_SOURCE')."; exit 1 ;;
esac
echo "Build source: $BUILD_SOURCE$([ "$FORCE_LOCAL" = 1 ] && echo ' (--local)')"

BRANCH=$(as_yard "cd '$LIVE' && git rev-parse --abbrev-ref HEAD")
say "Getting the latest code ($BRANCH) into $NEXT (live site: $LIVE)"

# The second copy starts as a clone of the live one (same remote and deploy key).
if [ ! -d "$NEXT/.git" ]; then
  as_yard "git clone --quiet '$LIVE' '$NEXT' && cd '$NEXT' && git remote set-url origin \"\$(git -C '$LIVE' remote get-url origin)\""
fi
as_yard "cd '$NEXT' && git fetch --quiet origin '$BRANCH' && git checkout --quiet -B '$BRANCH' 'origin/$BRANCH' && git reset --quiet --hard 'origin/$BRANCH'"
SHA=$(as_yard "cd '$NEXT' && git rev-parse HEAD")
echo "Commit: $SHA ($(as_yard "cd '$NEXT' && git log -1 --format=%s" | cut -c1-100))"

# Keep the optimised-image cache, so photos aren't re-encoded after every deploy.
keep_image_cache() {
  if [ -d "$LIVE/.next/cache/images" ]; then
    as_yard "mkdir -p '$NEXT/.next/cache' && rm -rf '$NEXT/.next/cache/images' && cp -a '$LIVE/.next/cache/images' '$NEXT/.next/cache/images'"
  fi
}

# Tabs opened before the deploy still ask for the previous build's script files: keep them.
keep_old_static() {
  if [ -d "$LIVE/.next/static" ]; then
    as_yard "cp -a --update=none '$LIVE/.next/static/.' '$NEXT/.next/static/' 2>/dev/null || cp -an '$LIVE/.next/static/.' '$NEXT/.next/static/'"
  fi
}

# Dependencies: reinstalled only when the lockfile changed since this copy last installed them.
install_deps() { # $1: extra npm ci flags
  as_yard "cd '$NEXT' && if [ ! -d node_modules ] || ! cmp -s package-lock.json node_modules/.yard-lock; then npm ci --no-audit --no-fund $1 && mkdir -p node_modules && cp package-lock.json node_modules/.yard-lock; else echo 'Dependencies unchanged.'; fi"
}

if [ "$BUILD_SOURCE" = "local" ]; then
  say "Dependencies (only reinstalled when they changed)"
  install_deps ""
  keep_image_cache

  say "Building — usually 3 to 10 minutes; the live site keeps serving"
  DEPLOY_ID=$(as_yard "cd '$NEXT' && git rev-parse --short=12 HEAD")
  # The search-engine verification meta tags are part of prerendered pages, so the build reads them too (docs/SEO-AI.md).
  # (The same values the CI build reads from the repository variables.)
  as_yard "cd '$NEXT' && YARD_DEPLOYMENT_ID='$DEPLOY_ID' YARD_PUBLIC_URL=$(printf %q "$(env_value YARD_PUBLIC_URL)") GOOGLE_SITE_VERIFICATION=$(printf %q "$(env_value GOOGLE_SITE_VERIFICATION)") BING_SITE_VERIFICATION=$(printf %q "$(env_value BING_SITE_VERIFICATION)") YARD_SKIP_TYPECHECK=1 NODE_OPTIONS=--max-old-space-size=1536 npm run build" \
    || { echo "Build failed. Nothing changed: the live site is still $LIVE."; exit 1; }
  # Which release is running, for /api/health (a CI archive brings its own).
  as_yard "cd '$NEXT' && printf '{\"sha\":\"%s\",\"builtAt\":\"%s\",\"source\":\"local\"}\n' '$SHA' '$(date -u +%FT%TZ)' > release.json"
  keep_old_static
else
  # ---- CI build: GitHub Actions built this commit; download it instead of building here. ----
  SHA12=${SHA:0:12}
  DEPLOY_ID=$SHA12
  TAG="build-$SHA12"
  ASSET="yard-build-$SHA12.tar.gz"
  # owner/repo from the origin URL (git@github.com:Oxjade/Yard.git or https://github.com/Oxjade/Yard.git).
  REPO=${YARD_GITHUB_REPO:-$(as_yard "git -C '$NEXT' remote get-url origin" | sed -E 's#^(git@|ssh://git@|https://)github\.com[:/]##; s#\.git$##; s#/+$##')}
  case "$REPO" in */*) ;; *) echo "Can't tell the GitHub repository from the origin URL; set YARD_GITHUB_REPO=owner/name in the environment."; exit 1 ;; esac
  ACTIONS_URL="https://github.com/$REPO/actions/workflows/$WORKFLOW_FILE"

  # GitHub API call. The token goes to curl through a config on a private file descriptor, so it
  # is never on a command line (ps) or in the log. Retries transient failures (timeouts, 429, 5xx).
  # Usage: [ACCEPT=type] gh_api OUT_FILE URL [extra curl args]; prints the HTTP status ("000" = no answer).
  gh_api() {
    local out=$1 url=$2 accept=${ACCEPT:-application/vnd.github+json}; shift 2
    curl -sS -o "$out" -w '%{http_code}' --connect-timeout 10 --max-time 30 --retry 3 --retry-delay 3 \
      -K <(printf 'header = "Authorization: Bearer %s"\n' "$GITHUB_TOKEN_DEPLOY") \
      -H "Accept: $accept" -H 'X-GitHub-Api-Version: 2022-11-28' -H 'User-Agent: yard-update' \
      "$@" "$url" 2>"$out.err" || true
  }
  # Why curl got no answer at all (DNS, TLS, timeout...), for "HTTP 000" messages.
  curl_why() { [ -s "$1.err" ] && sed -n '1,3p' "$1.err" | sed 's/^/   curl: /' || true; }

  say "Waiting for the GitHub build of $SHA12 ($REPO)"
  WORK=$(mktemp -d)
  # Fail fast when the token can't see the repository at all (GitHub answers 404 for that too).
  code=$(gh_api "$WORK/repo.json" "$GITHUB_API/repos/$REPO")
  case "$code" in
    200) ;;
    401) echo "GitHub refused the deploy token (401): GITHUB_TOKEN_DEPLOY in $ENV_FILE is wrong or expired (docs/DEPLOY.md)."; exit 1 ;;
    403|404) echo "The deploy token can't read $REPO (HTTP $code): give it Contents: Read on that repository (docs/DEPLOY.md)."; exit 1 ;;
    *) echo "GitHub didn't answer properly (HTTP $code)."; curl_why "$WORK/repo.json"; echo "Nothing changed: the live site is still $LIVE. Try again, or: sudo yard-update --local"; exit 1 ;;
  esac
  deadline=$(( $(date +%s) + CI_TIMEOUT ))
  RUN_URL=""; RUN_STATE=""; NO_ACTIONS_NOTED=0; TAR_ID=""; DISPATCHED=0
  while :; do
    code=$(gh_api "$WORK/rel.json" "$GITHUB_API/repos/$REPO/releases/tags/$TAG")
    case "$code" in
      200)
        # "<archive id> <checksum id> <bytes>" once both files are fully uploaded to a published release.
        read -r TAR_ID SUM_ID TAR_SIZE < <(node -e '
          const fs = require("node:fs"); const [file, name] = process.argv.slice(1)
          let r; try { r = JSON.parse(fs.readFileSync(file, "utf8")) } catch { process.exit(0) }
          if (r.draft) process.exit(0)
          const find = (n) => (r.assets || []).find((a) => a.name === n && (a.state ?? "uploaded") === "uploaded")
          const t = find(name), s = find(name + ".sha256")
          if (t && s) console.log(`${t.id} ${s.id} ${t.size}`)' "$WORK/rel.json" "$ASSET") || true
        [ -n "${TAR_ID:-}" ] && break ;;
      401) echo "GitHub refused the deploy token (401): GITHUB_TOKEN_DEPLOY in $ENV_FILE is wrong or expired (docs/DEPLOY.md)."; exit 1 ;;
      403) echo "GitHub refused the deploy token (403): it needs Contents: Read on $REPO, or the API rate limit was hit. See docs/DEPLOY.md."; exit 1 ;;
      404|000) ;;  # not published yet / no answer this time
      *) echo "   GitHub answered $code for the release; trying again." ;;
    esac

    # The workflow run for this commit (needs Actions: Read on the token; optional, it only lets a
    # failed build stop the wait at once instead of at the timeout).
    code=$(gh_api "$WORK/runs.json" "$GITHUB_API/repos/$REPO/actions/workflows/$WORKFLOW_FILE/runs?head_sha=$SHA&per_page=5")
    if [ "$code" = 200 ]; then
      read -r RUN_STATE RUN_URL < <(node -e '
        const fs = require("node:fs")
        let r; try { r = JSON.parse(fs.readFileSync(process.argv[1], "utf8")) } catch { process.exit(0) }
        const run = (r.workflow_runs || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
        if (run) console.log(`${run.status === "completed" ? run.conclusion || "unknown" : run.status} ${run.html_url}`)' "$WORK/runs.json") || true
      # No build of this commit on GitHub at all (it never started, e.g. pushed before Actions was
      # set up): start one ourselves. Needs Actions: Read and write on the token; asked only once.
      if [ -z "${RUN_STATE:-}" ] && [ "${DISPATCHED:-0}" = 0 ]; then
        DISPATCHED=1
        dcode=$(gh_api "$WORK/dispatch.json" "$GITHUB_API/repos/$REPO/actions/workflows/$WORKFLOW_FILE/dispatches" \
          -X POST -H 'Content-Type: application/json' --data "{\"ref\":\"$BRANCH\"}")
        case "$dcode" in
          204|200) echo "   No GitHub build of $SHA12 yet: started one on $BRANCH." ;;
          *) echo "   No GitHub build of $SHA12 yet, and the token can't start one (HTTP $dcode). Give it Actions: Read and write, or press Run workflow at $ACTIONS_URL" ;;
        esac
      fi
      case "${RUN_STATE:-}" in
        failure|cancelled|timed_out|startup_failure|action_required|stale)
          echo "The GitHub build of $SHA12 ended: $RUN_STATE. Nothing changed: the live site is still $LIVE."
          echo "Build log: $RUN_URL"
          echo "Fix it and push again, re-run it from that page, or build here instead: sudo yard-update --local"
          exit 1 ;;
      esac
    elif [ "$NO_ACTIONS_NOTED" = 0 ] && { [ "$code" = 403 ] || [ "$code" = 404 ]; }; then
      NO_ACTIONS_NOTED=1
      echo "   (The deploy token can't read Actions runs, so a failed build shows only at the timeout. Add Actions: Read to it to stop at once; docs/DEPLOY.md.)"
    fi

    now=$(date +%s)
    if [ "$now" -ge "$deadline" ]; then
      echo "No finished GitHub build of $SHA12 after $(fmt_secs "$CI_TIMEOUT"). Nothing changed: the live site is still $LIVE."
      echo "Actions: ${RUN_URL:-$ACTIONS_URL}"
      [ "$BRANCH" = v3 ] || echo "Only pushes to v3 build automatically: run the workflow by hand for $BRANCH (Run workflow on that page)."
      echo "Or build on this server: sudo yard-update --local"
      exit 1
    fi
    printf '   … waiting for GitHub build (%s) — %s\n' "$(fmt_secs $((now - STEP_STARTED)))" "${RUN_STATE:+run $RUN_STATE }${RUN_URL:-release $TAG not published yet}"
    sleep "$CI_POLL"
  done
  echo "Build ready: release $TAG ($((TAR_SIZE / 1048576)) MB)."

  say "Downloading and unpacking the build"
  mkdir -p "$DOWNLOADS"
  chmod 755 "$DOWNLOADS"
  rm -f "$DOWNLOADS"/yard-build-*
  download() { # asset id, destination
    local code
    # GitHub answers with a redirect to a signed download URL on another host; curl doesn't send
    # the token there (it only goes to the host it was given for).
    code=$(ACCEPT=application/octet-stream gh_api "$2" "$GITHUB_API/repos/$REPO/releases/assets/$1" -L --max-time 900 --retry 5 --retry-all-errors)
    [ "$code" = 200 ] || { echo "Download of $(basename "$2") failed (HTTP $code)."; curl_why "$2"; echo "Nothing changed: the live site is still $LIVE."; exit 1; }
  }
  download "$SUM_ID" "$DOWNLOADS/$ASSET.sha256"
  download "$TAR_ID" "$DOWNLOADS/$ASSET"
  chmod 644 "$DOWNLOADS/$ASSET" "$DOWNLOADS/$ASSET.sha256"
  EXPECTED=$(awk '{print $1; exit}' "$DOWNLOADS/$ASSET.sha256")
  ACTUAL=$(sha256sum "$DOWNLOADS/$ASSET" | awk '{print $1}')
  if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "Checksum mismatch for $ASSET (expected ${EXPECTED:-nothing}, got $ACTUAL). Nothing changed: the live site is still $LIVE."
    exit 1
  fi
  echo "sha256 verified: $ACTUAL"

  # Shipped node_modules are used unless this copy already has the dependencies of this lockfile.
  if [ -d "$NEXT/node_modules" ] && cmp -s "$NEXT/package-lock.json" "$NEXT/node_modules/.yard-lock"; then
    echo "Dependencies unchanged: keeping $NEXT/node_modules."
    EXCLUDE="--exclude=node_modules"
  else
    echo "Dependencies changed: using the ones built with the release."
    as_yard "rm -rf '$NEXT/node_modules'"
    EXCLUDE=""
  fi
  as_yard "cd '$NEXT' && rm -rf .next release.json && tar --anchored $EXCLUDE -xzf '$DOWNLOADS/$ASSET'"
  rm -f "$DOWNLOADS/$ASSET" "$DOWNLOADS/$ASSET.sha256"
  # An archive without node_modules (or built from another lockfile) still gets production dependencies.
  if [ ! -d "$NEXT/node_modules" ] || ! cmp -s "$NEXT/package-lock.json" "$NEXT/node_modules/.yard-lock"; then
    echo "The archive's dependencies don't match package-lock.json: installing production dependencies."
    install_deps "--omit=dev"
  fi

  # The archive must be this exact commit, and was built with this server's public settings.
  if [ ! -f "$NEXT/.next/BUILD_ID" ] || [ ! -f "$NEXT/release.json" ]; then
    echo "The archive has no finished build (.next/BUILD_ID, release.json). Nothing changed: the live site is still $LIVE."
    exit 1
  fi
  mapfile -t BUILT < <(node -e '
    const b = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))
    for (const k of ["sha", "publicUrl", "googleSiteVerification", "bingSiteVerification"]) console.log(String(b[k] ?? "").replace(/\s+/g, " "))' "$NEXT/release.json")
  BUILT_SHA=${BUILT[0]:-} BUILT_URL=${BUILT[1]:-} BUILT_GOOGLE=${BUILT[2]:-} BUILT_BING=${BUILT[3]:-}
  if [ "$BUILT_SHA" != "$SHA" ]; then
    echo "The archive was built from $BUILT_SHA, not $SHA. Nothing changed: the live site is still $LIVE."
    exit 1
  fi
  check_same() { # name, value the build used, value in the env file
    local built=$2 here=${3:-}
    if [ "${built%/}" != "${here%/}" ]; then
      echo "   ! $1 differs: the build used '${built}', $ENV_FILE has '${here}'. Prerendered pages carry the build's value:"
      echo "     set the repository variable $1 to match (docs/DEPLOY.md), then re-run the workflow."
    fi
  }
  check_same YARD_PUBLIC_URL "$BUILT_URL" "$(env_value YARD_PUBLIC_URL)"
  check_same GOOGLE_SITE_VERIFICATION "$BUILT_GOOGLE" "$(env_value GOOGLE_SITE_VERIFICATION)"
  check_same BING_SITE_VERIFICATION "$BUILT_BING" "$(env_value BING_SITE_VERIFICATION)"

  keep_image_cache
  keep_old_static
fi

say "Backup and database updates"
if command -v pg_dump >/dev/null && [ -d "$BACKUP_DIR" ]; then
  runuser -u postgres -- pg_dump -Fc yard > "$BACKUP_DIR/pre-update-$(date +%F-%H%M).dump"
fi
as_yard "set -a; . $ENV_FILE; set +a; unset GITHUB_TOKEN_DEPLOY; cd '$NEXT' && npm run db:migrate"
as_yard "set -a; . $ENV_FILE; set +a; unset GITHUB_TOKEN_DEPLOY; cd '$NEXT' && npm run geoip:update" || true
# Shop and Search list from the index: rebuild it so it matches every brand's current status.
as_yard "set -a; . $ENV_FILE; set +a; unset GITHUB_TOKEN_DEPLOY; cd '$NEXT' && npm run search:reindex" || true

say "Switching to the new release and restarting"
switch_to "$NEXT"
restart_service
if ! healthy; then
  echo "New release isn't healthy: switching back to $LIVE."
  switch_to "$LIVE"
  restart_service
  if healthy; then echo "Back on the previous release. See: journalctl -u $SERVICE -n 80"; else echo "Previous release isn't healthy either: journalctl -u $SERVICE -n 80"; fi
  exit 1
fi

say "Warming the main pages"
# Warm the main pages so the first visitors don't wait for them to render.
for p in / /brands /drops /charts /around /sell /categories; do curl -s -o /dev/null --max-time 60 "${HEALTH%/api/health}$p" || true; done
curl -fsS --max-time 10 "$HEALTH" && echo
STEP="done: live release is $NEXT ($DEPLOY_ID)"
echo "Live release is $NEXT ($DEPLOY_ID). Previous release kept in $LIVE (sudo yard-update --rollback)."
