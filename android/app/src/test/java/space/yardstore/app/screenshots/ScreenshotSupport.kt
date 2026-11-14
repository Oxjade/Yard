package space.yardstore.app.screenshots

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import androidx.compose.runtime.Composable
import androidx.compose.runtime.currentComposer
import coil3.ImageLoader
import coil3.SingletonImageLoader
import coil3.asImage
import coil3.decode.DataSource
import coil3.intercept.Interceptor
import coil3.request.ImageResult
import coil3.request.SuccessResult
import coil3.request.crossfade
import kotlinx.serialization.encodeToString
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.BrandCard
import space.yardstore.app.core.models.BrandsPage
import space.yardstore.app.core.models.Cart
import space.yardstore.app.core.models.CartGroup
import space.yardstore.app.core.models.DropsPage
import space.yardstore.app.core.models.FollowsResponse
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.ProductImage
import space.yardstore.app.core.models.ProductsPage
import space.yardstore.app.core.models.Session
import space.yardstore.app.core.models.WishlistItem
import space.yardstore.app.core.models.WishlistResponse
import space.yardstore.app.core.models.YardJson
import space.yardstore.app.designsystem.PreviewFixtures
import space.yardstore.app.features.charts.ChartsFiltersPreview
import space.yardstore.app.features.charts.ChartsPreviewData
import space.yardstore.app.features.drops.DropsPreviewFixtures
import space.yardstore.app.features.home.HomeCategoriesResponse
import space.yardstore.app.features.home.HomeCategory
import space.yardstore.app.features.home.HomeInboxUnread
import space.yardstore.app.features.home.HomeNotificationsResponse
import space.yardstore.app.features.inbox.InboxConversation
import space.yardstore.app.features.inbox.InboxConversationsPage
import space.yardstore.app.features.you.YouSecurity

// Screenshot-test plumbing: a fake Yard backend (MockWebServer), a fake Coil image pipeline and
// reflection helpers that reach the feature agents' private preview fixtures/composables.
// Everything here is test-only; nothing touches the real network.

/**
 * The live API, faked: every screen (and every store) that calls `APIClient` gets these
 * preview fixtures as JSON. Unknown paths answer 404 like the real API, so a screen shows its
 * honest empty/error state rather than hanging.
 */
object FakeYardBackend {
    private inline fun <reified T> json(value: T): MockResponse =
        MockResponse().setResponseCode(200).setHeader("Content-Type", "application/json").setBody(YardJson.encodeToString(value))

    private val notFound: MockResponse
        get() = MockResponse().setResponseCode(404).setHeader("Content-Type", "application/json")
            .setBody("""{"error":{"code":"not_found","message":"Not found."}}""")

    /** Fixture products with a distinct (fake) image path each, so tiles get different "photos". */
    val products: List<Product> = PreviewFixtures.products.mapIndexed { i, p ->
        p.copy(images = p.images.map { img: ProductImage -> img.copy(src = "/media/fake-product-$i.jpg") })
    }

    val brands: List<BrandCard> = listOf(
        PreviewFixtures.brandCard.copy(coverSrc = "/media/fake-brand-0.jpg"),
        BrandCard(id = "brd_2", handle = "night-shift", name = "Night Shift", city = "Accra", country = "GH", categories = listOf("streetwear"), story = "Outerwear for long nights.", coverSrc = "/media/fake-brand-1.jpg", verified = true),
        BrandCard(id = "brd_3", handle = "blue-hour", name = "Blue Hour", city = "Nairobi", country = "KE", categories = listOf("denim"), story = "Raw denim, sewn slowly.", coverSrc = "/media/fake-brand-2.jpg"),
        BrandCard(id = "brd_4", handle = "kumasi", name = "Kumasi Thread Co.", city = "Kumasi", country = "GH", categories = listOf("tops"), coverSrc = "/media/fake-brand-3.jpg", founding = true, foundingBadge = true, forSale = false),
        BrandCard(id = "brd_5", handle = "lagos-uniform", name = "Lagos Uniform", city = "Lagos", country = "NG", categories = listOf("fashion"), coverSrc = "/media/fake-brand-4.jpg", verified = true),
        BrandCard(id = "brd_6", handle = "dune", name = "Dune Studio", city = "Dakar", country = "SN", categories = listOf("accessories"), coverSrc = "/media/fake-brand-5.jpg"),
    )

    /** The bag preview cart, with the per-brand `groups` the real API always sends (the fixture omits them). */
    val cart: Cart
        get() {
            val c = Reflect.objectProperty("space.yardstore.app.features.bag.BagPreviewData", "cart") as Cart
            if (c.groups.isNotEmpty()) return c
            return c.copy(groups = c.lines.groupBy { it.brandId }.map { (brandId, lines) ->
                CartGroup(brandId = brandId.orEmpty(), variantIds = lines.map { it.variantId }, subtotalMinor = lines.sumOf { it.lineMinor })
            })
        }

    private val inboxRows: List<InboxConversation>
        @Suppress("UNCHECKED_CAST")
        get() = Reflect.objectProperty("space.yardstore.app.features.inbox.InboxPreviewData", "rows") as List<InboxConversation>

    fun respond(request: RecordedRequest): MockResponse {
        val url = request.requestUrl ?: return notFound
        val path = url.encodedPath
        return when {
            path == "/api/session" -> json(Session(shopper = PreviewFixtures.shopper))
            path == "/api/cart" -> json(cart)
            path == "/api/follows" -> json(FollowsResponse())
            path == "/api/wishlist" -> json(WishlistResponse(products.take(6).map { WishlistItem(productId = it.id, brandId = it.brandId, title = it.title, slug = it.slug, brandName = "Acme Studio") }))
            path == "/api/catalog/categories" -> json(HomeCategoriesResponse(listOf(HomeCategory("tops", "Tops", 12), HomeCategory("outerwear", "Outerwear", 8), HomeCategory("accessories", "Accessories", 5))))
            path == "/api/catalog/products" -> {
                val ids = url.queryParameterValues("ids").filterNotNull()
                val list = if (ids.isEmpty()) products else products.filter { it.id in ids }
                json(ProductsPage(products = list, total = list.size, nextOffset = null))
            }
            path == "/api/catalog/brands" -> {
                val list = if (url.queryParameter("founding") == "1") brands.filter { it.founding } else brands
                json(BrandsPage(brands = list, total = list.size, nextOffset = null))
            }
            path == "/api/drops" -> when (url.queryParameter("phase")) {
                "live" -> json(DropsPage(listOf(DropsPreviewFixtures.live)))
                "upcoming" -> json(DropsPage(listOf(DropsPreviewFixtures.upcoming, DropsPreviewFixtures.tomorrow)))
                else -> json(DropsPage(listOf(DropsPreviewFixtures.live, DropsPreviewFixtures.upcoming, DropsPreviewFixtures.past)))
            }
            path == "/api/notifications" -> json(HomeNotificationsResponse(listOf(HomeNotificationsResponse.Item("n1", read = false), HomeNotificationsResponse.Item("n2", read = false))))
            path == "/api/inbox/unread" -> json(HomeInboxUnread(conversations = 2))
            path == "/api/inbox/conversations" -> json(InboxConversationsPage(items = inboxRows))
            path == "/api/charts/scopes" -> json(ChartsFiltersPreview.scopes)
            path == "/api/charts" -> json(ChartsPreviewData.board)
            path == "/api/auth/security" -> json(YouSecurity(method = "password", emailVerified = true, hasPassword = true))
            else -> notFound
        }
    }

    /** Starts a server and points `Config.baseUrl` (hence every `APIClient`) at it. */
    fun start(context: Context): MockWebServer {
        val server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = respond(request)
        }
        server.start()
        Config.init(context)
        context.getSharedPreferences(Config.PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(Config.BASE_URL_OVERRIDE_KEY, server.url("/").toString().trimEnd('/'))
            .commit()
        return server
    }
}

/**
 * Coil without a network: every image request succeeds at once with a soft two-tone gradient
 * picked from the URL, so tiles look like photos and each one differs.
 */
object FakeImages {
    private val palettes = listOf(
        0xFF2B2B2B.toInt() to 0xFF8A8A8A.toInt(),
        0xFF3D2C22.toInt() to 0xFFC7A98B.toInt(),
        0xFF1F2A36.toInt() to 0xFF7E9BB8.toInt(),
        0xFF2E3A2A.toInt() to 0xFFA4B48E.toInt(),
        0xFF3A2236.toInt() to 0xFFC49BBE.toInt(),
        0xFF403A26.toInt() to 0xFFD9CB8F.toInt(),
    )

    fun photo(key: String, width: Int = 480, height: Int = 600): Bitmap {
        val (dark, light) = palettes[(key.hashCode() and Int.MAX_VALUE) % palettes.size]
        val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.shader = LinearGradient(0f, 0f, width.toFloat(), height.toFloat(), light, dark, Shader.TileMode.CLAMP)
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
        paint.shader = RadialGradient(width * 0.5f, height * 0.42f, width * 0.36f, 0x55FFFFFF, 0x00FFFFFF, Shader.TileMode.CLAMP)
        canvas.drawCircle(width * 0.5f, height * 0.42f, width * 0.36f, paint)
        return bmp
    }

    fun install(context: Context) {
        val loader = ImageLoader.Builder(context)
            .components {
                add(object : Interceptor {
                    override suspend fun intercept(chain: Interceptor.Chain): ImageResult = SuccessResult(
                        image = photo(chain.request.data.toString()).asImage(),
                        request = chain.request.newBuilder().crossfade(false).build(),
                        dataSource = DataSource.MEMORY_CACHE,
                    )
                })
            }
            .crossfade(false)
            .build()
        SingletonImageLoader.setUnsafe(loader)
    }
}

/** Reflection into the features' private preview fixtures and composables (same module, test-only). */
object Reflect {
    /** A property of a (possibly private) Kotlin `object`. */
    fun objectProperty(className: String, property: String): Any? {
        val cls = Class.forName(className)
        val instance = cls.getDeclaredField("INSTANCE").apply { isAccessible = true }.get(null)
        val getter = cls.getDeclaredMethod("get" + property.replaceFirstChar { it.uppercase() }).apply { isAccessible = true }
        return getter.invoke(instance)
    }

    /** A (possibly private) top-level non-composable function in a file class, e.g. `CheckoutViewKt`. */
    fun call(fileClass: String, name: String, vararg args: Any?): Any? {
        val m = Class.forName(fileClass).declaredMethods.first { it.name == name && it.parameterCount == args.size }
        m.isAccessible = true
        return m.invoke(null, *args)
    }

    /**
     * Calls a (possibly private) top-level `@Composable` function with ALL its parameters given
     * (the Compose compiler appends `Composer`, `$changed` and, with defaults, `$default`).
     */
    @Composable
    fun PrivateComposable(fileClass: String, name: String, vararg args: Any?) {
        val m = Class.forName(fileClass).declaredMethods.first {
            it.name == name && it.parameterCount > args.size && it.parameterTypes[args.size] == androidx.compose.runtime.Composer::class.java
        }
        m.isAccessible = true
        val ints = Array<Any?>(m.parameterCount - args.size - 1) { 0 }
        m.invoke(null, *args, currentComposer, *ints)
    }
}
