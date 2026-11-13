package space.yardstore.app.features.charts

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.TrendingUp
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.ArrowDropUp
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.components.BrandAvatar
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.SkeletonShape
import space.yardstore.app.designsystem.components.Tag
import space.yardstore.app.designsystem.components.TagStyle
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardCard
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.yard
import java.time.Instant

// Building blocks of the Charts board (website: src/components/charts/*). Mirrors ChartsComponents.swift.

// region Movement chip

/** ▲n violet, ▼n red, "—" for no change, "New" and "Re-entry" spelled out (website RankMove). */
@Composable
fun ChartsRankMove(movement: ChartMovement, delta: Int, modifier: Modifier = Modifier) {
    val a11y = movement.words(delta)
    Box(modifier.clearAndSetSemantics { contentDescription = a11y }) {
        when (movement) {
            ChartMovement.New -> Tag("New", style = TagStyle.Acid)
            ChartMovement.Reentry -> Tag("Re-entry", style = TagStyle.Neutral)
            ChartMovement.Up -> ChartsArrowChip(Icons.Filled.ArrowDropUp, "${kotlin.math.abs(delta)}", Color.yard.violet)
            ChartMovement.Down -> ChartsArrowChip(Icons.Filled.ArrowDropDown, "${kotlin.math.abs(delta)}", Color.yard.danger)
            ChartMovement.Same -> ChartsArrowChip(null, "—", Color.yard.ink2)
        }
    }
}

@Composable
private fun ChartsArrowChip(icon: ImageVector?, text: String, color: Color) {
    Row(
        Modifier
            .defaultMinSize(minWidth = 34.dp, minHeight = 22.dp)
            .background(color.copy(alpha = 0.14f), YardShapes.pill)
            .padding(horizontal = 7.dp),
        horizontalArrangement = Arrangement.spacedBy(0.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(16.dp).padding(end = 0.dp))
        Text(text, style = YardFonts.captionEmphasis.monospacedDigits(), color = color, maxLines = 1)
    }
}

// endregion

// region Reason (stat) chip

/** Why the entry is here: "+1.2K new followers". Public-safe stats only (never revenue). */
@Composable
fun ChartsStatChip(stat: ChartStat, modifier: Modifier = Modifier, compact: Boolean = false) {
    if (stat.figure.isEmpty() && stat.caption.isEmpty()) return
    Row(
        modifier
            .background(Color.yard.surface2, YardShapes.pill)
            .border(BorderStroke(1.dp, Color.yard.line), YardShapes.pill)
            .padding(horizontal = Spacing.s, vertical = if (compact) 3.dp else 5.dp),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (stat.figure.isNotEmpty()) {
            Text(stat.figure, style = YardFonts.captionEmphasis.monospacedDigits(), color = Color.yard.ink, maxLines = 1)
        }
        if (stat.caption.isNotEmpty()) {
            Text(stat.caption, style = YardFonts.caption, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

// endregion

// region Edition line

/** "● Live  Weekly edition, 31 Oct – 6 Nov. Updated 2 min ago" ("Final" for a closed edition). */
@Composable
fun ChartsEditionLine(edition: ChartEditionInfo, period: ChartPeriod, modifier: Modifier = Modifier) {
    // TimelineView(.periodic(by: 30)): re-reads the clock every 30 s.
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            now = Instant.now()
        }
    }
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.CenterVertically) {
        Row(
            Modifier
                .height(26.dp)
                .background(Color.yard.surface2, YardShapes.pill)
                .padding(horizontal = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(7.dp)
                    .background(if (edition.isLive) Color.yard.acid else Color.yard.ink3, CircleShape)
                    .border(1.dp, Color.yard.line, CircleShape),
            )
            Text(
                if (edition.isLive) "Live" else "Final",
                style = YardFonts.captionEmphasis,
                color = if (edition.isLive) Color.yard.ink else Color.yard.ink2,
            )
        }
        val suffix = if (edition.isLive) ChartsFormat.updatedAgo(edition.computedAt, now)?.let { ". Updated $it" } ?: "" else ""
        val ink2 = Color.yard.ink2
        val ink3 = Color.yard.ink3
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = ink2)) { append(ChartsFormat.editionText(edition, period)) }
                withStyle(SpanStyle(color = ink3)) { append(suffix) }
            },
            style = YardFonts.caption.monospacedDigits(),
            maxLines = 2,
        )
    }
}

// endregion

// region Podium (ranks 1–3)

/**
 * Ranks 1–3 as editorial cards: #1 full width, #2 and #3 side by side beneath. Words sit on the
 * card's solid panel, never on the photo; the rank sits on a solid tab in the photo's corner
 * (acid for #1).
 *
 * Tablets (`isWide`): one row of three, #1 wider ([ChartsPodiumLayout.LEAD_WEIGHT]) with its photo
 * as tall as the others; a lone #1 gets a wide, height-capped photo instead of a 16:10 one at full width.
 */
@Composable
fun ChartsPodium(entries: List<ChartEntry>, period: ChartPeriod, modifier: Modifier = Modifier) {
    val router = LocalRouter.current
    val top = entries.take(3)
    val wide = LocalYardWindow.current.isWide
    if (wide && top.size > 1) {
        Row(modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
            top.forEachIndexed { i, entry ->
                val lead = i == 0
                ChartsPodiumCard(
                    entry, period, lead = lead,
                    photoAspect = if (lead) ChartsPodiumLayout.WIDE_LEAD_ASPECT else ChartsPodiumLayout.SIDE_ASPECT,
                    modifier = Modifier
                        .weight(if (lead) ChartsPodiumLayout.LEAD_WEIGHT else 1f)
                        .fillMaxHeight()
                        .chartsEntryClick(entry, period) { router.push(entry.route) },
                )
            }
            // Keep #1 and #2 at their podium widths when there is no #3.
            if (top.size == 2) Spacer(Modifier.weight(1f))
        }
        return
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        top.firstOrNull()?.let { first ->
            ChartsPodiumCard(
                first, period, lead = true,
                photoAspect = if (wide) ChartsPodiumLayout.SOLO_WIDE_ASPECT else ChartsPodiumLayout.LEAD_ASPECT,
                modifier = Modifier.chartsEntryClick(first, period) { router.push(first.route) },
            )
        }
        if (top.size > 1) {
            // As on iOS, a lone #2 fills the row.
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
                top.drop(1).forEach { entry ->
                    ChartsPodiumCard(
                        entry, period, lead = false,
                        modifier = Modifier.weight(1f).fillMaxHeight().chartsEntryClick(entry, period) { router.push(entry.route) },
                    )
                }
            }
        }
    }
}

/** Podium proportions (phone: 16:10 lead, 4:3 sides). */
internal object ChartsPodiumLayout {
    const val LEAD_ASPECT = 16f / 10f
    const val SIDE_ASPECT = 4f / 3f
    /** #1's share of the tablet row, against 1 for #2 and #3. */
    const val LEAD_WEIGHT = 1.3f
    /** #1's photo in the tablet row: as tall as a 4:3 photo on a card [LEAD_WEIGHT] times narrower. */
    const val WIDE_LEAD_ASPECT = SIDE_ASPECT * LEAD_WEIGHT
    /** A lone #1 on a tablet (no #2 / #3): wide, never taller than [MAX_PHOTO_HEIGHT_DP]. */
    const val SOLO_WIDE_ASPECT = 21f / 9f
    const val MAX_PHOTO_HEIGHT_DP = 420
}

private fun Modifier.chartsEntryClick(entry: ChartEntry, period: ChartPeriod, onClick: () -> Unit): Modifier {
    val text = entry.accessibilityText(period)
    return this.clearAndSetSemantics { contentDescription = text }.pressableClick(role = Role.Button, onClick = onClick)
}

@Composable
fun ChartsPodiumCard(
    entry: ChartEntry,
    period: ChartPeriod,
    lead: Boolean,
    modifier: Modifier = Modifier,
    photoAspect: Float = if (lead) ChartsPodiumLayout.LEAD_ASPECT else ChartsPodiumLayout.SIDE_ASPECT,
) {
    val imageUrl = entry.drop?.image?.url ?: entry.brand.cover?.url
    Column(
        modifier
            .fillMaxWidth()
            .clip(YardShapes.card)
            .background(Color.yard.surface)
            .border(
                BorderStroke(if (lead) 1.5.dp else 1.dp, if (lead) Color.yard.acid.copy(alpha = 0.6f) else Color.yard.line),
                YardShapes.card,
            ),
    ) {
        // Photo
        Box(
            Modifier
                .fillMaxWidth()
                .heightIn(max = ChartsPodiumLayout.MAX_PHOTO_HEIGHT_DP.dp)
                .aspectRatio(photoAspect)
                .background(Color.yard.surface2),
            contentAlignment = Alignment.Center,
        ) {
            if (imageUrl != null) {
                RemoteImage(imageUrl, Modifier.fillMaxSize(), maxPixelSize = if (lead) 1200 else 700)
            } else {
                BrandAvatar(entry.brand.name, size = if (lead) 72.dp else 48.dp)
            }
            // Rank tab
            Text(
                ChartsFormat.two(entry.rank),
                style = YardFonts.display(if (lead) 64.sp else 44.sp).monospacedDigits(),
                color = if (entry.rank == 1) Color.yard.onAcid else Color.yard.ink,
                maxLines = 1,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .background(
                        if (entry.rank == 1) Color.yard.acid else Color.yard.surface,
                        RoundedCornerShape(bottomEnd = Radius.small),
                    )
                    .padding(horizontal = if (lead) 12.dp else 9.dp)
                    .padding(top = if (lead) 4.dp else 2.dp),
            )
        }
        // Panel
        Column(
            Modifier.fillMaxWidth().padding(if (lead) Spacing.l else Spacing.m),
            verticalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.CenterVertically) {
                if (lead) {
                    BrandAvatar(entry.brand.name, size = 36.dp, verified = entry.drop == null && entry.brand.verified)
                }
                Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            entry.title,
                            style = if (lead) YardFonts.title else YardFonts.headline,
                            color = Color.yard.ink,
                            maxLines = if (lead) 1 else 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        if (entry.drop == null && entry.brand.verified && !lead) {
                            Icon(Icons.Filled.Verified, contentDescription = null, tint = Color.yard.violet, modifier = Modifier.size(14.dp))
                        }
                    }
                    Text(chartsPodiumSubtitle(entry), style = YardFonts.caption, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            ChartsStatChip(entry.stat, compact = !lead)
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.CenterVertically) {
                ChartsRankMove(entry.movement, entry.delta)
                Text(
                    entry.previousText(period),
                    style = YardFonts.caption.monospacedDigits(),
                    color = Color.yard.ink2,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

private fun chartsPodiumSubtitle(entry: ChartEntry): String {
    entry.drop?.let { return "${entry.brand.name}, ${it.statusLabel.lowercase()}" }
    val origin = entry.brand.originText
    return origin.ifEmpty { "@${entry.brand.handle}" }
}

// endregion

// region Rows (rank 4+)

/**
 * One ranked row: big rank numeral in the display face, movement, avatar, name, origin, reason
 * chip and history line. The whole row opens the storefront (or the drop).
 */
@Composable
fun ChartsRow(entry: ChartEntry, period: ChartPeriod, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(
        modifier
            .fillMaxWidth()
            .chartsEntryClick(entry, period, onClick)
            .padding(vertical = Spacing.m),
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.width(50.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Text(ChartsFormat.two(entry.rank), style = YardFonts.display(34.sp).monospacedDigits(), color = Color.yard.ink, maxLines = 1)
            ChartsRankMove(entry.movement, entry.delta)
        }

        val dropImage = entry.drop?.image?.url
        if (dropImage != null) {
            RemoteImage(dropImage, Modifier.size(44.dp).clip(YardShapes.small), maxPixelSize = 160)
        } else {
            BrandAvatar(entry.brand.name, size = 44.dp, verified = entry.brand.verified)
        }

        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    entry.title, style = YardFonts.headline, color = Color.yard.ink, maxLines = 1,
                    overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
                )
                entry.drop?.let { drop ->
                    Tag(
                        drop.statusLabel,
                        style = when (drop.status) {
                            "live" -> TagStyle.Acid
                            "upcoming" -> TagStyle.Violet
                            else -> TagStyle.Neutral
                        },
                    )
                }
            }
            Text(
                if (entry.drop != null) entry.brand.name else entry.brand.originText.ifEmpty { "@${entry.brand.handle}" },
                style = YardFonts.caption, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            ChartsStatChip(entry.stat, compact = true)
            Text(chartsHistoryText(entry, period), style = YardFonts.caption.monospacedDigits(), color = Color.yard.ink3, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }

        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(18.dp))
    }
}

/** "Last week 7 · Peak 2 · 6 wks", or "New this week" / "Back on the chart". */
private fun chartsHistoryText(entry: ChartEntry, period: ChartPeriod): String = when (entry.movement) {
    ChartMovement.New, ChartMovement.Reentry -> entry.previousText(period)
    else -> buildList {
        entry.prevRank?.let { add("${period.previous} $it") }
        add("Peak ${entry.peak}")
        add(period.unit(entry.editionsOnChart))
    }.joinToString(" · ")
}

// endregion

// region Callouts

/** Biggest climber and Highest debut, above row 4; hidden when the subject is on the podium. */
@Composable
fun ChartsCallouts(callouts: ChartCallouts, period: ChartPeriod, modifier: Modifier = Modifier) {
    val router = LocalRouter.current
    val up = chartsOffPodium(callouts.biggestClimber)
    val debut = chartsOffPodium(callouts.highestDebut)
    if (up == null && debut == null) return
    Row(modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
        if (up != null) {
            ChartsCallout(up, Icons.AutoMirrored.Outlined.TrendingUp, "Biggest climber", "Up ${up.delta} to #${up.rank}", Modifier.weight(1f).fillMaxHeight()) {
                router.push(up.route)
            }
        }
        if (debut != null) {
            ChartsCallout(debut, Icons.Outlined.AutoAwesome, "Highest debut", "New at #${debut.rank}", Modifier.weight(1f).fillMaxHeight()) {
                router.push(debut.route)
            }
        }
    }
}

fun chartsOffPodium(entry: ChartEntry?): ChartEntry? = entry?.takeIf { it.rank > 3 }

@Composable
private fun ChartsCallout(entry: ChartEntry, icon: ImageVector, heading: String, line: String, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier
            .pressableClick(role = Role.Button, onClick = onClick)
            .yardCard(radius = Radius.image)
            .padding(Spacing.m),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = Color.yard.ink2, modifier = Modifier.size(14.dp))
            Text(heading, style = YardFonts.captionEmphasis, color = Color.yard.ink2)
        }
        Text(entry.title, style = YardFonts.headline, color = Color.yard.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(line, style = YardFonts.caption.monospacedDigits(), color = Color.yard.ink2)
    }
}

// endregion

// region Sponsored strip

/** Paid placements, after rank 10 (or after the list): labelled, never inside the ranking. */
@Composable
fun ChartsSponsoredStrip(items: List<ChartSponsored>, modifier: Modifier = Modifier) {
    if (items.isEmpty()) return
    val router = LocalRouter.current
    Column(
        modifier
            .fillMaxWidth()
            .yardCard(background = Color.yard.surface, radius = Radius.image)
            .padding(Spacing.m),
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Text("Sponsored", style = YardFonts.captionEmphasis, color = Color.yard.ink)
            Spacer(Modifier.width(Spacing.s))
            Text(
                "Paid placements. They never change chart positions.",
                style = YardFonts.micro, color = Color.yard.ink3, textAlign = TextAlign.End,
                modifier = Modifier.weight(1f),
            )
        }
        items.forEach { item ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .defaultMinSize(minHeight = 52.dp)
                    .pressableClick(role = Role.Button) { router.push(item.route) },
                horizontalArrangement = Arrangement.spacedBy(Spacing.m),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val url = item.drop?.image?.url ?: item.brand.cover?.url
                if (url != null) {
                    RemoteImage(url, Modifier.size(52.dp).clip(YardShapes.small), maxPixelSize = 200)
                } else {
                    BrandAvatar(item.brand.name, size = 52.dp)
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(item.drop?.name ?: item.brand.name, style = YardFonts.headline, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(chartsSponsoredSubtitle(item), style = YardFonts.caption, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Tag("Sponsored")
            }
        }
    }
}

private fun chartsSponsoredSubtitle(item: ChartSponsored): String {
    item.drop?.let { return "${item.brand.name}, ${it.statusLabel.lowercase()}" }
    return listOf(item.brand.city, item.brand.countryName).filter { it.isNotEmpty() }.joinToString(", ")
}

// endregion

// region Skeleton

@Composable
fun ChartsBoardSkeleton(modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().semantics { contentDescription = "Loading chart" }, verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        if (LocalYardWindow.current.isWide) {
            // Same shape as the tablet podium: one row of three, #1 wider.
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
                Skeleton(Modifier.weight(ChartsPodiumLayout.LEAD_WEIGHT).height(300.dp), cornerRadius = Radius.card)
                Skeleton(Modifier.weight(1f).height(300.dp), cornerRadius = Radius.card)
                Skeleton(Modifier.weight(1f).height(300.dp), cornerRadius = Radius.card)
            }
        } else {
            Skeleton(Modifier.fillMaxWidth().height(300.dp), cornerRadius = Radius.card)
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
                Skeleton(Modifier.weight(1f).height(230.dp), cornerRadius = Radius.card)
                Skeleton(Modifier.weight(1f).height(230.dp), cornerRadius = Radius.card)
            }
        }
        repeat(6) {
            Row(Modifier.padding(vertical = Spacing.s), horizontalArrangement = Arrangement.spacedBy(Spacing.m), verticalAlignment = Alignment.CenterVertically) {
                Skeleton(Modifier.size(width = 44.dp, height = 34.dp), cornerRadius = 6.dp)
                Skeleton(Modifier.size(44.dp), shape = SkeletonShape.Circle)
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Skeleton(Modifier.size(width = 150.dp, height = 12.dp), cornerRadius = 4.dp)
                    Skeleton(Modifier.size(width = 100.dp, height = 10.dp), cornerRadius = 4.dp)
                    Skeleton(Modifier.size(width = 120.dp, height = 18.dp), shape = SkeletonShape.Capsule)
                }
            }
        }
    }
}

// endregion

// region Previews (preview-only data)

internal object ChartsPreviewData {
    fun entry(rank: Int, name: String, movement: ChartMovement, delta: Int, prev: Int?): ChartEntry = ChartEntry.make(
        rank = rank,
        prevRank = prev,
        movement = movement,
        delta = delta,
        peak = maxOf(1, rank - 1),
        editionsOnChart = 4,
        subject = ChartSubject(type = "brand", id = "brd_$rank"),
        brand = ChartBrand(
            id = "brd_$rank", handle = "brand$rank", name = name, verified = rank % 2 == 1,
            city = "Lagos", country = "NG", countryName = "Nigeria", category = "Streetwear",
        ),
        stat = ChartStat(label = "${rank * 40} new followers", figure = "+${300 - rank * 20}", caption = "new followers"),
    )

    val board: ChartBoard = ChartBoard.make(
        chart = ChartSlug.Top,
        period = ChartPeriod.Weekly,
        scope = ChartScopeInfo(key = "global"),
        state = ChartBoardState.Ok,
        edition = ChartEditionInfo(date = "2026-11-13", status = "live", computedAt = "2026-11-13T10:00:00.000Z", window = ChartEditionInfo.Window("2026-11-07", "2026-11-13")),
        cohortSize = 8,
        entries = listOf(
            entry(1, "Acme Studio", ChartMovement.Up, 2, 3),
            entry(2, "Lagos Thread", ChartMovement.Down, -1, 1),
            entry(3, "Night Shift", ChartMovement.New, 0, null),
            entry(4, "Ore Works", ChartMovement.Same, 0, 4),
            entry(5, "Kiln", ChartMovement.Up, 4, 9),
            entry(6, "Halfmoon", ChartMovement.Reentry, 0, null),
        ),
    )
}

@Composable
private fun ChartsPartsPreviewContent(showSkeleton: Boolean) {
    Column(
        Modifier.fillMaxSize().background(Color.yard.bg).verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        ChartsEditionLine(ChartsPreviewData.board.edition!!, ChartPeriod.Weekly)
        ChartsPodium(ChartsPreviewData.board.entries, ChartPeriod.Weekly)
        ChartsPreviewData.board.entries.drop(3).forEach { ChartsRow(it, ChartPeriod.Weekly) {} }
        if (showSkeleton) ChartsBoardSkeleton()
    }
}

@Preview(name = "Charts parts — dark", heightDp = 1400)
@Composable
private fun ChartsPartsDarkPreview() = YardPreview(darkTheme = true) { ChartsPartsPreviewContent(showSkeleton = true) }

@YardTabletPreviews
@Composable
private fun ChartsPartsTabletPreview() = YardPreview(darkTheme = true) { ChartsPartsPreviewContent(showSkeleton = true) }

@Preview(name = "Charts parts — light", heightDp = 1100)
@Composable
private fun ChartsPartsLightPreview() = YardPreview(darkTheme = false) { ChartsPartsPreviewContent(showSkeleton = false) }

// endregion
