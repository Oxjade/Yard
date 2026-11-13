package space.yardstore.app.features.around

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.components.BrandAvatar
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.SkeletonShape
import space.yardstore.app.designsystem.components.Tag
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.yard
import java.time.Instant

/**
 * A map pin: the brand's avatar in a ring with a pointer. Acid ring when selected; a small acid
 * dot when the place is live or open now. The pointer's tip is the bottom centre of the layout.
 */
@Composable
fun AroundPin(name: String, logoUrl: String?, isSelected: Boolean, isOpen: Boolean, modifier: Modifier = Modifier) {
    val ring = if (isSelected) Color.yard.acid else Color.yard.surface
    val avatar by animateDpAsState(if (isSelected) 42.dp else 34.dp, Motion.snappy(), label = "pin-size")
    Column(
        modifier.semantics(mergeDescendants = true) {
            contentDescription = name
            role = Role.Button
        },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box {
            Box(
                Modifier
                    .shadow(6.dp, CircleShape, ambientColor = Color.yard.scrim, spotColor = Color.yard.scrim)
                    .background(ring, CircleShape)
                    .padding(3.dp),
            ) {
                BrandAvatar(name = name, logoUrl = logoUrl, size = avatar)
            }
            if (isOpen) {
                Box(
                    Modifier
                        .align(Alignment.TopEnd)
                        .offset(x = 1.dp, y = (-1).dp)
                        .size(10.dp)
                        .background(Color.yard.acid, CircleShape)
                        .border(BorderStroke(1.5.dp, Color.yard.onAcid), CircleShape),
                )
            }
        }
        Canvas(Modifier.offset(y = (-2).dp).size(width = 12.dp, height = 8.dp)) {
            val path = Path().apply {
                moveTo(0f, 0f)
                lineTo(size.width, 0f)
                lineTo(size.width / 2, size.height)
                close()
            }
            drawPath(path, ring)
        }
    }
}

/** The shopper's position on the map (iOS `UserAnnotation`). */
@Composable
fun AroundUserDot(modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(18.dp)
            .shadow(4.dp, CircleShape, ambientColor = Color.yard.scrim, spotColor = Color.yard.scrim)
            .background(Color.yard.surface, CircleShape)
            .padding(3.dp)
            .background(Color.yard.violet, CircleShape)
            .clearAndSetSemantics { contentDescription = "Your location" },
    )
}

/** The status line with its dot: acid for live, success for open. */
@Composable
fun AroundStatusText(line: AroundStatusLine, modifier: Modifier = Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(Spacing.xs + 2.dp), verticalAlignment = Alignment.CenterVertically) {
        when (line.tone) {
            AroundStatusLine.Tone.Live -> Box(
                Modifier.size(6.dp).background(Color.yard.acid, CircleShape).border(BorderStroke(0.5.dp, Color.yard.line), CircleShape),
            )
            AroundStatusLine.Tone.Open -> Box(Modifier.size(6.dp).background(Color.yard.success, CircleShape))
            AroundStatusLine.Tone.Neutral -> Unit
        }
        Text(
            line.text,
            style = YardFonts.caption,
            color = if (line.tone == AroundStatusLine.Tone.Neutral) Color.yard.ink2 else Color.yard.ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * A row of the places list: avatar, brand, "{category} · {kind}" in the area, status, next event,
 * and the distance only when the shopper's location is known.
 */
@Composable
fun AroundPlaceRow(
    place: AroundPlace,
    logoUrl: String?,
    distanceText: String?,
    now: Instant,
    modifier: Modifier = Modifier,
    isSelected: Boolean = false,
) {
    val shape = RoundedCornerShape(Radius.card)
    Row(
        modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (isSelected) Color.yard.surface2 else Color.yard.surface, shape)
            .border(BorderStroke(1.dp, if (isSelected) Color.yard.purple else Color.yard.line), shape)
            .padding(Spacing.m)
            .semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
        verticalAlignment = Alignment.Top,
    ) {
        BrandAvatar(name = place.brand.name, logoUrl = logoUrl, size = 44.dp, verified = place.brand.verified)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    place.brand.name,
                    style = YardFonts.headline,
                    color = Color.yard.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (place.sample) Tag("Sample place")
                Spacer(Modifier.weight(1f))
                if (distanceText != null) {
                    Text(distanceText, style = YardFonts.caption.monospacedDigits(), color = Color.yard.ink2)
                }
            }
            Text(
                "${place.categoryKindText} · ${place.whereText}",
                style = YardFonts.caption,
                color = Color.yard.ink2,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            AroundTime.statusLine(place, now)?.let { AroundStatusText(it) }
            AroundTime.nextEventLine(place, now)?.let {
                Text(it, style = YardFonts.caption, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = Color.yard.ink3,
            modifier = Modifier.padding(top = Spacing.xs).size(18.dp),
        )
    }
}

/** Loading rows for the list. */
@Composable
fun AroundRowSkeleton(modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .background(Color.yard.surface, RoundedCornerShape(Radius.card))
            .padding(Spacing.m),
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Skeleton(Modifier.size(44.dp), shape = SkeletonShape.Circle)
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Skeleton(Modifier.size(width = 140.dp, height = 14.dp), cornerRadius = 6.dp)
            Skeleton(Modifier.size(width = 200.dp, height = 11.dp), cornerRadius = 6.dp)
            Skeleton(Modifier.size(width = 120.dp, height = 11.dp), cornerRadius = 6.dp)
        }
    }
}

@Composable
private fun AroundRowsPreviewContent() {
    Column(Modifier.padding(Spacing.l), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        AroundPlaceRow(AroundFixtures.store, logoUrl = null, distanceText = "1.2 km", now = Instant.now())
        AroundPlaceRow(AroundFixtures.popup, logoUrl = null, distanceText = null, now = Instant.now(), isSelected = true)
        AroundRowSkeleton()
        Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            AroundPin("Lagos Thread", logoUrl = null, isSelected = false, isOpen = true)
            AroundPin("Acme", logoUrl = null, isSelected = true, isOpen = false)
            AroundUserDot()
        }
        Spacer(Modifier.height(Spacing.s).width(1.dp))
    }
}

@Preview(name = "Around rows — dark")
@Composable
private fun AroundRowsDark() = YardPreview(darkTheme = true) { AroundRowsPreviewContent() }

@Preview(name = "Around rows — light")
@Composable
private fun AroundRowsLight() = YardPreview(darkTheme = false) { AroundRowsPreviewContent() }

