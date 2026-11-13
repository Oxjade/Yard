package space.yardstore.app.features.charts

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonNull
import space.yardstore.app.app.Route
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.YardDate
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

// Charts API models (website: src/lib/api/contracts/charts.ts). Mirrors ChartsModels.swift.
//   GET /api/charts?chart=&period=&category=&country=&city=  → ChartBoard
//   GET /api/charts/scopes                                   → ChartScopes
// Every field the server may omit decodes leniently, so one odd value never blanks the board.

// region Query enums

/** The boards (`?chart=`), in the order the website's rail shows them. */
@Serializable
enum class ChartSlug(val rawValue: String) {
    @SerialName("top") Top("top"),
    @SerialName("trending") Trending("trending"),
    @SerialName("emerging") Emerging("emerging"),
    @SerialName("most-followed") MostFollowed("most-followed"),
    @SerialName("most-wishlisted") MostWishlisted("most-wishlisted"),
    @SerialName("top-drops") TopDrops("top-drops"),
    @SerialName("city") City("city");

    /** Sentence case, as the website's board rail shows them. */
    val label: String
        get() = when (this) {
            Top -> "Top brands"
            Trending -> "Trending"
            Emerging -> "Emerging"
            MostFollowed -> "Most followed"
            MostWishlisted -> "Most wishlisted"
            TopDrops -> "Top drops"
            City -> "City charts"
        }
}

/** Edition period (`?period=`). */
@Serializable
enum class ChartPeriod(val rawValue: String) {
    @SerialName("daily") Daily("daily"),
    @SerialName("weekly") Weekly("weekly"),
    @SerialName("monthly") Monthly("monthly");

    val label: String
        get() = when (this) {
            Daily -> "Daily"
            Weekly -> "Weekly"
            Monthly -> "Monthly"
        }

    /** "Yesterday" / "Last week" / "Last month". */
    val previous: String
        get() = when (this) {
            Daily -> "Yesterday"
            Weekly -> "Last week"
            Monthly -> "Last month"
        }

    val previousLower: String get() = previous.lowercase()

    /** "New today" / "New this week" / "New this month". */
    val isNewText: String
        get() = when (this) {
            Daily -> "New today"
            Weekly -> "New this week"
            Monthly -> "New this month"
        }

    /** "3 days" / "3 wks" / "3 mos" on the chart. */
    fun unit(n: Int): String = when (this) {
        Daily -> "$n ${if (n == 1) "day" else "days"}"
        Weekly -> "$n ${if (n == 1) "wk" else "wks"}"
        Monthly -> "$n ${if (n == 1) "mo" else "mos"}"
    }

    /** How often the website refreshes a board of this period while it is on screen. */
    val refreshSeconds: Long
        get() = when (this) {
            Daily -> 30
            Weekly -> 300
            Monthly -> 900
        }
}

/** Movement since the previous edition. */
@Serializable
enum class ChartMovement {
    @SerialName("up") Up,
    @SerialName("down") Down,
    @SerialName("same") Same,
    @SerialName("new") New,
    @SerialName("reentry") Reentry;

    /** "up 2 places", "new entry" (TalkBack). */
    fun words(delta: Int): String = when (this) {
        Up -> "up $delta ${if (delta == 1) "place" else "places"}"
        Down -> "down ${-delta} ${if (-delta == 1) "place" else "places"}"
        Same -> "no change"
        New -> "new entry"
        Reentry -> "re-entry"
    }
}

/** Board state: ok, small_cohort (too few brands in scope), warming_up (no edition yet). */
@Serializable
enum class ChartBoardState {
    @SerialName("ok") Ok,
    @SerialName("small_cohort") SmallCohort,
    @SerialName("warming_up") WarmingUp,
}

// endregion

// region Board

@Serializable
data class ChartImageRef(
    val src: String = "",
    val alt: String = "",
) {
    val url: String? get() = Config.url(src)
}

@Serializable
data class ChartBrand(
    val id: String,
    val handle: String = "",
    val name: String = "",
    val verified: Boolean = false,
    val city: String = "",
    val country: String = "",
    val countryName: String = "",
    /** The brand's first category as a label ("Streetwear"); may be empty. */
    val category: String = "",
    @Serializable(with = ChartImageRefLenient::class)
    val cover: ChartImageRef? = null,
) {
    /** "Streetwear, Lagos". */
    val originText: String get() = listOf(category, city).filter { it.isNotEmpty() }.joinToString(", ")
}

@Serializable
data class ChartDrop(
    val id: String,
    val slug: String = "",
    val name: String = "",
    @Serializable(with = ChartImageRefLenient::class)
    val image: ChartImageRef? = null,
    /** live, sold_out, upcoming, ended. */
    val status: String = "live",
) {
    val statusLabel: String
        get() = when (status) {
            "live" -> "Live"
            "sold_out" -> "Sold out"
            "upcoming" -> "Upcoming"
            "ended" -> "Ended"
            else -> status.replaceFirstChar { it.titlecase(Locale.ROOT) }
        }
}

/** The public stat an entry is ranked on ("+1.2K" / "new followers"). Never revenue. */
@Serializable
data class ChartStat(
    val label: String = "",
    val figure: String = "",
    val caption: String = "",
)

@Serializable
data class ChartSubject(
    val type: String = "brand",
    val id: String = "",
)

@Serializable
data class ChartEntry(
    val rank: Int = 0,
    val prevRank: Int? = null,
    val movement: ChartMovement = ChartMovement.Same,
    val delta: Int = 0,
    @SerialName("peak") private val peakValue: Int? = null,
    val editionsOnChart: Int = 1,
    @SerialName("subject") @Serializable(with = ChartSubjectLenient::class)
    private val subjectValue: ChartSubject? = null,
    val brand: ChartBrand,
    @Serializable(with = ChartDropLenient::class)
    val drop: ChartDrop? = null,
    @SerialName("stat") @Serializable(with = ChartStatLenient::class)
    private val statValue: ChartStat? = null,
) {
    /** Best rank so far (defaults to this rank when the server omits it). */
    val peak: Int get() = peakValue ?: rank

    val subject: ChartSubject get() = subjectValue ?: ChartSubject(type = "brand", id = brand.id)

    val stat: ChartStat get() = statValue ?: ChartStat()

    val id: String get() = "${subject.type}:${subject.id}"

    val title: String get() = drop?.name ?: brand.name

    /** The drop for drop entries, else the brand's storefront. */
    val route: Route
        get() = drop?.let { Route.Drop(id = it.slug.ifEmpty { it.id }) } ?: Route.Brand(handle = brand.handle)

    /** "Last week #4", "New this week", "Back on the chart". */
    fun previousText(period: ChartPeriod): String = when (movement) {
        ChartMovement.New -> period.isNewText
        ChartMovement.Reentry -> "Back on the chart"
        else -> prevRank?.let { "${period.previous} #$it" } ?: period.previous
    }

    /** The website's accessible row: "Acme. Rank 5, up 2 places, last week 7, peak 2. 120 new followers." */
    fun accessibilityText(period: ChartPeriod): String {
        val name = drop?.let { "${it.name} by ${brand.name}" } ?: brand.name
        if (movement == ChartMovement.New) return "$name. Rank $rank, new entry. ${stat.label}."
        val prev = prevRank?.let { ", ${period.previousLower} $it" } ?: ""
        return "$name. Rank $rank, ${movement.words(delta)}$prev, peak $peak, ${period.unit(editionsOnChart)} on chart. ${stat.label}."
    }

    companion object {
        /** Builder for previews (the server always sends the full entry). */
        fun make(
            rank: Int, prevRank: Int?, movement: ChartMovement, delta: Int, peak: Int, editionsOnChart: Int,
            subject: ChartSubject, brand: ChartBrand, drop: ChartDrop? = null, stat: ChartStat,
        ) = ChartEntry(rank, prevRank, movement, delta, peak, editionsOnChart, subject, brand, drop, stat)
    }
}

@Serializable
data class ChartScopeInfo(
    val key: String? = null,
    @Serializable(with = ScopeCityLenient::class) val city: City? = null,
    @Serializable(with = ScopeCountryLenient::class) val country: Country? = null,
    @Serializable(with = ScopeCategoryLenient::class) val category: Category? = null,
) {
    @Serializable data class City(val slug: String, val name: String, val country: String? = null)
    @Serializable data class Country(val code: String, val name: String)
    @Serializable data class Category(val slug: String, val label: String)
}

@Serializable
data class ChartEditionInfo(
    /** UTC as-of date (yyyy-MM-dd). */
    val date: String = "",
    /** live / final. */
    val status: String = "",
    val computedAt: String = "",
    val window: Window = Window(),
) {
    @Serializable data class Window(val from: String = "", val to: String = "")

    val isLive: Boolean get() = status == "live"
}

@Serializable
data class ChartSponsored(
    val kind: String = "brand",
    val brand: ChartBrand,
    @Serializable(with = ChartDropLenient::class)
    val drop: ChartDrop? = null,
) {
    val id: String get() = drop?.let { "d:${it.id}" } ?: "b:${brand.id}"

    val route: Route
        get() = drop?.let { Route.Drop(id = it.slug.ifEmpty { it.id }) } ?: Route.Brand(handle = brand.handle)
}

@Serializable
data class ChartCallouts(
    @Serializable(with = ChartEntryLenient::class) val biggestClimber: ChartEntry? = null,
    @Serializable(with = ChartEntryLenient::class) val highestDebut: ChartEntry? = null,
)

@Serializable
data class ChartFallback(
    @Serializable(with = FallbackCountryLenient::class) val country: Country? = null,
    @Serializable(with = FallbackCityLenient::class) val nearestCity: NearCity? = null,
) {
    @Serializable data class Country(val code: String, val name: String, val eligible: Int = 0)
    @Serializable data class NearCity(val slug: String, val name: String, val eligible: Int = 0)
}

@Serializable
data class ChartBoard(
    val chart: ChartSlug = ChartSlug.Top,
    val period: ChartPeriod = ChartPeriod.Weekly,
    @SerialName("scope") @Serializable(with = ScopeInfoLenient::class)
    private val scopeValue: ChartScopeInfo? = null,
    val state: ChartBoardState = ChartBoardState.Ok,
    @Serializable(with = EditionLenient::class)
    val edition: ChartEditionInfo? = null,
    val cohortSize: Int = 0,
    // One entry that fails to decode is dropped, never the whole board.
    @Serializable(with = ChartEntryLossyList::class)
    val entries: List<ChartEntry> = emptyList(),
    @Serializable(with = ChartSponsoredLossyList::class)
    val sponsored: List<ChartSponsored> = emptyList(),
    @SerialName("callouts") @Serializable(with = CalloutsLenient::class)
    private val calloutsValue: ChartCallouts? = null,
    @Serializable(with = FallbackLenient::class)
    val fallback: ChartFallback? = null,
) {
    val scope: ChartScopeInfo get() = scopeValue ?: ChartScopeInfo()
    val callouts: ChartCallouts get() = calloutsValue ?: ChartCallouts()

    companion object {
        /** Builder for previews. */
        fun make(
            chart: ChartSlug, period: ChartPeriod, scope: ChartScopeInfo, state: ChartBoardState,
            edition: ChartEditionInfo?, cohortSize: Int, entries: List<ChartEntry>,
            sponsored: List<ChartSponsored> = emptyList(), callouts: ChartCallouts = ChartCallouts(),
            fallback: ChartFallback? = null,
        ) = ChartBoard(chart, period, scope, state, edition, cohortSize, entries, sponsored, callouts, fallback)
    }
}

// endregion

// region Scopes

@Serializable
data class ChartScopes(
    @Serializable(with = ScopeCitiesLossyList::class)
    val cities: List<City> = emptyList(),
    @Serializable(with = ScopeCountriesLossyList::class)
    val countries: List<Country> = emptyList(),
    @Serializable(with = ScopeCategoriesLossyList::class)
    val categories: List<Category> = emptyList(),
    val minCohort: Int = 3,
) {
    @Serializable
    data class City(
        val slug: String,
        val name: String,
        val country: String = "",
        val eligible: Int = 0,
        val byCategory: Map<String, Int> = emptyMap(),
    ) { val id: String get() = slug }

    @Serializable
    data class Country(
        val code: String,
        val name: String,
        val eligible: Int = 0,
        val byCategory: Map<String, Int> = emptyMap(),
    ) { val id: String get() = code }

    @Serializable
    data class Category(
        val slug: String,
        val label: String,
        val eligible: Int = 0,
    ) { val id: String get() = slug }
}

// endregion

// region Lenient decoding (Swift `lenientOptional` + `ChartsLossy`)

/** Decodes a value or null, so one malformed nested object never fails its parent. */
open class ChartsLenientSerializer<T : Any>(private val element: KSerializer<T>) : KSerializer<T?> {
    private val nullable = element.nullable
    override val descriptor: SerialDescriptor = nullable.descriptor
    override fun deserialize(decoder: Decoder): T? {
        val json = decoder as? JsonDecoder ?: return nullable.deserialize(decoder)
        val raw = json.decodeJsonElement()
        if (raw is JsonNull) return null
        return runCatching { json.json.decodeFromJsonElement(element, raw) }.getOrNull()
    }
    override fun serialize(encoder: Encoder, value: T?) = nullable.serialize(encoder, value)
}

/** Decodes each array element or drops it, so one bad element doesn't fail the array. */
open class ChartsLossyListSerializer<T>(private val element: KSerializer<T>) : KSerializer<List<T>> {
    private val list = ListSerializer(element)
    override val descriptor: SerialDescriptor = list.descriptor
    override fun deserialize(decoder: Decoder): List<T> {
        val json = decoder as? JsonDecoder ?: return list.deserialize(decoder)
        val raw = json.decodeJsonElement() as? JsonArray ?: return emptyList()
        return raw.mapNotNull { runCatching { json.json.decodeFromJsonElement(element, it) }.getOrNull() }
    }
    override fun serialize(encoder: Encoder, value: List<T>) = list.serialize(encoder, value)
}

object ChartImageRefLenient : ChartsLenientSerializer<ChartImageRef>(ChartImageRef.serializer())
object ChartSubjectLenient : ChartsLenientSerializer<ChartSubject>(ChartSubject.serializer())
object ChartDropLenient : ChartsLenientSerializer<ChartDrop>(ChartDrop.serializer())
object ChartStatLenient : ChartsLenientSerializer<ChartStat>(ChartStat.serializer())
object ChartEntryLenient : ChartsLenientSerializer<ChartEntry>(ChartEntry.serializer())
object ScopeCityLenient : ChartsLenientSerializer<ChartScopeInfo.City>(ChartScopeInfo.City.serializer())
object ScopeCountryLenient : ChartsLenientSerializer<ChartScopeInfo.Country>(ChartScopeInfo.Country.serializer())
object ScopeCategoryLenient : ChartsLenientSerializer<ChartScopeInfo.Category>(ChartScopeInfo.Category.serializer())
object ScopeInfoLenient : ChartsLenientSerializer<ChartScopeInfo>(ChartScopeInfo.serializer())
object EditionLenient : ChartsLenientSerializer<ChartEditionInfo>(ChartEditionInfo.serializer())
object CalloutsLenient : ChartsLenientSerializer<ChartCallouts>(ChartCallouts.serializer())
object FallbackLenient : ChartsLenientSerializer<ChartFallback>(ChartFallback.serializer())
object FallbackCountryLenient : ChartsLenientSerializer<ChartFallback.Country>(ChartFallback.Country.serializer())
object FallbackCityLenient : ChartsLenientSerializer<ChartFallback.NearCity>(ChartFallback.NearCity.serializer())
object ChartEntryLossyList : ChartsLossyListSerializer<ChartEntry>(ChartEntry.serializer())
object ChartSponsoredLossyList : ChartsLossyListSerializer<ChartSponsored>(ChartSponsored.serializer())
object ScopeCitiesLossyList : ChartsLossyListSerializer<ChartScopes.City>(ChartScopes.City.serializer())
object ScopeCountriesLossyList : ChartsLossyListSerializer<ChartScopes.Country>(ChartScopes.Country.serializer())
object ScopeCategoriesLossyList : ChartsLossyListSerializer<ChartScopes.Category>(ChartScopes.Category.serializer())

// endregion

// region Formatting

object ChartsFormat {
    private val dayFormatter: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM", Locale.UK)

    fun day(iso: String): String =
        runCatching { LocalDate.parse(iso.take(10)).format(dayFormatter) }.getOrDefault(iso)

    /** "Weekly edition, 31 Oct – 6 Nov", "Daily edition, 6 Nov"; finals read "Week of 31 Oct". */
    fun editionText(e: ChartEditionInfo, period: ChartPeriod): String {
        if (!e.isLive) {
            return when (period) {
                ChartPeriod.Daily -> "Edition of ${day(e.window.to)}"
                ChartPeriod.Weekly -> "Week of ${day(e.window.from)}"
                ChartPeriod.Monthly -> "Month to ${day(e.window.to)}"
            }
        }
        return when (period) {
            ChartPeriod.Daily -> "Daily edition, ${day(e.window.to)}"
            ChartPeriod.Weekly -> "Weekly edition, ${day(e.window.from)} – ${day(e.window.to)}"
            ChartPeriod.Monthly -> "Monthly edition, ${day(e.window.from)} – ${day(e.window.to)}"
        }
    }

    /** "just now", "2 min ago", "1 h ago". */
    fun updatedAgo(iso: String, now: Instant = Instant.now()): String? {
        val d = YardDate.parse(iso) ?: return null
        val s = maxOf(0L, Duration.between(d, now).seconds)
        if (s < 45) return "just now"
        val m = (s / 60.0).roundToInt()
        if (m < 60) return "$m min ago"
        return "${(m / 60.0).roundToInt()} h ago"
    }

    fun two(n: Int): String = if (n in 0..9) "0$n" else "$n"

    fun brands(n: Int): String = "$n ${if (n == 1) "brand" else "brands"}"
}

// endregion
