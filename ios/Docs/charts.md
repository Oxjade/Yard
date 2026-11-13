# Charts (ios/Yard/Features/Charts/)

Native version of the website's `/charts` (`src/components/charts/*`, `src/server/charts/public.ts`).

## Screens
- `ChartsView()` (route `.charts`, pushed): "CHARTS" display header, live/final edition line
  ("Weekly edition, 31 Oct – 6 Nov. Updated 2 min ago"), board rail chips (Top brands, Trending,
  Emerging, Most followed, Most wishlisted, Top drops, City charts), Daily/Weekly/Monthly
  `SegmentedPill`, a location pill + Filters chip (both open the filters sheet), the board
  heading ("Lagos, weekly. 12 brands ranked"), then:
  - podium for ranks 1–3 (#1 full width with an acid rank tab, #2/#3 side by side; cover photo,
    avatar, name, origin, reason (stat) chip, movement chip, "Last week #4"),
  - Biggest climber / Highest debut callouts,
  - ranks 4+ as rows: big display-face rank, ▲/▼/—/New/Re-entry chip, avatar (drop image on Top
    drops), name, origin, reason chip, "Last week 7 · Peak 2 · 6 wks",
  - Sponsored strip after rank 10 (or after the list), labelled and separate from the ranking,
  - "How Charts work" disclosure card (website wording).
  Tap → `Route.brand(handle:)`, or `Route.drop(id: slug)` for Top drops entries.
- `ChartsFiltersSheet`: Location (Everywhere / countries / charted cities; cities only on City
  charts) and Category chips with brand counts; options under `minCohort` are disabled.
- States: skeleton while loading; error with Retry (429 gets the website's rate-limit wording);
  `warming_up` → "Charts are warming up — back in a moment." (the no-edition-yet state); empty
  `ok` board → the website's "No brand qualifies…" / "No drops are live…"; `small_cohort` →
  `ChartsSmallCohortView` with the website's fallback actions (country, nearest city, all
  categories, everywhere). A failed background refresh keeps the board with a quiet note.

## Endpoints
- `GET /api/charts?chart=&period=&category=&city=|country=` (public) → board.
- `GET /api/charts/scopes` (public) → cities/countries/categories with eligible counts, `minCohort`.

Refresh cadence while on screen matches the website (daily 30 s, weekly 5 min, monthly 15 min),
plus pull to refresh. City charts with no city chosen use the bag's ship-to city
(`CartStore.destinationCity`, matched by name to a charted city), else the largest charted city in
`destinationCountry`, else the server's default (largest cohort).

## Files
`ChartsView.swift` (screen + small-cohort state), `ChartsViewModel.swift` (`ChartsQuery`,
`ChartsViewModel`), `ChartsModels.swift` (DTOs, lenient decoding, edition formatting),
`ChartsComponents.swift` (podium, rows, movement + stat chips, callouts, sponsored, skeleton),
`ChartsFiltersSheet.swift` (filters sheet + `ChartsFlowLayout`, a private wrapping layout).

## Unfinished / notes
- The chart DTO has no brand logo URL (only a text mark), so avatars use `BrandAvatar`'s monogram.
- No per-row Follow button or rank sparkline (website shows them on large screens only).
- The website's saved-Around-area default for City charts isn't applied (Around stores it in web
  localStorage); the "How Charts work" card starts closed.
- Board state isn't kept across visits (the web keeps it in the URL).
