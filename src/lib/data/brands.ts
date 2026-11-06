import { img } from "./media"
import type { Brand, StorefrontConfig, StorefrontSection, StorefrontTemplate } from "./types"

/** Fictional brands for development. No real brand names, logos or people. */

function sections(template: StorefrontTemplate, extra: Partial<Record<string, Partial<StorefrontSection>>> = {}): StorefrontSection[] {
  const order: Record<StorefrontTemplate, StorefrontSection["type"][]> = {
    editorial: ["hero", "story", "featured-products", "lookbook", "collections", "drops", "all-products"],
    minimal: ["hero", "featured-products", "collections", "all-products", "story"],
    street: ["hero", "drops", "featured-products", "lookbook", "all-products", "story"],
    studio: ["hero", "featured-products", "story", "collections", "all-products", "drops"],
  }
  return order[template].map((type) => ({ id: type, type, enabled: true, ...(extra[type] ?? {}) }))
}

function storefront(
  template: StorefrontTemplate,
  accent: StorefrontConfig["accent"],
  typePreset: StorefrontConfig["typePreset"],
  intro: string,
  announcement: StorefrontConfig["announcement"] = null,
): StorefrontConfig {
  return { template, accent, typePreset, intro, announcement, sections: sections(template) }
}

export const brands: Brand[] = [
  {
    id: "b_lagos_static",
    handle: "lagos-static",
    name: "Lagos Static",
    tagline: "Heavyweight streetwear cut in Yaba.",
    description:
      "Boxy silhouettes, 480gsm fleece and graphics pulled from Lagos danfo signage. Made in small runs in a two-room studio in Yaba.",
    story: [
      "Lagos Static started as a screen-printing table in Tobi Adeyemi's bedroom in 2019, printing shirts for friends who played in the city's underground club nights.",
      "Five years on, everything is still cut and finished in Yaba. Runs stay small — usually under 200 pieces — and every graphic starts as a photograph taken on the Third Mainland Bridge.",
    ],
    mark: { text: "LS", style: "condensed" },
    cover: img("fashion/cover/6"),
    country: "NG",
    city: "Lagos",
    currency: "NGN",
    categories: ["streetwear", "fashion"],
    aesthetics: ["streetwear", "experimental"],
    founded: 2019,
    founder: { name: "Tobi Adeyemi", role: "Founder & designer", avatar: img("lifestyle/avatar/6") },
    followers: 48210,
    followerGrowth30d: 0.18,
    verified: true,
    joinedAt: "2026-03-02",
    social: { instagram: "lagosstatic", tiktok: "lagosstatic", website: "lagosstatic.example" },
    storefront: storefront("street", "acid", "condensed", "Heavyweight basics and loud graphics, made in Yaba in runs under 200.", {
      text: "Drop 07, “Third Mainland”, lands this week. Set a reminder on the drop page to get the alert.",
      href: "/drops/drop-07-third-mainland",
    }),
    shipsFrom: "NG",
    processingDays: [1, 3],
    returnsDays: 14,
  },
  {
    id: "b_oyin_atelier",
    handle: "oyin-atelier",
    name: "Oyin Atelier",
    tagline: "Quiet tailoring, hand-finished in Lagos.",
    description:
      "Contemporary womenswear in washed silks, aso-oke trims and structured linens. Every piece is hand-finished by a team of six.",
    story: [
      "Oyinkansola Bello trained in pattern cutting in London before returning to Lagos to build a studio around the weavers she grew up visiting in Iseyin.",
      "Oyin Atelier works in seasons of twelve pieces. Hand-woven aso-oke appears as a trim, a lining, a pocket — never as costume.",
    ],
    mark: { text: "O", style: "expanded" },
    cover: img("fashion/cover/5"),
    country: "NG",
    city: "Lagos",
    currency: "NGN",
    categories: ["fashion"],
    aesthetics: ["contemporary", "luxury", "minimalist"],
    founded: 2021,
    founder: { name: "Oyinkansola Bello", role: "Creative director", avatar: img("lifestyle/avatar/0") },
    followers: 21940,
    followerGrowth30d: 0.09,
    verified: true,
    joinedAt: "2026-04-11",
    social: { instagram: "oyin.atelier", website: "oyinatelier.example" },
    storefront: storefront("editorial", "ink", "expanded", "Twelve pieces a season. Silk, linen and hand-woven aso-oke."),
    shipsFrom: "NG",
    processingDays: [3, 6],
    returnsDays: 21,
  },
  {
    id: "b_null_form",
    handle: "null-form",
    name: "Null Form",
    tagline: "Footwear built from the sole up.",
    description:
      "Experimental footwear from Seoul. Sculpted soles, iridescent knits and silhouettes that start as 3D sketches.",
    story: [
      "Null Form is two industrial designers, Min-ji Park and Daniel Seo, who left a sportswear R&D lab to make the shoes they were never allowed to ship.",
      "Every model starts at the sole. Uppers are knitted from recycled polyester in Busan, and each release is numbered.",
    ],
    mark: { text: "NF", style: "expanded" },
    cover: img("fashion/cover/3"),
    country: "KR",
    city: "Seoul",
    currency: "KRW",
    categories: ["sneakers"],
    aesthetics: ["experimental", "avant-garde"],
    founded: 2022,
    founder: { name: "Min-ji Park", role: "Co-founder", avatar: img("lifestyle/avatar/4") },
    followers: 63380,
    followerGrowth30d: 0.24,
    verified: true,
    joinedAt: "2026-02-19",
    social: { instagram: "nullform.studio", x: "nullform" },
    storefront: storefront("studio", "violet", "expanded", "Numbered footwear, designed from the sole up in Seoul."),
    shipsFrom: "KR",
    processingDays: [2, 4],
    returnsDays: 30,
  },
  {
    id: "b_halfmoon_archive",
    handle: "halfmoon-archive",
    name: "Halfmoon Archive",
    tagline: "Restored workwear and archive menswear.",
    description:
      "Deadstock and restored workwear sourced across Europe, repaired by hand in East London, plus a small line of new pieces cut from archive patterns.",
    story: [
      "Halfmoon began as a market stall on Brick Lane selling repaired chore jackets. The repairs became the point: visible darning, replaced corozo buttons, a new life for a 1960s jacket.",
    ],
    mark: { text: "H/A", style: "grotesk" },
    cover: img("fashion/cover/0"),
    country: "GB",
    city: "London",
    currency: "GBP",
    categories: ["fashion"],
    aesthetics: ["vintage", "minimalist"],
    founded: 2017,
    founder: { name: "Callum Reid", role: "Founder", avatar: img("lifestyle/avatar/9") },
    followers: 30512,
    followerGrowth30d: 0.04,
    verified: true,
    joinedAt: "2026-01-08",
    social: { instagram: "halfmoon.archive", website: "halfmoonarchive.example" },
    storefront: storefront("minimal", "ink", "grotesk", "Repaired workwear and new pieces cut from archive patterns."),
    shipsFrom: "GB",
    processingDays: [1, 2],
    returnsDays: 30,
  },
  {
    id: "b_ferro_club",
    handle: "ferro-club",
    name: "Ferro Club",
    tagline: "Cast silver for the after-party.",
    description:
      "Sterling silver chains, halo rings and link bracelets cast by hand in Mexico City's Centro Histórico. Heavy, polished, made to be worn every day.",
    story: [
      "Ferro Club is run by silversmith Valeria Ortiz from a workshop above a 90-year-old jewellery bench in Centro. Every piece is cast from wax she carves herself.",
    ],
    mark: { text: "FC", style: "condensed" },
    cover: img("fashion/cover/8"),
    country: "MX",
    city: "Mexico City",
    currency: "MXN",
    categories: ["jewelry", "accessories"],
    aesthetics: ["streetwear", "luxury"],
    founded: 2020,
    founder: { name: "Valeria Ortiz", role: "Silversmith", avatar: img("lifestyle/avatar/3") },
    followers: 17305,
    followerGrowth30d: 0.15,
    verified: true,
    joinedAt: "2026-05-03",
    social: { instagram: "ferro.club" },
    storefront: storefront("street", "rose", "condensed", "Hand-cast sterling silver from Centro Histórico."),
    shipsFrom: "MX",
    processingDays: [3, 7],
    returnsDays: 14,
  },
  {
    id: "b_dune_apothecary",
    handle: "dune-apothecary",
    name: "Dune Apothecary",
    tagline: "Skin care from the Rift Valley.",
    description:
      "Small-batch oils, balms and fragrance built on East African botanicals — baobab, marula, frankincense — bottled in Nairobi.",
    story: [
      "Wanjiru Kamau is a chemist who spent a decade formulating for large beauty houses. Dune is the opposite: eight products, short ingredient lists, and growers she visits herself.",
    ],
    mark: { text: "D", style: "grotesk" },
    cover: img("lifestyle/home/5"),
    country: "KE",
    city: "Nairobi",
    currency: "KES",
    categories: ["beauty"],
    aesthetics: ["minimalist", "contemporary"],
    founded: 2021,
    founder: { name: "Wanjiru Kamau", role: "Founder & chemist", avatar: img("lifestyle/avatar/1") },
    followers: 12890,
    followerGrowth30d: 0.21,
    verified: true,
    joinedAt: "2026-06-14",
    social: { instagram: "dune.apothecary", website: "duneapothecary.example" },
    storefront: storefront("minimal", "ember", "grotesk", "Eight products. Short ingredient lists. East African botanicals."),
    shipsFrom: "KE",
    processingDays: [1, 3],
    returnsDays: 14,
  },
  {
    id: "b_mute_objects",
    handle: "mute-objects",
    name: "Mute Objects",
    tagline: "Audio and desk objects, machined in Tokyo.",
    description:
      "Headphones, mechanical keyboards, speakers and restored objects designed to disappear into a room and last a decade.",
    story: [
      "Mute Objects is a three-person studio in Kuramae making the electronics they wanted on their own desks: repairable, quiet, and finished like furniture.",
    ],
    mark: { text: "M—O", style: "grotesk" },
    cover: img("lifestyle/lifestyle-cover/0"),
    country: "JP",
    city: "Tokyo",
    currency: "JPY",
    categories: ["technology"],
    aesthetics: ["minimalist", "contemporary"],
    founded: 2018,
    founder: { name: "Haruki Sato", role: "Industrial designer" },
    followers: 40115,
    followerGrowth30d: 0.06,
    verified: true,
    joinedAt: "2026-02-02",
    social: { instagram: "muteobjects", website: "muteobjects.example" },
    storefront: storefront("studio", "aqua", "grotesk", "Repairable electronics, finished like furniture."),
    shipsFrom: "JP",
    processingDays: [2, 4],
    returnsDays: 30,
  },
  {
    id: "b_afterhours_ceramics",
    handle: "afterhours-ceramics",
    name: "Afterhours Ceramics",
    tagline: "Stoneware thrown after dark in Neukölln.",
    description:
      "Speckled stoneware, matte vases and candles, thrown by hand in a Neukölln studio that only opens after 6pm.",
    story: [
      "Lena Hoffmann kept her day job as an architect and threw pots at night. The night shift stuck — so did the name.",
    ],
    mark: { text: "AH", style: "expanded" },
    cover: img("lifestyle/home/6"),
    country: "DE",
    city: "Berlin",
    currency: "EUR",
    categories: ["home-lifestyle", "art-design"],
    aesthetics: ["minimalist", "contemporary"],
    founded: 2020,
    founder: { name: "Lena Hoffmann", role: "Ceramicist", avatar: img("lifestyle/avatar/2") },
    followers: 9480,
    followerGrowth30d: 0.12,
    verified: false,
    joinedAt: "2026-08-21",
    social: { instagram: "afterhours.ceramics" },
    storefront: storefront("minimal", "ink", "expanded", "Speckled stoneware and candles, thrown by hand after dark."),
    shipsFrom: "DE",
    processingDays: [4, 8],
    returnsDays: 14,
  },
  {
    id: "b_paper_riot",
    handle: "paper-riot",
    name: "Paper Riot",
    tagline: "Risograph prints, zines and posters from Jozi.",
    description:
      "Prints, posters, zines and records from a Braamfontein print shop that doubles as a gallery.",
    story: [
      "Paper Riot is a print collective of five illustrators sharing one risograph machine and a basement in Braamfontein.",
    ],
    mark: { text: "PR!", style: "condensed" },
    cover: img("lifestyle/art/7"),
    country: "ZA",
    city: "Johannesburg",
    currency: "ZAR",
    categories: ["art-design", "creative"],
    aesthetics: ["experimental", "vintage"],
    founded: 2019,
    founder: { name: "Thando Nkosi", role: "Printmaker", avatar: img("lifestyle/avatar/5") },
    followers: 7720,
    followerGrowth30d: 0.31,
    verified: false,
    joinedAt: "2026-09-12",
    social: { instagram: "paperriot.jozi", tiktok: "paperriot" },
    storefront: storefront("street", "aqua", "condensed", "Prints, posters, zines and records from the basement."),
    shipsFrom: "ZA",
    processingDays: [2, 5],
    returnsDays: 7,
  },
  {
    id: "b_velvet_underpass",
    handle: "velvet-underpass",
    name: "Velvet Underpass",
    tagline: "Leather goods for night shifts.",
    description:
      "Vegetable-tanned leather bags and small goods, cut and saddle-stitched in a former metro maintenance depot in Paris's 11th.",
    story: [
      "Idris Moreau builds bags the way his grandfather built saddles: one needle at a time, two threads, no glue where a stitch will do.",
    ],
    mark: { text: "VU", style: "expanded" },
    cover: img("objects/accessories-editorial/1"),
    country: "FR",
    city: "Paris",
    currency: "EUR",
    categories: ["accessories"],
    aesthetics: ["luxury", "contemporary"],
    founded: 2016,
    founder: { name: "Idris Moreau", role: "Leather artisan", avatar: img("lifestyle/avatar/7") },
    followers: 26044,
    followerGrowth30d: 0.05,
    verified: true,
    joinedAt: "2026-01-27",
    social: { instagram: "velvet.underpass", website: "velvetunderpass.example" },
    storefront: storefront("editorial", "ember", "expanded", "Vegetable-tanned leather, saddle-stitched in the 11th."),
    shipsFrom: "FR",
    processingDays: [3, 5],
    returnsDays: 30,
  },
  {
    id: "b_gridlock_supply",
    handle: "gridlock-supply",
    name: "Gridlock Supply",
    tagline: "Bodega-grade streetwear from Bed-Stuy.",
    description:
      "Truckers, court shoes and outerwear from a Bed-Stuy shop that started selling custom pairs out of a laundromat back room.",
    story: [
      "Marcus Bell customised sneakers for the block before he made his own. Gridlock now runs four drops a year and still restocks the laundromat first.",
    ],
    mark: { text: "GLS", style: "condensed" },
    cover: img("fashion/cover/9"),
    country: "US",
    city: "New York",
    currency: "USD",
    categories: ["streetwear", "sneakers", "accessories"],
    aesthetics: ["streetwear"],
    founded: 2018,
    founder: { name: "Marcus Bell", role: "Founder" },
    followers: 55870,
    followerGrowth30d: 0.07,
    verified: true,
    joinedAt: "2026-01-15",
    social: { instagram: "gridlocksupply", tiktok: "gridlocksupply", x: "gridlocksupply" },
    storefront: storefront("street", "acid", "condensed", "Four drops a year. The laundromat restocks first."),
    shipsFrom: "US",
    processingDays: [1, 2],
    returnsDays: 30,
  },
  {
    id: "b_kumasi_thread",
    handle: "kumasi-thread",
    name: "Kumasi Thread Co.",
    tagline: "Kente, deconstructed.",
    description:
      "Avant-garde coats, knits and tailoring built around hand-loomed kente, cut in Accra with weavers from Bonwire.",
    story: [
      "Kwame Asante grew up in Bonwire, the kente-weaving town outside Kumasi. His studio in Accra takes the cloth apart and rebuilds it into outerwear and tailoring.",
    ],
    mark: { text: "KT", style: "grotesk" },
    cover: img("fashion/campaign/7"),
    country: "GH",
    city: "Accra",
    currency: "GHS",
    categories: ["fashion", "streetwear"],
    aesthetics: ["avant-garde", "experimental"],
    founded: 2022,
    founder: { name: "Kwame Asante", role: "Designer" },
    followers: 11260,
    followerGrowth30d: 0.27,
    verified: true,
    joinedAt: "2026-07-30",
    social: { instagram: "kumasithread" },
    storefront: storefront("editorial", "acid", "condensed", "Hand-loomed kente, rebuilt into coats, knits and tailoring."),
    shipsFrom: "GH",
    processingDays: [4, 7],
    returnsDays: 14,
  },
  {
    id: "b_orun_studio",
    handle: "orun-studio",
    name: "Orun Studio",
    tagline: "Brass, bronze and objects for the home.",
    description:
      "Lost-wax cast brass jewellery and lighting drawing on Benin bronze-casting techniques, made in Lagos.",
    story: [
      "Orun works with a family of casters in Igun Street, Benin City, and finishes every piece in Lagos. The forms are new; the technique is centuries old.",
    ],
    mark: { text: "Ọ", style: "expanded" },
    cover: img("objects/accessories-editorial/2"),
    country: "NG",
    city: "Lagos",
    currency: "NGN",
    categories: ["jewelry", "home-lifestyle"],
    aesthetics: ["contemporary", "luxury"],
    founded: 2023,
    founder: { name: "Adaeze Okafor", role: "Founder" },
    followers: 5340,
    followerGrowth30d: 0.36,
    verified: false,
    joinedAt: "2026-10-04",
    social: { instagram: "orun.studio" },
    storefront: storefront("studio", "ember", "expanded", "Lost-wax brass, cast in Benin City and finished in Lagos."),
    shipsFrom: "NG",
    processingDays: [5, 10],
    returnsDays: 14,
  },
  {
    id: "b_signal_bloom",
    handle: "signal-bloom",
    name: "Signal Bloom",
    tagline: "Fragrance that smells like 3am in Hongdae.",
    description:
      "Genderless fragrance, body care and make-up from Seoul: ozonic, smoky and synthetic on purpose.",
    story: [
      "Perfumer Ji-woo Han builds each scent around a single night out: the rain on a club queue, a cigarette outside, the bus home.",
    ],
    mark: { text: "SB", style: "expanded" },
    cover: img("fashion/cover/2"),
    country: "KR",
    city: "Seoul",
    currency: "KRW",
    categories: ["beauty"],
    aesthetics: ["experimental", "contemporary"],
    founded: 2022,
    founder: { name: "Ji-woo Han", role: "Perfumer", avatar: img("lifestyle/avatar/8") },
    followers: 19820,
    followerGrowth30d: 0.14,
    verified: true,
    joinedAt: "2026-05-22",
    social: { instagram: "signal.bloom", tiktok: "signalbloom" },
    storefront: storefront("editorial", "violet", "grotesk", "Genderless fragrance in refillable aluminium."),
    shipsFrom: "KR",
    processingDays: [1, 3],
    returnsDays: 14,
  },
]

export const brandById = new Map(brands.map((b) => [b.id, b]))
export const brandByHandle = new Map(brands.map((b) => [b.handle, b]))

/** The merchant signed in to Brand Studio in the frontend prototype. */
export const STUDIO_BRAND_ID = "b_lagos_static"

/** Letters only, accents and dots taken off first ("Ọ" → "O", "H/A" → "HA"). */
const plainLetters = (s: string) => s.normalize("NFD").replace(/[^A-Za-z]/g, "").toUpperCase()

/**
 * Each brand's short code for order references and SKUs ("LS-10427", "LS-DANFOH-M-WAS"): the
 * letters of its mark, else the initials of its name ("Orun Studio" → "OS"). A code another brand
 * already uses falls back the same way, then takes more letters of the name, so no two brands share one.
 */
export const brandCodes: ReadonlyMap<string, string> = (() => {
  const taken = new Set<string>()
  const out = new Map<string, string>()
  for (const b of brands) {
    const words = b.name.split(/\s+/).map(plainLetters).filter(Boolean)
    const initials = words.map((w) => w[0]).join("")
    const name = words.join("")
    const candidates = [plainLetters(b.mark.text), initials, ...[3, 4, 5, 6].map((n) => name.slice(0, n))]
    const code = candidates.find((c) => c.length > 0 && !taken.has(c)) ?? b.id.toUpperCase()
    taken.add(code)
    out.set(b.id, code)
  }
  return out
})()

/** A brand's code (see brandCodes); a brand added in this browser gets one from its mark or name the same way. */
export function brandCode(brand: Pick<Brand, "id" | "name" | "mark">) {
  return brandCodes.get(brand.id) ?? (plainLetters(brand.mark.text) || brand.name.split(/\s+/).map((w) => plainLetters(w)[0] ?? "").join("") || "BR")
}
