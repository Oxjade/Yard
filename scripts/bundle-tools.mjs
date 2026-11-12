#!/usr/bin/env node
// node scripts/bundle-tools.mjs [--out DIR]   (default DIR: .next/standalone/tools)
//
// The command-line tools a deployment runs beside the standalone server, each bundled into one
// plain .mjs file so the server needs only `node` (no npm install, no tsx, no TypeScript):
//   tools/db-migrate.mjs    npm run db:migrate   (advisory-locked migrations + reference seeds)
//   tools/check-env.mjs     validates the production configuration, every problem at once
//   tools/create-admin.mjs  npm run admin:create (the first owner admin)
// Run it after `next build`. The release must also carry drizzle/ (the migrations) and public/
// next to the tools' working directory, as the standalone server does. Bundled with the
// react-server condition (server-only resolves to nothing, as under Next); PGlite is stubbed out and
// pg's optional native binding stays external: a deployment uses Postgres (DATABASE_URL).
import { mkdirSync } from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"
import { build } from "esbuild"

const { values } = parseArgs({ options: { out: { type: "string" } } })
const root = path.resolve(import.meta.dirname, "..")
const out = path.resolve(values.out ?? path.join(root, ".next", "standalone", "tools"))
mkdirSync(out, { recursive: true })

// PGlite (and its wasm) never ships in the tools: they run against Postgres. drizzle's PGlite driver
// imports it statically, so it resolves to a stub that fails loudly if anything ever reaches it.
const noPglite = {
  name: "no-pglite",
  setup(b) {
    b.onResolve({ filter: /^@electric-sql\/pglite(\/.*)?$/ }, (args) => ({ path: args.path, namespace: "no-pglite" }))
    b.onLoad({ filter: /.*/, namespace: "no-pglite" }, () => ({
      contents: `const fail = () => { throw new Error("These tools run against Postgres (DATABASE_URL); PGlite isn't bundled.") }
export class PGlite { constructor() { fail() } }
export const types = new Proxy({}, { get: () => 0 })
export default {}`,
      loader: "js",
    }))
  },
}

const entries = ["db-migrate", "check-env", "create-admin"]
const started = Date.now()
const result = await build({
  absWorkingDir: root,
  entryPoints: Object.fromEntries(entries.map((e) => [e, path.join(root, "scripts", `${e}.mjs`)])),
  outdir: out,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  conditions: ["react-server"],
  tsconfig: path.join(root, "tsconfig.json"),
  external: ["pg-native"],
  plugins: [noPglite],
  // Some bundled CommonJS (pg, Next's compiled helpers) calls require() or reads __dirname: give the
  // ESM output real ones.
  banner: {
    js: [
      "import { createRequire as __yardCreateRequire } from 'node:module';",
      "import { fileURLToPath as __yardFileURLToPath } from 'node:url';",
      "import { dirname as __yardDirname } from 'node:path';",
      "const require = __yardCreateRequire(import.meta.url);",
      "const __filename = __yardFileURLToPath(import.meta.url);",
      "const __dirname = __yardDirname(__filename);",
    ].join(" "),
  },
  logLevel: "warning",
  legalComments: "none",
  metafile: true,
})
for (const [file, info] of Object.entries(result.metafile.outputs)) console.log(`${path.relative(root, file)}  ${(info.bytes / 1024 / 1024).toFixed(2)} MB`)
console.log(`bundled ${entries.length} tools into ${path.relative(root, out) || "."} in ${Date.now() - started} ms`)
