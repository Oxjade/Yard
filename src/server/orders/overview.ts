import "server-only"
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm"
import { z } from "zod"
import { db } from "../db"
import { orderRefs } from "../db/schema"
import { catalogImages } from "../db/schema/catalog"
import { orderLines, orderStates } from "../db/schema/orders-v3"
import { mediaSrc } from "../media/dto"
import { brandOrders } from "./views"

/** GET /api/studio/overview?days= (7, 30 or 90; 30 by default). */
export const studioOverviewQuery = z.object({ days: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).default(30) })

/**
 * Payment captured: the same rule as the Orders page's views (a v3 state row when there is one,
 * else the order_ref's own paid flag), so the Overview never counts an order the Orders page calls unpaid.
 */
const paymentSql = sql<string>`coalesce(${orderStates.paymentStatus}, case when ${orderRefs.status} = 'refunded' then 'refunded' when ${orderRefs.paid} then 'paid' else 'pending' end)`
const captured = sql`${paymentSql} in ('paid', 'partially_refunded')`

/**
 * The Studio Overview for a real brand, from the database only (no sample data):
 * - `sales`: captured orders placed in the last `days` and the `days` before, per currency (orders
 *   are priced in the brand's currency, so normally one row). Gross is the order total; refunded
 *   is what has gone back so far, so net = gross - refunded.
 * - `toShip`: orders whose merchant status is Paid or Processing, the Orders page's two tabs of
 *   work not yet shipped.
 * - `recentOrders`: the latest six, as the Orders page lists them.
 * - `topProducts`: up to five products by units kept (ordered minus returned) in the window.
 */
export async function studioOverview(brandId: string, currency: string, days: 7 | 30 | 90) {
  const d = await db()
  const now = Date.now()
  const from = new Date(now - days * 86_400_000)
  const prevFrom = new Date(now - 2 * days * 86_400_000)

  const [salesRows, shipRows, recent, productRows] = await Promise.all([
    d
      .select({
        currency: orderRefs.currency,
        // Sums are bigint: sum() over an int column is bigint, and a brand's NGN sales in kobo pass
        // the int range (~₦21.47M) quickly. Read back as Number (exact up to 2^53).
        orders: sql<number>`count(*) filter (where ${orderRefs.placedAt} >= ${from})::int`,
        grossMinor: sql<number>`coalesce(sum(${orderRefs.totalMinor}) filter (where ${orderRefs.placedAt} >= ${from}), 0)::bigint`.mapWith(Number),
        refundedMinor: sql<number>`coalesce(sum(${orderStates.refundedMinor}) filter (where ${orderRefs.placedAt} >= ${from}), 0)::bigint`.mapWith(Number),
        prevOrders: sql<number>`count(*) filter (where ${orderRefs.placedAt} < ${from})::int`,
        prevGrossMinor: sql<number>`coalesce(sum(${orderRefs.totalMinor}) filter (where ${orderRefs.placedAt} < ${from}), 0)::bigint`.mapWith(Number),
        prevRefundedMinor: sql<number>`coalesce(sum(${orderStates.refundedMinor}) filter (where ${orderRefs.placedAt} < ${from}), 0)::bigint`.mapWith(Number),
      })
      .from(orderRefs)
      .leftJoin(orderStates, eq(orderStates.orderRefId, orderRefs.id))
      .where(and(eq(orderRefs.brandId, brandId), gte(orderRefs.placedAt, prevFrom), captured))
      .groupBy(orderRefs.currency),
    d
      .select({ status: orderRefs.status, n: sql<number>`count(*)::int` })
      .from(orderRefs)
      .where(and(eq(orderRefs.brandId, brandId), inArray(orderRefs.status, ["paid", "processing"])))
      .groupBy(orderRefs.status),
    brandOrders(brandId, { limit: 6 }),
    d
      .select({
        productId: orderLines.productId,
        title: sql<string>`max(${orderLines.title})`,
        currency: orderLines.currency,
        units: sql<number>`coalesce(sum(${orderLines.qty} - ${orderLines.returnedQty}), 0)::bigint`.mapWith(Number),
        revenueMinor: sql<number>`coalesce(sum((${orderLines.qty} - ${orderLines.returnedQty})::bigint * ${orderLines.unitMinor}), 0)::bigint`.mapWith(Number),
      })
      .from(orderLines)
      .innerJoin(orderRefs, eq(orderRefs.id, orderLines.orderRefId))
      .leftJoin(orderStates, eq(orderStates.orderRefId, orderRefs.id))
      .where(and(eq(orderRefs.brandId, brandId), gte(orderRefs.placedAt, from), captured))
      .groupBy(orderLines.productId, orderLines.currency)
      .having(sql`sum(${orderLines.qty} - ${orderLines.returnedQty}) > 0`)
      .orderBy(desc(sql`sum(${orderLines.qty} - ${orderLines.returnedQty})`), desc(sql`sum((${orderLines.qty} - ${orderLines.returnedQty})::bigint * ${orderLines.unitMinor})`))
      .limit(5),
  ])

  const productIds = productRows.map((p) => p.productId)
  const images = productIds.length
    ? await d.select().from(catalogImages).where(and(eq(catalogImages.brandId, brandId), inArray(catalogImages.productId, productIds))).orderBy(asc(catalogImages.position))
    : []
  const imageByProduct = new Map<string, (typeof images)[number]>()
  for (const image of images) if (!imageByProduct.has(image.productId)) imageByProduct.set(image.productId, image)

  const toShip = { paid: 0, processing: 0 }
  for (const r of shipRows) if (r.status === "paid" || r.status === "processing") toShip[r.status] = r.n

  return {
    days,
    currency,
    sales: salesRows,
    toShip: { total: toShip.paid + toShip.processing, ...toShip },
    recentOrders: recent.items,
    topProducts: productRows.map((p) => {
      const image = imageByProduct.get(p.productId)
      return {
        productId: p.productId,
        title: p.title,
        currency: p.currency,
        units: p.units,
        revenueMinor: p.revenueMinor,
        image: image ? { src: image.mediaId ? mediaSrc(image.mediaId) : (image.path ?? "/media/missing.svg"), alt: image.alt || p.title } : null,
      }
    }),
  }
}
