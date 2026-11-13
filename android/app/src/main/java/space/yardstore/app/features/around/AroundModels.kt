package space.yardstore.app.features.around

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Checkroom
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.ui.graphics.vector.ImageVector
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.YardJson

// YARD Around models (website: src/lib/api/contracts/around.ts, src/server/around/dto.ts).
// Mirrors ios/Yard/Features/Around/AroundModels.swift.
//
//   GET /api/around/places?scope=world            → AroundPlacesResponse { places, scope }
//   GET /api/around/places/{id}                   → AroundPlaceDetailResponse { place }
//
// Everything is decoded leniently (YardJson + defaults) so one odd field never blanks the map.

/** The four kinds of place (`LOCATION_KINDS`). Unknown values fall back to [Store]. */
@Serializable
enum class AroundPlaceKind {
    @SerialName("store") Store,
    @SerialName("showroom") Showroom,
    @SerialName("popup") Popup,
    @SerialName("exhibition") Exhibition;

    val label: String
        get() = when (this) {
            Store -> "Store"
            Showroom -> "Showroom"
            Popup -> "Pop-up"
            Exhibition -> "Exhibition"
        }

    val plural: String
        get() = when (this) {
            Store -> "Stores"
            Showroom -> "Showrooms"
            Popup -> "Pop-ups"
            Exhibition -> "Exhibitions"
        }

    /** Pop-ups and exhibitions run between dates; stores and showrooms have opening hours. */
    val isDated: Boolean get() = this == Popup || this == Exhibition

    /** iOS `systemImage` (storefront, hanger, sparkles, photo.on.rectangle). */
    val icon: ImageVector
        get() = when (this) {
            Store -> Icons.Outlined.Storefront
            Showroom -> Icons.Outlined.Checkroom
            Popup -> Icons.Outlined.AutoAwesome
            Exhibition -> Icons.Outlined.PhotoLibrary
        }
}

/** Event kinds (`LOCATION_EVENT_KINDS`). Unknown values fall back to [Other]. */
@Serializable
enum class AroundEventKind {
    @SerialName("drop_launch") DropLaunch,
    @SerialName("promotion") Promotion,
    @SerialName("exhibition") Exhibition,
    @SerialName("talk") Talk,
    @SerialName("sale") Sale,
    @SerialName("popup_day") PopupDay,
    @SerialName("other") Other;

    val label: String
        get() = when (this) {
            DropLaunch -> "Drop launch"
            Promotion -> "Promotion"
            Exhibition -> "Exhibition"
            Talk -> "Talk"
            Sale -> "Sale"
            PopupDay -> "Pop-up day"
            Other -> "Event"
        }
}

@Serializable
data class AroundBrand(
    val id: String,
    val handle: String = id,
    val name: String = "A Yard brand",
    val verified: Boolean = false,
)

@Serializable
data class AroundImage(
    val src: String = "",
    val alt: String = "",
    val width: Double? = null,
    val height: Double? = null,
) {
    val url: String? get() = Config.url(src)
}

/**
 * Weekly opening hours: day key ("mon"…"sun") → ranges of ["10:00", "19:00"]. A missing or null
 * day is closed.
 */
@Serializable(with = AroundHoursSerializer::class)
data class AroundHours(val days: Map<String, List<List<String>>>) {
    fun ranges(day: String): List<List<String>> = days[day].orEmpty()

    val hasAny: Boolean get() = dayKeys.any { ranges(it).isNotEmpty() }

    /** "10:00–19:00", "10:00–14:00, 15:00–19:00" or "Closed". */
    fun label(day: String): String {
        val r = ranges(day)
        if (r.isEmpty()) return "Closed"
        return r.joinToString(", ") { "${it[0]}–${it[1]}" }
    }

    companion object {
        val dayKeys: List<String> = listOf("mon", "tue", "wed", "thu", "fri", "sat", "sun")
        val dayLabels: Map<String, String> = mapOf(
            "mon" to "Monday", "tue" to "Tuesday", "wed" to "Wednesday", "thu" to "Thursday",
            "fri" to "Friday", "sat" to "Saturday", "sun" to "Sunday",
        )
        val dayShort: Map<String, String> = mapOf(
            "mon" to "Mon", "tue" to "Tue", "wed" to "Wed", "thu" to "Thu", "fri" to "Fri", "sat" to "Sat", "sun" to "Sun",
        )
    }
}

/** Lenient hours decoding: each day is read on its own; anything odd for a day means closed. */
object AroundHoursSerializer : KSerializer<AroundHours> {
    override val descriptor: SerialDescriptor = JsonElement.serializer().descriptor

    override fun deserialize(decoder: Decoder): AroundHours {
        val element = (decoder as? JsonDecoder)?.decodeJsonElement() ?: return AroundHours(emptyMap())
        val obj = element as? JsonObject ?: return AroundHours(emptyMap())
        val out = mutableMapOf<String, List<List<String>>>()
        for (key in AroundHours.dayKeys) {
            val day = obj[key] as? JsonArray ?: continue
            val ranges = day.mapNotNull { range ->
                val pair = (range as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: return@mapNotNull null
                pair.takeIf { it.size == 2 }
            }
            out[key] = ranges
        }
        return AroundHours(out)
    }

    override fun serialize(encoder: Encoder, value: AroundHours) {
        val json = encoder as? JsonEncoder ?: return
        json.encodeJsonElement(buildJsonObject {
            for ((k, ranges) in value.days) {
                put(k, JsonArray(ranges.map { r -> JsonArray(r.map { JsonPrimitive(it) }) }))
            }
        })
    }
}

@Serializable
data class AroundNextEvent(
    val id: String = "",
    val title: String = "",
    val startsAt: String = "",
    val endsAt: String = "",
)

/** A place on the map and in the list (`PlaceSummaryDto`). */
@Serializable
data class AroundPlace(
    val id: String,
    val brand: AroundBrand,
    val brandCategory: String = "Independent brand",
    val kind: AroundPlaceKind = AroundPlaceKind.Store,
    val name: String = "",
    val neighbourhood: String? = null,
    val city: String = "",
    val citySlug: String = "",
    val country: String = "",
    val lat: Double,
    val lng: Double,
    /** "street" (exact pin) or "area". */
    val pinPrecision: String = "area",
    val timeZone: String = "UTC",
    val hours: AroundHours? = null,
    val byAppointment: Boolean = false,
    val startsAt: String? = null,
    val endsAt: String? = null,
    val image: AroundImage? = null,
    val nextEvent: AroundNextEvent? = null,
    val offer: Boolean = false,
    val sample: Boolean = false,
) {
    val coordinate: AroundCoordinate get() = AroundCoordinate(lat, lng)

    /** "Ikoyi, Lagos" or "Lagos". */
    val whereText: String
        get() = if (!neighbourhood.isNullOrEmpty()) "$neighbourhood, $city" else city

    /** "Streetwear · Store". */
    val categoryKindText: String get() = "$brandCategory · ${kind.label}"
}

/** A latitude/longitude pair (iOS `CLLocationCoordinate2D` / `CLLocation`). */
data class AroundCoordinate(val latitude: Double, val longitude: Double) {
    /** Great-circle distance in metres (haversine; what `CLLocation.distance(from:)` returns, near enough). */
    fun distanceTo(other: AroundCoordinate): Double {
        val r = 6_371_008.8
        val dLat = Math.toRadians(other.latitude - latitude)
        val dLng = Math.toRadians(other.longitude - longitude)
        val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(Math.toRadians(latitude)) * Math.cos(Math.toRadians(other.latitude)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
        return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    }
}

/** A map region: centre and span in degrees (iOS `MKCoordinateRegion`). */
data class AroundRegion(val center: AroundCoordinate, val latitudeDelta: Double, val longitudeDelta: Double) {
    companion object {
        /** A region `meters` across around `center` (iOS `MKCoordinateRegion(center:latitudinalMeters:longitudinalMeters:)`). */
        fun around(center: AroundCoordinate, meters: Double): AroundRegion {
            val latDelta = meters / 111_320.0
            val cos = Math.cos(Math.toRadians(center.latitude)).coerceAtLeast(0.01)
            val lngDelta = meters / (111_320.0 * cos)
            return AroundRegion(center, latDelta.coerceAtMost(170.0), lngDelta.coerceAtMost(350.0))
        }
    }
}

/**
 * GET /api/around/places. Decoded place by place so one malformed row is dropped, not the whole
 * map (see [AroundPlacesResponse.decode]).
 */
data class AroundPlacesResponse(val places: List<AroundPlace>) {
    companion object {
        fun decode(raw: String): AroundPlacesResponse {
            val root = YardJson.parseToJsonElement(raw.ifBlank { "{}" }) as? JsonObject ?: return AroundPlacesResponse(emptyList())
            val list = root["places"] as? JsonArray ?: return AroundPlacesResponse(emptyList())
            val places = list.mapNotNull { el ->
                runCatching { YardJson.decodeFromJsonElement(AroundPlace.serializer(), el) }.getOrNull()
            }
            return AroundPlacesResponse(places)
        }
    }
}

@Serializable
data class AroundDropRef(
    val id: String = "",
    val slug: String = "",
    val name: String = "",
)

@Serializable
data class AroundEvent(
    val id: String,
    val kind: AroundEventKind = AroundEventKind.Other,
    val title: String = "",
    val description: String? = null,
    val startsAt: String = "",
    val endsAt: String = "",
    val drop: AroundDropRef? = null,
    val promoText: String? = null,
    val sample: Boolean = false,
)

@Serializable
data class AroundFeaturedPrice(
    val amount: Int = 0,
    val currency: String = "USD",
)

@Serializable
data class AroundFeaturedProduct(
    val id: String,
    val slug: String = id,
    val name: String = "",
    val price: AroundFeaturedPrice? = null,
    val image: String? = null,
) {
    val imageUrl: String? get() = Config.url(image)
}

/** `PlaceDetailDto`: the summary plus address, description, photos, events and featured pieces. */
data class AroundPlaceDetail(
    val summary: AroundPlace,
    val addressLine: String = "",
    val hoursNote: String? = null,
    val description: String? = null,
    val images: List<AroundImage> = emptyList(),
    val events: List<AroundEvent> = emptyList(),
    val featured: List<AroundFeaturedProduct> = emptyList(),
) {
    companion object {
        /** Decodes the flat DTO: the summary fields and the detail fields share one object. */
        fun decode(element: JsonElement): AroundPlaceDetail {
            val summary = YardJson.decodeFromJsonElement(AroundPlace.serializer(), element)
            val obj = element.jsonObject
            fun string(key: String): String? = (obj[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
            fun <T> list(key: String, serializer: KSerializer<T>): List<T> =
                (obj[key] as? JsonArray)?.mapNotNull { runCatching { YardJson.decodeFromJsonElement(serializer, it) }.getOrNull() }.orEmpty()
            return AroundPlaceDetail(
                summary = summary,
                addressLine = string("addressLine").orEmpty(),
                hoursNote = string("hoursNote"),
                description = string("description"),
                images = list("images", AroundImage.serializer()).filter { it.src.isNotEmpty() },
                events = list("events", AroundEvent.serializer()),
                featured = list("featured", AroundFeaturedProduct.serializer()),
            )
        }
    }
}

/** GET /api/around/places/{id} → `{ place }`. */
data class AroundPlaceDetailResponse(val place: AroundPlaceDetail) {
    companion object {
        fun decode(raw: String): AroundPlaceDetailResponse {
            val root = YardJson.parseToJsonElement(raw.ifBlank { "{}" }).jsonObject
            return AroundPlaceDetailResponse(AroundPlaceDetail.decode(root.getValue("place")))
        }
    }
}

/** Country names the website shows (`countryNames` in place-detail.tsx). */
object AroundCountry {
    val names: Map<String, String> = mapOf(
        "NG" to "Nigeria", "GH" to "Ghana", "KE" to "Kenya", "ZA" to "South Africa", "GB" to "United Kingdom",
        "FR" to "France", "DE" to "Germany", "US" to "United States", "MX" to "Mexico", "JP" to "Japan", "KR" to "South Korea",
    )

    fun name(code: String): String = names[code] ?: code
}

