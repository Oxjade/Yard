import "server-only"
import type { NextRequest } from "next/server"
import type { RequestMeta } from "./identity"

/** The request facts AUTH services record: the client IP hash (§5.1) and a trimmed user agent. */
export function metaOf(req: NextRequest, ipHash: string | null): RequestMeta {
  return { ipHash, userAgent: req.headers.get("user-agent")?.slice(0, 200) ?? null }
}
