# Saved (wishlist + following feed)

Folder: `ios/Yard/Features/Saved/`

## Screens
- `SavedView()` (`.saved`) — "Wishlist": display header with counts, sort menu (Recently saved,
  Price low→high / high→low, Brand A–Z, In stock first), two-column masonry of `ProductTile`s
  (the heart removes; tile animates out), a "Move to bag" pill under each tile (one variant → adds
  directly; several → `SavedVariantSheet` size chips; then unsaves + success toast), "Sold out" /
  "Opening soon" disabled states, a "No longer available" list for saved pieces the catalogue no
  longer returns (remove button), skeleton / error (retry) / empty ("Browse new arrivals" → `.shop`),
  pull to refresh.
- `FollowingView()` (`.following`) — header, "You follow" avatar row (tap → brand; Following/Follow
  pill under each avatar, context menu with Unfollow; rows stay put for the visit like the website),
  "Drops" rail (live + upcoming drops from followed brands → `.drop(id:)`), "New pieces" masonry
  (newest first, 12 at a time with "Show more"), suggestions card ("Brands to start with" /
  "More brands on Yard") with Follow buttons. Empty, skeleton and error states, pull to refresh.
- Both: signed out → `SavedSignInInvite` with the website's invite copy and a Sign in button
  (`router.present(.signIn)`); reload when `session.shopper?.id` changes.

## Endpoints
- `GET /api/wishlist`, `DELETE /api/wishlist/{id}` (via `SavedStore`)
- `GET /api/catalog/products?ids=…&limit=` (chunks of 60) for saved tiles
- `POST /api/cart/lines` (via `CartStore.add`) for Move to bag
- `GET /api/follows`, `POST/DELETE /api/follows` (via `FollowStore`)
- `GET /api/catalog/products?brand={id}&sort=new&limit=6` per followed brand (max 24, parallel)
- `GET /api/drops?phase=live|upcoming&source=brands&limit=50`, filtered to followed brand ids
- `GET /api/catalog/brands?sort=new&limit=8` for suggestions

## Private helpers (SavedComponents.swift)
`SavedScreenHeader`, `SavedSignInInvite`, `SavedVariantSheet`, `FollowingDropCard`,
`FollowingAvatarSkeleton`; view models `SavedViewModel`, `FollowingViewModel`; `SavedSort`.

## Unfinished / notes
- Followed-brand avatars are monograms: `/api/follows` sends no logo and there is no brand-by-id
  lookup endpoint for logos.
- Price sorting compares major units across currencies (no FX conversion), unlike the web's USD sort.
- No "Undo" on the Move-to-bag toast (ToastCenter has no actions).
- Collections and stories from followed brands are not in the feed (the website's live feed shows
  pieces only; drops were added here per the brief).
