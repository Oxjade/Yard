package space.yardstore.app.features.sell

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.State
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import kotlinx.coroutines.launch
import kotlin.math.abs
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
            graphic = { tilt -> ShopIllustration(Modifier.fillMaxSize(), tilt) },
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
            graphic = { tilt -> SellIllustration(Modifier.fillMaxSize(), tilt) },
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

/**
 * A big choice card with its animated illustration. Press: a subtle 3D tilt toward the finger with
 * the illustration's layers shifting by depth (parallax) and a tick; release springs back.
 */
@Composable
private fun RoleCard(
    title: String,
    body: String,
    background: Color,
    foreground: Color,
    graphic: @Composable (tilt: State<Offset>) -> Unit,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val haptics = rememberYardHaptics()
    val reduce = rememberReducedMotion()
    val tilt = remember { Animatable(Offset.Zero, Offset.VectorConverter) }
    val scope = rememberCoroutineScope()
    Box(
        modifier
            .fillMaxWidth()
            .height(300.dp)
            .pointerInput(reduce) {
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    haptics.tick()
                    val target = Offset(
                        ((down.position.x / size.width) - 0.5f) * 2f,
                        ((down.position.y / size.height) - 0.5f) * 2f,
                    )
                    scope.launch { if (reduce) tilt.snapTo(target) else tilt.animateTo(target, spring(dampingRatio = 0.7f, stiffness = 500f)) }
                    waitForUpOrCancellation()
                    scope.launch { if (reduce) tilt.snapTo(Offset.Zero) else tilt.animateTo(Offset.Zero, spring(dampingRatio = 0.45f, stiffness = 260f)) }
                }
            }
            .graphicsLayer {
                rotationY = tilt.value.x * 5f
                rotationX = -tilt.value.y * 5f
                cameraDistance = 14f * density
                val s = 1f - (abs(tilt.value.x) + abs(tilt.value.y)) * 0.012f
                scaleX = s
                scaleY = s
            }
            .clip(YardShapes.card)
            .background(background, YardShapes.card)
            .border(1.dp, Color.yard.line, YardShapes.card)
            .pressableClick(pressedScale = 1f, pressedAlpha = 1f, onClickLabel = title, onClick = onClick),
    ) {
        Box(Modifier.align(Alignment.TopEnd).offset(x = 4.dp, y = 2.dp).size(176.dp)) { graphic(tilt.asState()) }
        Column(
            Modifier.align(Alignment.BottomStart).padding(22.dp).widthIn(max = 250.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            YardDisplayText(title, size = 36.sp, color = foreground)
            Text(body, style = YardFonts.callout, color = foreground.copy(alpha = 0.78f))
        }
        Box(
            Modifier.align(Alignment.BottomEnd).padding(22.dp).size(48.dp).background(foreground, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, tint = background, modifier = Modifier.size(22.dp))
        }
    }
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
