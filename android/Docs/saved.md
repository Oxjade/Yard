# Saved (wishlist + following feed), Android

Package: `features/saved/`. Mirrors `ios/Yard/Features/Saved/` (see `ios/Docs/saved.md`).

## Screens
- `SavedView()` (`Route.Saved`), "Wishlist": `SavedViewModel` + `SavedSort`. It has the same header, sort menu, masonry
  with a "Move to bag" / "Sold out" / "Opening soon" pill under each tile, `SavedVariantSheet` size chips,
  the "No longer available" card, the footnote, skeleton, error with retry, empty state ("Browse new arrivals" → `Route.Shop`),
  pull to refresh and the signed-out invite.
- `FollowingView()` (`Route.Following`): `FollowingViewModel`. It has the header, the "You follow" avatar row
  (Following/Follow pill; long press opens View brand / Unfollow), the "Drops" rail, "New pieces" (12 at a time, "Show more"),
  the suggestions card, the empty, skeleton and error states, pull to refresh and the signed-out invite.
- `SavedComponents.kt` holds `SavedScreenHeader`, `SavedSignInInvite`, `SavedVariantSheet`, `FollowingDropCard`,
  `FollowingAvatarSkeleton`, plus `Modifier.savedFullBleed` (a private helper that lets full-width grid items ignore the grid's 6dp padding).

## Endpoints
These are the same as iOS:
- `GET /api/wishlist` and `DELETE /api/wishlist/{id}` (SavedStore)
- `GET /api/catalog/products?ids=…&limit=` in chunks of 60
- `POST /api/cart/lines` (CartStore.add)
- `GET/POST/DELETE /api/follows` (FollowStore)
- `GET /api/catalog/products?brand=&sort=new&limit=6` for each brand, up to 24 brands, in parallel
- `GET /api/drops?phase=live|upcoming&source=brands&limit=50`
- `GET /api/catalog/brands?sort=new&limit=8`

## Android differences
- Each screen is a single `LazyVerticalStaggeredGrid`. Its header, sections and rails are full-line items, and the tiles use
  `animateItem()` so they animate out on unsave and in on "Show more". On iOS this is a ScrollView with a VStack and a MasonryGrid.
- The iOS context menu on followed brands is a long-press `DropdownMenu`. The sort `Menu` + `Picker` is a `DropdownMenu` with a check mark.
- Haptics: Confirm on Move to bag, ToggleOn/ToggleOff on follow.
- Network fetches and decoding run on `Dispatchers.IO`. Loads run in `viewModelScope` and reload when the screen
  re-enters composition (the same as iOS `.task`).
- The iOS notes still apply: avatars are monograms because follows carry no logo, price sort ignores FX, and the toast has no Undo.

- The size sheet's piece is kept by id in `rememberSaveable`, so an open sheet survives rotation. The sheet stays a
  bottom sheet on tablets (it is short, like the iOS `.medium` detent).
- Touch targets are at least 48dp: the Follow pill (72×26dp visual), the unlisted "Remove" circle (36dp visual) and the
  sort pill sit in 48dp hit boxes. Under each wishlist tile the Move to bag slot is 48dp (44pt on iOS).
- After Follow, the brand stays busy until the feed has reloaded, as on iOS (`await model.load` comes before the busy flag clears).

## Tablet & large screens
- Both grids use `LocalYardWindow.current.gridColumns` (2, 3 or 4), and so do their skeletons. Headers, section headers and
  the avatar and drop rails stay full width with their gutters. The rails keep their item widths and show more items.
- These capped blocks are start-aligned with the header and limited to `contentMaxWidth`: the "No longer available" card, the footnote and the
  Following suggestions card. The empty states and the signed-out invite are centred with `adaptiveContentWidth()`.
- Each screen has `@YardTabletPreviews` (signed in and signed out).

## Tests
`app/src/test/java/space/yardstore/app/features/saved/` has 26 tests: `SavedViewModelTest` (16) and `FollowingViewModelTest` (10).
They run against MockWebServer with JSON shaped like `src/server/follows/index.ts` and the catalogue/drops routes.
