package space.yardstore.app.features.brands

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.app.Route
import space.yardstore.app.app.Router
import space.yardstore.app.core.models.YardJson
import space.yardstore.app.core.stores.FollowStore
import space.yardstore.app.core.stores.SessionStore
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.ToastCenter
import java.util.Locale

@OptIn(ExperimentalCoroutinesApi::class)
class BrandsSupportTest {
    private var savedLocale: Locale = Locale.getDefault()

    @Before fun setUp() {
        savedLocale = Locale.getDefault()
        Locale.setDefault(Locale.US)
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @After fun tearDown() {
        Locale.setDefault(savedLocale)
        Dispatchers.resetMain()
    }

    @Test fun categoryNames() {
        assertEquals("Art & design", BrandsCategory.name("art-design"))
        assertNull(BrandsCategory.name("tops"))
        assertEquals("Streetwear", BrandsCategory.firstName(listOf("tops", "streetwear", "fashion")))
        assertNull(BrandsCategory.firstName(listOf("tops")))
        assertEquals(10, BrandsCategory.order.size)
        assertTrue(BrandsCategory.order.all { BrandsCategory.names.containsKey(it) })
    }

    @Test fun placeText() {
        assertEquals("Lagos, Nigeria", BrandsPlace.text("Lagos", "NG"))
        assertEquals("Accra, Ghana", BrandsPlace.text("Accra", "gh"))
        assertEquals("Mexico", BrandsPlace.text("", "MX"))
        assertEquals("Lagos", BrandsPlace.text("Lagos", ""))
        assertEquals("Paris, France Métropole", BrandsPlace.text("Paris", "France Métropole"))
        assertEquals("", BrandsPlace.text("", ""))
    }

    @Test fun storefrontExtrasDecoding() {
        val withStory = YardJson.decodeFromString(BrandsStorefrontExtras.serializer(), """
            {"brand": {"id": "brd_1", "name": "Acme", "story": "Cut in Lagos.", "categories": ["fashion"]}, "storefront": null, "collections": []}
        """)
        assertEquals("Cut in Lagos.", withStory.brand?.story)
        val noStory = YardJson.decodeFromString(BrandsStorefrontExtras.serializer(), """{"brand": {"id": "brd_1", "story": null}}""")
        assertNull(noStory.brand?.story)
        val noBrand = YardJson.decodeFromString(BrandsStorefrontExtras.serializer(), """{"brand": null}""")
        assertNull(noBrand.brand)
    }

    @Test fun profileTabsMirrorIOS() {
        assertEquals(listOf("Products", "Collections", "Drops"), BrandProfileTab.entries.map { it.title })
        assertEquals(listOf("A–Z", "New on Yard"), BrandsDirectoryModel.Sort.entries.map { it.title })
        assertEquals(listOf("name", "new"), BrandsDirectoryModel.Sort.entries.map { it.raw })
    }

    @Test fun followSignedOutPresentsSignIn() = runBlocking {
        val router = Router()
        val toast = ToastCenter()
        val result = BrandsFollow.toggle("brd_1", "Acme", SessionStore.preview(signedIn = false), FollowStore.preview(), router, toast)
        assertNull(result)
        assertEquals(Route.SignIn, router.sheet)
        assertNull(toast.current)
    }

    @Test fun followSignedInTogglesAndToasts() = runBlocking {
        val t = BrandsTestServer()
        t.start()
        try {
            t.json("/api/follows", """{"brandId": "brd_1", "following": true, "followers": 12}""")
            val follows = FollowStore(t.api)
            val toast = ToastCenter()
            val result = BrandsFollow.toggle("brd_1", "Acme", SessionStore.preview(signedIn = true), follows, Router(), toast)
            assertEquals(12, result?.followers)
            assertTrue(follows.isFollowing("brd_1"))
            assertEquals("Following Acme", toast.current?.message)
            assertEquals(Toast.Style.Success, toast.current?.style)

            t.json("/api/follows/brd_1", """{"brandId": "brd_1", "following": false, "followers": 11}""")
            val off = BrandsFollow.toggle("brd_1", "Acme", SessionStore.preview(signedIn = true), follows, Router(), ToastCenter())
            assertFalse(off!!.following)
            assertEquals("DELETE", t.requestsTo("/api/follows/brd_1").single().method)
        } finally {
            t.shutdown()
        }
    }

    @Test fun followErrorRollsBackAndToastsServerMessage() = runBlocking {
        val t = BrandsTestServer()
        t.start()
        try {
            t.json("/api/follows", """{"error":{"code":"rate_limited","message":"Slow down a little."}}""", code = 429)
            val follows = FollowStore(t.api)
            val toast = ToastCenter()
            val result = BrandsFollow.toggle("brd_1", "Acme", SessionStore.preview(signedIn = true), follows, Router(), toast)
            assertNull(result)
            assertFalse(follows.isFollowing("brd_1"))
            assertEquals("Slow down a little.", toast.current?.message)
            assertEquals(Toast.Style.Error, toast.current?.style)
        } finally {
            t.shutdown()
        }
    }
}
