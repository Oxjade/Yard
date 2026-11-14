import assert from "node:assert/strict"
import test from "node:test"
import { assetLinks, certFingerprints } from "./app-links"

const fp = (b: string) => Array(32).fill(b).join(":")

test("no fingerprints → an empty list", () => {
  assert.deepEqual(assetLinks(undefined), [])
  assert.deepEqual(assetLinks(""), [])
  assert.deepEqual(assetLinks("not-a-fingerprint"), [])
})

test("fingerprints become one android_app statement for space.yardstore.app", () => {
  assert.deepEqual(assetLinks(` ${fp("AB")} , ${fp("cd")},${fp("AB")}`), [
    { relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: "space.yardstore.app", sha256_cert_fingerprints: [fp("AB"), fp("CD")] } },
  ])
})

test("malformed fingerprints are dropped", () => {
  assert.deepEqual(certFingerprints(`${fp("AB")},AB:CD,${fp("ZZ")}`), [fp("AB")])
})
