import assert from "node:assert/strict"
import test from "node:test"
import { eligibilityResult, isOAuthResult, OAUTH_FALLBACK_MESSAGE, OAUTH_RESULT_MESSAGES, OAUTH_RESULTS, OAUTH_SUCCESS_RESULTS, oauthResultMessage, refusalLine } from "./oauth-results"

test("a team (admin) account on the shopper button is team_account, not a silent error", () => {
  assert.equal(eligibilityResult("shopper", "forbidden"), "team_account")
  assert.equal(oauthResultMessage("team_account"), "This is a Yard team account, so it can’t shop. Sign in with a different account.")
})

test("suspended stays suspended for both actors; brand sign-ins keep no_brand", () => {
  assert.equal(eligibilityResult("shopper", "suspended"), "suspended")
  assert.equal(eligibilityResult("brand", "suspended"), "suspended")
  assert.equal(eligibilityResult("brand", "forbidden"), "no_brand")
  assert.equal(eligibilityResult("brand", "validation"), "no_brand")
  assert.equal(eligibilityResult("shopper", "validation"), "error")
})

test("every failure result has words; successes don't need them", () => {
  for (const r of OAUTH_RESULTS) {
    if (OAUTH_SUCCESS_RESULTS.includes(r)) continue
    assert.ok(OAUTH_RESULT_MESSAGES[r], `no words for ${r}`)
  }
  assert.match(oauthResultMessage("account_unavailable"), /no longer available/)
  assert.match(oauthResultMessage("rate_limited"), /Too many sign-in attempts/)
})

test("unknown results fall back to one sentence (no prototype keys)", () => {
  assert.equal(oauthResultMessage("something_new"), OAUTH_FALLBACK_MESSAGE)
  assert.equal(oauthResultMessage("constructor"), OAUTH_FALLBACK_MESSAGE)
  assert.equal(isOAuthResult("constructor"), false)
  assert.equal(isOAuthResult("team_account"), true)
})

test("the refusal log line names provider, mode/actor, result and reason", () => {
  assert.equal(refusalLine("auth0", "signin", "shopper", "team_account", "not eligible: forbidden, kind admin, user u_1"), "[yard] auth: auth0 signin/shopper refused: team_account (not eligible: forbidden, kind admin, user u_1)")
  assert.equal(refusalLine("google", null, null, "invalid_state"), "[yard] auth: google ?/? refused: invalid_state")
})
