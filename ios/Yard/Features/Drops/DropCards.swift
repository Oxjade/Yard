import SwiftUI

// Cards used by DropsView and MyDropsView.

/// Live now / entries open: a big photo card with the live pulse, brand, name and a ticking
/// "Closes in" line, all over the image.
struct DropLiveCard: View {
    let drop: Drop
    let phase: DropLivePhase

    var body: some View {
        Color.clear
            .aspectRatio(4.0 / 5.0, contentMode: .fit)
            .overlay {
                RemoteImage(url: drop.imageURL, maxPixelSize: 1200)
            }
            .overlay {
                LinearGradient(
                    colors: [Color.yard.scrim.opacity(0), Color.yard.scrim.opacity(0.15), Color.yard.scrim.opacity(0.78)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
            .overlay(alignment: .topLeading) {
                HStack(spacing: Spacing.xs) {
                    DropStatusBadge(drop: drop, phase: phase, onPhoto: true)
                    if drop.sponsored { Tag("Sponsored", style: .onPhoto) }
                }
                .padding(Spacing.m)
            }
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(drop.brandName)
                        .font(.yardCaptionEmphasis)
                        .foregroundStyle(Color.yard.onPhoto.opacity(0.85))
                        .lineLimit(1)
                    Text(drop.name)
                        .yardDisplay(38)
                        .foregroundStyle(Color.yard.onPhoto)
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                    if let target = drop.countdownTarget(phase, now: Date()) {
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            HStack(spacing: Spacing.xs) {
                                Text(target.label)
                                    .font(.yardCaption)
                                Text(Formatters.countdown(target.date.timeIntervalSince(context.date)))
                                    .font(.yardNumber(15))
                                    .monospacedDigit()
                            }
                            .foregroundStyle(Color.yard.onPhoto)
                        }
                    }
                    Text("\(drop.accessLabel) · \(drop.runText) · limit \(drop.limitPerCustomer)")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.onPhoto.opacity(0.75))
                        .lineLimit(1)
                }
                .padding(Spacing.l)
            }
            .clipShape(.yardCard)
            .contentShape(Rectangle())
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text("\(drop.name), \(drop.brandName), \(drop.statusLabel(phase))"))
    }
}

/// Upcoming: a calendar row with the release time, a thumbnail, a live countdown and the bell.
struct DropCalendarRow: View {
    let drop: Drop
    let now: Date
    let reminderOn: Bool
    let isBusy: Bool
    let onToggleReminder: () -> Void

    var body: some View {
        let phase = drop.livePhase(at: now)
        let opens = drop.reminderOpenDate(now: now) ?? drop.startDate
        HStack(alignment: .center, spacing: Spacing.m) {
            NavigationLink(value: Route.drop(id: drop.slug)) {
                HStack(alignment: .center, spacing: Spacing.m) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(opens.map { Formatters.time($0) } ?? "–")
                            .font(.yardNumber(17))
                            .foregroundStyle(Color.yard.ink)
                            .monospacedDigit()
                        Text(drop.isDrawWaiting(phase, now: now) ? "Entries" : "Release")
                            .font(.yardMicro)
                            .foregroundStyle(Color.yard.ink3)
                    }
                    .frame(width: 56, alignment: .leading)

                    RemoteImage(url: drop.imageURL, maxPixelSize: 300)
                        .frame(width: 60, height: 76)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))

                    VStack(alignment: .leading, spacing: 3) {
                        Text(drop.brandName)
                            .font(.yardCaption)
                            .foregroundStyle(Color.yard.ink2)
                            .lineLimit(1)
                        Text(drop.name)
                            .font(.yardBodyEmphasis)
                            .foregroundStyle(Color.yard.ink)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        if let target = drop.countdownTarget(phase, now: now) {
                            TimelineView(.periodic(from: .now, by: 1)) { context in
                                Text("\(target.label) \(Formatters.countdown(target.date.timeIntervalSince(context.date)))")
                                    .font(.yardCaptionEmphasis)
                                    .monospacedDigit()
                                    .foregroundStyle(Color.yard.violet)
                            }
                        }
                        Text("\(drop.accessLabel) · \(drop.runText)")
                            .font(.yardCaption)
                            .foregroundStyle(Color.yard.ink3)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(PressableButtonStyle())

            Button(action: onToggleReminder) {
                ZStack {
                    Circle()
                        .fill(reminderOn ? Color.yard.acid : Color.yard.surface2)
                    if isBusy {
                        ProgressView()
                            .controlSize(.small)
                            .tint(reminderOn ? Color.yard.onAcid : Color.yard.ink)
                    } else {
                        Image(systemName: reminderOn ? "bell.fill" : "bell")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(reminderOn ? Color.yard.onAcid : Color.yard.ink)
                    }
                }
                .frame(width: 40, height: 40)
            }
            .buttonStyle(PressableButtonStyle())
            .disabled(isBusy)
            .accessibilityLabel(Text(reminderOn ? "Reminder set for \(drop.name)" : "Remind me about \(drop.name)"))
            .sensoryFeedback(.selection, trigger: reminderOn)
        }
        .padding(Spacing.m)
        .background(
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .fill(Color.yard.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(Color.yard.line, lineWidth: 1)
        )
    }
}

/// Past drops: a masonry tile.
struct DropPastTile: View {
    let drop: Drop

    static let captionHeight: CGFloat = 52

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Color.clear
                .aspectRatio(4.0 / 5.0, contentMode: .fit)
                .overlay { RemoteImage(url: drop.imageURL, maxPixelSize: 700) }
                .overlay(alignment: .topLeading) {
                    Tag(drop.statusLabel(.ended), style: .onPhoto)
                        .padding(Spacing.s)
                }
                .clipShape(.yardImage)
            VStack(alignment: .leading, spacing: 1) {
                Text(drop.name)
                    .font(.yardCaptionEmphasis)
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(1)
                Text(drop.endDate.map { "\(drop.brandName) · \(Formatters.shortDate($0))" } ?? drop.brandName)
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink2)
                    .lineLimit(1)
            }
            .padding(.horizontal, Spacing.xs)
        }
    }
}

/// A row in "Your drops": thumbnail, brand, name, caption, optional entry status.
struct DropListRow: View {
    let drop: Drop
    let caption: String
    var entryStatus: String? = nil
    var footnote: String? = nil

    var body: some View {
        HStack(alignment: .center, spacing: Spacing.m) {
            RemoteImage(url: drop.imageURL, maxPixelSize: 300)
                .frame(width: 72, height: 90)
                .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: Spacing.xs) {
                    Text(drop.brandName)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink3)
                        .lineLimit(1)
                    if let entryStatus {
                        let status = DropText.entryStatus(entryStatus)
                        Tag(status.label, style: status.style)
                    }
                }
                Text(drop.name)
                    .font(.yardBodyEmphasis)
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(caption)
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                    .multilineTextAlignment(.leading)
                if let footnote {
                    Text(footnote)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink3)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.yardCaptionEmphasis)
                .foregroundStyle(Color.yard.ink3)
        }
        .padding(Spacing.m)
        .background(
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .fill(Color.yard.surface)
        )
        .contentShape(Rectangle())
    }
}

/// Loading placeholder for the drops calendar.
struct DropsSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            Skeleton(cornerRadius: Radius.small)
                .frame(width: 160, height: 34)
            Skeleton(cornerRadius: Radius.card)
                .aspectRatio(4.0 / 5.0, contentMode: .fit)
            ForEach(0..<3, id: \.self) { _ in
                Skeleton(cornerRadius: Radius.card)
                    .frame(height: 100)
            }
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.top, Spacing.l)
        .accessibilityLabel(Text("Loading drops"))
    }
}
