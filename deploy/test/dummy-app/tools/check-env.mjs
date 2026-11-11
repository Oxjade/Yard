// Stand-in for tools/check-env.mjs (rehearsal only): lists every problem at once.
const p = []
const e = process.env
if (!/^postgres(ql)?:\/\//.test(e.DATABASE_URL ?? "")) p.push("DATABASE_URL (required): postgres://… connection string")
if (!/^https:\/\//.test(e.YARD_PUBLIC_URL ?? "")) p.push("YARD_PUBLIC_URL (required): https:// address")
if (Buffer.from(e.YARD_SESSION_SECRET ?? "", "base64url").length < 32) p.push("YARD_SESSION_SECRET (required): ≥ 32 bytes")
if (Buffer.from(e.YARD_ENCRYPTION_KEY ?? "", "base64").length !== 32) p.push("YARD_ENCRYPTION_KEY (required): 32 bytes base64")
if (!(e.YARD_DATA_DIR ?? "").startsWith("/")) p.push("YARD_DATA_DIR (required): absolute path")
if (e.YARD_SEED_DEMO === "1" || e.YARD_DEMO_AUTH === "1") p.push("demo flags must be off")
if (p.length) { console.error("environment problems:\n  " + p.join("\n  ")); process.exit(1) }
console.log(`env ok (${e.YARD_ENV_NAME}, payments ${e.YARD_PAYMENTS})`)
