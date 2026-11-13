# Foundation: what every feature agent builds on

Read `ios/AGENTS.md` first. This page lists the shared API exactly as it is in the code. If you need
something that is not here, build it inside your own feature folder; never edit `App/`,
`DesignSystem/`, `Core/` or `project.yml` (foundation-owned).

## Project

- `ios/project.yml` (XcodeGen): target `Yard`, bundle id `space.yardstore.app`, iOS 17.0, iPhone
  only, portrait. Sources = everything under `ios/Yard/` (new files need no project edit).
- Info.plist (generated from `project.yml`): display name Yard, `NSSupportsLiveActivities`,
  location-when-in-use (Around), photo library (Inbox attachments), `UILaunchScreen`, URL scheme `yard://`.
- Assets: `Yard/Resources/Assets.xcassets` (AccentColor = acid, AppIcon placeholder, LaunchBackground).
- Live Activity: a commented `YardLiveActivity` target template sits at the bottom of `project.yml`;
  the live-activity agent fills it in (and the `dependencies:` line on `Yard`).
- Swift 5 language mode, `SWIFT_STRICT_CONCURRENCY = minimal`.

## Your screen: the placeholder you replace

Each screen below exists as a placeholder in your folder. **Replace the file's contents and keep the
type name and init exactly** (Router's `RouteView` calls them). Add more files freely.

| Route (`App/Router.swift`) | View + init you keep | File |
|---|---|---|
| tab root Home | `HomeView()` | Features/Home/HomeView.swift |
| tab root Search, `.search(query:)` | `SearchView(query: String)` (tab root passes `""`) | Features/Search/SearchView.swift |
| `.brandsDirectory` | `BrandsDirectoryView()` | Features/Brands/BrandsDirectoryView.swift |
| `.brand(handle:)` | `BrandProfileView(handle: String)` | Features/Brands/BrandProfileView.swift |
| `.product(slug:)` | `ProductDetailView(slug: String)` | Features/Product/ProductDetailView.swift |
| tab root Bag, `.bag` | `BagView()` | Features/Bag/BagView.swift |
| `.checkout` | `CheckoutView()` | Features/Bag/CheckoutView.swift |
| `.orderConfirmation(checkoutId:)` | `OrderConfirmationView(checkoutId: String)` | Features/Orders/OrderConfirmationView.swift |
| `.orders` | `OrdersListView()` | Features/Orders/OrdersListView.swift |
| `.order(id:)` | `OrderDetailView(id: String)` | Features/Orders/OrderDetailView.swift |
| `.drops` | `DropsView()` | Features/Drops/DropsView.swift |
| `.drop(id:)` (id or slug) | `DropDetailView(id: String)` | Features/Drops/DropDetailView.swift |
| `.myDrops` | `MyDropsView()` | Features/Drops/MyDropsView.swift |
| `.signIn` (usually presented as a sheet) | `SignInView()` | Features/Auth/SignInView.swift |
| `.welcome` | `WelcomeView()` | Features/Auth/WelcomeView.swift |
| tab root You, `.you` | `YouView()` | Features/You/YouView.swift |
| `.settings` | `SettingsView()` | Features/You/SettingsView.swift |
| `.appearance` | `AppearanceView()` | Features/You/AppearanceView.swift |
| `.notificationSettings` | `NotificationSettingsView()` | Features/You/NotificationSettingsView.swift |
| `.addresses` | `AddressesView()` | Features/You/AddressesView.swift |
| `.legal(LegalPage)` | `LegalView(page: LegalPage)` | Features/You/LegalView.swift |
| `.inbox` | `InboxView()` | Features/Inbox/InboxView.swift |
| `.conversation(id:)` | `ConversationView(id: String)` | Features/Inbox/ConversationView.swift |
| `.messageBrand(brandId:)` | `BrandConversationView(brandId: String)` (resolve via `/api/inbox/conversations/by-brand/{brandId}`) | Features/Inbox/BrandConversationView.swift |
| `.saved` | `SavedView()` | Features/Saved/SavedView.swift |
| `.following` | `FollowingView()` | Features/Saved/FollowingView.swift |
| `.categories` | `CategoriesView()` | Features/Shop/CategoriesView.swift |
| `.category(slug:)` / `.shop` | `ShopView(category: String?)` (`nil` = all) | Features/Shop/ShopView.swift |
| `.collection(brand:handle:)` | `CollectionView(brand: String, handle: String)` | Features/Shop/CollectionView.swift |
| `.charts` | `ChartsView()` | Features/Charts/ChartsView.swift |
| `.around` | `AroundView()` | Features/Around/AroundView.swift |
| `.notifications` | `NotificationsView()` | Features/Notifications/NotificationsView.swift |

The placeholders use `FeaturePlaceholder("Title")`; stop using it once your screen is real.
Live Activity has no route; its folders (`Yard/Features/LiveActivity/`, `YardLiveActivity/`) don't exist yet.

## Navigation (`App/Router.swift`, `App/RootView.swift`)

```swift
@Environment(Router.self) private var router

router.push(.brand(handle: "acme"))          // onto the current tab's stack
NavigationLink(value: Route.product(slug: p.slug)) { ProductTile(product: p) }
router.pop()                                  // or @Environment(\.dismiss)
router.popToRoot()                            // current tab
router.select(.bag)                           // switch tab (re-selecting pops to root)
router.show(.order(id: id), in: .you)         // switch tab, reset it, push
router.present(.signIn)                       // sheet (wrapped in its own NavigationStack + toasts)
router.dismissSheet()
router.open(url)                              // web/universal/yard:// link → Bool (false = not an app page)
Route(path: "/drops/abc")                     // site path (e.g. storefront announcement href) → Route?
```

- `enum AppTab { home, search, bag, you }`; `router.selectedTab`, `router.homePath/searchPath/bagPath/youPath`.
- `enum LegalPage { terms, privacy, refunds, dataDeletion }` with `.title` and `.path` (website path; open `Config.webURL(page.path)`).
- Every NavigationStack (tabs and the sheet) already has `.navigationDestination(for: Route.self)`.
  If you create your own NavigationStack (e.g. a sheet you present yourself), call `.yardRouteDestinations()` on its root.
- **Floating tab pill:** visible only on tab roots (`router.depth == 0`) and while no route sheet is up;
  pushed screens get the full height (put your own bottom bars there). Tab roots get bottom safe-area
  padding (`Spacing.tabPillClearance`) automatically. To collapse the pill while scrolling down, put
  `TabPillScrollSensor()` as the first child of your tab-root `ScrollView` content. To hide it on a
  root screen (full-screen composer), set `router.isTabPillSuppressed = true` and reset it on disappear.
- Sign-in gate pattern: `guard session.isSignedIn else { router.present(.signIn); return }`.
  `SignInView` should `await session.didSignIn()` then `router.dismissSheet()` (if presented) on success;
  the root reloads cart, follows and saved automatically when the shopper id changes.

## Environment objects (all `@Observable @MainActor`, injected at the root)

```swift
@Environment(SessionStore.self) private var session
@Environment(CartStore.self) private var cart
@Environment(FollowStore.self) private var follows
@Environment(SavedStore.self) private var saved
@Environment(Router.self) private var router
@Environment(ToastCenter.self) private var toast
```

**Concurrency rule:** these are `@MainActor`. If a view touches a store from a helper property or
function (not just `body`), mark the view struct `@MainActor`. Spawn work with
`Task { @MainActor in … }`. View models: `@Observable @MainActor final class`, held in `@State`.

### SessionStore (`Core/Stores/SessionStore.swift`)
- `shopper: Shopper?`, `session: Session?`, `isSignedIn: Bool`, `isLoading`, `hasLoaded`, `lastError: APIError?`
- `func refresh() async` — GET /api/session (root calls on launch and when the app becomes active)
- `func didSignIn() async` — call after a successful sign-in/up
- `func signOut() async` — POST /api/auth/sign-out?actor=shopper; never throws
- `static func preview(signedIn: Bool = true) -> SessionStore`

### CartStore (`Core/Stores/CartStore.swift`)
- `cart: Cart?`, `count: Int` (Bag badge), `isEmpty`, `isLoading`, `lastError`, `busyVariantIds: Set<String>`
- `currency: String` (display currency, persisted; default "USD"), `func setCurrency(_:) async`
- `destinationCountry: String?`, `destinationCity: String?` (set before `load()` to get shipping quotes)
- `func load() async` — GET /api/cart?currency=&to=&city=
- `func add(variantId: String, qty: Int = 1) async throws` — POST /api/cart/lines (409 "Only 1 left." → show `error.message`)
- `func setQuantity(variantId: String, qty: Int) async throws` — PATCH (0 removes)
- `func remove(variantId: String) async throws`, `func clear() async throws`, `func reset()`
- `func line(for variantId: String) -> CartLine?`
- `static func preview(cart: Cart? = nil) -> CartStore`

### FollowStore (`Core/Stores/FollowStore.swift`)
- `items: [FollowedBrand]`, `followedIds: Set<String>`, `isFollowing(_ brandId:) -> Bool`, `followerCountCache: [String: Int]`
- `func load() async` (401 → empty), `func reset()`
- `@discardableResult func toggle(brandId:) async throws -> FollowResult` (optimistic, rolls back)
- `@discardableResult func setFollowing(_ follow: Bool, brandId:) async throws -> FollowResult`
- `func followerCounts(for brandIds: [String]) async throws -> [String: Int]` — public GET /api/follows/counts (use for real follower stats; never invent)
- `static func preview(following: Set<String> = [])`

### SavedStore (`Core/Stores/SavedStore.swift`)
- `items: [WishlistItem]`, `savedIds: Set<String>`, `isSaved(_ productId:) -> Bool`
- `func load() async` (401 → empty), `func reset()`
- `@discardableResult func toggle(productId:) async throws -> Bool`, `setSaved(_:productId:)`
- `static func preview(saved: Set<String> = [])`

### ToastCenter (`DesignSystem/Components/Toast.swift`)
- `toast.show("Added to your bag", style: .success)` (`.info` / `.success` / `.error`, optional `systemImage:`)
- `toast.show(error)` — any `Error` → its user-facing message (cancellations ignored)
- `toast.dismiss()`. Hosted at the root and in route sheets; for your own sheets add `.yardToastHost(toast)`.

## Networking (`Core/Config.swift`, `Core/Networking/`)

```swift
let page = try await APIClient.shared.get("/api/catalog/products",
    query: [URLQueryItem(name: "brand", value: handle)], as: ProductsPage.self)
let r: FollowResult = try await APIClient.shared.post("/api/follows", body: FollowBody(brandId: id))
try await APIClient.shared.send(.delete, "/api/cart/lines/\(id)")      // ignore the response body
```

- `APIClient.shared`: `get / post / put / patch / delete<T: Decodable>(path, body:, query:, as:)`,
  `send(_ method:, _ path:, body:, query:)` (no decode), `request(...)`, `data(...)` (raw `Data`),
  `makeRequest(...)` (for multipart uploads: build, then modify the body/content type and use `APIClient.shared.session`).
  You cannot call the generic methods without a result type — use `send` when you don't need the body.
- Bodies: any `Encodable`. Use a struct for mixed-type bodies (`["a": "b"]` works only for all-String dictionaries).
- Headers added for you: `X-Yard-Client: 1` always; `Origin` + `Content-Type: application/json` on non-GET. Cookies via `HTTPCookieStorage.shared`. 30 s timeout.
- Empty/204 bodies decode as `{}` → use `EmptyResponse` or an all-optional struct.
- `APIError` (`status`, `code`, `message`, `fields: [String: String]`; `isUnauthorized`, `isNotFound`,
  `isConflict`, `isRateLimited`, `isCancelled`; `APIError.message(for: error)`). Show `message` as-is; map `fields` onto form fields.
- `Config.baseURL` (override with UserDefaults `yard.baseURLOverride`), `Config.url(for: String?) -> URL?`
  (resolves `/api/media/…`, `/site/…`, absolute URLs pass through), `Config.webURL(_ path:) -> URL` (share links),
  `Config.mediaPath(id:) -> "/api/media/{id}"`.
- Decoding helpers for your own models (`Core/Models/Decoding.swift`): inside a custom `init(from:)`,
  `c.lenient(.key, fallback)` and `c.lenientOptional(.key)` never throw. `YardDate.parse(iso) -> Date?`.

## Shared models (`Core/Models/`) — all `Sendable` structs

| Type | Source / endpoint | Key members |
|---|---|---|
| `Product` | GET /api/catalog/products(/{slug}) | `id, slug, brandId, title, description, details, category, subcategory?, tags, badges, priceMinor, compareAtMinor?, currency, images: [ProductImage], options: [ProductOption], variants: [ProductVariant], available, processingDays: [Int]?, dropId?, collectionIds, publishedAt?, createdAt, brand: BrandSummary?`; `price: Money`, `compareAt: Money?`, `coverURL`, `tileAspectRatio` (w/h, 0.8 default), `isSoldOut`, `isNotForSale`, `isNew`, `variantPriceRange`, `processingText` |
| `ProductsPage` | list | `products, total, nextOffset: Int?` (pass as `offset`; `limit` ≤ 60) |
| `ProductResponse` | detail | `product` |
| `ProductImage` | | `id, src, alt, width?, height?, mediaId?`, `url`, `aspectRatio` |
| `ProductOption` | | `name, values: [Value(value, hex?)]` |
| `ProductVariant` | | `id, sku, options: [String: String], label, priceMinor, available, inStock` |
| `BrandSummary` | on products | `id, handle, name, verified, city?, country?, currency?, foundingBadge, forSale, hasStorefront` |
| `BrandCard`, `BrandsPage` | GET /api/catalog/brands?q=&category=&country=&founding=&exclude=&sort=name\|new&limit=&offset= | `id, handle, name, city, country, categories, story?, logoSrc?, coverSrc?, verified, founding, foundingBadge, forSale, listedAt?`; `logoURL, coverURL, locationText, monogram`; `BrandCard.monogram(for:)` |
| `PublicStorefront` | GET /api/catalog/storefronts/{handle} | `brand: StorefrontBrand, storefront: StorefrontVersion?, collections: [StorefrontCollection]` |
| `StorefrontBrand` | | `id, handle, name, city, citySlug, country, currency, categories, verified, reviewStatus, joinedAt?, followersBase, timeZone, foundingBadge, forSale, logoSrc?`; `logoURL` |
| `StorefrontVersion` / `StorefrontConfig` | | `version, publishedAt, config`; config: `template, accent, typePreset, intro, announcement?(text, href?), sections: [StorefrontSection], coverMediaId?, coverAlt?, coverPath?, mark?, social?`, `coverURL` |
| `StorefrontSection` | | `id, type, enabled, title?, productIds?, collectionIds?, postIds?` |
| `StorefrontCollection` | | `id, handle, name, description, imageSrc?, imageMediaId?, productIds`, `imageURL` |
| `Session`, `Shopper`, `BrandMember` | GET /api/session | shopper `id, name, email, status, demo, firstName, initials` |
| `Cart`, `CartLine`, `CartGroup`, `ShippingQuote`, `ShippingOption` | GET /api/cart | cart `currency, itemCount, subtotalMinor, lines, groups, issues, removedSample, destination?`, `subtotal`, `lines(in: group)`; line `variantId, productId?, brandId?, title?, variantLabel?, imagePath?, qty, available, unitPrice: Money?, unitMinor, lineMinor, status ("ok"/"short"/"unavailable"), unavailableReason?, brandName?`, `imageURL` |
| `AddCartLineBody`, `SetCartLineBody` | cart writes | |
| `Drop`, `DropsPage`, `DropDetailResponse`, `DropViewerState`, `DropEntry` | GET /api/drops, /api/drops/{id} | drop `id, slug, brand(id, handle?, name?), name, description, image?, access, status, phase, startsAt, endsAt, earlyAccessAt?, entryOpensAt?, entryClosesAt?, drawnAt?, purchaseWindowMinutes?, winners?, limitPerCustomer, totalUnits, productIds, entries?, sponsored, variantIds?, unitsAvailable?`; `imageURL, startDate, endDate, isLive, isUpcoming, isEnded, isDraw, accessLabel`. Products of a drop: GET /api/catalog/products?drop={id} |
| `FollowedBrand`, `FollowResult`, `FollowsResponse`, `FollowCountsResponse`, `FollowBody` | /api/follows | |
| `WishlistItem`, `WishlistResponse`, `SaveResult`, `WishlistBody` | /api/wishlist | item has no image: fetch products with `ids=` for tiles |
| `Money` | | `amount` (minor), `currency`, `formatted` |

## Formatting (`Core/Formatters.swift`, `Core/Models/Money.swift`)

- `Formatters.price(minor:currency:showCents:)` → "$45", "$45.50", "₦12,000", "MX$640" (website rules)
- `MoneyFormatter.format(minor:currency:showCents:compact:)`, `MoneyFormatter.toMajor(_:currency:)`
- `Formatters.count(24000)` → "24K"; `compactNumber(_:)`; `grouped(1234)` → "1,234"
- `Formatters.relative(date)` / `relative(isoString)` → "3h ago", "Yesterday", "12 Nov"; `future(date)` → "in 3h"
- `shortDate`, `dateTime`, `time`, `countdown(interval)` → "2d 04:12:09"

## Design system (`DesignSystem/`)

Tokens: `Color.yard.bg, surface, surface2, line, ink, ink2, ink3, acid, onAcid, purple, violet, danger, success, onPhoto, onPhotoInk, scrim`.
Never write a raw colour. Text on acid = `onAcid`. Fonts: `Font.yardDisplay(_ size:)`, `.yardDisplay(_ textStyle:)`,
`.yardLargeTitle, .yardTitle, .yardHeadline, .yardBody, .yardBodyEmphasis, .yardCallout, .yardCaption, .yardCaptionEmphasis, .yardMicro`,
`.yardNumber(_ size:)`; `Text("NEW").yardDisplay(34)` (uppercase condensed). `Spacing.xxs…xxxl, gutter (16), gridGap (6), tabPillClearance`;
`Radius.card (20), image (16), small (12), sheet (28)`; `.clipShape(.yardCard)`, `.clipShape(.yardImage)`;
`Motion.spring, snappy, fade`. `AppearancePreference` (`.system/.light/.dark`, `storageKey = "appearance"`, `title`, `systemImage`)
— AppearanceView writes `@AppStorage(AppearancePreference.storageKey) var appearance = "system"`; YardApp applies it.
Root tint is `Color.yard.ink`; give toggles `.tint(Color.yard.acid)` if you want acid.

Components (init signatures):

- `YardButton(_ title: String, systemImage: String? = nil, style: .primary|.secondary|.onPhoto|.destructive|.ghost|.inverted = .primary, size: .large|.medium|.small = .large, isLoading: Bool = false, fullWidth: Bool = true, action: () -> Void)`; `YardPillButtonStyle(style:)`, `PressableButtonStyle()` (press-scale for tiles/cards)
- `Chip(_ title: String, systemImage: String? = nil, isSelected: Bool = false, isEnabled: Bool = true, count: Int? = nil, action:)` (disabled = struck through, e.g. sold-out size); `ChipRow(spacing:) { … }` horizontal scroller with gutters
- `Tag(_ text: String, style: .neutral|.acid|.violet|.danger|.success|.onPhoto = .neutral, systemImage: String? = nil)`
- `RemoteImage(url: URL?, contentMode: .fill, maxPixelSize: 1200)`, `RemoteImage(path: String?, …)`, `RemoteImage(url:contentMode:maxPixelSize:) { placeholder }` — fills the space you give it (size with `.aspectRatio`/`.frame`, clip with `.clipShape(.yardImage)`); shimmer while loading, fade-in, downsampled + cached by `ImagePipeline.shared` (use ~700 px for tiles, 1600 for full-screen)
- `MasonryGrid(_ products: [Product], spacing: = 6, extraHeight: = ProductTile.captionHeight) { product in … }` and generic `MasonryGrid(_ items: [Item: Identifiable], spacing:, extraHeight:, heightRatio: (Item) -> CGFloat /* h÷w */) { item in … }` — two height-balanced `LazyVStack` columns; place inside a `ScrollView`; edge-to-edge (add `.padding(.horizontal, Spacing.gridGap)` for a hairline gutter). Paginate with `.onAppear` on the last item.
- `MasonrySkeleton(count: 8, spacing:, showsCaption: true)` loading placeholder for grids
- `ProductTile(product: Product, showsBrand: true, showsPrice: true, showsSaveButton: true, maxPixelSize: 700)` — has the save heart wired to `SavedStore` (signed-out → Sign in sheet). Doesn't navigate; wrap in `NavigationLink(value: Route.product(slug:))` + `.buttonStyle(PressableButtonStyle())`.
- `BrandAvatar(name: String, logoURL: URL? = nil, size: CGFloat = 40, verified: Bool = false)` (monogram fallback)
- `PriceText(minor:currency:compareAtMinor:font:color:)`, `PriceText(money:…)`, `PriceText(product:font:color:)`
- `SectionHeader(_ title: String, subtitle: String? = nil, display: Bool = false, actionTitle: String? = nil, action: (() -> Void)? = nil)` (has gutter padding)
- `GlassIconButton(systemImage: String, accessibilityLabel: String, size: 40, tint: Color? = nil, action:)` (× and … over photos)
- `SegmentedPill(selection: Binding<Value>, options: [Value]) { title(for: $0) }`
- `EmptyState(title:message:systemImage:actionTitle:action:)`, `EmptyState.error(error) { await reload() }`, `EmptyState.error(message:retry:)`, `EmptyState.signedOut(title:message:signIn:)`
- `Skeleton(cornerRadius: 16, shape: .rounded|.circle|.capsule)`, `.shimmering()`
- `ToastView(toast:)`, `ToastCenter`, `.yardToastHost(center)` (see above)
- `QuantityStepper(value: Int, range: ClosedRange<Int> = 0...10, isBusy: Bool = false) { newValue in … }` (minus becomes trash at 1 → 0)
- `.yardSheet(detents: [.medium, .large], showsGrabber: true)` on sheet content; `YardSheetHeader(_ title:, subtitle:, onClose:)`
- `Card(padding: 16, background: Color.yard.surface) { … }`, `.yardCard(background:radius:)`, `.yardScreenBackground()`
- `SettingsRow(_ title:, systemImage:, value: String? = nil, tint: Color = ink, showsChevron: true)` and with a trailing accessory `SettingsRow(…) { Toggle(…) }`
- `YardLogo(color: Color.yard.acid)` (aspect-fit; set `.frame(height:)`), `YardLogoShape()`, `SVGPathParser.parse(_:) -> Path`
- `TabPillScrollSensor()` (see Navigation)
- `FeaturePlaceholder(_ title:)` — placeholders only

Previews: `.yardPreviewEnvironment(signedIn: Bool = true)` injects all stores/router/toasts;
`PreviewFixtures.products`, `.brand`, `.brandCard`, `.shopper` are preview-only fixtures.
Write one light and one dark `#Preview` per main view.

## Things to know

- The website is the source of truth for wording, behaviour and anything not listed here
  (orders, checkout, inbox, search, charts, around, notifications endpoints live in `src/app/api/**`).
- Prices: API amounts are minor units with a currency code; always format via `PriceText`/`Formatters.price`.
- Follower/product/drop counts on the brand profile must come from the API (`followerCounts`, `ProductsPage.total`, `DropsPage`).
- Never ship sample data; empty = `EmptyState`.
- The app is shopper-only; brand Studio and admin stay on the web.

## Integration (wired in YardApp)

- Push: `@UIApplicationDelegateAdaptor(YardPushAppDelegate.self)` + `.yardPushNotifications()` after the environment.
  Remote push also needs the Push Notifications capability (adds `aps-environment`) — needs a paid Apple
  developer account, so it is left off by default; local drop-reminder alerts work without it.
- Email sign-in / verify links: `AuthEmailLinks` handles them before the Router (needs universal links for
  yardstore.space, i.e. an apple-app-site-association file on the website, to reach the app from email).
- Live Activities: `resume()` whenever the app becomes active; `endAll()` on sign-out.
- Ship-to country from You › Settings restored into the cart at launch.
