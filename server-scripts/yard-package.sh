#!/usr/bin/env bash
# shellcheck disable=SC2016 # node -e snippets are JavaScript, single-quoted on purpose
# yard-package: pack a finished build into the release archive that yard-update downloads.
#
# Run from the project root after `npm run build` and `npm prune --omit=dev`
# (.github/workflows/build-release.yml does exactly that):
#
#   server-scripts/yard-package.sh OUT_DIR [SHA]
#
# Writes OUT_DIR/yard-build-<sha12>.tar.gz and OUT_DIR/yard-build-<sha12>.tar.gz.sha256.
# The archive holds what `npm start` and the deploy scripts (db:migrate, geoip:update,
# search:reindex) need beside the git checkout of the same commit:
#   .next/          the build, without .next/cache (the server keeps its own image cache),
#                   .next/dev (dev-server output) and .next/standalone (not used: the service
#                   runs `npm start` from the release folder)
#   node_modules/   production dependencies only (tsx, which the scripts load, is one)
#   tools/          the bundled command-line tools (npm run build's postbuild, scripts/bundle-tools.mjs):
#                   check-env.mjs, db-migrate.mjs, create-admin.mjs, plain JavaScript that runs with
#                   just `node` (no tsx, no "@/" path aliases), e.g. node tools/check-env.mjs
#   public/, package.json, package-lock.json
#   release.json what the build saw (commit, deployment id, public URL, verification tokens, Node)
set -euo pipefail

OUT=${1:?usage: yard-package.sh OUT_DIR [SHA]}
SHA=${2:-${GITHUB_SHA:-$(git rev-parse HEAD)}}
SHA12=${SHA:0:12}
NAME="yard-build-$SHA12.tar.gz"

[ -f .next/BUILD_ID ] || { echo "No finished build here (.next/BUILD_ID is missing): run npm run build first." >&2; exit 1; }
[ -d node_modules ] || { echo "node_modules is missing." >&2; exit 1; }
for tool in check-env db-migrate create-admin; do
  [ -s "tools/$tool.mjs" ] || { echo "tools/$tool.mjs is missing: npm run build bundles it (postbuild: scripts/bundle-tools.mjs) before npm prune." >&2; exit 1; }
done
if [ -d node_modules/eslint-config-next ] || [ -d node_modules/drizzle-kit ]; then
  echo "node_modules still has dev dependencies: run npm prune --omit=dev before packaging." >&2
  exit 1
fi

# Marks these dependencies as installed from this lockfile (yard-update's check).
cp package-lock.json node_modules/.yard-lock

node -e '
  const [sha, sha12] = process.argv.slice(1)
  const e = process.env
  const info = {
    sha, deploymentId: e.YARD_DEPLOYMENT_ID || sha12, builtAt: new Date().toISOString(), node: process.version,
    publicUrl: e.YARD_PUBLIC_URL || "", googleSiteVerification: e.GOOGLE_SITE_VERIFICATION || "",
    bingSiteVerification: e.BING_SITE_VERIFICATION || "", run: e.GITHUB_RUN_ID ? `${e.GITHUB_SERVER_URL}/${e.GITHUB_REPOSITORY}/actions/runs/${e.GITHUB_RUN_ID}` : "",
  }
  require("node:fs").writeFileSync("release.json", JSON.stringify(info, null, 2) + "\n")
' "$SHA" "$SHA12"

mkdir -p "$OUT"
# --anchored: the excludes match only these top-level paths, never a package's own folders.
tar --anchored \
  --exclude=.next/cache --exclude=.next/dev --exclude=.next/standalone \
  --exclude=node_modules/.cache \
  -czf "$OUT/$NAME" .next node_modules tools public package.json package-lock.json release.json
rm -f release.json
( cd "$OUT" && sha256sum "$NAME" > "$NAME.sha256" )
echo "Packed $OUT/$NAME ($(du -h "$OUT/$NAME" | cut -f1))"
cat "$OUT/$NAME.sha256"
