import { currencies, type CurrencyCode } from "@/config/markets"
import { brandByHandle, brandCode } from "./brands"
import { img } from "./media"
import { daysAgo, randInt, rand } from "./seed"
import type { Brand, CategorySlug, ColourValue, Product, ProductBadge, ProductOption, Variant } from "./types"

type SizeSet = "apparel" | "shoes" | "one" | "rings"

type Spec = {
  brand: string
  slug: string
  name: string
  cat: CategorySlug
  sub: string
  /** Major units, in the brand's currency. */
  price: number
  compareAt?: number
  /**
   * Photos, first the product shot. A photo that isn't a close-up of the piece (an editorial, the
   * piece worn) gives its own alt text: `[ref, alt]`.
   */
  images: (string | [ref: string, alt: string])[]
  sizes?: SizeSet
  colours?: [string, string][]
  badges?: ProductBadge[]
  tags?: string[]
  desc: string
  details: string[]
  collections?: string[]
  createdDaysAgo: number
  dropId?: string
}

const SIZES: Record<SizeSet, string[]> = {
  apparel: ["XS", "S", "M", "L", "XL"],
  shoes: ["39", "40", "41", "42", "43", "44", "45"],
  one: ["One size"],
  rings: ["6", "7", "8", "9", "10"],
}

const specs: Spec[] = [
  // ── Lagos Static ─────────────────────────────────────────
  { brand: "lagos-static", slug: "static-moto-jacket", name: "Static Moto Jacket", cat: "streetwear", sub: "Outerwear", price: 185000, images: ["fashion/outerwear/0"], sizes: "apparel", colours: [["Black", "#111111"]], badges: ["limited"], tags: ["leather", "outerwear"], desc: "A cropped moto jacket in vegetable-tanned goat leather with an asymmetric zip, snap lapels and quilted shoulders.", details: ["Vegetable-tanned goat leather", "Cotton twill lining", "Boxy fit — size down for a closer cut", "Cut and finished in Yaba, Lagos"], collections: ["c_ls_core"], createdDaysAgo: 34 },
  { brand: "lagos-static", slug: "danfo-heavyweight-hoodie", name: "Danfo Heavyweight Hoodie", cat: "streetwear", sub: "Hoodies", price: 78000, images: ["fashion/tops/1", ["fashion/streetwear-editorial/0", "Danfo Heavyweight Hoodie in signal orange, worn with a respirator mask and a teal smoke flare"], ["fashion/streetwear-editorial/1", "Danfo Heavyweight Hoodie in washed black under a blue-lined jacket, next to the Third Mainland Tee in black"]], sizes: "apparel", colours: [["Washed black", "#1a1a1a"], ["Signal orange", "#e0672a"]], badges: ["new"], tags: ["hoodie", "graphic"], desc: "480gsm loopback fleece with a puff-printed danfo route map across the back. Dropped shoulders, double-layer hood.", details: ["480gsm cotton loopback fleece", "Puff print, hand-pulled", "Oversized fit", "Made in Lagos in a run of 180"], collections: ["c_ls_drop06"], createdDaysAgo: 6, dropId: "d_ls_third_mainland" },
  { brand: "lagos-static", slug: "third-mainland-tee", name: "Third Mainland Tee", cat: "streetwear", sub: "T-shirts", price: 32000, images: ["fashion/tops/6"], sizes: "apparel", colours: [["White", "#f1efe9"], ["Black", "#111111"]], badges: ["new"], tags: ["tee", "graphic"], desc: "Heavyweight jersey tee with a long-exposure photograph of the Third Mainland Bridge at 4am printed on the back.", details: ["260gsm combed cotton", "Water-based back print", "Boxy fit"], collections: ["c_ls_drop06"], createdDaysAgo: 4, dropId: "d_ls_third_mainland" },
  { brand: "lagos-static", slug: "yaba-cargo-trouser", name: "Yaba Cargo Trouser", cat: "streetwear", sub: "Trousers", price: 68000, images: ["fashion/bottoms/1"], sizes: "apparel", colours: [["Bone", "#d9d2c3"]], tags: ["cargo"], desc: "Relaxed cargo trouser in washed ripstop with articulated knees, a drawcord hem and six pockets.", details: ["Cotton-nylon ripstop", "Articulated knee", "Drawcord hem"], collections: ["c_ls_core"], createdDaysAgo: 58 },
  { brand: "lagos-static", slug: "signal-beanie", name: "Signal Beanie", cat: "accessories", sub: "Headwear", price: 22000, images: ["objects/headwear/0"], sizes: "one", colours: [["Rust", "#a2502a"], ["Black", "#111111"]], tags: ["beanie", "knit"], desc: "Ribbed merino-blend beanie with a woven Static tab.", details: ["70% merino, 30% recycled nylon", "Woven tab"], collections: ["c_ls_drop06"], createdDaysAgo: 21 },
  { brand: "lagos-static", slug: "okada-utility-parka", name: "Okada Utility Parka", cat: "streetwear", sub: "Outerwear", price: 98000, compareAt: 120000, images: ["fashion/outerwear/1"], sizes: "apparel", colours: [["Olive", "#4b4f32"]], badges: ["last-pieces"], tags: ["parka", "outerwear"], desc: "A water-resistant hooded parka with storm cuffs and a reflective okada-route print on the lining.", details: ["Water-resistant cotton-nylon shell", "Reflective printed lining", "Two-way zip"], collections: ["c_ls_core"], createdDaysAgo: 96 },

  // ── Oyin Atelier ─────────────────────────────────────────
  { brand: "oyin-atelier", slug: "iseyin-sheer-blouse", name: "Iseyin Sheer Blouse", cat: "fashion", sub: "Shirts", price: 185000, images: ["fashion/tops/4"], sizes: "apparel", colours: [["Ink", "#1b1c24"]], tags: ["silk", "blouse"], desc: "A sheer silk-georgette blouse with a hand-woven aso-oke placket from Iseyin.", details: ["Silk georgette", "Hand-woven aso-oke placket", "Relaxed fit"], collections: ["c_oy_s04"], createdDaysAgo: 18, dropId: "d_oy_s04" },
  { brand: "oyin-atelier", slug: "aso-oke-trim-suit-jacket", name: "Aso-oke Trim Suit Jacket", cat: "fashion", sub: "Tailoring", price: 320000, images: ["fashion/streetwear-editorial/4"], sizes: "apparel", colours: [["Black", "#121212"]], badges: ["exclusive"], tags: ["suit", "tailoring"], desc: "A single-breasted wool suit jacket, half-canvassed, with aso-oke piping hidden inside the lapel and cuff.", details: ["Wool, half-canvas construction", "Aso-oke piping", "Hand-finished buttonholes"], collections: ["c_oy_s04"], createdDaysAgo: 18, dropId: "d_oy_s04" },
  { brand: "oyin-atelier", slug: "plum-silk-gown", name: "Plum Silk Gown", cat: "fashion", sub: "Dresses", price: 240000, images: ["fashion/dresses/2"], sizes: "apparel", colours: [["Plum", "#5a2a4d"]], tags: ["dress", "silk"], desc: "An off-shoulder gown in heavy silk charmeuse, fitted through the body and falling to the floor.", details: ["Silk charmeuse", "Boned bodice", "Hidden side zip"], collections: ["c_oy_s04"], createdDaysAgo: 40 },
  { brand: "oyin-atelier", slug: "teal-flow-maxi-dress", name: "Teal Flow Maxi Dress", cat: "fashion", sub: "Dresses", price: 210000, images: ["fashion/dresses/0"], sizes: "apparel", colours: [["Teal", "#1f6f6b"]], tags: ["dress"], desc: "A bias-cut maxi in washed cupro that moves the moment you do.", details: ["Washed cupro", "Bias cut", "Adjustable straps"], createdDaysAgo: 75 },
  { brand: "oyin-atelier", slug: "pleated-wide-trouser", name: "Pleated Wide Trouser", cat: "fashion", sub: "Trousers", price: 165000, images: ["fashion/bottoms/2"], sizes: "apparel", colours: [["Cream", "#e6dcc8"], ["Black", "#121212"]], tags: ["trouser", "tailoring"], desc: "A double-pleated wide trouser in wool-linen with a high rise.", details: ["Wool-linen blend", "Double pleat", "High rise"], collections: ["c_oy_s04"], createdDaysAgo: 18 },
  { brand: "oyin-atelier", slug: "ruffle-off-shoulder-blouse", name: "Ruffle Off-Shoulder Blouse", cat: "fashion", sub: "Shirts", price: 145000, images: ["fashion/tops/7"], sizes: "apparel", colours: [["Ivory", "#efe9de"]], badges: ["new"], tags: ["blouse"], desc: "Cotton poplin with a single deep ruffle at the neckline.", details: ["Cotton poplin", "Elasticated neckline"], createdDaysAgo: 9 },
  { brand: "oyin-atelier", slug: "gold-lace-evening-dress", name: "Gold Lace Evening Dress", cat: "fashion", sub: "Dresses", price: 380000, images: ["fashion/dresses/1"], sizes: "apparel", colours: [["Gold", "#b8953f"]], badges: ["limited"], tags: ["dress", "lace"], desc: "A fit-and-flare evening dress in metallic guipure lace over a silk slip. Made to order in six weeks.", details: ["Metallic guipure lace", "Silk slip lining", "Made to order"], createdDaysAgo: 27 },

  // ── Null Form ────────────────────────────────────────────
  { brand: "null-form", slug: "nf-01-sole-study", name: "NF-01 Sole Study", cat: "sneakers", sub: "Low-tops", price: 289000, images: ["objects/sneakers/3"], sizes: "shoes", colours: [["Multi", "#c0392b"]], badges: ["limited"], tags: ["sneaker", "numbered"], desc: "The first Null Form model: a chunky sculpted sole under panelled suede and mesh. Numbered run.", details: ["Injection-moulded EVA sole", "Suede and mesh upper", "Numbered insole", "True to size"], collections: ["c_nf_studies"], createdDaysAgo: 64 },
  { brand: "null-form", slug: "nf-02-court", name: "NF-02 Court", cat: "sneakers", sub: "Low-tops", price: 239000, images: ["objects/sneakers/5"], sizes: "shoes", colours: [["White", "#f2f1ec"]], tags: ["sneaker"], desc: "A perforated leather court shoe on a slim cupsole that's lighter than it looks.", details: ["Perforated full-grain leather", "Stitched cupsole"], collections: ["c_nf_studies"], createdDaysAgo: 41 },
  { brand: "null-form", slug: "nf-03-chukka", name: "NF-03 Chukka", cat: "sneakers", sub: "Boots", price: 259000, images: ["objects/sneakers/11"], sizes: "shoes", colours: [["Black denim", "#1c1f26"]], tags: ["chukka"], desc: "A raw black-denim chukka on a stacked leather sole.", details: ["Raw selvedge denim upper", "Stacked leather sole"], createdDaysAgo: 22 },
  { brand: "null-form", slug: "nf-04-prism", name: "NF-04 Prism", cat: "sneakers", sub: "Runners", price: 319000, images: ["objects/sneakers/4"], sizes: "shoes", colours: [["Prism", "#7d6bd6"]], badges: ["limited", "new"], tags: ["runner", "numbered"], desc: "An iridescent knit runner that shifts from violet to teal as you move. 300 pairs, numbered.", details: ["Iridescent recycled-polyester knit", "Segmented rubber outsole", "300 numbered pairs"], collections: ["c_nf_studies"], createdDaysAgo: 2, dropId: "d_nf_04" },
  { brand: "null-form", slug: "nf-05-trail-boot", name: "NF-05 Trail Boot", cat: "sneakers", sub: "Boots", price: 269000, images: ["objects/sneakers/1"], sizes: "shoes", colours: [["Dark brown", "#3b2a20"]], tags: ["boot", "trail"], desc: "A lace-up trail boot in oiled leather on a lugged sole.", details: ["Oiled full-grain leather", "Lugged rubber outsole", "Gusseted tongue"], createdDaysAgo: 12 },

  // ── Halfmoon Archive ─────────────────────────────────────
  { brand: "halfmoon-archive", slug: "restored-camel-overcoat", name: "Restored Camel Overcoat", cat: "fashion", sub: "Outerwear", price: 285, images: ["fashion/outerwear/2"], sizes: "apparel", colours: [["Camel", "#b08a5e"]], badges: ["exclusive"], tags: ["vintage", "coat"], desc: "A 1970s camel-hair overcoat, relined, rebuttoned and hand-darned at the cuffs. One per size.", details: ["Vintage camel hair", "New cupro lining", "Visible hand-darning"], collections: ["c_hm_restored"], createdDaysAgo: 30 },
  { brand: "halfmoon-archive", slug: "darned-shawl-collar-knit", name: "Darned Shawl-Collar Knit", cat: "fashion", sub: "Knitwear", price: 140, images: ["fashion/tops/2"], sizes: "apparel", colours: [["Charcoal", "#3a3a3d"]], tags: ["knit", "vintage"], desc: "A heavy wool shawl-collar cardigan with contrast darning at the elbows.", details: ["100% wool", "Contrast darning", "Horn buttons"], collections: ["c_hm_restored"], createdDaysAgo: 52 },
  { brand: "halfmoon-archive", slug: "patched-archive-denim", name: "Patched Archive Denim", cat: "fashion", sub: "Trousers", price: 120, images: ["fashion/bottoms/3"], sizes: "apparel", colours: [["Indigo", "#2f3d5c"]], tags: ["denim", "vintage"], desc: "Vintage tapered jeans, patched from the inside with offcuts from other pairs.", details: ["Vintage cotton denim", "Hand-patched", "Each pair unique"], collections: ["c_hm_restored"], createdDaysAgo: 15 },
  { brand: "halfmoon-archive", slug: "merino-roll-neck", name: "Merino Roll Neck", cat: "fashion", sub: "Knitwear", price: 95, compareAt: 120, images: ["fashion/tops/5"], sizes: "apparel", colours: [["Navy", "#1f2a44"]], tags: ["knit"], desc: "A fine-gauge merino roll neck cut from a 1960s pattern.", details: ["Extra-fine merino", "Archive pattern"], collections: ["c_hm_new"], createdDaysAgo: 88 },
  { brand: "halfmoon-archive", slug: "resoled-work-boots", name: "Resoled Work Boots", cat: "fashion", sub: "Footwear", price: 210, images: ["objects/sneakers/0", ["objects/sneakers/6", "Resoled Work Boots, worn and being laced"]], sizes: "shoes", colours: [["Tan", "#9b6b43"]], badges: ["last-pieces"], tags: ["boots", "vintage"], desc: "Vintage nubuck work boots, cleaned, re-welted and resoled by a cobbler in Hackney.", details: ["Vintage nubuck", "New Goodyear welt and sole", "Limited sizes"], collections: ["c_hm_restored"], createdDaysAgo: 44 },
  { brand: "halfmoon-archive", slug: "archive-brogue-boot", name: "Archive Brogue Boot", cat: "fashion", sub: "Footwear", price: 245, images: ["objects/sneakers/8"], sizes: "shoes", colours: [["Tan", "#9b6b43"]], tags: ["boots"], desc: "A wingtip brogue boot made to a 1950s last in Northampton.", details: ["Calf leather", "Leather sole", "Goodyear welted"], collections: ["c_hm_new"], createdDaysAgo: 61 },
  { brand: "halfmoon-archive", slug: "wool-beret", name: "Wool Beret", cat: "accessories", sub: "Headwear", price: 45, images: ["objects/headwear/1"], sizes: "one", colours: [["Navy", "#1f2a44"]], tags: ["beret"], desc: "A felted wool beret with a leather sweatband.", details: ["Felted merino", "Leather sweatband"], collections: ["c_hm_new"], createdDaysAgo: 19 },
  { brand: "halfmoon-archive", slug: "wide-brim-fedora", name: "Wide-Brim Fedora", cat: "accessories", sub: "Headwear", price: 110, images: ["objects/headwear/2"], sizes: "one", colours: [["Dusty blue", "#7a8ca3"]], tags: ["hat"], desc: "A restored wool-felt fedora, re-blocked and fitted with a new grosgrain band.", details: ["Vintage wool felt", "New grosgrain band"], createdDaysAgo: 70 },

  // ── Ferro Club ───────────────────────────────────────────
  { brand: "ferro-club", slug: "centro-box-chain", name: "Centro Box Chain", cat: "jewelry", sub: "Chains", price: 4800, images: ["objects/jewelry/2"], sizes: "one", colours: [["Sterling", "#c9c9cf"]], badges: ["new"], tags: ["silver", "chain"], desc: "A fine sterling box chain with a square pavé pendant, hand-set in Centro.", details: ["925 sterling silver", "50cm chain", "Hand-set stones"], collections: ["c_fc_core"], createdDaysAgo: 9 },
  { brand: "ferro-club", slug: "halo-no-9", name: "Halo No. 9", cat: "jewelry", sub: "Rings", price: 3200, images: ["objects/jewelry/0"], sizes: "rings", colours: [["Sterling", "#c9c9cf"]], badges: ["limited"], tags: ["silver", "ring"], desc: "A sterling halo ring cast from a hand-carved wax. Forty pieces.", details: ["925 sterling silver", "Hand-carved wax original", "Edition of 40"], collections: ["c_fc_core"], createdDaysAgo: 3, dropId: "d_fc_halo" },
  { brand: "ferro-club", slug: "charm-chain-set", name: "Charm Chain Set", cat: "jewelry", sub: "Chains", price: 2700, images: ["objects/jewelry/3"], sizes: "one", colours: [["Mixed metal", "#c9b98f"]], tags: ["chain", "charms"], desc: "Three layering chains in silver and gold vermeil with cast charms.", details: ["Sterling silver and gold vermeil", "Set of three"], createdDaysAgo: 44 },
  { brand: "ferro-club", slug: "crystal-link-bracelet", name: "Crystal Link Bracelet", cat: "jewelry", sub: "Bracelets", price: 3900, images: ["objects/jewelry/1"], sizes: "one", colours: [["Sterling", "#c9c9cf"]], tags: ["silver", "bracelet"], desc: "A sterling link bracelet set with crystals, made for the after-party.", details: ["925 sterling silver", "Crystal stones", "Box clasp"], collections: ["c_fc_core"], createdDaysAgo: 27 },
  { brand: "ferro-club", slug: "ferro-round-shades", name: "Ferro Round Shades", cat: "accessories", sub: "Eyewear", price: 1600, images: ["objects/eyewear/0"], sizes: "one", colours: [["Black", "#111111"]], tags: ["sunglasses"], desc: "Small round acetate sunglasses with sterling temple pins.", details: ["Acetate frame", "Sterling silver pins", "UV400 lenses"], createdDaysAgo: 67 },

  // ── Dune Apothecary ─────────────────────────────────────
  { brand: "dune-apothecary", slug: "baobab-face-oil", name: "Baobab Face Oil", cat: "beauty", sub: "Skin care", price: 4500, images: ["lifestyle/beauty/5"], sizes: "one", tags: ["face oil"], desc: "A lightweight face oil of cold-pressed baobab and marula with a trace of frankincense.", details: ["30ml", "Cold-pressed baobab and marula", "Scent from botanicals only"], collections: ["c_du_ritual"], createdDaysAgo: 48 },
  { brand: "dune-apothecary", slug: "marula-balm", name: "Marula Balm", cat: "beauty", sub: "Skin care", price: 3200, images: ["lifestyle/beauty/7"], sizes: "one", badges: ["restock"], tags: ["balm"], desc: "A solid balm for lips, cuticles and dry skin, in a refillable glass jar.", details: ["50g", "Refillable glass jar"], collections: ["c_du_ritual"], createdDaysAgo: 120 },
  { brand: "dune-apothecary", slug: "frankincense-body-wash", name: "Frankincense Body Wash", cat: "beauty", sub: "Body", price: 2800, images: ["lifestyle/beauty/4"], sizes: "one", tags: ["body"], desc: "A low-foam body wash with Kenyan frankincense resin.", details: ["250ml", "Sulphate-free"], createdDaysAgo: 33 },
  { brand: "dune-apothecary", slug: "rift-serum", name: "Rift Serum", cat: "beauty", sub: "Skin care", price: 5200, images: ["lifestyle/beauty/2"], sizes: "one", badges: ["new"], tags: ["serum"], desc: "A niacinamide and moringa serum for uneven tone.", details: ["30ml", "5% niacinamide", "Cold-pressed moringa"], collections: ["c_du_ritual"], createdDaysAgo: 8 },

  // ── Mute Objects ─────────────────────────────────────────
  { brand: "mute-objects", slug: "mo-1-headphones", name: "MO-1 Headphones", cat: "technology", sub: "Audio", price: 48000, images: ["lifestyle/tech/0"], sizes: "one", colours: [["Black", "#151515"]], tags: ["audio", "headphones"], desc: "Closed-back headphones in bead-blasted aluminium with replaceable pads, cable and battery.", details: ["40mm drivers", "Replaceable pads, cable and battery", "Bluetooth 5.4 and 3.5mm"], collections: ["c_mo_audio"], createdDaysAgo: 70 },
  { brand: "mute-objects", slug: "mo-2-leather", name: "MO-2 Leather", cat: "technology", sub: "Audio", price: 62000, images: ["lifestyle/tech/1"], sizes: "one", colours: [["Black", "#151515"]], badges: ["new"], tags: ["audio", "headphones"], desc: "The MO-1 in lambskin and walnut, with memory-foam pads.", details: ["Lambskin and walnut", "40mm drivers", "Replaceable parts"], collections: ["c_mo_audio"], createdDaysAgo: 10 },
  { brand: "mute-objects", slug: "bookshelf-speaker", name: "Bookshelf Speaker", cat: "technology", sub: "Audio", price: 36000, compareAt: 42000, images: ["lifestyle/tech/6"], sizes: "one", tags: ["audio", "speakers"], desc: "A compact powered speaker in solid ash with a single volume dial. Pair two for stereo.", details: ["Solid ash cabinet", "USB-C and optical in"], collections: ["c_mo_audio"], createdDaysAgo: 110 },
  { brand: "mute-objects", slug: "aluminium-65-keyboard", name: "65% Aluminium Keyboard", cat: "technology", sub: "Desk", price: 29800, images: ["lifestyle/tech/5"], sizes: "one", colours: [["Storm", "#56636f"]], badges: ["new"], tags: ["keyboard"], desc: "A gasket-mounted 65% keyboard with hot-swap sockets, a CNC aluminium case and a brass space bar.", details: ["Gasket mount", "Hot-swap sockets", "CNC aluminium case"], collections: ["c_mo_desk"], createdDaysAgo: 5 },
  { brand: "mute-objects", slug: "travel-40-keyboard", name: "40% Travel Keyboard", cat: "technology", sub: "Desk", price: 21800, images: ["lifestyle/tech/4"], sizes: "one", colours: [["Black", "#151515"]], tags: ["keyboard"], desc: "A 40% keyboard small enough for a jacket pocket, with orange accent keys.", details: ["Low-profile switches", "USB-C and Bluetooth"], collections: ["c_mo_desk"], createdDaysAgo: 33 },
  { brand: "mute-objects", slug: "28mm-prime-lens", name: "28mm Prime Lens", cat: "technology", sub: "Photo", price: 42000, images: ["lifestyle/tech/3"], sizes: "one", tags: ["camera", "lens"], desc: "A compact 28mm f/2.8 manual-focus lens with a metal hood.", details: ["28mm f/2.8", "Manual focus", "Metal hood included"], createdDaysAgo: 37 },
  { brand: "mute-objects", slug: "studio-microphone", name: "Studio Microphone", cat: "technology", sub: "Audio", price: 26000, images: ["lifestyle/tech/2"], sizes: "one", tags: ["audio", "microphone"], desc: "A dynamic broadcast microphone with USB-C and XLR out.", details: ["Dynamic capsule", "USB-C and XLR"], collections: ["c_mo_audio"], createdDaysAgo: 60 },
  { brand: "mute-objects", slug: "field-timer-watch", name: "Field Timer Watch", cat: "accessories", sub: "Watches", price: 27500, images: ["objects/watches/0"], sizes: "one", tags: ["watch"], desc: "A quartz chronograph with a rotating timer bezel and a steel case.", details: ["40mm steel case", "Japanese quartz", "Rotating timer bezel"], createdDaysAgo: 26 },
  { brand: "mute-objects", slug: "field-chronograph", name: "Field Chronograph", cat: "accessories", sub: "Watches", price: 34000, images: ["objects/watches/1"], sizes: "one", tags: ["watch"], desc: "A steel chronograph on a brown leather strap.", details: ["39mm steel case", "Meca-quartz chronograph", "Leather strap"], createdDaysAgo: 51 },
  { brand: "mute-objects", slug: "restored-portable-tv", name: "Restored Portable TV", cat: "technology", sub: "Objects", price: 38000, images: ["lifestyle/tech/7"], sizes: "one", badges: ["last-pieces"], tags: ["vintage", "tv"], desc: "A 1970s portable CRT, restored and rewired with an HDMI input.", details: ["Restored 1970s CRT", "HDMI input added", "One of three"], createdDaysAgo: 14 },

  // ── Afterhours Ceramics ──────────────────────────────────
  { brand: "afterhours-ceramics", slug: "speckled-bud-vases", name: "Speckled Bud Vases", cat: "home-lifestyle", sub: "Vases", price: 68, images: ["lifestyle/home/1"], sizes: "one", tags: ["ceramic", "vase"], desc: "Three small thrown bud vases in speckled stoneware — every set different.", details: ["Set of three", "Speckled stoneware", "8–12cm tall"], collections: ["c_ah_night"], createdDaysAgo: 14 },
  { brand: "afterhours-ceramics", slug: "night-candle-vessel", name: "Night Candle", cat: "home-lifestyle", sub: "Candles", price: 48, images: ["lifestyle/home/2"], sizes: "one", badges: ["new"], tags: ["candle"], desc: "A smoky cedar and fig candle poured into a reusable glass tumbler.", details: ["Coconut-soy wax", "50-hour burn"], collections: ["c_ah_night"], createdDaysAgo: 7 },
  { brand: "afterhours-ceramics", slug: "plinth-vase-white", name: "Plinth Vase, White", cat: "home-lifestyle", sub: "Vases", price: 120, images: ["lifestyle/home/0"], sizes: "one", tags: ["ceramic", "vase"], desc: "A matte white stoneware vase on a cast plinth.", details: ["Stoneware", "Matte glaze", "32cm tall"], createdDaysAgo: 49 },
  { brand: "afterhours-ceramics", slug: "pillar-candle-trio", name: "Pillar Candle Trio", cat: "home-lifestyle", sub: "Candles", price: 42, images: ["lifestyle/home/7"], sizes: "one", tags: ["candle"], desc: "Three unscented ivory pillar candles for the kitchen table.", details: ["Set of three", "Unscented rapeseed wax"], collections: ["c_ah_night"], createdDaysAgo: 81 },

  // ── Paper Riot ───────────────────────────────────────────
  { brand: "paper-riot", slug: "pigment-study-01", name: "Pigment Study 01", cat: "art-design", sub: "Prints", price: 650, images: ["lifestyle/art/1"], sizes: "one", tags: ["print"], desc: "A giclée of the collective's ink-in-water studies, signed and numbered from an edition of 60.", details: ["A3 giclée on cotton rag", "Edition of 60, signed"], collections: ["c_pr_prints"], createdDaysAgo: 19 },
  { brand: "paper-riot", slug: "poster-series-03", name: "Poster Series 03", cat: "art-design", sub: "Posters", price: 980, images: ["lifestyle/art/3"], sizes: "one", badges: ["last-pieces"], tags: ["poster", "risograph"], desc: "Art-deco risograph reissues from the 2026 basement gig season.", details: ["Set of three, A2", "Recycled 170gsm stock"], collections: ["c_pr_prints"], createdDaysAgo: 160, dropId: "d_pr_posters" },
  { brand: "paper-riot", slug: "riot-zine-vol-4", name: "Riot Zine Vol. 4", cat: "creative", sub: "Zines", price: 180, images: ["lifestyle/creative/0"], sizes: "one", badges: ["new"], tags: ["zine"], desc: "48 pages of Jozi street photography, interviews and illustration.", details: ["48 pages, A5", "Saddle-stitched"], createdDaysAgo: 3 },
  { brand: "paper-riot", slug: "marble-pour-print", name: "Marble Pour Print", cat: "art-design", sub: "Prints", price: 1200, images: ["lifestyle/art/2"], sizes: "one", tags: ["print"], desc: "An acrylic-pour original, scanned and printed at full size.", details: ["A2 giclée", "Edition of 40"], collections: ["c_pr_prints"], createdDaysAgo: 55 },
  { brand: "paper-riot", slug: "basement-sessions-vinyl", name: "Basement Sessions Vinyl", cat: "creative", sub: "Records", price: 420, images: ["lifestyle/creative/1"], sizes: "one", tags: ["vinyl", "music"], desc: "A split 12\" pressed in magenta and yellow from the basement gig recordings.", details: ["12\" coloured vinyl", "Printed sleeve"], createdDaysAgo: 40 },
  { brand: "paper-riot", slug: "portrait-print-ama", name: "Portrait Print: Ama", cat: "art-design", sub: "Prints", price: 850, images: ["lifestyle/art/5"], sizes: "one", tags: ["print", "photography"], desc: "A high-contrast silver-gelatin style portrait print, signed.", details: ["A3", "Edition of 40"], collections: ["c_pr_prints"], createdDaysAgo: 28 },

  // ── Velvet Underpass ─────────────────────────────────────
  { brand: "velvet-underpass", slug: "woven-metro-tote", name: "Woven Metro Tote", cat: "accessories", sub: "Bags", price: 340, images: ["objects/bags/2"], sizes: "one", colours: [["Cognac", "#8a4b26"]], tags: ["leather", "tote"], desc: "A hand-woven tote in vegetable-tanned leather on a chain strap.", details: ["Vegetable-tanned leather", "Hand-woven body", "Brass chain strap"], collections: ["c_vu_core"], createdDaysAgo: 42 },
  { brand: "velvet-underpass", slug: "night-shift-crossbody", name: "Night Shift Crossbody", cat: "accessories", sub: "Bags", price: 260, images: ["objects/bags/4"], sizes: "one", colours: [["Cognac", "#8a4b26"]], badges: ["new"], tags: ["leather", "crossbody"], desc: "A compact pebbled-leather crossbody with a magnetic flap.", details: ["Pebbled calf leather", "Magnetic closure", "Adjustable strap"], collections: ["c_vu_core"], createdDaysAgo: 10 },
  { brand: "velvet-underpass", slug: "depot-backpack", name: "Depot Backpack", cat: "accessories", sub: "Bags", price: 420, images: ["objects/bags/1"], sizes: "one", colours: [["Black", "#111111"]], tags: ["leather", "backpack"], desc: "A structured leather backpack with a padded laptop sleeve.", details: ["Vegetable-tanned leather", "Fits a 16\" laptop"], createdDaysAgo: 63 },
  { brand: "velvet-underpass", slug: "depot-briefcase", name: "Depot Briefcase", cat: "accessories", sub: "Bags", price: 480, images: ["objects/bags/3"], sizes: "one", colours: [["Tan", "#9b6b43"]], tags: ["leather", "briefcase"], desc: "A two-tone saddle-stitched briefcase with a key lock.", details: ["Vegetable-tanned leather", "Hand saddle-stitched", "Brass key lock"], createdDaysAgo: 90 },
  { brand: "velvet-underpass", slug: "python-box-clutch", name: "Python Box Clutch", cat: "accessories", sub: "Bags", price: 390, images: ["objects/bags/5"], sizes: "one", badges: ["limited"], tags: ["clutch"], desc: "A hard-shell box clutch in embossed leather with a knuckle-duster clasp.", details: ["Python-embossed calf leather", "Brass clasp"], createdDaysAgo: 24 },
  { brand: "velvet-underpass", slug: "tunnel-cat-eye", name: "Tunnel Cat-Eye", cat: "accessories", sub: "Eyewear", price: 180, images: ["objects/eyewear/3"], sizes: "one", colours: [["Cream", "#e7dcc6"]], tags: ["sunglasses"], desc: "Cat-eye acetate frames with brown gradient lenses.", details: ["Acetate frame", "UV400 lenses"], createdDaysAgo: 31 },
  { brand: "velvet-underpass", slug: "riviera-wire-shades", name: "Riviera Wire Shades", cat: "accessories", sub: "Eyewear", price: 160, images: ["objects/eyewear/1"], sizes: "one", colours: [["Gold", "#c4a35a"]], tags: ["sunglasses"], desc: "Round gold-wire frames with bottle-green lenses.", details: ["Titanium wire frame", "Glass lenses"], createdDaysAgo: 46 },
  { brand: "velvet-underpass", slug: "depot-zip-boot", name: "Depot Zip Boot", cat: "accessories", sub: "Footwear", price: 360, images: ["objects/sneakers/10"], sizes: "shoes", colours: [["Tan", "#9b6b43"]], tags: ["boots", "leather"], desc: "An ankle boot in tan calf with a side zip and a stacked heel.", details: ["Calf leather", "Side zip", "Leather sole"], createdDaysAgo: 36 },

  // ── Gridlock Supply ──────────────────────────────────────
  { brand: "gridlock-supply", slug: "laundromat-trucker", name: "Laundromat Trucker", cat: "accessories", sub: "Headwear", price: 45, images: ["objects/headwear/3"], sizes: "one", colours: [["White", "#f2f1ec"]], badges: ["restock"], tags: ["cap"], desc: "A foam-front trucker cap with a mesh back and snap strap.", details: ["Foam front panel", "Mesh back", "Snapback"], collections: ["c_gl_core"], createdDaysAgo: 140, dropId: "d_gl_restock" },
  { brand: "gridlock-supply", slug: "gls-court", name: "GLS Court", cat: "sneakers", sub: "Low-tops", price: 160, images: ["objects/sneakers/7"], sizes: "shoes", colours: [["White", "#f2f1ec"]], badges: ["restock"], tags: ["sneaker"], desc: "A clean leather court shoe with a cream midsole.", details: ["Full-grain leather", "Rubber cupsole"], collections: ["c_gl_core"], createdDaysAgo: 36, dropId: "d_gl_restock" },
  { brand: "gridlock-supply", slug: "bodega-sherpa-fleece", name: "Bodega Sherpa Fleece", cat: "streetwear", sub: "Outerwear", price: 180, images: ["fashion/outerwear/3"], sizes: "apparel", colours: [["Ecru", "#ece7dc"]], tags: ["fleece", "outerwear"], desc: "A boxy sherpa fleece with nylon pocket trims and a full zip.", details: ["Recycled polyester sherpa", "Nylon trims"], collections: ["c_gl_core"], createdDaysAgo: 20 },
  { brand: "gridlock-supply", slug: "leopard-camp-shirt", name: "Leopard Camp Shirt", cat: "streetwear", sub: "Shirts", price: 72, compareAt: 90, images: ["fashion/tops/3"], sizes: "apparel", colours: [["Leopard", "#a87b45"]], tags: ["shirt"], desc: "A short-sleeve camp-collar shirt in leopard-print viscose.", details: ["Viscose", "Camp collar"], createdDaysAgo: 77 },
  { brand: "gridlock-supply", slug: "gls-low", name: "GLS Low", cat: "sneakers", sub: "Low-tops", price: 140, images: ["objects/sneakers/2"], sizes: "shoes", colours: [["White/tan", "#e9e1d3"]], badges: ["new"], tags: ["sneaker"], desc: "A minimal leather low-top with a suede heel tab.", details: ["Full-grain leather", "Suede heel tab", "Stitched cupsole"], createdDaysAgo: 11 },
  { brand: "gridlock-supply", slug: "shade-02", name: "Shade 02", cat: "accessories", sub: "Eyewear", price: 95, images: ["objects/eyewear/2"], sizes: "one", colours: [["Black", "#111111"]], tags: ["sunglasses"], desc: "Browline shades with gradient lenses.", details: ["Acetate and metal frame", "UV400"], createdDaysAgo: 31 },
  { brand: "gridlock-supply", slug: "block-skate-deck", name: "Block Skate Deck", cat: "creative", sub: "Skate", price: 85, images: ["lifestyle/creative/2"], sizes: "one", tags: ["skate"], desc: "A 7-ply maple deck with the Gridlock block graphic.", details: ["7-ply Canadian maple", "8.25\""], createdDaysAgo: 46 },
  { brand: "gridlock-supply", slug: "commuter-backpack", name: "Commuter Backpack", cat: "accessories", sub: "Bags", price: 150, images: ["objects/bags/0"], sizes: "one", colours: [["Black", "#111111"]], tags: ["backpack"], desc: "A weatherproof technical backpack with a hidden laptop compartment.", details: ["Coated ripstop", "Waterproof zips", "20L"], createdDaysAgo: 52 },

  // ── Kumasi Thread Co. ────────────────────────────────────
  { brand: "kumasi-thread", slug: "bonwire-oversized-coat", name: "Bonwire Oversized Coat", cat: "fashion", sub: "Outerwear", price: 4800, images: ["fashion/outerwear/5"], sizes: "apparel", colours: [["Black", "#121212"]], badges: ["exclusive"], tags: ["coat", "kente"], desc: "An oversized black wool coat lined with hand-loomed kente strips from Bonwire.", details: ["Wool melton shell", "Hand-loomed kente lining", "Each lining unique"], collections: ["c_kt_bonwire"], createdDaysAgo: 16, dropId: "d_kt_bonwire" },
  { brand: "kumasi-thread", slug: "loom-knit-sweater", name: "Loom Knit Sweater", cat: "fashion", sub: "Knitwear", price: 1900, images: ["fashion/tops/0"], sizes: "apparel", colours: [["Burgundy", "#6b2232"]], tags: ["knit"], desc: "A chunky cotton sweater knitted on the same pattern as a kente strip.", details: ["Organic cotton", "Kente-pattern knit"], collections: ["c_kt_bonwire"], createdDaysAgo: 16, dropId: "d_kt_bonwire" },
  { brand: "kumasi-thread", slug: "kente-print-midi-skirt", name: "Kente-Print Midi Skirt", cat: "fashion", sub: "Skirts", price: 2200, images: ["fashion/bottoms/0"], sizes: "apparel", colours: [["Red/yellow", "#c2402a"]], tags: ["skirt", "print"], desc: "A full midi skirt in a print drawn from a kente pattern.", details: ["Cotton sateen", "Side pockets"], createdDaysAgo: 29 },
  { brand: "kumasi-thread", slug: "ivory-dance-blazer", name: "Ivory Dance Blazer", cat: "fashion", sub: "Tailoring", price: 3600, images: ["fashion/streetwear-editorial/3"], sizes: "apparel", colours: [["Ivory", "#efe9de"]], tags: ["tailoring"], desc: "A soft ivory blazer cut for movement, with kente-trimmed inner pockets.", details: ["Linen-cotton", "Unstructured shoulder"], createdDaysAgo: 50 },

  // ── Orun Studio ──────────────────────────────────────────
  { brand: "orun-studio", slug: "igun-spiked-cuff", name: "Igun Spiked Cuff", cat: "jewelry", sub: "Bracelets", price: 95000, images: ["objects/jewelry/6"], sizes: "one", colours: [["Brass", "#b88d43"]], badges: ["new"], tags: ["brass", "cuff"], desc: "A lost-wax cast brass cuff with a row of hand-filed spikes.", details: ["Lost-wax cast brass", "Cast in Benin City"], collections: ["c_or_cast"], createdDaysAgo: 5 },
  { brand: "orun-studio", slug: "herringbone-chain", name: "Herringbone Chain", cat: "jewelry", sub: "Chains", price: 78000, images: ["objects/jewelry/5"], sizes: "one", colours: [["Brass", "#b88d43"]], tags: ["chain"], desc: "A flat herringbone chain in gold-plated brass.", details: ["Gold-plated brass", "45cm"], collections: ["c_or_cast"], createdDaysAgo: 25 },
  { brand: "orun-studio", slug: "twisted-brass-hoops", name: "Twisted Brass Hoops", cat: "jewelry", sub: "Earrings", price: 48000, images: ["objects/jewelry/7"], sizes: "one", colours: [["Brass", "#b88d43"]], tags: ["earrings"], desc: "Twisted hoops with sterling posts.", details: ["Cast brass", "Sterling silver posts"], collections: ["c_or_cast"], createdDaysAgo: 13 },
  { brand: "orun-studio", slug: "paperclip-link-set", name: "Paperclip Link Set", cat: "jewelry", sub: "Chains", price: 88000, images: ["objects/jewelry/4"], sizes: "one", colours: [["Brass", "#b88d43"]], tags: ["chain", "bracelet"], desc: "A paperclip-link necklace and matching bracelet.", details: ["Gold-plated brass", "Necklace and bracelet"], createdDaysAgo: 38 },
  { brand: "orun-studio", slug: "brass-dome-pendant", name: "Brass Dome Pendant Lamp", cat: "home-lifestyle", sub: "Lighting", price: 165000, images: ["lifestyle/home/3"], sizes: "one", tags: ["lamp", "brass"], desc: "A spun-brass dome pendant with a cloth cord.", details: ["Spun brass shade", "2m cloth cord", "E27 fitting"], createdDaysAgo: 30 },

  // ── Signal Bloom ─────────────────────────────────────────
  { brand: "signal-bloom", slug: "3am-hongdae-edp", name: "3AM Hongdae Eau de Parfum", cat: "beauty", sub: "Fragrance", price: 98000, images: ["lifestyle/beauty/1"], sizes: "one", badges: ["limited"], tags: ["fragrance"], desc: "Ozonic, smoky and a little synthetic: rain on a club queue, then the walk home.", details: ["50ml EDP", "Refillable bottle"], collections: ["c_sb_night"], createdDaysAgo: 2, dropId: "d_sb_3am" },
  { brand: "signal-bloom", slug: "bus-home-body-mist", name: "Bus Home Body Mist", cat: "beauty", sub: "Fragrance", price: 42000, images: ["lifestyle/beauty/0"], sizes: "one", tags: ["body mist"], desc: "A soft musk mist for after.", details: ["100ml"], collections: ["c_sb_night"], createdDaysAgo: 33 },
  { brand: "signal-bloom", slug: "smoke-break-duo", name: "Smoke Break Duo", cat: "beauty", sub: "Body", price: 56000, images: ["lifestyle/beauty/3"], sizes: "one", tags: ["body"], desc: "Hand wash and lotion scented with cedar, tobacco leaf and pink pepper.", details: ["2 × 300ml"], createdDaysAgo: 58 },
  { brand: "signal-bloom", slug: "neon-eye-palette", name: "Neon Eye Palette", cat: "beauty", sub: "Make-up", price: 38000, images: ["lifestyle/beauty/6"], sizes: "one", badges: ["new"], tags: ["make-up"], desc: "Twelve high-pigment shades from smoke to neon.", details: ["12 pressed pigments", "Vegan"], createdDaysAgo: 11 },
]

const skuPart = (s: string, n: number) => s.normalize("NFD").replace(/[^A-Za-z0-9]/g, "").slice(0, n).toUpperCase()

/**
 * A sample variant's SKU: the brand's code, the first six letters of the product's handle and
 * three of each option ("LS-DANFOH-M-WAS"), the way Studio writes one for a new product.
 */
export function sampleSku(brand: Brand, slug: string, options: Record<string, string>) {
  const code = Object.values(options).map((v) => skuPart(v, 3)).filter(Boolean).join("-")
  return `${brandCode(brand)}-${skuPart(slug, 6)}${code ? `-${code}` : ""}`
}

/**
 * The SKU a sample variant had before the handle part dropped its hyphens and the code replaced
 * marks without letters ("LS-DANFO--M-WAS"): Studio's migration swaps it for sampleSku when it
 * was never edited.
 */
export function legacySampleSku(brand: Brand, slug: string, options: Record<string, string>) {
  const code = Object.values(options).map((v) => v.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase()).join("-")
  return `${brand.mark.text.replace(/[^A-Za-z]/g, "").toUpperCase() || "SKU"}-${slug.slice(0, 6).toUpperCase()}${code ? `-${code}` : ""}`
}

function build(spec: Spec): Product {
  const brand = brandByHandle.get(spec.brand)
  if (!brand) throw new Error(`Unknown brand ${spec.brand}`)
  const currency: CurrencyCode = brand.currency
  const minor = 10 ** currencies[currency].minor
  const id = `p_${spec.slug.replace(/-/g, "_")}`

  const sizeValues = SIZES[spec.sizes ?? "one"]
  const colourValues: ColourValue[] = (spec.colours ?? []).map(([name, hex]) => ({ name, hex }))
  const options: ProductOption[] = []
  if (sizeValues.length > 1) options.push({ name: "Size", values: sizeValues })
  if (colourValues.length > 0) options.push({ name: "Colour", values: colourValues })

  const combos: Record<string, string>[] = []
  const colours = colourValues.length > 0 ? colourValues.map((c) => c.name) : [null]
  for (const colour of colours) {
    for (const size of sizeValues) {
      const combo: Record<string, string> = {}
      if (sizeValues.length > 1) combo.Size = size
      if (colour) combo.Colour = colour
      combos.push(combo)
    }
  }

  const lowStock = spec.badges?.includes("last-pieces")
  const variants: Variant[] = combos.map((combo, i) => {
    const key = `${id}-${i}`
    const r = rand(`${key}-stock`)
    const stock = r < (lowStock ? 0.45 : 0.12) ? 0 : lowStock ? randInt(`${key}-q`, 1, 3) : randInt(`${key}-q`, 2, 34)
    return {
      id: `${id}_v${i}`,
      sku: sampleSku(brand, spec.slug, combo),
      options: combo,
      stock,
      reserved: stock > 4 ? randInt(`${key}-r`, 0, 2) : 0,
    }
  })

  const created = daysAgo(spec.createdDaysAgo)
  const badges = new Set(spec.badges ?? [])
  if (spec.createdDaysAgo <= 14) badges.add("new")

  return {
    id,
    slug: spec.slug,
    brandId: brand.id,
    name: spec.name,
    description: spec.desc,
    details: spec.details,
    category: spec.cat,
    subcategory: spec.sub,
    tags: spec.tags ?? [],
    price: Math.round(spec.price * minor),
    compareAt: spec.compareAt ? Math.round(spec.compareAt * minor) : undefined,
    currency,
    images: spec.images.map((entry, i) => {
      const [ref, alt] = typeof entry === "string" ? [entry, i === 0 ? `${spec.name} by ${brand.name}` : `${spec.name}, detail`] : entry
      return img(ref, alt)
    }),
    options,
    variants,
    badges: [...badges],
    status: "published",
    createdAt: created,
    collectionIds: spec.collections ?? [],
    dropId: spec.dropId,
    stats: {
      views7d: randInt(`${id}-v`, 180, 5200),
      wishlists: randInt(`${id}-w`, 12, 980),
      sales30d: randInt(`${id}-s`, 0, 140),
      // momentum: recent engagement relative to lifetime, decayed by age
      trend: Math.round((rand(`${id}-t`) * 70 + 30) * Math.exp(-spec.createdDaysAgo / 60) * 100) / 100,
    },
  }
}

export const products: Product[] = specs.map(build)
export const productById = new Map(products.map((p) => [p.id, p]))
export const productBySlug = new Map(products.map((p) => [p.slug, p]))
export const variantById = new Map(products.flatMap((p) => p.variants.map((v) => [v.id, { product: p, variant: v }] as const)))

export function variantLabel(options: Record<string, string>) {
  return Object.entries(options)
    .map(([k, v]) => (k === "Size" && v !== "One size" ? `Size ${v}` : v))
    .join(", ")
}

export function availableStock(v: Variant) {
  return Math.max(0, v.stock - v.reserved)
}

export function productStock(p: Product) {
  return p.variants.reduce((n, v) => n + availableStock(v), 0)
}
