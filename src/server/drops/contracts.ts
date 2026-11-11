import { z } from "zod"
import { safeId, safeLine, safeText } from "@/lib/api/contracts/common"

/** Drops request contracts (zod 4). Bodies are strict: a client can never name a brandId, a status or a seed. */

const slug = z
  .string()
  .min(2, { error: "Use at least 2 characters." })
  .max(80, { error: "Keep it to 80 characters." })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: "Use lowercase letters, numbers and single hyphens." })
const when = z.iso.datetime({ offset: true, error: "Use a date and time with a time zone." })

const fields = {
  name: safeLine({ max: 120 }).min(1, { error: "Name the drop." }),
  slug: slug.optional(),
  description: safeText({ max: 2000 }),
  /** A media id of the brand's or a /media path. */
  image: z.string().max(300).regex(/^(\/media\/[\w./-]+|[A-Za-z0-9_-]{1,80})$/, { error: "Choose an uploaded image." }).nullable(),
  access: z.enum(["first_come", "draw", "early_access"]),
  startsAt: when,
  endsAt: when,
  earlyAccessAt: when.nullable(),
  entryOpensAt: when.nullable(),
  entryClosesAt: when.nullable(),
  purchaseWindowMinutes: z.number().int().min(5).max(10080),
  winnersCount: z.number().int().min(1).max(100_000).nullable(),
  limitPerCustomer: z.number().int().min(1).max(20),
  totalUnits: z.number().int().min(0).max(1_000_000),
  reminderLeadMinutes: z.number().int().min(0).max(10080),
  productIds: z.array(safeId()).min(1, { error: "Add at least one product." }).max(20),
  /** A subset of the products' variants; omit for all of them. */
  variantIds: z.array(safeId()).max(500).nullable(),
}

export const dropCreateBody = z.strictObject({
  ...fields,
  description: fields.description.default(""),
  image: fields.image.optional(),
  earlyAccessAt: fields.earlyAccessAt.optional(),
  entryOpensAt: fields.entryOpensAt.optional(),
  entryClosesAt: fields.entryClosesAt.optional(),
  purchaseWindowMinutes: fields.purchaseWindowMinutes.default(1440),
  winnersCount: fields.winnersCount.optional(),
  limitPerCustomer: fields.limitPerCustomer.default(1),
  totalUnits: fields.totalUnits.default(0),
  reminderLeadMinutes: fields.reminderLeadMinutes.default(60),
  variantIds: fields.variantIds.optional(),
})
export type DropCreateBody = z.output<typeof dropCreateBody>

export const dropUpdateBody = z.strictObject(fields).partial().extend({ expectedVersion: z.number().int().positive() })
export type DropUpdateBody = z.output<typeof dropUpdateBody>

export const dropVersionBody = z.strictObject({ expectedVersion: z.number().int().positive() })

export const dropListQuery = z.object({
  phase: z.enum(["upcoming", "live", "ended", "all"]).optional(),
  /** "brands" leaves out the seeded sample drops (demo pages show those on the demo clock). */
  source: z.enum(["all", "brands"]).optional(),
  brandId: safeId().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().max(40).regex(/^\d+$/).optional(),
})

export const studioDropListQuery = z.object({
  status: z.enum(["draft", "scheduled", "live", "ended", "cancelled", "all"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().max(40).regex(/^\d+$/).optional(),
})
