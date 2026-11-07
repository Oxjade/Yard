import { cities, haversineKm } from "./gazetteer"
import { countryName } from "./geo"

/**
 * Coarse boxes for Yard's 11 markets (west, south, east, north in degrees), used to check an
 * "Other city" pin (§6.4). They're loose rectangles, so a pin just over a border can pass; they
 * exist to stop a place labelled Ibadan from being pinned in Seoul, not to settle borders.
 */
type Box = [west: number, south: number, east: number, north: number]

export const MARKET_BOXES: Record<string, Box[]> = {
  NG: [[2.6, 4.0, 14.7, 14.0]],
  GH: [[-3.3, 4.6, 1.3, 11.2]],
  KE: [[33.9, -4.8, 42.0, 5.1]],
  ZA: [[16.4, -35.0, 33.0, -22.1]],
  GB: [[-8.7, 49.8, 1.8, 60.9]],
  FR: [[-5.3, 41.3, 9.7, 51.2]],
  DE: [[5.8, 47.2, 15.1, 55.1]],
  US: [
    [-125.0, 24.4, -66.9, 49.5],
    [-180.0, 51.0, -129.9, 71.5],
    [172.0, 51.0, 180.0, 53.5],
    [-160.3, 18.8, -154.7, 22.3],
  ],
  MX: [[-118.5, 14.5, -86.7, 32.8]],
  JP: [[122.9, 24.0, 146.0, 45.6]],
  KR: [[124.5, 33.0, 132.0, 38.7]],
}

export function inMarket(country: string, lat: number, lng: number) {
  const boxes = MARKET_BOXES[country]
  if (!boxes) return false
  return boxes.some(([w, s, e, n]) => lat >= s && lat <= n && lng >= w && lng <= e)
}

/** Within this distance of a covered city's centre, a place belongs to that city, not "Other city". */
export const OTHER_CITY_MIN_KM = 60

/**
 * What's wrong with an "Other city" pin, or null. The server and the Studio form both use it, so
 * the same sentence appears on both sides:
 * - the pin still sits on the gazetteer centre it started on;
 * - it is within 60 km of a covered city (that place should choose the city instead);
 * - it isn't inside the chosen country.
 */
export function otherCityPinProblem(input: { cityName: string; country: string; lat: number; lng: number }): string | null {
  const { lat, lng, country } = input
  const name = input.cityName.trim() || "your city"
  if (cities.some((c) => Math.abs(c.lat - lat) < 1e-6 && Math.abs(c.lng - lng) < 1e-6)) return `Move the pin onto your place in ${name}, or type its coordinates.`
  const near = cities
    .map((c) => ({ c, km: haversineKm(lat, lng, c.lat, c.lng) }))
    .filter((x) => x.km <= OTHER_CITY_MIN_KM)
    .sort((a, b) => a.km - b.km)[0]
  if (near) return `That pin is in ${near.c.name}. Choose ${near.c.name} under City.`
  if (country && !inMarket(country, lat, lng)) return `That pin isn't in ${countryName(country)}. Move it or change the country.`
  return null
}
