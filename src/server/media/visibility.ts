import "server-only"
import { eq, sql } from "drizzle-orm"
import { db } from "../db"
import { mediaAssets } from "../db/schema"

/**
 * Derives media visibility from what references it (§5.4 step 7). Runs through db(), so it joins
 * the caller's transaction: publishing, hiding, deleting or moderating a post, place or event;
 * brand status changes; Disconnect; deauthorize and data deletion. A file is public only while at
 * least one of these references it:
 *  - a published, ok social post of a listed brand without an active social_disabled restriction;
 *  - a published, approved place of a listed brand;
 *  - a published, approved event of a listed brand, at a published, approved place;
 *  - a photo of a published, not moderation-hidden product, or the cover of a published
 *    collection, of a listed brand (brand image uploads only: CATALOG_IMAGE_PURPOSES);
 *  - a listed brand's logo (brands.logo_media_id). A founding brand counts as listed only once
 *    it has launched (first storefront publish).
 * The referencing row must belong to the file's own brand (brand_id = media_assets.brand_id) and
 * the file's purpose must match the reference (post media: social_post or social_import; place
 * and event images: location_image), so a writer bug can never publish another tenant's file or
 * a shopper's inbox attachment (brand_id null) by naming its id.
 * Everything else is private, including the media of pending_review places. Removed media is
 * always private. Never set from a request.
 *
 * It also keeps `unreferenced_at`: null while anything at all references the file (a post of any
 * visibility, a place, an event, an account avatar, a message), otherwise the time it was first
 * seen unreferenced. The purge deletes post and place media 7 days after that.
 */
/**
 * Brand image uploads that CATALOG accepts as product, collection and storefront-cover photos.
 * Inbox attachments never qualify.
 */
export const CATALOG_IMAGE_PURPOSES = ["social_post", "location_image", "onboarding_image", "storefront_cover", "drop_image"] as const
const CATALOG_PURPOSES = sql.raw(`(${CATALOG_IMAGE_PURPOSES.map((p) => `'${p}'`).join(", ")})`)

// Listed: not restricted or suspended, and (founding brands) launched with a published storefront.
const listed = (alias: string) => sql.raw(`${alias}.review_status not in ('restricted', 'suspended') and (not ${alias}.founding or ${alias}.launched_at is not null)`)

/** Any reference at all, whatever its visibility or moderation (what keeps a file from the purge). */
export const referencedAtAll = sql.raw(`(
  exists (select 1 from social_posts p, jsonb_array_elements(p.media) e where e ->> 'mediaId' = m.id or e ->> 'posterMediaId' = m.id)
  or exists (select 1 from brand_locations l, jsonb_array_elements(l.images) e where e ->> 'mediaId' = m.id)
  or exists (select 1 from location_events v where v.image ->> 'mediaId' = m.id)
  or exists (select 1 from social_accounts a where a.avatar_media_id = m.id)
  or exists (select 1 from message_attachments ma where ma.media_id = m.id)
  or exists (select 1 from catalog_product_images ci where ci.media_id = m.id)
  or exists (select 1 from catalog_collections cc where cc.image_media_id = m.id)
  or exists (select 1 from drops d where d.image = m.id)
  or exists (select 1 from catalog_storefront_drafts sd where sd.config ->> 'coverMediaId' = m.id)
  or exists (select 1 from catalog_storefront_versions sv where sv.config ->> 'coverMediaId' = m.id)
  or exists (select 1 from brands lb where lb.logo_media_id = m.id)
  or exists (
    select 1 from catalog_brand_onboardings o
    where o.data -> 'brand' ->> 'logoMediaId' = m.id
      or o.data -> 'storefront' ->> 'coverMediaId' = m.id
      or exists (
        select 1 from jsonb_array_elements(coalesce(o.data -> 'product' -> 'images', '[]'::jsonb)) e
        where e ->> 'mediaId' = m.id)
  )
)`)

export async function refreshVisibility(mediaIds: string[]): Promise<void> {
  const ids = [...new Set(mediaIds.filter((x) => typeof x === "string" && x))]
  if (!ids.length) return
  const d = await db()
  await d.execute(sql`
    update media_assets m set visibility = case when m.moderation_status <> 'removed' and (
      exists (
        select 1 from social_posts p join brands b on b.id = p.brand_id
        where p.visibility = 'published' and p.moderation_status = 'ok' and ${listed("b")}
          and p.brand_id = m.brand_id and m.purpose in ('social_post', 'social_import')
          and not exists (
            select 1 from account_restrictions r
            where r.subject_kind = 'brand' and r.subject_id = p.brand_id and r.kind = 'social_disabled'
              and r.status = 'active' and (r.until is null or r.until > now()))
          and exists (select 1 from jsonb_array_elements(p.media) e where e ->> 'mediaId' = m.id or e ->> 'posterMediaId' = m.id))
      or exists (
        select 1 from brand_locations l join brands b on b.id = l.brand_id
        where l.visibility = 'published' and l.moderation_status = 'approved' and ${listed("b")}
          and l.brand_id = m.brand_id and m.purpose = 'location_image'
          and exists (select 1 from jsonb_array_elements(l.images) e where e ->> 'mediaId' = m.id))
      or exists (
        select 1 from location_events v join brands b on b.id = v.brand_id join brand_locations l on l.id = v.location_id
        where v.visibility = 'published' and v.moderation_status = 'approved' and ${listed("b")}
          and l.visibility = 'published' and l.moderation_status = 'approved'
          and v.brand_id = m.brand_id and m.purpose = 'location_image'
          and v.image ->> 'mediaId' = m.id)
      or exists (
        select 1 from catalog_product_images ci join catalog_products cp on cp.id = ci.product_id join brands b on b.id = cp.brand_id
        where cp.status = 'published' and cp.moderation_status = 'ok' and ${listed("b")}
          and cp.brand_id = m.brand_id and m.owner_kind = 'brand' and m.purpose in ${CATALOG_PURPOSES}
          and ci.media_id = m.id)
      or exists (
        select 1 from catalog_collections cc join brands b on b.id = cc.brand_id
        where cc.status = 'published' and ${listed("b")}
          and cc.brand_id = m.brand_id and m.owner_kind = 'brand' and m.purpose in ${CATALOG_PURPOSES}
          and cc.image_media_id = m.id)
      or exists (
        select 1 from catalog_storefront_versions sv join brands b on b.id = sv.brand_id
        where ${listed("b")} and sv.brand_id = m.brand_id and m.owner_kind = 'brand' and m.purpose in ${CATALOG_PURPOSES}
          and sv.version = (select max(current.version) from catalog_storefront_versions current where current.brand_id = sv.brand_id)
          and sv.config ->> 'coverMediaId' = m.id)
      or exists (
        select 1 from brands b
        where ${listed("b")} and b.id = m.brand_id and m.owner_kind = 'brand' and m.purpose in ${CATALOG_PURPOSES}
          and b.logo_media_id = m.id)
      or exists (
        select 1 from drops d join brands b on b.id = d.brand_id
        where ${listed("b")} and d.brand_id = m.brand_id and m.owner_kind = 'brand' and m.purpose in ${CATALOG_PURPOSES}
          and d.status in ('scheduled', 'live', 'ended') and d.image = m.id)
    ) then 'public' else 'private' end,
    unreferenced_at = case when ${referencedAtAll} then null else coalesce(m.unreferenced_at, now()) end
    where m.id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})`)
}

/** Every media file of a brand (brand status changes, Disconnect, data deletion). */
export async function refreshBrandMediaVisibility(brandId: string): Promise<void> {
  const d = await db()
  const rows = await d.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.brandId, brandId))
  for (let i = 0; i < rows.length; i += 500)
    await refreshVisibility(
      rows.slice(i, i + 500).map((r) => r.id),
    )
}

/** The media ids a social post's or place's media list references (for callers collecting ids). */
export function mediaIdsOf(items: { mediaId?: string; posterMediaId?: string }[] | null | undefined): string[] {
  const out: string[] = []
  for (const it of items ?? []) {
    if (it?.mediaId) out.push(it.mediaId)
    if (it?.posterMediaId) out.push(it.posterMediaId)
  }
  return out
}
