package space.yardstore.app.features.you

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import okhttp3.CookieJar
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.models.YardJson
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import java.util.Collections
import kotlin.math.abs

/** Settings › Your details › Photo: crop math, the upload request, error copy and the section's state (docs/APP.md › Profile photo). */
@OptIn(ExperimentalCoroutinesApi::class)
class YouPhotoTest {
    private val server = MockWebServer()
    private val requests: MutableList<RecordedRequest> = Collections.synchronizedList(mutableListOf())
    private val routes = Collections.synchronizedMap(LinkedHashMap<String, ArrayDeque<MockResponse>>())
    private lateinit var api: APIClient
    private lateinit var root: String

    private fun on(method: String, path: String, status: Int = 200, body: String = "", headers: Map<String, String> = emptyMap()) {
        val r = MockResponse().setResponseCode(status).setHeader("Content-Type", "application/json").setBody(body)
        headers.forEach { (k, v) -> r.setHeader(k, v) }
        routes.getOrPut("$method $path") { ArrayDeque() }.addLast(r)
    }

    @Before fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests += request
                val queue = routes["${request.method} ${request.requestUrl!!.encodedPath}"]
                    ?: return MockResponse().setResponseCode(404).setBody("""{"error":{"code":"not_found","message":"Not found."}}""")
                return synchronized(queue) { if (queue.size > 1) queue.removeFirst() else queue.first() }
            }
        }
        server.start()
        api = APIClient(APIClient.buildHttpClient(CookieJar.NO_COOKIES))
        root = server.url("").toString().trimEnd('/')
    }

    @After fun tearDown() {
        server.shutdown()
        Dispatchers.resetMain()
    }

    private fun account(photo: String = "null", demo: Boolean = false) =
        """{ "account": { "name": "Ada Nwosu", "email": "ada@example.com", "emailVerified": true, "hasPassword": true,
            "signInProviders": [], "pendingEmail": null, "demo": $demo, "photo": $photo } }"""

    private val photoJson = """{ "mediaId": "med_2", "src": "/api/media/med_2?as=shopper", "width": 1024, "height": 1024 }"""

    private fun error(code: String, message: String) = """{ "error": { "code": "$code", "message": "$message" } }"""

    private fun near(expected: Float, actual: Float, eps: Float = 0.01f) =
        assertTrue("expected $expected, got $actual", abs(expected - actual) <= eps)

    private fun nearSquare(expected: YouCropSquare, actual: YouCropSquare) {
        near(expected.sx, actual.sx, 0.01f)
        near(expected.sy, actual.sy, 0.01f)
        near(expected.size, actual.size, 0.01f)
    }

    private suspend fun idle(model: YouPhotoModel) = withTimeout(5_000) {
        while (model.busy != null) delay(10)
    }

    // region Crop math (same numbers as src/lib/media/photo-crop.ts)

    private val landscape = YouCropSize(2000f, 1000f)

    @Test fun zoomOneCoversTheFrameWithTheShortSide() {
        near(0.3f, YouPhotoCrop.displayScale(landscape, 300f, 1f), 0.0001f) // 1000 px → 300
        near(1.2f, YouPhotoCrop.displayScale(landscape, 300f, 4f), 0.0001f)
        // Zoom is clamped to 1…4 (and NaN → 1).
        near(0.3f, YouPhotoCrop.displayScale(landscape, 300f, 0.2f), 0.0001f)
        near(1.2f, YouPhotoCrop.displayScale(landscape, 300f, 9f), 0.0001f)
        assertEquals(1f, YouPhotoCrop.clampZoom(Float.NaN))
    }

    @Test fun offsetNeverUncoversTheFrame() {
        // At zoom 1 the 2000×1000 photo is 600×300 in a 300 frame: it can move ±150 sideways, 0 up/down.
        assertEquals(YouCropOffset(150f, 0f), YouPhotoCrop.clampOffset(landscape, 300f, 1f, YouCropOffset(999f, 50f)))
        assertEquals(YouCropOffset(-150f, 0f), YouPhotoCrop.clampOffset(landscape, 300f, 1f, YouCropOffset(-999f, -50f)))
        // Zoom 2: 1200×600 → ±450, ±150.
        assertEquals(YouCropOffset(450f, -150f), YouPhotoCrop.clampOffset(landscape, 300f, 2f, YouCropOffset(1000f, -1000f)))
        assertEquals(YouCropOffset.Zero, YouPhotoCrop.clampOffset(landscape, 300f, 1f, YouCropOffset(Float.NaN, Float.POSITIVE_INFINITY)))
    }

    @Test fun sourceSquareFollowsTheOffset() {
        // Centred: the middle 1000×1000.
        nearSquare(YouCropSquare(500f, 0f, 1000f), YouPhotoCrop.sourceSquare(landscape, 300f, 1f, YouCropOffset.Zero))
        // Dragged fully right (photo moves right) → the left edge of the photo shows.
        nearSquare(YouCropSquare(0f, 0f, 1000f), YouPhotoCrop.sourceSquare(landscape, 300f, 1f, YouCropOffset(150f, 0f)))
        nearSquare(YouCropSquare(1000f, 0f, 1000f), YouPhotoCrop.sourceSquare(landscape, 300f, 1f, YouCropOffset(-150f, 0f)))
        // Zoom 2: a 500 px square around the centre.
        nearSquare(YouCropSquare(750f, 250f, 500f), YouPhotoCrop.sourceSquare(landscape, 300f, 2f, YouCropOffset.Zero))
    }

    @Test fun outputIsAtMost1024AndNeverUpscaled() {
        assertEquals(1024, YouPhotoCrop.outputSide(3000f))
        assertEquals(500, YouPhotoCrop.outputSide(500.4f))
        assertEquals(1, YouPhotoCrop.outputSide(0f))
    }

    @Test fun zoomKeepsTheCentrePoint() {
        val from = YouCropState(1f, YouCropOffset(100f, 0f))
        val to = YouPhotoCrop.zoomTo(landscape, 300f, from, 2f)
        assertEquals(2f, to.zoom)
        assertEquals(YouCropOffset(200f, 0f), to.offset)
        // The same image point stays under the frame centre.
        val before = YouPhotoCrop.sourceSquare(landscape, 300f, from.zoom, from.offset)
        val after = YouPhotoCrop.sourceSquare(landscape, 300f, to.zoom, to.offset)
        near(before.sx + before.size / 2, after.sx + after.size / 2, 0.5f)
        // Zooming out past 1 clamps both zoom and offset.
        assertEquals(YouCropState(1f, YouCropOffset(150f, 0f)), YouPhotoCrop.zoomTo(landscape, 300f, YouCropState(4f, YouCropOffset(800f, 0f)), 0.5f))
    }

    @Test fun pinchKeepsThePointUnderTheFingers() {
        val img = YouCropSize(1000f, 1000f)
        val frame = 300f
        val from = YouCropState(2f, YouCropOffset.Zero)
        val focus = YouCropOffset(60f, -40f) // fingers right of and above the centre
        val to = YouPhotoCrop.gesture(img, frame, from, 1.5f, focus, YouCropOffset.Zero)
        assertEquals(3f, to.zoom)
        // Image pixel under the focus, before and after.
        fun imagePoint(s: YouCropState): Pair<Float, Float> {
            val k = YouPhotoCrop.displayScale(img, frame, s.zoom)
            return (focus.x - s.offset.x) / k to (focus.y - s.offset.y) / k
        }
        val (bx, by) = imagePoint(from)
        val (ax, ay) = imagePoint(to)
        near(bx, ax)
        near(by, ay)
        // A plain drag moves by the pan, clamped.
        assertEquals(YouCropOffset(150f, 0f), YouPhotoCrop.gesture(img, frame, YouCropState(2f, YouCropOffset(140f, 0f)), 1f, YouCropOffset.Zero, YouCropOffset(40f, 0f)).offset)
        // A bad factor is ignored.
        assertEquals(2f, YouPhotoCrop.gesture(img, frame, from, Float.NaN, focus, YouCropOffset.Zero).zoom)
    }

    @Test fun pickedFileChecksMatchTheWebsite() {
        assertNull(YouPhotoCrop.fileProblem("image/jpeg", 1_000))
        assertNull(YouPhotoCrop.fileProblem("image/png", null))
        assertNull(YouPhotoCrop.fileProblem("image/heic", 2_000))
        assertNull(YouPhotoCrop.fileProblem("application/octet-stream", 2_000, "IMG_1.HEIC"))
        assertEquals("Use a JPEG, PNG or WebP photo.", YouPhotoCrop.fileProblem("image/gif", 10))
        assertEquals("Use a JPEG, PNG or WebP photo.", YouPhotoCrop.fileProblem(null, 10))
        assertEquals("Photos can be up to 10 MB.", YouPhotoCrop.fileProblem("image/webp", 10L * 1024 * 1024 + 1))
        assertNull(YouPhotoCrop.fileProblem("image/webp", 10L * 1024 * 1024))
        assertEquals("This file is empty.", YouPhotoCrop.fileProblem("image/jpeg", 0))
    }

    @Test fun decodeStepKeepsTheLongSideUnder4096() {
        assertEquals(1, YouPhotoCrop.sampleSize(4000, 3000))
        assertEquals(1, YouPhotoCrop.sampleSize(4096, 100))
        assertEquals(2, YouPhotoCrop.sampleSize(8000, 6000))
        assertEquals(4, YouPhotoCrop.sampleSize(12000, 9000))
    }

    @Test fun waitsReadLikeTheWebsite() {
        assertEquals("40 s", youFormatWait(40))
        assertEquals("1 s", youFormatWait(0))
        assertEquals("3 min", youFormatWait(180))
        assertEquals("2 h", youFormatWait(7200))
    }

    @Test fun initialsUseTheFirstTwoWords() {
        assertEquals("AN", youInitials("Ada  Nwosu Obi"))
        assertEquals("Y", youInitials("  "))
    }

    // endregion

    // region Request

    @Test fun uploadRequestIsOneFilePartWithALengthAndTheWriteHeaders() {
        val jpeg = ByteArray(2048) { it.toByte() }
        val request = youPhotoUploadRequest(api, root, jpeg)
        assertEquals("POST", request.method)
        assertEquals("/api/account/photo", request.url.encodedPath)
        assertEquals("shopper", request.url.queryParameter("as"))
        assertEquals("1", request.header("X-Yard-Client"))
        assertNotNull(request.header("Origin"))
        val body = request.body!!
        assertTrue(body.contentType().toString().startsWith("multipart/form-data; boundary="))
        val buffer = Buffer().also { body.writeTo(it) }
        // A known length (OkHttp sends Content-Length; the server answers 411 to chunked bodies).
        assertEquals(buffer.size, body.contentLength())
        val text = buffer.snapshot().utf8()
        assertEquals(1, Regex("Content-Disposition: form-data").findAll(text).count())
        assertTrue(text.contains("""Content-Disposition: form-data; name="file"; filename="photo.jpg""""))
        assertTrue(text.contains("Content-Type: image/jpeg"))
    }

    @Test fun progressWrapperKeepsLengthAndReportsToTheEnd() {
        val seen = mutableListOf<Float>()
        val body = youPhotoUploadRequest(api, root, ByteArray(200_000)) { seen += it }.body!!
        val plain = youPhotoUploadRequest(api, root, ByteArray(200_000)).body!!
        assertEquals(plain.contentLength(), body.contentLength())
        assertEquals(plain.contentType().toString().substringBefore(";"), body.contentType().toString().substringBefore(";"))
        body.writeTo(Buffer())
        assertTrue(seen.isNotEmpty() && seen.size <= 52)
        assertEquals(1f, seen.last())
        assertEquals(seen.sorted(), seen)
    }

    @Test fun uploadSendsContentLengthAndDecodesTheAccount() = runBlocking {
        on("POST", "/api/account/photo", body = account(photo = photoJson))
        var last = 0f
        val a = youUploadAccountPhoto(api, root, ByteArray(4096) { 7 }) { last = it }
        assertEquals(YouAccountPhoto("med_2", "/api/media/med_2?as=shopper", 1024, 1024), a.photo)
        assertEquals(1f, last)
        val r = requests.single()
        assertEquals("shopper", r.requestUrl!!.queryParameter("as"))
        assertNotNull(r.getHeader("Content-Length"))
        assertNull(r.getHeader("Transfer-Encoding"))
        assertEquals(r.bodySize, r.getHeader("Content-Length")!!.toLong())
    }

    @Test fun decodesTheAccountPhoto() {
        assertEquals("/api/media/med_2?as=shopper", YardJson.decodeFromString<YouAccountResponse>(account(photo = photoJson)).account.photo?.src)
        assertNull(YardJson.decodeFromString<YouAccountResponse>(account()).account.photo)
    }

    // endregion

    // region Errors

    @Test fun documentedErrorsReadLikeTheWebsite() = runBlocking {
        suspend fun problemFor(status: Int, body: String, headers: Map<String, String> = emptyMap()): YouPhotoProblem {
            routes.clear()
            on("POST", "/api/account/photo", status, body, headers)
            return try {
                youUploadAccountPhoto(api, root, ByteArray(10)) {}
                error("expected a failure")
            } catch (e: Exception) {
                youPhotoUploadProblem(e)
            }
        }
        assertEquals(YouPhotoProblem("Photos can be up to 10 MB."), problemFor(413, error("too_large", "This file is too large. The limit here is 10 MB.")))
        assertEquals(
            YouPhotoProblem("Yard couldn't read this as a JPEG, PNG or WebP photo. Try another one."),
            problemFor(415, error("unsupported_type", "Yard couldn't read this as a JPEG, PNG or WebP photo.")),
        )
        assertEquals(YouPhotoProblem("Demo accounts can't change their photo."), problemFor(422, error("rule", "Demo accounts can't change their photo.")))
        assertEquals(
            YouPhotoProblem("This photo is smaller than 64 px on a side. Use a larger one."),
            problemFor(422, error("rule", "This photo is smaller than 64 px on a side. Use a larger one.")),
        )
        assertEquals(
            YouPhotoProblem("You've changed your photo a lot. Try again in 2 min.", retry = true),
            problemFor(429, error("rate_limited", "Too many requests."), mapOf("Retry-After" to "120")),
        )
        assertEquals("You've changed your photo a lot. Try again in 10 min.", problemFor(429, error("rate_limited", "Slow down.")).text)
        val signedOut = problemFor(401, error("unauthorized", "Sign in to continue."))
        assertTrue(signedOut.signIn)
        assertFalse(signedOut.retry)
        assertEquals("Sign in to continue.", signedOut.text)
        assertTrue(problemFor(503, "").retry)
        assertEquals(YouPhotoProblem("Photos can be up to 10 MB."), problemFor(413, "")) // a proxy's bare 413
    }

    @Test fun networkFailureCanBeRetried() {
        val p = youPhotoUploadProblem(APIError(0, "network", "You're offline. Check your connection and try again."))
        assertTrue(p.retry)
        assertEquals("You're offline. Check your connection and try again.", p.text)
        assertEquals(YouPhotoProblem("Your photo wasn't saved. Try again.", retry = true), youPhotoUploadProblem(IllegalStateException()))
        assertEquals(YouPhotoProblem("Your photo wasn't removed. Try again."), youPhotoRemoveProblem(IllegalStateException()))
    }

    // endregion

    // region State

    @Test fun saveIsOptimisticAndClearsOnSuccess() = runBlocking {
        on("POST", "/api/account/photo", body = account(photo = photoJson))
        val model = YouPhotoModel(api, root)
        var saved: YouAccount? = null
        model.save(ByteArray(64), preview = null) { saved = it }
        // The cropped photo shows while it uploads.
        assertTrue(model.pending != null || saved != null)
        idle(model)
        assertNull(model.pending)
        assertNull(model.problem)
        assertEquals("med_2", saved?.photo?.mediaId)
        model.onCleared()
    }

    @Test fun failedUploadKeepsThePhotoToRetryOrDiscard() = runBlocking {
        on("POST", "/api/account/photo", 503, error("unavailable", "Yard is having trouble right now. Try again in a moment."))
        on("POST", "/api/account/photo", body = account(photo = photoJson))
        val model = YouPhotoModel(api, root)
        var saved: YouAccount? = null
        model.save(ByteArray(64), preview = null) { saved = it }
        idle(model)
        assertNotNull(model.pending)
        assertEquals(YouPhotoProblem("Yard is having trouble right now. Try again in a moment.", retry = true), model.problem)
        assertNull(saved)
        model.retry { saved = it }
        idle(model)
        assertNull(model.pending)
        assertNull(model.problem)
        assertNotNull(saved)
        // Discard after a failure brings back the saved photo.
        routes.clear()
        on("POST", "/api/account/photo", 415, error("unsupported_type", "Nope."))
        model.save(ByteArray(8), preview = null) {}
        idle(model)
        assertNotNull(model.pending)
        assertFalse(model.problem!!.retry)
        model.discard()
        assertNull(model.pending)
        assertNull(model.problem)
        model.onCleared()
    }

    @Test fun removeAndDemoRefusal() = runBlocking {
        on("DELETE", "/api/account/photo", body = account())
        val model = YouPhotoModel(api, root)
        assertNull(model.removeNow()!!.photo)
        assertEquals("shopper", requests.last().requestUrl!!.queryParameter("as"))
        routes.clear()
        on("DELETE", "/api/account/photo", 422, error("rule", "Demo accounts can't change their photo."))
        assertNull(model.removeNow())
        assertEquals(YouPhotoProblem("Demo accounts can't change their photo."), model.problem)
        model.clearProblem()
        assertNull(model.problem)
    }

    @Test fun pickProblemsAndCropCancel() {
        val model = YouPhotoModel(api, root)
        model.opening()
        assertTrue(model.isOpening)
        model.choose(YouPhotoPick.Problem("This photo is smaller than 64 px on a side. Use a larger one."))
        assertFalse(model.isOpening)
        assertEquals("This photo is smaller than 64 px on a side. Use a larger one.", model.problem?.text)
        model.cancelCrop()
        assertNull(model.picked)
        model.reset()
        assertNull(model.problem)
    }

    @Test fun bindResetsOnlyWhenTheShopperChanges() {
        val model = YouPhotoModel(api, root)
        model.bind("sh_1")
        model.previewState(null, failed = YouPhotoProblem("Your photo wasn't saved. Try again.", retry = true))
        // A fresh composition after an activity recreation binds the same shopper again: kept.
        model.bind("sh_1")
        assertNotNull(model.pending)
        assertNotNull(model.problem)
        // Another account (or signed out): forgotten.
        model.bind("sh_2")
        assertNull(model.pending)
        assertNull(model.problem)
        model.previewState(null, failed = YouPhotoProblem("x"))
        model.bind(null)
        assertNull(model.pending)
    }

    // endregion
}

/** `ViewModel.onCleared` is protected; tests end the model's scope through this. */
private fun YouPhotoModel.onCleared() = reset()
