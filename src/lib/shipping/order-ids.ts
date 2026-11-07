/**
 * Ids of orders placed at checkout. They live in this browser's stores (the pages read them
 * after hydration), so a server-rendered guard can only check their shape:
 * - v2 orders get server-minted ids, `or_<time in base36><8 base64url chars>` (`newId("or")`, §6.5);
 * - orders placed in a browser before v2 kept `mo_cg_<key>_<n>`.
 * Plain module, relative imports only, so the guards and plain-Node tests can share it.
 */
export const PLACED_ORDER_ID = /^or_[A-Za-z0-9_-]{12,24}$/
export const LEGACY_LOCAL_ORDER_ID = /^mo_cg_[a-z0-9]+_\d+$/

export function isPlacedOrderId(id: string): boolean {
  return PLACED_ORDER_ID.test(id) || LEGACY_LOCAL_ORDER_ID.test(id)
}
