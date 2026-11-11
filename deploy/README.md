# Running Yard on your server

This folder sets up one small Ubuntu server so it runs two copies of Yard:

| | Address | What it is for |
|---|---|---|
| **Production** | https://162-246-17-39.sslip.io | The real shop. Changes arrive from the `main` branch, after you approve them. |
| **Staging** | https://staging.162-246-17-39.sslip.io | A rehearsal copy. Changes from the `v3` branch arrive here automatically. |

`sslip.io` is a free service that turns an IP address into a web address, so you get working HTTPS before you buy a domain. Switching to your own domain later is one command (section 10).

How it fits together: GitHub builds the app and sends the finished build to the server over SSH. The server never builds anything itself. On the server, Caddy handles HTTPS and passes visitors to Yard. Postgres holds the data, and a backup runs every night.

---

## 1. What you need

- The server: Ubuntu 26.04, IP `162.246.17.39`, and the root password or root SSH key the host gave you.
- A computer with this repository on it, and a terminal. On a Mac or Linux that is Terminal. On Windows it is PowerShell, which already includes `ssh` and `tar`.
- About 15 minutes.

## 2. Make an SSH key and put it on the server (do this first)

An SSH key lets you log in without a password. Once your key works, setup turns password logins off, which closes the most common way servers get broken into.

**Mac / Linux / Windows PowerShell:**

```sh
ssh-keygen -t ed25519            # press Enter at every question
```

**Copy the key to the server.** On Mac or Linux:

```sh
ssh-copy-id root@162.246.17.39   # asks for the root password once
```

On Windows PowerShell (one line):

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@162.246.17.39 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

Check it worked: `ssh root@162.246.17.39` should log you in **without** asking for a password. Type `exit` to leave.

## 3. The one setup command

From your computer, inside the repository folder, run:

```sh
tar -C deploy -cz . | ssh root@162.246.17.39 'mkdir -p /opt/yard/kit && tar -xz -C /opt/yard/kit && bash /opt/yard/kit/setup.sh'
```

It takes about 5 minutes. It installs Postgres, Node.js, Caddy, the firewall, automatic security updates and the nightly backup. It also creates the databases and their passwords, plus the app's secret keys. Running it again is safe: anything already set up is left as it is, and no existing secret is ever changed.

It prints three things. **Copy them somewhere safe right away:**

1. **The two ENCRYPTION KEYS**, in a box that says *SAVE THE ENCRYPTION KEYS*. The box appears as soon as the keys are made (so even if a later step fails you have already seen it) and again at the end. Put them in a password manager. Yard uses them to lock sensitive data such as connected social accounts and payout details. If the server is lost and you restore a backup without these keys, that data cannot be read again. They are not in the backups on purpose. (They also stay on the server in `/etc/yard/production.env` and `/etc/yard/staging.env`. Each file can be read only by root and by that copy's own app user: staging can never read production's file.)

   Every later run of the setup command shows the keys again, until you confirm you saved them:

   ```sh
   ssh root@162.246.17.39 'bash /opt/yard/kit/setup.sh --keys-saved'
   ```
2. **The GitHub secrets**: `VPS_HOST`, `VPS_KNOWN_HOSTS` and two `VPS_SSH_KEY` blocks, one for staging and one for production. You need these in the next section.
3. **A note about SSH.** If it says *password login is still ON*, the key login from section 2 didn't work. Fix that, then run the setup command again; it finishes the job.

Lost the GitHub keys? Log in and run `bash /opt/yard/kit/setup.sh --rotate-deploy-keys`. That makes new ones, and the old ones stop working.

## 4. Connect GitHub (step by step)

On GitHub, open the repository and go to **Settings**.

**a. Two repository secrets.** Go to **Secrets and variables → Actions → New repository secret**:
- Name `VPS_HOST`. Value: `162.246.17.39`
- Name `VPS_KNOWN_HOSTS`. Value: all the lines setup printed under *VPS_KNOWN_HOSTS*, each starting with `162.246.17.39`. They let GitHub check that it is talking to your server and not an impostor.

**b. The staging environment.** Go to **Environments → New environment**, name it `staging` and click **Configure environment**.
- Under **Environment secrets**, click **Add secret**. Name it `VPS_SSH_KEY`. For the value, paste the block printed for **"staging"**, from `-----BEGIN OPENSSH PRIVATE KEY-----` to `-----END OPENSSH PRIVATE KEY-----`.
- Optional: **Deployment branches → Selected branches → add `v3`**.

**c. The production environment, with you as the approver.** Go to **Environments → New environment**, name it `production`.
- Tick **Required reviewers** and add yourself. Click **Save protection rules**. From now on, every production deploy waits until you click **Approve**.
- **Deployment branches → Selected branches → add `main`**.
- Under **Environment secrets**, add `VPS_SSH_KEY` with the block printed for **"production"**.

Each key only works for its own environment. On the server each one logs in as its own user (`deploy-staging` or `deploy-production`; the workflow picks the right one), and that user can only touch its own copy. Even someone who can push to `v3` cannot touch production.

Optional: to use a different map style, add `NEXT_PUBLIC_MAP_STYLE_URL` under **Secrets and variables → Actions → Variables**.

## 5. First deploys

- **Staging:** push to the `v3` branch. Open the **Actions** tab and watch "Deploy". When it finishes, the run's summary page shows "Deployed and healthy" and a link to the site.
- **Production:** merge into `main`. The "Deploy to production" step waits with a **Review deployments** button. Click it, then **Approve and deploy**.
- **Redeploy by hand:** go to **Actions → Deploy → Run workflow**. Choose the branch and the environment. Production only accepts `main`.

Every deploy follows the same steps:

1. It checks the build.
2. It saves a backup of the database.
3. It updates the database structure.
4. It switches to the new version and checks that it answers.

If the new version is not healthy within 90 seconds, the server switches back to the previous version automatically, and the summary says **ROLLED BACK**. If the database update fails, nothing is switched, and the old version keeps running.

The server runs each deploy on its own, separately from GitHub's connection. If GitHub's connection drops or the run is cancelled halfway, the deploy still finishes on the server, health check and automatic rollback included; the workflow then asks the server for the result. The full log of every deploy is kept in `/srv/yard/<env>/logs/`.

## 6. Create your admin account (once, after the first production deploy)

```sh
ssh root@162.246.17.39
/opt/yard/bin/create-admin production --email you@example.com --name "Your Name" --print-link
```

Email isn't connected yet, so the command prints a set-password link. Open it within 72 hours, choose a password and sign in at `/admin`, where you set up two-step verification. Add other admins later from the Control Center. To get an admin account on staging, run the same command with `staging`.

## 7. What lives where (on the server)

| Path | What |
|---|---|
| `/etc/yard/domain.env` | The **one** place the domain is set (`YARD_DOMAIN`). |
| `/etc/yard/production.env`, `/etc/yard/staging.env` | Settings and secrets for each copy: database password, secret keys, payments, email. Each can be read only by root and by that copy's own app user. After editing one, restart that copy (section 8). |
| `/etc/yard/backup.env` | Backup settings (off-server copy, days kept). |
| `/srv/yard/<env>/releases/` | The last 5 builds. `current` points to the one running and `previous` to the one before. |
| `/srv/yard/<env>/logs/` | The log of each deploy and rollback. |
| `/var/lib/yard/<env>/` | Uploaded photos and videos, and the image cache. |
| `/var/backups/yard/` | Nightly backups (`YYYY-MM-DD/`, only complete ones; a failed night is kept as `YYYY-MM-DD.failed/`) and the database snapshots taken before each deploy (`pre-migrate/`). |
| `/opt/yard/bin/` | The tools: `release`, `rollback`, `backup`, `restore`, `create-admin`, `set-domain`, `yard-status`. |
| `/opt/yard/kit/` | A copy of this folder from the last setup run, including this README. |

The users (none of them can log in with a password):

| User | What it does |
|---|---|
| `yard-production`, `yard-staging` | Run each copy of the app. Each owns only its own data folder and can read only its own settings file. Staging (which gets every `v3` push without review) can't see production's secrets, data, files or processes. |
| `deploy-production`, `deploy-staging` | GitHub's deploy keys log in as these. Each can upload and release only its own copy. |

The services:

- `yard-production`: the shop, on port 3000. It starts by itself when the server boots.
- `yard-staging`: port 3001. It starts on staging deploys only.
- `postgresql`, `caddy`, `fail2ban`.
- `yard-backup.timer`: the nightly backup.

## 8. Everyday commands

Log in with `ssh root@162.246.17.39`, then:

| To… | Run |
|---|---|
| See if everything is OK (services, memory, disk, and whether the last backup is complete) | `yard-status` |
| Watch the shop's log | `journalctl -u yard-production -f` (Ctrl+C to stop) |
| Restart the shop | `systemctl restart yard-production` |
| **Free memory: stop staging** | `systemctl stop yard-staging` (production is not affected; the next staging deploy starts it again) |
| Start staging without deploying | `systemctl start yard-staging` |
| Go back to the previous version | `/opt/yard/bin/rollback production` |
| Go back to a specific kept version | `/opt/yard/bin/rollback production <commit>` (`ls /srv/yard/production/releases`) |

A rollback changes the code only. Any database change made by the newer version stays, which is safe because database updates only ever add things. To put the data back as well, restore the database snapshot taken just before that deploy (section 9).

**Caddy** has no live admin interface (it would let any program on the server change where visitors are sent). After changing its settings, use `systemctl restart caddy`; `systemctl reload caddy` does not work and isn't needed.

**Reboots.** Security updates install by themselves every night, but the server never reboots on its own. When `yard-status` or the login message says a reboot is required, pick a quiet moment and run `reboot`. The shop is back about a minute later. Staging stays off until its next deploy.

## 9. Backups and restoring

**What runs every night (about 03:17 UTC):** a backup of both databases plus all production uploads. It goes into `/var/backups/yard/<date>/` and is kept for 14 days. Each folder has a `SHA256SUMS` file to check that the files are intact. A backup is first written to a temporary folder and only gets its date name once every part worked, so a dated folder is always complete. Run a backup right now with `/opt/yard/bin/backup`.

**Check it's working:** `yard-status` shows the date of the last *complete* backup (checksums verified) and the result of the last run. If a night fails it says **BACKUP PROBLEM**; the reason is in `journalctl -u yard-backup -n 50`, and the incomplete files are kept in `/var/backups/yard/<date>.failed/`.

**Restore** (it asks you to type the environment name first):

```sh
# the database from a nightly backup, plus the uploads
/opt/yard/bin/restore production /var/backups/yard/2026-11-20/yard_production.dump /var/backups/yard/2026-11-20/uploads-production.tar.gz
# only the database, from the snapshot taken before a deploy
/opt/yard/bin/restore production /var/backups/yard/pre-migrate/production/pre-20261120T101500Z.dump
```

Before replacing anything, restore saves a snapshot of the database as it is now (in `/var/backups/yard/pre-restore/`), so a restore can itself be undone.

**Practise once a month, safely:** restore last night's production backup into **staging** and click around staging:

```sh
/opt/yard/bin/restore staging /var/backups/yard/$(date -u +%F)/yard_production.dump /var/backups/yard/$(date -u +%F)/uploads-production.tar.gz
```

Staging has its own encryption key, so connected social accounts and payout details from production won't open there. That's expected. Keep email turned off on staging, because after this restore it holds real customers' addresses.

**Off-server copy (recommended, off by default).** Backups on the same server don't help if the server is lost. To also copy them to cloud storage such as Backblaze B2 or Cloudflare R2 (a few cents a month at this size):

1. Create a bucket and an access key with your storage provider.
2. On the server, run `rclone config` and follow the questions to add a "remote", for example one named `b2`.
3. In `/etc/yard/backup.env`, set `RCLONE_REMOTE=b2:your-bucket-name`. The cloud copies are kept 30 days (`RCLONE_KEEP_DAYS`).
4. Test it: `/opt/yard/bin/backup`. The last lines should say "off-server copy done".

## 10. Switching to your own domain

1. At your domain registrar, add two **A records** pointing to `162.246.17.39`: one for `@` (the bare domain) and one for `staging`.
2. Wait until `ping yourdomain.com` shows `162.246.17.39`. This can take a few minutes up to an hour.
3. On the server: `/opt/yard/bin/set-domain yourdomain.com`.
4. Redeploy both copies: **Actions → Deploy → Run workflow**, once with `v3` → staging and once with `main` → production. The address is built into the pages at build time, so this step is needed.

Caddy gets the new HTTPS certificates by itself. If you later connect a payment provider or social login, also update the addresses registered with them.

## 11. Adding payments later

Right now payments are **off** (`YARD_PAYMENTS=off`). Shoppers can browse, sign up, fill their cart and get as far as checkout, which says "Payments open soon". No order is created that can't be paid. Brands, Studio and accounts all work normally.

The Paystack code is in place. To connect it:

1. Edit `/etc/yard/production.env` (`nano /etc/yard/production.env`). Set `YARD_PAYMENTS=paystack` and fill in the `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY` and `PAYSTACK_WEBHOOK_SECRET` lines (remove the `#` in front of them).
2. In the Paystack dashboard, set the webhook URL to `https://<your domain>/api/webhooks/paystack`.
3. Restart the shop with `systemctl restart yard-production`, then check the log line `[yard] payments: paystack (live)` in `journalctl -u yard-production -n 50`.
4. Make one small real purchase, refund it, and check the payout.

Try it on staging first with Paystack **test** keys in `/etc/yard/staging.env`.

**Bachs** (the provider you mentioned) is not built into Yard yet. Connecting it needs a code change first; after that it is the same kind of edit as above.

## 12. Email

Until email is set up, emails (password links, order updates) wait in a queue and are not sent. Admin set-password links are printed by `create-admin` instead. To turn email on, fill in the `EMAIL_PROVIDER`, `EMAIL_FROM` and `EMAIL_API_KEY` lines in `/etc/yard/production.env` (the supported providers are listed in the repository's `.env.example`). Then run `systemctl restart yard-production`. Queued emails go out after the restart.

## 13. Limits and costs

- **One server, one copy of each site.** Yard's background jobs and live updates run inside the app, so the shop can't be spread over several servers without code changes. For a growing shop that's fine. A bigger server is the first step when it gets busy.
- **Memory (1.6 GB).** Each part has a ceiling: production up to 550 MB, staging up to 400 MB, Postgres about 250 MB, and the system, Caddy and fail2ban about 250 MB. A 2 GB swap file absorbs short peaks. When both copies are busy at once the server is close to full, so **stop staging when you're not using it** (`systemctl stop yard-staging`). Staging also runs at lower priority, and if memory runs out, the system stops staging before it touches production. If `yard-status` regularly shows more than ~300 MB of swap in use, or the shop gets slow, move to a **2 GB** server. That is the first upgrade to make.
- **Disk.** Every upload takes space, and so do 14 days of backups. `yard-status` shows free space, and the backup warns below 3 GB free.
- **HTTPS on sslip.io.** It works, but Let's Encrypt limits how many certificates any one domain gets per week, and sslip.io is shared by many people. If a certificate is refused, Caddy keeps retrying by itself. Buying your own domain removes this risk.
- **Deploy downtime.** A restart takes a few seconds. Caddy holds incoming requests during that time instead of showing an error.

## 14. Troubleshooting

| Problem | What to do |
|---|---|
| A deploy says **ROLLED BACK** | The new version didn't come up healthy. The previous one is serving. Open the run's *Release log* section and look at the last log lines. Fix and push again. |
| A deploy says **migration failed** | Nothing changed, and the old version is serving. The error is in the release log. |
| A deploy's GitHub run lost its connection | The deploy still finished on the server. The workflow polls for the result; otherwise see `/srv/yard/<env>/logs/` (the newest `release-*.log`, and the `.status` file next to it holds the exit code). |
| `yard-status` says **BACKUP PROBLEM** | Run `journalctl -u yard-backup -n 50` to see why, fix it (often: Postgres stopped, or the disk is full), then run `/opt/yard/bin/backup`. |
| The site shows an error or doesn't load | Run `yard-status`, then `journalctl -u yard-production -n 100`. `systemctl restart yard-production` fixes a stuck process. |
| `https://staging…` says "Staging is stopped" | That's normal when staging is off. Start it with `systemctl start yard-staging`, or deploy to it. |
| The certificate isn't working | Run `journalctl -u caddy -n 50`. Ports 80 and 443 must be open. `ufw status` should list them, and so should your host's own firewall panel if it has one. |
| GitHub says "Host key verification failed" | The server was rebuilt or its SSH keys changed. Update `VPS_KNOWN_HOSTS` with the lines from a fresh setup run. |
| GitHub says "Permission denied (publickey)" | The `VPS_SSH_KEY` of that environment is wrong or was rotated. Paste the current key, or run `setup.sh --rotate-deploy-keys`. |
| You are locked out of SSH | Use your host's web console, the "VNC" or "Console" button in their panel. Log in as root there and fix `~/.ssh/authorized_keys`. |

---

### For maintainers

- `deploy/setup.sh` is the server setup (idempotent). `release.sh`, `rollback.sh`, `backup.sh` and `restore.sh` are installed to `/opt/yard/bin` without the `.sh`. `deploy-gate` is the forced command for the CI keys (one per environment, each in `/home/deploy-<env>/.ssh/authorized_keys`, root-owned). It runs `release` and `rollback` detached (`setsid`), streams the log and answers `status <env> [run]` afterwards. `yard-migrate` and `yard-predump` are the only root helpers each deploy user may run through `sudo`, for its own environment only.
- Isolation: one runtime user per environment (`yard-<env>`), env files `root:yard-<env> 0640`, data dirs `yard-<env> 0700`, release trees `deploy-<env>:yard-<env> 0750`. Both units add `ProtectProc=invisible` and `InaccessiblePaths=` for the other environment, the backups and `backup.env`. The release tools (migrate, check-env, create-admin) run through `systemd-run` with the same sandbox as the unit (`run_as_app` in `lib/common.sh`; keep its property list in step with the unit files).
- `release.sh` refuses a tarball with special files, absolute paths, or links that leave the release or go through another link (Next's own relative links under `.next/node_modules` are fine), checks after unpacking that every link resolves inside the release and that `.next`, `.next/static`, `.next/cache`, `public`, `tools`, `drizzle` are real folders. It carries only the previous build's own `.next/static` files (listed in its `.next/own-static.txt`), so release size stays flat.
- Caddy runs with `admin off`.
- `deploy/package-release.sh` runs in CI after `next build` (standalone output) and `node scripts/bundle-tools.mjs --out tools`. It produces `yard-<sha>.tar.gz` containing `server.js`, `.next/`, `public/`, `drizzle/`, `tools/` and `release.json`.
- The app contract the kit relies on:
  - `GET /api/health` returns `{status:"ok", version:<sha>}` with HTTP 200 when healthy. When the release is older than the database schema (a rollback), it must still answer ok.
  - `tools/db-migrate.mjs`, with `--check` exiting 3 when migrations are pending.
  - `tools/check-env.mjs` and `tools/create-admin.mjs`.
  - Environment variables: `PORT`, `HOSTNAME`, `DATABASE_URL`, `YARD_*`.
- `deploy/test/rehearse.sh noinit|systemd <image> <workdir>` rehearses the whole kit in a throwaway container with a stand-in app (`deploy/test/dummy-app`). With `REAL_DIST=<dir>` (real tarballs and a `shas` file, see the script) it then deploys the real standalone build, drills a restart with an open live stream, a broken release, backup and restore; in `systemd` mode it also measures memory under `v3-prod-clean` (+ `REAL_LOAD=<load script>`). Never run it on the server.
- The app's shutdown contract: on SIGTERM the live streams end with `bye {reason:"restart"}` (browsers reconnect at once) and Next drains in-flight requests; the database pool is not closed early. Stop takes about 1.5 s idle and up to ~6 s with requests in flight (Node's 5 s keep-alive), well inside `TimeoutStopSec=15`; stop plus boot stays inside Caddy's 30 s hold (`lb_try_duration`).
