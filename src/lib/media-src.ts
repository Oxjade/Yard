/**
 * A private upload read with the viewer's own session (`/api/media/<id>?as=brand`, e.g. a brand
 * member previewing a piece before its shop opens). The image optimiser fetches without cookies,
 * so these must load unoptimised.
 */
export const privateMediaSrc = (src: string) => src.startsWith("/api/media/") && src.includes("?as=")
