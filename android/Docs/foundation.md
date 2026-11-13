# Android foundation: what exists

Read `android/AGENTS.md` first (it has the full API cheat sheet). This page records the build setup,
how each iOS foundation file maps to Kotlin, and what could not be mirrored.

## Build

- Gradle 8.14.3 (wrapper), AGP 8.11.2, Kotlin 2.1.21 + Compose compiler plugin + kotlinx-serialization plugin,
  JDK 21 (bytecode target 17). compileSdk/targetSdk 35, minSdk 26, applicationId `space.yardstore.app`.
- Versions in `gradle/libs.versions.toml`: Compose BOM 2025.06.00 (material3 1.3.x), core-ktx 1.16.0,
  activity-compose 1.10.1, lifecycle 2.9.1, navigation-compose 2.9.0, kotlinx-serialization-json 1.8.1,
  coroutines 1.10.2, OkHttp 4.12.0, Coil 3.2.0, DataStore 1.1.7, browser 1.8.0, core-splashscreen 1.0.1.
  (Pinned below the versions that require compileSdk 36.)
- `local.properties` (`sdk.dir=/home/user/android-sdk`) is git-ignored.
- `./gradlew :app:assembleDebug` and `./gradlew :app:testDebugUnitTest` pass.

## iOS → Android map

| iOS | Android |
|---|---|
| App/YardApp.swift | app/YardApp.kt (Application, Coil loader), app/AppContainer.kt (stores), app/MainActivity.kt (edge-to-edge, appearance, links) |
| App/RootView.swift (`RootView`, `TabPill`, `TabPillScrollSensor`) | app/RootView.kt (`RootView`, `TabPill`, `Modifier.tabPillScrollSensor()`, `LocalTabPillClearance`) |
| App/Router.swift (`AppTab`, `LegalPage`, `Route`, `Route(url:)`, `Route(path:)`, `Router`, `RouteView`, `.yardRouteDestinations()`) | app/Router.kt (`AppTab`, `LegalPage`, sealed `Route`, `Route.fromUrl`, `Route.fromPath`, `Router`, `LocalRouter`), app/RouteView.kt (`RouteView`, `NavGraphBuilder.yardRouteDestinations`) |
| DesignSystem/Theme.swift (`Color.yard`, `AppearancePreference`) | designsystem/Theme.kt (`YardColors`, `Color.yard`, `YardTheme`), core/AppearancePreference.kt (+ `AppearanceStore`, DataStore) |
| Typography.swift, Metrics.swift | designsystem/Typography.kt (`YardFonts`, `YardDisplayText`), designsystem/Metrics.kt (`Spacing`, `Radius`, `YardShapes`, `Motion`) |
| YardLogo.swift + SVGPathParser.swift | designsystem/YardLogo.kt (same SVG paths, parsed by androidx `PathParser`) |
| PreviewSupport.swift | designsystem/PreviewSupport.kt (`YardPreview`, `PreviewFixtures`) |
| Components/*.swift | designsystem/components/*.kt, same names (+ `Pressable.kt`, `YardTopBar.kt`) |
| Core/Config.swift, Formatters.swift | core/Config.kt, core/Formatters.kt (+ core/WebPages.kt for Custom Tabs) |
| Core/Networking/* | core/networking/APIClient.kt, APIError.kt, CookieStore.kt (`PersistentCookieJar`) |
| Core/Models/* | core/models/*.kt (same files; Decoding.kt holds `YardJson` + `YardDate`) |
| Core/Stores/* | core/stores/*.kt (+ StoreLocals.kt) |
| Features/<Folder>/<View>.swift placeholders | features/<folder>/<View>.kt placeholders (32 screens) |

Navigation: one `NavHost` per tab (type-safe `@Serializable` routes; each tab's start destination is
`TabRoot`), kept alive across tab switches (hidden tabs stay composed but are not placed, and their
back handlers are detached). `router.present(route)` shows a `YardSheet` with its own `NavHost`
(so the sheet's screen gets its own ViewModel scope) and toast host. Pushes requested for a tab that
has not been opened yet are queued and replayed. Android back pops the current tab; on a non-Home
tab root it returns to Home first. Push/pop animate like iOS (slide from the right).

Large screens: `designsystem/YardWindow.kt` (`YardWidthClass` / `YardHeightClass` with Material
breakpoints 600/840 and 480/900dp, `YardWindow` with `isWide`, `isExpanded`, `gridColumns` 2/3/4,
`contentMaxWidth` unspecified/720/960, `sheetIsDialog`; `LocalYardWindow`; `ProvideYardWindow`
measures the root with `BoxWithConstraints`, so it follows rotation, resize and fold/unfold) — no
window-size-class dependency. `designsystem/components/AdaptiveLayout.kt`: `AdaptiveContent`,
`Modifier.adaptiveContentWidth()`, `ListDetailLayout` (two panes on Expanded; each pane re-provides
`LocalYardWindow` with its own width but keeps the window's `sheetIsDialog`). The manifest has no
orientation lock; `MainActivity.applyOrientationPolicy` keeps smallest-width < 600dp portrait (not
in multi-window) and re-checks on fold/unfold. `configChanges` covers orientation / size / layout /
keyboard, so rotation recomposes in place (back stacks, sheet, ViewModels, `remember` all kept);
dark-mode changes still recreate (state restored by `rememberSaveable` / `rememberNavController`).
Shell on wide windows: `TabRail` (vertical twin of `TabPill`, visible on every tab screen unless
`isTabPillSuppressed`; `router.isTabRailVisible`), the tab stacks are offset by
`TabRailDefaults.reservedWidth` + the start inset, `LocalTabPillClearance` = nav-bar inset only,
`router.present` sheets render through `YardDialogSheet` (≤ 560 × 820dp, centered), toasts cap at
480dp. Tab stacks keep one position in the tree for every size so switching classes never
recreates them; the route sheet's content is recreated when it switches between bottom sheet and
dialog (fold/unfold while a sheet is up). `MasonryGrid`/`MasonryColumns`/`MasonrySkeleton` take
`columns` (default `gridColumns`); `distributeMasonryColumns` is the n-column greedy placement.
`@YardTabletPreviews` = 840×1200 + 1280×800dp previews.

Tests (`app/src/test/…`): `YardWindowTest` (size-class thresholds, gridColumns, contentMaxWidth,
pane windows, list-pane width, n-column masonry, phone orientation policy, rail visibility), `RouteTest` (every `Route.fromUrl` case + Router queueing), `FormattersTest`
(money for USD/NGN/MXN/KES/JPY/GBP, counts, countdown, relative/future dates, YardDate, Config URLs),
`APIErrorTest`, `ModelDecodingTest` (realistic JSON for products, brands, session, cart, drops,
follows/wishlist, storefront), `APIClientTest` (MockWebServer: headers, Origin/Content-Type, query
encoding, body encoding, error envelope, decoding errors, cookie persistence).

## Not mirrored / different on purpose

- **Material blur**: `.ultraThinMaterial` (tab pill, glass buttons, toasts, save heart) is a
  translucent `surface` fill with a hairline; Compose has no backdrop blur below API 31.
- **iPad vs Android tablets**: iOS uses size classes + a sidebar/split view; Android uses
  `LocalYardWindow` + `TabRail` + `ListDetailLayout` (no material3-adaptive dependency).
- **Fonts**: SF Pro Compressed Black → the device's `sans-serif-condensed` at Black/Bold (no bundled
  font). Continuous ("squircle") corners → plain rounded corners. Dynamic Type → `sp` font scaling.
- **matchedGeometryEffect** (tab-pill selection, tile → detail): the pill indicator slides with a spring;
  no shared-element tile → detail transition is provided.
- **MasonryGrid** is a `LazyVerticalStaggeredGrid` (the scroll container itself, balanced by measured
  height) instead of two `LazyVStack`s inside a `ScrollView`; put headers in `header = { … }`.
  `MasonryColumns` keeps the iOS greedy estimate (`heightRatio`, `extraHeight`) for non-lazy use.
- **Signatures**: `RemoteImage(url:)` and `RemoteImage(path:)` are one `RemoteImage(url)` that resolves
  relative paths; SF Symbol names become `ImageVector`s; `SegmentedPill(selection: Binding)` becomes
  `selection` + `onSelect`; `EmptyState.error/signedOut` are `EmptyState.Error/SignedOut`;
  `YardSheet` detents become `skipPartiallyExpanded`; `.yardToastHost(_:)` is `YardToastHost(center) { }`.
  URLs are `String?` (not `URL`). `Formatters.countdown` takes seconds, a `Duration` or a target `Instant`.
- **Lenient decoding**: Swift decodes each field with a fallback; Kotlin uses `YardJson`
  (unknown keys ignored, null → default, quoted numbers OK). A value of a completely wrong type
  (e.g. a string where an object is expected) still fails that model — keep defaults on every field.
- **Added for Android**: `YardTopBar` + `LocalBackAction` (iOS gets a navigation bar for free),
  `LocalTabPillClearance` (iOS `.safeAreaPadding` on tab roots), `YardSwitch`, `YardDivider`,
  `Modifier.pressableClick`, `WebPages` (Custom Tabs), `SessionStore.addSignOutListener`.
- **Not wired yet (iOS wires these in `YardApp`, features own them)**:
  - Push notifications (`YardPushAppDelegate`, `.yardPushNotifications()`): needs Firebase/FCM — a new
    dependency and `google-services.json`; not added.
  - Email sign-in / verify links (`AuthEmailLinks`) are not intercepted before `Router.open` in
    `MainActivity.handleLink`; the auth agent should ask the orchestrator to add that one call.
  - Live Activities have no Android equivalent (closest: an ongoing order notification); `signOut`
    ends nothing — use `addSignOutListener` if the live-activity agent builds one.
  - `YouRegion.restore(into: cart)` (ship-to country at launch) — the you agent can set
    `cart.destinationCountry` from its own stored setting; ask the orchestrator to call it at launch.
- **App links**: the manifest declares `https://yardstore.space/…` (autoVerify) and `yard://`; verified
  links need `/.well-known/assetlinks.json` on the website with the release signing key's SHA-256.
- **App icon / splash**: placeholder acid "Y" adaptive icon; replace with the brush-logo artwork.
- Maps (Around) need a library (osmdroid / MapLibre) — not added.
