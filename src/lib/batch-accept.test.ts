import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { ACCEPT_ALL_HREF, mergeBatch, NOT_PENDING_REASON, onceForKey, planSuggestionBatch, preparedLine, runBatch, STALE_REASON, type BatchResult, type PendingSuggestion } from "./batch-accept"

/**
 * Accept all over a tiny store with acceptProposal's contract: each accept is its own
 * transaction (a failure changes nothing for that suggestion) and a second accept of the same
 * suggestion is refused (409), which is what keeps a replay from doing anything twice.
 */
function fixture() {
  const pending: PendingSuggestion[] = [
    { id: "pp_good_new", kind: "new", productId: null, baseVersion: null },
    { id: "pp_good_edit", kind: "edit", productId: "p_1", baseVersion: 3 },
    { id: "pp_stale_edit", kind: "edit", productId: "p_2", baseVersion: 1 },
    { id: "pp_invalid", kind: "new", productId: null, baseVersion: null },
    { id: "pp_good_new_2", kind: "new", productId: null, baseVersion: null },
  ]
  const versions = new Map([
    ["p_1", 3],
    ["p_2", 4], // the brand edited it after Yard suggested the change
  ])
  const status = new Map(pending.map((p) => [p.id, "pending"]))
  const calls: string[] = []
  const accept = async (id: string) => {
    calls.push(id)
    if (status.get(id) !== "pending") throw new Error("This suggestion was already answered or withdrawn.")
    if (id === "pp_invalid") throw new Error("Add at least one photo before this can go live.")
    status.set(id, "accepted")
  }
  return { pending, versions, status, calls, accept }
}

describe("Accept all", () => {
  it("accepts the good ones, leaves a stale edit and an invalid one pending with their reasons", async () => {
    const f = fixture()
    const plan = planSuggestionBatch(undefined, f.pending, f.versions)
    assert.deepEqual(plan.take, ["pp_good_new", "pp_good_edit", "pp_invalid", "pp_good_new_2"])
    assert.deepEqual(plan.skipped, [{ id: "pp_stale_edit", reason: STALE_REASON }])
    const r = mergeBatch(plan.skipped, await runBatch(plan.take, f.accept))
    assert.deepEqual(r.accepted, ["pp_good_new", "pp_good_edit", "pp_good_new_2"])
    assert.deepEqual(r.skipped, [
      { id: "pp_stale_edit", reason: STALE_REASON },
      { id: "pp_invalid", reason: "Add at least one photo before this can go live." },
    ])
    assert.equal(f.status.get("pp_stale_edit"), "pending")
    assert.equal(f.status.get("pp_invalid"), "pending")
    // The stale edit never reached acceptProposal: nothing of it was applied.
    assert.ok(!f.calls.includes("pp_stale_edit"))
  })

  it("takes only the selected ids, deduplicated, and says why an unknown or answered one was skipped", () => {
    const f = fixture()
    const plan = planSuggestionBatch(["pp_good_new_2", "pp_good_new_2", "pp_gone", "pp_good_new"], f.pending, f.versions)
    assert.deepEqual(plan.take, ["pp_good_new_2", "pp_good_new"])
    assert.deepEqual(plan.skipped, [{ id: "pp_gone", reason: NOT_PENDING_REASON }])
  })

  it("treats an edit without a known product version as stale", () => {
    const plan = planSuggestionBatch(undefined, [{ id: "pp_e", kind: "edit", productId: "p_gone", baseVersion: 2 }], new Map())
    assert.deepEqual(plan.take, [])
    assert.equal(plan.skipped[0].reason, STALE_REASON)
  })

  it("is idempotent by action key: a retry replays the first result and accepts nothing again", async () => {
    const f = fixture()
    const saved = new Map<string, BatchResult>()
    const store = { load: async (k: string) => saved.get(k) ?? null, save: async (k: string, r: BatchResult) => void saved.set(k, r) }
    let runs = 0
    const batch = () =>
      onceForKey("key_abc12345", store, async () => {
        runs++
        const plan = planSuggestionBatch(undefined, f.pending.filter((p) => f.status.get(p.id) === "pending"), f.versions)
        return mergeBatch(plan.skipped, await runBatch(plan.take, f.accept))
      })
    const first = await batch()
    const callsAfterFirst = f.calls.length
    const again = await batch()
    assert.equal(runs, 1)
    assert.equal(f.calls.length, callsAfterFirst)
    assert.equal(again.replayed, true)
    assert.deepEqual({ accepted: again.accepted, skipped: again.skipped }, { accepted: first.accepted, skipped: first.skipped })
    // A new key is a new batch: only what's still pending, and the good ones are already done.
    const next = await onceForKey("key_def67890", store, async () => {
      const plan = planSuggestionBatch(undefined, f.pending.filter((p) => f.status.get(p.id) === "pending"), f.versions)
      return mergeBatch(plan.skipped, await runBatch(plan.take, f.accept))
    })
    assert.deepEqual(next.accepted, [])
    assert.deepEqual(next.skipped.map((s) => s.id).sort(), ["pp_invalid", "pp_stale_edit"])
  })

  it("keeps going when an accept throws something that isn't an Error", async () => {
    const r = await runBatch(["a", "b"], async (id) => {
      if (id === "a") throw "boom"
    })
    assert.deepEqual(r, { accepted: ["b"], skipped: [{ id: "a", reason: "boom" }] })
  })

  it("says it in one line and links to the list with Accept all in focus", () => {
    assert.equal(preparedLine(12), "Yard prepared 12 products for you. Accept all in one tap")
    assert.equal(preparedLine(1), "Yard prepared 1 product for you. Accept it in one tap")
    assert.equal(ACCEPT_ALL_HREF, "/studio/products/suggestions?focus=accept-all")
  })
})
