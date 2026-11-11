/**
 * The demo switch: sample accounts, marketplace fixtures and sample-data screens exist only in
 * development/test or an explicit demo deployment (YARD_SEED_DEMO=1). getEnv().seedDemo is this
 * value; src/proxy.ts reads it here directly, because the proxy is bundled apart from the app and
 * must not parse the whole configuration. No imports, so both can share it.
 */
export function seedDemoFrom(env: { NODE_ENV?: string; YARD_SEED_DEMO?: string }): boolean {
  const dev = env.NODE_ENV !== "production"
  return dev || env.YARD_SEED_DEMO?.trim() === "1"
}
