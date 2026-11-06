// F2 project checks, loaded by scripts/db-check.mjs. Each returns { status, name, detail }.
// Quick, non-mutating checks of the platform services; the full kit is scratchpad/v2-curl/f2.sh.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const readImpl = (file) => /export const IMPL: string = "([^"]+)"/.exec(readFileSync(path.join(process.cwd(), file), "utf8"))?.[1] ?? "?"

/** Reads an SSE response for up to `ms`, returning the text so far. */
async function readFor(res, ms) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let text = ""
  const stop = setTimeout(() => reader.cancel().catch(() => {}), ms)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += dec.decode(value, { stream: true })
      if (text.includes("event: hello")) break
    }
  } catch {
    /* cancelled */
  } finally {
    clearTimeout(stop)
    reader.cancel().catch(() => {})
  }
  return text
}

export default async function f2({ base, cookie, dataDir }) {
  const out = []
  const add = (ok, name, detail) => out.push({ status: ok === null ? "SKIP" : ok ? "PASS" : "FAIL", name, detail })
  const json = (headers = {}) => ({ Origin: base, "X-Yard-Client": "1", "Content-Type": "application/json", ...headers })

  for (const [mod, file] of [
    ["media", "src/server/media/index.ts"],
    ["signals", "src/server/signals/index.ts"],
    ["reports", "src/server/reports/index.ts"],
  ]) {
    const impl = readImpl(file)
    add(impl !== "stub" && impl !== "?", `${mod} contract implemented`, `IMPL=${impl}`)
  }

  // The admin stream (db-check's adm_1 cookie): event-stream headers, no compression, retry then hello.
  if (cookie) {
    const res = await fetch(`${base}/api/realtime/admin`, { headers: { cookie, "Accept-Encoding": "gzip" } })
    const text = await readFor(res, 4000)
    add(res.status === 200 && !res.headers.get("content-encoding") && /no-transform/.test(res.headers.get("cache-control") ?? "") && /^retry: 3000/.test(text) && /event: hello/.test(text), "admin SSE: no-transform, no Content-Encoding, retry and hello", `status ${res.status}, encoding ${res.headers.get("content-encoding") ?? "none"}`)
  } else add(null, "admin SSE", "no admin cookie")
  const anon = await fetch(`${base}/api/realtime/market`)
  add(anon.status === 401, "SSE without a session is 401", String(anon.status))
  const poll = await fetch(`${base}/api/realtime/market/poll?after=0`)
  add(poll.status === 401, "poll without a session is 401", String(poll.status))

  // Signals: the kind allowlist and the session rule.
  const sig = (body, headers = {}) => fetch(`${base}/api/signals`, { method: "POST", headers: json(headers), body: JSON.stringify(body) })
  add((await sig({ kind: "order_placed", brandId: "b_lagos_static" })).status === 400, "signals: order_placed is 400")
  add((await sig({ kind: "follow", brandId: "b_lagos_static" })).status === 401, "signals: anonymous follow is 401")

  // Uploads: authorised before the body; no Content-Length is 411.
  const r = await fetch(`${base}/api/auth/demo`, { method: "POST", headers: json(), body: JSON.stringify({ actor: "shopper", account: "u_t_f1" }) })
  const shopper = r.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ")
  const noCookie = await fetch(`${base}/api/uploads?purpose=inbox_attachment&as=shopper&brandId=b_lagos_static`, { method: "POST", headers: { Origin: base, "X-Yard-Client": "1", "Content-Type": "multipart/form-data; boundary=x" }, body: "--x--" })
  add(noCookie.status === 401, "uploads without a session are 401", String(noCookie.status))
  if (r.ok) {
    const chunked = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("--x\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.jpg\"\r\n\r\nabc\r\n--x--\r\n")); c.close() } })
    const lr = await fetch(`${base}/api/uploads?purpose=inbox_attachment&as=shopper&brandId=b_lagos_static`, { method: "POST", headers: { cookie: shopper, Origin: base, "X-Yard-Client": "1", "Content-Type": "multipart/form-data; boundary=x" }, body: chunked, duplex: "half" })
    add(lr.status === 411, "an upload without Content-Length is 411", String(lr.status))
  } else add(null, "an upload without Content-Length is 411", `u_t_f1 sign-in ${r.status}`)

  // Media: unknown ids and the private seed attachment stay 404 without a cookie.
  add((await fetch(`${base}/api/media/med_doesnotexist0000000000`)).status === 404, "unknown media is 404")
  const uploads = path.join(dataDir, "development", "uploads")
  const fit = path.join(uploads, "inbox_attachment", "u_ada")
  const seeded = existsSync(fit) && readdirSync(fit).some((f) => f.startsWith("med_seed_ada_fit."))
  if (seeded) {
    add((await fetch(`${base}/api/media/med_seed_ada_fit`)).status === 404, "med_seed_ada_fit is private (404 without a cookie)")
    add((statSync(fit).mode & 0o077) === 0, "uploads/inbox_attachment/u_ada is private to this user (go-rwx)")
  } else add(null, "med_seed_ada_fit", "I's seed hasn't copied it yet")

  // No upload leftovers older than an hour in uploads/tmp (the purge clears them hourly).
  const tmp = path.join(uploads, "tmp")
  const stale = existsSync(tmp) ? readdirSync(tmp).filter((f) => Date.now() - statSync(path.join(tmp, f)).mtimeMs > 2 * 3600_000) : []
  add(stale.length === 0, "no stale files in uploads/tmp", `${stale.length} older than 2 h`)
  return out
}
