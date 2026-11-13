package space.yardstore.app.features.drops

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.Drop
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.Tag
import space.yardstore.app.designsystem.components.TagStyle
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.yard
import java.time.Duration
import java.time.Instant

// Cards used by DropsView and MyDropsView. Mirrors DropCards.swift.

/** Live now / entries open: a big photo card with the live pulse, brand, name and a ticking "Closes in" line. */
@Composable
fun DropLiveCard(drop: Drop, phase: DropLivePhase, modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .aspectRatio(4f / 5f)
            .clip(YardShapes.card)
            .semantics(mergeDescendants = true) { contentDescription = "${drop.name}, ${drop.brandName}, ${drop.statusLabel(phase)}" },
    ) {
        RemoteImage(drop.imageUrl, Modifier.fillMaxSize(), maxPixelSize = 1200)
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        0f to Color.yard.scrim.copy(alpha = 0f),
                        0.5f to Color.yard.scrim.copy(alpha = 0.15f),
                        1f to Color.yard.scrim.copy(alpha = 0.78f),
                    ),
                ),
        )
        Row(Modifier.align(Alignment.TopStart).padding(Spacing.m), horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            DropStatusBadge(drop, phase, onPhoto = true)
            if (drop.sponsored) Tag("Sponsored", style = TagStyle.OnPhoto)
        }
        Column(Modifier.align(Alignment.BottomStart).padding(Spacing.l), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Text(drop.brandName, style = YardFonts.captionEmphasis, color = Color.yard.onPhoto.copy(alpha = 0.85f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            YardDisplayText(drop.name, size = 38.sp, color = Color.yard.onPhoto, maxLines = 2)
            val target = drop.countdownTarget(phase, Instant.now())
            if (target != null) {
                val now by rememberDropsNow(1000)
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                    Text(target.label, style = YardFonts.caption, color = Color.yard.onPhoto)
                    Text(
                        Formatters.countdown(Duration.between(now, target.date)),
                        style = YardFonts.number(15.sp).monospacedDigits(),
                        color = Color.yard.onPhoto,
                    )
                }
            }
            Text(
                "${drop.accessLabel} · ${drop.runText} · limit ${drop.limitPerCustomer}",
                style = YardFonts.caption,
                color = Color.yard.onPhoto.copy(alpha = 0.75f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** Upcoming: a calendar row with the release time, a thumbnail, a live countdown and the bell. */
@Composable
fun DropCalendarRow(
    drop: Drop,
    now: Instant,
    reminderOn: Boolean,
    isBusy: Boolean,
    onOpen: () -> Unit,
    onToggleReminder: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val phase = drop.livePhase(now)
    val opens = drop.reminderOpenDate(now) ?: drop.startDate
    Row(
        modifier
            .fillMaxWidth()
            .clip(YardShapes.card)
            .background(Color.yard.surface)
            .border(1.dp, Color.yard.line, YardShapes.card)
            .padding(Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Row(
            Modifier.weight(1f).pressableClick(onClick = onOpen),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.m),
        ) {
            Column(Modifier.width(56.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    opens?.let { Formatters.time(it) } ?: "–",
                    style = YardFonts.number(17.sp).monospacedDigits(),
                    color = Color.yard.ink,
                    maxLines = 1,
                )
                Text(if (drop.isDrawWaiting(phase, now)) "Entries" else "Release", style = YardFonts.micro, color = Color.yard.ink3)
            }
            RemoteImage(
                drop.imageUrl,
                Modifier.size(width = 60.dp, height = 76.dp).clip(RoundedCornerShape(Radius.small)),
                maxPixelSize = 300,
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(drop.brandName, style = YardFonts.caption, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(drop.name, style = YardFonts.bodyEmphasis, color = Color.yard.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val target = drop.countdownTarget(phase, now)
                if (target != null) {
                    val tick by rememberDropsNow(1000)
                    Text(
                        "${target.label} ${Formatters.countdown(Duration.between(tick, target.date))}",
                        style = YardFonts.captionEmphasis.monospacedDigits(),
                        color = Color.yard.violet,
                    )
                }
                Text("${drop.accessLabel} · ${drop.runText}", style = YardFonts.caption, color = Color.yard.ink3, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        // 40dp circle (as on iOS) inside a 48dp touch target.
        Box(
            Modifier
                .size(48.dp)
                .pressableClick(
                    enabled = !isBusy,
                    role = Role.Button,
                    onClickLabel = if (reminderOn) "Remove reminder" else "Remind me",
                    onClick = onToggleReminder,
                )
                .semantics { contentDescription = if (reminderOn) "Reminder set for ${drop.name}" else "Remind me about ${drop.name}" },
            contentAlignment = Alignment.Center,
        ) {
            Box(
                Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(if (reminderOn) Color.yard.acid else Color.yard.surface2),
                contentAlignment = Alignment.Center,
            ) {
                val fg = if (reminderOn) Color.yard.onAcid else Color.yard.ink
                if (isBusy) {
                    CircularProgressIndicator(Modifier.size(16.dp), color = fg, strokeWidth = 2.dp)
                } else {
                    Icon(
                        if (reminderOn) Icons.Filled.Notifications else Icons.Outlined.Notifications,
                        contentDescription = null,
                        tint = fg,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
    }
}

/** Past drops: a masonry tile. */
@Composable
fun DropPastTile(drop: Drop, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Box(Modifier.fillMaxWidth().aspectRatio(4f / 5f).clip(YardShapes.image)) {
            RemoteImage(drop.imageUrl, Modifier.fillMaxSize(), maxPixelSize = 700)
            Tag(drop.statusLabel(DropLivePhase.Ended), Modifier.align(Alignment.TopStart).padding(Spacing.s), style = TagStyle.OnPhoto)
        }
        Column(Modifier.padding(horizontal = Spacing.xs), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(drop.name, style = YardFonts.captionEmphasis, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                drop.endDate?.let { "${drop.brandName} · ${Formatters.shortDate(it)}" } ?: drop.brandName,
                style = YardFonts.caption,
                color = Color.yard.ink2,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

object DropPastTileDefaults {
    val captionHeight = 52.dp
}

/** A row in "Your drops": thumbnail, brand, name, caption, optional entry status. */
@Composable
fun DropListRow(
    drop: Drop,
    caption: String,
    modifier: Modifier = Modifier,
    entryStatus: String? = null,
    footnote: String? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .clip(YardShapes.card)
            .background(Color.yard.surface)
            .padding(Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        RemoteImage(drop.imageUrl, Modifier.size(width = 72.dp, height = 90.dp).clip(RoundedCornerShape(Radius.small)), maxPixelSize = 300)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                Text(drop.brandName, style = YardFonts.caption, color = Color.yard.ink3, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (entryStatus != null) {
                    val status = DropText.entryStatus(entryStatus)
                    Tag(status.label, style = status.style)
                }
            }
            Text(drop.name, style = YardFonts.bodyEmphasis, color = Color.yard.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(caption, style = YardFonts.callout, color = Color.yard.ink2)
            if (footnote != null) Text(footnote, style = YardFonts.caption, color = Color.yard.ink3)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(18.dp))
    }
}

/** Loading placeholder for the drops calendar. */
@Composable
fun DropsSkeleton(modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = Spacing.gutter)
            .padding(top = Spacing.l)
            .semantics { contentDescription = "Loading drops" },
        verticalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        Skeleton(Modifier.size(width = 160.dp, height = 34.dp), cornerRadius = Radius.small)
        // Big cards: one 4:5 card on phones; a row of them on wide windows (as the loaded page lays them out).
        val window = LocalYardWindow.current
        val cards = dropsCardColumns(window)
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
            repeat(cards) { Skeleton(Modifier.weight(1f).aspectRatio(4f / 5f), cornerRadius = Radius.card) }
        }
        val perLine = dropsCalendarColumns(window)
        repeat(3) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
                repeat(perLine) { Skeleton(Modifier.weight(1f).height(100.dp), cornerRadius = Radius.card) }
            }
        }
        Spacer(Modifier.height(Spacing.l))
    }
}

@Composable
private fun DropCardsPreviewContent() {
    Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        DropLiveCard(DropsPreviewFixtures.live, DropLivePhase.Live, Modifier.width(260.dp))
        DropCalendarRow(DropsPreviewFixtures.upcoming, Instant.now(), reminderOn = true, isBusy = false, onOpen = {}, onToggleReminder = {})
        DropListRow(DropsPreviewFixtures.draw, caption = "Entered Thu 12 Nov, 10:00 · your time", entryStatus = "entered")
        DropPastTile(DropsPreviewFixtures.past, Modifier.width(170.dp))
    }
}

@Preview(name = "Drop cards — dark")
@Composable
private fun DropCardsDarkPreview() = YardPreview(darkTheme = true) { DropCardsPreviewContent() }

@Preview(name = "Drop cards — light")
@Composable
private fun DropCardsLightPreview() = YardPreview(darkTheme = false) { DropCardsPreviewContent() }
