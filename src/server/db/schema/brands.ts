import { boolean, date, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core"
import { BRAND_REVIEW_STATUSES, MEMBER_STATUSES, TEAM_ROLES } from "../../../lib/api/contracts/enums"
import { oneOf, tz } from "./columns"
import { users } from "./people"

/** A server mirror of src/lib/data/brands.ts, used for FKs, eligibility and names (§3.1). */
export const brands = pgTable(
  "brands",
  {
    id: text("id").primaryKey(),
    handle: text("handle").notNull(),
    name: text("name").notNull(),
    city: text("city").notNull(),
    citySlug: text("city_slug").notNull(),
    country: text("country").notNull(),
    currency: text("currency").notNull(),
    categories: text("categories").array().notNull(),
    verified: boolean("verified").notNull().default(false),
    reviewStatus: text("review_status").notNull().default("pending_review"),
    joinedAt: date("joined_at", { mode: "string" }),
    followersBase: integer("followers_base").notNull(),
    timeZone: text("time_zone").notNull(),
  },
  (t) => [
    uniqueIndex("brands_handle_ux").on(t.handle),
    index("brands_city_slug_ix").on(t.citySlug),
    index("brands_review_status_ix").on(t.reviewStatus),
    oneOf("brands_review_status_ck", "review_status", BRAND_REVIEW_STATUSES),
  ],
)

export const brandMembers = pgTable(
  "brand_members",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull().references(() => brands.id),
    userId: text("user_id").notNull().references(() => users.id),
    role: text("role").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("brand_members_brand_user_ux").on(t.brandId, t.userId),
    index("brand_members_user_ix").on(t.userId),
    oneOf("brand_members_role_ck", "role", TEAM_ROLES),
    oneOf("brand_members_status_ck", "status", MEMBER_STATUSES),
  ],
)
