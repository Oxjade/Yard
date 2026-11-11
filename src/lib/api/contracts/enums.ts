/**
 * The closed value sets shared by the database schema (its CHECK constraints) and the API
 * contracts (their zod enums). Plain TypeScript with no imports, so the schema files can load it
 * by relative path under drizzle-kit and `tsx --test` as well as under Next (§1.4, §1.8).
 */

export const USER_KINDS = ["shopper", "brand_staff", "admin"] as const
export const USER_STATUSES = ["active", "restricted", "suspended"] as const
export const BRAND_REVIEW_STATUSES = ["pending_review", "verified", "restricted", "suspended"] as const
export const TEAM_ROLES = ["owner", "admin", "designer", "fulfilment", "finance", "viewer"] as const
export const MEMBER_STATUSES = ["active", "invited"] as const
export const ADMIN_ROLES = ["owner", "finance", "trust_safety", "support", "ads_ops", "engineering"] as const
export const ACTOR_KINDS = ["shopper", "brand", "admin"] as const
export const SOCIAL_PROVIDERS = ["instagram", "tiktok"] as const
export const SOCIAL_MODES = ["live", "sandbox"] as const

export const MEDIA_OWNER_KINDS = ["brand", "user", "system"] as const
export const MEDIA_PURPOSES = ["social_post", "inbox_attachment", "location_image", "social_import", "sample", "onboarding_image", "storefront_cover"] as const
export const MEDIA_MIMES = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"] as const
export const MEDIA_VISIBILITIES = ["private", "public"] as const
export const MEDIA_MODERATION = ["ok", "pending", "removed"] as const
export const MEDIA_SOURCES = ["upload", "instagram", "tiktok", "sandbox", "seed"] as const

export const SOCIAL_ACCOUNT_STATUSES = ["connected", "needs_reauth", "error", "revoked", "disconnected"] as const
export const SOCIAL_POST_SOURCES = ["instagram", "tiktok", "upload", "sandbox", "sample"] as const
export const SOCIAL_POST_KINDS = ["image", "video", "carousel"] as const
export const PUBLISH_VISIBILITIES = ["draft", "published", "hidden"] as const
export const SOCIAL_POST_MODERATION = ["ok", "flagged", "removed"] as const

export const CONVERSATION_STATUSES = ["open", "resolved"] as const
export const SPAM_STATES = ["none", "suspected", "confirmed"] as const
export const CONVERSATION_ORIGINS = ["storefront", "product", "order", "inbox"] as const
export const CONVERSATION_TOPICS = ["sizing", "availability", "delivery", "drops", "product", "order", "other"] as const
export const PARTICIPANT_SIDES = ["customer", "brand"] as const
export const MESSAGE_SIDES = ["customer", "brand", "system"] as const
export const MESSAGE_KINDS = ["text", "product", "order", "image", "system"] as const
export const MESSAGE_STATUSES = ["sent", "held", "removed"] as const
export const BLOCKER_KINDS = ["brand", "shopper"] as const
export const BLOCKED_KINDS = ["shopper", "brand"] as const

export const REPORT_SUBJECTS = ["message", "conversation", "social_post", "location", "location_event"] as const
export const REPORTER_KINDS = ["shopper", "brand", "admin", "system"] as const
export const REPORT_STATUSES = ["open", "in_review", "actioned", "dismissed", "escalated"] as const
export const ABUSE_ACTOR_KINDS = ["shopper", "brand", "anon", "admin", "system"] as const
export const ABUSE_RULES = [
  "rate_limit",
  "daily_cap",
  "first_contact_cap",
  "spam_duplicate",
  "spam_links",
  "spam_offplatform",
  "spam_brand_offplatform",
  "blocked_send",
  "signal_dedupe",
  "signal_ip_cap",
  "signal_anon",
  "spam_marked_by_brand",
  "stream_cap",
] as const
export const ABUSE_SUBJECT_KINDS = ["user", "brand"] as const
export const ABUSE_ALERT_KINDS = ["spam_marks", "rate_limit_burst", "report_volume"] as const
export const ABUSE_ALERT_STATUSES = ["open", "confirmed", "dismissed"] as const
export const RESTRICTION_KINDS = ["messaging", "uploads", "reports", "social_disabled", "charts_freeze"] as const
export const RESTRICTION_STATUSES = ["pending_approval", "active", "lifted"] as const

export const CHART_EVENT_KINDS = [
  "follow",
  "unfollow",
  "wishlist_add",
  "wishlist_remove",
  "reminder_set",
  "reminder_unset",
  "product_view",
  "storefront_view",
  "post_open",
  "message_started",
  "order_placed",
  "order_cancelled",
] as const
/** The kinds POST /api/signals accepts; the rest are written by the server only (§6.3). */
export const CLIENT_SIGNAL_KINDS = ["follow", "unfollow", "wishlist_add", "wishlist_remove", "reminder_set", "reminder_unset", "product_view", "storefront_view", "post_open"] as const
export const SIGNAL_ACTOR_KINDS = ["shopper", "anon"] as const
export const SIGNAL_VERDICTS = ["counted", "deduped", "excluded_self", "excluded_restricted", "excluded_fraud", "excluded_anon"] as const
export const CHART_KINDS = ["top", "trending", "emerging", "most_followed", "most_wishlisted", "top_drops", "city"] as const
export const CHART_PERIODS = ["daily", "weekly", "monthly"] as const
export const EDITION_STATUSES = ["live", "final"] as const
export const CHART_SUBJECT_TYPES = ["brand", "drop"] as const
export const CHART_MOVEMENTS = ["up", "down", "same", "new", "reentry"] as const
export const CHART_DETECTORS = ["velocity_spike", "ip_concentration", "new_account_share", "self_engagement", "wishlist_churn", "order_anomaly", "coordinated_ring"] as const
export const SEVERITIES = ["low", "medium", "high"] as const
export const FLAG_AUTO_ACTIONS = ["none", "excluded_signals", "held_from_charts"] as const
export const FLAG_STATUSES = ["open", "cleared", "confirmed", "frozen"] as const

export const LOCATION_KINDS = ["store", "showroom", "popup", "exhibition"] as const
export const PIN_PRECISIONS = ["street", "area"] as const
export const PLACE_MODERATION = ["approved", "pending_review", "rejected", "removed"] as const
export const LOCATION_EVENT_KINDS = ["drop_launch", "promotion", "exhibition", "talk", "sale", "popup_day"] as const

export const ZONE_KINDS = ["domestic", "regional", "international", "custom"] as const
export const SHIPPING_SERVICES = ["standard", "express", "pickup"] as const
export const HOLIDAY_KINDS = ["public", "carrier"] as const
export const HOLIDAY_SOURCES = ["config", "admin"] as const
export const ORDER_REF_SOURCES = ["seed", "browser"] as const
export const ESTIMATE_BASES = ["placed", "shipped", "in_transit", "out_for_delivery", "delivered", "late", "exception"] as const
export const SHIPMENT_STATUSES = ["label_created", "shipped", "in_transit", "out_for_delivery", "delivered", "exception", "returned"] as const
export const SHIPMENT_SOURCES = ["merchant", "carrier", "system"] as const
export const COMPLAINT_KINDS = ["late", "not_received", "damaged", "wrong_item", "wrong_address", "other"] as const
export const COMPLAINT_STATUSES = ["open", "waiting_brand", "brand_responded", "resolved", "escalated"] as const

export const AUDIT_ACTOR_KINDS = ["admin", "brand", "shopper", "system"] as const
export const RECIPIENT_KINDS = ["shopper", "brand", "admin"] as const
