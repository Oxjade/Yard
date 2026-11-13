import { boolean, check, doublePrecision, index, jsonb, pgTable, text } from "drizzle-orm/pg-core"
import { LOCATION_EVENT_KINDS, LOCATION_KINDS, PIN_PRECISIONS, PLACE_MODERATION, PUBLISH_VISIBILITIES } from "../../../lib/api/contracts/enums"
import { brands } from "./brands"
import { oneOf, raw, tz } from "./columns"
import { users } from "./people"

export type PlaceImage = { mediaId?: string; src: string; alt: string; width: number; height: number }
/** Opening hours per weekday: a list of [open, close] 'HH:MM' pairs, or null for closed. */
export type PlaceHours = Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", [string, string][] | null>

/** Merchant-published places (§3.6). Public reads go only through around's publicPlaces(). */
export const brandLocations = pgTable(
  "brand_locations",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    addressLine: text("address_line").notNull(),
    /** Postal code, when the place has one (optional; many markets don't use them). */
    postcode: text("postcode"),
    neighbourhood: text("neighbourhood"),
    city: text("city").notNull(),
    citySlug: text("city_slug").notNull(),
    country: text("country").notNull(),
    inGazetteer: boolean("in_gazetteer").notNull().default(true),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    pinPrecision: text("pin_precision").notNull().default("area"),
    tileKey: text("tile_key").generatedAlwaysAs(raw("(floor(lat)::int::text || '_' || floor(lng)::int::text)")),
    timeZone: text("time_zone").notNull(),
    hours: jsonb("hours").$type<PlaceHours>(),
    byAppointment: boolean("by_appointment").notNull().default(false),
    hoursNote: text("hours_note"),
    startsAt: tz("starts_at"),
    endsAt: tz("ends_at"),
    images: jsonb("images").$type<PlaceImage[]>().notNull().default(raw("'[]'::jsonb")),
    featuredProductIds: text("featured_product_ids").array().notNull().default(raw("'{}'::text[]")),
    description: text("description"),
    visibility: text("visibility").notNull().default("draft"),
    moderationStatus: text("moderation_status").notNull().default("approved"),
    moderationReason: text("moderation_reason"),
    reviewedAt: tz("reviewed_at"),
    sample: boolean("sample").notNull().default(false),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
    publishedAt: tz("published_at"),
  },
  (t) => [
    index("brand_locations_public_tile_ix").on(t.tileKey).where(raw("visibility = 'published' and moderation_status = 'approved'")),
    index("brand_locations_brand_ix").on(t.brandId),
    index("brand_locations_city_ix").on(t.citySlug),
    index("brand_locations_ends_ix").on(t.endsAt),
    oneOf("brand_locations_kind_ck", "kind", LOCATION_KINDS),
    oneOf("brand_locations_pin_ck", "pin_precision", PIN_PRECISIONS),
    oneOf("brand_locations_visibility_ck", "visibility", PUBLISH_VISIBILITIES),
    oneOf("brand_locations_moderation_ck", "moderation_status", PLACE_MODERATION),
    check("brand_locations_name_len_ck", raw("length(name) between 1 and 80")),
    check("brand_locations_address_len_ck", raw("length(address_line) between 1 and 140")),
    check("brand_locations_lat_ck", raw("lat between -90 and 90")),
    check("brand_locations_lng_ck", raw("lng between -180 and 180")),
    check("brand_locations_hours_note_len_ck", raw("hours_note is null or length(hours_note) <= 120")),
    check("brand_locations_dated_kind_ck", raw("(kind in ('popup', 'exhibition')) = (starts_at is not null and ends_at is not null)")),
    check("brand_locations_dates_ck", raw("ends_at is null or ends_at > starts_at")),
    check("brand_locations_images_len_ck", raw("jsonb_array_length(images) <= 6")),
    check("brand_locations_products_len_ck", raw("coalesce(array_length(featured_product_ids, 1), 0) <= 8")),
    check("brand_locations_description_len_ck", raw("description is null or length(description) <= 600")),
  ],
)

export const locationEvents = pgTable(
  "location_events",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    locationId: text("location_id")
      .notNull()
      .references(() => brandLocations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    startsAt: tz("starts_at").notNull(),
    endsAt: tz("ends_at").notNull(),
    dropId: text("drop_id"),
    productIds: text("product_ids").array().notNull().default(raw("'{}'::text[]")),
    promoText: text("promo_text"),
    image: jsonb("image").$type<PlaceImage>(),
    visibility: text("visibility").notNull().default("draft"),
    moderationStatus: text("moderation_status").notNull().default("approved"),
    moderationReason: text("moderation_reason"),
    reviewedAt: tz("reviewed_at"),
    sample: boolean("sample").notNull().default(false),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("location_events_location_ix").on(t.locationId, t.startsAt),
    index("location_events_window_ix").on(t.startsAt, t.endsAt),
    oneOf("location_events_kind_ck", "kind", LOCATION_EVENT_KINDS),
    oneOf("location_events_visibility_ck", "visibility", PUBLISH_VISIBILITIES),
    oneOf("location_events_moderation_ck", "moderation_status", PLACE_MODERATION),
    check("location_events_title_len_ck", raw("length(title) between 1 and 80")),
    check("location_events_description_len_ck", raw("description is null or length(description) <= 600")),
    check("location_events_dates_ck", raw("ends_at > starts_at")),
    check("location_events_promo_len_ck", raw("promo_text is null or length(promo_text) <= 120")),
  ],
)
