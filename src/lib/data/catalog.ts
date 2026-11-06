import { img } from "./media"
import type { Category, Collection, CuratedCollection, Drop, Story } from "./types"

export const categories: Category[] = [
  { slug: "fashion", name: "Fashion", description: "Tailoring, dresses and knitwear from independent designers.", image: img("fashion/campaign/6"), subcategories: ["Outerwear", "Shirts", "Knitwear", "Dresses", "Trousers", "Skirts", "Tailoring", "Footwear"] },
  { slug: "streetwear", name: "Streetwear", description: "Heavyweight basics, graphics and outerwear from small-run labels.", image: img("fashion/streetwear-editorial/1"), subcategories: ["Hoodies", "T-shirts", "Shirts", "Outerwear", "Trousers"] },
  { slug: "sneakers", name: "Sneakers", description: "Numbered runs, experimental soles, clean low-tops and boots.", image: img("objects/sneakers/3"), subcategories: ["Low-tops", "Runners", "Boots"] },
  { slug: "accessories", name: "Accessories", description: "Bags, headwear, eyewear and small leather goods.", image: img("objects/accessories-editorial/0"), subcategories: ["Bags", "Headwear", "Eyewear", "Watches", "Footwear"] },
  { slug: "jewelry", name: "Jewelry", description: "Hand-cast silver and brass.", image: img("objects/jewelry/3"), subcategories: ["Chains", "Rings", "Earrings", "Bracelets", "Pendants"] },
  { slug: "beauty", name: "Beauty", description: "Small-batch skin care and fragrance.", image: img("lifestyle/beauty/3"), subcategories: ["Skin care", "Body", "Fragrance", "Make-up"] },
  { slug: "technology", name: "Technology", description: "Repairable audio, keyboards, lenses and restored objects.", image: img("lifestyle/tech/7"), subcategories: ["Audio", "Desk", "Photo", "Objects"] },
  { slug: "art-design", name: "Art & design", description: "Prints, posters and editions.", image: img("lifestyle/art/0"), subcategories: ["Prints", "Posters"] },
  { slug: "home-lifestyle", name: "Home & lifestyle", description: "Ceramics, candles and lighting.", image: img("lifestyle/home/4"), subcategories: ["Vases", "Candles", "Lighting"] },
  { slug: "creative", name: "Independent creative", description: "Zines, records, skate decks and other good things.", image: img("lifestyle/creative/3"), subcategories: ["Zines", "Records", "Skate"] },
]

export const categoryBySlug = new Map(categories.map((c) => [c.slug, c]))

export const collections: Collection[] = [
  { id: "c_ls_drop06", brandId: "b_lagos_static", handle: "drop-06-danfo", name: "Drop 06: Danfo", description: "Graphics pulled from Lagos danfo signage.", image: img("fashion/streetwear-editorial/0"), productIds: ["p_danfo_heavyweight_hoodie", "p_third_mainland_tee", "p_signal_beanie"] },
  { id: "c_ls_core", brandId: "b_lagos_static", handle: "core", name: "Core", description: "Year-round pieces.", image: img("fashion/outerwear/0"), productIds: ["p_static_moto_jacket", "p_yaba_cargo_trouser", "p_okada_utility_parka"] },
  { id: "c_oy_s04", brandId: "b_oyin_atelier", handle: "season-04", name: "Season 04: Iseyin", description: "Twelve pieces built around hand-woven trims.", image: img("fashion/campaign/3"), productIds: ["p_iseyin_sheer_blouse", "p_aso_oke_trim_suit_jacket", "p_plum_silk_gown", "p_pleated_wide_trouser"] },
  { id: "c_nf_studies", brandId: "b_null_form", handle: "studies", name: "Studies", description: "The numbered models.", image: img("objects/sneakers/4"), productIds: ["p_nf_01_sole_study", "p_nf_02_court", "p_nf_04_prism"] },
  { id: "c_hm_restored", brandId: "b_halfmoon_archive", handle: "restored", name: "Restored", description: "One-of-one repaired vintage.", image: img("fashion/cover/1"), productIds: ["p_restored_camel_overcoat", "p_darned_shawl_collar_knit", "p_patched_archive_denim", "p_resoled_work_boots"] },
  { id: "c_hm_new", brandId: "b_halfmoon_archive", handle: "new-from-archive", name: "New from the archive", description: "New pieces cut from archive patterns.", image: img("objects/sneakers/8"), productIds: ["p_merino_roll_neck", "p_archive_brogue_boot", "p_wool_beret"] },
  { id: "c_fc_core", brandId: "b_ferro_club", handle: "core", name: "Core silver", description: "The everyday pieces.", image: img("objects/jewelry/2"), productIds: ["p_centro_box_chain", "p_halo_no_9", "p_crystal_link_bracelet"] },
  { id: "c_du_ritual", brandId: "b_dune_apothecary", handle: "ritual", name: "The ritual", description: "Morning and night.", image: img("lifestyle/beauty/5"), productIds: ["p_baobab_face_oil", "p_marula_balm", "p_rift_serum"] },
  { id: "c_mo_audio", brandId: "b_mute_objects", handle: "audio", name: "Audio", description: "Repairable listening.", image: img("lifestyle/tech/0"), productIds: ["p_mo_1_headphones", "p_mo_2_leather", "p_bookshelf_speaker", "p_studio_microphone"] },
  { id: "c_mo_desk", brandId: "b_mute_objects", handle: "desk", name: "Desk", description: "Keyboards for every bag size.", image: img("lifestyle/tech/5"), productIds: ["p_aluminium_65_keyboard", "p_travel_40_keyboard"] },
  { id: "c_ah_night", brandId: "b_afterhours_ceramics", handle: "night-shift", name: "Night shift", description: "Speckled glazes and candlelight.", image: img("lifestyle/home/2"), productIds: ["p_speckled_bud_vases", "p_night_candle_vessel", "p_pillar_candle_trio"] },
  { id: "c_pr_prints", brandId: "b_paper_riot", handle: "prints", name: "Prints", description: "Editions from the collective.", image: img("lifestyle/art/1"), productIds: ["p_pigment_study_01", "p_poster_series_03", "p_marble_pour_print", "p_portrait_print_ama"] },
  { id: "c_vu_core", brandId: "b_velvet_underpass", handle: "bags", name: "Bags", description: "Saddle-stitched leather.", image: img("objects/bags/2"), productIds: ["p_woven_metro_tote", "p_night_shift_crossbody", "p_python_box_clutch"] },
  { id: "c_gl_core", brandId: "b_gridlock_supply", handle: "core", name: "Core", description: "Always restocked.", image: img("fashion/campaign/4"), productIds: ["p_laundromat_trucker", "p_gls_court", "p_bodega_sherpa_fleece"] },
  { id: "c_kt_bonwire", brandId: "b_kumasi_thread", handle: "bonwire", name: "Bonwire capsule", description: "Built with weavers from Bonwire.", image: img("fashion/streetwear-editorial/5"), productIds: ["p_bonwire_oversized_coat", "p_loom_knit_sweater"] },
  { id: "c_or_cast", brandId: "b_orun_studio", handle: "cast", name: "Cast", description: "Lost-wax brass.", image: img("objects/jewelry/6"), productIds: ["p_igun_spiked_cuff", "p_herringbone_chain", "p_twisted_brass_hoops"] },
  { id: "c_sb_night", brandId: "b_signal_bloom", handle: "night-out", name: "Night out", description: "Scents built around one night.", image: img("lifestyle/beauty/1"), productIds: ["p_3am_hongdae_edp", "p_bus_home_body_mist"] },
]

export const curatedCollections: CuratedCollection[] = [
  { id: "cc_underground", slug: "underground-fashion", name: "Underground fashion", description: "Labels that started in bedrooms, basements and laundromats.", image: img("fashion/streetwear-editorial/0"), brandIds: ["b_lagos_static", "b_kumasi_thread", "b_gridlock_supply", "b_paper_riot"], productIds: ["p_danfo_heavyweight_hoodie", "p_bonwire_oversized_coat", "p_bodega_sherpa_fleece", "p_riot_zine_vol_4"] },
  { id: "cc_independent", slug: "independent-designers", name: "Independent designers", description: "One designer, one studio, one point of view.", image: img("fashion/cover/4"), brandIds: ["b_oyin_atelier", "b_halfmoon_archive", "b_velvet_underpass", "b_afterhours_ceramics"], productIds: ["p_aso_oke_trim_suit_jacket", "p_restored_camel_overcoat", "p_woven_metro_tote", "p_speckled_bud_vases"] },
  { id: "cc_experimental", slug: "experimental-streetwear", name: "Experimental streetwear", description: "Strange soles, rebuilt cloth, loud graphics.", image: img("fashion/streetwear-editorial/2"), brandIds: ["b_null_form", "b_lagos_static", "b_kumasi_thread"], productIds: ["p_nf_04_prism", "p_static_moto_jacket", "p_ivory_dance_blazer"] },
  { id: "cc_essentials", slug: "contemporary-essentials", name: "Contemporary essentials", description: "Pieces you'll still reach for in ten years.", image: img("fashion/cover/7"), brandIds: ["b_halfmoon_archive", "b_oyin_atelier", "b_mute_objects", "b_dune_apothecary"], productIds: ["p_merino_roll_neck", "p_iseyin_sheer_blouse", "p_mo_1_headphones", "p_baobab_face_oil"] },
  { id: "cc_african", slug: "emerging-african-brands", name: "Emerging African brands", description: "Lagos, Accra, Nairobi and Johannesburg: the studios to know now.", image: img("fashion/campaign/2"), brandIds: ["b_lagos_static", "b_oyin_atelier", "b_kumasi_thread", "b_dune_apothecary", "b_paper_riot", "b_orun_studio"], productIds: ["p_third_mainland_tee", "p_teal_flow_maxi_dress", "p_loom_knit_sweater", "p_rift_serum", "p_portrait_print_ama", "p_igun_spiked_cuff"] },
  { id: "cc_after_dark", slug: "after-dark-objects", name: "After-dark objects", description: "Things for the hours after midnight.", image: img("lifestyle/lifestyle-cover/3"), brandIds: ["b_mute_objects", "b_afterhours_ceramics", "b_signal_bloom"], productIds: ["p_bookshelf_speaker", "p_night_candle_vessel", "p_pillar_candle_trio", "p_3am_hongdae_edp"], sponsoredBy: "b_mute_objects" },
]

/**
 * Sample drops. Each releases at a local time in its brand's zone (releaseLocal), counted from the
 * day the demo loads, so every phase shows whenever the prototype is opened: four upcoming (one
 * within hours), two live, one sold out and one ended. `releaseOffsetHours` approximates each
 * release for the server's first render.
 */
export const drops: Drop[] = [
  { id: "d_nf_04", slug: "nf-04-prism", brandId: "b_null_form", name: "NF-04 Prism: numbered run", description: "300 numbered pairs of an iridescent knit runner. Enter the draw before release. Winners are picked at random and only winners pay.", image: img("objects/sneakers/4"), productIds: ["p_nf_04_prism"], releaseOffsetHours: 3.25, releaseLocal: { hoursOut: 3, fromOffset: 3.25 }, durationHours: 24, access: "draw", limitPerCustomer: 1, totalUnits: 300, unitsLeft: 300, sponsored: true },
  { id: "d_ls_third_mainland", slug: "drop-07-third-mainland", brandId: "b_lagos_static", name: "Drop 07: Third Mainland", description: "Hoodies and tees printed with long exposures of the Third Mainland Bridge. 180 pieces across the run.", image: img("fashion/streetwear-editorial/1"), productIds: ["p_danfo_heavyweight_hoodie", "p_third_mainland_tee"], releaseOffsetHours: 50, releaseLocal: { daysOut: 2, time: "18:00", fromOffset: 50 }, durationHours: 48, access: "first-come", limitPerCustomer: 2, totalUnits: 180, unitsLeft: 180 },
  { id: "d_fc_halo", slug: "halo-no-9", brandId: "b_ferro_club", name: "Halo No. 9", description: "Forty halo rings cast from one carved wax. Followers get a 24-hour early window.", image: img("objects/jewelry/0"), productIds: ["p_halo_no_9"], releaseOffsetHours: 118, releaseLocal: { daysOut: 5, time: "12:00", fromOffset: 118 }, durationHours: 72, access: "early-access", limitPerCustomer: 1, totalUnits: 40, unitsLeft: 40 },
  { id: "d_kt_bonwire", slug: "bonwire-capsule", brandId: "b_kumasi_thread", name: "Bonwire capsule", description: "Six kente-lined coats and a run of loom-knit sweaters.", image: img("fashion/streetwear-editorial/5"), productIds: ["p_bonwire_oversized_coat", "p_loom_knit_sweater"], releaseOffsetHours: 196, releaseLocal: { daysOut: 8, time: "10:00", fromOffset: 196 }, durationHours: 96, access: "first-come", limitPerCustomer: 1, totalUnits: 60, unitsLeft: 60 },
  { id: "d_gl_restock", slug: "laundromat-restock", brandId: "b_gridlock_supply", name: "Laundromat restock", description: "Truckers and courts back in every size. Live now while it lasts.", image: img("fashion/campaign/4"), productIds: ["p_laundromat_trucker", "p_gls_court"], releaseOffsetHours: -12, releaseLocal: { daysOut: -1, time: "20:00", fromOffset: -12 }, durationHours: 48, access: "first-come", limitPerCustomer: 3, totalUnits: 400, unitsLeft: 112 },
  { id: "d_sb_3am", slug: "3am-hongdae", brandId: "b_signal_bloom", name: "3AM Hongdae", description: "The first Signal Bloom eau de parfum, in a numbered first batch of 250.", image: img("lifestyle/beauty/1"), productIds: ["p_3am_hongdae_edp"], releaseOffsetHours: -20, releaseLocal: { daysOut: -1, time: "20:00", fromOffset: -20 }, durationHours: 72, access: "first-come", limitPerCustomer: 2, totalUnits: 250, unitsLeft: 38 },
  { id: "d_pr_posters", slug: "poster-series-03", brandId: "b_paper_riot", name: "Poster Series 03", description: "The basement season, on paper. Sold out in four hours.", image: img("lifestyle/art/3"), productIds: ["p_poster_series_03"], releaseOffsetHours: -240, releaseLocal: { daysOut: -10, time: "18:00", fromOffset: -240 }, durationHours: 48, access: "first-come", limitPerCustomer: 2, totalUnits: 120, unitsLeft: 0 },
  { id: "d_oy_s04", slug: "season-04-preview", brandId: "b_oyin_atelier", name: "Season 04 preview", description: "A first look at Season 04 for followers.", image: img("fashion/campaign/3"), productIds: ["p_aso_oke_trim_suit_jacket", "p_iseyin_sheer_blouse"], releaseOffsetHours: -400, releaseLocal: { daysOut: -17, time: "10:00", fromOffset: -400 }, durationHours: 72, access: "early-access", limitPerCustomer: 2, totalUnits: 48, unitsLeft: 9 },
]

export const stories: Story[] = [
  {
    id: "s_ls_bridge",
    slug: "printed-on-the-bridge",
    brandId: "b_lagos_static",
    kind: "origins",
    title: "Printed on the bridge",
    dek: "How a bedroom screen-printing table became Lagos Static — and why every graphic still starts on the Third Mainland Bridge at 4am.",
    cover: img("fashion/streetwear-editorial/1"),
    publishedAt: "2026-10-28",
    readMinutes: 5,
    blocks: [
      { type: "text", body: "The first Lagos Static shirt was printed on a table borrowed from a church in Yaba. Tobi Adeyemi had twelve blanks, one screen and a photograph of a danfo bus he'd taken on his phone." },
      { type: "quote", body: "I wanted shirts that looked like the city at the hour nobody photographs it.", cite: "Tobi Adeyemi" },
      { type: "image", image: img("fashion/streetwear-editorial/0"), caption: "Drop 06, shot by the Third Mainland Bridge.", layout: "full" },
      { type: "text", body: "Five years later the table is a two-room studio with four presses, but the rules haven't changed: runs under 200, everything finished in Lagos, and every graphic starts as a photograph." },
      { type: "pair", images: [img("fashion/tops/1"), img("fashion/tops/6")], caption: "Danfo Heavyweight Hoodie and Third Mainland Tee." },
      { type: "products", productIds: ["p_danfo_heavyweight_hoodie", "p_third_mainland_tee", "p_static_moto_jacket"] },
    ],
  },
  {
    id: "s_nf_sole",
    slug: "starting-at-the-sole",
    brandId: "b_null_form",
    kind: "design-process",
    title: "Starting at the sole",
    dek: "Null Form designs every shoe from the ground up. Inside the 3D-sketch process behind the NF-04 Prism.",
    cover: img("objects/sneakers/3"),
    publishedAt: "2026-10-30",
    readMinutes: 4,
    blocks: [
      { type: "text", body: "Most sneakers start with an upper and borrow a sole. Null Form does the opposite: Min-ji Park sketches the sole in 3D first, then builds a knit to fit it." },
      { type: "image", image: img("objects/sneakers/4"), caption: "NF-04 Prism, sample 14 of 22.", layout: "inset" },
      { type: "quote", body: "If the sole is right, the shoe is already half designed.", cite: "Min-ji Park" },
      { type: "products", productIds: ["p_nf_04_prism", "p_nf_01_sole_study"] },
    ],
  },
  {
    id: "s_oy_iseyin",
    slug: "season-04-iseyin",
    brandId: "b_oyin_atelier",
    kind: "collection",
    title: "Season 04: Iseyin",
    dek: "Twelve pieces built around hand-woven aso-oke from the weavers of Iseyin.",
    cover: img("fashion/campaign/3"),
    publishedAt: "2026-10-18",
    readMinutes: 3,
    blocks: [
      { type: "text", body: "Season 04 began with a road trip to Iseyin, where Oyinkansola Bello's grandmother bought her first aso-oke." },
      { type: "image", image: img("fashion/dresses/2"), layout: "full" },
      { type: "products", productIds: ["p_iseyin_sheer_blouse", "p_aso_oke_trim_suit_jacket", "p_plum_silk_gown"] },
    ],
  },
  {
    id: "s_or_igun",
    slug: "igun-street-6am",
    brandId: "b_orun_studio",
    kind: "behind-the-scenes",
    title: "Igun Street, 6am",
    dek: "A morning with the bronze casters who make every Orun piece.",
    cover: img("objects/accessories-editorial/2"),
    publishedAt: "2026-10-09",
    readMinutes: 6,
    blocks: [
      { type: "text", body: "Igun Street in Benin City has been home to the royal guild of bronze casters for centuries. Orun works with one family there." },
      { type: "image", image: img("objects/jewelry/6"), layout: "inset", caption: "The Igun Spiked Cuff, before polishing." },
      { type: "products", productIds: ["p_igun_spiked_cuff", "p_herringbone_chain"] },
    ],
  },
  {
    id: "s_hm_darning",
    slug: "the-darning-bench",
    brandId: "b_halfmoon_archive",
    kind: "behind-the-scenes",
    title: "The darning bench",
    dek: "Why Halfmoon makes its repairs visible.",
    cover: img("fashion/cover/1"),
    publishedAt: "2026-09-21",
    readMinutes: 4,
    blocks: [
      { type: "text", body: "Callum Reid spends most mornings at a bench by the window with a darning mushroom and a box of wool in fifteen shades of blue." },
      { type: "products", productIds: ["p_restored_camel_overcoat", "p_darned_shawl_collar_knit", "p_patched_archive_denim"] },
    ],
  },
]
