import { boolean, index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core"
import { ACTOR_KINDS, ADMIN_ROLES, SOCIAL_MODES, SOCIAL_PROVIDERS, USER_KINDS, USER_STATUSES } from "../../../lib/api/contracts/enums"
import { brands } from "./brands"
import { oneOf, raw, tz } from "./columns"

/** People and tenancy (§3.1). Ids: 'u_*' shoppers, 'u_t_*' test shoppers, 'u_b_*' brand staff, 'adm_*' admins. */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    city: text("city"),
    country: text("country"),
    status: text("status").notNull().default("active"),
    demo: boolean("demo").notNull().default(true),
    readReceipts: boolean("read_receipts").notNull().default(true),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_ux").on(raw("lower(email)")),
    index("users_kind_ix").on(t.kind),
    oneOf("users_kind_ck", "kind", USER_KINDS),
    oneOf("users_status_ck", "status", USER_STATUSES),
  ],
)

export const adminMembers = pgTable(
  "admin_members",
  {
    userId: text("user_id").primaryKey().references(() => users.id),
    role: text("role").notNull(),
    mfa: boolean("mfa").notNull().default(false),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  () => [oneOf("admin_members_role_ck", "role", ADMIN_ROLES)],
)

/**
 * One row per signed-in actor (§2.1). `id` is stable for the session's life and names its
 * realtime channel (session:<id>); `token_hash` is sha256 of the current token and rotates.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actor: text("actor").notNull(),
    activeBrandId: text("active_brand_id").references(() => brands.id),
    createdAt: tz("created_at").notNull().defaultNow(),
    lastSeenAt: tz("last_seen_at").notNull().defaultNow(),
    idleExpiresAt: tz("idle_expires_at").notNull(),
    absoluteExpiresAt: tz("absolute_expires_at").notNull(),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_ux").on(t.tokenHash),
    index("sessions_user_actor_ix").on(t.userId, t.actor),
    index("sessions_active_brand_ix").on(t.activeBrandId),
    index("sessions_idle_expires_ix").on(t.idleExpiresAt),
    index("sessions_absolute_expires_ix").on(t.absoluteExpiresAt),
    oneOf("sessions_actor_ck", "actor", ACTOR_KINDS),
  ],
)

/** OAuth `state` rows (§5.5). No return_to: the callback always redirects to /studio/social. */
export const oauthStates = pgTable(
  "oauth_states",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider").notNull(),
    mode: text("mode").notNull(),
    codeVerifierEnc: text("code_verifier_enc"),
    createdAt: tz("created_at").notNull().defaultNow(),
    expiresAt: tz("expires_at").notNull(),
    usedAt: tz("used_at"),
  },
  () => [oneOf("oauth_states_provider_ck", "provider", SOCIAL_PROVIDERS), oneOf("oauth_states_mode_ck", "mode", SOCIAL_MODES)],
)

/** Seed versions and other process-wide markers. */
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
})
