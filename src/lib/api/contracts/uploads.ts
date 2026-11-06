import { z } from "zod"

/** POST /api/uploads?purpose=&as=[&conversationId=|&brandId=] (F2, §5.4). Draft by F1; F2 owns it in wave 2. */
export const uploadPurpose = z.enum(["social_post", "inbox_attachment", "location_image"])
export type UploadPurpose = z.infer<typeof uploadPurpose>

export const uploadQuery = z
  .object({
    purpose: uploadPurpose,
    as: z.enum(["shopper", "brand"]),
    conversationId: z.string().max(80).optional(),
    brandId: z.string().max(80).optional(),
  })
  .strict()

export const mediaDto = z.object({
  id: z.string(),
  /** Always /api/media/<id>?as=<as> for private media. */
  src: z.string(),
  mime: z.enum(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"]),
  kind: z.enum(["image", "video"]),
  bytes: z.number(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  durationMs: z.number().nullable(),
  /** Uploads are one of uploadPurpose; social_import (S's imports) and sample (seed rows) come from the server. */
  purpose: z.enum(["social_post", "inbox_attachment", "location_image", "social_import", "sample"]),
  visibility: z.enum(["private", "public"]),
  createdAt: z.string(),
})
export type MediaDto = z.infer<typeof mediaDto>
export const uploadResult = z.object({ media: mediaDto })

/** Caps per purpose (bytes), checked before the body is read. */
export const UPLOAD_CAPS = { inbox_attachment: 8 * 1024 * 1024, social_post_image: 10 * 1024 * 1024, social_post_video: 50 * 1024 * 1024, location_image: 10 * 1024 * 1024 } as const
export const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const
export const VIDEO_MIMES = ["video/mp4", "video/webm"] as const
