/**
 * The local gazetteer for YARD Around (Appendix C; F1 data, handed to cluster A). Coordinates are
 * approximate centroids (about ±1 km): enough for camera targets, labels and pin validation, and
 * never used as anyone's address. Search is local: typing a city never leaves the device.
 */
export type Neighbourhood = { slug: string; name: string; lat: number; lng: number; aliases: string[] }
export type City = { slug: string; name: string; country: string; timeZone: string; lat: number; lng: number; aliases: string[]; neighbourhoods: Neighbourhood[] }

const n = (slug: string, name: string, lat: number, lng: number, aliases: string[] = []): Neighbourhood => ({ slug, name, lat, lng, aliases })

export const cities: City[] = [
  {
    slug: "lagos",
    name: "Lagos",
    country: "NG",
    timeZone: "Africa/Lagos",
    lat: 6.5244,
    lng: 3.3792,
    aliases: ["Eko"],
    neighbourhoods: [
      n("lekki", "Lekki", 6.4478, 3.4723, ["Lekki Phase 1"]),
      n("victoria-island", "Victoria Island", 6.4281, 3.4219, ["VI"]),
      n("ikoyi", "Ikoyi", 6.4474, 3.4336),
      n("yaba", "Yaba", 6.5095, 3.3711),
      n("surulere", "Surulere", 6.4969, 3.3537),
      n("ikeja", "Ikeja", 6.6018, 3.3515),
    ],
  },
  {
    slug: "abuja",
    name: "Abuja",
    country: "NG",
    timeZone: "Africa/Lagos",
    lat: 9.0765,
    lng: 7.3986,
    aliases: ["FCT", "Federal Capital Territory"],
    neighbourhoods: [n("wuse", "Wuse", 9.079, 7.47, ["Wuse 2", "Wuse II"]), n("maitama", "Maitama", 9.088, 7.495), n("garki", "Garki", 9.03, 7.49)],
  },
  {
    slug: "accra",
    name: "Accra",
    country: "GH",
    timeZone: "Africa/Accra",
    lat: 5.6037,
    lng: -0.187,
    aliases: [],
    neighbourhoods: [n("osu", "Osu", 5.556, -0.182), n("labone", "Labone", 5.565, -0.172), n("east-legon", "East Legon", 5.635, -0.161), n("airport-residential", "Airport Residential", 5.603, -0.178, ["Airport Residential Area"])],
  },
  {
    slug: "nairobi",
    name: "Nairobi",
    country: "KE",
    timeZone: "Africa/Nairobi",
    lat: -1.2921,
    lng: 36.8219,
    aliases: [],
    neighbourhoods: [n("westlands", "Westlands", -1.2676, 36.8108), n("kilimani", "Kilimani", -1.29, 36.785), n("karen", "Karen", -1.3197, 36.7073)],
  },
  {
    slug: "johannesburg",
    name: "Johannesburg",
    country: "ZA",
    timeZone: "Africa/Johannesburg",
    lat: -26.2041,
    lng: 28.0473,
    aliases: ["Jozi", "Joburg", "Jo'burg", "Egoli"],
    neighbourhoods: [n("maboneng", "Maboneng", -26.2045, 28.059), n("braamfontein", "Braamfontein", -26.1929, 28.0305, ["Braam"]), n("rosebank", "Rosebank", -26.1452, 28.0436), n("melville", "Melville", -26.1747, 28.0094)],
  },
  {
    slug: "london",
    name: "London",
    country: "GB",
    timeZone: "Europe/London",
    lat: 51.5074,
    lng: -0.1278,
    aliases: [],
    neighbourhoods: [n("shoreditch", "Shoreditch", 51.5265, -0.0798), n("hackney", "Hackney", 51.545, -0.0553), n("peckham", "Peckham", 51.474, -0.069), n("soho", "Soho", 51.5136, -0.1365), n("brixton", "Brixton", 51.4613, -0.1156)],
  },
  {
    slug: "paris",
    name: "Paris",
    country: "FR",
    timeZone: "Europe/Paris",
    lat: 48.8566,
    lng: 2.3522,
    aliases: [],
    neighbourhoods: [n("le-marais", "Le Marais", 48.859, 2.362, ["Marais"]), n("pigalle", "Pigalle", 48.882, 2.337, ["SoPi"]), n("belleville", "Belleville", 48.872, 2.377), n("saint-germain", "Saint-Germain", 48.854, 2.333, ["Saint-Germain-des-Prés", "St Germain"])],
  },
  {
    slug: "berlin",
    name: "Berlin",
    country: "DE",
    timeZone: "Europe/Berlin",
    lat: 52.52,
    lng: 13.405,
    aliases: [],
    neighbourhoods: [n("kreuzberg", "Kreuzberg", 52.4986, 13.403), n("mitte", "Mitte", 52.5246, 13.4025), n("neukolln", "Neukölln", 52.4811, 13.435, ["Neukolln", "Neukoelln"]), n("friedrichshain", "Friedrichshain", 52.5156, 13.454)],
  },
  {
    slug: "new-york",
    name: "New York",
    country: "US",
    timeZone: "America/New_York",
    lat: 40.7128,
    lng: -74.006,
    aliases: ["NYC", "New York City", "Manhattan"],
    neighbourhoods: [
      n("lower-east-side", "Lower East Side", 40.715, -73.9843, ["LES"]),
      n("williamsburg", "Williamsburg", 40.7081, -73.9571),
      n("soho-nyc", "SoHo", 40.7233, -74.003, ["SoHo NYC"]),
      n("bushwick", "Bushwick", 40.6944, -73.9213),
    ],
  },
  {
    slug: "mexico-city",
    name: "Mexico City",
    country: "MX",
    timeZone: "America/Mexico_City",
    lat: 19.4326,
    lng: -99.1332,
    aliases: ["CDMX", "Ciudad de México", "DF"],
    neighbourhoods: [n("roma-norte", "Roma Norte", 19.418, -99.16, ["La Roma", "Roma"]), n("condesa", "Condesa", 19.4113, -99.173, ["La Condesa"]), n("juarez", "Juárez", 19.427, -99.159, ["Juarez"]), n("coyoacan", "Coyoacán", 19.3467, -99.1617, ["Coyoacan"])],
  },
  {
    slug: "tokyo",
    name: "Tokyo",
    country: "JP",
    timeZone: "Asia/Tokyo",
    lat: 35.6762,
    lng: 139.6503,
    aliases: ["東京"],
    neighbourhoods: [
      n("harajuku", "Harajuku", 35.6702, 139.7027),
      n("shibuya", "Shibuya", 35.6595, 139.7005),
      n("nakameguro", "Nakameguro", 35.644, 139.699, ["Naka-Meguro"]),
      n("daikanyama", "Daikanyama", 35.6486, 139.703),
      n("shimokitazawa", "Shimokitazawa", 35.6618, 139.6681, ["Shimokita"]),
    ],
  },
  {
    slug: "seoul",
    name: "Seoul",
    country: "KR",
    timeZone: "Asia/Seoul",
    lat: 37.5665,
    lng: 126.978,
    aliases: ["서울"],
    neighbourhoods: [
      n("seongsu", "Seongsu", 37.5446, 127.0557, ["Seongsu-dong"]),
      n("hannam", "Hannam", 37.534, 127.0026, ["Hannam-dong"]),
      n("hongdae", "Hongdae", 37.5563, 126.9236, ["Hongik", "Hongik University"]),
      n("itaewon", "Itaewon", 37.5345, 126.9946),
      n("gangnam", "Gangnam", 37.4979, 127.0276),
    ],
  },
]

export type AreaHit = { kind: "city" | "neighbourhood"; slug: string; name: string; label: string; city: City; neighbourhood?: Neighbourhood; lat: number; lng: number }

/** Lower-case, accents removed, punctuation collapsed: "Neukölln" and "neukolln" match. */
export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9぀-ヿ一-鿿가-힯]+/g, " ")
    .trim()

const cityHit = (c: City): AreaHit => ({ kind: "city", slug: c.slug, name: c.name, label: c.name, city: c, lat: c.lat, lng: c.lng })
const hoodHit = (c: City, h: Neighbourhood): AreaHit => ({ kind: "neighbourhood", slug: `${c.slug}/${h.slug}`, name: h.name, label: `${h.name}, ${c.name}`, city: c, neighbourhood: h, lat: h.lat, lng: h.lng })

/** 'lagos' or 'lagos/lekki' → the area, or null. */
export function areaBySlug(slug: string): AreaHit | null {
  const [c, h] = slug.split("/")
  const city = cities.find((x) => x.slug === c)
  if (!city) return null
  if (!h) return cityHit(city)
  const hood = city.neighbourhoods.find((x) => x.slug === h)
  return hood ? hoodHit(city, hood) : null
}

/** Cities and neighbourhoods matching the query (names and aliases, diacritics-insensitive), best first. */
export function searchAreas(q: string, limit = 8): AreaHit[] {
  const query = fold(q)
  if (!query) return []
  const scored: { hit: AreaHit; score: number }[] = []
  const score = (names: string[]) => {
    let best = 0
    for (const name of names) {
      const f = fold(name)
      if (f === query) best = Math.max(best, 3)
      else if (f.startsWith(query)) best = Math.max(best, 2)
      else if (f.includes(query)) best = Math.max(best, 1)
    }
    return best
  }
  for (const c of cities) {
    const sc = score([c.name, ...c.aliases])
    if (sc) scored.push({ hit: cityHit(c), score: sc + 0.5 })
    for (const h of c.neighbourhoods) {
      const sh = score([h.name, ...h.aliases])
      if (sh) scored.push({ hit: hoodHit(c, h), score: sh })
    }
  }
  return scored.sort((a, b) => b.score - a.score || a.hit.label.localeCompare(b.hit.label)).slice(0, limit).map((s) => s.hit)
}

/** Great-circle distance in km. */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = (d: number) => (d * Math.PI) / 180
  const dLat = r(bLat - aLat)
  const dLng = r(bLng - aLng)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(x)))
}

/**
 * The nearest gazetteer area within `maxKm`: neighbourhoods when `kind` allows, else cities.
 * Around uses it to centre the camera on an area, never on a precise fix (§5.6).
 */
export function nearestArea(lat: number, lng: number, maxKm: number, kind: "neighbourhood" | "city" | "any" = "any"): (AreaHit & { km: number }) | null {
  let best: (AreaHit & { km: number }) | null = null
  for (const c of cities) {
    if (kind !== "neighbourhood") {
      const km = haversineKm(lat, lng, c.lat, c.lng)
      if (km <= maxKm && (!best || km < best.km)) best = { ...cityHit(c), km }
    }
    if (kind !== "city") {
      for (const h of c.neighbourhoods) {
        const km = haversineKm(lat, lng, h.lat, h.lng)
        if (km <= maxKm && (!best || km < best.km)) best = { ...hoodHit(c, h), km }
      }
    }
  }
  return best
}

export const cityBySlug = (slug: string) => cities.find((c) => c.slug === slug) ?? null
