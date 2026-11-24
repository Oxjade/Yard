import { sql, type AnyColumn, type SQL } from "drizzle-orm"

/*
 * A brand's logo (brands.logo_media_id: set by Yard for a founding brand, or by the brand in
 * Studio) as every reader outside the brand sees it: only while the file is public media and not
 * removed, so the bare /api/media address every visitor shares always loads (media/visibility.ts
 * makes a listed brand's logo public). Anything else (no logo, a founding brand's private logo
 * before launch, a removed file) is null, and the UI shows the brand's initials instead.
 *
 * Not "server-only": it builds SQL and a string, nothing secret, so the unit tests can import it.
 */

/**
 * The logo's media id while it is public and not removed, else null. A correlated primary-key
 * lookup in the same query (no per-row fetch). `logoMediaId` is the brands.logo_media_id column
 * of whichever brands row (or alias) the query joins.
 */
export function publicLogoIdSql(logoMediaId: AnyColumn | SQL): SQL<string | null> {
  return sql<string | null>`(select blm.id from media_assets blm where blm.id = ${logoMediaId} and blm.visibility = 'public' and blm.moderation_status <> 'removed')`
}

/** The public logo's src (`/api/media/<id>`, never `?as=`) from publicLogoIdSql's value, or null for the initials. */
export function brandLogoSrc(publicLogoId: string | null | undefined): string | null {
  return publicLogoId ? `/api/media/${encodeURIComponent(publicLogoId)}` : null
}

/** The same rule as one SQL value: the public logo's src, or null. For queries that map rows straight to the wire. */
export function publicLogoSrcSql(logoMediaId: AnyColumn | SQL): SQL<string | null> {
  return sql<string | null>`(select '/api/media/' || blm.id from media_assets blm where blm.id = ${logoMediaId} and blm.visibility = 'public' and blm.moderation_status <> 'removed')`
}
