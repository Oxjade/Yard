import { route } from "@/server/http/route"
import { adminCouriers } from "@/server/shipping/courier-admin"

/** GET /api/admin/delivery/couriers (shipping.view): booked courier shipments, courier money collected vs spent, provider failures and the wallet balance (read-only). */
export const GET = route({ auth: "admin", permission: "shipping.view", rate: { key: "admin.delivery.couriers", limit: 60, windowSec: 60 } }, async () => adminCouriers())
