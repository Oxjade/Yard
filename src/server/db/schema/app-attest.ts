import { bigint, index, pgTable, text } from "drizzle-orm/pg-core"
import { oneOf, tz } from "./columns"
import { users } from "./people"

/**
 * App attestation (src/server/app-attest, docs/APP.md "App attestation"). Plain Node: drizzle-kit
 * and `tsx --test` load it.
 *
 *  - app_attest_challenges: single-use challenges for the apps, stored as sha256 hex only, ~5
 *    minutes each. Consumed by deleting the row; expired rows are swept when new ones are issued.
 *  - app_attest_keys: one row per iOS install's App Attest key (the key id is that install's
 *    identity): the public key from its verified attestation and the last assertion counter, which
 *    only moves up (a replayed assertion is refused). `user_id` is the shopper who last used it.
 */
export const APP_ATTEST_PURPOSES = ["request", "register"] as const

export const appAttestChallenges = pgTable(
  "app_attest_challenges",
  {
    hash: text("hash").primaryKey(),
    purpose: text("purpose").notNull(),
    expiresAt: tz("expires_at").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [index("app_attest_challenges_expires_ix").on(t.expiresAt), oneOf("app_attest_challenges_purpose_ck", "purpose", APP_ATTEST_PURPOSES)],
)

export const appAttestKeys = pgTable(
  "app_attest_keys",
  {
    keyId: text("key_id").primaryKey(),
    /** SPKI PEM of the P-256 key from the verified attestation. */
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    environment: text("environment").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: tz("created_at").notNull().defaultNow(),
    lastUsedAt: tz("last_used_at"),
  },
  (t) => [index("app_attest_keys_user_ix").on(t.userId), oneOf("app_attest_keys_environment_ck", "environment", ["production", "development"])],
)
