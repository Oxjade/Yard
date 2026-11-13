import SwiftUI

// Building blocks of the Charts board (website: src/components/charts/*).

// MARK: - Movement chip

/// ▲n violet, ▼n red, "—" for no change, "New" and "Re-entry" spelled out (website RankMove).
struct ChartsRankMove: View {
    let movement: ChartMovement
    let delta: Int

    var body: some View {
        content
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(movement.words(delta: delta)))
    }

    @ViewBuilder
    private var content: some View {
        switch movement {
        case .new:
            Tag("New", style: .acid)
        case .reentry:
            Tag("Re-entry", style: .neutral)
        case .up:
            arrowChip(systemImage: "arrowtriangle.up.fill", text: "\(abs(delta))", color: Color.yard.violet)
        case .down:
            arrowChip(systemImage: "arrowtriangle.down.fill", text: "\(abs(delta))", color: Color.yard.danger)
        case .same:
            arrowChip(systemImage: nil, text: "—", color: Color.yard.ink2)
        }
    }

    private func arrowChip(systemImage: String?, text: String, color: Color) -> some View {
        HStack(spacing: 2) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 8, weight: .bold))
            }
            Text(text)
                .font(.yardCaptionEmphasis.monospacedDigit())
        }
        .foregroundStyle(color)
        .padding(.horizontal, 7)
        .frame(minWidth: 34, minHeight: 22)
        .background(color.opacity(0.14), in: Capsule())
    }
}

// MARK: - Reason (stat) chip

/// Why the entry is here: "+1.2K new followers". Public-safe stats only (never revenue).
struct ChartsStatChip: View {
    let stat: ChartStat
    var compact: Bool = false

    var body: some View {
        if stat.figure.isEmpty && stat.caption.isEmpty {
            EmptyView()
        } else {
            HStack(spacing: 4) {
                if !stat.figure.isEmpty {
                    Text(stat.figure)
                        .font(.yardCaptionEmphasis.monospacedDigit())
                        .foregroundStyle(Color.yard.ink)
                }
                if !stat.caption.isEmpty {
                    Text(stat.caption)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                }
            }
            .lineLimit(1)
            .padding(.horizontal, Spacing.s)
            .padding(.vertical, compact ? 3 : 5)
            .background(Color.yard.surface2, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.yard.line, lineWidth: 1))
        }
    }
}

// MARK: - Edition line

/// "● Live  Weekly edition, 31 Oct – 6 Nov. Updated 2 min ago" ("Final" for a closed edition).
struct ChartsEditionLine: View {
    let edition: ChartEditionInfo
    let period: ChartPeriod

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            HStack(spacing: Spacing.s) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(edition.isLive ? Color.yard.acid : Color.yard.ink3)
                        .frame(width: 7, height: 7)
                        .overlay(Circle().strokeBorder(Color.yard.line, lineWidth: 1))
                    Text(edition.isLive ? "Live" : "Final")
                        .font(.yardCaptionEmphasis)
                        .foregroundStyle(edition.isLive ? Color.yard.ink : Color.yard.ink2)
                }
                .padding(.horizontal, 10)
                .frame(height: 26)
                .background(Color.yard.surface2, in: Capsule())

                (Text(ChartsFormat.editionText(edition, period: period))
                    .foregroundColor(Color.yard.ink2)
                    + Text(updatedSuffix(now: context.date))
                    .foregroundColor(Color.yard.ink3))
                    .font(.yardCaption.monospacedDigit())
                .lineLimit(2)
            }
        }
    }

    private func updatedSuffix(now: Date) -> String {
        guard edition.isLive, let ago = ChartsFormat.updatedAgo(edition.computedAt, now: now) else { return "" }
        return ". Updated \(ago)"
    }
}

// MARK: - Podium (ranks 1–3)

/// Ranks 1–3 as editorial cards: #1 full width, #2 and #3 side by side beneath (one card full
/// width, two cards side by side). Words sit on the card's solid panel, never on the photo; the
/// rank sits on a solid tab in the photo's corner (acid for #1).
struct ChartsPodium: View {
    let entries: [ChartEntry]
    let period: ChartPeriod

    var body: some View {
        let top = Array(entries.prefix(3))
        VStack(spacing: Spacing.m) {
            if let first = top.first {
                card(first, lead: true)
            }
            if top.count > 1 {
                HStack(alignment: .top, spacing: Spacing.m) {
                    ForEach(top.dropFirst()) { entry in
                        card(entry, lead: false)
                    }
                }
            }
        }
    }

    private func card(_ entry: ChartEntry, lead: Bool) -> some View {
        NavigationLink(value: entry.route) {
            ChartsPodiumCard(entry: entry, period: period, lead: lead)
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityLabel(Text(entry.accessibilityText(period)))
    }
}

struct ChartsPodiumCard: View {
    let entry: ChartEntry
    let period: ChartPeriod
    let lead: Bool

    private var imageURL: URL? { entry.drop?.image?.url ?? entry.brand.cover?.url }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            photo
            panel
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.yard.surface)
        .clipShape(.yardCard)
        .overlay(
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(lead ? Color.yard.acid.opacity(0.6) : Color.yard.line, lineWidth: lead ? 1.5 : 1)
        )
    }

    private var photo: some View {
        Color.yard.surface2
            .aspectRatio(lead ? 16.0 / 10.0 : 4.0 / 3.0, contentMode: .fit)
            .overlay {
                if let imageURL {
                    RemoteImage(url: imageURL, contentMode: .fill, maxPixelSize: lead ? 1200 : 700)
                } else {
                    BrandAvatar(name: entry.brand.name, size: lead ? 72 : 48)
                }
            }
            .clipped()
            .overlay(alignment: .topLeading) { rankTab }
    }

    private var rankTab: some View {
        Text(ChartsFormat.two(entry.rank))
            .font(.yardDisplay(lead ? 64 : 44).monospacedDigit())
            .foregroundStyle(entry.rank == 1 ? Color.yard.onAcid : Color.yard.ink)
            .padding(.horizontal, lead ? 12 : 9)
            .padding(.top, lead ? 4 : 2)
            .padding(.bottom, lead ? 0 : -2)
            .background(
                entry.rank == 1 ? Color.yard.acid : Color.yard.surface,
                in: UnevenRoundedRectangle(cornerRadii: RectangleCornerRadii(topLeading: 0, bottomLeading: 0, bottomTrailing: Radius.small, topTrailing: 0), style: .continuous)
            )
            .accessibilityHidden(true)
    }

    private var panel: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            HStack(spacing: Spacing.s) {
                if lead {
                    BrandAvatar(name: entry.brand.name, size: 36, verified: entry.drop == nil && entry.brand.verified)
                }
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        Text(entry.title)
                            .font(lead ? .yardTitle : .yardHeadline)
                            .foregroundStyle(Color.yard.ink)
                            .lineLimit(lead ? 1 : 2)
                        if entry.drop == nil && entry.brand.verified && !lead {
                            Image(systemName: "checkmark.seal.fill")
                                .font(.caption)
                                .foregroundStyle(Color.yard.violet)
                        }
                    }
                    Text(subtitle)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                        .lineLimit(1)
                }
            }
            if lead {
                ChartsStatChip(stat: entry.stat)
            } else {
                ChartsStatChip(stat: entry.stat, compact: true)
            }
            HStack(spacing: Spacing.s) {
                ChartsRankMove(movement: entry.movement, delta: entry.delta)
                Text(entry.previousText(period))
                    .font(.yardCaption.monospacedDigit())
                    .foregroundStyle(Color.yard.ink2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
        }
        .padding(lead ? Spacing.l : Spacing.m)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var subtitle: String {
        if let drop = entry.drop { return "\(entry.brand.name), \(drop.statusLabel.lowercased())" }
        let origin = entry.brand.originText
        return origin.isEmpty ? "@\(entry.brand.handle)" : origin
    }
}

// MARK: - Rows (rank 4+)

/// One ranked row: big rank numeral in the display face, movement, avatar, name, origin,
/// reason chip and history line. The whole row opens the storefront (or the drop).
struct ChartsRow: View {
    let entry: ChartEntry
    let period: ChartPeriod

    var body: some View {
        HStack(alignment: .center, spacing: Spacing.m) {
            VStack(spacing: 4) {
                Text(ChartsFormat.two(entry.rank))
                    .font(.yardDisplay(34).monospacedDigit())
                    .foregroundStyle(Color.yard.ink)
                    .contentTransition(.numericText())
                ChartsRankMove(movement: entry.movement, delta: entry.delta)
            }
            .frame(width: 50)

            thumbnail

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Text(entry.title)
                        .font(.yardHeadline)
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(1)
                    if let drop = entry.drop {
                        Tag(drop.statusLabel, style: drop.status == "live" ? .acid : (drop.status == "upcoming" ? .violet : .neutral))
                    }
                }
                Text(subtitle)
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink2)
                    .lineLimit(1)
                ChartsStatChip(stat: entry.stat, compact: true)
                Text(historyText)
                    .font(.yardCaption.monospacedDigit())
                    .foregroundStyle(Color.yard.ink3)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.yard.ink3)
        }
        .padding(.vertical, Spacing.m)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(entry.accessibilityText(period)))
        .accessibilityAddTraits(.isLink)
    }

    @ViewBuilder
    private var thumbnail: some View {
        if let url = entry.drop?.image?.url {
            RemoteImage(url: url, contentMode: .fill, maxPixelSize: 160)
                .frame(width: 44, height: 44)
                .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
        } else {
            BrandAvatar(name: entry.brand.name, size: 44, verified: entry.brand.verified)
        }
    }

    private var subtitle: String {
        if entry.drop != nil { return entry.brand.name }
        let origin = entry.brand.originText
        return origin.isEmpty ? "@\(entry.brand.handle)" : origin
    }

    /// "Last week 7 · Peak 2 · 6 wks", or "New this week" / "Back on the chart".
    private var historyText: String {
        switch entry.movement {
        case .new, .reentry:
            return entry.previousText(period)
        case .up, .down, .same:
            var parts: [String] = []
            if let prev = entry.prevRank { parts.append("\(period.previous) \(prev)") }
            parts.append("Peak \(entry.peak)")
            parts.append(period.unit(entry.editionsOnChart))
            return parts.joined(separator: " · ")
        }
    }
}

// MARK: - Callouts

/// Biggest climber and Highest debut, above row 4; hidden when the subject is on the podium.
struct ChartsCallouts: View {
    let callouts: ChartCallouts
    let period: ChartPeriod

    var body: some View {
        let up: ChartEntry? = ChartsCallouts.offPodium(callouts.biggestClimber)
        let debut: ChartEntry? = ChartsCallouts.offPodium(callouts.highestDebut)
        if up != nil || debut != nil {
            HStack(alignment: .top, spacing: Spacing.m) {
                if let up {
                    callout(up, systemImage: "arrow.up.right", heading: "Biggest climber", line: "Up \(up.delta) to #\(up.rank)")
                }
                if let debut {
                    callout(debut, systemImage: "sparkle", heading: "Highest debut", line: "New at #\(debut.rank)")
                }
            }
        }
    }

    static func offPodium(_ entry: ChartEntry?) -> ChartEntry? {
        guard let entry, entry.rank > 3 else { return nil }
        return entry
    }

    private func callout(_ entry: ChartEntry, systemImage: String, heading: String, line: String) -> some View {
        NavigationLink(value: entry.route) {
            VStack(alignment: .leading, spacing: 6) {
                Label(heading, systemImage: systemImage)
                    .font(.yardCaptionEmphasis)
                    .foregroundStyle(Color.yard.ink2)
                Text(entry.title)
                    .font(.yardHeadline)
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(line)
                    .font(.yardCaption.monospacedDigit())
                    .foregroundStyle(Color.yard.ink2)
            }
            .padding(Spacing.m)
            .frame(maxWidth: .infinity, alignment: .leading)
            .yardCard(radius: Radius.image)
        }
        .buttonStyle(PressableButtonStyle())
    }
}

// MARK: - Sponsored strip

/// Paid placements, after rank 10 (or after the list): labelled, never inside the ranking.
struct ChartsSponsoredStrip: View {
    let items: [ChartSponsored]

    var body: some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.s) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Sponsored")
                        .font(.yardCaptionEmphasis)
                        .foregroundStyle(Color.yard.ink)
                    Spacer(minLength: Spacing.s)
                    Text("Paid placements. They never change chart positions.")
                        .font(.yardMicro)
                        .foregroundStyle(Color.yard.ink3)
                        .multilineTextAlignment(.trailing)
                }
                ForEach(items) { item in
                    NavigationLink(value: item.route) {
                        HStack(spacing: Spacing.m) {
                            if let url = item.drop?.image?.url ?? item.brand.cover?.url {
                                RemoteImage(url: url, contentMode: .fill, maxPixelSize: 200)
                                    .frame(width: 52, height: 52)
                                    .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                            } else {
                                BrandAvatar(name: item.brand.name, size: 52)
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.drop?.name ?? item.brand.name)
                                    .font(.yardHeadline)
                                    .foregroundStyle(Color.yard.ink)
                                    .lineLimit(1)
                                Text(item.drop.map { "\(item.brand.name), \($0.statusLabel.lowercased())" } ?? [item.brand.city, item.brand.countryName].filter { !$0.isEmpty }.joined(separator: ", "))
                                    .font(.yardCaption)
                                    .foregroundStyle(Color.yard.ink2)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: Spacing.s)
                            Tag("Sponsored")
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(PressableButtonStyle())
                }
            }
            .padding(Spacing.m)
            .yardCard(background: Color.yard.surface, radius: Radius.image)
        }
    }
}

// MARK: - Skeleton

struct ChartsBoardSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Skeleton(cornerRadius: Radius.card).frame(height: 300)
            HStack(spacing: Spacing.m) {
                Skeleton(cornerRadius: Radius.card).frame(height: 230)
                Skeleton(cornerRadius: Radius.card).frame(height: 230)
            }
            ForEach(0..<6, id: \.self) { _ in
                HStack(spacing: Spacing.m) {
                    Skeleton(cornerRadius: 6).frame(width: 44, height: 34)
                    Skeleton(shape: .circle).frame(width: 44, height: 44)
                    VStack(alignment: .leading, spacing: 6) {
                        Skeleton(cornerRadius: 4).frame(width: 150, height: 12)
                        Skeleton(cornerRadius: 4).frame(width: 100, height: 10)
                        Skeleton(shape: .capsule).frame(width: 120, height: 18)
                    }
                    Spacer()
                }
                .padding(.vertical, Spacing.s)
            }
        }
        .accessibilityLabel(Text("Loading chart"))
    }
}

// MARK: - Previews

enum ChartsPreviewData {
    static func entry(_ rank: Int, _ name: String, movement: ChartMovement, delta: Int, prev: Int?) -> ChartEntry {
        ChartEntry(
            rank: rank,
            prevRank: prev,
            movement: movement,
            delta: delta,
            peak: max(1, rank - 1),
            editionsOnChart: 4,
            subject: ChartSubject(type: "brand", id: "brd_\(rank)"),
            brand: ChartBrand(id: "brd_\(rank)", handle: "brand\(rank)", name: name, verified: rank % 2 == 1, city: "Lagos", country: "NG", countryName: "Nigeria", category: "Streetwear"),
            stat: ChartStat(label: "\(rank * 40) new followers", figure: "+\(300 - rank * 20)", caption: "new followers")
        )
    }

    static let board = ChartBoard(
        chart: .top,
        period: .weekly,
        scope: ChartScopeInfo(key: "global", city: nil, country: nil, category: nil),
        state: .ok,
        edition: ChartEditionInfo(date: "2026-11-13", status: "live", computedAt: "2026-11-13T10:00:00.000Z", window: .init(from: "2026-11-07", to: "2026-11-13")),
        cohortSize: 8,
        entries: [
            entry(1, "Acme Studio", movement: .up, delta: 2, prev: 3),
            entry(2, "Lagos Thread", movement: .down, delta: -1, prev: 1),
            entry(3, "Night Shift", movement: .new, delta: 0, prev: nil),
            entry(4, "Ore Works", movement: .same, delta: 0, prev: 4),
            entry(5, "Kiln", movement: .up, delta: 4, prev: 9),
            entry(6, "Halfmoon", movement: .reentry, delta: 0, prev: nil),
        ]
    )
}

#Preview("Charts parts — dark") {
    NavigationStack {
        ScrollView {
            VStack(spacing: 16) {
                ChartsPodium(entries: ChartsPreviewData.board.entries, period: .weekly)
                ForEach(ChartsPreviewData.board.entries.dropFirst(3)) { e in
                    ChartsRow(entry: e, period: .weekly)
                }
                ChartsBoardSkeleton()
            }
            .padding()
        }
        .background(Color.yard.bg)
    }
    .yardPreviewEnvironment()
    .preferredColorScheme(.dark)
}

#Preview("Charts parts — light") {
    NavigationStack {
        ScrollView {
            VStack(spacing: 16) {
                ChartsPodium(entries: ChartsPreviewData.board.entries, period: .weekly)
                ForEach(ChartsPreviewData.board.entries.dropFirst(3)) { e in
                    ChartsRow(entry: e, period: .weekly)
                }
            }
            .padding()
        }
        .background(Color.yard.bg)
    }
    .yardPreviewEnvironment()
    .preferredColorScheme(.light)
}
