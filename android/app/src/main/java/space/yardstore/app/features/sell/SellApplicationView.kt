package space.yardstore.app.features.sell

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.or
import space.yardstore.app.designsystem.rememberReducedMotion
import space.yardstore.app.designsystem.rememberYardHaptics
import space.yardstore.app.designsystem.components.SlideToComplete
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.yard
import space.yardstore.app.features.studio.LocalStudioStore
import space.yardstore.app.features.studio.StudioBlackPill
import space.yardstore.app.features.studio.StudioBoldChip
import space.yardstore.app.features.studio.StudioProgressBar
import space.yardstore.app.features.studio.StudioTextField
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/**
 * "Sell on Yard": one question per screen on bold full-bleed colour, a progress bar, big inputs and
 * chips, slide to submit, then a celebration. About 30–45 seconds.
 */
@Composable
fun SellApplicationView() {
    val studio = LocalStudioStore.current
    val session = LocalSessionStore.current
    val scope = rememberCoroutineScope()
    val model: SellApplicationModel = viewModel(key = "sell-${studio.applicationKey}") { SellApplicationModel(studio) }
    LaunchedEffect(Unit) { model.load() }
    SellApplicationScreen(
        model,
        onClose = { studio.showsApplication = false },
        onFinished = {
            // The new shop shows up in shopper.brands (pending_review): the You tab says "in review".
            scope.launch {
                runCatching { session.refresh() }
                studio.showsApplication = false
            }
        },
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun SellApplicationScreen(model: SellApplicationModel, onClose: () -> Unit, onFinished: () -> Unit) {
    val haptics = rememberYardHaptics()
    val reduce = rememberReducedMotion()
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val existing = model.existing
    val result = model.result

    if (result != null || existing != null) {
        val name = result?.application?.brand?.name ?: existing?.brand?.name ?: model.brandName.trim()
        SellSuccess(name = name, scanStarted = result?.websiteScan?.started == true, site = model.website.trim(), alreadyWaiting = result == null, onDone = onFinished)
        return
    }

    BackHandler { if (!model.back()) onClose() }

    // Bold full-bleed colour per question: violet, acid, violet, acid; the last screen is black.
    val violet = Color.yard.violetFill
    val acid = Color.yard.acid
    val black = Color.yard.onAcid
    val bgTarget = when (model.step) {
        SellStep.Name, SellStep.Category -> violet
        SellStep.Presence, SellStep.Location -> acid
        SellStep.Review -> black
    }
    val fgTarget = when (model.step) {
        SellStep.Name, SellStep.Category -> Color.yard.onVioletFill
        SellStep.Presence, SellStep.Location -> Color.yard.onAcid
        SellStep.Review -> Color.yard.onPhoto
    }
    val bg by animateColorAsState(bgTarget, Motion.or(reduce) { Motion.standard(380) }, label = "sell-bg")
    val fg by animateColorAsState(fgTarget, Motion.or(reduce) { Motion.standard(380) }, label = "sell-fg")

    fun advance() {
        if (model.next()) {
            haptics.confirm()
        } else {
            haptics.reject()
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(bg)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding()
            .padding(horizontal = Spacing.gutter),
    ) {
        Row(Modifier.fillMaxWidth().padding(top = Spacing.m), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(44.dp)
                    .background(fg.copy(alpha = 0.12f), CircleShape)
                    .pressableClick(onClickLabel = if (model.step == SellStep.Name) "Close" else "Back") {
                        haptics.click()
                        focus.clearFocus()
                        if (!model.back()) onClose()
                    },
                contentAlignment = Alignment.Center,
            ) {
                Icon(if (model.step == SellStep.Name) Icons.Filled.Close else Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null, tint = fg)
            }
            Spacer(Modifier.size(Spacing.m))
            StudioProgressBar(model.progress, Modifier.weight(1f), track = fg.copy(alpha = 0.18f), fill = fg)
            Text(
                "${model.step.index + 1}/${SellStep.COUNT}",
                style = YardFonts.captionEmphasis,
                color = fg,
                modifier = Modifier.padding(start = Spacing.m),
            )
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
            label = "sell-step",
            modifier = Modifier.weight(1f),
        ) { step ->
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = Spacing.xxl, bottom = Spacing.l),
                verticalArrangement = Arrangement.spacedBy(Spacing.l),
            ) {
                when (step) {
                    SellStep.Name -> NameStep(model, fg) { advance() }
                    SellStep.Presence -> PresenceStep(model, fg) { advance() }
                    SellStep.Category -> CategoryStep(model, fg)
                    SellStep.Location -> LocationStep(model, fg) { advance() }
                    SellStep.Review -> ReviewStep(model, fg) { target -> model.goTo(target) }
                }
            }
        }

        if (model.step == SellStep.Review) {
            model.submitError?.let { error ->
                Text(
                    error,
                    style = YardFonts.callout,
                    color = Color.yard.onAcid,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = Spacing.m)
                        .background(Color.yard.acid, YardShapes.small)
                        .padding(Spacing.m)
                        .semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            SlideToComplete(
                "Slide to apply",
                isLoading = model.isSubmitting,
                modifier = Modifier.padding(bottom = Spacing.l),
            ) {
                scope.launch {
                    if (model.submit()) haptics.success() else haptics.reject()
                }
            }
        } else {
            StudioBlackPill("Continue", Modifier.padding(bottom = Spacing.l)) {
                focus.clearFocus()
                advance()
            }
        }
    }
}

@Composable
private fun StepTitle(text: String, fg: Color, kicker: String? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        if (kicker != null) Text(kicker, style = YardFonts.callout, color = fg.copy(alpha = 0.75f))
        YardDisplayText(text, size = 44.sp, color = fg, modifier = Modifier.semantics { heading() })
    }
}

@Composable
private fun NameStep(model: SellApplicationModel, fg: Color, onNext: () -> Unit) {
    val focus = remember { FocusRequester() }
    StepTitle("What's your brand called?", fg)
    StudioTextField(
        value = model.brandName,
        onValueChange = { if (it.length <= 40) model.brandName = it; model.clearProblem() },
        placeholder = "Your shop's name",
        label = "Brand name",
        onColor = true,
        large = true,
        error = model.problem,
        capitalization = KeyboardCapitalization.Words,
        imeAction = ImeAction.Next,
        onImeAction = onNext,
        modifier = Modifier.focusRequester(focus),
    )
    // A live preview of how the shop's name reads on Yard.
    BrandPreviewCard(model.brandName.trim(), fg)
}

@Composable
private fun BrandPreviewCard(name: String, fg: Color) {
    val shown = name.ifEmpty { "Your brand" }
    val initials = shown.split(" ").filter { it.isNotEmpty() }.take(2).joinToString("") { it.first().uppercase() }
    Row(
        Modifier
            .fillMaxWidth()
            .background(Color.yard.onAcid, YardShapes.card)
            .padding(Spacing.l)
            .semantics(mergeDescendants = true) { contentDescription = "Preview: $shown on Yard" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Box(Modifier.size(52.dp).background(Color.yard.acid, CircleShape), contentAlignment = Alignment.Center) {
            Text(initials, style = YardFonts.display(22.sp), color = Color.yard.onAcid)
        }
        Column(Modifier.weight(1f)) {
            Text(shown, style = YardFonts.title, color = if (name.isEmpty()) Color.yard.onPhoto.copy(alpha = 0.4f) else Color.yard.onPhoto, maxLines = 1)
            Text("Independent brand on Yard", style = YardFonts.caption, color = Color.yard.onPhoto.copy(alpha = 0.6f))
        }
        Text("Follow", style = YardFonts.captionEmphasis, color = Color.yard.onAcid, modifier = Modifier.background(Color.yard.acid, YardShapes.pill).padding(horizontal = 12.dp, vertical = 7.dp))
    }
}

@Composable
private fun PresenceStep(model: SellApplicationModel, fg: Color, onNext: () -> Unit) {
    StepTitle("Where can we see your stuff?", fg, kicker = model.brandName.trim().ifEmpty { null })
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
        StudioBoldChip("Instagram", selected = !model.showsWebsite, onColor = fg) { model.showsWebsite = false; model.clearProblem() }
        StudioBoldChip("Website", selected = model.showsWebsite, onColor = fg) { model.showsWebsite = true; model.clearProblem() }
    }
    if (model.showsWebsite) {
        StudioTextField(
            value = model.website,
            onValueChange = { model.website = it.take(500); model.clearProblem() },
            placeholder = "yourshop.com",
            label = "Website",
            onColor = true,
            large = true,
            error = model.problem,
            keyboardType = KeyboardType.Uri,
            capitalization = KeyboardCapitalization.None,
            onImeAction = onNext,
        )
        Text(
            "We'll pull in your products, so Yard's reviewers see them ready.",
            style = YardFonts.callout,
            color = fg.copy(alpha = 0.8f),
        )
    } else {
        StudioTextField(
            value = model.instagram,
            // The "@" is drawn as the field's prefix; a typed or pasted one is dropped.
            onValueChange = { model.instagram = it.trimStart().removePrefix("@").take(200); model.clearProblem() },
            placeholder = "yourshop",
            label = "Instagram handle",
            prefix = "@",
            onColor = true,
            large = true,
            error = model.problem,
            keyboardType = KeyboardType.Uri,
            capitalization = KeyboardCapitalization.None,
            onImeAction = onNext,
        )
    }
    val other = if (model.showsWebsite) model.instagram.trim().takeIf { it.isNotEmpty() }?.let { "Instagram: $it" } else model.website.trim().takeIf { it.isNotEmpty() }?.let { "Website: $it" }
    if (other != null) Text(other, style = YardFonts.caption, color = fg.copy(alpha = 0.7f))
    Text("One is enough. Add both if you have them.", style = YardFonts.caption, color = fg.copy(alpha = 0.7f))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CategoryStep(model: SellApplicationModel, fg: Color) {
    StepTitle("What do you sell?", fg)
    Text("Tap all that fit. The first one you pick is your main category.", style = YardFonts.callout, color = fg.copy(alpha = 0.8f))
    when {
        model.categoriesLoading -> CircularProgressIndicator(color = fg, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
        model.categoriesError != null -> Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
            Text(model.categoriesError.orEmpty(), style = YardFonts.callout, color = fg)
            StudioBoldChip("Try again", selected = false, onColor = fg) { model.loadCategories() }
        }
        else -> FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
            model.categories.forEach { c ->
                val index = model.selected.indexOf(c.slug)
                StudioBoldChip(if (index == 0) "★ ${c.name.ifEmpty { c.slug }}" else c.name.ifEmpty { c.slug }, selected = index >= 0, onColor = fg) { model.toggle(c.slug) }
            }
        }
    }
    model.problem?.let { Text(it, style = YardFonts.captionEmphasis, color = fg) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LocationStep(model: SellApplicationModel, fg: Color, onNext: () -> Unit) {
    StepTitle("Where are you based?", fg)
    StudioTextField(
        value = model.city,
        onValueChange = { model.city = it.take(80); model.clearProblem() },
        placeholder = "City",
        label = "City",
        onColor = true,
        large = true,
        error = if (SellRules.cityProblem(model.city) != null) model.problem else null,
        capitalization = KeyboardCapitalization.Words,
        onImeAction = onNext,
    )
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        SellRules.countries.forEach { code ->
            StudioBoldChip("${SellRules.flag(code)} ${SellRules.countryName(code)}", selected = model.country == code, onColor = fg) {
                model.country = code
                model.clearProblem()
            }
        }
    }
    if (SellRules.cityProblem(model.city) == null) model.problem?.let { Text(it, style = YardFonts.captionEmphasis, color = fg) }
}

@Composable
private fun ReviewStep(model: SellApplicationModel, fg: Color, onEdit: (SellStep) -> Unit) {
    StepTitle("Ready to apply?", fg, kicker = "Check it over")
    val rows = listOf(
        Triple("Brand", model.brandName.trim(), SellStep.Name),
        Triple(
            "Find us",
            listOfNotNull(
                model.instagram.trim().takeIf { it.isNotEmpty() }?.let { "@" + (SellRules.instagramHandleOf(it) ?: it.removePrefix("@")) },
                model.website.trim().takeIf { it.isNotEmpty() },
            ).joinToString(" · "),
            SellStep.Presence,
        ),
        Triple("Sells", model.primaryCategory?.name.orEmpty(), SellStep.Category),
        Triple("Based in", listOfNotNull(model.city.trim().ifEmpty { null }, model.country?.let { SellRules.countryName(it) }).joinToString(", "), SellStep.Location),
    )
    Column(Modifier.fillMaxWidth().background(fg.copy(alpha = 0.08f), YardShapes.card).padding(vertical = Spacing.s)) {
        rows.forEach { (label, value, target) ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .pressableClick(onClickLabel = "Edit $label") { onEdit(target) }
                    .padding(horizontal = Spacing.l, vertical = Spacing.m),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(label, style = YardFonts.caption, color = fg.copy(alpha = 0.6f))
                    Text(value.ifEmpty { "—" }, style = YardFonts.headline, color = fg)
                }
                Text("Edit", style = YardFonts.captionEmphasis, color = Color.yard.acid)
            }
        }
    }
    Text(
        "Yard reviews every brand. Your shop opens in Studio right away; nothing goes live until you're approved.",
        style = YardFonts.callout,
        color = fg.copy(alpha = 0.7f),
    )
}

/** "You're on the list" with light confetti (static under reduced motion). */
@Composable
internal fun SellSuccess(name: String, scanStarted: Boolean, site: String, alreadyWaiting: Boolean, onDone: () -> Unit) {
    val haptics = rememberYardHaptics()
    LaunchedEffect(Unit) { if (!alreadyWaiting) haptics.success() }
    val brand = name.ifBlank { "your shop" }
    Box(Modifier.fillMaxSize().background(Color.yard.acid)) {
        Confetti(Modifier.fillMaxSize())
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(horizontal = Spacing.gutter, vertical = Spacing.l),
            verticalArrangement = Arrangement.spacedBy(Spacing.l),
        ) {
            Spacer(Modifier.weight(1f))
            YardDisplayText(
                if (alreadyWaiting) "You're already on the list." else "You're on the list.",
                size = 56.sp,
                color = Color.yard.onAcid,
                modifier = Modifier.semantics { heading(); liveRegion = LiveRegionMode.Polite },
            )
            Text(
                "We'll review $brand and let you know.",
                style = YardFonts.title,
                color = Color.yard.onAcid,
            )
            if (scanStarted) {
                Text(
                    "We'll pull in your products${if (site.isNotEmpty()) " from $site" else ""}, so they're ready when you're approved.",
                    style = YardFonts.callout,
                    color = Color.yard.onAcid.copy(alpha = 0.75f),
                )
            }
            Spacer(Modifier.weight(1f))
            StudioBlackPill("Back to shopping", Modifier.padding(bottom = Spacing.s)) { onDone() }
        }
    }
}

/** Light confetti: a few dozen pieces falling once, in Yard's colours. Static scatter under reduced motion. */
@Composable
internal fun Confetti(modifier: Modifier = Modifier) {
    val reduce = rememberReducedMotion()
    val colors = listOf(Color.yard.violetFill, Color.yard.onAcid, Color.yard.onPhoto, Color.yard.violet)
    val pieces = remember {
        val r = Random(7)
        List(46) {
            ConfettiPiece(
                x = r.nextFloat(),
                delay = r.nextFloat() * 0.35f,
                speed = 0.7f + r.nextFloat() * 0.6f,
                drift = (r.nextFloat() - 0.5f) * 0.25f,
                spin = (r.nextFloat() - 0.5f) * 720f,
                w = 6f + r.nextFloat() * 8f,
                h = 10f + r.nextFloat() * 10f,
                color = it % 4,
                restY = 0.05f + r.nextFloat() * 0.35f,
            )
        }
    }
    val t = remember { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(reduce) { if (!reduce) t.animateTo(1f, tween(2600, easing = LinearEasing)) }
    Canvas(modifier) {
        val time = t.value
        pieces.forEach { p ->
            val local = ((time - p.delay) / (1f - p.delay)).coerceIn(0f, 1f)
            val y = if (reduce) p.restY else -0.1f + local * p.speed * 1.2f
            if (y > 1.1f || (!reduce && local <= 0f)) return@forEach
            val x = p.x + p.drift * sin(local * 6f) + p.drift * cos(local * 3f) * 0.3f
            val center = Offset(x * size.width, y * size.height)
            rotate(p.spin * local, center) {
                drawRect(
                    colors[p.color],
                    topLeft = Offset(center.x - p.w, center.y - p.h / 2f),
                    size = Size(p.w * 2f, p.h),
                    alpha = if (reduce) 0.5f else (1f - (local - 0.75f).coerceAtLeast(0f) * 4f).coerceIn(0f, 1f),
                )
            }
        }
    }
}

private data class ConfettiPiece(
    val x: Float,
    val delay: Float,
    val speed: Float,
    val drift: Float,
    val spin: Float,
    val w: Float,
    val h: Float,
    val color: Int,
    val restY: Float,
)
