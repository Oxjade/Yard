import { after } from "next/server"
import { json, route } from "@/server/http/route"
import { requestSync } from "@/server/social/service"
import { syncAccount } from "@/server/social/sync"

/** POST …/accounts/{id}/sync (social.connect): 202 and the sync runs after the response; 429 within 5 min. */
export const POST = route({ auth: "brand", permission: "social.connect" }, async ({ params }) => {
  const { accountId } = await requestSync(params.id ?? "")
  after(() => syncAccount(accountId, { trigger: "manual" }).then(() => undefined))
  return json({ accountId, syncing: true }, 202)
})
