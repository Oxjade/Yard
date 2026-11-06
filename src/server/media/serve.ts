import "server-only"
import { NotImplemented } from "../http/errors"

/** GET /api/media/[id]?as=: authorisation per purpose, Range, ETag and the strict headers of §5.4 step 9. */
export async function serveMedia(req: Request, id: string, as: "shopper" | "brand" | "admin" | null): Promise<Response> {
  void req
  void id
  void as
  throw new NotImplemented("media.serveMedia")
}
