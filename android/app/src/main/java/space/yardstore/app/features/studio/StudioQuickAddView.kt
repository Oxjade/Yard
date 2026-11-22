package space.yardstore.app.features.studio

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.AddPhotoAlternate
import androidx.compose.material.icons.outlined.IosShare
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.MoneyFormatter
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.rememberReducedMotion
import space.yardstore.app.designsystem.rememberYardHaptics
import space.yardstore.app.designsystem.components.SlideToComplete
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.yard
import space.yardstore.app.features.you.YouPhotoCropDialog
import space.yardstore.app.features.you.YouPhotoPick
import space.yardstore.app.features.you.YouPickedPhoto
import space.yardstore.app.features.you.youLoadPickedPhoto
import space.yardstore.app.features.you.youPhotoAuthority
import java.io.File
import kotlin.coroutines.cancellation.CancellationException

/** An option being built in Quick add ("Size": M, L). Any name: options are generic. */
data class QuickAddOption(val name: String, val values: List<String>)

/**
 * Quick add's pure rules (unit-tested): variants from options, SKUs the website's way
 * (`HANDLE-TITLE-OPTION`, uppercase, ≤ 64), and the create body.
 */
object QuickAddRules {
    const val MAX_PHOTOS = 12
    const val MAX_OPTIONS = 3

    /** Every combination of the options' values, in order ([] → one variant with no options). */
    fun combinations(options: List<QuickAddOption>): List<Map<String, String>> {
        val usable = options.filter { it.name.isNotBlank() && it.values.isNotEmpty() }
        var out: List<Map<String, String>> = listOf(emptyMap())
        for (o in usable) out = out.flatMap { combo -> o.values.map { v -> combo + (o.name.trim() to v) } }
        return out
    }

    /** A combination's label ("M / Black"), "" without options. */
    fun label(combo: Map<String, String>): String = combo.values.joinToString(" / ")

    private fun part(s: String): String = s.uppercase().replace(Regex("[^A-Z0-9]+"), "-").trim('-')

    fun sku(handle: String, title: String, combo: Map<String, String>): String {
        val parts = listOf(part(handle), part(title).take(24)) + combo.values.map { part(it).take(12) }
        return parts.filter { it.isNotEmpty() }.joinToString("-").take(64).trim('-').ifEmpty { "SKU" }
    }

    /** Price text → minor units, or null when it isn't a positive amount. */
    fun priceMinor(text: String, currency: String): Long? = StudioReauth.minor(text, currency)

    fun titleProblem(title: String): String? = when {
        title.trim().length < 2 -> "Give it a name (2 characters or more)."
        title.trim().length > 120 -> "Keep the name to 120 characters."
        else -> null
    }

    fun body(
        handle: String,
        title: String,
        categorySlug: String,
        priceMinor: Long,
        options: List<QuickAddOption>,
        stock: (Map<String, String>) -> Int,
        mediaIds: List<String>,
        description: String = "",
    ): StudioProductCreateBody {
        val usable = options.filter { it.name.isNotBlank() && it.values.isNotEmpty() }
        val combos = combinations(usable)
        val skus = mutableSetOf<String>()
        return StudioProductCreateBody(
            title = title.trim(),
            description = description.trim(),
            categorySlug = categorySlug,
            priceMinor = priceMinor,
            options = usable.map { o -> StudioOption(o.name.trim(), o.values.map { StudioOptionValue(it) }) },
            variants = combos.map { combo ->
                var sku = sku(handle, title, combo)
                var n = 2
                while (!skus.add(sku)) sku = (sku.take(60) + "-" + n++)
                StudioCreateVariant(sku = sku, options = combo, initialStock = stock(combo).coerceAtLeast(0))
            },
            images = mediaIds.map { StudioCreateImage(mediaId = it) },
        )
    }
}

/** A cropped photo ready to upload. */
class QuickAddPhoto(val jpeg: ByteArray, val preview: ImageBitmap)

enum class QuickAddStep(val title: String) { Photos("Photos"), Name("Name"), Price("Price"), Options("Options and stock"), Review("Review") }

class StudioQuickAddModel(private val store: StudioStore?, previewCategories: List<StudioCategory>? = null) : ViewModel() {
    var step by mutableStateOf(QuickAddStep.Photos)
        private set
    var movingBack by mutableStateOf(false)
        private set
    val photos = mutableStateListOf<QuickAddPhoto>()
    var title by mutableStateOf("")
    var category by mutableStateOf<String?>(null)
    var price by mutableStateOf("")
    val options = mutableStateListOf<QuickAddOption>()
    /** Stock per variant label ("" = the single variant without options). */
    val stock = mutableStateMapOf<String, Int>()
    var categories by mutableStateOf(previewCategories.orEmpty())
        private set
    var problem by mutableStateOf<String?>(null)
    var working by mutableStateOf<String?>(null)
        private set
    var created by mutableStateOf<StudioProduct?>(null)
        private set
    /** Saved but not live (a brand in review, or no publish permission / a publish refusal). */
    var draftReason by mutableStateOf<String?>(null)
        private set

    val currency: String get() = store?.brandCurrency ?: "USD"

    fun loadCategories() {
        val store = store ?: return
        if (categories.isNotEmpty()) return
        viewModelScope.launch {
            runCatching { categories = store.categories() }
            if (store.brandCurrency == null) runCatching { store.brandCurrency = store.dashboard(7).brand.currency }
        }
    }

    fun stockFor(combo: Map<String, String>): Int = stock[QuickAddRules.label(combo)] ?: 1

    fun problemFor(s: QuickAddStep): String? = when (s) {
        QuickAddStep.Photos -> if (photos.isEmpty()) "Add at least one photo." else null
        QuickAddStep.Name -> QuickAddRules.titleProblem(title) ?: if (category == null) "Pick a category." else null
        QuickAddStep.Price -> if (QuickAddRules.priceMinor(price, currency) == null) "Enter a price, like 45." else null
        QuickAddStep.Options -> options.firstOrNull { it.name.isBlank() || it.values.isEmpty() }?.let { "Name each option and add at least one value." }
        QuickAddStep.Review -> null
    }

    fun next(): Boolean {
        val p = problemFor(step)
        problem = p
        if (p != null) return false
        val n = QuickAddStep.entries.getOrNull(step.ordinal + 1) ?: return true
        movingBack = false
        step = n
        return true
    }

    fun back(): Boolean {
        val prev = QuickAddStep.entries.getOrNull(step.ordinal - 1) ?: return false
        movingBack = true
        problem = null
        step = prev
        return true
    }

    /** Upload → create (draft) → publish when allowed. */
    suspend fun publish(handle: String, canPublish: Boolean, inReview: Boolean): Boolean {
        val store = store ?: return false
        val priceMinor = QuickAddRules.priceMinor(price, currency) ?: return false
        val slug = category ?: return false
        problem = null
        try {
            val ids = mutableListOf<String>()
            photos.forEachIndexed { i, photo ->
                working = "Uploading photo ${i + 1} of ${photos.size}…"
                ids += store.uploadPhoto(photo.jpeg).id
            }
            working = "Creating your product…"
            val body = QuickAddRules.body(handle, title, slug, priceMinor, options, { stockFor(it) }, ids)
            var product = store.createProduct(body)
            when {
                !canPublish -> draftReason = "Saved as a draft. Someone with publishing rights can put it live."
                inReview -> draftReason = "Saved as a draft. It can go live once Yard approves your shop."
                else -> {
                    working = "Publishing…"
                    try {
                        product = store.setStatus(product.id, "publish", product.version)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: APIError) {
                        draftReason = "Saved as a draft. ${e.message}"
                    }
                }
            }
            created = product
            return true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = APIError.messageFor(if (e is APIError) e else APIError.network(e))
            return false
        } finally {
            working = null
        }
    }

    companion object {
        fun preview(step: QuickAddStep, categories: List<StudioCategory>, photo: ImageBitmap?): StudioQuickAddModel =
            StudioQuickAddModel(null, categories).also { m ->
                if (photo != null) m.photos.add(QuickAddPhoto(ByteArray(0), photo))
                if (step.ordinal >= QuickAddStep.Name.ordinal) { m.title = "Cedar candle"; m.category = categories.firstOrNull()?.slug }
                if (step.ordinal >= QuickAddStep.Price.ordinal) m.price = "45"
                if (step.ordinal >= QuickAddStep.Options.ordinal) {
                    m.options.add(QuickAddOption("Size", listOf("Small", "Large")))
                    m.stock["Small"] = 4
                    m.stock["Large"] = 2
                }
                m.step = step
            }

        fun previewDone(categories: List<StudioCategory>, photo: ImageBitmap?): StudioQuickAddModel =
            preview(QuickAddStep.Review, categories, photo).also { m ->
                m.created = StudioProduct(id = "prd_new", slug = "cedar-candle", title = "Cedar candle", priceMinor = 4500, status = "published")
            }
    }
}

/** A fresh cache file for a camera capture (shared FileProvider paths: cache/photos). */
private fun quickAddCameraFile(context: Context): File {
    val dir = File(context.cacheDir, "photos").apply { mkdirs() }
    return File(dir, "product-${System.currentTimeMillis()}.jpg")
}

/** Share a product's page. */
internal fun shareProduct(context: Context, slug: String, title: String) {
    val url = Config.webUrl("/products/$slug")
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, "$title on Yard: $url")
    }
    runCatching { context.startActivity(Intent.createChooser(send, "Share $title").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

@Composable
fun StudioQuickAddView(onClose: () -> Unit) {
    val studio = LocalStudioStore.current
    val model: StudioQuickAddModel = viewModel(key = "studio-add-${studio.generation}-${remember { System.nanoTime() }}") { StudioQuickAddModel(studio) }
    LaunchedEffect(model) { model.loadCategories() }
    StudioQuickAddScreen(model, onClose)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun StudioQuickAddScreen(model: StudioQuickAddModel, onClose: () -> Unit) {
    val studio = LocalStudioStore.current
    val context = LocalContext.current
    val haptics = rememberYardHaptics()
    val reduce = rememberReducedMotion()
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val brand = studio.activeBrand
    val created = model.created

    if (created != null) {
        QuickAddDone(model, created, onShare = { shareProduct(context, created.slug, created.title) }, onClose = onClose)
        return
    }

    BackHandler { if (!model.back()) onClose() }

    // Photo picking: library or camera, then the square crop (the profile photo's).
    var cropping by remember { mutableStateOf<YouPickedPhoto?>(null) }
    var cameraUri by rememberSaveable { mutableStateOf<String?>(null) }
    var opening by remember { mutableStateOf(false) }
    fun open(uri: Uri) {
        opening = true
        scope.launch {
            when (val pick = youLoadPickedPhoto(context, uri)) {
                is YouPhotoPick.Ready -> cropping = pick.photo
                is YouPhotoPick.Problem -> { haptics.reject(); model.problem = pick.message }
            }
            opening = false
        }
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) open(uri) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val uri = cameraUri?.let(Uri::parse)
        if (ok && uri != null) open(uri)
    }
    val canTakePhoto = remember(context) { context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) }

    Column(Modifier.fillMaxSize().background(Color.yard.bg).statusBarsPadding().navigationBarsPadding().imePadding()) {
        // Top: back/close, progress, step count.
        Row(Modifier.fillMaxWidth().padding(horizontal = Spacing.gutter, vertical = Spacing.m), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(44.dp).background(Color.yard.surface2, CircleShape).pressableClick(onClickLabel = if (model.step == QuickAddStep.Photos) "Close" else "Back") {
                    haptics.click()
                    focus.clearFocus()
                    if (!model.back()) onClose()
                },
                contentAlignment = Alignment.Center,
            ) { Icon(if (model.step == QuickAddStep.Photos) Icons.Filled.Close else Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null, tint = Color.yard.ink) }
            Spacer(Modifier.width(Spacing.m))
            StudioProgressBar((model.step.ordinal + 1f) / QuickAddStep.entries.size, Modifier.weight(1f), track = Color.yard.surface2, fill = Color.yard.ink)
            Text("${model.step.ordinal + 1}/${QuickAddStep.entries.size}", style = YardFonts.captionEmphasis, color = Color.yard.ink2, modifier = Modifier.padding(start = Spacing.m))
        }
        AnimatedContent(
            targetState = model.step,
            transitionSpec = {
                if (reduce) {
                    fadeIn(Motion.instant()) togetherWith fadeOut(Motion.instant())
                } else {
                    val dir = if (model.movingBack) -1 else 1
                    (slideInHorizontally(Motion.spring()) { it * dir / 2 } + fadeIn(Motion.crossfade()))
                        .togetherWith(slideOutHorizontally(Motion.spring()) { -it * dir / 3 } + fadeOut(Motion.crossfade()))
                }
            },
            label = "quick-add",
            modifier = Modifier.weight(1f),
        ) { step ->
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = Spacing.gutter).padding(top = Spacing.l, bottom = Spacing.l),
                verticalArrangement = Arrangement.spacedBy(Spacing.l),
            ) {
                YardDisplayText(
                    when (step) {
                        QuickAddStep.Photos -> "Add photos"
                        QuickAddStep.Name -> "What is it?"
                        QuickAddStep.Price -> "Set a price"
                        QuickAddStep.Options -> "Options and stock"
                        QuickAddStep.Review -> "Ready to go live?"
                    },
                    size = 40.sp,
                    modifier = Modifier.semantics { heading() },
                )
                when (step) {
                    QuickAddStep.Photos -> PhotosStep(
                        model,
                        opening = opening,
                        canTakePhoto = canTakePhoto,
                        onLibrary = { haptics.click(); picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                        onCamera = {
                            haptics.click()
                            val file = quickAddCameraFile(context)
                            val uri = FileProvider.getUriForFile(context, youPhotoAuthority(context), file)
                            cameraUri = uri.toString()
                            runCatching { camera.launch(uri) }
                        },
                    )
                    QuickAddStep.Name -> NameStep(model)
                    QuickAddStep.Price -> PriceStep(model)
                    QuickAddStep.Options -> OptionsStep(model)
                    QuickAddStep.Review -> ReviewStep(model)
                }
                model.problem?.let { Text(it, style = YardFonts.callout, color = Color.yard.danger) }
            }
        }
        Box(Modifier.padding(horizontal = Spacing.gutter, vertical = Spacing.m)) {
            if (model.step == QuickAddStep.Review) {
                val canPublish = studio.can("content.publish")
                val inReview = brand?.isPendingReview == true || brand?.isRestricted == true
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                    model.working?.let { Text(it, style = YardFonts.caption, color = Color.yard.ink2) }
                    SlideToComplete(
                        if (canPublish && !inReview) "Slide to publish" else "Slide to save draft",
                        isLoading = model.working != null,
                    ) {
                        scope.launch {
                            if (model.publish(brand?.handle.orEmpty(), canPublish, inReview)) haptics.success() else haptics.reject()
                        }
                    }
                }
            } else {
                YardButton("Continue") {
                    focus.clearFocus()
                    if (model.next()) haptics.confirm() else haptics.reject()
                }
            }
        }
    }

    cropping?.let { photo ->
        YouPhotoCropDialog(photo, onCancel = { cropping = null }) { jpeg, preview ->
            haptics.confirm()
            if (model.photos.size < QuickAddRules.MAX_PHOTOS) model.photos.add(QuickAddPhoto(jpeg, preview))
            model.problem = null
            cropping = null
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PhotosStep(model: StudioQuickAddModel, opening: Boolean, canTakePhoto: Boolean, onLibrary: () -> Unit, onCamera: () -> Unit) {
    val haptics = rememberYardHaptics()
    Text("Up to ${QuickAddRules.MAX_PHOTOS}. The first one is the cover.", style = YardFonts.callout, color = Color.yard.ink2)
    androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxWidth()) {
    val tile = (maxWidth - Spacing.s * 2) / 3
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        model.photos.forEachIndexed { i, photo ->
            Box(Modifier.size(tile)) {
                Image(photo.preview, contentDescription = if (i == 0) "Cover photo" else "Photo ${i + 1}", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().clip(YardShapes.image))
                if (i == 0) StudioPill("Cover", StudioPillStyle.Acid, Modifier.align(Alignment.BottomStart).padding(6.dp))
                Box(
                    Modifier.align(Alignment.TopEnd).padding(6.dp).size(28.dp).background(Color.yard.scrim.copy(alpha = 0.6f), CircleShape)
                        .pressableClick(onClickLabel = "Remove photo ${i + 1}") { haptics.tick(); model.photos.removeAt(i) },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.Close, contentDescription = null, tint = Color.yard.onPhoto, modifier = Modifier.size(16.dp)) }
            }
        }
        if (model.photos.size < QuickAddRules.MAX_PHOTOS) {
            Box(
                Modifier.size(tile).background(Color.yard.surface2, YardShapes.image).border(1.5.dp, Color.yard.line, YardShapes.image)
                    .pressableClick(onClickLabel = "Choose from your photos", onClick = onLibrary),
                contentAlignment = Alignment.Center,
            ) {
                if (opening) {
                    CircularProgressIndicator(color = Color.yard.ink, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
                } else {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Outlined.AddPhotoAlternate, contentDescription = null, tint = Color.yard.ink)
                        Text("Library", style = YardFonts.caption, color = Color.yard.ink2)
                    }
                }
            }
            if (canTakePhoto) {
                Box(
                    Modifier.size(tile).background(Color.yard.acid, YardShapes.image).pressableClick(onClickLabel = "Take a photo", onClick = onCamera),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Outlined.PhotoCamera, contentDescription = null, tint = Color.yard.onAcid)
                        Text("Camera", style = YardFonts.caption, color = Color.yard.onAcid)
                    }
                }
            }
        }
    }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NameStep(model: StudioQuickAddModel) {
    val haptics = rememberYardHaptics()
    StudioTextField(model.title, { model.title = it.take(120); model.problem = null }, "Product name", label = "Product name", large = true, capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done)
    Text("Category", style = YardFonts.headline, color = Color.yard.ink)
    if (model.categories.isEmpty()) {
        CircularProgressIndicator(color = Color.yard.ink, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
    } else {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
            model.categories.forEach { c ->
                val on = model.category == c.slug
                Text(
                    c.name.ifEmpty { c.slug },
                    style = YardFonts.callout.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold),
                    color = if (on) Color.yard.bg else Color.yard.ink,
                    modifier = Modifier
                        .background(if (on) Color.yard.ink else Color.yard.surface2, YardShapes.pill)
                        .pressableClick(onClickLabel = c.name) { haptics.tick(); model.category = c.slug; model.problem = null }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                )
            }
        }
    }
}

@Composable
private fun PriceStep(model: StudioQuickAddModel) {
    val symbol = MoneyFormatter.info(model.currency).symbol
    StudioTextField(model.price, { model.price = it.filter { c -> c.isDigit() || c == '.' || c == ',' }.take(12); model.problem = null }, "0", label = "Price", prefix = symbol, large = true, keyboardType = KeyboardType.Decimal)
    val minor = QuickAddRules.priceMinor(model.price, model.currency)
    Text(
        if (minor != null) "Shoppers see ${studioMoney(minor, model.currency)}." else "In ${model.currency}, your shop's currency.",
        style = YardFonts.callout,
        color = Color.yard.ink2,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun OptionsStep(model: StudioQuickAddModel) {
    val haptics = rememberYardHaptics()
    if (model.options.isEmpty()) {
        Text("No options: one stock count for the whole product.", style = YardFonts.callout, color = Color.yard.ink2)
        val one = model.stock[""] ?: 1
        Column(Modifier.fillMaxWidth().background(Color.yard.surface, YardShapes.card)) {
            StockRow("In stock", one, 0, enabled = true) { d -> haptics.tick(); model.stock[""] = (one + d).coerceAtLeast(0) }
        }
    }
    model.options.forEachIndexed { index, option ->
        var newValue by remember(index) { mutableStateOf("") }
        Column(Modifier.fillMaxWidth().background(Color.yard.surface, YardShapes.card).padding(Spacing.l), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                StudioTextField(option.name, { model.options[index] = option.copy(name = it.take(30)) }, "Option name (e.g. Size, Colour, Scent)", label = "Option name", modifier = Modifier.weight(1f), capitalization = KeyboardCapitalization.Words)
                Box(
                    Modifier.padding(start = Spacing.s).size(36.dp).background(Color.yard.surface2, CircleShape).pressableClick(onClickLabel = "Remove option") { haptics.tick(); model.options.removeAt(index) },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.Close, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(16.dp)) }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                option.values.forEach { v ->
                    Text(
                        "$v  ×",
                        style = YardFonts.callout,
                        color = Color.yard.bg,
                        modifier = Modifier.background(Color.yard.ink, YardShapes.pill)
                            .pressableClick(onClickLabel = "Remove $v") { haptics.tick(); model.options[index] = option.copy(values = option.values - v) }
                            .padding(horizontal = 14.dp, vertical = 8.dp),
                    )
                }
            }
            fun addValue() {
                val v = newValue.trim()
                if (v.isNotEmpty() && v !in option.values) {
                    haptics.tick()
                    model.options[index] = option.copy(values = option.values + v.take(30))
                }
                newValue = ""
            }
            StudioTextField(newValue, { if (it.endsWith(",")) { newValue = it.dropLast(1); addValue() } else newValue = it.take(30) }, "Add a value, then Done", label = "New value", imeAction = ImeAction.Done, onImeAction = { addValue() })
        }
    }
    if (model.options.size < QuickAddRules.MAX_OPTIONS) {
        YardButton(if (model.options.isEmpty()) "Add options (like size or colour)" else "Add another option", style = YardButtonStyle.Secondary) {
            haptics.click()
            model.options.add(QuickAddOption("", emptyList()))
        }
    }
    val combos = QuickAddRules.combinations(model.options)
    if (model.options.any { it.values.isNotEmpty() && it.name.isNotBlank() }) {
        Text("Stock", style = YardFonts.headline, color = Color.yard.ink)
        Column(Modifier.fillMaxWidth().background(Color.yard.surface, YardShapes.card).padding(vertical = Spacing.xs)) {
            combos.forEach { combo ->
                val label = QuickAddRules.label(combo)
                val n = model.stockFor(combo)
                StockRow(label, n, 0, enabled = true) { d -> haptics.tick(); model.stock[label] = (n + d).coerceAtLeast(0) }
            }
        }
    }
}

@Composable
private fun ReviewStep(model: StudioQuickAddModel) {
    val photo = model.photos.firstOrNull()
    Row(
        Modifier.fillMaxWidth().background(Color.yard.surface, YardShapes.card).padding(Spacing.m),
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (photo != null) Image(photo.preview, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.size(96.dp).clip(YardShapes.image))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(model.title.trim(), style = YardFonts.title, color = Color.yard.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            QuickAddRules.priceMinor(model.price, model.currency)?.let { Text(studioMoney(it, model.currency), style = YardFonts.body.monospacedDigits(), color = Color.yard.ink2) }
            Text(model.categories.firstOrNull { it.slug == model.category }?.name.orEmpty(), style = YardFonts.caption, color = Color.yard.ink3)
        }
    }
    val combos = QuickAddRules.combinations(model.options)
    val total = combos.sumOf { model.stockFor(it) }
    Text(
        "${model.photos.size} ${if (model.photos.size == 1) "photo" else "photos"} · ${if (combos.size == 1 && model.options.isEmpty()) "no options" else "${combos.size} variants"} · $total in stock",
        style = YardFonts.callout,
        color = Color.yard.ink2,
    )
}

@Composable
private fun QuickAddDone(model: StudioQuickAddModel, product: StudioProduct, onShare: () -> Unit, onClose: () -> Unit) {
    val draft = model.draftReason
    Box(Modifier.fillMaxSize().background(if (draft == null) Color.yard.acid else Color.yard.bg)) {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(Spacing.gutter),
            verticalArrangement = Arrangement.spacedBy(Spacing.l),
        ) {
            Spacer(Modifier.weight(1f))
            val fg = if (draft == null) Color.yard.onAcid else Color.yard.ink
            if (draft == null) space.yardstore.app.features.sell.StampCelebration("LIVE", Modifier.fillMaxWidth().height(200.dp))
            YardDisplayText(if (draft == null) "It's live." else "Saved.", size = 60.sp, color = fg)
            Text(draft ?: "${product.title} is on Yard now. Share it while it's fresh.", style = YardFonts.title, color = fg)
            Spacer(Modifier.weight(1f))
            if (draft == null) {
                StudioBlackPill("Share link", icon = Icons.Outlined.IosShare, onClick = onShare)
            }
            YardButton("Done", style = if (draft == null) YardButtonStyle.OnPhoto else YardButtonStyle.Primary) { onClose() }
        }
    }
}
