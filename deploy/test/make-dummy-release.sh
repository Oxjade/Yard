#!/usr/bin/env bash
# make-dummy-release.sh OUT_DIR ENV SHA VARIANT MIGRATIONS PG_NODE_MODULES
#   Builds a fake Next standalone project around dummy-app/ and packages it with the real
#   package-release.sh. VARIANT: good | badmigration (last migration is invalid SQL) | unhealthy
#   (health answers 503). MIGRATIONS: how many drizzle/*.sql files. Rehearsal only.
set -euo pipefail
out=$(realpath -m "$1") env=$2 sha=$3 variant=$4 n=$5 pgmods=$(realpath "$6")
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
proj=$(mktemp -d)
trap 'rm -rf "$proj"' EXIT
mkdir -p "$proj/.next/standalone/node_modules" "$proj/.next/static/chunks" "$proj/public" "$proj/drizzle/meta" "$proj/tools"
cp "$here/dummy-app/server.js" "$proj/.next/standalone/"
cp -a "$pgmods/." "$proj/.next/standalone/node_modules/"
cp "$here/dummy-app/tools/"*.mjs "$proj/tools/"
echo "console.log('chunk $sha')" >"$proj/.next/static/chunks/main-$sha.js"
echo "User-agent: *" >"$proj/public/robots.txt"
echo "SHOULD-NOT-SHIP=1" >"$proj/.next/standalone/.env.production"
for i in $(seq 1 "$n"); do
  printf 'create table if not exists yard_dummy.t%04d (id int primary key);\n' "$i" >"$proj/drizzle/$(printf '%04d' "$i")_m.sql"
done
if [[ "$variant" == badmigration ]]; then
  echo "create table yard_dummy.broken (id int primary key; -- syntax error" >"$proj/drizzle/$(printf '%04d' "$n")_m.sql"
fi
[[ "$variant" == unhealthy ]] && touch "$proj/.next/standalone/UNHEALTHY"
echo '{"version":"7","entries":[]}' >"$proj/drizzle/meta/_journal.json"
url="https://$env.example"
(cd "$proj" && YARD_PUBLIC_URL=$url bash "$here/../package-release.sh" "$env" "$sha" "$out" >/dev/null)
ls "$out/yard-$sha.tar.gz" >/dev/null
