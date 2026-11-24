import "server-only"
import { and, eq } from "drizzle-orm"
import { barcodeBars, canEncode128B } from "@/lib/barcode128"
import { db } from "../db"
import { brands, orderRefs } from "../db/schema"
import { courierSettings, courierShipments } from "../db/schema/courier"
import { orderStates } from "../db/schema/orders-v3"
import { notFound, rule } from "../http/errors"

/**
 * Yard's printable parcel label for a booked courier shipment (docs/SHIPPING.md): sender, receiver,
 * courier, tracking code as a Code 128 barcode, and the order reference. The courier's own waybill
 * (when the provider gives one) is linked from Studio as well; some couriers need it attached.
 */

const esc = (s: string | null | undefined) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

function barcodeSvg(text: string) {
  if (!text || !canEncode128B(text)) return ""
  const { bars, width } = barcodeBars(text)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 60" preserveAspectRatio="none" width="100%" height="70" role="img" aria-label="Barcode ${esc(text)}">${bars.map(([x, w]) => `<rect x="${x}" y="0" width="${w}" height="60"/>`).join("")}</svg>`
}

export async function courierLabelHtml(brandId: string, orderRefId: string): Promise<string> {
  const d = await db()
  const [row] = await d
    .select({ s: courierShipments, reference: orderRefs.reference, items: orderRefs.items, brand: brands.name })
    .from(courierShipments)
    .innerJoin(orderRefs, eq(orderRefs.id, courierShipments.orderRefId))
    .innerJoin(brands, eq(brands.id, courierShipments.brandId))
    .where(and(eq(courierShipments.orderRefId, orderRefId), eq(courierShipments.brandId, brandId)))
    .limit(1)
  if (!row) throw notFound()
  if (!["booked", "in_transit", "delivered"].includes(row.s.status)) throw rule("Book the pickup first.")
  const [from] = await d.select().from(courierSettings).where(eq(courierSettings.brandId, brandId)).limit(1)
  const [st] = await d.select({ shipTo: orderStates.shipTo }).from(orderStates).where(eq(orderStates.orderRefId, orderRefId)).limit(1)
  const to = (st?.shipTo ?? {}) as Record<string, string | undefined>
  const pieces = ((row.items ?? []) as { qty: number }[]).reduce((n, i) => n + (i.qty || 0), 0)
  const code = row.s.trackingCode ?? row.s.providerOrderId ?? ""
  const toLines = [to.name, to.line1, to.line2, [to.city, to.region].filter(Boolean).join(", "), to.postalCode ?? to.postcode, to.country, to.phone].filter(Boolean)
  const fromLines = from ? [from.contactName, row.brand, from.address, [from.city, from.state].filter(Boolean).join(", "), from.country, from.phone] : [row.brand]
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Label ${esc(row.reference)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #f4f4f5; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; }
  .bar { display: flex; gap: 8px; justify-content: center; padding: 16px; }
  button { font: inherit; padding: 8px 16px; border-radius: 8px; border: 1px solid #111; background: #111; color: #fff; cursor: pointer; }
  .label { box-sizing: border-box; width: 100mm; min-height: 150mm; margin: 0 auto 24px; background: #fff; border: 2px solid #111; padding: 6mm; display: grid; gap: 4mm; }
  .row { display: grid; gap: 1mm; border-bottom: 1px solid #111; padding-bottom: 3mm; }
  .k { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
  .big { font-size: 18px; font-weight: 700; }
  .code { font: 600 16px/1 ui-monospace, monospace; text-align: center; letter-spacing: .06em; }
  svg rect { fill: #000; }
  @media print { body { background: #fff; } .bar { display: none; } .label { margin: 0; border-width: 1px; } @page { size: 100mm 150mm; margin: 0; } }
</style></head>
<body>
<div class="bar"><button type="button" onclick="window.print()">Print label</button></div>
<main class="label">
  <div class="row"><span class="k">Courier</span><span class="big">${esc(row.s.courierName ?? "Courier")}</span></div>
  <div class="row"><span class="k">Deliver to</span>${toLines.map((l, i) => (i === 0 ? `<span class="big">${esc(l)}</span>` : `<span>${esc(l)}</span>`)).join("")}</div>
  <div class="row"><span class="k">From</span>${fromLines.map((l) => `<span>${esc(l)}</span>`).join("")}</div>
  <div class="row"><span class="k">Order</span><span>${esc(row.reference)} · ${pieces} ${pieces === 1 ? "piece" : "pieces"}</span></div>
  <div>${barcodeSvg(code)}<p class="code">${esc(code)}</p></div>
</main>
</body></html>`
}
