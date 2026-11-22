package space.yardstore.app.features.sell

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.rememberReducedMotion
import space.yardstore.app.designsystem.rememberYardHaptics
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.yard
import space.yardstore.app.features.auth.AuthOnboarding
import space.yardstore.app.features.auth.WelcomeCategory
import space.yardstore.app.features.auth.WelcomeModel
import space.yardstore.app.features.studio.LocalStudioStore
import space.yardstore.app.features.studio.StudioBlackPill
import space.yardstore.app.features.studio.StudioBoldChip

/**
 * "What brings you to Yard?" — full screen, once per account on this device (after a new sign-up,
 * and for an existing account that never answered). Shop goes straight in (one optional, skippable
 * "Pick what you're into" step when this device never did the Welcome picks); Sell opens the
 * short application. Brand members never see it (they are sellers already).
 */
@Composable
fun RoleSelectionView() {
    val session = LocalSessionStore.current
    val studio = LocalStudioStore.current
    var picking by rememberSaveable { mutableStateOf(false) }
    val shopper = session.shopper ?: return

    // Back on the choice screen picks shopping (the least commitment), never strands the person.
    BackHandler { studio.recordRole(shopper, "shop") }

    AnimatedContent(
        targetState = picking,
        transitionSpec = { fadeIn(Motion.crossfade()) togetherWith fadeOut(Motion.crossfade()) },
        label = "role",
    ) { interests ->
        if (interests) {
            val model: WelcomeModel = viewModel { WelcomeModel() }
            LaunchedEffect(Unit) { model.loadCategories() }
            InterestsStep(
                categories = model.categories,
                loading = !model.categoriesLoaded && model.categoriesError == null,
                onDone = { picks ->
                    if (picks.isNotEmpty()) AuthOnboarding.interests = AuthOnboarding.join(picks)
                    AuthOnboarding.onboarded = true
                    studio.recordRole(shopper, "shop")
                },
            )
        } else {
            RoleSelectionScreen(
                firstName = shopper.firstName,
                onShop = {
                    if (AuthOnboarding.onboarded) studio.recordRole(shopper, "shop") else picking = true
                },
                onSell = {
                    studio.recordRole(shopper, "sell")
                    studio.openApplication()
                },
            )
        }
    }
}

@Composable
internal fun RoleSelectionScreen(firstName: String, onShop: () -> Unit, onSell: () -> Unit) {
    val haptics = rememberYardHaptics()
    val reduce = rememberReducedMotion()
    val enter = remember { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(Unit) { if (!reduce) enter.animateTo(1f, Motion.emphasized()) }
    Column(
        Modifier
            .fillMaxSize()
            .background(Color.yard.bg)
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = Spacing.gutter, vertical = Spacing.l),
        verticalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Text(
            if (firstName.isNotBlank()) "Welcome, $firstName" else "Welcome to Yard",
            style = YardFonts.callout,
            color = Color.yard.ink2,
            modifier = Modifier.padding(top = Spacing.l),
        )
        YardDisplayText(
            "What brings you to Yard?",
            size = 46.sp,
            modifier = Modifier.semantics { heading() }.padding(bottom = Spacing.s),
        )
        RoleCard(
            title = "Shop on Yard",
            body = "Discover independent brands, follow them and catch every drop.",
            background = Color.yard.acid,
            foreground = Color.yard.onAcid,
            graphic = { ShopGraphic(Modifier.size(128.dp)) },
            modifier = Modifier.graphicsLayer {
                alpha = enter.value
                translationY = (1f - enter.value) * 80f
            },
        ) {
            haptics.click()
            onShop()
        }
        RoleCard(
            title = "Sell on Yard",
            body = "Apply in under a minute. Run your shop from this app once you're in.",
            background = Color.yard.onAcid,
            foreground = Color.yard.onPhoto,
            graphic = { SellGraphic(Modifier.size(128.dp)) },
            modifier = Modifier.graphicsLayer {
                val t = ((enter.value - 0.15f) / 0.85f).coerceIn(0f, 1f)
                alpha = t
                translationY = (1f - t) * 120f
            },
        ) {
            haptics.click()
            onSell()
        }
        Text(
            "You can always do both with one account.",
            style = YardFonts.caption,
            color = Color.yard.ink3,
            modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = Spacing.s),
        )
    }
}

@Composable
private fun RoleCard(
    title: String,
    body: String,
    background: Color,
    foreground: Color,
    graphic: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .fillMaxWidth()
            .height(236.dp)
            .background(background, YardShapes.card)
            .pressableClick(pressedScale = 0.97f, onClickLabel = title, onClick = onClick)
            .padding(22.dp),
    ) {
        Box(Modifier.align(Alignment.TopEnd)) { graphic() }
        Column(Modifier.align(Alignment.BottomStart).widthIn(max = 260.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            YardDisplayText(title, size = 36.sp, color = foreground)
            Text(body, style = YardFonts.callout, color = foreground.copy(alpha = 0.78f))
        }
        Box(
            Modifier.align(Alignment.BottomEnd).size(48.dp).background(foreground, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, tint = background, modifier = Modifier.size(22.dp))
        }
    }
}

/** A neutral shopping graphic in shapes: a tilted bag with a handle, a tag and two sparkles. */
@Composable
private fun ShopGraphic(modifier: Modifier = Modifier) {
    val ink = Color.yard.onAcid
    val violet = Color.yard.violetFill
    val white = Color.yard.onPhoto
    Canvas(modifier) {
        val w = size.width
        rotate(-10f) {
            // Bag body.
            drawRoundRect(ink, topLeft = Offset(w * 0.18f, w * 0.34f), size = Size(w * 0.6f, w * 0.56f), cornerRadius = CornerRadius(w * 0.08f))
            // Handle.
            drawArc(ink, startAngle = 180f, sweepAngle = 180f, useCenter = false, topLeft = Offset(w * 0.32f, w * 0.18f), size = Size(w * 0.32f, w * 0.34f), style = Stroke(width = w * 0.06f))
            // A band across the bag.
            drawRect(white, topLeft = Offset(w * 0.18f, w * 0.52f), size = Size(w * 0.6f, w * 0.07f))
        }
        // A price tag.
        val tag = Path().apply {
            moveTo(w * 0.64f, w * 0.62f)
            lineTo(w * 0.9f, w * 0.62f)
            lineTo(w * 0.98f, w * 0.72f)
            lineTo(w * 0.9f, w * 0.82f)
            lineTo(w * 0.64f, w * 0.82f)
            close()
        }
        drawPath(tag, violet)
        drawCircle(white, radius = w * 0.025f, center = Offset(w * 0.89f, w * 0.72f))
        // Sparkles.
        sparkle(Offset(w * 0.1f, w * 0.16f), w * 0.09f, ink)
        sparkle(Offset(w * 0.9f, w * 0.18f), w * 0.06f, ink)
    }
}

/** The seller graphic: a shopfront with a striped awning and a violet door. */
@Composable
private fun SellGraphic(modifier: Modifier = Modifier) {
    val violet = Color.yard.violetFill
    val acid = Color.yard.acid
    val white = Color.yard.onPhoto
    Canvas(modifier) {
        val w = size.width
        // Building.
        drawRoundRect(white.copy(alpha = 0.12f), topLeft = Offset(w * 0.14f, w * 0.38f), size = Size(w * 0.72f, w * 0.52f), cornerRadius = CornerRadius(w * 0.04f))
        // Awning: alternating stripes with scalloped edge.
        val stripes = 5
        val sw = w * 0.8f / stripes
        for (i in 0 until stripes) {
            val x = w * 0.1f + i * sw
            drawRect(if (i % 2 == 0) violet else white, topLeft = Offset(x, w * 0.24f), size = Size(sw, w * 0.16f))
            drawCircle(if (i % 2 == 0) violet else white, radius = sw / 2f, center = Offset(x + sw / 2f, w * 0.4f))
        }
        // Door and window.
        drawRoundRect(violet, topLeft = Offset(w * 0.24f, w * 0.56f), size = Size(w * 0.18f, w * 0.34f), cornerRadius = CornerRadius(w * 0.03f))
        drawRoundRect(acid, topLeft = Offset(w * 0.5f, w * 0.56f), size = Size(w * 0.26f, w * 0.18f), cornerRadius = CornerRadius(w * 0.03f))
        sparkle(Offset(w * 0.9f, w * 0.12f), w * 0.08f, acid)
        sparkle(Offset(w * 0.08f, w * 0.14f), w * 0.05f, violet)
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.sparkle(center: Offset, r: Float, color: Color) {
    val p = Path().apply {
        moveTo(center.x, center.y - r)
        quadraticTo(center.x, center.y, center.x + r, center.y)
        quadraticTo(center.x, center.y, center.x, center.y + r)
        quadraticTo(center.x, center.y, center.x - r, center.y)
        quadraticTo(center.x, center.y, center.x, center.y - r)
        close()
    }
    drawPath(p, color)
}

/** One optional step for shoppers: categories they're into (saved like Welcome's picks), skippable. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun InterestsStep(categories: List<WelcomeCategory>, loading: Boolean, onDone: (List<String>) -> Unit) {
    val picks = remember { mutableStateListOf<String>() }
    val bg = Color.yard.acid
    val fg = Color.yard.onAcid
    Column(
        Modifier
            .fillMaxSize()
            .background(bg)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(horizontal = Spacing.gutter, vertical = Spacing.l),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Spacer(Modifier.weight(1f))
            Text(
                "Skip",
                style = YardFonts.bodyEmphasis,
                color = fg,
                modifier = Modifier.pressableClick(onClickLabel = "Skip") { onDone(emptyList()) }.padding(Spacing.s),
            )
        }
        YardDisplayText("Pick what you're into", size = 44.sp, color = fg, modifier = Modifier.padding(top = Spacing.l).semantics { heading() })
        Text("Your home feed starts with these. Change them any time.", style = YardFonts.callout, color = fg.copy(alpha = 0.75f), modifier = Modifier.padding(top = Spacing.s))
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(top = Spacing.xl)) {
            if (loading) {
                CircularProgressIndicator(color = fg, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
            } else {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                    categories.forEach { c ->
                        StudioBoldChip(c.title, selected = c.slug in picks, onColor = fg) {
                            if (c.slug in picks) picks.remove(c.slug) else picks.add(c.slug)
                        }
                    }
                }
            }
        }
        StudioBlackPill(if (picks.isEmpty()) "Start shopping" else "Start shopping (${picks.size})") { onDone(picks.toList()) }
    }
}
