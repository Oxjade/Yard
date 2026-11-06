import "server-only"
import { NotImplemented } from "../http/errors"

export type MediaPurpose = "social_post" | "inbox_attachment" | "location_image" | "social_import" | "sample"

/** Size caps by purpose and kind (§5.4 step 2). */
export const MEDIA_CAPS = { inbox_attachment: 8 << 20, social_post_image: 10 << 20, social_post_video: 50 << 20, location_image: 10 << 20, social_import_image: 10 << 20, social_import_video: 50 << 20 } as const

/** Moves a sniffed, stripped temp file into uploads/<purpose>/<owner>/<id>.<ext> and inserts its row (file first, then one short withTx; unlink on failure). */
export async function storeUpload(input: { tmpPath: string; purpose: MediaPurpose; ownerKind: "brand" | "user"; ownerId: string; brandId: string | null; conversationId: string | null; targetBrandId: string | null; createdBy: string }): Promise<{ id: string }> {
  void input
  throw new NotImplemented("media.storeUpload")
}
