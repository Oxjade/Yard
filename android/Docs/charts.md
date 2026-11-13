# Charts (android features/charts)

Port of `ios/Yard/Features/Charts/` (website `/charts`).

## Screens
- `ChartsView()` (`Route.Charts`, pushed): "CHARTS" display header + live/final edition line
  (re-reads the clock every 30 s), board rail chips, Daily/Weekly/Monthly `SegmentedPill`,
  location pill + Filters chip (both open the filters sheet), board heading, then podium (1–3),
  Biggest climber / Highest debut callouts, ranks 4–10 rows, Sponsored strip, ranks 11+ rows,
  "How Charts work" disclosure card. Tap → `Route.Brand(handle)` or `Route.Drop(slug|id)`.
- `ChartsFiltersSheet` (`YardSheet`): Location/City + Category chips (FlowRow) with brand counts,
  options under `minCohort` disabled; draft applied by "Show chart", Clear.
- States: skeleton, error + Retry (429 wording), warming_up, empty ok board, `ChartsSmallCohortView`
  with the website's fallback actions, quiet "Couldn't refresh just now" note.

## Endpoints
- `GET /api/charts?chart=&period=&category=&city=|country=` → `ChartBoard`
- `GET /api/charts/scopes` → `ChartScopes`

## Android differences
- The board is one `LazyColumn`; ranked rows are separate lazy items drawn as segments of one card
  (`chartsRowSegment`: outline + inset dividers) instead of a `LazyVStack` inside a card.
- Pull to refresh = Material3 `PullToRefreshBox` with Yard colours. The periodic refresh
  (30 s / 5 min / 15 min) runs under `repeatOnLifecycle(STARTED)`, so it pauses in the background
  and refreshes once on return.
- Lenient decoding: private `ChartsLenientSerializer` / `ChartsLossyListSerializer` mirror Swift's
  `lenientOptional` / `ChartsLossy` (one bad entry or nested object never blanks the board).
- Movement arrows use `ArrowDropUp/Down` icons; SF Symbols map to Material outlined icons.
- Same notes as iOS: no brand logo in the DTO (monogram avatars), no sparkline/follow per row,
  board state not kept across visits, saved Around area not used as City default.

## Tests
`app/src/test/java/space/yardstore/app/features/charts/ChartsTest.kt` — 18 tests: DTO decoding
(board, lenient fallbacks, small cohort, scopes), formatting, query/filter options, and the
ViewModel against MockWebServer (load, 429 error, failed refresh keeps board, query switch,
default city, scopes failure).
