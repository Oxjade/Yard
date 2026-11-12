#!/usr/bin/env bash
# yard-ops.sh: server hardening and log hygiene for the Yard VPS (Ubuntu 26.04, Caddy in front).
#
#   sudo YARD_DOMAIN=example.com bash yard-ops.sh
#
# Idempotent: safe to run again; every file it writes is its own drop-in, and the Caddyfile is
# backed up, validated and restored on failure. What it does:
#   1. fail2ban for sshd (systemd journal backend; 5 failures in 10 min = 1 h ban, doubling on repeat)
#   2. unattended-upgrades (security updates daily; no automatic reboot)
#   3. journald capped at 200M
#   4. Caddy access log as JSON with built-in rotation (50 MiB x 10 files, 30 days), with cookies,
#      auth headers and query strings removed and client IPs masked (/24, /48)
#   5. Caddy request rate limit: only if this Caddy build has the rate_limit module (stock Caddy
#      does not; it needs the caddy-ratelimit plugin). Otherwise skipped, and the app's own limits
#      (src/proxy.ts + route limits) carry it.
#   6. The Yard systemd unit (YARD_SERVICE, default "yard"), if present: TimeoutStopSec above the
#      app's 25 s drain, so `systemctl restart` lets in-flight orders finish.
#
# Env: YARD_DOMAIN (site address in the Caddyfile; needed for step 4), CADDYFILE (default
# /etc/caddy/Caddyfile), YARD_SERVICE (default yard), SSH_PORT (default: from sshd, else 22),
# FAIL2BAN_IGNOREIP (extra addresses never banned, space separated, e.g. your office IP).
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }

CADDYFILE=${CADDYFILE:-/etc/caddy/Caddyfile}
YARD_SERVICE=${YARD_SERVICE:-yard}
YARD_DOMAIN=${YARD_DOMAIN:-}
FAIL2BAN_IGNOREIP=${FAIL2BAN_IGNOREIP:-}
say() { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }

export DEBIAN_FRONTEND=noninteractive
say "Installing packages (fail2ban, unattended-upgrades)"
apt-get update -qq
apt-get install -y -qq fail2ban unattended-upgrades apt-listchanges >/dev/null
note "installed"

# ---------------------------------------------------------------------------------------------
say "fail2ban: sshd jail"
if [ -z "${SSH_PORT:-}" ]; then
  SSH_PORT=$(sshd -T 2>/dev/null | awk '$1=="port"{print $2; exit}' || true)
  SSH_PORT=${SSH_PORT:-22}
fi
install -d -m 0755 /etc/fail2ban/jail.d
cat > /etc/fail2ban/jail.d/yard-sshd.local <<EOF
# Written by yard-ops.sh
[DEFAULT]
ignoreip = 127.0.0.1/8 ::1 ${FAIL2BAN_IGNOREIP}
bantime = 1h
bantime.increment = true
bantime.maxtime = 1w
findtime = 10m
maxretry = 5
banaction = nftables-multiport
banaction_allports = nftables-allports

[sshd]
enabled = true
port = ${SSH_PORT}
backend = systemd
mode = aggressive
EOF
systemctl enable --now fail2ban >/dev/null
systemctl restart fail2ban
sleep 2
if fail2ban-client status sshd >/dev/null 2>&1; then note "sshd jail active on port ${SSH_PORT}"; else echo "fail2ban: sshd jail did not start; see journalctl -u fail2ban" >&2; exit 1; fi

# ---------------------------------------------------------------------------------------------
say "unattended-upgrades: daily security updates, no automatic reboot"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
// Written by yard-ops.sh
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat > /etc/apt/apt.conf.d/52unattended-upgrades-yard <<'EOF'
// Written by yard-ops.sh. Security updates only (Ubuntu's default origins); a reboot is left to
// you (check /var/run/reboot-required), so a kernel update never restarts the shop mid-order.
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::SyslogEnable "true";
EOF
systemctl enable --now unattended-upgrades >/dev/null
unattended-upgrade --dry-run >/dev/null 2>&1 && note "dry run ok" || note "dry run reported a problem: run 'unattended-upgrade --dry-run -d'"

# ---------------------------------------------------------------------------------------------
say "journald: cap at 200M"
install -d -m 0755 /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/yard.conf <<'EOF'
# Written by yard-ops.sh
[Journal]
SystemMaxUse=200M
SystemKeepFree=1G
MaxRetentionSec=1month
EOF
systemctl restart systemd-journald
journalctl --vacuum-size=200M >/dev/null 2>&1 || true
note "$(journalctl --disk-usage 2>/dev/null || echo 'journal size unknown')"

# ---------------------------------------------------------------------------------------------
say "Caddy: access log with rotation"
if ! command -v caddy >/dev/null 2>&1 || [ ! -f "$CADDYFILE" ]; then
  note "caddy or $CADDYFILE not found: skipped"
else
  install -d -o caddy -g caddy -m 0750 /var/log/caddy 2>/dev/null || install -d -m 0750 /var/log/caddy
  SNIPPET=/etc/caddy/yard-ops.caddy
  write_snippet() { # $1 = filtered | plain
    {
      echo "# Written by yard-ops.sh. Imported at the top of the Caddyfile; sites use: import yard_access_log"
      echo "(yard_access_log) {"
      echo "	log {"
      echo "		output file /var/log/caddy/yard-access.log {"
      echo "			roll_size 50MiB"
      echo "			roll_keep 10"
      echo "			roll_keep_for 720h"
      echo "		}"
      if [ "$1" = filtered ]; then
        echo "		format filter {"
        echo "			wrap json"
        echo "			fields {"
        echo "				request>headers>Cookie delete"
        echo "				request>headers>Authorization delete"
        echo "				resp_headers>Set-Cookie delete"
        echo "				request>uri regexp \"\\?.*$\" \"?\""
        echo "				request>remote_ip ip_mask {"
        echo "					ipv4 24"
        echo "					ipv6 48"
        echo "				}"
        echo "				request>client_ip ip_mask {"
        echo "					ipv4 24"
        echo "					ipv6 48"
        echo "				}"
        echo "			}"
        echo "		}"
      else
        echo "		format json"
      fi
      echo "	}"
      echo "}"
    } > "$SNIPPET"
  }
  BACKUP="${CADDYFILE}.yard-ops.$(date +%Y%m%d%H%M%S)"
  cp -a "$CADDYFILE" "$BACKUP"
  grep -qxF "import $SNIPPET" "$CADDYFILE" || sed -i "1i import $SNIPPET" "$CADDYFILE"
  if ! grep -q "import yard_access_log" "$CADDYFILE"; then
    if [ -n "$YARD_DOMAIN" ] && grep -qE "^[[:space:]]*([^#]*[ ,])?${YARD_DOMAIN//./\\.}([ ,:][^{]*)?\{" "$CADDYFILE"; then
      awk -v d="$YARD_DOMAIN" 'BEGIN{done=0} { print } !done && $0 ~ "^[[:space:]]*([^#]*[ ,])?" d "([ ,:][^{]*)?\\{" { print "\timport yard_access_log"; done=1 }' "$CADDYFILE" > "$CADDYFILE.tmp" && cat "$CADDYFILE.tmp" > "$CADDYFILE" && rm -f "$CADDYFILE.tmp"
    else
      note "YARD_DOMAIN not set or its site block not found: add 'import yard_access_log' inside your site block yourself"
    fi
  fi
  ok=""
  for mode in filtered plain; do
    write_snippet "$mode"
    if caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then ok=$mode; break; fi
  done
  if [ -z "$ok" ]; then
    cp -a "$BACKUP" "$CADDYFILE"
    rm -f "$SNIPPET"
    echo "caddy validate failed with the logging snippet; the Caddyfile was restored from $BACKUP" >&2
    caddy validate --config "$CADDYFILE" --adapter caddyfile || true
  else
    [ "$ok" = plain ] && note "this Caddy rejected the log filter: logging plain JSON (query strings and client IPs are kept)"
    systemctl reload caddy
    note "access log: /var/log/caddy/yard-access.log ($ok JSON; rolls at 50 MiB, keeps 10 files / 30 days)"
  fi

  # -------------------------------------------------------------------------------------------
  say "Caddy: request rate limit"
  if caddy list-modules 2>/dev/null | grep -qx "http.handlers.rate_limit"; then
    note "this Caddy has http.handlers.rate_limit (a custom build): add to the site block, e.g."
    note "  rate_limit { zone yard_api { match { path /api/* } key {client_ip} events 600 window 1m } }"
    note "and 'order rate_limit before reverse_proxy' in the global options. Not applied automatically."
  else
    note "skipped: stock Caddy has no rate_limit directive (it needs the caddy-ratelimit plugin and a custom"
    note "xcaddy build). Yard limits requests itself: 300/min per IP for /api/*, 60/min for /api/auth/*"
    note "(YARD_RATE_API_PER_MIN, YARD_RATE_AUTH_PER_MIN), plus each route's own limit."
  fi
fi

# ---------------------------------------------------------------------------------------------
say "Yard service: graceful stop"
if systemctl cat "${YARD_SERVICE}.service" >/dev/null 2>&1; then
  install -d -m 0755 "/etc/systemd/system/${YARD_SERVICE}.service.d"
  cat > "/etc/systemd/system/${YARD_SERVICE}.service.d/yard-ops-stop.conf" <<'EOF'
# Written by yard-ops.sh. Yard drains on SIGTERM (finishes in-flight requests, closes the database)
# for up to YARD_SHUTDOWN_GRACE_MS (25 s): give it room before systemd escalates to SIGKILL.
[Service]
KillSignal=SIGTERM
KillMode=mixed
TimeoutStopSec=40
EOF
  systemctl daemon-reload
  note "${YARD_SERVICE}.service: TimeoutStopSec=40, KillMode=mixed (takes effect on the next restart)"
else
  note "${YARD_SERVICE}.service not found: skipped (set YARD_SERVICE to the unit's name)"
fi

say "Done"
note "fail2ban:  fail2ban-client status sshd"
note "upgrades:  cat /var/log/unattended-upgrades/unattended-upgrades.log"
note "journal:   journalctl --disk-usage"
note "access:    tail -f /var/log/caddy/yard-access.log"
note "app log:   journalctl -u ${YARD_SERVICE} -o cat | grep '\"t\":\"req\"'"
