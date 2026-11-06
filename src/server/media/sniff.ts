import "server-only"
import { NotImplemented } from "../http/errors"

export type Sniffed = { mime: "image/jpeg" | "image/png" | "image/webp" | "video/mp4" | "video/webm"; ext: string; width?: number; height?: number }

/** Sniffs the first 32 bytes (client filename and MIME are ignored); null = 415 (§5.4 step 3). */
export function sniff(head: Uint8Array): Sniffed | null {
  void head
  throw new NotImplemented("media.sniff")
}
