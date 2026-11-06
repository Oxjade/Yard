// Cluster S project checks (social), loaded by scripts/db-check.mjs. Each returns { status, name, detail }.
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const root = process.cwd()
const read = (p) => readFileSync(path.join(root, p), "utf8")

function walk(dir, out = []) {
  for (const name of readdirSync(path.join(root, dir))) {
    const rel = path.join(dir, name)
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel)
  }
  return out
}

export default async function s({ base, cookie }) {
  const out = []
  const add = (ok, name, detail) => out.push({ status: ok === null ? "SKIP" : ok ? "PASS" : "FAIL", name, detail })

  // The Social feed section exists atomically: union member, registry entry, editor icon, renderer case (§6.1, FEA-16).
  const types = read("src/lib/data/types.ts")
  const theme = read("src/components/storefront/theme.ts")
  const icons = read("src/components/studio/storefront-editor/sections-controls.tsx")
  const renderer = read("src/components/storefront/storefront-renderer.tsx")
  add(
    /\|\s*"social-feed"/.test(types) && /"social-feed":\s*\{\s*label: "Social feed"/.test(theme) && /"social-feed":\s*ShareNetwork/.test(icons) && /case "social-feed":/.test(renderer),
    "social-feed: union member, registry, icon and renderer case together",
  )

  // social_tokens is imported only by src/server/social/** (§5.5).
  const importers = walk("src").filter((f) => !f.startsWith(path.join("src", "server", "social")) && /schema\/social-tokens/.test(read(f)))
  add(importers.length === 0, "schema/social-tokens imported only by src/server/social/**", importers.join(", ") || "none elsewhere")

  // No 'use cache' and no Server Actions in the social code (§1.6, §1.7).
  const mine = [...walk("src/server/social"), ...walk("src/app/api/social"), ...walk("src/app/api/studio/social"), ...walk("src/components/studio/social"), ...walk("src/components/storefront/social")]
  const bad = mine.filter((f) => /^\s*["']use (cache|server)["']/m.test(read(f)))
  add(bad.length === 0, "no 'use cache' or 'use server' in social code", bad.join(", ") || `${mine.length} files`)

  // OAuth start is POST only; the callback redirects only to /studio/social (no return_to).
  const start = read("src/app/api/social/instagram/start/route.ts")
  add(/export const POST/.test(start) && !/export const GET/.test(start), "OAuth start exports POST only")
  add(!/return_to|returnTo/.test(read("src/server/social/http.ts") + read("src/server/social/oauth.ts")), "no return_to in the OAuth path")

  // Downloader: https, allowlist, manual redirects, 15 s timeout (SEC-33).
  const dl = read("src/server/social/download.ts")
  add(/redirect: "manual"/.test(dl) && /AbortSignal\.timeout\(TIMEOUT_MS\)/.test(dl) && /TIMEOUT_MS = 15_000/.test(dl) && /protocol !== "https:"/.test(dl), "hardened downloader (https, manual redirects, 15 s)")

  // Live server checks.
  try {
    const feed = await fetch(`${base}/api/brands/b_lagos_static/social-posts`)
    const body = await feed.json()
    add(feed.ok && Array.isArray(body.posts) && body.posts.every((p) => !("visibility" in p) && !("moderationStatus" in p)), "public feed returns public DTOs only", `${body.posts?.length ?? 0} posts`)
    add(/public, max-age=60/.test(feed.headers.get("cache-control") ?? ""), "public feed is cacheable for 60 s", feed.headers.get("cache-control"))
    const start405 = await fetch(`${base}/api/social/instagram/start`)
    add(start405.status === 405, "GET /api/social/instagram/start → 405", String(start405.status))
    const meta = await fetch(`${base}/api/social/instagram/deauthorize`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "signed_request=a.b" })
    add(meta.status === 404, "Meta deauthorize answers 404 without Instagram keys", String(meta.status))
    if (cookie) {
      const v = await (await fetch(`${base}/api/social/dev/vault`, { headers: { cookie } })).json()
      add(v.allV1 === true && !v.accountColumns.some((c) => /^(access|refresh)_token/.test(c)), "vault rows are v1. and social_accounts has no token columns", `${v.rows} sealed rows`)
    } else add(null, "vault check", "no admin cookie")
  } catch (e) {
    add(false, "social live checks", e.message)
  }
  return out
}
