import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { after, before, beforeEach, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { payoutNeededCopy } from "../../lib/brand-emails"
import { adminPayoutAccountsQuery } from "../../lib/api/contracts/admin-payout-accounts"
import { formatOwed, owedList, payoutNeededBanner, payoutNeededDedupeKey, payoutReminderDue } from "../../lib/payout-needed"
import { listPayoutAccountsDb } from "../admin/payout-accounts-db"
import { brandMembers, brands } from "../db/schema/brands"
import { emailOutbox } from "../db/schema/engagement"
import { brandPayoutAccounts, ledgerAccounts, ledgerOrderMoney } from "../db/schema/ledger"
import { users } from "../db/schema/people"
import { notePaidSales, sendPayoutReminders, type Db, type Enqueue } from "./payout-needed-db"

/*
 * "Add your payout account" (docs/BRAND-EMAILS.md › Payout account needed): the rules and copy
 * (pure), the paid-order email, the 24-hour dedupe, the one reminder and the stop once an account
 * is saved, on a real in-memory database with every migration applied (payout-needed-db.ts), plus
 * Admin's "Owed, no account" and the Studio banner's data. The real template lives in a
 * "server-only" module, so its render runs in a child under the react-server condition.
 */

const SELF = fileURLToPath(import.meta.url)
const CHILD = process.env.PAYOUT_NEEDED_CHILD

const HOUR = 3600_000
const T0 = new Date("2026-11-20T10:00:00Z")
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR)

if (!CHILD) {
  describe("the rules and the banner data (src/lib/payout-needed.ts)", () => {
    const bal = (currency: string, pendingMinor: number, availableMinor = 0, reserveMinor = 0, inPayoutMinor = 0) => ({ currency, pendingMinor, availableMinor, reserveMinor, inPayoutMinor })
    it("owed is pending + available + reserve + in payout, the brand's currency first, nothing owed left out", () => {
      assert.deepEqual(owedList([bal("USD", 2000), bal("NGN", 4_000_000, 500_000, 300_000), bal("GHS", 0)], "NGN"), [
        { currency: "NGN", minor: 4_800_000 },
        { currency: "USD", minor: 2000 },
      ])
      assert.equal(formatOwed([{ currency: "NGN", minor: 4_800_000 }]), "₦48,000")
    })
    it("the banner shows earnings waiting when there's no payout account, with the button for the owner", () => {
      const b = payoutNeededBanner({ currency: "NGN", balances: [bal("NGN", 4_500_000)], account: null }, "owner")
      assert.ok(b)
      assert.equal(b.title, "You have ₦45,000 waiting. Add your payout account to get paid.")
      assert.deepEqual(b.action, { label: "Add payout account", href: "/studio/settings#payouts" })
    })
    it("finance and admins see it too, told to ask the owner (only the owner can add the account)", () => {
      const b = payoutNeededBanner({ currency: "NGN", balances: [bal("NGN", 4_500_000)], account: null }, "finance")
      assert.equal(b?.action, null)
      assert.match(b!.body, /Only the brand owner/)
    })
    it("no banner with an account, with nothing owed, or before the summary loads", () => {
      assert.equal(payoutNeededBanner({ currency: "NGN", balances: [bal("NGN", 4_500_000)], account: { bankName: "GTBank" } }, "owner"), null)
      assert.equal(payoutNeededBanner({ currency: "NGN", balances: [bal("NGN", 0)], account: null }, "owner"), null)
      assert.equal(payoutNeededBanner(undefined, "owner"), null)
    })
    it("the reminder is due 3 days after the first sale, once, outside the 24-hour window, never with an account", () => {
      const base = { since: T0, remindedAt: null, emailedAt: T0, hasAccount: false }
      assert.equal(payoutReminderDue(base, at(71)), false)
      assert.equal(payoutReminderDue(base, at(72)), true)
      assert.equal(payoutReminderDue({ ...base, emailedAt: at(60) }, at(72)), false)
      assert.equal(payoutReminderDue({ ...base, remindedAt: at(72) }, at(100)), false)
      assert.equal(payoutReminderDue({ ...base, hasAccount: true }, at(100)), false)
    })
    it("the outbox key is per brand per UTC day; the reminder's is per brand", () => {
      assert.equal(payoutNeededDedupeKey("b_1", at(13)), "payout_needed:b_1:2026-11-20")
      assert.equal(payoutNeededDedupeKey("b_1", at(14)), "payout_needed:b_1:2026-11-21")
      assert.equal(payoutNeededDedupeKey("b_1", at(14), "reminder"), "payout_needed:reminder:b_1")
    })
  })

  describe("the words (payoutNeededCopy)", () => {
    it("on a sale: the order, what they've earned, that Yard holds it, the button", () => {
      const c = payoutNeededCopy({ brand: "Lagos Static", owed: "₦84,550", sales: 3, reference: "YRD-48213-1", variant: "sale" })
      assert.equal(c.subject, "You made a sale 🎉 Add your payout account so we can pay you")
      assert.equal(c.heading, "You made a sale 🎉")
      assert.equal(c.greeting, "Hey Lagos Static,")
      const body = c.paragraphs.join(" ")
      assert.match(body, /Order YRD-48213-1 just got paid, and that makes 3 sales waiting for you/)
      assert.match(body, /You've earned ₦84,550 so far/)
      assert.match(body, /Yard holds your earnings safely until you add a bank account/)
      assert.deepEqual(c.action, { label: "Add payout account", url: "/studio/settings#payouts" })
      assert.deepEqual(c.facts, [
        { label: "Order", value: "YRD-48213-1" },
        { label: "Earned so far", value: "₦84,550" },
        { label: "Sales waiting", value: "3" },
      ])
      assert.match(c.why, /at most once a day/)
    })
    it("one sale reads naturally", () => {
      const c = payoutNeededCopy({ brand: "B", owed: "₦9,000", sales: 1, reference: "YRD-1-1", variant: "sale" })
      assert.equal(c.paragraphs[0], "Order YRD-1-1 just got paid. Nice one.")
    })
    it("the reminder: no order, the sales and the amount", () => {
      const c = payoutNeededCopy({ brand: "B", owed: "₦9,000", sales: 2, variant: "reminder" })
      assert.equal(c.heading, "Your earnings are waiting 💸")
      assert.match(c.paragraphs[0], /You've made 2 sales on Yard and earned ₦9,000 so far/)
      assert.ok(!c.facts?.some((f) => f.label === "Order"))
      assert.equal(c.action?.url, "/studio/settings#payouts")
    })
  })

  describe("the emails on a real database (payout-needed-db.ts)", () => {
    let pg: PGlite
    let d: ReturnType<typeof drizzle>
    const db = () => d as unknown as Db
    const enqueue: Enqueue = async (ex, input) => {
      await ex.insert(emailOutbox).values({ id: `em_${Math.random().toString(36).slice(2)}`, template: input.template, category: "payouts", toEmail: input.to, vars: input.vars, dedupeKey: input.dedupeKey }).onConflictDoNothing({ target: emailOutbox.dedupeKey })
    }
    const inTx = <T>(fn: (tx: Db) => Promise<T>) => d.transaction((tx) => fn(tx as unknown as Db))
    const outbox = async () => d.select().from(emailOutbox).orderBy(emailOutbox.createdAt, emailOutbox.toEmail)
    let orderSeq = 0

    async function brand(key: string) {
      const id = `b_${key}`
      await d.insert(brands).values({ id, handle: key, name: `${key} Label`, city: "Lagos", citySlug: "lagos", country: "NG", currency: "NGN", categories: ["streetwear"], followersBase: 0, timeZone: "Africa/Lagos", reviewStatus: "verified", verified: true })
      const member = async (role: string, email: string, status = "active") => {
        const uid = `u_${key}_${role}_${status}`
        await d.insert(users).values({ id: uid, kind: "brand_staff", name: `${role} ${key}`, email, demo: false })
        await d.insert(brandMembers).values({ id: `bm_${uid}`, brandId: id, userId: uid, role, status })
      }
      await member("owner", `owner@${key}.shop`)
      await member("finance", `money@${key}.shop`)
      await member("viewer", `viewer@${key}.shop`)
      await member("admin", `admin@${key}.shop`)
      await member("finance", `gone@${key}.shop`, "invited")
      return id
    }
    /** A paid order as the ledger records it: the brand's net into brand_pending, one order-money row. */
    async function sale(brandId: string, netMinor: number, capturedAt: Date) {
      const orderId = `o_${++orderSeq}`
      await d.insert(ledgerOrderMoney).values({ orderId, brandId, currency: "NGN", paymentId: `pay_${orderSeq}`, grossMinor: netMinor, commissionMinor: 0, commissionBps: 0, tier: "new", reserveBps: 0, pendingMinor: netMinor, reserveMinor: 0, capturedAt })
      await d
        .insert(ledgerAccounts)
        .values({ id: `la_${brandId}_pending`, ownerKind: "brand", ownerId: brandId, kind: "brand_pending", currency: "NGN", normal: "credit", balanceMinor: netMinor })
        .onConflictDoUpdate({ target: [ledgerAccounts.ownerKind, ledgerAccounts.ownerId, ledgerAccounts.kind, ledgerAccounts.currency], set: { balanceMinor: sql`${ledgerAccounts.balanceMinor} + ${netMinor}` } })
      return { brandId, reference: `YRD-${1000 + orderSeq}-1` }
    }
    async function addAccount(brandId: string) {
      await d.insert(brandPayoutAccounts).values({ brandId, country: "NG", currency: "NGN", bankCode: "058", bankName: "GTBank", accountName: "LABEL LTD", accountNumberEnc: "v1.sealed.x", accountLast4: "6789", recipientProvider: "stub", updatedBy: "u_x" })
    }
    const paid = (s: { brandId: string; reference: string }, now: Date) => inTx((tx) => notePaidSales(tx, [s], enqueue, { now }))

    before(async () => {
      pg = new PGlite()
      d = drizzle(pg)
      await migrate(d, { migrationsFolder: path.join(process.cwd(), "drizzle") })
    })
    after(async () => {
      await pg?.close()
    })
    beforeEach(async () => {
      await d.execute(sql`truncate email_outbox, brand_payout_accounts, ledger_order_money, ledger_accounts, brand_members, brands, users cascade`)
    })

    it("a paid order for a brand without a payout account queues the email to its owners and finance members", async () => {
      const b = await brand("nopay")
      const s = await sale(b, 4_500_000, T0)
      const r = await paid(s, T0)
      assert.equal(r.length, 1)
      assert.ok("queued" in r[0] && r[0].queued === 2)
      const rows = await outbox()
      assert.deepEqual(rows.map((x) => x.toEmail).sort(), ["money@nopay.shop", "owner@nopay.shop"], "owners and finance; not viewers, admins or invited members")
      assert.equal(rows[0].template, "brand_payout_needed")
      assert.deepEqual(rows[0].vars, { brand: "nopay Label", owed: "₦45,000", sales: 1, variant: "sale", reference: s.reference })
      assert.ok(rows.every((x) => x.dedupeKey.startsWith("payout_needed:b_nopay:2026-11-20:")))
      const [row] = await d.select().from(brands).where(eq(brands.id, b))
      assert.equal(row.payoutNeededSince?.toISOString(), T0.toISOString(), "the reminder clock starts at the first sale")
      assert.equal(row.payoutNeededEmailedAt?.toISOString(), T0.toISOString())
    })

    it("nothing is sent when the brand has a payout account", async () => {
      const b = await brand("haspay")
      await addAccount(b)
      const r = await paid(await sale(b, 4_500_000, T0), T0)
      assert.deepEqual(r, [{ brandId: b, skipped: "has_account" }])
      assert.equal((await outbox()).length, 0)
      const [row] = await d.select().from(brands).where(eq(brands.id, b))
      assert.equal(row.payoutNeededSince, null)
    })

    it("a claimed founding brand without a payout account gets the email and the reminder too (it sells from its claim)", async () => {
      const b = await brand("founder")
      await d.update(brands).set({ founding: true, claimStatus: "claimed", launchedAt: T0 }).where(eq(brands.id, b))
      const r = await paid(await sale(b, 3_000_000, T0), T0)
      assert.ok("queued" in r[0] && r[0].queued === 2)
      assert.deepEqual((await outbox()).map((x) => x.toEmail).sort(), ["money@founder.shop", "owner@founder.shop"])
      await d.delete(emailOutbox)
      const reminded = await sendPayoutReminders(db(), inTx, enqueue, { now: at(72) })
      assert.ok(reminded.length === 1 && "queued" in reminded[0] && reminded[0].variant === "reminder" && reminded[0].queued === 2)
    })

    it("at most one per brand in 24 hours, however many orders; the next one counts every sale waiting", async () => {
      const b = await brand("busy")
      await paid(await sale(b, 1_000_000, T0), T0)
      for (let i = 1; i <= 4; i++) assert.deepEqual(await paid(await sale(b, 1_000_000, at(i * 5)), at(i * 5)), [{ brandId: b, skipped: "cooldown" }])
      assert.equal((await outbox()).length, 2, "one email, to two people")
      // Several brands in one checkout: each brand is judged on its own.
      const other = await brand("other")
      const both = await inTx((tx) => notePaidSales(tx, [{ brandId: b, reference: "YRD-9-1" }, { brandId: other, reference: "YRD-9-2" }], enqueue, { now: at(23) }))
      assert.deepEqual(both.map((o) => ("queued" in o ? "queued" : o.skipped)), ["cooldown", "nothing_owed"])
      // 24 hours after the last email, the next sale emails again.
      const r = await paid(await sale(b, 1_000_000, at(24)), at(24))
      assert.ok("queued" in r[0])
      const rows = (await outbox()).filter((x) => x.toEmail === "owner@busy.shop")
      assert.equal(rows.length, 2)
      assert.equal(rows[1].vars.sales, 6)
      assert.equal(rows[1].vars.owed, "₦60,000")
      assert.ok(rows[1].dedupeKey.startsWith("payout_needed:b_busy:2026-11-21:"))
    })

    it("the outbox key backs the window up: a replay of the same day queues nothing new", async () => {
      const b = await brand("replay")
      const s = await sale(b, 1_000_000, T0)
      await paid(s, T0)
      await d.update(brands).set({ payoutNeededEmailedAt: null }).where(eq(brands.id, b))
      await paid(s, at(1))
      assert.equal((await outbox()).length, 2)
    })

    it("one reminder 3 days after the first unpaid-out sale, then never again", async () => {
      const b = await brand("slow")
      await paid(await sale(b, 2_000_000, T0), T0)
      await d.delete(emailOutbox)
      const run = (now: Date) => sendPayoutReminders(db(), inTx, enqueue, { now })
      assert.deepEqual(await run(at(71)), [], "not before 3 days")
      const r = await run(at(72))
      assert.equal(r.length, 1)
      assert.ok("queued" in r[0] && r[0].variant === "reminder" && r[0].queued === 2)
      const rows = await outbox()
      assert.deepEqual(rows.map((x) => x.vars.variant), ["reminder", "reminder"])
      assert.equal(rows[0].vars.owed, "₦20,000")
      assert.equal(rows[0].vars.reference, undefined)
      assert.ok(rows.every((x) => x.dedupeKey.startsWith("payout_needed:reminder:b_slow:")))
      assert.deepEqual(await run(at(100)), [], "sent only once")
      assert.deepEqual(await run(at(1000)), [])
      assert.equal((await outbox()).length, 2)
      // The reminder counts toward the 24-hour window: a sale an hour later doesn't email again.
      assert.deepEqual(await paid(await sale(b, 1_000_000, at(73)), at(73)), [{ brandId: b, skipped: "cooldown" }])
    })

    it("the reminder waits while an email went out in the last 24 hours", async () => {
      const b = await brand("daily")
      await paid(await sale(b, 1_000_000, T0), T0)
      await paid(await sale(b, 1_000_000, at(60)), at(60))
      assert.deepEqual(await sendPayoutReminders(db(), inTx, enqueue, { now: at(72) }), [])
      assert.equal((await sendPayoutReminders(db(), inTx, enqueue, { now: at(84) })).length, 1)
    })

    it("stops once an account is saved: no sale email, no reminder", async () => {
      const b = await brand("fixed")
      await paid(await sale(b, 1_000_000, T0), T0)
      await addAccount(b)
      await d.delete(emailOutbox)
      assert.deepEqual(await paid(await sale(b, 1_000_000, at(30)), at(30)), [{ brandId: b, skipped: "has_account" }])
      assert.deepEqual(await sendPayoutReminders(db(), inTx, enqueue, { now: at(200) }), [])
      assert.equal((await outbox()).length, 0)
    })

    it("a brand whose sales were all refunded gets no reminder", async () => {
      const b = await brand("refunded")
      await paid(await sale(b, 1_000_000, T0), T0)
      await d.update(ledgerAccounts).set({ balanceMinor: 0 }).where(eq(ledgerAccounts.ownerId, b))
      await d.update(ledgerOrderMoney).set({ status: "refunded", refundedMinor: 1_000_000 }).where(eq(ledgerOrderMoney.brandId, b))
      await d.delete(emailOutbox)
      assert.deepEqual(await sendPayoutReminders(db(), inTx, enqueue, { now: at(80) }), [{ brandId: b, skipped: "nothing_owed" }])
      assert.equal((await outbox()).length, 0)
      assert.deepEqual(await sendPayoutReminders(db(), inTx, enqueue, { now: at(90) }), [], "and it isn't tried again")
    })

    it("Admin › Finance › Payout accounts: Owed, no account comes first, with what's held, and has its own filter", async () => {
      const owed = await brand("aaa-owed")
      await paid(await sale(owed, 3_000_000, T0), T0)
      const quiet = await brand("bbb-quiet")
      const paidUp = await brand("ccc-paid")
      await addAccount(paidUp)
      await sale(paidUp, 1_000_000, T0)
      const all = await listPayoutAccountsDb(db(), adminPayoutAccountsQuery.parse({}))
      assert.equal(all.items[0].brandId, owed)
      assert.equal(all.items[0].owedNoAccount, true)
      assert.deepEqual(all.items[0].owed, [{ currency: "NGN", minor: 3_000_000 }])
      assert.equal(all.items[0].payoutNeededSince, T0.toISOString())
      assert.equal(all.items.find((x) => x.brandId === quiet)?.owedNoAccount, false)
      assert.equal(all.items.find((x) => x.brandId === paidUp)?.owedNoAccount, false, "owed but has an account")
      assert.equal(all.counts.owed, 1)
      const filtered = await listPayoutAccountsDb(db(), adminPayoutAccountsQuery.parse({ status: "owed" }))
      assert.deepEqual(filtered.items.map((x) => x.brandId), [owed])
    })
  })

  describe("the real template (brand_payout_needed)", () => {
    it("renders both variants as payouts mail with the button to Settings › Payouts", () => {
      const out = execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", SELF], {
        env: { ...process.env, PAYOUT_NEEDED_CHILD: "render", NODE_ENV: "test", NODE_TEST_CONTEXT: "" },
        encoding: "utf8",
        timeout: 120_000,
      })
      const line = out.trim().split("\n").filter((l) => l.startsWith("{")).pop()
      const r = JSON.parse(line!) as Record<string, { subject: string; html: string; text: string; category: string }>
      assert.equal(r.sale.category, "payouts")
      assert.equal(r.sale.subject, "You made a sale 🎉 Add your payout account so we can pay you")
      assert.match(r.sale.html, /Add payout account/)
      assert.match(r.sale.html, /\/studio\/settings#payouts/)
      assert.match(r.sale.text, /YRD-48213-1/)
      assert.match(r.sale.text, /₦84,550/)
      assert.match(r.reminder.text, /You've made 3 sales on Yard/)
      assert.equal(r.alias, "brand_payout_needed")
    })
  })
} else {
  async function run() {
    if (CHILD === "render") {
      const { renderEmail, resolveTemplate } = await import("../email/templates")
      const vars = { brand: "Lagos Static", owed: "₦84,550", sales: 3 }
      return {
        sale: renderEmail("brand_payout_needed", { ...vars, reference: "YRD-48213-1", variant: "sale" }, { unsubscribeUrl: null }),
        reminder: renderEmail("brand_payout_needed", { ...vars, variant: "reminder" }, { unsubscribeUrl: null }),
        alias: resolveTemplate("payout.needed"),
      }
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
