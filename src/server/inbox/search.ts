import "server-only"
import { sql, type SQL } from "drizzle-orm"
import { conversations, messages } from "../db/schema"
import type { Side } from "./dto"

/**
 * Inbox search (§6.2). Only delivered messages match, plus the searcher's OWN held messages:
 * the other side's held or removed bodies never match, so search can't confirm their words.
 * Full text uses websearch_to_tsquery('simple', $1) with a bound parameter (it never throws on
 * user syntax); names use ILIKE with %, _ and \ escaped.
 */

export const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`)

const clean = (q: string) => q.replace(/\s+/g, " ").trim().slice(0, 100)

/** A message row this side may search: delivered, or held and sent by this side. */
function searchable(side: Side, alias: string) {
  return sql.raw(`(${alias}.status = 'sent' or (${alias}.status = 'held' and ${alias}.sender_side = '${side === "brand" ? "brand" : "customer"}'))`)
}

/** Conversations whose other party's name, or any searchable message, matches `q`. */
export function conversationMatch(side: Side, q: string): SQL | undefined {
  const text = clean(q)
  if (!text) return undefined
  const like = `%${escapeLike(text)}%`
  const name =
    side === "customer"
      ? sql`exists(select 1 from brands sb where sb.id = ${conversations.brandId} and sb.name ilike ${like} escape '\\')`
      : sql`exists(select 1 from users su where su.id = ${conversations.customerId} and su.name ilike ${like} escape '\\')`
  const body = sql`exists(select 1 from messages sm where sm.conversation_id = ${conversations.id} and ${searchable(side, "sm")} and sm.search_tsv @@ websearch_to_tsquery('simple', ${text}))`
  return sql`(${name} or ${body})`
}

/** In-thread search: matching seqs in one conversation. */
export function messageMatch(side: Side, q: string): SQL | undefined {
  const text = clean(q)
  if (!text) return undefined
  return sql`((${messages.status} = 'sent' or (${messages.status} = 'held' and ${messages.senderSide} = ${side})) and ${messages.searchTsv} @@ websearch_to_tsquery('simple', ${text}))`
}
