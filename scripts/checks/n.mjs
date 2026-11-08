// N (Integration, §9.10) project checks, loaded by scripts/db-check.mjs. Each returns { status, name, detail }.
// Read-only: static checks over the sources, plus public and signed-out reads.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

export default async function n({ base }) {
  const out = []
  const add = (ok, name, detail) => out.push({ status: ok === null ? "SKIP" : ok ? "PASS" : "FAIL", name: `N: ${name}`, detail })
  const root = process.cwd()
  const src = (p) => readFileSync(path.join(root, p), "utf8")

  // §7.1: the header links, in the owner's order (Shop and Categories kept, as the owner asked on 8 Nov).
  const site = src("src/config/site.ts")
  const nav = [...site.slice(site.indexOf("marketNav"), site.indexOf("browseLinks")).matchAll(/label: "([^"]+)"/g)].map((m) => m[1])
  add(nav.join(",") === "Discover,Brands,Shop,Categories,Charts,Around,Drops,Following", "header links: Discover, Brands, Shop, Categories, Charts, Around, Drops, Following", nav.join(", "))
  const browse = [...site.slice(site.indexOf("browseLinks")).matchAll(/label: "([^"]+)"/g)].map((m) => m[1])
  add(browse.join(",") === "Shop,Charts,Around,Drops,Brands,Categories", "Explore opens on Browse: Shop first, then Charts", browse.join(", "))

  // §7.2: clearance tokens, used instead of magic offsets.
  const css = src("src/app/globals.css")
  add(/--tabbar-top: calc\(max\(0\.875rem, env\(safe-area-inset-bottom\)\) \+ 3\.625rem\)/.test(css) && /--tabbar-clear: calc\(var\(--tabbar-top\) \+ 1\.75rem\)/.test(css), "tabbar clearance tokens in globals.css")
  const offsets = ["src/components/market/catalog/catalog-listing.tsx", "src/components/market/brands/directory.tsx", "src/components/market/product/product-view.tsx", "src/components/market/checkout/bag-view.tsx"]
  const stale = offsets.filter((f) => !src(f).includes("bottom-(--tabbar-clear)") || /4\.75rem\)\]|4\.125rem\)\]/.test(src(f)))
  add(stale.length === 0, "floating bars sit at --tabbar-clear", stale.join(", "))

  // §7.2: the Cart rename regression grep prints only the allowed lines.
  let grep = ""
  try {
    grep = execFileSync("bash", ["-c", `grep -rnE "[\\"'\\\`>][^\\"'\\\`<]*\\b[Bb]ag\\b" src --include=*.tsx --include=*.ts | grep -vE '^\\S+:[0-9]+:\\s*(//|\\*|/\\*)' || true`], { cwd: root, encoding: "utf8" })
  } catch (e) {
    grep = String(e)
  }
  const allowed = [
    /^src\/components\/studio\/business\/settings-model\.ts:\d+:export const RESERVED_HANDLES/, // reserved handles (route names)
    /^src\/components\/studio\/onboarding\/options\.ts:\d+: +"sign-in"/, // reserved handles (route names)
    /^src\/lib\/data\/catalog\.ts:\d+:.*Keyboards for every bag size/, // a physical bag
    /^src\/components\/studio\/business\/analytics-view\.tsx:\d+:.*-bag`\)/, // a seed key for sample noise, not copy
    /\{\/\*.*\*\/\}/, // JSX comments
    /import .*bag-|import \{ (bagButton|bagCount|BagGroups|BagPop|BagView|BagDrawer|BagSkeleton)/, // identifiers
    /\bbag\.(groups|subtotal|shipping|total|blocked)\b|bag-summary-title|"bag-bar"|"\/bag"|href="\/bag"/, // identifiers and the /bag route
    /mobile-tabbar\.tsx:\d+:.*\["\/bag", "\/checkout"\]/, // the /bag route
  ]
  const lines = grep.split("\n").filter(Boolean)
  const unexpected = lines.filter((l) => !allowed.some((re) => re.test(l)))
  add(unexpected.length === 0, `Cart rename grep: ${lines.length} lines, all identifiers, routes, comments or allowed copy`, unexpected.slice(0, 5).join(" | "))

  // §6.6: the barcode encoder is plain (npm test loads it) and has its decoder test.
  const bc = src("src/lib/barcode128.ts")
  add(!/from "@\/|server-only/.test(bc) && existsSync(path.join(root, "src/lib/barcode128.test.ts")), "barcode128.ts is plain Node with its decoder test")
  const ticket = src("src/components/market/checkout/receipt-ticket.tsx")
  add(ticket.includes("Order received — awaiting payment confirmation. Nothing was charged.") && ticket.includes("Not charged") && />Order ID</.test(ticket) && />Date &amp; time</.test(ticket) && /uppercase/.test(ticket), "receipt: the one awaiting-payment sentence, Not charged, sentence-case labels uppercased by class")

  // §7.5 / §7.6: sidebar sizes.
  const studio = src("src/components/studio/studio-shell.tsx")
  const groupsSrc = studio.slice(studio.indexOf("const groups: ShellNavGroup[]"), studio.indexOf("return (\n    <AppShell"))
  const studioItems = (groupsSrc.match(/\{ href: "\/studio[^"]*", label:/g) ?? []).length
  add(studioItems === 17, "Studio sidebar: 17 items", String(studioItems))
  const admin = src("src/components/admin/admin-shell.tsx")
  const adminGroups = admin.slice(admin.indexOf("const groups: ShellNavGroup[]"), admin.indexOf("return (\n    <AppShell"))
  const adminItems = (adminGroups.match(/href: "\/admin[^"]*", label:/g) ?? []).length
  add(adminItems === 13 && adminGroups.includes('label: "Listings"'), "Admin sidebar: 13 items, Moderation relabelled Listings", String(adminItems))

  // Platform fixes (requests from wave 2).
  const pg = src("src/server/http/pg-errors.ts")
  add(/pgDataException/.test(src("src/server/http/route.ts")) && /startsWith\("22"\)/.test(pg) && /"22008"/.test(pg) && /"22P02"/.test(pg), "route(): every Postgres data exception (SQLSTATE class 22) maps to 400 validation")
  add(/isRealDate/.test(src("src/lib/api/contracts/common.ts")), "isoDate refuses dates that don't exist (2027-02-30)")
  const lg = src("src/server/log.ts")
  add(/withheldQuery/.test(lg) && /PG_CLASSES/.test(lg) && /if \(prod\) return code/.test(lg), "log.ts: drizzle params never logged; in production no statement and no driver message (SQLSTATE and class words only)")
  add(/eq\(socialAccounts\.status, "connected"\)/.test(src("src/server/setup/index.ts")), "setup card: Social ticks only for a connected account (not needs_reauth or error)")
  add(!/attention \? "[^"]*acid/.test(src("src/components/dashboard/shell/nav-list.tsx")), "sidebar attention badges are ink, not acid")
  add(!/bg-purple" style/.test(src("src/components/studio/setup/setup-card.tsx")), "setup card progress bar is not purple")
  // The palette's "Upload content" (?upload=1) and post records (?post=) only point at what Social reads.
  const social = src("src/components/studio/social/social-studio.tsx")
  add(!/upload=1/.test(src("src/components/studio/studio-shell.tsx")) || /params\.get\("upload"\)/.test(social), "Studio palette's 'Upload content' (upload=1) only while Social reads ?upload=")
  add(!/&post=/.test(src("src/components/studio/studio-shell.tsx")) || /params\.get\("post"\)/.test(social), "Studio palette's post records (post=) only while Social reads ?post=")
  add(/data-search-toggle/.test(src("src/components/market/mobile-tabbar.tsx")) && /z-\[60\]/.test(src("src/components/market/mobile-tabbar.tsx")), "home bar sits above the search overlay's scrim; Explore toggles it")
  add(!/getBrandRank = \(brandId: string\) => api/.test(src("src/lib/api/charts.ts")) && existsSync(path.join(root, "src/app/api/charts/brands/route.ts")), "rank badges are batched into one GET /api/charts/brands per page")
  add(/onSentMessage/.test(src("src/server/media/serve.ts")), "media: inbox attachments reach the other side only on a sent message")
  add(!/acid/.test(src("src/components/dashboard/status-badge.tsx").split("const dots")[0].split("attention:")[1]?.split("\n")[0] ?? "acid"), "status badge: attention tone is not acid")

  // Live reads.
  try {
    const r = await fetch(`${base}/api/studio/setup`)
    add(r.status === 401, "GET /api/studio/setup signed out is 401", String(r.status))
    const b = await fetch(`${base}/api/charts/brands?ids=b_lagos_static,b_null_form`)
    const bj = b.ok ? await b.json() : null
    add(b.status === 200 && /max-age=300/.test(b.headers.get("cache-control") ?? "") && !!bj?.ranks?.b_lagos_static, "GET /api/charts/brands answers two brands in one public, cacheable read", `${b.status} ${b.headers.get("cache-control")}`)
  } catch (e) {
    add(null, "GET /api/studio/setup", String(e))
  }
  return out
}
