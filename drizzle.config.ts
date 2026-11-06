import { defineConfig } from "drizzle-kit"

/**
 * drizzle-kit only diffs these files (it never connects to the database): migrations run
 * in-process at boot (src/server/db/client.ts). Never run drizzle-kit push, migrate or studio
 * against the data directory. The glob includes social-tokens.ts, which the runtime schema
 * object leaves out (§5.5), so its table is still migrated.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/*.ts",
  out: "./drizzle",
})
