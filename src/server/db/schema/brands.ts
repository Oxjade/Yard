import { boolean, check, date, index, integer, pgTable, text, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core"
import { BRAND_MEMBER_ROLES, BRAND_REVIEW_STATUSES, CLAIM_STATUSES, MEMBER_STATUSES } from "../../../lib/api/contracts/enums"
import { oneOf, raw, tz } from "./columns"
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
    /**
     * Founding brands (set up by Yard before launch, then claimed by their owner). `claim_status`
     * 'none' is every ordinary brand; 'unclaimed' is visible once launched but never for sale;
     * 'claimed' sells, with or without a payout account (catalog/sellable.ts brandForSaleSql).
     */
    founding: boolean("founding").notNull().default(false),
    foundingBadge: boolean("founding_badge").notNull().default(false),
    claimStatus: text("claim_status").notNull().default("none"),
    claimedAt: tz("claimed_at"),
    claimedBy: text("claimed_by").references((): AnyPgColumn => users.id),
    /** Set on the first storefront publish. A founding brand is public only from then on. */
    launchedAt: tz("launched_at"),
    /**
     * "Go live when they claim" (Admin › Founding tray): when the owner claims the brand, its
     * Yard-prepared storefront is published and Yard's pending product suggestions are accepted in
     * the same flow (auth/claims.ts). On for founding brands created from 0022 on; off for older ones.
     */
    goLiveOnClaim: boolean("go_live_on_claim").notNull().default(false),
    story: text("story"),
    logoMediaId: text("logo_media_id"),
    /** Handles only (no @, no URL). */
    instagram: text("instagram"),
    tiktok: text("tiktok"),
    sellerAgreementVersion: text("seller_agreement_version"),
    sellerAgreementAcceptedAt: tz("seller_agreement_accepted_at"),
    /** The admin who created a founding brand, and their idempotency key for that create. */
    createdBy: text("created_by").references((): AnyPgColumn => users.id),
    creationKey: text("creation_key"),
    /**
     * Friendly reminder emails from Yard (draft and storefront nudges, catalog/nudges.ts). An owner
     * or admin switches them off in Studio settings; decision emails are never affected.
     */
    nudgeEmails: boolean("nudge_emails").notNull().default(true),
    /** The last reminder email sent to this brand (a 24-hour cooldown between reminders). */
    lastNudgedAt: tz("last_nudged_at"),
    /** Set when the "publish your storefront" reminder went out (once per brand). */
    storefrontNudgedAt: tz("storefront_nudged_at"),
    /**
     * Admin › Brands › Delete brand on a brand with orders or money on record (catalog/brand-removal.ts):
     * the brand is closed instead of erased. Terminal: review_status stays 'suspended' (so every
     * public read and sign-in already refuses it), its products are archived, and nothing reinstates it.
     * The row, its handle and everything its orders reference stay.
     */
    closedAt: tz("closed_at"),
    closedBy: text("closed_by").references((): AnyPgColumn => users.id),
    /**
     * Admin › Brands › Unpublish storefront: Yard took the brand's shop off the marketplace (its
     * storefront, products and listing are hidden, catalog/sellable.ts brandLaunchedSql) without
     * restricting the brand. Cleared by Publish storefront. Null for every brand Yard hasn't unpublished.
     */
    unpublishedAt: tz("unpublished_at"),
    unpublishedBy: text("unpublished_by").references((): AnyPgColumn => users.id),
    /**
     * "Add your payout account" emails (ledger/payout-needed-db.ts, docs/BRAND-EMAILS.md › Payout
     * account needed): the brand's first paid sale while it had no payout account (the 3-day
     * reminder's clock), the last such email (at most one per 24 hours) and the one reminder.
     */
    payoutNeededSince: tz("payout_needed_since"),
    payoutNeededEmailedAt: tz("payout_needed_emailed_at"),
    payoutNeededRemindedAt: tz("payout_needed_reminded_at"),
  },
  (t) => [
    uniqueIndex("brands_handle_ux").on(t.handle),
    index("brands_city_slug_ix").on(t.citySlug),
    index("brands_review_status_ix").on(t.reviewStatus),
    oneOf("brands_review_status_ck", "review_status", BRAND_REVIEW_STATUSES),
    oneOf("brands_claim_status_ck", "claim_status", CLAIM_STATUSES),
    uniqueIndex("brands_creation_key_ux").on(t.createdBy, t.creationKey).where(raw("creation_key is not null")),
    index("brands_founding_ix").on(t.claimStatus, t.launchedAt).where(raw("founding")),
    /** The payout-account reminder's one query: brands with an unpaid-out sale not reminded yet. */
    index("brands_payout_needed_ix").on(t.payoutNeededSince).where(raw("payout_needed_since is not null and payout_needed_reminded_at is null")),
    check("brands_story_len_ck", raw("story is null or char_length(story) <= 2000")),
    check("brands_instagram_ck", raw("instagram is null or instagram ~ '^[A-Za-z0-9._]{1,30}$'")),
    check("brands_tiktok_ck", raw("tiktok is null or tiktok ~ '^[A-Za-z0-9._]{1,24}$'")),
    check("brands_founding_claim_ck", raw("(founding and claim_status <> 'none') or (not founding and claim_status = 'none')")),
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
    /** Who granted a yard_setup membership (the admin); null for team members. */
    grantedBy: text("granted_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("brand_members_brand_user_ux").on(t.brandId, t.userId),
    index("brand_members_user_ix").on(t.userId),
    oneOf("brand_members_role_ck", "role", BRAND_MEMBER_ROLES),
    oneOf("brand_members_status_ck", "status", MEMBER_STATUSES),
  ],
)
