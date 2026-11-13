# Yard for Android — the build spec every agent follows

Native Android app for **Yard** (yardstore.space): a marketplace for independent fashion and
streetwear brands. Shoppers discover brands, follow them, get drop alerts, put pieces from many
brands in one bag, pay once, message brands and track each brand's part of an order.

This folder (`android/`) lives next to `ios/` on the website repo's app branch. **The iOS app in
`ios/` is the spec**: Android mirrors it type for type, screen for screen, field for field, same
endpoints, same wording. Read `ios/AGENTS.md` (brand look, data rules) and `ios/Docs/<folder>.md`
for your feature. The website code in the repo root stays the source of truth for data, wording
and behaviour (`src/app/api/**/route.ts`, `src/lib/api/**`, `src/server/**`).

## The rule: mirror iOS

- Your screens are the Swift files in `ios/Yard/Features/<Folder>/`. Port each one to
  `android/app/src/main/java/space/yardstore/app/features/<folder>/` with the **same type and
  function names** (`HomeFeedModel.swift` → `HomeFeedModel.kt`, `struct HomeView: View` →
  `@Composable fun HomeView()`), the same fields, the same endpoints, the same states (loading
  skeleton, empty, error, signed-out) and the same copy.
- SwiftUI → Compose: `View` → `@Composable`; `@Observable @MainActor final class XModel` →
  `class XModel : ViewModel()` with `mutableStateOf` properties (`private set`) and
  `viewModelScope.launch`; `@State` → `remember { mutableStateOf(…) }` (`rememberSaveable` for
  user input); `.task {}` → `LaunchedEffect(key)`; `Task { … }` from a tap → `rememberCoroutineScope().launch`;
  `@Environment(X.self)` → `LocalX.current`; `.sheet` → `YardSheet`; `#Preview` → `@Preview` + `YardPreview`.
- Where something can't be mirrored 1:1 (an iOS-only API, MapKit, ActivityKit), build the closest
  honest Android equivalent and write the difference in your `android/Docs/<folder>.md`.

## Hard facts

- **Kotlin 2.1, Jetpack Compose (BOM 2025.06), Material 3 underneath but Yard's own look — never
  stock Material styling.** minSdk 26, target/compile SDK 35, portrait, phone.
- **Libraries are fixed** (`gradle/libs.versions.toml`): Compose, material3 + material-icons-extended,
  navigation-compose, lifecycle-viewmodel-compose, kotlinx-serialization-json, OkHttp, Coil 3,
  DataStore, androidx.browser (Custom Tabs), core-splashscreen. **Do not add dependencies or edit
  Gradle files** — ask the orchestrator if you truly need one (e.g. a map library for Around).
- **You can compile — so do.** `cd android && ./gradlew :app:compileDebugKotlin` must pass before you
  finish; `./gradlew :app:testDebugUnitTest` for any tests you add (`app/src/test/java/…/features/<folder>/`).
  Other agents build in parallel: never run `clean`, never delete `build/` or `.gradle/`.
- **Both light and dark mode, everywhere.** Never hard-code a colour: use `Color.yard.*`
  (designsystem/Theme.kt), which resolve for the current appearance. The user picks System / Light /
  Dark in You › Settings › Appearance (`AppearanceStore`, DataStore key `appearance`), applied at the root.
- **Edge to edge.** Screens draw under the system bars. `YardTopBar` pads for the status bar; tab
  roots add `LocalTabPillClearance.current` to their bottom content padding (it already includes the
  nav-bar inset); pushed screens put bottom bars above `Modifier.navigationBarsPadding()`; text
  composers use `Modifier.imePadding()`.
- **Never show sample data in the app.** Empty data = an honest `EmptyState`. Counts (followers,
  products, drops) come from the API, never invented. `PreviewFixtures` are for `@Preview` only.

## Brand look

Same as `ios/AGENTS.md` › Brand look. Tokens: `Color.yard.bg, surface, surface2, line, ink, ink2,
ink3, acid, onAcid, purple, violet, danger, success, onPhoto, onPhotoInk, scrim`. Text on acid =
`onAcid`. Cards 20dp, images 16dp, buttons/chips full pills. Primary = acid pill + black text,
secondary = `surface2` pill + `ink`, on a photo = white pill + black text. Display headlines are
heavy condensed capitals (`YardDisplayText`). Motion = `Motion.spring()`; haptics
(`LocalHapticFeedback`) on taps that change state (follow, add to bag, pay). Design references:
`ios/Design/References/*.png|jpg` (adapt to Yard's colours in both modes; never copy theirs).

## Data: the live API

Exactly as iOS: base `https://yardstore.space` (`Config.baseUrl`; dev override = SharedPreferences
`yard` / key `yard.baseURLOverride`), `X-Yard-Client: 1` on every request, `Origin` + JSON
`Content-Type` on non-GET (done for you by `APIClient`), cookie auth (`yard_s`, persisted across
restarts by `PersistentCookieJar`), errors `{error:{code,message,fields}}` → `APIError` whose
`message` you show as-is. Media paths come back relative: `Config.url(path)` (RemoteImage does it).
Models: `@Serializable data class`, camelCase field names = wire names, **every property gets a
default unless the server always sends it** (ids), nullable where Swift is optional. Decode with
the shared lenient `YardJson` (APIClient does). Model only what a screen uses.

## Package layout and ownership (one owner per package — never edit another owner's files)

```
android/
  build.gradle.kts, settings.gradle.kts, gradle/, app/build.gradle.kts    foundation
  app/src/main/AndroidManifest.xml, res/                                   foundation
  app/src/main/java/space/yardstore/app/
    app/            foundation  YardApp, AppContainer, MainActivity, RootView (tab pill), Router (Route), RouteView
    designsystem/   foundation  Theme, Typography, Metrics, YardLogo, PreviewSupport, components/
    core/           foundation  Config, Formatters, AppearancePreference, WebPages, networking/, models/, stores/
    features/home/          home
    features/search/        search
    features/brands/        brands         (directory + brand profile)
    features/product/       product        (product detail, size sheet, photo viewer)
    features/bag/           bag            (bag + checkout)
    features/orders/        orders         (confirmation ticket, orders list, order detail timeline, tracking card)
    features/drops/         drops
    features/auth/          auth           (sign in/up, Google, magic link, welcome/interests)
    features/you/           you            (profile hub, settings, appearance, notification prefs, addresses, legal)
    features/inbox/         inbox
    features/saved/         saved          (wishlist + following)
    features/shop/          shop           (categories, shop listing with filters/sort, collections)
    features/charts/        charts
    features/around/        around
    features/notifications/ notifications
    features/liveactivity/  live-activity  (Android: ongoing order notification, if built)
  app/src/test/java/space/yardstore/app/features/<folder>/   that feature's owner
  Docs/<folder>.md                                           that feature's owner
```

**Foundation files are read-only for screen agents.** If you need something shared that isn't
there, build it inside your own package (prefix private helpers with your feature name to avoid
clashes, e.g. `BagLineRow`). Never put a top-level declaration in your package whose name matches
another package's (all features share one module; same-package duplicates won't compile, cross-package
same names are fine but confusing).

## Your screen: replace the placeholder

Each screen exists as a placeholder `@Composable` in your package calling `FeaturePlaceholder(…)`.
**Replace the file's contents, keep the function name and parameters exactly** (`RouteView` calls
them). Add more files freely.

| Route (`app/Router.kt`) | Composable you keep | File (features/…) |
|---|---|---|
| tab root Home | `HomeView()` | home/HomeView.kt |
| tab root Search, `Route.Search(query)` | `SearchView(query: String)` (tab root passes `""`) | search/SearchView.kt |
| `Route.BrandsDirectory` | `BrandsDirectoryView()` | brands/BrandsDirectoryView.kt |
| `Route.Brand(handle)` | `BrandProfileView(handle: String)` | brands/BrandProfileView.kt |
| `Route.Product(slug)` | `ProductDetailView(slug: String)` | product/ProductDetailView.kt |
| tab root Bag, `Route.Bag` | `BagView()` | bag/BagView.kt |
| `Route.Checkout` | `CheckoutView()` | bag/CheckoutView.kt |
| `Route.OrderConfirmation(checkoutId)` | `OrderConfirmationView(checkoutId: String)` | orders/OrderConfirmationView.kt |
| `Route.Orders` | `OrdersListView()` | orders/OrdersListView.kt |
| `Route.Order(id)` | `OrderDetailView(id: String)` | orders/OrderDetailView.kt |
| `Route.Drops` | `DropsView()` | drops/DropsView.kt |
| `Route.Drop(id)` (id or slug) | `DropDetailView(id: String)` | drops/DropDetailView.kt |
| `Route.MyDrops` | `MyDropsView()` | drops/MyDropsView.kt |
| `Route.SignIn` (usually presented as a sheet) | `SignInView()` | auth/SignInView.kt |
| `Route.Welcome` | `WelcomeView()` | auth/WelcomeView.kt |
| tab root You, `Route.You` | `YouView()` | you/YouView.kt |
| `Route.Settings` | `SettingsView()` | you/SettingsView.kt |
| `Route.Appearance` | `AppearanceView()` | you/AppearanceView.kt |
| `Route.NotificationSettings` | `NotificationSettingsView()` | you/NotificationSettingsView.kt |
| `Route.Addresses` | `AddressesView()` | you/AddressesView.kt |
| `Route.Legal(page)` | `LegalView(page: LegalPage)` | you/LegalView.kt |
| `Route.Inbox` | `InboxView()` | inbox/InboxView.kt |
| `Route.Conversation(id)` | `ConversationView(id: String)` | inbox/ConversationView.kt |
| `Route.MessageBrand(brandId)` | `BrandConversationView(brandId: String)` | inbox/BrandConversationView.kt |
| `Route.Saved` | `SavedView()` | saved/SavedView.kt |
| `Route.Following` | `FollowingView()` | saved/FollowingView.kt |
| `Route.Categories` | `CategoriesView()` | shop/CategoriesView.kt |
| `Route.Category(slug)` / `Route.Shop` | `ShopView(category: String?)` (`null` = all) | shop/ShopView.kt |
| `Route.Collection(brand, handle)` | `CollectionView(brand: String, handle: String)` | shop/CollectionView.kt |
| `Route.Charts` | `ChartsView()` | charts/ChartsView.kt |
| `Route.Around` | `AroundView()` | around/AroundView.kt |
| `Route.Notifications` | `NotificationsView()` | notifications/NotificationsView.kt |

Every screen draws its own background (`Modifier.fillMaxSize().yardScreenBackground()`) and its own
top bar (`YardTopBar(title)` — shows back on pushed screens, × at the root of a sheet, nothing on tab
roots; or a custom header with `GlassIconButton`s over a hero photo, using `LocalBackAction.current`).

## Foundation cheat sheet

### Screen skeleton

```kotlin
class OrdersListModel(private val api: APIClient = APIClient.shared) : ViewModel() {
    var orders by mutableStateOf<List<OrderSummary>>(emptyList()); private set
    var isLoading by mutableStateOf(false); private set
    var error by mutableStateOf<APIError?>(null); private set

    fun load() = viewModelScope.launch {
        isLoading = true
        try { orders = api.get<OrdersResponse>("/api/orders").orders; error = null }
        catch (e: CancellationException) { throw e }
        catch (e: APIError) { error = e }
        finally { isLoading = false }
    }
}

@Composable
fun OrdersListView() {
    val model: OrdersListModel = viewModel { OrdersListModel() }   // scoped to this back-stack entry
    val session = LocalSessionStore.current
    val router = LocalRouter.current
    LaunchedEffect(session.shopper?.id) { if (session.isSignedIn) model.load() }
    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar("Orders")
        when {
            !session.isSignedIn -> EmptyState.SignedOut(message = "Sign in to see your orders.") { router.present(Route.SignIn) }
            model.isLoading && model.orders.isEmpty() -> MasonrySkeleton()
            model.error != null -> EmptyState.Error(model.error!!) { model.load() }
            model.orders.isEmpty() -> EmptyState("No orders yet", icon = Icons.Outlined.ShoppingBag)
            else -> LazyColumn(contentPadding = PaddingValues(bottom = LocalTabPillClearance.current)) { … }
        }
    }
}
```

### Navigation (`app/Router.kt`)

```kotlin
val router = LocalRouter.current
router.push(Route.Brand(handle = "acme"))        // onto the current tab's stack
router.pop()                                      // or LocalBackAction.current?.perform()
router.popToRoot()                                // current tab (popToRoot(AppTab.Bag) for another)
router.select(AppTab.Bag)                         // switch tab (re-selecting pops to root)
router.show(Route.Order(id), AppTab.You)          // switch tab, reset it, push
router.present(Route.SignIn)                      // sheet with its own back stack + toasts
router.dismissSheet()
router.open(url): Boolean                         // https://yardstore.space/… or yard://… → false = not an app page
Route.fromUrl(url) / Route.fromPath("/drops/abc") // → Route?
WebPages.open(context, Config.webUrl(page.path), darkTheme = Color.yard.isDark)   // web pages, hosted payment
```
- `AppTab.Home/Search/Bag/You`; `router.selectedTab`, `router.depth`, `router.sheet`.
- `LegalPage.Terms/Privacy/Refunds/DataDeletion` with `.title`, `.path`.
- Tab pill: visible only on tab roots with no sheet. Tab roots: bottom padding `LocalTabPillClearance.current`;
  `Modifier.tabPillScrollSensor()` on the root's scrolling container collapses the pill while scrolling
  down; `router.isTabPillSuppressed = true` hides it (reset in `DisposableEffect` onDispose).
- Sign-in gate: `if (!session.isSignedIn) { router.present(Route.SignIn); return }`. SignInView calls
  `session.didSignIn()` then `router.dismissSheet()`; the root reloads cart/follows/saved when the shopper changes.

### Stores (app-scoped Compose state; read with `LocalXStore.current`; call suspend funs from a coroutine)

- **SessionStore** `LocalSessionStore`: `shopper`, `session`, `isSignedIn`, `isLoading`, `hasLoaded`,
  `lastError`; `refresh()`, `didSignIn()`, `signOut()` (never throws), `addSignOutListener { }`; `SessionStore.preview(signedIn)`.
- **CartStore** `LocalCartStore`: `cart`, `count`, `isEmpty`, `isLoading`, `lastError`, `busyVariantIds`,
  `currency` + `setCurrency(code)`, `destinationCountry`, `destinationCity`; `load()`, `add(variantId, qty = 1)`
  (throws, e.g. 409 "Only 1 left."), `setQuantity(variantId, qty)` (0 removes), `remove(variantId)`, `clear()`,
  `reset()`, `line(variantId)`; `CartStore.preview(cart)`.
- **FollowStore** `LocalFollowStore`: `items`, `followedIds`, `isFollowing(brandId)`, `followerCountCache`;
  `load()` (401 → empty), `reset()`, `toggle(brandId): FollowResult` (optimistic, rolls back),
  `setFollowing(follow, brandId)`, `followerCounts(brandIds): Map<String, Int>` (public; real counts only).
- **SavedStore** `LocalSavedStore`: `items`, `savedIds`, `isSaved(productId)`; `load()`, `reset()`,
  `toggle(productId): Boolean`, `setSaved(save, productId)`.
- **ToastCenter** `LocalToastCenter`: `show("Added to your bag", Toast.Style.Success)`, `show(error)`
  (any Throwable → user message; cancellation ignored), `dismiss()`.
- **AppearanceStore** `LocalAppearanceStore` (nullable in previews): `preference: Flow<AppearancePreference>`, `set(pref)`.

### Networking (`core/networking/`)

```kotlin
val page = APIClient.shared.get<ProductsPage>("/api/catalog/products", listOf("brand" to handle, "limit" to "24"))
val r = APIClient.shared.post<FollowResult>("/api/follows", body = FollowBody(brandId = id))
APIClient.shared.send(HTTPMethod.DELETE, "/api/cart/lines/${Config.encodePath(id)}")   // ignore the body
val up = APIClient.shared.upload<UploadResult>("/api/inbox/attachments", listOf(
    MultipartPart.File("file", "photo.jpg", "image/jpeg", bytes), MultipartPart.Field("conversationId", id)))
```
- `get / post / put / patch / delete<T>(path, body?, query)`, `send(method, path, body?, query)`,
  `request<T>(…)`, `data(…)` (raw body String), `makeRequest(…)` + `execute(request)`, `upload<T>(…)`.
- Bodies: any `@Serializable` object, `Map<String, Any?>`, `JsonElement` or raw JSON String.
  Query: `List<Pair<String, String?>>` (repeat a name for arrays; null values skipped; `+` is encoded).
- Empty/204 bodies decode as `{}` → use `EmptyResponse` or an all-defaults class.
- `APIError(status, code, message, fields)`: `isUnauthorized`, `isNotFound`, `isConflict`,
  `isRateLimited`, `isCancelled`; `APIError.messageFor(e)`. **Always rethrow `CancellationException`**
  before catching `Exception`.
- `Config.url(path)` (relative → absolute, absolute passes through), `Config.webUrl(path)`,
  `Config.mediaPath(id)`, `Config.encodePath(segment)`. `YardDate.parse(iso): Instant?`.
- Shared models (`core/models/`): `Product`, `ProductsPage`, `ProductResponse`, `ProductImage`, `ProductOption`,
  `ProductVariant`, `BrandSummary`, `BrandCard`, `BrandsPage`, `PublicStorefront`, `StorefrontBrand`,
  `StorefrontVersion`, `StorefrontConfig`, `StorefrontSection`, `StorefrontCollection`, `BrandMark`, `BrandSocial`,
  `Session`, `Shopper`, `BrandMember`, `Cart`, `CartLine`, `CartGroup`, `ShippingQuote`, `ShippingOption`,
  `AddCartLineBody`, `SetCartLineBody`, `Drop`, `DropsPage`, `DropDetailResponse`, `DropViewerState`, `DropEntry`,
  `FollowedBrand`, `FollowResult`, `FollowsResponse`, `FollowCountsResponse`, `FollowBody`, `WishlistItem`,
  `WishlistResponse`, `SaveResult`, `WishlistBody`, `Money` — same fields and conveniences as the Swift
  ones (`coverUrl`, `tileAspectRatio`, `isSoldOut`, `isNotForSale`, `isNew`, `processingText`, `imageUrl`,
  `locationText`, `monogram`, `isLive`, `accessLabel`, …; URL conveniences return `String?`).

### Formatting (`core/Formatters.kt`, `core/models/Money.kt`)

`Formatters.price(minor, currency, showCents?)` → "$45", "$45.50", "₦12,000", "MX$640";
`MoneyFormatter.format(minor, currency, showCents, compact)`, `toMajor`; `Formatters.count(24000)` → "24K",
`compactNumber`, `grouped`; `relative(instant)` / `relative(iso)` → "3h ago", "Yesterday", "12 Nov";
`future(instant)` → "in 3h", "Tomorrow"; `shortDate`, `dateTime`, `time`; `countdown(seconds | Duration | target)` → "2d 04:12:09".

### Design system (`designsystem/`)

Type: `YardFonts.largeTitle, title, headline, body, bodyEmphasis, callout, caption, captionEmphasis, micro`,
`YardFonts.display(size)`, `YardFonts.number(size)`, `TextStyle.monospacedDigits()`,
`YardDisplayText(text, size = 34.sp)` (uppercase condensed). Metrics: `Spacing.xxs…xxxl, gutter (16),
gridGap (6), tabPillClearance`; `Radius.card (20), image (16), small (12), sheet (28)`;
`YardShapes.card, image, small, sheet, pill`; `Motion.spring(), snappy(), fade()`.

Components (`designsystem/components/`, trailing lambda = action):
- `YardButton(title, modifier, icon: ImageVector?, style = YardButtonStyle.Primary|Secondary|OnPhoto|Destructive|Ghost|Inverted, size = YardButtonSize.Large|Medium|Small, isLoading, fullWidth = true, enabled = true) { }`; `YardPillSurface(style) { custom label }`; `Modifier.pressableClick { }` (press-scale for tiles/cards)
- `Chip(title, modifier, icon, isSelected, isEnabled, count) { }`; `ChipRow { Chip(…) }` (horizontal scroll with gutters)
- `Tag(text, modifier, style = TagStyle.Neutral|Acid|Violet|Danger|Success|OnPhoto, icon)`
- `RemoteImage(url /* absolute or /api/media path */, modifier /* size it! */, contentScale = Crop, maxPixelSize = 1200, contentDescription) { failure placeholder }` — shimmer, fade-in, Coil caches (~700 px tiles, 1600 full screen)
- `MasonryGrid(products, modifier, spacing, state, contentPadding, header = { item(span = StaggeredGridItemSpan.FullLine) { … } }, footer, onLoadMore) { product -> … }` and generic `MasonryGrid(items, key = { it.id }, …)` — the grid IS the lazy scroll container; `MasonryColumns(products) { }` non-lazy for short grids inside a scrolling Column
- `MasonrySkeleton(count = 8)`, `Skeleton(modifier, cornerRadius, shape = SkeletonShape.Rounded|Circle|Capsule)`, `Modifier.shimmering()`
- `ProductTile(product, modifier, showsBrand, showsPrice, showsSaveButton, maxPixelSize = 700)` — save heart wired to SavedStore (signed-out → Sign in sheet); navigate with `Modifier.pressableClick { router.push(Route.Product(product.slug)) }`. `ProductTileDefaults.captionHeight / clampedAspect`
- `BrandAvatar(name, modifier, logoUrl, size = 40.dp, verified)`
- `PriceText(minor, currency, modifier, compareAtMinor, style, color)`, `PriceText(money = …)`, `PriceText(product = …)`
- `SectionHeader(title, modifier, subtitle, display, actionTitle) { action }` (has gutter padding)
- `GlassIconButton(icon, contentDescription, modifier, size = 40.dp, tint) { }`
- `SegmentedPill(selection, options, onSelect, modifier) { title(it) }`
- `EmptyState(title, modifier, message, icon, actionTitle) { action }`, `EmptyState.Error(error) { retry() }`, `EmptyState.Error(message = …) { }`, `EmptyState.SignedOut(message) { signIn() }`
- `Toast`, `ToastView`, `YardToastHost(center) { }` (root and route sheet already host)
- `QuantityStepper(value, modifier, range = 0..10, isBusy) { newQty -> }`
- `Card(modifier, padding = 16.dp, background) { }`, `Modifier.yardCard()`, `Modifier.yardScreenBackground()`, `YardDivider()`
- `SettingsRow(title, icon, modifier, value, tint, showsChevron) { optional accessory }`, `YardSwitch(checked, onCheckedChange)`
- `YardSheet(onDismissRequest, skipPartiallyExpanded = false) { YardSheetHeader(title, subtitle) { close } … }`
- `YardTopBar(title, back = LocalBackAction.current) { actions }` (Android-only), `LocalBackAction`
- `YardLogo(modifier.height(28.dp), color = Color.yard.acid)`, `YardLogoShape`
- `FeaturePlaceholder(title)` — placeholders only
- Icons: `androidx.compose.material.icons.Icons.Outlined.* / Filled.*` (extended set available) for SF Symbols.

### Previews

```kotlin
@Preview(name = "Orders — dark") @Composable private fun OrdersDark() = YardPreview(darkTheme = true) { OrdersListView() }
@Preview(name = "Orders — light") @Composable private fun OrdersLight() = YardPreview(darkTheme = false, signedIn = false) { OrdersListView() }
```
`YardPreview` injects all stores, router and toasts; `PreviewFixtures.products`, `.brand`, `.brandCard`,
`.shopper` are preview-only. One light and one dark preview per main screen (previews of screens that
load from the network show their loading/empty state — that's fine; preview sub-components with fixtures).

## Done means

- Every screen in your package mirrors its iOS counterpart, works in light and dark mode, has loading
  (skeleton), empty, error and (where relevant) signed-out states, uses only theme tokens and shared
  components, calls the real API, and has light + dark `@Preview`s.
- `cd android && ./gradlew :app:compileDebugKotlin` passes (and `:app:testDebugUnitTest` if you added tests).
- Write `android/Docs/<your-folder>.md` (short): screens, endpoints used, anything not mirrored or unfinished.
- Don't commit or push; the orchestrator does.
