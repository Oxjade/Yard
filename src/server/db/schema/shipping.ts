import { boolean, check, date, index, integer, pgTable, smallint, text, uniqueIndex } from "drizzle-orm/pg-core"
import { HOLIDAY_KINDS, HOLIDAY_SOURCES, SHIPPING_SERVICES, ZONE_KINDS } from "../../../lib/api/contracts/enums"
import { brandLocations } from "./around"
import { brands } from "./brands"
import { oneOf, raw, tz } from "./columns"

/** A brand's dispatch settings (§3.7). `updated_by` stays null until a brand member saves. */
export const shippingProfiles = pgTable(
  "shipping_profiles",
  {
    brandId: text("brand_id")
      .primaryKey()
      .references(() => brands.id),
    originCountry: text("origin_country").notNull(),
    originCity: text("origin_city").notNull(),
    timeZone: text("time_zone").notNull(),
    handlingMin: smallint("handling_min").notNull(),
    handlingMax: smallint("handling_max").notNull(),
    cutoffLocal: text("cutoff_local").notNull().default("14:00"),
    /** bit0 Mon … bit6 Sun; 31 = Mon–Fri. */
    workdays: smallint("workdays").notNull().default(31),
    providerId: text("provider_id").notNull().default("manual"),
    currency: text("currency").notNull(),
    localPickup: boolean("local_pickup").notNull().default(false),
    pickupLocationId: text("pickup_location_id").references(() => brandLocations.id),
    updatedBy: text("updated_by"),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  () => [
    check("shipping_profiles_handling_min_ck", raw("handling_min between 0 and 30")),
    check("shipping_profiles_handling_max_ck", raw("handling_max between handling_min and 30")),
    check("shipping_profiles_cutoff_ck", raw("cutoff_local ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'")),
  ],
)

export const shippingZones = pgTable(
  "shipping_zones",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    /** Resolved country list; 'international' stores {*}: everything not covered by another zone. */
    countries: text("countries").array().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    position: smallint("position").notNull().default(0),
  },
  (t) => [
    uniqueIndex("shipping_zones_name_ux").on(t.brandId, t.name),
    oneOf("shipping_zones_kind_ck", "kind", ZONE_KINDS),
    check("shipping_zones_name_len_ck", raw("length(name) between 1 and 40")),
  ],
)

export const shippingMethods = pgTable(
  "shipping_methods",
  {
    id: text("id").primaryKey(),
    zoneId: text("zone_id")
      .notNull()
      .references(() => shippingZones.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    service: text("service").notNull(),
    label: text("label").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    transitMin: smallint("transit_min").notNull(),
    transitMax: smallint("transit_max").notNull(),
    carrierLabel: text("carrier_label"),
    position: smallint("position").notNull().default(0),
  },
  (t) => [
    uniqueIndex("shipping_methods_zone_service_ux").on(t.zoneId, t.service),
    oneOf("shipping_methods_service_ck", "service", SHIPPING_SERVICES),
    check("shipping_methods_label_len_ck", raw("length(label) between 1 and 40")),
    check("shipping_methods_transit_min_ck", raw("transit_min between 0 and 60")),
    check("shipping_methods_transit_max_ck", raw("transit_max between transit_min and 60")),
  ],
)

/** Tiered: the applicable rate is the row with the highest min_subtotal ≤ the subtotal; amount 0 is "free over X". */
export const shippingRates = pgTable(
  "shipping_rates",
  {
    id: text("id").primaryKey(),
    methodId: text("method_id")
      .notNull()
      .references(() => shippingMethods.id, { onDelete: "cascade" }),
    minSubtotalMinor: integer("min_subtotal_minor").notNull().default(0),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
  },
  (t) => [uniqueIndex("shipping_rates_tier_ux").on(t.methodId, t.minSubtotalMinor), check("shipping_rates_amount_ck", raw("amount_minor >= 0"))],
)

export const holidays = pgTable(
  "holidays",
  {
    id: text("id").primaryKey(),
    country: text("country").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("public"),
    estimated: boolean("estimated").notNull().default(false),
    source: text("source").notNull().default("config"),
    createdBy: text("created_by"),
  },
  (t) => [
    uniqueIndex("holidays_country_date_name_ux").on(t.country, t.date, t.name),
    index("holidays_country_date_ix").on(t.country, t.date),
    oneOf("holidays_kind_ck", "kind", HOLIDAY_KINDS),
    oneOf("holidays_source_ck", "source", HOLIDAY_SOURCES),
  ],
)

export const shippingClosures = pgTable(
  "shipping_closures",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    dateFrom: date("date_from", { mode: "string" }).notNull(),
    dateTo: date("date_to", { mode: "string" }).notNull(),
    reason: text("reason"),
  },
  (t) => [index("shipping_closures_brand_ix").on(t.brandId, t.dateFrom), check("shipping_closures_range_ck", raw("date_to >= date_from"))],
)
