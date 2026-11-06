import { pgTable, text } from "drizzle-orm/pg-core"
import { tz } from "./columns"
import { socialAccounts } from "./social"

/**
 * Sealed OAuth tokens (vault format v1.<iv>.<tag>.<ct>, §5.5). NOT part of the runtime schema
 * object (schema/index.ts leaves it out), and ESLint lets only src/server/social/** import this
 * file, so a plain select on social_accounts can never load a token. drizzle.config.ts globs the
 * folder, so the table is still migrated.
 */
export const socialTokens = pgTable("social_tokens", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => socialAccounts.id, { onDelete: "cascade" }),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc"),
  sealedAt: tz("sealed_at").notNull().defaultNow(),
})
