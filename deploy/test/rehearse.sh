#!/usr/bin/env bash
# rehearse.sh MODE IMAGE WORKDIR
#   End-to-end rehearsal of the deploy kit in a throwaway container (for maintainers; never on the VPS).
#   MODE noinit   container without systemd; deploy/test/fake-systemctl stands in (Ubuntu 26.04 image:
#                 the real packages, Postgres 18, Node 22, the Caddy fallback)
#   MODE systemd  container with systemd as PID 1 (needs a cgroup setup the image can boot on):
#                 real units, MemoryMax, timers, reboot behaviour, SSH hardening
#   WORKDIR       scratch folder (keys, tarballs, logs). Needs node + npm on the host.
#   Prints one PASS/FAIL line per check and exits non-zero on any FAIL.
# Test harness: commands run inside the container are single-quoted on purpose; exit codes are
# collected as text for check().
# shellcheck disable=SC2001,SC2016,SC2181
# No pipefail: checks pipe into grep -q, which may close the pipe early.
set -u
MODE=${1:?mode} IMAGE=${2:?image} W=$(realpath -m "${3:?workdir}")
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
KIT=$(cd "$HERE/.." && pwd)
NAME=yard-rehearsal-$MODE
mkdir -p "$W/dist" "$W/keys" "$W/logs"
chmod 700 "$W/keys"
pass=0 fail=0
check() { if [[ "$2" == 0 ]]; then pass=$((pass + 1)); echo "PASS  $1"; else fail=$((fail + 1)); echo "FAIL  $1 ${3:-}"; fi; }
x() { docker exec -i "$NAME" bash -c "$1"; }
ok() { "$@" >/dev/null 2>&1; echo $?; }

# --- tarballs ------------------------------------------------------------------------------------
if [[ ! -d "$W/pgmod/node_modules/pg" ]]; then
  mkdir -p "$W/pgmod" && (cd "$W/pgmod" && npm init -y >/dev/null && npm i pg@8.16.3 --no-audit --no-fund >/dev/null)
fi
A=aaaaaaa1111111111111111111111111111111aa B=bbbbbbb2222222222222222222222222222222bb
C=ccccccc3333333333333333333333333333333cc D=ddddddd4444444444444444444444444444444dd
E=eeeeeee5555555555555555555555555555555ee F=fffffff6666666666666666666666666666666ff
G=0000000777777777777777777777777777777700
rm -rf "$W/dist" && mkdir -p "$W/dist"
mk() { "$HERE/make-dummy-release.sh" "$W/dist" "$1" "$2" "$3" "$4" "$W/pgmod/node_modules" 2>/dev/null; }
mk staging $A good 3 && mk staging $B good 4 && mk staging $C badmigration 5 && mk staging $D unhealthy 4 &&
  mk production $E good 4 && mk production $F good 5 && mk staging $G good 4
check "package-release.sh built 7 tarballs (.env files stripped)" "$( [[ $(find "$W/dist" -name '*.tar.gz' | wc -l) == 7 ]] && ! tar -tzf "$W/dist/yard-$A.tar.gz" | grep -q '\.env'; echo $?)"

# --- container -----------------------------------------------------------------------------------
docker rm -f "$NAME" >/dev/null 2>&1
if [[ "$MODE" == systemd ]]; then
  docker run -d --name "$NAME" --hostname "$NAME" --privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
    --tmpfs /run --tmpfs /run/lock "$IMAGE" /sbin/init >/dev/null
  for _ in $(seq 1 60); do x 'systemctl is-system-running 2>/dev/null | grep -qE "running|degraded"' && break; sleep 1; done
else
  docker run -d --name "$NAME" --hostname "$NAME" "$IMAGE" sleep infinity >/dev/null
fi
# Sandboxes that intercept HTTPS: trust the same CA inside the container (YARD_REHEARSAL_CA=file).
if [[ -n "${YARD_REHEARSAL_CA:-}" && -f "$YARD_REHEARSAL_CA" ]]; then
  docker cp "$YARD_REHEARSAL_CA" "$NAME:/usr/local/share/ca-certificates/rehearsal-ca.crt"
fi
x 'export DEBIAN_FRONTEND=noninteractive; apt-get update -q >/dev/null && apt-get install -y -q --no-install-recommends openssh-server openssh-client iproute2 sudo curl ca-certificates >/dev/null 2>&1; update-ca-certificates >/dev/null 2>&1'
if [[ "$MODE" == noinit ]]; then
  docker cp "$HERE/fake-systemctl" "$NAME:/usr/local/bin/systemctl"
  x 'mkdir -p /run/sshd && /usr/sbin/sshd'
else
  x 'systemctl enable --now ssh >/dev/null 2>&1 || systemctl enable --now ssh.socket >/dev/null 2>&1; true'
fi
IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$NAME")
echo "container $NAME ($IMAGE, $MODE) at $IP"

# Owner's SSH key for root (systemd mode exercises the password-off path through a real key login).
[[ -f "$W/keys/owner" ]] || ssh-keygen -q -t ed25519 -N '' -f "$W/keys/owner"
x 'mkdir -p /root/.ssh && chmod 700 /root/.ssh'
docker cp "$W/keys/owner.pub" "$NAME:/root/.ssh/authorized_keys"
x 'chown root:root /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys'

# --- setup.sh, three runs ------------------------------------------------------------------------
# YARD_SETUP_REHEARSAL=1: no swapon / sysctl / ufw enable. In a privileged container those would
# change the HOST kernel, so they stay simulated in every mode.
rehearsal_env=(-e YARD_SETUP_REHEARSAL=1)
run_setup() { tar -C "$KIT" -cz . | docker exec -i "${rehearsal_env[@]}" "$NAME" bash -c "mkdir -p /opt/yard/kit && tar -xz -C /opt/yard/kit && bash /opt/yard/kit/setup.sh $*"; }
run_setup --domain yard-rehearsal.test >"$W/logs/$MODE-setup1.log" 2>&1
rc=$?
check "setup.sh run 1 exits 0" "$rc" "(see $W/logs/$MODE-setup1.log)"
if ((rc != 0)); then tail -n 20 "$W/logs/$MODE-setup1.log"; exit 1; fi
snap() { x 'sha256sum /etc/yard/*.env /etc/sudoers.d/yard-deploy /home/deploy/.ssh/authorized_keys /etc/caddy/Caddyfile; runuser -u postgres -- psql -Atc "select rolname, rolpassword from pg_authid where rolname like '"'"'yard_%'"'"' order by 1"'; }
snap >"$W/logs/$MODE-snap1.txt"
run_setup >"$W/logs/$MODE-setup2.log" 2>&1
check "setup.sh run 2 exits 0" "$?"
run_setup >"$W/logs/$MODE-setup3.log" 2>&1
check "setup.sh run 3 exits 0" "$?"
snap >"$W/logs/$MODE-snap3.txt"
check "idempotent: env files, secrets, DB passwords, sudoers, keys, Caddyfile unchanged by re-runs" "$(cmp -s "$W/logs/$MODE-snap1.txt" "$W/logs/$MODE-snap3.txt"; echo $?)"
check "re-run prints no new secrets" "$(! grep -q 'SAVE THE ENCRYPTION' "$W/logs/$MODE-setup3.log"; echo $?)"
check "first run printed the SAVE THE ENCRYPTION KEYS banner with both keys" "$( [[ $(grep -c 'YARD_ENCRYPTION_KEY = ' "$W/logs/$MODE-setup1.log") == 2 ]]; echo $?)"
for e in production staging; do
  awk -v e="$e" '$0 ~ "VPS_SSH_KEY for the GitHub environment \""e"\"" {f=1; next} f && /BEGIN OPENSSH/ {p=1} p {print} p && /END OPENSSH/ {exit}' "$W/logs/$MODE-setup1.log" >"$W/keys/$MODE-$e"
  chmod 600 "$W/keys/$MODE-$e"
done
sed -n '/VPS_KNOWN_HOSTS/,/^$/p' "$W/logs/$MODE-setup1.log" | grep -E '^[0-9]' >"$W/keys/$MODE-known_hosts"
check "deploy keys and known_hosts printed" "$( [[ -s $W/keys/$MODE-production && -s $W/keys/$MODE-staging && -s $W/keys/$MODE-known_hosts ]]; echo $?)"

v=$(x 'cat /etc/postgresql/*/main/conf.d/90-yard.conf >/dev/null; runuser -u postgres -- psql -Atc "select current_setting('"'"'server_version'"'"'), current_setting('"'"'shared_buffers'"'"'), current_setting('"'"'max_connections'"'"'), current_setting('"'"'TimeZone'"'"')"; runuser -u postgres -- psql -Atc "select datname, datcollate, datctype from pg_database where datname like '"'"'yard_%'"'"' order by 1"'; node -v)
echo "$v" | sed 's/^/      /'
check "Postgres tuned (128MB, 30 conns, UTC) and DBs use C / C.UTF-8" "$(grep -q '|128MB|30|UTC' <<<"$v" && [[ $(grep -c '|C|C.UTF-8' <<<"$v") == 2 ]]; echo $?)"
check "staging role cannot connect to the production DB" "$(x 'PGPASSWORD=$(sed -n "s|^DATABASE_URL=postgres://yard_staging:\([^@]*\)@.*|\1|p" /etc/yard/staging.env) psql -h 127.0.0.1 -U yard_staging -d yard_production -c "select 1"' >/dev/null 2>&1; [[ $? != 0 ]]; echo $?)"
perm=$(x 'stat -c "%U:%G %a %n" /etc/yard /etc/yard/*.env /etc/sudoers.d/yard-deploy /var/lib/yard/production /srv/yard/production/releases')
echo "$perm" | sed 's/^/      /'
check "env files root:yard 640, backup.env root 600, /etc/yard 751, data dir yard 700" "$(grep -q 'root:yard 640 /etc/yard/production.env' <<<"$perm" && grep -q 'root:yard 640 /etc/yard/staging.env' <<<"$perm" && grep -q 'root:root 600 /etc/yard/backup.env' <<<"$perm" && grep -q 'root:yard 751 /etc/yard$' <<<"$perm" && grep -q 'yard:yard 700 /var/lib/yard/production' <<<"$perm"; echo $?)"
check "deploy cannot read the env files" "$(x 'runuser -u deploy -- cat /etc/yard/production.env' >/dev/null 2>&1; [[ $? != 0 ]]; echo $?)"
check "sudoers validates (visudo -c)" "$(ok x 'visudo -c')"
check "deploy cannot sudo anything else" "$(x 'runuser -u deploy -- sudo -n /bin/cat /etc/yard/production.env' >/dev/null 2>&1; [[ $? != 0 ]]; echo $?)"
check "deploy cannot run yard-migrate with other arguments" "$(x 'runuser -u deploy -- sudo -n /opt/yard/bin/yard-migrate production next --check' >/dev/null 2>&1; [[ $? != 0 ]]; echo $?)"
if x 'command -v systemd-analyze' >/dev/null 2>&1; then
  check "systemd-analyze verify units" "$(ok x 'systemd-analyze verify /etc/systemd/system/yard-production.service /etc/systemd/system/yard-staging.service /etc/systemd/system/yard-backup.service /etc/systemd/system/yard-backup.timer')"
fi
check "caddy validate (real Caddyfile + domain.env)" "$(ok x 'set -a; . /etc/yard/domain.env; caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile')"
check "fail2ban config test" "$(ok x 'fail2ban-client -t')"
check "ufw rules for 22, 80, 443 written" "$(x 'grep -h -- "-A ufw-user-input" /etc/ufw/user.rules /etc/ufw/user6.rules' | grep -q 'dport 443' && x 'grep -q "dport 22 " /etc/ufw/user.rules' && x 'grep -q "dport 80 " /etc/ufw/user.rules'; echo $?)"

# --- deploy over SSH through deploy-gate ---------------------------------------------------------
gate() { ssh -i "$W/keys/$MODE-$1" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$W/keys/$MODE-known_hosts" -o LogLevel=ERROR "deploy@$IP" "$2"; }
# known_hosts lists the server's address as setup.sh saw it; in a container that is the bridge IP.
up() { gate "$1" "upload $1 $2 $(cut -d' ' -f1 "$W/dist/yard-$2.tar.gz.sha256")" <"$W/dist/yard-$2.tar.gz" >/dev/null; }
rel() { gate "$1" "release $1 $2" >"$W/logs/$MODE-release-$1-${2:0:7}.log" 2>&1; echo $?; }
health() { gate "$1" "health $1" 2>/dev/null; }
ver() { health "$1" | jq -r .version 2>/dev/null; }
check "gate: info shows the domain" "$(gate staging info | grep -q 'YARD_DOMAIN=yard-rehearsal.test'; echo $?)"
for c in "release production $A" "bash" "" "cat /etc/yard/staging.env" "release staging $A; id" "info x"; do
  gate staging "$c" </dev/null >/dev/null 2>&1
  check "gate refuses '$c' (126)" "$( [[ $? == 126 ]]; echo $?)"
done
check "gate: staging key cannot act on production" "$(gate staging "health production" >/dev/null 2>&1; [[ $? == 126 ]]; echo $?)"
check "gate: production key cannot act on staging" "$(gate production "health staging" >/dev/null 2>&1; [[ $? == 126 ]]; echo $?)"
check "gate: no pty / shell for the key" "$(ssh -tt -i "$W/keys/$MODE-staging" -o IdentitiesOnly=yes -o BatchMode=yes -o UserKnownHostsFile="$W/keys/$MODE-known_hosts" "deploy@$IP" </dev/null 2>&1 | grep -q 'refused\|PTY allocation request failed'; echo $?)"
check "gate: wrong checksum rejected and nothing kept" "$(gate staging "upload staging $B $(printf 'f%.0s' {1..64})" <"$W/dist/yard-$B.tar.gz" >/dev/null 2>&1; [[ $? != 0 ]] && [[ -z $(x 'ls /srv/yard/staging/incoming') ]]; echo $?)"

up staging $A
check "staging: first release A -> exit 0" "$(rel staging $A)"
check "staging: health ok on A" "$( [[ $(ver staging) == "$A" ]]; echo $?)"
up staging $B
check "staging: release B (+1 migration) -> exit 0" "$(rel staging $B)"
up staging $C
check "staging: release C with a failing migration -> exit 1" "$( [[ $(rel staging $C) == 1 ]]; echo $?)"
check "staging: still serving B after the failed migration" "$( [[ $(ver staging) == "$B" ]]; echo $?)"
up staging $D
check "staging: release D that never gets healthy -> exit 2 (auto rollback)" "$( [[ $(rel staging $D) == 2 ]]; echo $?)"
check "staging: serving B again after the auto rollback" "$( [[ $(ver staging) == "$B" ]]; echo $?)"
check "staging: 'previous' still points at A after the auto rollback" "$( [[ $(x 'basename $(readlink /srv/yard/staging/previous)') == "$A" ]]; echo $?)"
gate staging "rollback staging" >"$W/logs/$MODE-rollback.log" 2>&1
check "staging: rollback (gate) to A -> exit 0, healthy on A with B's newer schema" "$( [[ $? == 0 && $(ver staging) == "$A" ]]; echo $?)"
up staging $B
check "staging: release B again (re-unpack of a kept release) -> exit 0" "$(rel staging $B)"
up staging $G
check "staging: release G -> exit 0" "$(rel staging $G)"
check "staging: old static chunks carried into the new release" "$(x "test -f /srv/yard/staging/current/.next/static/chunks/main-$B.js"; echo $?)"
check "staging: .next/cache links to the data dir and is writable by the app" "$(x 'test -L /srv/yard/staging/current/.next/cache && test -d /var/lib/yard/staging/next-cache/images'; echo $?)"
check "staging: release files are read-only for yard" "$(x 'runuser -u yard -- touch /srv/yard/staging/current/x' >/dev/null 2>&1; [[ $? != 0 ]]; echo $?)"
yuid=$(x 'id -u yard')
check "staging: app runs as yard with the 256 MB heap" "$(x 'curl -s 127.0.0.1:3001/api/whoami' | jq -e --arg u "$yuid" '(.uid|tostring) == $u and (.heap | test("256"))' >/dev/null; echo $?)"

up production $E
check "production: release E -> exit 0" "$(rel production $E)"
up production $B
check "production: refuses a tarball built for staging" "$( [[ $(rel production $B) == 1 ]]; echo $?)"
check "production: heap 384 MB, runs as yard" "$(x 'curl -s 127.0.0.1:3000/api/whoami' | jq -e '.heap | test("384")' >/dev/null; echo $?)"
out=$(x '/opt/yard/bin/create-admin production --email owner@example.com --name "Owner Name" --print-link' 2>&1)
check "create-admin wrapper runs the tool as yard with production settings" "$(grep -q 'owner@example.com.*on production as uid' <<<"$out"; echo $?)"
x 'echo hello > /var/lib/yard/production/production/uploads/photo.jpg; chown yard:yard /var/lib/yard/production/production/uploads/photo.jpg'
up production $F
check "production: release F (+1 migration) -> exit 0" "$(rel production $F)"
check "production: pre-migration dumps taken (kept <= 5)" "$(n=$(x 'ls /var/backups/yard/pre-migrate/production/*.dump | wc -l'); [[ $n -ge 1 && $n -le 5 ]]; echo $?)"

# --- backup + restore ----------------------------------------------------------------------------
x '/opt/yard/bin/backup' >"$W/logs/$MODE-backup.log" 2>&1
check "backup.sh exits 0" "$?"
day=$(x 'date -u +%F')
check "backup holds both dumps + uploads + SHA256SUMS that verify" "$(x "cd /var/backups/yard/$day && ls yard_production.dump yard_staging.dump uploads-production.tar.gz && sha256sum -c SHA256SUMS" >/dev/null 2>&1; echo $?)"
x "mkdir -p /var/backups/yard/2000-01-01 && touch /var/backups/yard/2000-01-01/x && /opt/yard/bin/backup" >/dev/null 2>&1
check "backup retention removes folders older than 14 days" "$(x 'test ! -e /var/backups/yard/2000-01-01'; echo $?)"
x "/opt/yard/bin/restore staging /var/backups/yard/$day/yard_production.dump /var/backups/yard/$day/uploads-production.tar.gz --yes" >"$W/logs/$MODE-restore-staging.log" 2>&1
check "restore: production dump + uploads into staging -> exit 0 and healthy" "$?"
check "restore: staging now has production's 5 migrations" "$(x 'runuser -u postgres -- psql -Atd yard_staging -c "select count(*) from yard_dummy.migrations"' | grep -qx 5; echo $?)"
check "restore: tables owned by yard_staging" "$(x 'runuser -u postgres -- psql -Atd yard_staging -c "select tableowner from pg_tables where schemaname = '"'"'yard_dummy'"'"' group by 1"' | grep -qx yard_staging; echo $?)"
check "restore: uploads copied, old folder kept" "$(x 'test -f /var/lib/yard/staging/production/uploads/photo.jpg && ls -d /var/lib/yard/staging/production/uploads.before-restore-*' >/dev/null 2>&1; echo $?)"
check "restore: refuses without --yes when not on a terminal" "$(x "/opt/yard/bin/restore production /var/backups/yard/$day/yard_production.dump" </dev/null >/dev/null 2>&1; [[ $? != 0 ]]; echo $?)"
x "/opt/yard/bin/restore production /var/backups/yard/$day/yard_production.dump --yes" >"$W/logs/$MODE-restore-production.log" 2>&1
check "restore: production from its nightly dump -> exit 0 and healthy on F" "$( [[ $? == 0 && $(ver production) == "$F" ]]; echo $?)"

# --- Caddy in front ------------------------------------------------------------------------------
# ACME can't reach a container: the same Caddyfile with Caddy's local CA instead of Let's Encrypt.
x "sed 's/^{\$/{\n\tlocal_certs/' /etc/caddy/Caddyfile > /etc/caddy/Caddyfile.rehearsal"
if [[ "$MODE" == systemd ]]; then
  x 'mkdir -p /etc/systemd/system/caddy.service.d && printf "[Service]\nExecStart=\nExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile.rehearsal --adapter caddyfile\n" > /etc/systemd/system/caddy.service.d/zz-rehearsal.conf && systemctl daemon-reload'
fi
x 'systemctl restart caddy' >/dev/null 2>&1
sleep 3
cu() { x "curl -sk --resolve yard-rehearsal.test:443:127.0.0.1 --resolve staging.yard-rehearsal.test:443:127.0.0.1 $1"; }
check "caddy: https production health through the proxy" "$(cu 'https://yard-rehearsal.test/api/health' | jq -e .status >/dev/null; echo $?)"
hdr=$(cu '-D - -o /dev/null -H "Accept-Encoding: gzip, zstd" https://yard-rehearsal.test/')
check "caddy: HSTS set, Server header removed, HTML compressed" "$(grep -qi '^strict-transport-security: max-age=31536000' <<<"$hdr" && ! grep -qi '^server:' <<<"$hdr" && grep -qiE '^content-encoding: (gzip|zstd)' <<<"$hdr"; echo $?)"
check "caddy: http redirects to https" "$(x 'curl -s -o /dev/null -w "%{http_code}" --resolve yard-rehearsal.test:80:127.0.0.1 http://yard-rehearsal.test/' | grep -qE '30[18]'; echo $?)"
sse=$(cu '-N -H "Accept-Encoding: gzip, zstd" -D /dev/stderr https://yard-rehearsal.test/api/stream 2>&1' | while IFS= read -r l; do printf '%s %s\n' "$(date +%s.%N | cut -c1-14)" "$l"; done)
first=$(grep 'data:' <<<"$sse" | head -n 1 | cut -d' ' -f1) last=$(grep 'data:' <<<"$sse" | tail -n 1 | cut -d' ' -f1)
check "caddy: SSE not compressed and streamed event by event (5 events over ~2.8 s)" "$( [[ $(grep -c 'data:' <<<"$sse") == 5 ]] && ! grep -qi 'content-encoding' <<<"$sse" && awk -v a="$first" -v b="$last" 'BEGIN { exit !(b - a > 2) }'; echo $?)"
x 'head -c 52428800 /dev/zero > /tmp/50m; head -c 64000000 /dev/zero > /tmp/61m'
check "caddy: 50 MB upload accepted" "$(cu '-o /dev/null -w "%{http_code}" --data-binary @/tmp/50m https://yard-rehearsal.test/api/upload' | grep -qx 200; echo $?)"
check "caddy: 61 MB upload refused (413)" "$(cu '-o /dev/null -w "%{http_code}" --data-binary @/tmp/61m https://yard-rehearsal.test/api/upload' | grep -qx 413; echo $?)"
check "caddy: forged X-Forwarded-For replaced by the real client address" "$(cu '-H "X-Forwarded-For: 6.6.6.6" https://yard-rehearsal.test/api/whoami' | jq -e '.xff == "127.0.0.1" and .proto == "https"' >/dev/null; echo $?)"
check "caddy: staging host serves staging, with X-Robots-Tag noindex" "$(cu '-D - https://staging.yard-rehearsal.test/api/health' | grep -qi 'x-robots-tag: noindex'; echo $?)"
x 'systemctl stop yard-staging'
check "caddy: stopped staging answers 503 'Staging is stopped'" "$(cu '-w "%{http_code}" https://staging.yard-rehearsal.test/' | grep -q 'Staging is stopped.*503'; echo $?)"
x 'systemctl start yard-staging'

# --- helpers -------------------------------------------------------------------------------------
x 'yard-status' >"$W/logs/$MODE-status.log" 2>&1
check "yard-status runs" "$(grep -q 'production' "$W/logs/$MODE-status.log"; echo $?)"
x '/opt/yard/bin/set-domain shop.example.org' >"$W/logs/$MODE-set-domain.log" 2>&1
check "set-domain: domain.env + both YARD_PUBLIC_URLs updated, Caddy valid" "$(x 'grep -q "^YARD_DOMAIN=shop.example.org$" /etc/yard/domain.env && grep -q "^YARD_PUBLIC_URL=https://shop.example.org$" /etc/yard/production.env && grep -q "^YARD_PUBLIC_URL=https://staging.shop.example.org$" /etc/yard/staging.env && stat -c %a /etc/yard/production.env | grep -qx 640'; echo $?)"
check "set-domain: rejects junk" "$(x '/opt/yard/bin/set-domain "https://x.y/z"' >/dev/null 2>&1; [[ $? == 64 ]]; echo $?)"
old_key="$W/keys/$MODE-staging"
cp "$old_key" "$old_key.old"
run_setup --rotate-deploy-keys >"$W/logs/$MODE-setup-rotate.log" 2>&1
check "rotate-deploy-keys: the old staging key stops working" "$(ssh -i "$old_key.old" -o IdentitiesOnly=yes -o BatchMode=yes -o UserKnownHostsFile="$W/keys/$MODE-known_hosts" "deploy@$IP" info >/dev/null 2>&1; [[ $? == 255 ]]; echo $?)"
check "pruning keeps at most 5 releases per environment" "$( [[ $(x 'ls /srv/yard/staging/releases | wc -l') -le 5 ]]; echo $?)"

# --- systemd-only checks -------------------------------------------------------------------------
if [[ "$MODE" == systemd ]]; then
  check "units: MemoryMax 550M / 400M applied" "$(x 'systemctl show -p MemoryMax --value yard-production yard-staging' | tr '\n' ' ' | grep -q '^576716800 419430400'; echo $?)"
  check "units: production enabled, staging disabled, backup timer active" "$(x 'systemctl is-enabled yard-production && ! systemctl is-enabled yard-staging && systemctl is-active yard-backup.timer' >/dev/null 2>&1; echo $?)"
  x 'systemctl list-timers yard-backup.timer --no-pager' | sed 's/^/      /'
  x 'curl -s 127.0.0.1:3001/api/hog >/dev/null'
  sleep 8
  oom=$(x 'journalctl -u yard-staging --no-pager -n 40' | grep -iE 'oom|memory' | tail -n 3)
  echo "$oom" | sed 's/^/      /'
  check "MemoryMax enforced: staging killed by the OOM killer at 400M and restarted" "$(grep -qiE 'oom-kill|out of memory|OOM killer' <<<"$oom" && sleep 8 && x 'systemctl is-active yard-staging' | grep -qx active; echo $?)"
  check "production untouched by the staging OOM" "$( [[ $(ver production) == "$F" ]]; echo $?)"
  docker restart "$NAME" >/dev/null
  for _ in $(seq 1 60); do x 'systemctl is-system-running 2>/dev/null | grep -qE "running|degraded"' && break; sleep 1; done
  sleep 5
  check "after reboot: production up, staging stays stopped" "$(x 'systemctl is-active yard-production postgresql caddy' | grep -c active | grep -qx 3 && ! x 'systemctl is-active --quiet yard-staging'; echo $?)"
  # SSH hardening through a real key login as root (SSH_CLIENT set, journal shows the key).
  x 'rm -f /etc/ssh/sshd_config.d/01-yard.conf'
  tar -C "$KIT" -cz . | ssh -i "$W/keys/owner" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR "root@$IP" \
    'mkdir -p /opt/yard/kit && tar -xz -C /opt/yard/kit && YARD_SETUP_REHEARSAL=1 bash /opt/yard/kit/setup.sh' >"$W/logs/$MODE-setup-ssh.log" 2>&1
  check "SSH hardening: password login off after a confirmed key login" "$(x 'sshd -T | grep -qx "passwordauthentication no"'; echo $?)"
  check "SSH hardening: the owner can still log in with the key" "$(ssh -i "$W/keys/owner" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR "root@$IP" true; echo $?)"
fi
grep -q 'SSH password login is still ON' "$W/logs/$MODE-setup1.log"
check "SSH hardening: without a confirmed key login, passwords stay on with instructions" "$?"

echo
echo "$MODE on $IMAGE: $pass passed, $fail failed (logs: $W/logs)"
((fail == 0))
