package space.yardstore.app.features.auth

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.models.BrandCard
import space.yardstore.app.core.stores.LocalFollowStore
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.PreviewFixtures
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.BrandAvatar
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.LocalBackAction
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.SkeletonShape
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardPillSurface
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardCard
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.yard

/**
 * Shopper onboarding (the website's /welcome, welcome-flow.tsx): what you shop for, which looks
 * feel like you, then brands to start with. Every step can be skipped. Answers are kept on this
 * device ([AuthOnboarding] keys), like the website keeps them per browser. Mirrors WelcomeView.swift.
 *
 * Shown inside sign-in after a first sign-in on this device, or pushed as `Route.Welcome`.
 */
@Composable
fun WelcomeView() {
    val model: WelcomeModel = viewModel { WelcomeModel() }
    WelcomeScreen(model)
}

private data class WelcomeStepCopy(val title: String, val body: String)

private val welcomeSteps = listOf(
    WelcomeStepCopy("What do you shop for?", "Pick as many as you like. We use them to order Discover and suggest brands."),
    WelcomeStepCopy("Which looks feel like you?", "Looks cut across categories. Pick any that fit, or skip."),
    WelcomeStepCopy("Brands to start with", "Picked from your answers. Follow a few and their new pieces, drops and stories fill your Following feed."),
)

/** Pure copy helpers (unit-tested). */
internal object WelcomeCopy {
    fun followingText(n: Int): String =
        if (n == 0) "Not following anyone yet. You can always follow brands later."
        else "Following $n ${if (n == 1) "brand" else "brands"}."

    fun continueTitle(picks: Int): String =
        if (picks > 0) "Continue with $picks ${if (picks == 1) "pick" else "picks"}" else "Continue"

    fun finishMessage(picked: Int, newFollows: Int): String {
        var message = "You're set. "
        message += if (picked > 0) "Discover now leads with what you picked." else "Discover shows a bit of everything for now."
        if (newFollows > 0) message += " Following $newFollows new ${if (newFollows == 1) "brand" else "brands"}."
        return message
    }

    const val SKIPPED = "Setup skipped. You can add interests any time in Settings."
}

/**
 * The Welcome flow. [onFinish] closes it (default: dismiss the sheet or pop); sign-in passes its
 * own close so finishing Welcome also leaves sign-in.
 */
@Composable
internal fun WelcomeScreen(model: WelcomeModel, initialStep: Int = 0, onFinish: (() -> Unit)? = null) {
    val session = LocalSessionStore.current
    val follows = LocalFollowStore.current
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val back = LocalBackAction.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()

    var step by rememberSaveable { mutableIntStateOf(initialStep) }
    var forward by remember { mutableStateOf(true) }
    val cats = remember { mutableStateListOf<String>().apply { addAll(AuthOnboarding.split(AuthOnboarding.interests)) } }
    val looks = remember { mutableStateListOf<String>().apply { addAll(AuthOnboarding.split(AuthOnboarding.aesthetics)) } }
    val followingAtStart = remember { follows.followedIds.size }
    val followBusy = remember { mutableStateListOf<String>() }

    LaunchedEffect(Unit) { if (!model.categoriesLoaded) model.loadCategories() }
    LaunchedEffect(step) { if (step == 2) model.loadSuggestions(cats.toList()) }

    fun close() {
        if (onFinish != null) onFinish()
        else if (router.sheet != null) router.dismissSheet()
        else back?.perform() ?: router.pop()
    }

    fun go(to: Int) {
        val clamped = to.coerceIn(0, 2)
        forward = clamped > step
        step = clamped
    }

    fun toggle(value: String, list: SnapshotStateList<String>) {
        if (!list.remove(value)) list.add(value)
        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
    }

    fun finish(save: Boolean) {
        if (save) {
            AuthOnboarding.interests = AuthOnboarding.join(cats)
            AuthOnboarding.aesthetics = AuthOnboarding.join(looks)
        }
        AuthOnboarding.onboarded = true
        val newFollows = maxOf(0, follows.followedIds.size - followingAtStart)
        if (save) {
            toast.show(WelcomeCopy.finishMessage(cats.size + looks.size, newFollows), Toast.Style.Success)
        } else {
            toast.show(WelcomeCopy.SKIPPED, Toast.Style.Info)
        }
        close()
    }

    /** Skipping a step leaves that answer as it was before onboarding. */
    fun skip() {
        when (step) {
            0 -> { cats.clear(); cats.addAll(AuthOnboarding.split(AuthOnboarding.interests)); go(1) }
            1 -> { looks.clear(); looks.addAll(AuthOnboarding.split(AuthOnboarding.aesthetics)); go(2) }
            else -> finish(save = true)
        }
    }

    fun follow(brand: BrandCard) {
        if (brand.id in followBusy) return
        followBusy += brand.id
        scope.launch {
            try {
                val result = follows.toggle(brand.id)
                if (result.following) haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                toast.show(e)
            } finally {
                followBusy -= brand.id
            }
        }
    }

    BackHandler(enabled = session.isSignedIn && step > 0) { go(step - 1) }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        if (!session.isSignedIn) {
            YardTopBar(title = null)
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                EmptyState.SignedOut(
                    title = "Make it yours",
                    message = "Sign in and tell us what you shop for. Three quick picks, under a minute, and Discover starts with your kind of brands.",
                ) { router.present(Route.SignIn) }
            }
            return@Column
        }
        // The back button is hidden while signed in (iOS `.navigationBarBackButtonHidden`).
        YardTopBar(title = null, back = null) {
            Text(
                "Skip setup",
                style = YardFonts.callout,
                color = Color.yard.ink2,
                modifier = Modifier.pressableClick { finish(save = false) }.padding(Spacing.s),
            )
        }
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Spacing.gutter)
                .padding(top = Spacing.s, bottom = Spacing.xl),
            verticalArrangement = Arrangement.spacedBy(Spacing.xl),
        ) {
            WelcomeProgressHeader(session.shopper?.firstName, step)
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                YardDisplayText(welcomeSteps[step].title, size = 40.sp, modifier = Modifier.semantics { heading() })
                Text(welcomeSteps[step].body, style = YardFonts.callout, color = Color.yard.ink2)
            }
            AnimatedContent(
                targetState = step,
                transitionSpec = {
                    (slideInHorizontally(Motion.spring()) { if (forward) it else -it } + fadeIn(Motion.fade()))
                        .togetherWith(fadeOut(Motion.fade()))
                },
                label = "welcome-step",
            ) { s ->
                when (s) {
                    0 -> WelcomeCategoriesStep(model, cats) { toggle(it, cats) }
                    1 -> WelcomeChips {
                        for (look in WelcomeLook.all) {
                            WelcomePickChip(look.label, imageUrl = null, showsImage = false, isSelected = look.slug in looks) { toggle(look.slug, looks) }
                        }
                    }
                    else -> WelcomeBrandsStep(
                        suggestions = model.suggestions,
                        isFollowing = { follows.isFollowing(it) },
                        isBusy = { it in followBusy },
                        followingCount = follows.followedIds.size,
                        onFollow = { follow(it) },
                    )
                }
            }
        }
        WelcomeBottomBar(
            step = step,
            picks = when (step) { 0 -> cats.size; 1 -> looks.size; else -> 0 },
            onBack = { go(step - 1) },
            onSkip = { skip() },
            onContinue = { go(step + 1) },
            onFinish = { finish(save = true) },
        )
    }
}

@Composable
private fun WelcomeProgressHeader(firstName: String?, step: Int) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        if (firstName != null) {
            Text("Welcome, $firstName", style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold), color = Color.yard.violet)
        }
        Row(
            Modifier.semantics { contentDescription = "Setup progress, step ${step + 1} of 3" },
            horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            for (index in 0 until 3) {
                val color by animateColorAsState(if (index <= step) Color.yard.violet else Color.yard.line, Motion.spring(), label = "progress")
                Box(Modifier.weight(1f).height(4.dp).background(color, YardShapes.pill))
            }
        }
        Text("Step ${step + 1} of 3, about a minute in all", style = YardFonts.caption, color = Color.yard.ink3)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WelcomeChips(content: @Composable () -> Unit) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) { content() }
}

@Composable
private fun WelcomeCategoriesStep(model: WelcomeModel, cats: List<String>, onToggle: (String) -> Unit) {
    val error = model.categoriesError
    when {
        !model.categoriesLoaded && error == null -> WelcomeChips {
            for (w in listOf(120, 96, 140, 110, 88, 130, 104, 118)) {
                Skeleton(Modifier.width(w.dp).height(48.dp), shape = SkeletonShape.Capsule)
            }
        }
        error != null && model.categories.isEmpty() -> EmptyState.Error(error) { model.loadCategories() }
        model.categories.isEmpty() -> EmptyState(
            "No categories yet",
            message = "Categories appear as brands list their pieces. Skip this step for now.",
            icon = Icons.Outlined.GridView,
        )
        else -> WelcomeChips {
            for (category in model.categories) {
                WelcomePickChip(category.title, imageUrl = category.imageUrl, showsImage = true, isSelected = category.slug in cats) { onToggle(category.slug) }
            }
        }
    }
}

@Composable
private fun WelcomeBrandsStep(
    suggestions: List<BrandCard>?,
    isFollowing: (String) -> Boolean,
    isBusy: (String) -> Boolean,
    followingCount: Int,
    onFollow: (BrandCard) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        when {
            suggestions == null -> repeat(3) { Skeleton(Modifier.fillMaxWidth().height(84.dp), cornerRadius = Radius.card) }
            suggestions.isEmpty() -> EmptyState(
                "Brands are joining Yard — follow along",
                modifier = Modifier.yardCard(),
                message = "Independent studios are setting up their storefronts now. Their pieces, drops and stories appear here the day they open.",
                icon = Icons.Outlined.Storefront,
            )
            else -> for (brand in suggestions) {
                androidx.compose.runtime.key(brand.id) {
                    WelcomeBrandRow(brand, isFollowing(brand.id), isBusy(brand.id)) { onFollow(brand) }
                }
            }
        }
        Text(WelcomeCopy.followingText(followingCount), style = YardFonts.callout, color = Color.yard.ink2, modifier = Modifier.padding(top = Spacing.xs))
    }
}

@Composable
private fun WelcomeBottomBar(
    step: Int,
    picks: Int,
    onBack: () -> Unit,
    onSkip: () -> Unit,
    onContinue: () -> Unit,
    onFinish: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Color.yard.surface)
            .navigationBarsPadding(),
    ) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(Color.yard.line))
        Column(
            Modifier.padding(start = Spacing.gutter, end = Spacing.gutter, top = Spacing.m, bottom = Spacing.s),
            verticalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            if (step < 2 && picks == 0) {
                Text(
                    "Pick at least one to continue, or skip this step.",
                    style = YardFonts.caption,
                    color = Color.yard.ink3,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.CenterVertically) {
                if (step > 0) {
                    YardPillSurface(
                        style = YardButtonStyle.Secondary,
                        modifier = Modifier.size(YardButtonSize.Large.height).semantics { contentDescription = "Back" },
                        onClick = onBack,
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(20.dp))
                    }
                }
                YardButton(if (step == 2) "Skip and finish" else "Skip", style = YardButtonStyle.Secondary, fullWidth = false, onClick = onSkip)
                if (step < 2) {
                    YardButton(WelcomeCopy.continueTitle(picks), modifier = Modifier.weight(1f), enabled = picks > 0, onClick = onContinue)
                } else {
                    YardButton("Finish", modifier = Modifier.weight(1f), onClick = onFinish)
                }
            }
        }
    }
}

/** A large pick chip with an optional round photo at its start. */
@Composable
private fun WelcomePickChip(title: String, imageUrl: String?, showsImage: Boolean, isSelected: Boolean, onClick: () -> Unit) {
    val bg by animateColorAsState(if (isSelected) Color.yard.ink else Color.yard.surface2, Motion.snappy(), label = "chip-bg")
    val fg by animateColorAsState(if (isSelected) Color.yard.bg else Color.yard.ink, Motion.snappy(), label = "chip-fg")
    Row(
        Modifier
            .height(48.dp)
            .clip(YardShapes.pill)
            .background(bg, YardShapes.pill)
            .then(if (isSelected) Modifier else Modifier.border(1.dp, Color.yard.line, YardShapes.pill))
            .semantics { selected = isSelected }
            .pressableClick(onClick = onClick)
            .padding(start = if (showsImage) 6.dp else Spacing.l, end = Spacing.l),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        if (showsImage) {
            RemoteImage(imageUrl, Modifier.size(36.dp).clip(CircleShape), maxPixelSize = 120)
        }
        Text(title, style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold), color = fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
        AnimatedVisibility(visible = isSelected, enter = scaleIn() + fadeIn(), exit = scaleOut() + fadeOut()) {
            Icon(Icons.Filled.Check, contentDescription = null, tint = fg, modifier = Modifier.size(14.dp))
        }
    }
}

/** A suggested brand: cover (when it has one), avatar, name, place, Follow. */
@Composable
private fun WelcomeBrandRow(brand: BrandCard, isFollowing: Boolean, isBusy: Boolean, onFollow: () -> Unit) {
    Column(Modifier.fillMaxWidth().yardCard()) {
        if (brand.coverUrl != null) {
            RemoteImage(brand.coverUrl, Modifier.fillMaxWidth().height(120.dp), maxPixelSize = 900)
        }
        Row(
            Modifier.padding(Spacing.m),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.m),
        ) {
            BrandAvatar(brand.name, logoUrl = brand.logoUrl, size = 44.dp, verified = brand.verified)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(brand.name, style = YardFonts.headline, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (brand.locationText.isNotEmpty()) {
                    Text(brand.locationText, style = YardFonts.caption, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Spacer(Modifier.width(Spacing.xs))
            YardButton(
                if (isFollowing) "Following" else "Follow",
                modifier = Modifier.semantics { contentDescription = if (isFollowing) "Following ${brand.name}" else "Follow ${brand.name}" },
                style = if (isFollowing) YardButtonStyle.Inverted else YardButtonStyle.Primary,
                size = YardButtonSize.Small,
                isLoading = isBusy,
                fullWidth = false,
                onClick = onFollow,
            )
        }
    }
}

// region Previews

@Preview(name = "WelcomeView — dark")
@Composable
private fun WelcomeDarkPreview() = YardPreview(darkTheme = true) {
    WelcomeScreen(
        remember {
            WelcomeModel(
                previewCategories = listOf(
                    WelcomeCategory("tops", "Tops"),
                    WelcomeCategory("outerwear", "Outerwear"),
                    WelcomeCategory("bottoms", "Bottoms"),
                    WelcomeCategory("accessories", "Accessories"),
                ),
            )
        },
    )
}

@Preview(name = "WelcomeView — light")
@Composable
private fun WelcomeLightPreview() = YardPreview(darkTheme = false) {
    WelcomeScreen(remember { WelcomeModel(previewCategories = emptyList(), previewSuggestions = listOf(PreviewFixtures.brandCard)) }, initialStep = 2)
}

@Preview(name = "WelcomeView signed out — dark")
@Composable
private fun WelcomeSignedOutPreview() = YardPreview(darkTheme = true, signedIn = false) {
    WelcomeScreen(remember { WelcomeModel(previewCategories = emptyList()) })
}

// endregion
