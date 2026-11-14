import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core"
import { INVITE_KINDS, TEAM_ROLES } from "../../../lib/api/contracts/enums"
import { brands } from "./brands"
import { oneOf, raw, tz } from "./columns"
import { sessions, users } from "./people"

/**
 * Real identities (v3 AUTH). Plain Node (no server-only): drizzle-kit loads it.
 *
 * Every secret is stored hashed or sealed: passwords as scrypt hashes, one-time tokens and
 * recovery codes as sha256, TOTP secrets sealed with the vault (AES-256-GCM, AAD bound to the user).
 * Sessions keep the F1 `sessions` table; `session_auth` says how each one was established, so a
 * password/OAuth session survives YARD_DEMO_AUTH being off while demo sessions do not.
 */

export const AUTH_METHODS = ["demo", "password", "google", "apple", "auth0", "magic_link", "invite", "email_verification", "yard_setup", "claim"] as const
export const OAUTH_PROVIDERS = ["google", "apple", "auth0"] as const
export const OAUTH_MODES = ["signin", "link", "reauth"] as const
/** change_email: a link sent to the NEW address; meta { email: new, from: old }. */
export const AUTH_TOKEN_PURPOSES = ["verify_email", "reset_password", "magic_link", "mfa_challenge", "change_email"] as const
/** Native apps that sign in through a Custom Tab / ASWebAuthenticationSession hand-off. */
export const APP_CLIENTS = ["android", "ios"] as const
export const INVITE_STATUSES = ["pending", "accepted", "revoked", "expired"] as const
export const DELETION_STATUSES = ["pending", "processing", "completed", "failed"] as const
export const SIGN_IN_ACTORS = ["shopper", "brand", "admin"] as const

/** One row per user that has (or had) a real sign-in: email verification, password and lockout state. */
export const userCredentials = pgTable(
  "user_credentials",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    /** `scrypt$<log2N>$<r>$<p>$<salt b64url>$<hash b64url>`; null for OAuth/magic-link-only accounts. */
    passwordHash: text("password_hash"),
    passwordUpdatedAt: tz("password_updated_at"),
    emailVerifiedAt: tz("email_verified_at"),
    /** Failed password attempts in the current window (lockout, §5.1). */
    failedCount: integer("failed_count").notNull().default(0),
    firstFailedAt: tz("first_failed_at"),
    lockedUntil: tz("locked_until"),
    lastSignInAt: tz("last_sign_in_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("user_credentials_locked_ix").on(t.lockedUntil)],
)

/** Google / Apple / Auth0 accounts linked to a Yard user. `subject` is the provider's stable `sub`. */
export const oauthIdentities = pgTable(
  "oauth_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    email: text("email"),
    emailVerified: integer("email_verified").notNull().default(0),
    createdAt: tz("created_at").notNull().defaultNow(),
    lastUsedAt: tz("last_used_at"),
  },
  (t) => [
    uniqueIndex("oauth_identities_provider_subject_ux").on(t.provider, t.subject),
    // One Google / Apple identity per user. Auth0 fronts several social connections, so a user
    // may hold one Auth0 identity per connection (enforced in the flow by the `sub` prefix).
    uniqueIndex("oauth_identities_user_provider_ux").on(t.userId, t.provider).where(raw("provider <> 'auth0'")),
    index("oauth_identities_user_ix").on(t.userId),
    oneOf("oauth_identities_provider_ck", "provider", OAUTH_PROVIDERS),
  ],
)

/**
 * Sign-in OAuth `state` rows (separate from the brand-scoped social `oauth_states`). The PKCE
 * verifier is sealed; `binding_hash` ties the round trip to the browser that started it.
 */
export const authOauthStates = pgTable(
  "auth_oauth_states",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    mode: text("mode").notNull(),
    actor: text("actor").notNull().default("shopper"),
    brandId: text("brand_id").references(() => brands.id),
    /** link / reauth: the signed-in user who started it. */
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    codeVerifierEnc: text("code_verifier_enc"),
    nonce: text("nonce").notNull(),
    bindingHash: text("binding_hash").notNull(),
    /** Native app sign-in (GET …/app-start): the app (android | ios) and its PKCE-style challenge. Null for the web flow. */
    appClient: text("app_client"),
    appChallenge: text("app_challenge"),
    createdAt: tz("created_at").notNull().defaultNow(),
    expiresAt: tz("expires_at").notNull(),
    usedAt: tz("used_at"),
  },
  (t) => [
    index("auth_oauth_states_expires_ix").on(t.expiresAt),
    oneOf("auth_oauth_states_app_client_ck", "app_client", APP_CLIENTS),
    oneOf("auth_oauth_states_provider_ck", "provider", OAUTH_PROVIDERS),
    oneOf("auth_oauth_states_mode_ck", "mode", OAUTH_MODES),
    oneOf("auth_oauth_states_actor_ck", "actor", SIGN_IN_ACTORS),
  ],
)

/** Single-use tokens: email verification, password reset, magic link and the admin MFA challenge. */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    /** Wrong codes against an MFA challenge; the challenge dies at 5. */
    attempts: integer("attempts").notNull().default(0),
    meta: jsonb("meta").notNull().default(raw("'{}'::jsonb")),
    createdAt: tz("created_at").notNull().defaultNow(),
    expiresAt: tz("expires_at").notNull(),
    usedAt: tz("used_at"),
  },
  (t) => [
    uniqueIndex("auth_tokens_hash_ux").on(t.tokenHash),
    index("auth_tokens_user_purpose_ix").on(t.userId, t.purpose),
    index("auth_tokens_expires_ix").on(t.expiresAt),
    oneOf("auth_tokens_purpose_ck", "purpose", AUTH_TOKEN_PURPOSES),
  ],
)

/** Admin TOTP (RFC 6238). `enabled_at` null = enrolment started but not confirmed. */
export const adminMfa = pgTable("admin_mfa", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  secretEnc: text("secret_enc").notNull(),
  enabledAt: tz("enabled_at"),
  /** The last accepted time step, so a code can't be replayed. */
  lastStep: integer("last_step").notNull().default(0),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
})

export const mfaRecoveryCodes = pgTable(
  "mfa_recovery_codes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
    usedAt: tz("used_at"),
  },
  (t) => [uniqueIndex("mfa_recovery_codes_hash_ux").on(t.codeHash), index("mfa_recovery_codes_user_ix").on(t.userId)],
)

/**
 * How a session was established. A session with no row here is a demo session (POST /api/auth/demo
 * creates none). `reauth_at` feeds requireRecentReauth(); `mfa_at` is set for admin sessions.
 */
export const sessionAuth = pgTable(
  "session_auth",
  {
    sessionId: text("session_id")
      .primaryKey()
      .references(() => sessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    mfaAt: tz("mfa_at"),
    reauthAt: tz("reauth_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [index("session_auth_user_ix").on(t.userId), oneOf("session_auth_method_ck", "method", AUTH_METHODS)],
)

/** Brand team invites. Only sha256 of the token is stored; one pending invite per brand and email. */
export const brandInvites = pgTable(
  "brand_invites",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    email: text("email").notNull(),
    role: text("role").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("pending"),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => users.id),
    createdAt: tz("created_at").notNull().defaultNow(),
    expiresAt: tz("expires_at").notNull(),
    acceptedAt: tz("accepted_at"),
    acceptedBy: text("accepted_by").references(() => users.id),
    revokedAt: tz("revoked_at"),
    revokedBy: text("revoked_by").references(() => users.id),
    /** 'team' (a team invite) or 'founding_claim' (the single-use claim link of a founding brand; role owner). */
    kind: text("kind").notNull().default("team"),
    /** founding_claim: the seller agreement version accepted and when (set on accept). */
    agreementVersion: text("agreement_version"),
    agreementAcceptedAt: tz("agreement_accepted_at"),
  },
  (t) => [
    uniqueIndex("brand_invites_token_ux").on(t.tokenHash),
    uniqueIndex("brand_invites_claim_pending_ux").on(t.brandId).where(raw("kind = 'founding_claim' and status = 'pending'")),
    oneOf("brand_invites_kind_ck", "kind", INVITE_KINDS),
    uniqueIndex("brand_invites_pending_ux").on(t.brandId, raw("lower(email)")).where(raw("status = 'pending'")),
    index("brand_invites_brand_ix").on(t.brandId, t.createdAt.desc()),
    oneOf("brand_invites_role_ck", "role", TEAM_ROLES),
    oneOf("brand_invites_status_ck", "status", INVITE_STATUSES),
  ],
)

/** Shopper account deletion requests, processed by the erasure job. */
export const accountDeletions = pgTable(
  "account_deletions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("pending"),
    requestedAt: tz("requested_at").notNull().defaultNow(),
    scheduledFor: tz("scheduled_for").notNull(),
    completedAt: tz("completed_at"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** Which erasure steps ran (module names), never personal data. */
    meta: jsonb("meta").notNull().default(raw("'{}'::jsonb")),
  },
  (t) => [
    uniqueIndex("account_deletions_open_ux").on(t.userId).where(raw("status in ('pending', 'processing')")),
    index("account_deletions_due_ix").on(t.status, t.scheduledFor),
    oneOf("account_deletions_status_ck", "status", DELETION_STATUSES),
  ],
)

/**
 * Native app sign-in hand-off (Google/Apple/Auth0 in a Custom Tab, whose cookies aren't the app's).
 * The OAuth callback of an app flow opens no session: it stores one of these (code as sha256 only,
 * 120 s, single use) and redirects to yard://auth/complete?code=…; the app then POSTs the code
 * with its verifier to /api/auth/oauth/app-exchange, which opens the session in the app's own jar.
 */
export const authAppHandoffs = pgTable(
  "auth_app_handoffs",
  {
    id: text("id").primaryKey(),
    codeHash: text("code_hash").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actor: text("actor").notNull(),
    brandId: text("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    client: text("client").notNull(),
    challenge: text("challenge").notNull(),
    provider: text("provider").notNull(),
    mode: text("mode").notNull(),
    result: text("result").notNull(),
    isNew: boolean("is_new").notNull().default(false),
    used: boolean("used").notNull().default(false),
    createdAt: tz("created_at").notNull().defaultNow(),
    expiresAt: tz("expires_at").notNull(),
  },
  (t) => [
    uniqueIndex("auth_app_handoffs_code_hash_ux").on(t.codeHash),
    index("auth_app_handoffs_expires_ix").on(t.expiresAt),
    index("auth_app_handoffs_user_ix").on(t.userId),
    oneOf("auth_app_handoffs_client_ck", "client", APP_CLIENTS),
    oneOf("auth_app_handoffs_provider_ck", "provider", OAUTH_PROVIDERS),
    oneOf("auth_app_handoffs_actor_ck", "actor", SIGN_IN_ACTORS),
  ],
)
