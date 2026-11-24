import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { after, before, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { decodeWelcomeBrands, encodeWelcomeBrands, isTestAccount, WELCOME_TEMPLATE, welcomeCopy, welcomeDedupeKey, welcomeSkipReason, type WelcomeCandidate } from "../../lib/welcome-email"
import { brandMembers, brands } from "../db/schema/brands"
import { emailOutbox } from "../db/schema/engagement"
import { adminMembers, users } from "../db/schema/people"
import { pickWelcomeBrands, queueWelcome, type Db, type Enqueue } from "./welcome-db"

/*
 * The shopper welcome email (src/lib/welcome-email.ts, src/server/email/welcome-db.ts, the
 * `shopper_welcome` template). Database steps run on a real in-memory database with every
 * migration applied. The real template and the real /brands visibility rule live in "server-only"
 * modules, so those checks run in a child process under the react-server condition (this same
 * file, with WELCOME_CHILD set), the way `next` loads them.
 */

const SELF = fileURLToPath(import.meta.url)
const CHILD = process.env.WELCOME_CHILD

/** Runs this file in a child under react-server and returns what it printed (JSON). */
function child(mode: string): unknown {
  const out = execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", SELF], {
    env: { ...process.env, WELCOME_CHILD: mode, NODE_ENV: "test", NODE_TEST_CONTEXT: "" },
    encoding: "utf8",
    timeout: 120_000,
  })
  const line = out.trim().split("\n").filter((l) => l.startsWith("{")).pop()
  assert.ok(line, `child ${mode} printed no result:\n${out}`)
  return JSON.parse(line!)
}

async function freshDb() {
  const pg = new PGlite()
  const d = drizzle(pg)
  await migrate(d, { migrationsFolder: "drizzle" })
  return { pg, d }
}

let seq = 0
async function brand(d: ReturnType<typeof drizzle>, key: string, over: Partial<typeof brands.$inferInsert> = {}) {
  await d.insert(brands).values({ id: `b_w_${key}`, handle: `${key}-brand`, name: `${key} Brand`, city: "Accra", citySlug: "accra", country: "GH", currency: "GHS", categories: ["home"], followersBase: 0, timeZone: "Africa/Accra", reviewStatus: "verified", verified: true, joinedAt: `2026-0${1 + (seq++ % 9)}-01`, ...over })
}

if (!CHILD) {
  describe("who gets the welcome (welcomeSkipReason)", () => {
    const base: WelcomeCandidate = { id: "u_real", kind: "shopper", email: "mira@gmail.com", status: "active", demo: false, welcomeEmailAt: null, brandMember: false, admin: false }
    it("a new, real shopper gets it", () => assert.equal(welcomeSkipReason(base), null))
    it("never twice", () => assert.equal(welcomeSkipReason({ ...base, welcomeEmailAt: new Date() }), "already_sent"))
    it("not brand or team accounts", () => {
      assert.equal(welcomeSkipReason({ ...base, kind: "brand_staff" }), "brand_account")
      assert.equal(welcomeSkipReason({ ...base, brandMember: true }), "brand_account")
    })
    it("not admins", () => {
      assert.equal(welcomeSkipReason({ ...base, kind: "admin" }), "admin")
      assert.equal(welcomeSkipReason({ ...base, admin: true }), "admin")
    })
    it("not demo, sample or test accounts", () => {
      assert.equal(welcomeSkipReason({ ...base, demo: true }), "demo")
      assert.equal(welcomeSkipReason({ ...base, id: "u_t_a" }), "test")
      for (const email of ["x@example.com", "x@example.org", "t-a@example.test", "x@shop.test", "x@foo.invalid", "x@localhost"]) assert.equal(welcomeSkipReason({ ...base, email }), "test", email)
      assert.equal(isTestAccount({ id: "u_1", email: "someone@examples.com" }), false)
    })
    it("not suspended accounts", () => assert.equal(welcomeSkipReason({ ...base, status: "suspended" }), "not_active"))
  })

  describe("the words (welcomeCopy)", () => {
    const four = [1, 2, 3, 4, 5].map((i) => ({ name: `Brand ${i}`, handle: `brand-${i}` }))
    it("subject, heading, buttons and the one-time why", () => {
      const c = welcomeCopy({ name: "Mira Okafor", brands: [] })
      assert.equal(c.subject, "You're in. Welcome to Yard 👋")
      assert.equal(c.greeting, "Hey Mira,")
      assert.deepEqual(c.action, { label: "Start shopping", url: "/shop" })
      assert.deepEqual(c.secondary, { label: "Find brands to follow", url: "/brands" })
      assert.match(c.paragraphs.join(" "), /follow a brand/i)
      assert.doesNotMatch(JSON.stringify(c), /Lagos|Nigeria|fashion/i)
    })
    it("no name, no bare greeting", () => assert.equal(welcomeCopy({ brands: [] }).greeting, undefined))
    it("0 or 1 brand: no list; 4 or more: at most 4, each linking to its page", () => {
      assert.deepEqual(welcomeCopy({ brands: [] }).blocks, [])
      assert.deepEqual(welcomeCopy({ brands: four.slice(0, 1) }).blocks, [])
      const ul = welcomeCopy({ brands: four }).blocks.find((b) => b.kind === "ul")
      assert.ok(ul && ul.kind === "ul")
      assert.equal(ul.items.length, 4)
      assert.deepEqual(ul.items[0], [{ text: "Brand 1", href: "/brands/brand-1", bold: true }])
    })
    it("the brands var survives the outbox and drops anything malformed", () => {
      assert.deepEqual(decodeWelcomeBrands(encodeWelcomeBrands(four)), four.slice(0, 4))
      assert.deepEqual(decodeWelcomeBrands("not json"), [])
      assert.deepEqual(decodeWelcomeBrands(JSON.stringify([{ name: "Evil", handle: "../../x" }, { name: "", handle: "a" }, { name: "Ok", handle: "ok" }])), [{ name: "Ok", handle: "ok" }])
      assert.deepEqual(decodeWelcomeBrands(undefined), [])
    })
  })

  describe("queueing it once (queueWelcome)", () => {
    let pg: PGlite
    let d: ReturnType<typeof drizzle>
    const db = () => d as unknown as Db
    /** The outbox contract (src/server/email enqueueEmail): one row per dedupe key, a repeat is a no-op. */
    const enqueue = (ex: Db): Enqueue => async (input) => {
      await ex
        .insert(emailOutbox)
        .values({ id: `em_${input.dedupeKey}_${Math.random().toString(36).slice(2, 8)}`, template: input.template, category: "account", toEmail: input.to, vars: input.vars, dedupeKey: input.dedupeKey })
        .onConflictDoNothing({ target: emailOutbox.dedupeKey })
    }
    const welcomes = async (userId: string) => (await d.select().from(emailOutbox).where(eq(emailOutbox.dedupeKey, welcomeDedupeKey(userId)))).length
    const user = (id: string, over: Partial<typeof users.$inferInsert> = {}) => d.insert(users).values({ id, kind: "shopper", name: "Mira Okafor", email: `${id}@gmail.com`, demo: false, ...over })
    /** What a flow does: its own transaction, the welcome inside it. */
    const inTx = <T>(fn: (tx: Db) => Promise<T>) => d.transaction((tx) => fn(tx as unknown as Db))

    before(async () => {
      ;({ pg, d } = await freshDb())
    })
    after(async () => {
      await pg.close()
    })

    it("password sign-up: nothing at sign-up, exactly one at verification, none on a second verification", async () => {
      await user("u_pw")
      assert.equal(await welcomes("u_pw"), 0)
      const first = await inTx((tx) => queueWelcome(tx, "u_pw", enqueue(tx)))
      assert.deepEqual(first, { queued: true })
      const again = await inTx((tx) => queueWelcome(tx, "u_pw", enqueue(tx)))
      assert.deepEqual(again, { queued: false, reason: "already_sent" })
      assert.equal(await welcomes("u_pw"), 1)
      const [row] = await d.select().from(emailOutbox).where(eq(emailOutbox.dedupeKey, welcomeDedupeKey("u_pw")))
      assert.equal(row.template, WELCOME_TEMPLATE)
      assert.equal(row.toEmail, "u_pw@gmail.com")
      assert.deepEqual(row.vars, { name: "Mira Okafor" })
      const [u] = await d.select({ at: users.welcomeEmailAt }).from(users).where(eq(users.id, "u_pw"))
      assert.ok(u.at instanceof Date)
    })

    it("OAuth sign-up: one welcome when the account is created, none on the next sign-ins", async () => {
      await inTx(async (tx) => {
        await tx.insert(users).values({ id: "u_google", kind: "shopper", name: "Kemi", email: "kemi@gmail.com", demo: false })
        return queueWelcome(tx, "u_google", enqueue(tx))
      })
      for (let i = 0; i < 3; i++) await inTx((tx) => queueWelcome(tx, "u_google", enqueue(tx)))
      assert.equal(await welcomes("u_google"), 1)
    })

    it("a crash before commit sends nothing and leaves no marker; the retry sends exactly one", async () => {
      await user("u_crash")
      await assert.rejects(
        inTx(async (tx) => {
          await queueWelcome(tx, "u_crash", enqueue(tx))
          throw new Error("crash after queueing")
        }),
        /crash/,
      )
      assert.equal(await welcomes("u_crash"), 0)
      const [u] = await d.select({ at: users.welcomeEmailAt }).from(users).where(eq(users.id, "u_crash"))
      assert.equal(u.at, null)
      await inTx((tx) => queueWelcome(tx, "u_crash", enqueue(tx)))
      await inTx((tx) => queueWelcome(tx, "u_crash", enqueue(tx)))
      assert.equal(await welcomes("u_crash"), 1)
    })

    it("a retried outbox write with the same key adds nothing (dedupe key backs up the marker)", async () => {
      await user("u_dup")
      await inTx((tx) => queueWelcome(tx, "u_dup", enqueue(tx)))
      await d.update(users).set({ welcomeEmailAt: null }).where(eq(users.id, "u_dup"))
      await inTx((tx) => queueWelcome(tx, "u_dup", enqueue(tx)))
      assert.equal(await welcomes("u_dup"), 1)
    })

    it("not to brand, team, admin, demo or test accounts", async () => {
      await user("u_staff", { kind: "brand_staff" })
      await user("u_member")
      await brand(d, "team")
      await d.insert(brandMembers).values({ id: "bm_w_member", brandId: "b_w_team", userId: "u_member", role: "owner" })
      await user("u_adminkind", { kind: "admin" })
      await user("u_adm")
      await d.insert(adminMembers).values({ userId: "u_adm", role: "support" })
      await user("u_demo", { demo: true })
      await user("u_t_kit")
      await user("u_testmail", { email: "t-x@example.test" })
      const expect: Record<string, string> = { u_staff: "brand_account", u_member: "brand_account", u_adminkind: "admin", u_adm: "admin", u_demo: "demo", u_t_kit: "test", u_testmail: "test" }
      for (const [id, reason] of Object.entries(expect)) {
        assert.deepEqual(await inTx((tx) => queueWelcome(tx, id, enqueue(tx))), { queued: false, reason }, id)
        assert.equal(await welcomes(id), 0, id)
      }
      assert.deepEqual(await queueWelcome(db(), "u_nobody", enqueue(db())), { queued: false, reason: "no_user" })
    })

    it("brands to follow: at most 4, verified first", async () => {
      const { pg: pg2, d: d2 } = await freshDb()
      for (const k of ["a", "b", "c"]) await brand(d2, k, { verified: false })
      for (const k of ["v1", "v2"]) await brand(d2, k)
      const picked = await pickWelcomeBrands(d2 as unknown as Db, sql`true`)
      assert.equal(picked.length, 4)
      assert.deepEqual(picked.slice(0, 2).map((b) => b.handle).sort(), ["v1-brand", "v2-brand"])
      assert.equal((await pickWelcomeBrands(d2 as unknown as Db, sql`true`, 1)).length, 1)
      await pg2.close()
    })
  })

  describe("with the real template and the real /brands rule (react-server child)", () => {
    it("renders with 0, 1 and 4 brands", () => {
      const r = child("render") as Record<string, { subject: string; html: string; text: string }>
      for (const n of ["0", "1", "4"]) {
        assert.equal(r[n].subject, "You're in. Welcome to Yard 👋")
        assert.match(r[n].html, /href="http:\/\/localhost:3000\/shop"/)
        assert.match(r[n].html, /href="http:\/\/localhost:3000\/brands"[^>]*>Find brands to follow</)
        assert.match(r[n].text, /Start shopping: http:\/\/localhost:3000\/shop/)
        assert.doesNotMatch(r[n].text, /Unsubscribe/)
      }
      assert.doesNotMatch(r["0"].html, /A few brands to follow/)
      assert.doesNotMatch(r["1"].html, /A few brands to follow|\/brands\/one-brand/)
      assert.match(r["4"].html, /A few brands to follow/)
      assert.equal((r["4"].html.match(/href="http:\/\/localhost:3000\/brands\/b\d-brand"/g) ?? []).length, 4)
      assert.doesNotMatch(r["4"].html, /b5-brand/)
    })

    it("brand list respects /brands visibility: not restricted, suspended, closed or unlaunched founding", () => {
      const handles = child("visibility") as { handles: string[] }
      assert.deepEqual([...handles.handles].sort(), ["founding-live-brand", "listed-brand", "pending-brand"])
    })
  })
} else {
  // Child: the "server-only" modules, loaded under react-server like the app loads them.
  const run = async () => {
    if (CHILD === "render") {
      const { renderEmail } = await import("./templates")
      const brandsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ name: n === 1 ? "One" : `B${i + 1}`, handle: n === 1 ? "one-brand" : `b${i + 1}-brand` }))
      const out: Record<string, unknown> = {}
      for (const n of [0, 1, 4]) out[n] = renderEmail("shopper_welcome", { name: "Mira Okafor", brands: encodeWelcomeBrands(brandsOf(n === 4 ? 5 : n)) }, { unsubscribeUrl: null })
      return out
    }
    if (CHILD === "visibility") {
      const { brandListedSql } = await import("../catalog/sellable")
      const { pg, d } = await freshDb()
      await brand(d, "listed")
      await brand(d, "pending", { reviewStatus: "pending_review", verified: false })
      await brand(d, "restricted", { reviewStatus: "restricted" })
      await brand(d, "suspended", { reviewStatus: "suspended" })
      await brand(d, "closed", { reviewStatus: "suspended", closedAt: new Date() })
      await brand(d, "founding-unlaunched", { founding: true, claimStatus: "unclaimed", launchedAt: null })
      await brand(d, "founding-live", { founding: true, claimStatus: "unclaimed", launchedAt: new Date() })
      const picked = await pickWelcomeBrands(d as unknown as Db, brandListedSql())
      await pg.close()
      return { handles: picked.map((b) => b.handle) }
    }
    throw new Error(`unknown child mode ${CHILD}`)
  }
  run().then(
    (r) => process.stdout.write(`${JSON.stringify(r)}\n`),
    (e) => {
      process.stderr.write(String(e?.stack ?? e))
      process.exit(1)
    },
  )
}
