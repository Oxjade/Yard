import type { ImageAsset } from "@/lib/data/types"

/**
 * Yard's own photography on the live site: the founding brands' photos, in /public/site/.
 * To swap a photo, replace its file in /public/site/ (keep the name, or change `src` here) and
 * update its width, height, alt and focal point below. Demo and development keep the sample
 * (Unsplash) imagery from src/lib/data/media.ts; pages choose with getEnv().seedDemo.
 *
 * `position` is the CSS object-position that keeps faces and outfits in frame when a spot
 * crops the photo (portrait photos in wide frames on phones, tall tiles on desktop).
 * `credit` is the brand the photo belongs to, or null where it must not be credited.
 */
export type SitePhoto = ImageAsset & { position: string; credit: string | null }

const photo = (file: string, width: number, height: number, alt: string, position: string, credit: string | null): SitePhoto => ({
  src: `/site/${file}`,
  width,
  height,
  alt,
  position,
  credit,
})

export const sitePhotos = {
  adeewaWhite: photo("adeewa-white.jpg", 854, 1280, "A woman in a long white dress with red embroidery, seated in a cream-coloured alcove", "45% 25%", "Adé Ewà"),
  adeewaGreen: photo("adeewa-green.jpg", 854, 1280, "A model in a flowing olive and lime-green gown holding up an Adé Ewà box in a cream studio", "42% 30%", "Adé Ewà"),
  teeConcrete: photo("tee-concrete.jpg", 732, 1080, "A person in a white graphic tee and wide black trousers against a concrete wall", "50% 8%", null),
  saveYourSolBlack: photo("saveyoursol-black.jpg", 766, 1080, "A man in a black Save Your Sol polo and wide dark jeans against a grey backdrop", "50% 6%", "Save Your Sol"),
  saveYourSolWall: photo("saveyoursol-wall.jpg", 608, 1080, "Two children in Save Your Sol tops in front of a painted mural wall", "50% 12%", "Save Your Sol"),
  greatnessTyres: photo("greatness-tyres.jpg", 1440, 1920, "A man in a black Greatness tee and sunglasses sitting on stacked tyres", "45% 32%", "Greatness"),
  greatnessGroupBikes: photo("greatness-group-bikes.jpg", 1440, 1920, "A group of friends in Greatness tees with yellow bikes on a tree-lined street", "55% 45%", "Greatness"),
  greatnessWheelie: photo("greatness-wheelie.jpg", 1440, 1920, "A man in a white Greatness tee riding a yellow bike past a brick wall", "62% 14%", "Greatness"),
} satisfies Record<string, SitePhoto>

/** Which photo each of Yard's own screens uses on the live site. */
export const siteImages = {
  signIn: sitePhotos.greatnessTyres,
  welcome: sitePhotos.adeewaWhite,
  you: sitePhotos.greatnessGroupBikes,
  yourDrops: sitePhotos.greatnessWheelie,
  following: sitePhotos.saveYourSolBlack,
  inbox: sitePhotos.adeewaGreen,
  wishlist: sitePhotos.saveYourSolWall,
  settings: sitePhotos.teeConcrete,
  orders: sitePhotos.teeConcrete,
  orderDetail: sitePhotos.teeConcrete,
  aroundTeaser: sitePhotos.saveYourSolWall,
} satisfies Record<string, SitePhoto>

/**
 * The home hero's sliding curtain, in order: no two photos from one brand side by side,
 * including where the loop wraps from the last back to the first.
 */
export const heroCurtain: SitePhoto[] = [
  sitePhotos.adeewaWhite,
  sitePhotos.greatnessTyres,
  sitePhotos.saveYourSolBlack,
  sitePhotos.adeewaGreen,
  sitePhotos.greatnessGroupBikes,
  sitePhotos.teeConcrete,
  sitePhotos.saveYourSolWall,
  sitePhotos.greatnessWheelie,
]

/** An invite's caption for a site photo: its brand, when it has one. */
export const siteCaption = (p: SitePhoto) => (p.credit ? `Photo: ${p.credit}` : undefined)

/**
 * A sign-in invitation's photo: the sample image in demo and development, else the site photo
 * with its brand credit.
 */
export function invitePhoto(demo: boolean, sample: ImageAsset, site: SitePhoto): { image: ImageAsset; caption?: string } {
  return demo ? { image: sample } : { image: site, caption: siteCaption(site) }
}
