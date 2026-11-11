#!/usr/bin/env bash
# package-release.sh ENV SHA [OUT_DIR]
#   Run in CI after `next build` (output: "standalone") and `node scripts/bundle-tools.mjs --out tools`.
#   Assembles the release the server runs, with no npm install and no build on the server:
#
#     server.js, node_modules/ (traced), .next/   from .next/standalone
#     .next/static/                               from .next/static
#     public/                                     from public
#     drizzle/                                    migrations (journal + SQL)
#     tools/                                      db-migrate, check-env, create-admin, db-check (bundled)
#     release.json                                {sha, env, publicUrl, builtAt, ref, node}
#
#   Writes OUT_DIR/yard-SHA.tar.gz and OUT_DIR/yard-SHA.tar.gz.sha256 (default OUT_DIR: dist).
set -euo pipefail

env=${1:-}
sha=${2:-}
out=${3:-dist}
case "$env" in production | staging | ci) ;; *)
  echo "usage: package-release.sh production|staging|ci SHA [OUT_DIR]" >&2
  exit 64
  ;;
esac
[[ "$sha" =~ ^[0-9a-f]{7,40}$ ]] || {
  echo "SHA must be 7-40 lowercase hex characters" >&2
  exit 64
}
fail() {
  echo "package-release: $*" >&2
  exit 1
}

[[ -f .next/standalone/server.js ]] || fail ".next/standalone/server.js is missing: build with output: \"standalone\" first"
[[ -d .next/static ]] || fail ".next/static is missing"
[[ -f drizzle/meta/_journal.json ]] || fail "drizzle/meta/_journal.json is missing"
# tools/: `node scripts/bundle-tools.mjs --out tools` (its default output, .next/standalone/tools, works too)
tools_dir=tools
[[ -f tools/db-migrate.mjs || ! -f .next/standalone/tools/db-migrate.mjs ]] || tools_dir=.next/standalone/tools
for t in db-migrate.mjs check-env.mjs create-admin.mjs; do
  [[ -f "$tools_dir/$t" ]] || fail "tools/$t is missing: run node scripts/bundle-tools.mjs --out tools first"
done
for v in YARD_SEED_DEMO YARD_DEMO_AUTH YARD_DEMO_ADMIN; do
  case "${!v:-}" in "" | 0 | false | off) ;; *) fail "$v is set: a release must be built with demo flags off" ;; esac
done

stage=$(mktemp -d "${TMPDIR:-/tmp}/yard-release.XXXXXX")
trap 'rm -rf "$stage"' EXIT
cp -a .next/standalone/. "$stage/"
mkdir -p "$stage/.next"
rm -rf "$stage/.next/static" "$stage/public" "$stage/drizzle" "$stage/tools"
cp -a .next/static "$stage/.next/static"
[[ -d public ]] && cp -a public "$stage/public"
cp -a drizzle "$stage/drizzle"
cp -a "$tools_dir" "$stage/tools"
# The server creates .next/cache as a link to its data dir; never ship a build cache.
rm -rf "$stage/.next/cache"
# Secrets live on the server only. next build may copy .env files into standalone: drop them.
find "$stage" -maxdepth 2 -name '.env*' -print -delete | sed 's/^/package-release: removed /' >&2 || true
# Source maps of server code are not needed at run time.
find "$stage/.next/server" -name '*.map' -delete 2>/dev/null || true

node -e '
const [sha, env, ref, url] = process.argv.slice(1)
const out = { sha, env, ref, publicUrl: url, builtAt: new Date().toISOString(), node: process.version }
process.stdout.write(JSON.stringify(out, null, 2) + "\n")
' "$sha" "$env" "${GITHUB_REF_NAME:-local}" "${YARD_PUBLIC_URL:-}" >"$stage/release.json"

mkdir -p "$out"
out=$(cd "$out" && pwd)
tarball="$out/yard-$sha.tar.gz"
tar -czf "$tarball" -C "$stage" --owner=0 --group=0 --numeric-owner .
(cd "$out" && sha256sum "yard-$sha.tar.gz" >"yard-$sha.tar.gz.sha256")
size=$(du -h "$tarball" | cut -f1)
echo "package-release: $tarball ($size, $(awk '{ print $1 }' "$out/yard-$sha.tar.gz.sha256"))"
