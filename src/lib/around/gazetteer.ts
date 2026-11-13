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

/**
 * More cities in every market Yard sells to, so delivery, Around and Studio aren't limited to a
 * handful. Centroids are approximate; they have no neighbourhoods yet.
 */
const c = (slug: string, name: string, country: string, timeZone: string, lat: number, lng: number, aliases: string[] = []): City => ({ slug, name, country, timeZone, lat, lng, aliases, neighbourhoods: [] })
cities.push(
  c("port-harcourt", "Port Harcourt", "NG", "Africa/Lagos", 4.8156, 7.0498, ["PH", "Port-Harcourt"]),
  c("ibadan", "Ibadan", "NG", "Africa/Lagos", 7.3775, 3.947, []),
  c("kano", "Kano", "NG", "Africa/Lagos", 12.0022, 8.592, []),
  c("benin-city", "Benin City", "NG", "Africa/Lagos", 6.335, 5.6037, ["Benin"]),
  c("enugu", "Enugu", "NG", "Africa/Lagos", 6.4584, 7.5464, []),
  c("kaduna", "Kaduna", "NG", "Africa/Lagos", 10.5105, 7.4165, []),
  c("calabar", "Calabar", "NG", "Africa/Lagos", 4.9757, 8.3417, []),
  c("uyo", "Uyo", "NG", "Africa/Lagos", 5.0377, 7.9128, []),
  c("owerri", "Owerri", "NG", "Africa/Lagos", 5.4836, 7.0333, []),
  c("abeokuta", "Abeokuta", "NG", "Africa/Lagos", 7.1475, 3.3619, []),
  c("ilorin", "Ilorin", "NG", "Africa/Lagos", 8.4966, 4.5421, []),
  c("jos", "Jos", "NG", "Africa/Lagos", 9.8965, 8.8583, []),
  c("warri", "Warri", "NG", "Africa/Lagos", 5.5167, 5.75, []),
  c("onitsha", "Onitsha", "NG", "Africa/Lagos", 6.145, 6.7883, []),
  c("asaba", "Asaba", "NG", "Africa/Lagos", 6.198, 6.7317, []),
  c("akure", "Akure", "NG", "Africa/Lagos", 7.2571, 5.2058, []),
  c("osogbo", "Osogbo", "NG", "Africa/Lagos", 7.7827, 4.5418, ["Oshogbo"]),
  c("aba", "Aba", "NG", "Africa/Lagos", 5.1066, 7.3667, []),
  c("maiduguri", "Maiduguri", "NG", "Africa/Lagos", 11.8311, 13.151, []),
  c("sokoto", "Sokoto", "NG", "Africa/Lagos", 13.0059, 5.2476, []),
  c("zaria", "Zaria", "NG", "Africa/Lagos", 11.0855, 7.7199, []),
  c("yola", "Yola", "NG", "Africa/Lagos", 9.2035, 12.4954, []),
  c("makurdi", "Makurdi", "NG", "Africa/Lagos", 7.7322, 8.5391, []),
  c("lokoja", "Lokoja", "NG", "Africa/Lagos", 7.8023, 6.7333, []),
  c("awka", "Awka", "NG", "Africa/Lagos", 6.2105, 7.0741, []),
  c("ado-ekiti", "Ado-Ekiti", "NG", "Africa/Lagos", 7.6233, 5.2209, ["Ado Ekiti"]),
  c("kumasi", "Kumasi", "GH", "Africa/Accra", 6.6885, -1.6244, []),
  c("tamale", "Tamale", "GH", "Africa/Accra", 9.4008, -0.8393, []),
  c("takoradi", "Takoradi", "GH", "Africa/Accra", 4.8845, -1.7554, ["Sekondi-Takoradi"]),
  c("cape-coast", "Cape Coast", "GH", "Africa/Accra", 5.1053, -1.2466, []),
  c("tema", "Tema", "GH", "Africa/Accra", 5.6698, -0.0166, []),
  c("ho", "Ho", "GH", "Africa/Accra", 6.6008, 0.4713, []),
  c("mombasa", "Mombasa", "KE", "Africa/Nairobi", -4.0435, 39.6682, []),
  c("kisumu", "Kisumu", "KE", "Africa/Nairobi", -0.0917, 34.768, []),
  c("nakuru", "Nakuru", "KE", "Africa/Nairobi", -0.3031, 36.08, []),
  c("eldoret", "Eldoret", "KE", "Africa/Nairobi", 0.5143, 35.2698, []),
  c("cape-town", "Cape Town", "ZA", "Africa/Johannesburg", -33.9249, 18.4241, []),
  c("durban", "Durban", "ZA", "Africa/Johannesburg", -29.8587, 31.0218, ["eThekwini"]),
  c("pretoria", "Pretoria", "ZA", "Africa/Johannesburg", -25.7479, 28.2293, ["Tshwane"]),
  c("port-elizabeth", "Gqeberha", "ZA", "Africa/Johannesburg", -33.9608, 25.6022, ["Port Elizabeth"]),
  c("bloemfontein", "Bloemfontein", "ZA", "Africa/Johannesburg", -29.0852, 26.1596, []),
  c("manchester", "Manchester", "GB", "Europe/London", 53.4808, -2.2426, []),
  c("birmingham", "Birmingham", "GB", "Europe/London", 52.4862, -1.8904, []),
  c("leeds", "Leeds", "GB", "Europe/London", 53.8008, -1.5491, []),
  c("liverpool", "Liverpool", "GB", "Europe/London", 53.4084, -2.9916, []),
  c("glasgow", "Glasgow", "GB", "Europe/London", 55.8642, -4.2518, []),
  c("edinburgh", "Edinburgh", "GB", "Europe/London", 55.9533, -3.1883, []),
  c("bristol", "Bristol", "GB", "Europe/London", 51.4545, -2.5879, []),
  c("cardiff", "Cardiff", "GB", "Europe/London", 51.4816, -3.1791, []),
  c("belfast", "Belfast", "GB", "Europe/London", 54.5973, -5.9301, []),
  c("nottingham", "Nottingham", "GB", "Europe/London", 52.9548, -1.1581, []),
  c("leicester", "Leicester", "GB", "Europe/London", 52.6369, -1.1398, []),
  c("sheffield", "Sheffield", "GB", "Europe/London", 53.3811, -1.4701, []),
  c("newcastle", "Newcastle", "GB", "Europe/London", 54.9783, -1.6178, ["Newcastle upon Tyne"]),
  c("marseille", "Marseille", "FR", "Europe/Paris", 43.2965, 5.3698, []),
  c("lyon", "Lyon", "FR", "Europe/Paris", 45.764, 4.8357, []),
  c("toulouse", "Toulouse", "FR", "Europe/Paris", 43.6047, 1.4442, []),
  c("nice", "Nice", "FR", "Europe/Paris", 43.7102, 7.262, []),
  c("bordeaux", "Bordeaux", "FR", "Europe/Paris", 44.8378, -0.5792, []),
  c("lille", "Lille", "FR", "Europe/Paris", 50.6292, 3.0573, []),
  c("nantes", "Nantes", "FR", "Europe/Paris", 47.2184, -1.5536, []),
  c("strasbourg", "Strasbourg", "FR", "Europe/Paris", 48.5734, 7.7521, []),
  c("hamburg", "Hamburg", "DE", "Europe/Berlin", 53.5511, 9.9937, []),
  c("munich", "Munich", "DE", "Europe/Berlin", 48.1351, 11.582, ["München", "Muenchen"]),
  c("cologne", "Cologne", "DE", "Europe/Berlin", 50.9375, 6.9603, ["Köln", "Koeln"]),
  c("frankfurt", "Frankfurt", "DE", "Europe/Berlin", 50.1109, 8.6821, ["Frankfurt am Main"]),
  c("dusseldorf", "Düsseldorf", "DE", "Europe/Berlin", 51.2277, 6.7735, ["Dusseldorf", "Duesseldorf"]),
  c("stuttgart", "Stuttgart", "DE", "Europe/Berlin", 48.7758, 9.1829, []),
  c("leipzig", "Leipzig", "DE", "Europe/Berlin", 51.3397, 12.3731, []),
  c("los-angeles", "Los Angeles", "US", "America/Los_Angeles", 34.0522, -118.2437, ["LA"]),
  c("chicago", "Chicago", "US", "America/Chicago", 41.8781, -87.6298, []),
  c("houston", "Houston", "US", "America/Chicago", 29.7604, -95.3698, []),
  c("atlanta", "Atlanta", "US", "America/New_York", 33.749, -84.388, ["ATL"]),
  c("miami", "Miami", "US", "America/New_York", 25.7617, -80.1918, []),
  c("dallas", "Dallas", "US", "America/Chicago", 32.7767, -96.797, []),
  c("washington-dc", "Washington, DC", "US", "America/New_York", 38.9072, -77.0369, ["DC", "Washington"]),
  c("philadelphia", "Philadelphia", "US", "America/New_York", 39.9526, -75.1652, ["Philly"]),
  c("boston", "Boston", "US", "America/New_York", 42.3601, -71.0589, []),
  c("san-francisco", "San Francisco", "US", "America/Los_Angeles", 37.7749, -122.4194, ["SF"]),
  c("seattle", "Seattle", "US", "America/Los_Angeles", 47.6062, -122.3321, []),
  c("las-vegas", "Las Vegas", "US", "America/Los_Angeles", 36.1699, -115.1398, []),
  c("phoenix", "Phoenix", "US", "America/Phoenix", 33.4484, -112.074, []),
  c("denver", "Denver", "US", "America/Denver", 39.7392, -104.9903, []),
  c("detroit", "Detroit", "US", "America/Detroit", 42.3314, -83.0458, []),
  c("new-orleans", "New Orleans", "US", "America/Chicago", 29.9511, -90.0715, []),
  c("charlotte", "Charlotte", "US", "America/New_York", 35.2271, -80.8431, []),
  c("austin", "Austin", "US", "America/Chicago", 30.2672, -97.7431, []),
  c("guadalajara", "Guadalajara", "MX", "America/Mexico_City", 20.6597, -103.3496, []),
  c("monterrey", "Monterrey", "MX", "America/Monterrey", 25.6866, -100.3161, []),
  c("puebla", "Puebla", "MX", "America/Mexico_City", 19.0414, -98.2063, []),
  c("tijuana", "Tijuana", "MX", "America/Tijuana", 32.5149, -117.0382, []),
  c("cancun", "Cancún", "MX", "America/Cancun", 21.1619, -86.8515, ["Cancun"]),
  c("merida", "Mérida", "MX", "America/Merida", 20.9674, -89.5926, ["Merida"]),
  c("osaka", "Osaka", "JP", "Asia/Tokyo", 34.6937, 135.5023, []),
  c("kyoto", "Kyoto", "JP", "Asia/Tokyo", 35.0116, 135.7681, []),
  c("yokohama", "Yokohama", "JP", "Asia/Tokyo", 35.4437, 139.638, []),
  c("nagoya", "Nagoya", "JP", "Asia/Tokyo", 35.1815, 136.9066, []),
  c("fukuoka", "Fukuoka", "JP", "Asia/Tokyo", 33.5904, 130.4017, []),
  c("sapporo", "Sapporo", "JP", "Asia/Tokyo", 43.0618, 141.3545, []),
  c("kobe", "Kobe", "JP", "Asia/Tokyo", 34.6901, 135.1955, []),
  c("busan", "Busan", "KR", "Asia/Seoul", 35.1796, 129.0756, ["Pusan"]),
  c("incheon", "Incheon", "KR", "Asia/Seoul", 37.4563, 126.7052, []),
  c("daegu", "Daegu", "KR", "Asia/Seoul", 35.8714, 128.6014, []),
  c("daejeon", "Daejeon", "KR", "Asia/Seoul", 36.3504, 127.3845, []),
  c("gwangju", "Gwangju", "KR", "Asia/Seoul", 35.1595, 126.8526, []),
  c("jeju", "Jeju", "KR", "Asia/Seoul", 33.4996, 126.5312, ["Jeju City"]),
)

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
