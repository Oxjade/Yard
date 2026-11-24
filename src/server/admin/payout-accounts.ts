import "server-only"
import type { AdminPayoutAccountsDto, AdminPayoutAccountsQuery } from "@/lib/api/contracts/admin-payout-accounts"
import { db } from "../db"
import { listPayoutAccountsDb, type Db } from "./payout-accounts-db"

/** Admin › Finance › Payout accounts: every brand's payout account, masked (payout-accounts-db.ts). */
export async function listPayoutAccounts(query: AdminPayoutAccountsQuery): Promise<AdminPayoutAccountsDto> {
  return listPayoutAccountsDb((await db()) as unknown as Db, query)
}
