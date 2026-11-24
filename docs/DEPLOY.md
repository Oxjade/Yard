# Deploying Yard

`sudo yard-update` on the server deploys the branch the live copy is on (v3) without taking the site
down: it prepares the next release in the spare folder (`/home/yard/app-a` or `app-b`), runs the
backup and database migrations, switches the `/home/yard/app` symlink, restarts Yard and switches
back if the new release isn't healthy. `--status`, `--follow` and `--rollback` work as before.

## Builds happen on GitHub, not on the server

The server (1.6 GB RAM, with Postgres and the live site on it) is too small to run `next build`.
So GitHub Actions builds every push to v3 (`.github/workflows/build-release.yml`):

1. `npm ci`, `npm run build` (Node 22, as on the server) with the same settings the server's build
   used: `YARD_PUBLIC_URL`, `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION` (repository
   variables, below), `YARD_DEPLOYMENT_ID` = the commit's first 12 characters, `YARD_SKIP_TYPECHECK=1`.
   `npm run build` also bundles the command-line tools into `tools/` (its postbuild,
   `scripts/bundle-tools.mjs`, with esbuild from the dev dependencies): `check-env.mjs`,
   `db-migrate.mjs`, `create-admin.mjs`, plain JavaScript that needs only `node`.
2. `npm prune --omit=dev`, then `server-scripts/yard-package.sh` packs `.next` (without its cache),
   the production `node_modules`, `tools/`, `public/`, `package.json`, `package-lock.json` and
   `release.json` (commit, build time and the settings above; `/api/health` reports this commit as
   `version`). It refuses to pack a build without `tools/`.
3. The archive `yard-build-<sha12>.tar.gz` and its `.sha256` are published as a prerelease tagged
   `build-<sha12>`. Only the 10 newest builds are kept.

`sudo yard-update` then:

| Step | What happens |
|---|---|
| [1/6] | fetches the code into the spare folder (still needed for migrations and scripts) |
| [2/6] | waits for the GitHub build of that exact commit, checking every 15 s (`… waiting for GitHub build (2m15s)`), for up to 20 minutes |
| [3/6] | downloads the archive, checks its sha256 and unpacks it. Dependencies: the shipped `node_modules` are used unless the folder already has the ones for this lockfile |
| [4/6] | backup, `db:migrate`, `geoip:update`, `search:reindex` |
| [5/6] | switch, restart, health check, automatic switch-back if unhealthy |
| [6/6] | warms the main pages |

If the GitHub build failed or didn't finish in 20 minutes, yard-update prints the Actions page
and stops: **the live site is not touched.** Fix and push again, re-run the workflow from that
page, or build on the server as before with `sudo yard-update --local` (slow; it needs the memory).

A deploy now takes about a minute on the server once GitHub's build (5 to 10 minutes after the
push) is ready. Running `sudo yard-update` right after pushing is fine: it waits.

Only pushes to v3 build automatically. To deploy another branch, run the workflow by hand for it
(GitHub › Actions › Build release › Run workflow, pick the branch).

## One-time setup

### 1. Repository variables (GitHub)

github.com/Oxjade/Yard › Settings › Secrets and variables › Actions › **Variables** tab ›
New repository variable. Use the same values as in `/etc/yard.env` on the server:

| Name | Value |
|---|---|
| `YARD_PUBLIC_URL` | **required**, e.g. `https://yardstore.space` (the build fails without it) |
| `GOOGLE_SITE_VERIFICATION` | optional, the meta-tag token(s) from Search Console (docs/SEO-AI.md) |
| `BING_SITE_VERIFICATION` | optional, the meta-tag token(s) from Bing Webmaster Tools |

These are public values (they are in every page's HTML), so variables, not secrets. They are baked
into prerendered pages: after changing one, re-run the workflow (Actions › Build release › Run
workflow) and deploy. yard-update warns when the build's values differ from `/etc/yard.env`.
The workflow needs no secret; it publishes with the built-in `GITHUB_TOKEN`. If Actions can't
create releases, check Settings › Actions › General › Workflow permissions (the workflow asks for
`contents: write` itself, which is enough unless the organisation restricts it).

### 2. A read-only token for the server

github.com › your avatar › Settings › Developer settings › Personal access tokens ›
**Fine-grained tokens** › Generate new token:

- Name: `yard-vps-deploy`; expiration: as long as you are comfortable with (put a reminder in the calendar).
- Resource owner: Oxjade. Repository access: **Only select repositories** › `Oxjade/Yard`.
- Repository permissions: **Contents: Read-only** (Metadata: Read-only is added automatically).
  Recommended as well: **Actions: Read-only**, so yard-update sees a failed build at once instead of
  waiting for the 20-minute timeout.

If Oxjade is an organisation that requires approval for fine-grained tokens, an owner approves it
under the organisation's Settings › Personal access tokens › Pending requests.

### 3. The server

Add the token to `/etc/yard.env` (it stays `root:yard`, mode 640):

```sh
sudo nano /etc/yard.env
```

```
GITHUB_TOKEN_DEPLOY=github_pat_…
YARD_BUILD_SOURCE=ci
```

(`YARD_BUILD_SOURCE` defaults to `ci` whenever `GITHUB_TOKEN_DEPLOY` is set; `local` brings back
building on the server.) yard-update never prints the token and passes it to curl without putting
it on a command line; it doesn't hand it to the migration scripts either.
The Yard service reads `/etc/yard.env` too, so the running app has the token in its environment;
it can only read the repository, and nothing in Yard uses it.

Install the new yard-update (as root), from v3 once this change is there:

```sh
runuser -u yard -- git -C /home/yard/app fetch origin v3 && runuser -u yard -- git -C /home/yard/app show origin/v3:server-scripts/yard-update.sh > /usr/local/bin/yard-update && chmod 755 /usr/local/bin/yard-update
```

Then push to v3 (or run the workflow by hand once), and deploy:

```sh
sudo yard-update            # waits for GitHub's build, downloads it, migrates, switches
sudo yard-update --status   # from another SSH window: which step, how long
curl -s http://127.0.0.1:3000/api/health   # "version" is the deployed commit
```

## Checking the configuration

After changing `/etc/yard.env` (and before restarting), check it with the release's bundled checker,
as the `yard` user with the file loaded, from the live release:

```sh
sudo runuser -u yard -- bash -c 'set -a; . /etc/yard.env; set +a; cd /home/yard/app && node tools/check-env.mjs'
```

It lists every problem at once and exits 1, or prints `configuration OK: production, env …, Postgres
(…), payments …` and exits 0. Nothing secret is printed. Then `sudo systemctl restart yard`.
`node scripts/check-env.mjs` in the same folder hands over to `tools/check-env.mjs` (the script itself
imports TypeScript sources through the `@/` alias, which a release can't load without the dev
tooling). A release built before the tools were bundled has no `tools/`; deploy a newer build first.

## Bot protection: Cloudflare Turnstile (optional)

Sign-up, password reset, magic-link requests and brand applications always use a honeypot, a minimum
fill time and rate limits. With these two keys in `/etc/yard.env` the website also shows Cloudflare
Turnstile (free), checked on the server. Without them Turnstile is simply off and never blocks anyone.

| Variable | |
|---|---|
| `TURNSTILE_SITE_KEY` | public site key (the browser sees it) |
| `TURNSTILE_SECRET_KEY` | secret key (server only) |

1. Cloudflare dashboard (a free account is enough) › **Turnstile** › **Add widget**.
2. Name it "Yard", add the site's public hostname (and `localhost` only on a test server), Widget mode **Managed**, no pre-clearance. Create.
3. Copy the **Site Key** and **Secret Key** straight into `/etc/yard.env` on the server
   (`sudo nano /etc/yard.env`, the file stays `root:yard`, mode 640). Never paste them in chat, an
   issue or a commit.
4. Check the configuration (above), then `sudo systemctl restart yard`.

Only requests from a web browser need the Turnstile token: the mobile apps call the same endpoints
without one (docs/APP.md "Bot protection"). If Cloudflare can't be reached, requests go ahead and the
log says `[yard] human-check: Turnstile unreachable`. Bot refusals are logged
(`[yard] human-check: … refused as a bot`) and counted (`human.bot.*`, `human.challenge_*`).

`YARD_MAX_BRANDS_PER_ACCOUNT` (optional, default 3): the most brands one account may own; a new
application beyond it is refused. One application may wait for review per account at a time, and a
brand application needs a verified email.

The disposable-email list is vendored (`src/server/auth/disposable-domains.data.ts`). Refresh it with
`npm run email:disposable-update` now and then, review the diff and commit it.

## Who can open which page (production)

With the demo switch off, `src/proxy.ts` decides before a page renders (`src/lib/access-gate.ts`
has the rules; `src/lib/access-gate.test.ts` is the matrix):

| Visitor | `/admin/**` | `/studio/**` | `/you`, `/inbox`, `/notifications`, `/wishlist`, `/following`, `/checkout` |
|---|---|---|---|
| Signed out | 307 `/admin/sign-in?next=…` | 307 `/studio/sign-in?next=…` | 307 `/sign-in?next=…` |
| Shopper with no brand | 307 `/` | 307 `/sell` | served |
| Brand member | 307 `/` | served (signed out of Studio: its sign-in) | served |
| Admin | served; a section outside the role shows "You don't have access to this" | Studio sign-in | `/sign-in` |

`/admin/sign-in`, `/studio/sign-in`, `/studio/onboarding`, `/bag` and `/sell` are open to everyone;
`/dev/**` answers 404 in every production build. The proxy only looks for the session cookie; the
Control Center (and a shopper's way into Studio) is confirmed on the server through
`GET /api/pages/access`, and every API checks the session and permission again (401/403). The demo
and development are unchanged.

New brands stay `pending_review` and are invisible everywhere public (storefront 404, `/brands`,
`/shop`, search, sitemap, feeds, `llms.txt`, charts, the homepage) until an admin approves them. After
deploying this, run `npm run search:reindex` once so brands already waiting leave the search index.

## Options

| Command | |
|---|---|
| `sudo yard-update` | deploy (CI build when set up, else local build) |
| `sudo yard-update --local` | build on the server this once |
| `sudo yard-update --rollback` | switch back to the previous release |
| `sudo yard-update --status` / `--follow` | watch a running deploy |

Settings for testing the script itself (environment variables, not `/etc/yard.env`):
`YARD_HOME`, `YARD_ENV_FILE`, `YARD_USER`, `YARD_SERVICE`, `YARD_RESTART_CMD` (default
`systemctl restart $YARD_SERVICE`), `YARD_HEALTH`, `YARD_BACKUP_DIR`, `YARD_LOCK`, `YARD_STATUS`,
`YARD_LOG`, `YARD_GITHUB_API` (default `https://api.github.com`), `YARD_GITHUB_REPO` (default: from
the origin URL), `YARD_CI_TIMEOUT` (seconds, default 1200), `YARD_CI_POLL` (default 15),
`YARD_DOWNLOADS` (default `/home/yard/.yard-downloads`).
