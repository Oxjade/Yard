package space.yardstore.app.core.networking

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.InternalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.serializer
import kotlinx.serialization.serializerOrNull
import okhttp3.Call
import okhttp3.Callback
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.YardJson
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.cancellation.CancellationException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** HTTP methods the API uses. */
enum class HTTPMethod { GET, POST, PUT, PATCH, DELETE }

/** Decode target for endpoints whose body you don't need (`{ ok: true }`, 204 No Content). */
@Serializable
class EmptyResponse

/** One part of a multipart upload (`APIClient.upload`). */
sealed class MultipartPart {
    data class Field(val name: String, val value: String) : MultipartPart()
    class File(val name: String, val filename: String, val contentType: String, val bytes: ByteArray) : MultipartPart()
}

/** A query parameter list: `listOf("brand" to handle, "limit" to "24")`. Null values are skipped. */
typealias Query = List<Pair<String, String?>>

/**
 * The one HTTP client for the Yard API. Mirrors `Core/Networking/APIClient.swift`.
 *
 * - Base URL: [Config.baseUrl]; pass paths like `"/api/catalog/products"`.
 * - Headers: `X-Yard-Client: 1` on every request; `Origin` + `Content-Type: application/json`
 *   on every non-GET (the server's CSRF rule).
 * - Cookies: a persistent [CookieJar] ([PersistentCookieJar]), so the session cookie (`yard_s`)
 *   survives restarts.
 * - Errors: throws [APIError] (server `{error:{code,message,fields}}` decoded; show `.message`).
 *   Coroutine cancellation is rethrown as-is (never turned into an error toast).
 * - Timeout: 30 s.
 *
 * ```kotlin
 * val page = APIClient.shared.get<ProductsPage>("/api/catalog/products", query = listOf("limit" to "24"))
 * val r = APIClient.shared.post<FollowResult>("/api/follows", body = FollowBody(brandId = id))
 * APIClient.shared.send(HTTPMethod.DELETE, "/api/cart/lines/$id")       // ignore the response body
 * ```
 * Bodies: any `@Serializable` object, a `Map<String, Any?>` of JSON-able values, a [JsonElement]
 * or a raw JSON `String`.
 */
class APIClient(
    /** The configured OkHttp client (cookies + `X-Yard-Client`); share it for images/uploads. */
    val http: OkHttpClient,
    val json: Json = YardJson,
) {
    companion object {
        private var instance: APIClient? = null

        /** The app-wide client (installed by `YardApp`; a cookie-less fallback before that, e.g. in previews). */
        val shared: APIClient
            get() = instance ?: APIClient(buildHttpClient(CookieJar.NO_COOKIES)).also { instance = it }

        fun install(client: APIClient) {
            instance = client
        }

        /** Builds the OkHttp client Yard uses: 30 s timeouts, `X-Yard-Client: 1` on every request. */
        fun buildHttpClient(cookieJar: CookieJar): OkHttpClient = OkHttpClient.Builder()
            .cookieJar(cookieJar)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .callTimeout(60, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val request = chain.request()
                if (request.header("X-Yard-Client") != null) {
                    chain.proceed(request)
                } else {
                    chain.proceed(request.newBuilder().header("X-Yard-Client", "1").build())
                }
            }
            .build()

        private val JSON_MEDIA = "application/json".toMediaType()
    }

    // region Typed convenience

    /** GET and decode. */
    suspend inline fun <reified T> get(path: String, query: Query = emptyList()): T =
        request(HTTPMethod.GET, path, query, null)

    /** POST a JSON body and decode. */
    suspend inline fun <reified T> post(path: String, body: Any? = null, query: Query = emptyList()): T =
        request(HTTPMethod.POST, path, query, body)

    /** PUT a JSON body and decode. */
    suspend inline fun <reified T> put(path: String, body: Any? = null, query: Query = emptyList()): T =
        request(HTTPMethod.PUT, path, query, body)

    /** PATCH a JSON body and decode. */
    suspend inline fun <reified T> patch(path: String, body: Any? = null, query: Query = emptyList()): T =
        request(HTTPMethod.PATCH, path, query, body)

    /** DELETE and decode (use `send(HTTPMethod.DELETE, …)` when the response body doesn't matter). */
    suspend inline fun <reified T> delete(path: String, query: Query = emptyList()): T =
        request(HTTPMethod.DELETE, path, query, null)

    /** Any method; the response body is ignored (204s, `{ ok: true }`). Still throws [APIError]. */
    suspend fun send(method: HTTPMethod, path: String, body: Any? = null, query: Query = emptyList()) {
        data(method, path, query, body)
    }

    // endregion

    // region Core

    /** Performs the request and decodes [T]. An empty body decodes as `{}`. */
    suspend inline fun <reified T> request(method: HTTPMethod, path: String, query: Query = emptyList(), body: Any? = null): T {
        val raw = data(method, path, query, body)
        return decode(serializer<T>(), raw)
    }

    /** Decodes a raw body with the API's lenient JSON. Empty → `{}`. Throws [APIError.decoding]. */
    fun <T> decode(deserializer: KSerializer<T>, raw: String): T {
        val payload = raw.ifBlank { "{}" }
        return try {
            json.decodeFromString(deserializer, payload)
        } catch (e: Exception) {
            throw APIError.decoding(e)
        }
    }

    /** Performs the request and returns the raw body of a 2xx response; throws [APIError] otherwise. */
    suspend fun data(method: HTTPMethod, path: String, query: Query = emptyList(), body: Any? = null): String =
        execute(makeRequest(method, path, query, body))

    /** Sends a prepared request (e.g. from [makeRequest], modified) and returns the 2xx body. */
    suspend fun execute(request: Request): String {
        val response = try {
            http.newCall(request).await()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            throw APIError.network(e)
        }
        return response.use { r ->
            val text = try {
                r.body?.string().orEmpty()
            } catch (e: IOException) {
                throw APIError.network(e)
            }
            if (!r.isSuccessful) throw APIError.fromResponse(r.code, text)
            text
        }
    }

    /** POSTs (or PUTs) `multipart/form-data` and decodes [T]. */
    suspend inline fun <reified T> upload(path: String, parts: List<MultipartPart>, method: HTTPMethod = HTTPMethod.POST, query: Query = emptyList()): T {
        val raw = execute(makeMultipartRequest(method, path, parts, query))
        return decode(serializer<T>(), raw)
    }

    /** Builds a multipart request with Yard's headers (Content-Type is the multipart boundary). */
    fun makeMultipartRequest(method: HTTPMethod, path: String, parts: List<MultipartPart>, query: Query = emptyList()): Request {
        val builder = MultipartBody.Builder().setType(MultipartBody.FORM)
        for (part in parts) {
            when (part) {
                is MultipartPart.Field -> builder.addFormDataPart(part.name, part.value)
                is MultipartPart.File -> builder.addFormDataPart(
                    part.name,
                    part.filename,
                    part.bytes.toRequestBody(part.contentType.toMediaType()),
                )
            }
        }
        return Request.Builder()
            .url(buildUrl(path, query))
            .header("X-Yard-Client", "1")
            .header("Accept", "application/json")
            .header("Origin", Config.origin)
            .method(method.name, builder.build())
            .build()
    }

    /**
     * Builds a [Request] with Yard's required headers. Exposed for requests that need tweaking
     * before [execute].
     */
    fun makeRequest(method: HTTPMethod, path: String, query: Query = emptyList(), body: Any? = null): Request {
        val builder = Request.Builder()
            .url(buildUrl(path, query))
            .header("X-Yard-Client", "1")
            .header("Accept", "application/json")
        val requestBody: RequestBody? = when {
            body != null -> encodeBody(body).toRequestBody(JSON_MEDIA)
            method == HTTPMethod.POST || method == HTTPMethod.PUT || method == HTTPMethod.PATCH ->
                ByteArray(0).toRequestBody(JSON_MEDIA)
            else -> null
        }
        if (method != HTTPMethod.GET) {
            builder.header("Origin", Config.origin)
            builder.header("Content-Type", "application/json")
        }
        builder.method(method.name, if (method == HTTPMethod.GET) null else requestBody)
        return builder.build()
    }

    /** Resolves [path] against [Config.baseUrl] and appends [query] (values percent-encoded, `+` included). */
    fun buildUrl(path: String, query: Query = emptyList()): HttpUrl {
        val absolute = Config.url(path) ?: Config.baseUrl
        val base = absolute.toHttpUrlOrNull()
            ?: throw APIError(0, "bad_url", "Something went wrong. Try again.")
        val b = base.newBuilder()
        for ((name, value) in query) {
            if (value != null) b.addQueryParameter(name, value)
        }
        return b.build()
    }

    /** Encodes a request body: `@Serializable` object, Map, List, [JsonElement] or raw JSON `String`. */
    @OptIn(InternalSerializationApi::class)
    fun encodeBody(body: Any): String = when (body) {
        is String -> body
        is JsonElement -> body.toString()
        is Map<*, *>, is List<*> -> toJsonElement(body).toString()
        else -> {
            @Suppress("UNCHECKED_CAST")
            val s = body::class.serializerOrNull() as KSerializer<Any>?
                ?: throw APIError(0, "encoding", "Something went wrong. Try again.")
            json.encodeToString(s, body)
        }
    }

    private fun toJsonElement(value: Any?): JsonElement = when (value) {
        null -> JsonNull
        is JsonElement -> value
        is String -> JsonPrimitive(value)
        is Number -> JsonPrimitive(value)
        is Boolean -> JsonPrimitive(value)
        is Map<*, *> -> JsonObject(value.entries.associate { (k, v) -> k.toString() to toJsonElement(v) })
        is List<*> -> JsonArray(value.map { toJsonElement(it) })
        else -> json.parseToJsonElement(encodeBody(value))
    }

    /** Removes every cookie (used after sign-out as a belt-and-braces clear). */
    fun clearCookies() {
        (http.cookieJar as? PersistentCookieJar)?.clear()
    }

    // endregion
}

/** Suspends until the call finishes; cancels the call when the coroutine is cancelled. */
suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    enqueue(object : Callback {
        override fun onResponse(call: Call, response: Response) {
            cont.resume(response)
        }

        override fun onFailure(call: Call, e: IOException) {
            if (!cont.isCancelled) cont.resumeWithException(e)
        }
    })
    cont.invokeOnCancellation { runCatching { cancel() } }
}
