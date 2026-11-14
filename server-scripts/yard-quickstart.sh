#!/usr/bin/env bash
# Yard quick start for a fresh Ubuntu VPS (run as root). Test setup only:
# one production-mode site on https://<ip-with-dashes>.sslip.io, built on the server,
# built-in database (moves to Postgres with the full setup later), Cockpit for logs.
set -euo pipefail

IP="162.246.17.39"
HOST="${IP//./-}.sslip.io"
BRANCH="v3"
REPO="git@github.com:Oxjade/Yard.git"
APP=/home/yard/app

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

say "1/9 System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y git curl ca-certificates xz-utils ufw gnupg debian-keyring debian-archive-keyring apt-transport-https openssl

say "2/9 Swap (2 GB) so builds don't run out of memory"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "3/9 Firewall: only SSH, HTTP and HTTPS are open"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

say "4/9 Node.js 22 (official build)"
if ! command -v node >/dev/null || ! node -v | grep -q '^v22'; then
  TAR=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '/linux-x64.tar.xz/{print $2}')
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/$TAR" -o /tmp/node.tar.xz
  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
  rm /tmp/node.tar.xz
fi
node -v

say "5/9 Caddy (automatic HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

say "6/9 App user and GitHub access"
id yard >/dev/null 2>&1 || useradd -m -s /bin/bash yard
sudo -u yard mkdir -p /home/yard/.ssh
[ -f /home/yard/.ssh/id_ed25519 ] || sudo -u yard ssh-keygen -t ed25519 -N "" -C "yard-vps-deploy" -f /home/yard/.ssh/id_ed25519
sudo -u yard bash -c 'ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null; sort -u -o ~/.ssh/known_hosts ~/.ssh/known_hosts'
if [ ! -d "$APP/.git" ]; then
  echo
  echo "Add this key on GitHub: Oxjade/Yard -> Settings -> Deploy keys -> Add deploy key"
  echo "Title: yard-vps   (leave 'Allow write access' UNticked)"
  echo "----------------------------------------------------------------"
  cat /home/yard/.ssh/id_ed25519.pub
  echo "----------------------------------------------------------------"
  read -r -p "Press Enter once the key is added on GitHub... " _
  sudo -u yard git clone -b "$BRANCH" "$REPO" "$APP"
fi

say "7/9 Settings and secrets"
mkdir -p /var/lib/yard && chown yard:yard /var/lib/yard && chmod 700 /var/lib/yard
if [ ! -f /etc/yard.env ]; then
  cat > /etc/yard.env <<EOF
NODE_ENV=production
PORT=3000
HOSTNAME=127.0.0.1
YARD_PUBLIC_URL=https://$HOST
YARD_DATA_DIR=/var/lib/yard
YARD_TRUSTED_PROXY_HOPS=1
YARD_SESSION_SECRET=$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n')
YARD_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')
# Yard apps (docs/APP.md). Push: copy the Firebase service-account key to the server, then
#   install -D -m 640 -o root -g yard fcm-service-account.json /etc/yard/fcm-service-account.json
# and uncomment. Android App Links: the app's signing-certificate SHA-256 fingerprints (AA:BB:…, comma-separated).
# FCM_SERVICE_ACCOUNT_FILE=/etc/yard/fcm-service-account.json
# ANDROID_CERT_SHA256=
EOF
  chown root:yard /etc/yard.env && chmod 640 /etc/yard.env
  echo
  echo "!!! SAVE /etc/yard.env SOMEWHERE SAFE (password manager). Losing YARD_ENCRYPTION_KEY loses stored bank details. !!!"
fi

say "8/9 Install and build (10-20 minutes on 1 CPU)"
install -m 755 "$APP/server-scripts/yard-update.sh" /usr/local/bin/yard-update
sudo -u yard bash -c 'cd ~/app && npm ci --no-audit --no-fund && NODE_OPTIONS=--max-old-space-size=1536 npm run build'

cat > /etc/systemd/system/yard.service <<'EOF'
[Unit]
Description=Yard marketplace
After=network-online.target
Wants=network-online.target

[Service]
User=yard
WorkingDirectory=/home/yard/app
EnvironmentFile=/etc/yard.env
Environment=NODE_OPTIONS=--max-old-space-size=768
ExecStart=/usr/local/bin/npm start
Restart=always
RestartSec=5
MemoryMax=1100M

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
$HOST {
	encode zstd gzip
	# Site photos and brand art change only with a deploy: browsers keep them a week.
	@longlived path /site/* /brand/* /media/*
	header @longlived >Cache-Control "public, max-age=604800, stale-while-revalidate=86400"
	request_body {
		max_size 25MB
	}
	reverse_proxy 127.0.0.1:3000 {
		flush_interval -1
		# During a deploy's restart, hold requests (up to 30 s) instead of answering 502.
		lb_try_duration 30s
		lb_try_interval 250ms
	}
}
EOF
systemctl daemon-reload
systemctl enable --now yard
systemctl reload caddy || systemctl restart caddy

say "9/9 Cockpit (web dashboard for logs, services, CPU and memory)"
apt-get install -y cockpit || echo "Cockpit not available from apt on this release; skip it and use: journalctl -u yard -f"
systemctl enable --now cockpit.socket 2>/dev/null || true
id ops >/dev/null 2>&1 || { useradd -m -s /bin/bash -G sudo ops; echo; echo "Set a password for the 'ops' user (you log in to Cockpit with it):"; passwd ops; }

echo
echo "Done. Wait ~1 minute for the HTTPS certificate, then open: https://$HOST"
echo "Logs live:      journalctl -u yard -f"
echo "Update later:   yard-update"
echo "Dashboard:      on your own computer run  ssh -L 9090:localhost:9090 root@$IP"
echo "                then open https://localhost:9090 and sign in as 'ops'"
