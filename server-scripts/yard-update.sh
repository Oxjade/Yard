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

# One deploy at a time: a second run while one is building would fight over the same folders.
LOCK=${YARD_LOCK:-/run/yard-update.lock}
exec 9>"$LOCK"
flock -n 9 || { echo "Another yard-update is already running."; exit 1; }

say() { printf '\n== %s\n' "$*"; }
as_yard() { sudo -u "$RUN_AS" bash -c "$1"; }

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
  say "One-time setup: $LINK becomes $A (symlinked)"
  mv "$LINK" "$A"
  switch_to "$A"
fi

LIVE=$(readlink -f "$LINK")
if [ "$LIVE" = "$A" ]; then NEXT=$B; else NEXT=$A; fi

if [ "${1:-}" = "--rollback" ]; then
  [ -d "$NEXT/.next" ] || { echo "No previous release in $NEXT to roll back to."; exit 1; }
  say "Rolling back: $LIVE -> $NEXT"
  switch_to "$NEXT"
  systemctl restart "$SERVICE" 9>&-
  healthy && echo "Rolled back; Yard is healthy." || { echo "Yard isn't healthy: journalctl -u $SERVICE -n 80"; exit 1; }
  exit 0
fi

BRANCH=$(as_yard "cd '$LIVE' && git rev-parse --abbrev-ref HEAD")
say "Live: $LIVE ($BRANCH). Building the next release in $NEXT"

# The second copy starts as a clone of the live one (same remote and deploy key).
if [ ! -d "$NEXT/.git" ]; then
  as_yard "git clone --quiet '$LIVE' '$NEXT' && cd '$NEXT' && git remote set-url origin \"\$(git -C '$LIVE' remote get-url origin)\""
fi
as_yard "cd '$NEXT' && git fetch --quiet origin '$BRANCH' && git checkout --quiet -B '$BRANCH' 'origin/$BRANCH' && git reset --quiet --hard 'origin/$BRANCH'"

# Dependencies: reinstalled only when the lockfile changed since this copy last installed them.
as_yard "cd '$NEXT' && if [ ! -d node_modules ] || ! cmp -s package-lock.json node_modules/.yard-lock; then npm ci --no-audit --no-fund && mkdir -p node_modules && cp package-lock.json node_modules/.yard-lock; else echo 'Dependencies unchanged.'; fi"

# Keep the optimised-image cache, so photos aren't re-encoded after every deploy.
if [ -d "$LIVE/.next/cache/images" ]; then
  as_yard "mkdir -p '$NEXT/.next/cache' && rm -rf '$NEXT/.next/cache/images' && cp -a '$LIVE/.next/cache/images' '$NEXT/.next/cache/images'"
fi

say "Building (the live site keeps serving)"
DEPLOY_ID=$(as_yard "cd '$NEXT' && git rev-parse --short=12 HEAD")
as_yard "cd '$NEXT' && YARD_DEPLOYMENT_ID='$DEPLOY_ID' YARD_PUBLIC_URL=\$(grep -m1 ^YARD_PUBLIC_URL= $ENV_FILE | cut -d= -f2-) YARD_SKIP_TYPECHECK=1 NODE_OPTIONS=--max-old-space-size=1536 npm run build" \
  || { echo "Build failed. Nothing changed: the live site is still $LIVE."; exit 1; }

# Tabs opened before the deploy still ask for the previous build's script files: keep them.
if [ -d "$LIVE/.next/static" ]; then
  as_yard "cp -a --update=none '$LIVE/.next/static/.' '$NEXT/.next/static/' 2>/dev/null || cp -an '$LIVE/.next/static/.' '$NEXT/.next/static/'"
fi

say "Backup and database migrations"
if command -v pg_dump >/dev/null && [ -d /var/backups/yard ]; then
  sudo -u postgres pg_dump -Fc yard > "/var/backups/yard/pre-update-$(date +%F-%H%M).dump"
fi
as_yard "set -a; . $ENV_FILE; cd '$NEXT' && npm run db:migrate"
as_yard "set -a; . $ENV_FILE; cd '$NEXT' && npm run geoip:update" || true
# Shop and Search list from the index: rebuild it so it matches every brand's current status.
as_yard "set -a; . $ENV_FILE; cd '$NEXT' && npm run search:reindex" || true

say "Switching to $NEXT and restarting"
switch_to "$NEXT"
systemctl restart "$SERVICE" 9>&-
if ! healthy; then
  echo "New release isn't healthy: switching back to $LIVE."
  switch_to "$LIVE"
  systemctl restart "$SERVICE" 9>&-
  healthy && echo "Back on the previous release. See: journalctl -u $SERVICE -n 80" || echo "Previous release isn't healthy either: journalctl -u $SERVICE -n 80"
  exit 1
fi

# Warm the main pages so the first visitors don't wait for them to render.
for p in / /brands /drops /charts /around /sell /categories; do curl -s -o /dev/null "${HEALTH%/api/health}$p" || true; done
curl -fsS "$HEALTH" && echo
say "Done: live release is $NEXT ($DEPLOY_ID). Previous release kept in $LIVE (sudo yard-update --rollback)."
