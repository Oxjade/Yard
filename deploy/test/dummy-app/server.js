// Stand-in for the Next.js standalone server.js, used only by deploy/test/rehearse.sh.
// Same contract as the real app: PORT/HOSTNAME, GET /api/health {status, version, db, migrations},
// SSE, uploads under $YARD_DATA_DIR/production/uploads, graceful SIGTERM.
const http = require("node:http")
const fs = require("node:fs")
const path = require("node:path")
const { Pool } = require("pg")

const release = JSON.parse(fs.readFileSync(path.join(__dirname, "release.json"), "utf8"))
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.YARD_PG_POOL_MAX || 3) })
const expected = fs.readdirSync(path.join(__dirname, "drizzle")).filter((f) => f.endsWith(".sql")).length
const uploads = path.join(process.env.YARD_DATA_DIR, "production", "uploads")
fs.mkdirSync(uploads, { recursive: true, mode: 0o700 })
fs.writeFileSync(path.join(uploads, `boot-${release.sha.slice(0, 7)}.txt`), new Date().toISOString())
// The image cache must be writable through the .next/cache link.
fs.mkdirSync(path.join(__dirname, ".next", "cache", "images"), { recursive: true })
const started = Date.now()

const server = http.createServer(async (req, res) => {
  const send = (code, body, type = "application/json") => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store" })
    res.end(typeof body === "string" ? body : JSON.stringify(body))
  }
  try {
    if (req.url === "/api/health") {
      let db = "ok"
      let applied = 0
      try {
        await pool.query("select 1")
        const r = await pool.query("select count(*)::int as n from yard_dummy.migrations").catch(() => ({ rows: [{ n: 0 }] }))
        applied = r.rows[0].n
      } catch {
        db = "down"
      }
      const ok = db === "ok" && applied >= expected && !fs.existsSync(path.join(__dirname, "UNHEALTHY"))
      return send(ok ? 200 : 503, {
        status: ok ? "ok" : "degraded",
        version: release.sha,
        env: process.env.YARD_ENV_NAME,
        db,
        migrations: { applied, expected },
        payments: process.env.YARD_PAYMENTS || "off",
        uptimeSec: Math.round((Date.now() - started) / 1000),
      })
    }
    if (req.url === "/api/stream") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
      let n = 0
      const t = setInterval(() => {
        res.write(`data: ${JSON.stringify({ n, at: Date.now() })}\n\n`)
        if (++n === 5) {
          clearInterval(t)
          res.end()
        }
      }, 700)
      return
    }
    if (req.url === "/api/upload" && req.method === "POST") {
      let size = 0
      req.on("data", (c) => (size += c.length))
      req.on("end", () => send(200, { size }))
      return
    }
    if (req.url === "/api/hog") {
      // rehearsal: allocate until the cgroup memory limit kills the process
      const keep = []
      const t = setInterval(() => { const b = Buffer.alloc(16 * 1024 * 1024, 1); keep.push(b) }, 20)
      res.writeHead(202).end("allocating")
      return void t
    }
    if (req.url === "/api/probe") {
      // rehearsal: what this process can reach of the OTHER environment (finding 1)
      const other = process.env.YARD_ENV_NAME === "staging" ? "production" : "staging"
      const can = (f) => { try { f(); return true } catch { return false } }
      const me = process.getuid()
      let foreignPids = 0
      let foreignEnviron = false
      for (const d of fs.readdirSync("/proc")) {
        if (!/^\d+$/.test(d)) continue
        let uid
        try { uid = fs.statSync(`/proc/${d}`).uid } catch { continue }
        if (uid === me) continue
        foreignPids++
        if (can(() => fs.readFileSync(`/proc/${d}/environ`))) foreignEnviron = true
      }
      return send(200, {
        uid: me,
        prodEnv: can(() => fs.readFileSync(`/etc/yard/${other}.env`)),
        prodData: can(() => fs.readdirSync(`/var/lib/yard/${other}`)),
        prodReleases: can(() => fs.readdirSync(`/srv/yard/${other}`)),
        foreignPids,
        foreignEnviron,
      })
    }
    if (req.url === "/api/whoami") return send(200, { xff: req.headers["x-forwarded-for"] || null, proto: req.headers["x-forwarded-proto"] || null, uid: process.getuid(), cwd: process.cwd(), heap: process.env.NODE_OPTIONS || "" })
    if (req.url === "/" || req.url.startsWith("/_next/")) return send(200, "<!doctype html><title>Yard dummy</title>" + ("<p>" + release.sha + "</p>").repeat(50), "text/html; charset=utf-8")
    send(404, { error: "not found" })
  } catch (e) {
    send(500, { error: String(e) })
  }
})
server.listen(Number(process.env.PORT || 3000), process.env.HOSTNAME || "127.0.0.1", () => {
  console.log(`dummy ${release.sha} listening on ${process.env.HOSTNAME}:${process.env.PORT} as uid ${process.getuid()}`)
})
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { server.close(); server.closeAllConnections(); pool.end().finally(() => process.exit(0)) })
