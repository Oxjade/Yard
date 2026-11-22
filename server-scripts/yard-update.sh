#!/usr/bin/env bash
# yard-update: deploy the latest code without taking the site down.
#
# The live site keeps running from one copy of the app while the next release is built in a second
# copy beside it (/home/yard/app-a and /home/yard/app-b; /home/yard/app is a symlink to the live
# one). Only when the new build has succeeded does the symlink switch and Yard restart, which
# takes a few seconds; Caddy holds requests during that gap (lb_try_duration) instead of showing
# an error. If the new release doesn't come up healthy, it switches straight back.
#
#   sudo yard-update            deploy the branch the live copy is on
#   sudo yard-update --rollback switch back to the previous release
#   sudo yard-update --status   is a deploy running? which step, how long, last log lines
#   sudo yard-update --follow   watch the running deploy live (Ctrl+C only stops watching)
#
# Every run is logged to /var/log/yard-update.log, and the current step is kept in
# /run/yard-update.status, so a second SSH window can always see what is happening.
#
# Install / refresh:  sudo install -m 755 /home/yard/app/server-scripts/yard-update.sh /usr/local/bin/yard-update
set -euo pipefail

HOME_DIR=${YARD_HOME:-/home/yard}
LINK=$HOME_DIR/app
A=$HOME_DIR/app-a
B=$HOME_DIR/app-b
SERVICE=${YARD_SERVICE:-yard}
HEALTH=${YARD_HEALTH:-http://127.0.0.1:3000/api/health}
RUN_AS=${YARD_USER:-yard}
ENV_FILE=${YARD_ENV_FILE:-/etc/yard.env}

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

case "${1:-}" in
  --status) show_status; exit 0 ;;
  --follow) show_status; echo; echo "Following the log (Ctrl+C stops watching, not the deploy)..."; exec tail -n 0 -F "$LOG" ;;
esac

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

# A heartbeat every 30 s so a quiet step never looks frozen.
( while sleep 30; do
    [ -f "$STATUS" ] || continue
    # shellcheck disable=SC1090
    . "$STATUS"
    [ "${STATE:-}" = "running" ] || break
    printf '   … still working on %s (%s in this step)\n' "$STEP" "$(fmt_secs $(( $(date +%s) - STEP_STARTED )))"
  done ) 9>&- &
HEARTBEAT=$!

on_exit() {
  local code=$?
  kill "$HEARTBEAT" 2>/dev/null || true
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

healthy() {
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "$HEALTH"; then return 0; fi
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

if [ "${1:-}" = "--rollback" ]; then
  [ -d "$NEXT/.next" ] || { echo "No previous release in $NEXT to roll back to."; exit 1; }
  TOTAL_STEPS=1; say "Rolling back: $LIVE -> $NEXT"
  switch_to "$NEXT"
  systemctl restart "$SERVICE" 9>&-
  healthy && echo "Rolled back; Yard is healthy." || { echo "Yard isn't healthy: journalctl -u $SERVICE -n 80"; exit 1; }
  exit 0
fi

BRANCH=$(as_yard "cd '$LIVE' && git rev-parse --abbrev-ref HEAD")
say "Getting the latest code ($BRANCH) into $NEXT (live site: $LIVE)"

# The second copy starts as a clone of the live one (same remote and deploy key).
if [ ! -d "$NEXT/.git" ]; then
  as_yard "git clone --quiet '$LIVE' '$NEXT' && cd '$NEXT' && git remote set-url origin \"\$(git -C '$LIVE' remote get-url origin)\""
fi
as_yard "cd '$NEXT' && git fetch --quiet origin '$BRANCH' && git checkout --quiet -B '$BRANCH' 'origin/$BRANCH' && git reset --quiet --hard 'origin/$BRANCH'"

say "Dependencies (only reinstalled when they changed)"
# Dependencies: reinstalled only when the lockfile changed since this copy last installed them.
as_yard "cd '$NEXT' && if [ ! -d node_modules ] || ! cmp -s package-lock.json node_modules/.yard-lock; then npm ci --no-audit --no-fund && mkdir -p node_modules && cp package-lock.json node_modules/.yard-lock; else echo 'Dependencies unchanged.'; fi"

# Keep the optimised-image cache, so photos aren't re-encoded after every deploy.
if [ -d "$LIVE/.next/cache/images" ]; then
  as_yard "mkdir -p '$NEXT/.next/cache' && rm -rf '$NEXT/.next/cache/images' && cp -a '$LIVE/.next/cache/images' '$NEXT/.next/cache/images'"
fi

say "Building — usually 3 to 10 minutes; the live site keeps serving"
DEPLOY_ID=$(as_yard "cd '$NEXT' && git rev-parse --short=12 HEAD")
# The search-engine verification meta tags are part of prerendered pages, so the build reads them too (docs/SEO-AI.md).
as_yard "cd '$NEXT' && YARD_DEPLOYMENT_ID='$DEPLOY_ID' YARD_PUBLIC_URL=\$(grep -m1 ^YARD_PUBLIC_URL= $ENV_FILE | cut -d= -f2-) GOOGLE_SITE_VERIFICATION=\$(grep -m1 ^GOOGLE_SITE_VERIFICATION= $ENV_FILE | cut -d= -f2-) BING_SITE_VERIFICATION=\$(grep -m1 ^BING_SITE_VERIFICATION= $ENV_FILE | cut -d= -f2-) YARD_SKIP_TYPECHECK=1 NODE_OPTIONS=--max-old-space-size=1536 npm run build" \
  || { echo "Build failed. Nothing changed: the live site is still $LIVE."; exit 1; }

# Tabs opened before the deploy still ask for the previous build's script files: keep them.
if [ -d "$LIVE/.next/static" ]; then
  as_yard "cp -a --update=none '$LIVE/.next/static/.' '$NEXT/.next/static/' 2>/dev/null || cp -an '$LIVE/.next/static/.' '$NEXT/.next/static/'"
fi

say "Backup and database updates"
if command -v pg_dump >/dev/null && [ -d /var/backups/yard ]; then
  runuser -u postgres -- pg_dump -Fc yard > "/var/backups/yard/pre-update-$(date +%F-%H%M).dump"
fi
as_yard "set -a; . $ENV_FILE; cd '$NEXT' && npm run db:migrate"
as_yard "set -a; . $ENV_FILE; cd '$NEXT' && npm run geoip:update" || true
# Shop and Search list from the index: rebuild it so it matches every brand's current status.
as_yard "set -a; . $ENV_FILE; cd '$NEXT' && npm run search:reindex" || true

say "Switching to the new release and restarting"
switch_to "$NEXT"
systemctl restart "$SERVICE" 9>&-
if ! healthy; then
  echo "New release isn't healthy: switching back to $LIVE."
  switch_to "$LIVE"
  systemctl restart "$SERVICE" 9>&-
  healthy && echo "Back on the previous release. See: journalctl -u $SERVICE -n 80" || echo "Previous release isn't healthy either: journalctl -u $SERVICE -n 80"
  exit 1
fi

say "Warming the main pages"
# Warm the main pages so the first visitors don't wait for them to render.
for p in / /brands /drops /charts /around /sell /categories; do curl -s -o /dev/null "${HEALTH%/api/health}$p" || true; done
curl -fsS "$HEALTH" && echo
STEP="done: live release is $NEXT ($DEPLOY_ID)"
echo "Live release is $NEXT ($DEPLOY_ID). Previous release kept in $LIVE (sudo yard-update --rollback)."
