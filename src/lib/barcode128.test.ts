import { test } from "node:test"
import assert from "node:assert/strict"
import { barcodeBars, code128Patterns, decode128, decodeModules, encode128B, QUIET, symbols128B } from "./barcode128"

test("every symbol is 11 modules (stop 13), unique, with an even bar count (the symbology's parity)", () => {
  assert.equal(code128Patterns.length, 107)
  assert.equal(new Set(code128Patterns).size, 107)
  code128Patterns.forEach((p, v) => {
    const w = [...p].map(Number)
    assert.equal(w.reduce((a, b) => a + b, 0), v === 106 ? 13 : 11, `symbol ${v}`)
    const bars = w.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0)
    assert.equal(bars % 2, 0, `symbol ${v} bar modules`)
  })
})

test("checksum follows (104 + Σ value × position) mod 103", () => {
  // "Wikipedia": W55 i73 k75 i73 p80 e69 d68 i73 a65 → 3281 mod 103 = 88.
  assert.deepEqual(symbols128B("Wikipedia"), [104, 55, 73, 75, 73, 80, 69, 68, 73, 65, 88, 106])
})

test("a receipt reference round-trips through the decoder", () => {
  for (const ref of ["YRD-8F2K-91", "YRD-J923WJ", "YRD-S1A2B3C4-2", "a b~"]) {
    assert.equal(decode128(encode128B(ref)), ref)
  }
})

test("the rendered bars decode as a scanner reads them", () => {
  const ref = "YRD-7QX3-14"
  const { bars, width } = barcodeBars(ref)
  const row = Array.from({ length: width }, () => false)
  for (const [x, w] of bars) for (let i = x; i < x + w; i++) row[i] = true
  assert.equal(row.slice(0, QUIET).some(Boolean), false)
  assert.equal(row.slice(width - QUIET).some(Boolean), false)
  assert.equal(decodeModules(row), ref)
})

test("a damaged barcode doesn't decode", () => {
  const w = encode128B("YRD-8F2K-91")
  const flipped = [...w]
  flipped[8] = flipped[8] === 1 ? 2 : 1
  flipped[9] = flipped[9] === 1 ? 2 : 1
  assert.equal(decode128(flipped), null)
  assert.equal(decode128(w.slice(0, -7)), null)
  assert.throws(() => encode128B("naïve"))
})
