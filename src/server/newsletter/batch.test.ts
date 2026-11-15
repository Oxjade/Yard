import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import { sql } from "drizzle-orm"
import type { Exec } from "./audience"
import { freezeAudience } from "./audience"
import { campaignCounts, feedCampaign, outstandingCount, reconcileCampaign, type EnqueueFn } from "./batch"
import { seedPeople, testDb } from "./test-db"

type Db = Awaited<ReturnType<typeof testDb>>
let t: Db
before(async () => {
  t = await testDb()
  await seedPeople(t.ex)
  // Two more opted-in shoppers, so a batch of 2 leaves work for the next run.
  for (const id of ["u_extra1", "u_extra2"]) {
    await t.ex.execute(sql`insert into users (id, kind, name, email, demo) values (${id}, 'shopper', ${id}, ${`${id}@example.com`}, false)`)
    await t.ex.execute(sql`insert into notification_preferences (user_id, email_marketing) values (${id}, true)`)
  }
})
after(() => t.close())

/** The outbox insert enqueueEmail does: idempotent on the dedupe key. */
const enqueue: EnqueueFn = async (tx: Exec, input) => {
  await tx.execute(sql`insert into email_outbox (id, template, category, to_email, vars, dedupe_key) values (${`em_${input.dedupeKey}`}, ${input.template}, 'marketing', ${input.to}, ${JSON.stringify(input.vars)}::jsonb, ${input.dedupeKey}) on conflict (dedupe_key) do nothing`)
}
const outbox = async (id: string) => (await t.rows<{ n: number; d: number }>(sql`select count(*)::int as n, count(distinct to_email)::int as d from email_outbox where dedupe_key like ${`newsletter:${id}:%`}`))[0]

describe("Newsletter batches", () => {
  it("hands over at most `limit` per run, then the rest, never twice", async () => {
    await t.ex.execute(sql`insert into newsletter_campaigns (id, status) values ('nlc_x', 'sending')`)
    const total = await freezeAudience(t.ex, "nlc_x", { type: "shoppers" }, "marketing", { includeDemo: false })
    assert.equal(total, 4)
    const deps = { withTx: t.withTx, enqueue }
    const one = await feedCampaign(deps, { id: "nlc_x", template: "newsletter" }, 2)
    assert.deepEqual(one, { queued: 2, remaining: 2 })
    const two = await feedCampaign(deps, { id: "nlc_x", template: "newsletter" }, 2)
    assert.deepEqual(two, { queued: 2, remaining: 0 })
    // A third and fourth run (a retry, a restart) find nobody pending and send nothing new.
    assert.deepEqual(await feedCampaign(deps, { id: "nlc_x", template: "newsletter" }, 100), { queued: 0, remaining: 0 })
    assert.deepEqual(await feedCampaign(deps, { id: "nlc_x", template: "newsletter" }, 100), { queued: 0, remaining: 0 })
    assert.deepEqual(await outbox("nlc_x"), { n: 4, d: 4 })
  })

  it("a campaign isn't finished while its emails still wait in the outbox", async () => {
    await t.ex.execute(sql`insert into newsletter_campaigns (id, status) values ('nlc_tail', 'sending')`)
    await freezeAudience(t.ex, "nlc_tail", { type: "shoppers" }, "marketing", { includeDemo: false })
    assert.equal(await outstandingCount(t.ex, "nlc_tail"), 4)
    assert.deepEqual(await feedCampaign({ withTx: t.withTx, enqueue }, { id: "nlc_tail", template: "newsletter" }, 100), { queued: 4, remaining: 0 })
    // Everyone handed over (remaining 0), but the outbox hasn't sent any of the 4 yet.
    assert.equal(await outstandingCount(t.ex, "nlc_tail"), 4)
    await t.ex.execute(sql`update email_outbox set status = 'sent', sent_at = now() where dedupe_key in (select dedupe_key from newsletter_recipients where campaign_id = 'nlc_tail' order by user_id limit 3)`)
    await reconcileCampaign(t.ex, "nlc_tail")
    assert.equal(await outstandingCount(t.ex, "nlc_tail"), 1)
    // A row the outbox is still sending, or retrying later, keeps it open too.
    await t.ex.execute(sql`update email_outbox set status = 'sending' where dedupe_key like 'newsletter:nlc_tail:%' and status = 'pending'`)
    await reconcileCampaign(t.ex, "nlc_tail")
    assert.equal(await outstandingCount(t.ex, "nlc_tail"), 1)
    await t.ex.execute(sql`update email_outbox set status = 'failed' where dedupe_key like 'newsletter:nlc_tail:%' and status = 'sending'`)
    await reconcileCampaign(t.ex, "nlc_tail")
    assert.equal(await outstandingCount(t.ex, "nlc_tail"), 0)
    const c = await campaignCounts(t.ex, "nlc_tail")
    assert.equal(c.sent, 3)
    assert.equal(c.failed, 1)
  })

  it("a run that dies mid-batch leaves nothing half-done; the retry sends each email once", async () => {
    await t.ex.execute(sql`insert into newsletter_campaigns (id, status) values ('nlc_crash', 'sending')`)
    await freezeAudience(t.ex, "nlc_crash", { type: "shoppers" }, "marketing", { includeDemo: false })
    let calls = 0
    const dying: EnqueueFn = async (tx, input) => {
      await enqueue(tx, input)
      if (++calls === 2) throw new Error("process killed")
    }
    await assert.rejects(feedCampaign({ withTx: t.withTx, enqueue: dying }, { id: "nlc_crash", template: "newsletter" }, 10))
    // Rolled back together: no outbox rows, everyone still pending.
    assert.deepEqual(await outbox("nlc_crash"), { n: 0, d: 0 })
    assert.equal((await campaignCounts(t.ex, "nlc_crash")).pending, 4)
    const r = await feedCampaign({ withTx: t.withTx, enqueue }, { id: "nlc_crash", template: "newsletter" }, 10)
    assert.deepEqual(r, { queued: 4, remaining: 0 })
    assert.deepEqual(await outbox("nlc_crash"), { n: 4, d: 4 })
  })

  it("a recipient already in the outbox (handed over, then the status write was lost) isn't sent again", async () => {
    await t.ex.execute(sql`insert into newsletter_campaigns (id, status) values ('nlc_lost', 'sending')`)
    await freezeAudience(t.ex, "nlc_lost", { type: "shoppers" }, "marketing", { includeDemo: false })
    // Simulate: one email reached the outbox but the recipient row still says pending.
    await enqueue(t.ex, { template: "newsletter", to: "yes.ng@example.com", vars: {}, dedupeKey: "newsletter:nlc_lost:u_yes_ng" })
    await feedCampaign({ withTx: t.withTx, enqueue }, { id: "nlc_lost", template: "newsletter" }, 10)
    assert.deepEqual(await outbox("nlc_lost"), { n: 4, d: 4 })
  })

  it("two runs at once never take the same recipients (SKIP LOCKED)", async () => {
    await t.ex.execute(sql`insert into newsletter_campaigns (id, status) values ('nlc_par', 'sending')`)
    await freezeAudience(t.ex, "nlc_par", { type: "shoppers" }, "marketing", { includeDemo: false })
    const deps = { withTx: t.withTx, enqueue }
    const [a, b] = await Promise.all([feedCampaign(deps, { id: "nlc_par", template: "newsletter" }, 3), feedCampaign(deps, { id: "nlc_par", template: "newsletter" }, 3)])
    assert.equal(a.queued + b.queued, 4)
    assert.deepEqual(await outbox("nlc_par"), { n: 4, d: 4 })
  })

  it("copies outbox outcomes onto recipients and counts unsubscribes", async () => {
    await t.ex.execute(sql`update email_outbox set status = 'sent', sent_at = now() where dedupe_key = 'newsletter:nlc_x:u_yes_ng'`)
    await t.ex.execute(sql`update email_outbox set status = 'failed', last_error = 'bounced' where dedupe_key = 'newsletter:nlc_x:u_yes_gh'`)
    await t.ex.execute(sql`update email_outbox set status = 'stub' where dedupe_key = 'newsletter:nlc_x:u_extra1'`)
    assert.equal(await reconcileCampaign(t.ex, "nlc_x"), 3)
    assert.equal(await reconcileCampaign(t.ex, "nlc_x"), 0)
    await t.ex.execute(sql`update newsletter_recipients set unsubscribed_at = now() where campaign_id = 'nlc_x' and user_id = 'u_yes_ng'`)
    const c = await campaignCounts(t.ex, "nlc_x")
    assert.equal(c.sent, 1)
    assert.equal(c.failed, 1)
    assert.equal(c.stub, 1)
    assert.equal(c.queued, 1)
    assert.equal(c.unsubscribed, 1)
  })
})
