import "server-only"
import { createHash, randomBytes } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { z } from "zod"
import { log } from "./log"
import { yard } from "./state"

/**
 * Server configuration, parsed lazily on first call (§1.2). Nothing parses at import time, so
 * `next build` (which loads every route module with NODE_ENV=production) never throws. Callers:
 * getDb(), the route wrapper, the scheduler runner and instrumentation.
 */
export type Env = {
  nodeEnv: "development" | "production" | "test"
  /** Anything but production. */
  dev: boolean
  /** The data directory (outside the repo by default, mode 0700). */
  dataDir: string
  /** ${dataDir}/${NODE_ENV}: pg/, uploads/ and (development) secrets.json live here. */
  envDir: string
  publicUrl: string
  publicOrigin: string
  /** https:// public URL: Secure cookies with the __Host- prefix. */
  cookieSecure: boolean
  sessionSecret: Buffer
  encryptionKey: Buffer
  encryptionKeyPrevious: Buffer | null
  demoAuth: { shopper: boolean; brand: boolean; admin: boolean; production: boolean }
  /** Sample accounts and marketplace fixtures are seeded only in dev/test or an explicit demo deployment. */
  seedDemo: boolean
  trustedProxyHops: number
  sandboxEnabled: boolean
  resetDb: boolean
  instagram: { appId: string | null; appSecret: string | null; graphVersion: string; configured: boolean }
  tiktok: { clientKey: string | null; clientSecret: string | null; usePkce: boolean; configured: boolean }
  mapStyleUrl: string
}

const raw = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).catch("development"),
  NEXT_PHASE: z.string().optional(),
  YARD_DATA_DIR: z.string().optional(),
  YARD_PUBLIC_URL: z.string().optional(),
  YARD_SESSION_SECRET: z.string().optional(),
  YARD_ENCRYPTION_KEY: z.string().optional(),
  YARD_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  YARD_DEMO_AUTH: z.string().optional(),
  YARD_DEMO_ADMIN: z.string().optional(),
  YARD_SEED_DEMO: z.string().optional(),
  YARD_TRUSTED_PROXY_HOPS: z.string().optional(),
  YARD_SOCIAL_SANDBOX: z.string().optional(),
  YARD_RESET_DB: z.string().optional(),
  NEXT_PUBLIC_MAP_STYLE_URL: z.string().optional(),
  INSTAGRAM_APP_ID: z.string().optional(),
  INSTAGRAM_APP_SECRET: z.string().optional(),
  INSTAGRAM_GRAPH_VERSION: z.string().optional(),
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  TIKTOK_USE_PKCE: z.string().optional(),
})

const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined)
const on = (v: string | undefined) => blank(v) === "1"

/** `~/.yard/<repo folder>-<first 8 hex of sha256(absolute repo path)>` (§1.1). */
export function defaultDataDir(repoRoot = process.cwd()) {
  // Runtime-only paths: keep Turbopack from tracing the whole project for them.
  const abs = path.resolve(/*turbopackIgnore: true*/ repoRoot)
  const hash = createHash("sha256").update(abs).digest("hex").slice(0, 8)
  return path.join(homedir(), ".yard", `${path.basename(abs)}-${hash}`)
}

export const isBuildPhase = () => process.env.NEXT_PHASE === "phase-production-build"

function decode(value: string) {
  // Node's base64 decoder accepts both the standard and the URL-safe alphabet.
  return Buffer.from(value, "base64")
}

/** Development secrets: generated once into ${envDir}/secrets.json (mode 0600) and reused. */
function devSecrets(envDir: string): { session: string; encryption: string } {
  const file = path.join(envDir, "secrets.json")
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { YARD_SESSION_SECRET?: string; YARD_ENCRYPTION_KEY?: string }
      if (parsed.YARD_SESSION_SECRET && parsed.YARD_ENCRYPTION_KEY) return { session: parsed.YARD_SESSION_SECRET, encryption: parsed.YARD_ENCRYPTION_KEY }
    } catch {
      log.warn(`[yard] ${file} is unreadable; generating new development secrets (existing sessions end).`)
    }
  }
  const secrets = { YARD_SESSION_SECRET: randomBytes(32).toString("base64url"), YARD_ENCRYPTION_KEY: randomBytes(32).toString("base64") }
  mkdirSync(envDir, { recursive: true, mode: 0o700 })
  writeFileSync(file, JSON.stringify(secrets, null, 2) + "\n", { mode: 0o600 })
  chmodSync(file, 0o600)
  return { session: secrets.YARD_SESSION_SECRET, encryption: secrets.YARD_ENCRYPTION_KEY }
}

function parse(): Env {
  const e = raw.parse(process.env)
  const nodeEnv = e.NODE_ENV
  const dev = nodeEnv !== "production"
  const building = isBuildPhase()
  const problems: string[] = []
  const seedDemo = dev || on(e.YARD_SEED_DEMO)
  if (!dev && on(e.YARD_DEMO_AUTH) && !seedDemo) problems.push("YARD_DEMO_AUTH=1 requires YARD_SEED_DEMO=1 so demo accounts and fixtures exist")
  if (!dev && on(e.YARD_SEED_DEMO) && !on(e.YARD_DEMO_AUTH)) problems.push("YARD_SEED_DEMO=1 requires YARD_DEMO_AUTH=1; do not seed demo data into a production environment")

  const dataDir = path.resolve(/*turbopackIgnore: true*/ blank(e.YARD_DATA_DIR) ?? defaultDataDir())
  const envDir = path.join(dataDir, nodeEnv)

  const publicUrl = (blank(e.YARD_PUBLIC_URL) ?? "http://localhost:3000").replace(/\/+$/, "")
  let publicOrigin = publicUrl
  try {
    publicOrigin = new URL(publicUrl).origin
  } catch {
    problems.push("YARD_PUBLIC_URL is not a URL")
  }
  const cookieSecure = publicUrl.startsWith("https://")
  if (!dev && !cookieSecure && !building) log.once("env:http", "warn", `[yard] YARD_PUBLIC_URL is ${publicUrl}: production cookies are not Secure over http://.`)

  // Secrets. Development falls back to secrets.json; production must provide both (except at build).
  let sessionRaw = blank(e.YARD_SESSION_SECRET)
  let encryptionRaw = blank(e.YARD_ENCRYPTION_KEY)
  if (!sessionRaw || !encryptionRaw) {
    if (dev) {
      const s = devSecrets(envDir)
      sessionRaw ??= s.session
      encryptionRaw ??= s.encryption
    } else if (building) {
      // Never used: nothing touches sessions or the vault during next build.
      sessionRaw ??= randomBytes(32).toString("base64url")
      encryptionRaw ??= randomBytes(32).toString("base64")
    } else {
      throw new Error("[yard] YARD_SESSION_SECRET and YARD_ENCRYPTION_KEY are required in production (see .env.example). `npm run start:demo` generates them for a local demo.")
    }
  }
  let sessionSecret = decode(sessionRaw)
  let encryptionKey = decode(encryptionRaw)
  if (sessionSecret.length < 32) problems.push("YARD_SESSION_SECRET must decode to at least 32 bytes")
  if (encryptionKey.length !== 32) problems.push("YARD_ENCRYPTION_KEY must decode to exactly 32 bytes")
  const prevRaw = blank(e.YARD_ENCRYPTION_KEY_PREVIOUS)
  let encryptionKeyPrevious = prevRaw ? decode(prevRaw) : null
  if (encryptionKeyPrevious && encryptionKeyPrevious.length !== 32) {
    problems.push("YARD_ENCRYPTION_KEY_PREVIOUS must decode to exactly 32 bytes")
    encryptionKeyPrevious = null
  }

  const hopsRaw = blank(e.YARD_TRUSTED_PROXY_HOPS) ?? "0"
  let trustedProxyHops = Number(hopsRaw)
  if (!Number.isInteger(trustedProxyHops) || trustedProxyHops < 0 || trustedProxyHops > 5) {
    problems.push("YARD_TRUSTED_PROXY_HOPS must be an integer from 0 to 5")
    trustedProxyHops = 0
  }

  // Provider secrets shorter than 16 characters count as not configured (§1.2, §6.1).
  const providerSecret = (name: string, v: string | undefined) => {
    const s = blank(v)
    if (s && s.length < 16) {
      log.once(`env:${name}`, "warn", `[yard] ${name} is shorter than 16 characters; treating it as not configured.`)
      return null
    }
    return s ?? null
  }
  const igId = blank(e.INSTAGRAM_APP_ID) ?? null
  const igSecret = providerSecret("INSTAGRAM_APP_SECRET", e.INSTAGRAM_APP_SECRET)
  const ttKey = blank(e.TIKTOK_CLIENT_KEY) ?? null
  const ttSecret = providerSecret("TIKTOK_CLIENT_SECRET", e.TIKTOK_CLIENT_SECRET)

  if (problems.length) {
    const msg = `[yard] Invalid configuration: ${problems.join("; ")}.`
    if (!dev && !building) throw new Error(msg)
    log.once("env:problems", "error", msg)
    // Development keeps working on generated secrets rather than refusing to start.
    if (dev && (sessionSecret.length < 32 || encryptionKey.length !== 32)) {
      const s = devSecrets(envDir)
      if (sessionSecret.length < 32) sessionSecret = decode(s.session)
      if (encryptionKey.length !== 32) encryptionKey = decode(s.encryption)
    }
  }

  const demoAuth = {
    shopper: dev || on(e.YARD_DEMO_AUTH),
    brand: dev || on(e.YARD_DEMO_AUTH),
    admin: dev || (on(e.YARD_DEMO_AUTH) && on(e.YARD_DEMO_ADMIN)),
    production: !dev,
  }

  return {
    nodeEnv,
    dev,
    dataDir,
    envDir,
    publicUrl,
    publicOrigin,
    cookieSecure,
    sessionSecret,
    encryptionKey,
    encryptionKeyPrevious,
    demoAuth,
    seedDemo,
    trustedProxyHops,
    sandboxEnabled: dev && blank(e.YARD_SOCIAL_SANDBOX) !== "0",
    resetDb: dev && on(e.YARD_RESET_DB),
    instagram: { appId: igId, appSecret: igSecret, graphVersion: blank(e.INSTAGRAM_GRAPH_VERSION) ?? "v23.0", configured: !!(igId && igSecret) },
    tiktok: { clientKey: ttKey, clientSecret: ttSecret, usePkce: blank(e.TIKTOK_USE_PKCE) !== "0", configured: !!(ttKey && ttSecret) },
    mapStyleUrl: blank(e.NEXT_PUBLIC_MAP_STYLE_URL) ?? "https://tiles.openfreemap.org/styles/dark",
  }
}

/** The parsed configuration, memoised on globalThis. */
export function getEnv(): Env {
  return (yard.env ??= parse()) as Env
}

/** The one-line production warning when any demo sign-in flag is on (§1.2). Null otherwise. */
export function demoAuthWarning(env = getEnv()) {
  if (env.dev) return null
  const on = (["shopper", "brand", "admin"] as const).filter((k) => env.demoAuth[k])
  if (!on.length) return null
  return `[yard] Demo sign-in is ON in production (${on.join(", ")}). Anyone can sign in without a password.`
}
