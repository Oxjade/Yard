import assert from "node:assert/strict"
import test from "node:test"
import { pgDataException, pgErrorCode } from "./pg-errors"

/** drizzle's DrizzleQueryError carries the postgres-js error as `cause`. */
const wrapped = (code: string, message = "x") => Object.assign(new Error("Failed query: …\nparams: …"), { cause: Object.assign(new Error(message), { code, severity: "ERROR" }) })

test("finds the SQLSTATE on the error or down its cause chain", () => {
  assert.equal(pgErrorCode(Object.assign(new Error("x"), { code: "22008" })), "22008")
  assert.equal(pgErrorCode(wrapped("22P02")), "22P02")
  assert.equal(pgErrorCode(new Error("plain")), null)
  assert.equal(pgErrorCode(Object.assign(new Error("x"), { code: "ECONNRESET" })), null)
})

test("every class-22 data exception is a 400 with fixed words, never the driver's message", () => {
  for (const code of ["22001", "22003", "22007", "22008", "22P02", "22021", "22P05", "22999"]) {
    const r = pgDataException(wrapped(code, 'date/time field value out of range: "2027-02-30"'))
    assert.ok(r, code)
    assert.equal(r.code, code)
    assert.ok(!r.name.includes("2027") && !r.message.includes("2027"), "the refused value never reaches the response or the log words")
  }
  assert.equal(pgDataException(wrapped("22008"))?.text, false)
  assert.equal(pgDataException(wrapped("22021"))?.text, true)
  assert.equal(pgDataException(wrapped("22P05"))?.message, "Remove the hidden characters and try again.")
})

test("other errors are left for the 500 path", () => {
  for (const code of ["23505", "40001", "42P01", "08006", "XX000"]) assert.equal(pgDataException(wrapped(code)), null, code)
  assert.equal(pgDataException(new Error("boom")), null)
})
