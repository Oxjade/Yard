#!/usr/bin/env bash
# Yard server setup. Run ONCE as root on a fresh Ubuntu 26.04 server (safe to run again: every step
# checks before it acts, and secrets that exist are never changed).
#
# From your computer, inside the repository:
#   tar -C deploy -cz . | ssh root@162.246.17.39 'mkdir -p /opt/yard/kit && tar -xz -C /opt/yard/kit && bash /opt/yard/kit/setup.sh'
#
# Options:
#   --domain NAME            the site's domain (default: <ip-with-dashes>.sslip.io from the server's IP)
#   --rotate-deploy-keys     make new CI deploy keys (the old ones stop working) and print them
#   --help
#
# What it does (details in README.md):
#   swap (2 GB when RAM < 8 GB) · Postgres (distro, tuned to ~256 MB) · Node 22+ · Caddy · ufw · fail2ban
#   unattended-upgrades · users 'yard' (runs the app) and 'deploy' (CI, fixed commands only)
#   databases yard_production / yard_staging · /etc/yard/{production,staging}.env with generated secrets
#   systemd units yard-production (:3000, enabled) and yard-staging (:3001, starts on staging deploys)
#   nightly backup timer · Caddy HTTPS for DOMAIN and staging.DOMAIN · SSH password login off once a
#   key login is confirmed.
set -euo pipefail

KIT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
. "$KIT/lib/common.sh"

REHEARSAL=${YARD_SETUP_REHEARSAL:-0}
DOMAIN_ARG=""
ROTATE_KEYS=0
while (($#)); do
  case "$1" in
    --domain)
      DOMAIN_ARG=${2:-}
      shift 2
      ;;
    --domain=*)
      DOMAIN_ARG=${1#*=}
      shift
      ;;
    --rotate-deploy-keys)
      ROTATE_KEYS=1
      shift
      ;;
    -h | --help)
      sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "unknown option $1 (see --help)" 64 ;;
  esac
done

export DEBIAN_FRONTEND=noninteractive
APT=(apt-get -y -q -o DPkg::Lock::Timeout=300 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
NOTES=()       # printed at the end
SECRETS_OUT="" # printed at the end, once
step() { printf '\n\033[1m==> %s\033[0m\n' "$*" >&2; }
note() { NOTES+=("$*"); }
rand_hex() { openssl rand -hex "$1"; }

# ---------------------------------------------------------------------------------------------------
step "Preflight"
((EUID == 0)) || die "run as root (sudo bash setup.sh)"
exec 8>/run/yard-setup.lock
flock -n 8 || die "setup.sh is already running"
. /etc/os-release
log "system: $PRETTY_NAME, $(nproc) CPU, $(awk '/MemTotal/ { printf "%.1f GB RAM", $2/1048576 }' /proc/meminfo), $(df -h / | awk 'NR==2 { print $4 }') free on /"
if [[ "${ID:-}" != ubuntu ]]; then die "this kit targets Ubuntu (found ${ID:-unknown})"; fi
if [[ "${VERSION_ID:-}" != 26.04 ]]; then
  warn "written for Ubuntu 26.04; this is ${VERSION_ID:-?}. Continuing (24.04 or newer works)."
  [[ "${VERSION_ID%%.*}" -ge 24 ]] || die "Ubuntu 24.04 or newer is required"
fi
if [[ "$REHEARSAL" != 1 && "$(cat /proc/1/comm 2>/dev/null)" != systemd ]]; then die "systemd is not PID 1"; fi
free_kb=$(df -Pk / | awk 'NR==2 { print $4 }')
((free_kb > 5 * 1048576)) || die "less than 5 GB free on /"
[[ "$REHEARSAL" == 1 ]] && warn "REHEARSAL mode (containers): swap, kernel settings and firewall activation are only printed"

# ---------------------------------------------------------------------------------------------------
step "Swap and kernel settings"
mem_kb=$(awk '/MemTotal/ { print $2 }' /proc/meminfo)
if ((mem_kb < 8 * 1048576)); then
  if [[ -n "$(swapon --noheadings --show=NAME 2>/dev/null)" ]]; then
    log "swap already active: $(swapon --noheadings --show=NAME,SIZE | tr '\n' ' ')"
  elif [[ "$REHEARSAL" == 1 ]]; then
    log "(rehearsal) would create and enable a 2 GB /swapfile"
  else
    if [[ ! -f /swapfile ]]; then
      fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
      chmod 600 /swapfile
      mkswap /swapfile >/dev/null
    fi
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
    log "2 GB swap file enabled"
  fi
fi
cat >/etc/sysctl.d/90-yard.conf <<'EOF'
# Yard: prefer RAM, use swap only to absorb peaks.
vm.swappiness = 10
vm.vfs_cache_pressure = 50
EOF
if [[ "$REHEARSAL" == 1 ]]; then
  log "(rehearsal) would apply /etc/sysctl.d/90-yard.conf"
else
  sysctl -q -p /etc/sysctl.d/90-yard.conf 2>/dev/null || warn "could not apply sysctl settings now (they apply at boot)"
fi
install -d -m 755 /etc/systemd/journald.conf.d
cat >/etc/systemd/journald.conf.d/90-yard.conf <<'EOF'
[Journal]
SystemMaxUse=300M
EOF

# ---------------------------------------------------------------------------------------------------
step "Packages"
"${APT[@]}" update
"${APT[@]}" install --no-install-recommends ca-certificates curl jq openssl sudo tar gzip xz-utils util-linux \
  postgresql postgresql-contrib ufw fail2ban python3-systemd unattended-upgrades rclone

# Node 22 LTS or newer: the distro's nodejs (26.04 ships 22.x); otherwise the official nodejs.org build.
node_major() { "$1" -e 'process.stdout.write(process.versions.node.split(".")[0])' 2>/dev/null || echo 0; }
"${APT[@]}" install --no-install-recommends nodejs || warn "distro nodejs not installable"
if [[ -x /usr/bin/node && "$(node_major /usr/bin/node)" -ge 22 ]]; then
  ln -sfn /usr/bin/node /usr/local/bin/node
  log "node $(/usr/bin/node -v) from the Ubuntu archive"
elif [[ -x /usr/local/bin/node && "$(node_major /usr/local/bin/node)" -ge 22 ]]; then
  log "node $(/usr/local/bin/node -v) already installed"
else
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64) arch=arm64 ;;
    *) die "no Node.js build for $(uname -m)" ;;
  esac
  base="https://nodejs.org/dist/latest-v22.x"
  sums=$(curl -fsSL "$base/SHASUMS256.txt") || die "cannot reach nodejs.org to install Node 22"
  file=$(awk -v a="linux-$arch.tar.xz" '$2 ~ a"$" { print $2; exit }' <<<"$sums")
  want=$(awk -v f="$file" '$2 == f { print $1 }' <<<"$sums")
  [[ -n "$file" && -n "$want" ]] || die "could not find the Node 22 build on nodejs.org"
  tmpd=$(mktemp -d)
  curl -fsSL "$base/$file" -o "$tmpd/$file" || die "Node.js download failed"
  echo "$want  $tmpd/$file" | sha256sum -c --quiet - || die "Node.js download checksum mismatch"
  dest="/opt/${file%.tar.xz}"
  rm -rf "$dest"
  tar -xJf "$tmpd/$file" -C /opt
  rm -rf "$tmpd"
  ln -sfn "$dest" /opt/node
  ln -sfn /opt/node/bin/node /usr/local/bin/node
  log "node $(/usr/local/bin/node -v) from nodejs.org (the Ubuntu package is older than 22)"
fi

# Caddy: the official repository (current 2.x); the Ubuntu package (older) if it can't be reached.
if ! command -v caddy >/dev/null; then
  key=/usr/share/keyrings/caddy-stable-archive-keyring.asc
  list=/etc/apt/sources.list.d/caddy-stable.list
  if curl -fsSL --max-time 30 https://dl.cloudsmith.io/public/caddy/stable/gpg.key -o "$key.tmp"; then
    mv "$key.tmp" "$key"
    chmod 644 "$key"
    echo "deb [signed-by=$key] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" >"$list"
    if "${APT[@]}" update && "${APT[@]}" install caddy; then
      log "caddy from the official Caddy repository"
    else
      rm -f "$list" "$key"
      "${APT[@]}" update
    fi
  else
    rm -f "$key.tmp"
  fi
  if ! command -v caddy >/dev/null; then
    warn "Caddy's repository is unreachable; installing the Ubuntu caddy package instead"
    "${APT[@]}" install caddy
    note "Caddy came from the Ubuntu archive ($(caddy version | awk '{ print $1 }')); re-run setup.sh later to switch to the official repository."
  fi
fi
log "caddy $(caddy version | awk '{ print $1 }'), $(psql --version | awk '{ print $1" "$3 }')"

# ---------------------------------------------------------------------------------------------------
step "Users"
if ! id yard >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$YARD_VAR" --no-create-home --shell /usr/sbin/nologin yard
  log "created user yard (runs the app, no login)"
fi
if ! id deploy >/dev/null 2>&1; then
  useradd --system --user-group --create-home --home-dir /home/deploy --shell /bin/bash deploy
  log "created user deploy (CI uploads and releases, fixed commands only)"
fi
usermod -L deploy 2>/dev/null || true

# ---------------------------------------------------------------------------------------------------
step "Directories and tools"
install -d -m 755 -o root -g root "$YARD_OPT" "$YARD_OPT/bin" "$YARD_OPT/lib" "$YARD_SRV"
# 0751: the deploy user may read domain.env (0644) but cannot list or read the 0640 env files.
install -d -m 751 -o root -g yard "$YARD_ETC"
install -d -m 750 -o yard -g yard "$YARD_VAR"
install -d -m 700 -o root -g root "$YARD_BACKUPS"
for env in "${YARD_ENVS[@]}"; do
  install -d -m 750 -o deploy -g yard "$YARD_SRV/$env"
  install -d -m 2750 -o deploy -g yard "$YARD_SRV/$env/releases"
  install -d -m 700 -o deploy -g deploy "$YARD_SRV/$env/incoming"
  install -d -m 700 -o yard -g yard "$YARD_VAR/$env" "$YARD_VAR/$env/next-cache"
done
# The kit itself (README + sources) for reference, then the tools.
if [[ "$KIT" != "$YARD_OPT/kit" ]]; then
  rm -rf "$YARD_OPT/kit.new"
  cp -a "$KIT" "$YARD_OPT/kit.new"
  rm -rf "$YARD_OPT/kit"
  mv "$YARD_OPT/kit.new" "$YARD_OPT/kit"
fi
chown -R root:root "$YARD_OPT/kit"
chmod -R go-w "$YARD_OPT/kit"
install -m 644 -o root -g root "$KIT/lib/common.sh" "$YARD_OPT/lib/common.sh"
install -m 755 -o root -g root "$KIT/release.sh" "$YARD_OPT/bin/release"
install -m 755 -o root -g root "$KIT/rollback.sh" "$YARD_OPT/bin/rollback"
install -m 755 -o root -g root "$KIT/backup.sh" "$YARD_OPT/bin/backup"
install -m 755 -o root -g root "$KIT/restore.sh" "$YARD_OPT/bin/restore"
for t in deploy-gate yard-migrate yard-predump create-admin set-domain yard-status; do
  install -m 755 -o root -g root "$KIT/$t" "$YARD_OPT/bin/$t"
done
ln -sfn "$YARD_OPT/bin/yard-status" /usr/local/sbin/yard-status

# ---------------------------------------------------------------------------------------------------
step "Domain"
domain=$(env_get "$YARD_ETC/domain.env" YARD_DOMAIN)
if [[ -n "$DOMAIN_ARG" && -n "$domain" && "$DOMAIN_ARG" != "$domain" ]]; then
  die "the domain is already $domain; change it with /opt/yard/bin/set-domain $DOMAIN_ARG"
fi
public_ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }' || true)
if [[ -z "$domain" ]]; then
  domain=${DOMAIN_ARG:-${YARD_DOMAIN:-}}
  if [[ -z "$domain" ]]; then
    [[ "$public_ip" =~ ^[0-9.]+$ ]] || die "could not find this server's IP; pass --domain"
    if [[ "$public_ip" =~ ^(10\.|127\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.) ]]; then
      die "this server's address $public_ip is private (behind NAT); pass --domain <name> that points at its public IP"
    fi
    domain="${public_ip//./-}.sslip.io"
  fi
  domain=${domain,,}
  [[ "$domain" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] || die "'$domain' is not a domain name"
  umask 022
  cat >"$YARD_ETC/domain.env" <<EOF
# The ONE place the site's domain lives. Production is https://\$YARD_DOMAIN, staging is
# https://staging.\$YARD_DOMAIN. Change it with: sudo /opt/yard/bin/set-domain example.com
YARD_DOMAIN=$domain
EOF
  chmod 644 "$YARD_ETC/domain.env"
  log "domain: $domain"
else
  log "domain: $domain (unchanged)"
fi

# ---------------------------------------------------------------------------------------------------
step "PostgreSQL"
pgver=$(find /etc/postgresql -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort -V | tail -n 1)
[[ -n "$pgver" ]] || die "no PostgreSQL cluster found under /etc/postgresql"
confd="/etc/postgresql/$pgver/main/conf.d"
install -d -m 755 -o postgres -g postgres "$confd"
if ! cmp -s "$KIT/postgres/90-yard.conf" "$confd/90-yard.conf"; then
  install -m 644 -o postgres -g postgres "$KIT/postgres/90-yard.conf" "$confd/90-yard.conf"
  pg_restart=1
else
  pg_restart=0
fi
"$SYSTEMCTL" enable postgresql >/dev/null 2>&1 || true
if ((pg_restart)) || ! runuser -u postgres -- pg_isready -q; then
  "$SYSTEMCTL" restart postgresql
fi
for _ in $(seq 1 30); do runuser -u postgres -- pg_isready -q && break; sleep 1; done
runuser -u postgres -- pg_isready -q || die "PostgreSQL did not start"
log "PostgreSQL $pgver running ($(psql_root -Atc 'show shared_buffers') shared buffers, max_connections $(psql_root -Atc 'show max_connections'))"

declare -A DB_PASSWORD=()
for env in "${YARD_ENVS[@]}"; do
  db=$(env_db "$env")
  existing_url=$(env_get "$YARD_ETC/$env.env" DATABASE_URL)
  role_exists=$(psql_root -Atc "select 1 from pg_roles where rolname = '$db'")
  if [[ -n "$role_exists" && -n "$existing_url" ]]; then
    log "role $db exists (password kept)"
  else
    pw=$(rand_hex 24)
    DB_PASSWORD[$env]=$pw
    if [[ -z "$role_exists" ]]; then
      psql_root <<<"create role $db login password '$pw';"
      log "created role $db"
    else
      psql_root <<<"alter role $db password '$pw';"
      warn "role $db existed without an env file; gave it a new password"
    fi
  fi
  pg_create_db "$env"
done
log "databases: $(psql_root -Atc "select string_agg(datname || ' (' || datcollate || ')', ', ') from pg_database where datname like 'yard_%'")"

# ---------------------------------------------------------------------------------------------------
step "Environment files (/etc/yard)"
new_keys=()
write_env_file() {
  local env=$1 file="$YARD_ETC/$1.env" port pool url session enc
  port=$(env_port "$env")
  pool=5
  url="https://$domain"
  if [[ "$env" == staging ]]; then
    pool=3
    url="https://staging.$domain"
  fi
  if [[ ! -f "$file" ]]; then
    session=$(openssl rand 32 | base64 | tr '+/' '-_' | tr -d '=\n')
    enc=$(openssl rand 32 | base64 | tr -d '\n')
    (
      umask 027
      cat >"$file" <<EOF
# Yard $env settings. Owner root, group yard, mode 0640. Read by systemd (EnvironmentFile=) and by
# the tools in /opt/yard/bin. One KEY=VALUE per line; no quotes; no comments after a value.
# After a change: sudo systemctl restart yard-$env
NODE_ENV=production
YARD_ENV_NAME=$env
PORT=$port
HOSTNAME=127.0.0.1
NEXT_TELEMETRY_DISABLED=1
DATABASE_URL=postgres://yard_$env:${DB_PASSWORD[$env]}@127.0.0.1:5432/yard_$env
YARD_PG_POOL_MAX=$pool
YARD_PUBLIC_URL=$url
YARD_DATA_DIR=$YARD_VAR/$env
YARD_TRUSTED_PROXY_HOPS=1
# SAVE THE ENCRYPTION KEY somewhere safe (password manager). Without it, encrypted data
# (social account tokens, payout details) cannot be read again, even from a backup.
YARD_SESSION_SECRET=$session
YARD_ENCRYPTION_KEY=$enc
# Payments: off until a provider is connected (checkout shows "Payments open soon").
YARD_PAYMENTS=off
#PAYSTACK_SECRET_KEY=
#PAYSTACK_PUBLIC_KEY=
#PAYSTACK_WEBHOOK_SECRET=
# Email: unset = emails are queued, not sent.
#EMAIL_PROVIDER=
#EMAIL_FROM=
#EMAIL_API_KEY=
#YARD_SUPPORT_EMAIL=
#YARD_BUSINESS_ADDRESS=
EOF
    )
    chown root:yard "$file"
    chmod 640 "$file"
    new_keys+=("$env|$enc")
    log "wrote $file (new secrets)"
  else
    chown root:yard "$file"
    chmod 640 "$file"
    if [[ -n "${DB_PASSWORD[$env]:-}" ]]; then
      env_set "$file" DATABASE_URL "postgres://yard_$env:${DB_PASSWORD[$env]}@127.0.0.1:5432/yard_$env"
      warn "$file: DATABASE_URL updated with the new role password"
    fi
    local k v
    for kv in "NODE_ENV=production" "YARD_ENV_NAME=$env" "PORT=$port" "HOSTNAME=127.0.0.1" "YARD_PG_POOL_MAX=$pool" \
      "YARD_PUBLIC_URL=$url" "YARD_DATA_DIR=$YARD_VAR/$env" "YARD_TRUSTED_PROXY_HOPS=1" "YARD_PAYMENTS=off" "NEXT_TELEMETRY_DISABLED=1"; do
      k=${kv%%=*}
      v=${kv#*=}
      if ! grep -qE "^[[:space:]]*$k=" "$file"; then
        env_set "$file" "$k" "$v"
        log "$file: added missing $k"
      fi
    done
    for k in YARD_SESSION_SECRET YARD_ENCRYPTION_KEY; do
      [[ -n "$(env_get "$file" "$k")" ]] || warn "$file has no $k. NOT generating one: a new key would make existing encrypted data unreadable. Put the saved key back."
    done
    log "$file exists (secrets kept)"
  fi
}
for env in "${YARD_ENVS[@]}"; do write_env_file "$env"; done
if [[ ! -f "$YARD_ETC/backup.env" ]]; then
  (
    umask 077
    cat >"$YARD_ETC/backup.env" <<'EOF'
# Nightly backup settings (root only).
# Days of local backups to keep under /var/backups/yard.
YARD_BACKUP_KEEP_DAYS=14
# Off-server copy: empty = off. To turn it on, run `rclone config` as root to create a remote
# (e.g. Backblaze B2 or Cloudflare R2), then set e.g. RCLONE_REMOTE=b2:my-yard-backups
RCLONE_REMOTE=
RCLONE_KEEP_DAYS=30
EOF
  )
fi
if ((${#new_keys[@]})); then
  SECRETS_OUT+=$'\n'
  SECRETS_OUT+="  ############################################################################"$'\n'
  SECRETS_OUT+="  ##                                                                        ##"$'\n'
  SECRETS_OUT+="  ##   SAVE THE ENCRYPTION KEYS BELOW NOW (password manager, not email).    ##"$'\n'
  SECRETS_OUT+="  ##   Without them, encrypted data (social tokens, payout details) is      ##"$'\n'
  SECRETS_OUT+="  ##   lost for good - backups do not contain them. Shown this one time.    ##"$'\n'
  SECRETS_OUT+="  ##                                                                        ##"$'\n'
  SECRETS_OUT+="  ############################################################################"$'\n'
  for item in "${new_keys[@]}"; do
    SECRETS_OUT+="     ${item%%|*} YARD_ENCRYPTION_KEY = ${item#*|}"$'\n'
  done
  SECRETS_OUT+="     (also stored in /etc/yard/<env>.env on this server, readable by root only)"$'\n'
fi

# ---------------------------------------------------------------------------------------------------
step "sudo rules for the deploy user"
sudoers_tmp=$(mktemp)
{
  echo "# /etc/sudoers.d/yard-deploy — written by Yard setup.sh. The CI deploy user may run exactly these"
  echo "# commands as root, nothing else. yard-migrate/yard-predump read the secrets so deploy never has to."
  echo "Defaults:deploy env_reset, !requiretty, secure_path=\"/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\""
  for env in "${YARD_ENVS[@]}"; do
    echo "deploy ALL=(root) NOPASSWD: $SYSTEMCTL restart yard-$env, $SYSTEMCTL start yard-$env, $YARD_OPT/bin/yard-migrate $env next, $YARD_OPT/bin/yard-migrate $env current, $YARD_OPT/bin/yard-predump $env, $(command -v journalctl || echo /usr/bin/journalctl) -u yard-$env -n 50 --no-pager"
  done
} >"$sudoers_tmp"
visudo -cqf "$sudoers_tmp" || die "generated sudoers rule failed visudo"
install -m 440 -o root -g root "$sudoers_tmp" /etc/sudoers.d/yard-deploy
rm -f "$sudoers_tmp"
log "/etc/sudoers.d/yard-deploy installed (visudo ok)"

# ---------------------------------------------------------------------------------------------------
step "systemd units"
install -m 644 "$KIT/systemd/yard-production.service" /etc/systemd/system/yard-production.service
install -m 644 "$KIT/systemd/yard-staging.service" /etc/systemd/system/yard-staging.service
install -m 644 "$KIT/systemd/yard-backup.service" /etc/systemd/system/yard-backup.service
install -m 644 "$KIT/systemd/yard-backup.timer" /etc/systemd/system/yard-backup.timer
install -d -m 755 /etc/systemd/system/caddy.service.d
install -m 644 "$KIT/systemd/caddy-yard.conf" /etc/systemd/system/caddy.service.d/yard.conf
"$SYSTEMCTL" daemon-reload
"$SYSTEMCTL" enable yard-production.service >/dev/null 2>&1
"$SYSTEMCTL" disable yard-staging.service >/dev/null 2>&1 || true
"$SYSTEMCTL" enable --now yard-backup.timer >/dev/null 2>&1
log "yard-production enabled at boot; yard-staging starts only on staging deploys; backup timer on"

# ---------------------------------------------------------------------------------------------------
step "Caddy (HTTPS)"
if [[ -f /etc/caddy/Caddyfile && ! -f /etc/caddy/Caddyfile.dist ]] && ! grep -q 'YARD_DOMAIN' /etc/caddy/Caddyfile; then
  cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.dist
fi
install -d -m 755 /etc/caddy
install -m 644 "$KIT/caddy/Caddyfile" /etc/caddy/Caddyfile.new
if (load_env_file "$YARD_ETC/domain.env" && caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile >/tmp/caddy-validate.log 2>&1); then
  mv -f /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
  log "Caddyfile valid"
else
  cat /tmp/caddy-validate.log >&2
  die "Caddy rejected the configuration (kept the old one)"
fi
install -d -m 755 -o caddy -g caddy /var/log/caddy 2>/dev/null || install -d -m 755 /var/log/caddy
"$SYSTEMCTL" enable caddy >/dev/null 2>&1 || true
# restart, not reload: the domain variable is read when Caddy starts
"$SYSTEMCTL" restart caddy
log "Caddy serves https://$domain and https://staging.$domain (certificates are requested on first visit)"

# ---------------------------------------------------------------------------------------------------
step "Firewall (ufw)"
ssh_ports=$(sshd -T 2>/dev/null | awk '$1 == "port" { print $2 }' | sort -u || true)
[[ -n "$ssh_ports" ]] || ssh_ports=22
for p in $ssh_ports; do ufw allow "$p/tcp" comment 'ssh' >/dev/null; done
ufw allow 80/tcp comment 'http (certificates, redirect)' >/dev/null
ufw allow 443/tcp comment 'https' >/dev/null
ufw allow 443/udp comment 'https (HTTP/3)' >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
if [[ "$REHEARSAL" == 1 ]]; then
  log "(rehearsal) rules written; would run: ufw --force enable"
else
  ufw --force enable >/dev/null
  log "ufw on: $(ufw status | awk 'NR > 4 && $1 != "" { print $1 }' | sort -u | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------------------------------
step "fail2ban and automatic security updates"
install -m 644 "$KIT/fail2ban/yard.local" /etc/fail2ban/jail.d/yard.local
if fail2ban-client -t >/dev/null 2>&1; then
  "$SYSTEMCTL" enable fail2ban >/dev/null 2>&1 || true
  "$SYSTEMCTL" restart fail2ban || warn "fail2ban did not restart"
  log "fail2ban: sshd jail (1 h ban after 5 failures)"
else
  warn "fail2ban configuration test failed: $(fail2ban-client -t 2>&1 | tail -n 3)"
fi
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat >/etc/apt/apt.conf.d/52yard-unattended-upgrades <<'EOF'
// Yard: security updates install automatically; the server never reboots on its own
// (yard-status / the login message say when a reboot is pending; see README "Reboots").
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
"$SYSTEMCTL" enable unattended-upgrades >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------------------------------
step "SSH hardening"
login_user=${SUDO_USER:-root}
login_home=$(getent passwd "$login_user" | cut -d: -f6)
client_ip=${SSH_CLIENT:-}
client_ip=${client_ip%% *}
nkeys=0
[[ -f "$login_home/.ssh/authorized_keys" ]] && nkeys=$(ssh-keygen -lf "$login_home/.ssh/authorized_keys" 2>/dev/null | grep -c . || true)
key_login=0
if [[ -n "$client_ip" ]]; then
  if journalctl --since "-12 hours" --no-pager -o cat 2>/dev/null | grep -qF "Accepted publickey for $login_user from $client_ip port"; then
    key_login=1
  elif grep -qsF "Accepted publickey for $login_user from $client_ip port" /var/log/auth.log; then
    key_login=1
  fi
fi
hard=/etc/ssh/sshd_config.d/01-yard.conf
if ! command -v sshd >/dev/null; then
  log "no OpenSSH server installed; skipped"
elif [[ -f "$hard" ]]; then
  log "password login already off ($hard)"
elif ((nkeys >= 1 && key_login == 1)); then
  cat >"$hard" <<'EOF'
# Yard setup.sh: keys only. Sorted before 50-cloud-init.conf so these values win.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
  if sshd -t; then
    "$SYSTEMCTL" try-reload-or-restart ssh 2>/dev/null || "$SYSTEMCTL" try-reload-or-restart sshd 2>/dev/null || true
    log "SSH: password login OFF (you logged in with a key from $client_ip; $nkeys key(s) in $login_home/.ssh/authorized_keys)"
  else
    rm -f "$hard"
    warn "sshd rejected the hardening file; left SSH unchanged"
  fi
else
  note "SSH password login is still ON. This run could not confirm that you logged in with an SSH key (keys for $login_user: $nkeys; key login from ${client_ip:-?}: $([[ $key_login == 1 ]] && echo yes || echo no)). From your computer: ssh-copy-id $login_user@${public_ip:-<server-ip>}, log in again with the key, and run setup.sh again; it then turns passwords off."
fi

# ---------------------------------------------------------------------------------------------------
step "CI deploy keys"
# Last step before the summary, so a failure earlier never uses up keys that were not shown.
akdir=/home/deploy/.ssh
ak=$akdir/authorized_keys
install -d -m 700 -o deploy -g deploy "$akdir"
[[ -f "$ak" ]] || install -m 600 -o deploy -g deploy /dev/null "$ak"
DEPLOY_KEYS_OUT=""
for env in "${YARD_ENVS[@]}"; do
  marker="command=\"$YARD_OPT/bin/deploy-gate $env\""
  if ((ROTATE_KEYS == 0)) && grep -qF "$marker" "$ak"; then
    log "deploy key for $env exists (use --rotate-deploy-keys to replace it)"
    continue
  fi
  kd=$(mktemp -d)
  ssh-keygen -q -t ed25519 -N '' -C "yard-ci-$env" -f "$kd/key"
  grep -vF "$marker" "$ak" >"$ak.tmp" || true
  printf 'restrict,%s %s\n' "$marker" "$(cat "$kd/key.pub")" >>"$ak.tmp"
  chown deploy:deploy "$ak.tmp"
  chmod 600 "$ak.tmp"
  mv -f "$ak.tmp" "$ak"
  DEPLOY_KEYS_OUT+=$'\n'"  ---- VPS_SSH_KEY for the GitHub environment \"$env\" (copy every line, BEGIN to END) ----"$'\n'
  DEPLOY_KEYS_OUT+="$(cat "$kd/key")"$'\n'
  shred -u "$kd/key" 2>/dev/null || rm -f "$kd/key"
  rm -rf "$kd"
  log "new deploy key for $env installed (restricted to deploy-gate $env)"
done
known_hosts=""
host_for_ci=${public_ip:-<server-ip>}
for f in /etc/ssh/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_ecdsa_key.pub /etc/ssh/ssh_host_rsa_key.pub; do
  [[ -f "$f" ]] && known_hosts+="$host_for_ci $(awk '{ print $1" "$2 }' "$f")"$'\n'
done

# ---------------------------------------------------------------------------------------------------
step "Done"
cat >&2 <<EOF

  Yard server is set up.
    production  https://$domain            (port 3000, service yard-production)
    staging     https://staging.$domain    (port 3001, service yard-staging, stopped until deployed)
    settings    /etc/yard/production.env, /etc/yard/staging.env, /etc/yard/domain.env
    status      sudo yard-status
EOF
if [[ -n "$SECRETS_OUT" ]]; then printf '%s\n' "$SECRETS_OUT" >&2; fi
cat >&2 <<EOF

  GITHUB SECRETS (README section 4)
    Repository secret VPS_HOST:          ${public_ip:-<server-ip>}
    Repository secret VPS_KNOWN_HOSTS (all lines):
${known_hosts}
EOF
if [[ -n "$DEPLOY_KEYS_OUT" ]]; then
  printf '  Environment secrets VPS_SSH_KEY. Shown once; setup.sh --rotate-deploy-keys makes new ones.\n%s\n' "$DEPLOY_KEYS_OUT" >&2
else
  printf '  VPS_SSH_KEY: the deploy keys were shown when they were made. Lost them? Run setup.sh --rotate-deploy-keys.\n' >&2
fi
for n in "${NOTES[@]}"; do printf '\n  NOTE: %s\n' "$n" >&2; done
printf '\n  Next: README.md section 4 (GitHub), then 5 (first deploy) and 6 (first admin).\n\n' >&2
