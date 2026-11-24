import "server-only"
import { eq } from "drizzle-orm"
import type { CourierSettingsBody, CourierSettingsDto } from "@/lib/api/contracts/shipping"
import type { BrandActor } from "../auth/dal"
import { writeAudit } from "../audit"
import { db } from "../db"
import { courierSettings } from "../db/schema/courier"
import { badRequest } from "../http/errors"
import { courierBlocker, invalidateCourierSettings, noteCourierFailure } from "./courier-quote"
import { loadBrandShipping } from "./profile"
import { courierConfig, getCourier } from "./providers"
import { CourierError } from "./providers/courier-types"

/**
 * Studio › Shipping › Courier pickup (docs/SHIPPING.md): where couriers collect from, checked with
 * the provider's address validation when one is connected, and the default parcel.
 */

type Row = typeof courierSettings.$inferSelect

function toDto(row: Row | null, blocker: string | null): CourierSettingsDto {
  const p = getCourier()
  const cfg = courierConfig()
  return {
    available: !!p,
    provider: p ? { id: p.id, label: p.label, sandbox: p.sandbox } : null,
    currency: cfg.currency,
    originCountries: cfg.originCountries,
    settings: row
      ? {
          contactName: row.contactName,
          phone: row.phone,
          email: row.email,
          address: row.address,
          city: row.city,
          state: row.state,
          country: row.country,
          parcelWeightGrams: row.parcelWeightGrams,
          parcelLengthCm: row.parcelLengthCm,
          parcelWidthCm: row.parcelWidthCm,
          parcelHeightCm: row.parcelHeightCm,
          verified: !!(p && row.verifiedAt && row.provider === p.id && row.providerAddressCode),
          formattedAddress: row.formattedAddress,
          verifiedAt: row.verifiedAt?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
        }
      : null,
    blocker,
  }
}

async function read(brandId: string) {
  const d = await db()
  const [row] = await d.select().from(courierSettings).where(eq(courierSettings.brandId, brandId)).limit(1)
  return row ?? null
}

export async function studioCourierSettings(actor: BrandActor): Promise<CourierSettingsDto> {
  const row = await read(actor.brandId)
  const s = await loadBrandShipping(actor.brandId)
  return toDto(row, s ? courierBlocker(s, row, getCourier()) : "Set up your shipping profile first.")
}

/**
 * Saves the pickup address and parcel. With a provider connected the address is validated there
 * first: a refusal is shown on the address field and nothing is saved; the provider being down
 * saves it unverified (shoppers keep the brand's own rates until it's verified).
 */
export async function saveCourierSettings(actor: BrandActor, body: CourierSettingsBody, ipHash: string | null): Promise<CourierSettingsDto> {
  const cfg = courierConfig()
  if (!cfg.originCountries.includes(body.country)) throw badRequest({ country: `Couriers collect in ${cfg.originCountries.join(", ")} only for now.` })
  const p = getCourier()
  const line = [body.address, body.city, body.state].map((x) => x?.trim()).filter(Boolean).join(", ")
  let verified: { code: string; formatted: string | null } | null = null
  let unverifiedReason: string | null = null
  if (p) {
    try {
      verified = await p.validateAddress({ name: body.contactName, email: body.email, phone: body.phone, address: line, city: body.city, state: body.state, country: body.country })
    } catch (e) {
      // A definite "no" from the provider: the address is wrong. Anything else: it couldn't answer.
      if (e instanceof CourierError && e.kind === "refused") throw badRequest({ address: `${p.label} couldn't verify this address (${e.message.replace(/\.$/, "").slice(0, 120)}). Check the street, area and city.` })
      await noteCourierFailure(p.id, "quote_failed", e, { brandId: actor.brandId })
      unverifiedReason = `${p.label} couldn't be reached, so the address is saved but not verified yet. Save again in a few minutes.`
    }
  }
  const now = new Date()
  const values = {
    contactName: body.contactName,
    phone: body.phone,
    email: body.email,
    address: body.address,
    city: body.city,
    state: body.state ?? "",
    country: body.country,
    provider: verified ? p!.id : null,
    providerAddressCode: verified?.code ?? null,
    formattedAddress: verified?.formatted ?? null,
    verifiedAt: verified ? now : null,
    parcelWeightGrams: body.parcelWeightGrams,
    parcelLengthCm: body.parcelLengthCm,
    parcelWidthCm: body.parcelWidthCm,
    parcelHeightCm: body.parcelHeightCm,
    updatedBy: actor.userId,
    updatedAt: now,
  }
  const d = await db()
  await d
    .insert(courierSettings)
    .values({ brandId: actor.brandId, ...values })
    .onConflictDoUpdate({ target: courierSettings.brandId, set: values })
  invalidateCourierSettings(actor.brandId)
  await writeAudit({
    actor: { kind: "brand", id: actor.userId, name: actor.name, role: actor.role },
    action: "shipping.courier_pickup_saved",
    target: actor.brand.name,
    subjectType: "brand",
    subjectId: actor.brandId,
    brandId: actor.brandId,
    ipHash,
    meta: { provider: verified ? p!.id : null, verified: !!verified, city: body.city, country: body.country },
  })
  const dto = await studioCourierSettings(actor)
  return { ...dto, notice: unverifiedReason }
}
