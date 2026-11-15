import assert from "node:assert/strict"
import { after, before, describe, it } from "node:test"
import { sql } from "drizzle-orm"
import { countAudience, freezeAudience } from "./audience"
import { seedPeople, testDb } from "./test-db"

type Db = Awaited<ReturnType<typeof testDb>>
let t: Db
before(async () => {
  t = await testDb()
  await seedPeople(t.ex)
})
after(() => t.close())

const real = { includeDemo: false }
const ids = async (campaignId: string) => (await t.rows<{ user_id: string }>(sql`select user_id from newsletter_recipients where campaign_id = ${campaignId} order by user_id`)).map((r) => r.user_id)
const campaign = (id: string) => t.ex.execute(sql`insert into newsletter_campaigns (id) values (${id})`)

describe("Newsletter audience: consent", () => {
  it("marketing to all shoppers reaches only opted-in, reachable, real accounts", async () => {
    await campaign("nlc_m1")
    // Not: u_no (said no), u_default (no row = off), u_unsub (unsubscribed), u_bounce (bounced),
    // u_suspended, u_demo (demo account outside the demo), u_erased; brand staff aren't shoppers.
    assert.equal(await countAudience(t.ex, { type: "shoppers" }, "marketing", real), 2)
    assert.equal(await freezeAudience(t.ex, "nlc_m1", { type: "shoppers" }, "marketing", real), 2)
    assert.deepEqual(await ids("nlc_m1"), ["u_yes_gh", "u_yes_ng"])
  })

  it("a service notice ignores marketing consent and unsubscribes, never bounces", async () => {
    // u_yes_ng, u_yes_gh, u_no, u_default, u_unsub — not u_bounce, u_suspended, u_demo, u_erased.
    assert.equal(await countAudience(t.ex, { type: "shoppers" }, "service", real), 5)
  })

  it("demo accounts count only when the demo is on", async () => {
    assert.equal(await countAudience(t.ex, { type: "shoppers" }, "marketing", { includeDemo: true }), 3)
  })

  it("an account waiting to be erased is left out", async () => {
    await t.ex.execute(sql`insert into account_deletions (id, user_id, status, scheduled_for) values ('del1', 'u_yes_gh', 'pending', now())`)
    assert.equal(await countAudience(t.ex, { type: "shoppers" }, "marketing", real), 1)
    await t.ex.execute(sql`delete from account_deletions where id = 'del1'`)
  })

  it("an 'all' unsubscribe stops marketing too", async () => {
    await t.ex.execute(sql`insert into email_suppressions (id, email_lower, category, reason) values ('sup3', 'yes.gh@example.com', 'all', 'unsubscribe')`)
    assert.equal(await countAudience(t.ex, { type: "shoppers" }, "marketing", real), 1)
    await t.ex.execute(sql`delete from email_suppressions where id = 'sup3'`)
  })
})

describe("Newsletter audience: who", () => {
  it("brands: active owners and admins only (not other roles)", async () => {
    assert.equal(await countAudience(t.ex, { type: "brands" }, "service", real), 1)
    await campaign("nlc_b1")
    await freezeAudience(t.ex, "nlc_b1", { type: "brands" }, "service", real)
    assert.deepEqual(await ids("nlc_b1"), ["u_owner"])
  })

  it("followers of one brand, with consent for marketing", async () => {
    assert.equal(await countAudience(t.ex, { type: "followers", brandId: "b_one" }, "marketing", real), 1)
    assert.equal(await countAudience(t.ex, { type: "followers", brandId: "b_one" }, "service", real), 2)
    assert.equal(await countAudience(t.ex, { type: "followers", brandId: "b_two" }, "marketing", real), 1)
  })

  it("shoppers in a country", async () => {
    assert.equal(await countAudience(t.ex, { type: "country", country: "NG" }, "marketing", real), 1)
    assert.equal(await countAudience(t.ex, { type: "country", country: "GH" }, "marketing", real), 1)
    assert.equal(await countAudience(t.ex, { type: "country", country: "KE" }, "marketing", real), 0)
  })

  it("freezing twice adds nobody twice", async () => {
    assert.equal(await freezeAudience(t.ex, "nlc_m1", { type: "shoppers" }, "marketing", real), 2)
    assert.equal(await freezeAudience(t.ex, "nlc_m1", { type: "shoppers" }, "marketing", real), 2)
  })

  it("opting in later puts someone in the next campaign; opting out takes them out", async () => {
    await t.ex.execute(sql`insert into notification_preferences (user_id, email_marketing) values ('u_default', true)`)
    assert.equal(await countAudience(t.ex, { type: "shoppers" }, "marketing", real), 3)
    await t.ex.execute(sql`update notification_preferences set email_marketing = false where user_id = 'u_default'`)
    assert.equal(await countAudience(t.ex, { type: "shoppers" }, "marketing", real), 2)
  })
})
