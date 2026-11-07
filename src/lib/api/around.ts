import { api } from "./client"
import {
  brandPlaceBadgeDto,
  onlineBrandsResult,
  placeDetailResult,
  placesResult,
  studioEventResult,
  studioLocationResult,
  studioLocationsResult,
  type BrandPlaceBadgeDto,
  type LocationEventBody,
  type LocationEventPatchBody,
  type LocationPatchBody,
  type LocationWriteBody,
  type OnlineBrandsResult,
  type PlaceDetailDto,
  type PlacesResult,
  type StudioEventResult,
  type StudioLocationResult,
  type StudioLocationsResult,
} from "./contracts/around"

/**
 * Typed fetch wrappers for YARD Around (§1.9). Public reads send no position: only 1° tile keys in
 * blocks of at least 3×3, or `scope=world` (§5.6). Nothing here ever carries a location fix.
 */

export const placesKey = (req: { scope: "world" } | { tiles: string[] }) => ("scope" in req ? "around:places:world" : `around:places:${req.tiles.join(",")}`)

export function getPlaces(req: { scope: "world" } | { tiles: string[] }, signal?: AbortSignal) {
  return api<PlacesResult>("/api/around/places", { query: "scope" in req ? { scope: "world" } : { tiles: req.tiles.join(",") }, schema: placesResult, signal })
}

export const getPlace = (id: string) => api<{ place: PlaceDetailDto }>(`/api/around/places/${encodeURIComponent(id)}`, { schema: placeDetailResult })
export const getOnlineBrands = (city: string) => api<OnlineBrandsResult>("/api/around/online-brands", { query: { city }, schema: onlineBrandsResult })
export const getBrandPlaces = (brandId: string) => api<BrandPlaceBadgeDto>(`/api/around/brand/${encodeURIComponent(brandId)}`, { schema: brandPlaceBadgeDto })

/* ---------- Studio ---------- */

export const STUDIO_LOCATIONS_KEY = "studio:locations"
export const listStudioLocations = () => api<StudioLocationsResult>("/api/studio/locations", { schema: studioLocationsResult })
export const getStudioLocation = (id: string) => api<StudioLocationResult>(`/api/studio/locations/${encodeURIComponent(id)}`, { schema: studioLocationResult })
export const createStudioLocation = (body: LocationWriteBody) => api<StudioLocationResult>("/api/studio/locations", { method: "POST", body, schema: studioLocationResult })
export const updateStudioLocation = (id: string, body: LocationPatchBody) => api<StudioLocationResult>(`/api/studio/locations/${encodeURIComponent(id)}`, { method: "PATCH", body, schema: studioLocationResult })
export const deleteStudioLocation = (id: string) => api<{ ok: true; id: string }>(`/api/studio/locations/${encodeURIComponent(id)}`, { method: "DELETE" })
export const duplicateStudioLocation = (id: string, body: { startsAt?: string; endsAt?: string } = {}) =>
  api<StudioLocationResult>(`/api/studio/locations/${encodeURIComponent(id)}/duplicate`, { method: "POST", body, schema: studioLocationResult })
export const createStudioEvent = (locationId: string, body: LocationEventBody) =>
  api<StudioEventResult>(`/api/studio/locations/${encodeURIComponent(locationId)}/events`, { method: "POST", body, schema: studioEventResult })
export const updateStudioEvent = (locationId: string, eventId: string, body: LocationEventPatchBody) =>
  api<StudioEventResult>(`/api/studio/locations/${encodeURIComponent(locationId)}/events/${encodeURIComponent(eventId)}`, { method: "PATCH", body, schema: studioEventResult })
export const deleteStudioEvent = (locationId: string, eventId: string) => api<StudioLocationResult>(`/api/studio/locations/${encodeURIComponent(locationId)}/events/${encodeURIComponent(eventId)}`, { method: "DELETE" })
