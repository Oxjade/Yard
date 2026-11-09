#!/usr/bin/env node
// npm run admin:create -- --email you@example.com --name "Your Name" [--role owner] [--print-link]
//
// One-off bootstrap of the FIRST real owner admin on a deployment (seeded admins are demo
// accounts and never get a password). It opens the database through the server's own modules
// and calls createAdminAccount(null, …) from src/server/auth/admins.ts: a users row (kind admin,
// demo = false), an admin_members row and a 72-hour "set your password" link. The new owner sets
// a password, signs in at /admin and enrols two-step verification at that first sign-in. Every
// later admin is added by an owner from the Control Center (POST /api/auth/admins).
//
// Safety:
//  - Refuses once any real (non-demo) active owner admin exists: bootstrap is one time only.
//  - Only the owner role is accepted (the first admin must be able to add the others).
//  - PGlite allows one process per data directory: stop the server first. The script refuses
//    while a server holds the lock, so it can never run beside one.
//  - Run it with the SAME environment as the server (NODE_ENV, YARD_DATA_DIR, YARD_PUBLIC_URL,
//    YARD_SESSION_SECRET, YARD_ENCRYPTION_KEY, EMAIL_*). Like `next start`, it reads
//    .env.production.local, .env.local, .env.production and .env; variables already set win.
//    NODE_ENV defaults to production.
//  - No background jobs run here. The set-password email is queued and the server's email worker
//    sends it after the next start. Without a configured email provider (or with --print-link)
//    the link is printed here instead: hand it to the new owner privately.
//
// The package.json entry runs this file with `node --conditions=react-server --import tsx` so the
// TypeScript server modules (and their `server-only` marker) load outside Next. tsx is a regular
// dependency (not a dev one) so this works on a production install (`npm ci --omit=dev`).
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { parseArgs, parseEnv } from "node:util"

const usage = 'Usage: npm run admin:create -- --email you@example.com --name "Your Name" [--role owner] [--print-link]'

let args
try {
  args = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string", default: "owner" },
      "print-link": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  }).values
} catch (e) {
  console.error(`${e.message}\n${usage}`)
  process.exit(2)
}
if (args.help) {
  console.log(usage)
  process.exit(0)
}
const email = (args.email ?? "").trim()
const name = (args.name ?? "").trim()
if (!email || !name) {
  console.error(`--email and --name are required.\n${usage}`)
  process.exit(2)
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(`"${email}" isn't an email address.`)
  process.exit(2)
}
if (name.length > 80) {
  console.error("--name must be 80 characters or fewer.")
  process.exit(2)
}
if (args.role !== "owner") {
  console.error(`Only --role owner can be bootstrapped (got "${args.role}"). An owner adds every other admin from the Control Center.`)
  process.exit(2)
}

// Environment, the way `next start` sees it.
process.env.NODE_ENV ||= "production"
const nodeEnv = process.env.NODE_ENV
for (const file of [`.env.${nodeEnv}.local`, nodeEnv === "test" ? null : ".env.local", `.env.${nodeEnv}`, ".env"]) {
  if (!file) continue
  const p = path.join(process.cwd(), file)
  if (!existsSync(p)) continue
  for (const [k, v] of Object.entries(parseEnv(readFileSync(p, "utf8")))) if (process.env[k] === undefined) process.env[k] = v
}

// No schedulers in this process: the server runs them (src/server/schedulers.ts checks this flag).
globalThis.__yard = { ...(globalThis.__yard ?? {}), schedulers: true }

const fail = (msg, code = 1) => {
  console.error(msg)
  process.exitCode = code
}

let root = null
try {
  const { getDb } = await import("@/server/db/client")
  const { db } = await import("@/server/db")
  const { adminMembers, users } = await import("@/server/db/schema")
  const { and, eq } = await import("drizzle-orm")
  const { createAdminAccount } = await import("@/server/auth/admins")
  const { emailConfigured } = await import("@/server/email")
  const { emailOutbox } = await import("@/server/db/schema/engagement")

  root = await getDb()
  const d = await db()
  const owners = await d
    .select({ id: users.id, email: users.email })
    .from(adminMembers)
    .innerJoin(users, eq(users.id, adminMembers.userId))
    .where(and(eq(adminMembers.role, "owner"), eq(users.demo, false), eq(users.status, "active")))
    .limit(1)
  if (owners.length) {
    fail(`A real owner admin already exists (${owners[0].email}). Bootstrap runs once: add admins from the Control Center (Admin → Team) instead.`)
  } else {
    const { admin } = await createAdminAccount(null, { email, name, role: "owner" }, { ipHash: null, userAgent: null })
    console.log(`Created owner admin ${admin.name} <${admin.email}> (${admin.id}).`)
    const [mail] = await d.select().from(emailOutbox).where(eq(emailOutbox.dedupeKey, `admin-onboard:${admin.id}`)).limit(1)
    const url = typeof mail?.vars?.url === "string" ? mail.vars.url : null
    const live = emailConfigured()
    if (live) console.log("The set-password email is queued; the server's email worker sends it within a minute of the next start.")
    if (url && (!live || args["print-link"])) {
      if (!live) console.log("No email provider is configured (EMAIL_PROVIDER, EMAIL_API_KEY, EMAIL_FROM), so no email will be sent.")
      console.log(`Set-password link (valid 72 hours, single use; share it privately):\n\n  ${url}\n`)
    } else if (!url) {
      console.log("The set-password link couldn't be read back; use 'Forgot password' on the sign-in page with this email.")
    }
    console.log("Then sign in at /admin with this email and the new password, and enrol two-step verification.")
  }
} catch (e) {
  const fields = e && typeof e === "object" && e.fields ? ` ${Object.values(e.fields).join(" ")}` : ""
  fail(`Couldn't create the admin: ${e instanceof Error ? e.message : String(e)}${fields}`)
} finally {
  try {
    await root?.$client.close()
  } catch {
    /* closing is best effort; the lock is released on exit */
  }
}
process.exit(process.exitCode ?? 0)
