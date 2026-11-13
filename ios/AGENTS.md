# Yard for iOS — the build spec every agent follows

Native SwiftUI app for **Yard** (yardstore.space): a marketplace for independent fashion and
streetwear brands. Shoppers discover brands, follow them, get drop alerts, put pieces from many
brands in one cart, pay once, message brands and track each brand's part of an order.

This folder (`ios/`) lives on the `iOSyard` branch of the website repo. The website code in the
repo root is the source of truth for data, wording and behaviour: read it (`src/app`,
`src/components/market`, `src/lib/api`, `src/server`) whenever you need to know what a screen
shows or what an endpoint returns.

## Hard facts

- **Swift 5.9+/Swift 6 language mode off, SwiftUI, iOS 17.0 minimum, iPhone only, portrait.**
  Use iOS 17 APIs freely: `@Observable` (Observation framework), `NavigationStack` +
  `navigationDestination`, `.scrollTargetBehavior`, `ContentUnavailableView`, `.sensoryFeedback`,
  `PhaseAnimator`, `.containerRelativeFrame`, `.safeAreaPadding`, `async/await`, `URLSession`.
  Nothing newer than iOS 17 without `if #available`.
- **No third-party packages.** Apple frameworks only (SwiftUI, Observation, ActivityKit,
  WidgetKit, MapKit, AuthenticationServices, PhotosUI, UserNotifications).
- **Nobody can compile here** (Linux server, no Xcode). So write code that compiles the first
  time: explicit types where inference is shaky, no made-up APIs, no SwiftUI modifiers you are
  not sure exist on iOS 17, every `switch` exhaustive, every `init` matching its call sites,
  `@MainActor` on view models and stores, `Sendable`-safe models (structs). When unsure an API
  exists, use a simpler one you are sure of. Re-read your files before finishing, looking only for
  compile errors.
- **Both light and dark mode, everywhere.** Never hard-code a colour in a view: use the tokens in
  `DesignSystem/Theme.swift` (`Color.yard.*`), which resolve per appearance. The user picks
  System / Light / Dark in You › Settings › Appearance (stored with `@AppStorage("appearance")`,
  applied at the root with `.preferredColorScheme`).
- **Project generation:** `ios/project.yml` (XcodeGen). The owner runs `brew install xcodegen &&
  cd ios && xcodegen` on a Mac, then opens `Yard.xcodeproj`. Sources are picked up by folder, so
  **adding a file never needs a project edit**. Only the foundation agent edits `project.yml`
  (the Live Activity agent may add its widget-extension target there).

## Brand look (from the website)

- Colours (Theme.swift exposes them as `Color.yard.<name>`, each with light and dark values):
  - `bg` (dark #080808 / light #F6F5F1), `surface` (cards: #121212 / #FFFFFF),
    `surface2` (#1A1A1A / #EFEDE7), `line` (white 8% / black 8%),
  - `ink` (primary text #F5F5F0 / #0B0B0B), `ink2` (secondary #A3A39C / #5B5B55), `ink3` (#6E6E68 / #8A8A83),
  - `acid` #F5FF00 (THE accent, same in both modes; text on acid is always #0B0B0B),
  - `purple` #6D28D9, `violet` #A78BFA (dark) / #6D28D9 (light), `danger` #FF4D4D / #D92D20, `success` #22C55E / #16A34A.
- Type: SF Pro. Display headlines = `.system(size:weight: .black)` with `.width(.compressed)` and
  uppercase (the site's heavy condensed capitals). Body = `.system(.body)`. Use the type scale in
  `DesignSystem/Typography.swift` (`.yardDisplay(…)`, `.yardTitle`, `.yardBody`, `.yardCaption`)
  and support Dynamic Type for body text.
- Shape: cards 20pt radius (continuous), buttons are full pills, chips are pills, images 16pt radius.
- Primary button: acid pill with black text. Secondary: `surface2` pill with `ink` text. On a photo:
  white pill with black text (brand profile Follow).
- Motion: springs (`.spring(response: 0.35, dampingFraction: 0.82)`), `.sensoryFeedback` on taps
  that change state (follow, add to bag, pay), matched geometry for tile → detail where easy.
- Logo: `DesignSystem/YardLogo.swift` draws the brush "YARD" logo as a SwiftUI `Shape` from the
  website's SVG paths (`src/components/brand/yard-logo-paths.ts`).

## Design references (look at them: `ios/Design/References/`)

| File | Screen | Take this |
|---|---|---|
| 01-home-pinterest.png | **Home** | Two-column masonry of image tiles with varied heights, edge to edge, 6–8pt gaps, rounded tiles, title + "…" under some tiles; top tabs ("For you", "Following", categories); **floating bottom tab pill** (Home, Search, Bag, You) hovering over content with `.ultraThinMaterial`. |
| 02-brand-profile.jpg | **Brand profile** | Full-bleed hero photo that fades into a blurred dark gradient; big brand name + @handle; wide white **Follow** pill + round message button; three real stats (followers, products, drops — never invented); bio card; grid of products/posts below; close (×) and "…" glass buttons on top. |
| 03-dynamic-island-sequence.jpg | **Order tracking Live Activity** | Compact island (logo + status), expanded island (status, big ETA/countdown, from → to route line with a moving marker, Details / Track buttons). |
| 04-product-cart-wtaps.jpg | Product, cart, order summary | Big product image, thumbnails, size chips, heart, Buy Now pill; summary rows with qty steppers and a Pay pill. |
| 05-product-cart-mvp.jpg | Product, cart | Swipeable photos with page dots, "New Arrival" tag, Choose size + Add to cart pills, cart rows + subtotal bar. |
| 06-order-confirmed-ticket.jpg | Order confirmed | Glowing success badge, the order as a ticket with perforation, details grid, bottom action. |
| 07-order-status-timeline.jpg | Order status | Big status heading, Status / Details segmented control, vertical timeline with dots. |
| 08-settings.jpg | You / Settings | Grouped rounded cards, icon tile per row, chevrons, toggles. |

Adapt layouts from the light references into Yard's look in BOTH modes; never copy their colours.

## Data: the live API

- Base URL `https://yardstore.space` (in `Core/Config.swift`, overridable for dev).
- Every request: header `X-Yard-Client: 1`; every non-GET also `Origin: https://yardstore.space`
  and `Content-Type: application/json` (the server's CSRF rule, `src/server/http/csrf.ts`).
- Auth is cookie-based: the shared `URLSession` uses `HTTPCookieStorage.shared`, so the session
  cookie (`yard_s` for shoppers) is kept automatically after sign-in.
- Errors come back as `{ "error": { "code": "...", "message": "...", "fields": { ... } } }` —
  `Core/APIClient.swift` turns them into `APIError` with the server's message (show that message
  to the user; it is written for people).
- Media URLs come back relative (`/api/media/…`, `/site/…`): resolve them against the base URL
  (`Config.url(for:)`).
- Find each endpoint's exact request and response shape in `src/app/api/**/route.ts` and the
  contract/DTO files they import (`src/lib/api/contracts/**`, `src/server/**/dto.ts`,
  `src/lib/api/*.ts` client helpers). Model only the fields a screen uses; decode with
  `JSONDecoder` (`.convertFromSnakeCase` is NOT used — the API is camelCase) and make optional
  anything the server may omit or send as null.
- Never show sample data in the app. Empty data = an honest empty state (`ContentUnavailableView`
  styled with the theme).

## Folder layout and ownership (one owner per folder — never edit another owner's files)

```
ios/
  project.yml                      foundation
  Yard/App/                        foundation   YardApp.swift, RootView.swift (tab pill + navigation), Router.swift
  Yard/DesignSystem/               foundation   Theme, Typography, YardLogo, components (see below)
  Yard/Core/                       foundation   Config, APIClient, APIError, Models (shared), Stores (Session, Cart, Follows, Saved), Formatters
  Yard/Features/Home/              home
  Yard/Features/Search/            search
  Yard/Features/Brands/            brands       (directory + brand profile)
  Yard/Features/Product/           product      (product detail, size sheet, photo viewer)
  Yard/Features/Bag/               bag          (bag + checkout)
  Yard/Features/Orders/            orders       (confirmation ticket, orders list, order detail timeline, in-app tracking card)
  Yard/Features/Drops/             drops
  Yard/Features/Auth/              auth         (sign in/up, Google via ASWebAuthenticationSession, magic link, welcome/interests)
  Yard/Features/You/               you          (profile hub, settings, appearance, notification prefs, addresses, legal links)
  Yard/Features/Inbox/             inbox
  Yard/Features/Saved/             saved        (wishlist + following feed)
  Yard/Features/Shop/              shop         (categories, shop listing with filters/sort, collections)
  Yard/Features/Charts/            charts
  Yard/Features/Around/            around       (MapKit)
  Yard/Features/Notifications/     notifications
  YardLiveActivity/                live-activity (widget extension: ActivityKit Live Activity + Dynamic Island)
  Yard/Features/LiveActivity/      live-activity (app side: start/update/end the activity; shared attributes)
```

Shared design-system components (foundation builds these; everyone uses them, nobody re-invents
them): `YardButton` (primary/secondary/onPhoto/destructive, loading state), `Chip`, `Tag`,
`RemoteImage` (cached async image with placeholder shimmer and fade-in), `MasonryGrid`
(two-column, height-balanced), `ProductTile`, `BrandAvatar`, `PriceText`, `SectionHeader`,
`GlassIconButton`, `SegmentedPill`, `EmptyState`, `Skeleton`, `Toast` (environment-driven),
`QuantityStepper`, `YardSheet` styling, `Card`.

Navigation: the root holds one `NavigationStack` per tab with a `Router` (`@Observable`) holding
`NavigationPath`s; destinations are an `enum Route: Hashable` in `App/Router.swift`
(`.brand(handle:)`, `.product(slug:)`, `.drop(id:)`, `.order(id:)`, `.collection(brand:handle:)`,
`.category(slug:)`, `.conversation(id:)`, `.search(query:)`, `.settings`, …). Feature agents add
their screens by implementing the view that the foundation's `RouteView` switch already calls by
name (e.g. `BrandProfileView(handle:)`); the foundation creates a minimal placeholder file for each
in the right feature folder, and the feature agent REPLACES it, keeping the type name and
initializer exactly.

## Done means

- Every screen in your folder works in light and dark mode, has loading (skeleton), empty and
  error states, uses only theme tokens and shared components, and calls the real API.
- Add `#Preview` blocks with a light and a dark variant for each main view (using small inline
  fixture values — previews only, never shown in the app).
- Write `ios/Docs/<your-folder>.md` (short): screens, endpoints used, anything unfinished.
- Re-read every file you wrote purely for compile errors before you finish.
