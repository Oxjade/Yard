import "server-only"
import { isSafeId } from "@/lib/api/contracts/common"
import { notFound } from "../http/errors"

/** A path segment that must be a safe id (letters, digits, _ and -); anything else is 404. */
export function idParam(params: Record<string, string>, key: string): string {
  const v = params[key]
  if (!isSafeId(v)) throw notFound()
  return v
}

/** A positive integer path segment (storefront versions); anything else is 404. */
export function intParam(params: Record<string, string>, key: string): number {
  const v = params[key]
  if (!/^\d{1,9}$/.test(v ?? "") || Number(v) < 1) throw notFound()
  return Number(v)
}
