import SwiftUI

/// Drops: Live now (big cards with the live pulse), Entries open, Upcoming (a calendar grouped
/// by day, each row with a countdown and a reminder bell) and Past drops.
/// Data: GET /api/drops?phase=live|upcoming|ended&limit=&cursor= (three pages, like the website).
@MainActor
struct DropsView: View {
    @Environment(Router.self) private var router
    @Environment(SessionStore.self) private var session
    @Environment(ToastCenter.self) private var toast

    @State private var model: DropsViewModel

    init() {
        _model = State(initialValue: DropsViewModel())
    }

    /// Previews only.
    fileprivate init(model: DropsViewModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        // Regroup every 30 s so a drop moves section when it opens or closes.
        TimelineView(.periodic(from: .now, by: 30)) { context in
            content(now: context.date)
        }
        .yardScreenBackground()
        .navigationTitle("Drops")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    router.push(.myDrops)
                } label: {
                    Image(systemName: "bell.badge")
                        .foregroundStyle(Color.yard.ink)
                }
                .accessibilityLabel(Text("Your drops"))
            }
        }
        .task { await model.loadIfNeeded(signedIn: session.isSignedIn) }
        .onChange(of: session.isSignedIn) { _, signedIn in
            Task { @MainActor in await model.loadParticipation(signedIn: signedIn) }
        }
    }

    @ViewBuilder
    private func content(now: Date) -> some View {
        switch model.state {
        case .loading:
            ScrollView { DropsSkeleton() }
                .scrollDisabled(true)
        case .failed(let error):
            EmptyState.error(error) { await model.reload(signedIn: session.isSignedIn) }
        case .loaded:
            loaded(groups: model.groups(now: now), now: now)
        }
    }

    @ViewBuilder
    private func loaded(groups: DropsViewModel.Groups, now: Date) -> some View {
        if groups.isEmpty && model.feed(.upcoming).cursor == nil && model.feed(.live).cursor == nil {
            ScrollView {
                VStack(spacing: Spacing.xl) {
                    header
                    EmptyState(
                        title: "No drops scheduled",
                        message: "New releases will appear here when brands schedule them.",
                        systemImage: "calendar.badge.clock"
                    )
                }
            }
            .refreshable { await model.reload(signedIn: session.isSignedIn) }
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xxl) {
                    header

                    if !groups.live.isEmpty {
                        bigCardSection(
                            title: "Live now",
                            subtitle: "Releases open now, and draws whose winners are buying.",
                            drops: groups.live,
                            now: now,
                            more: .live
                        )
                    }

                    if !groups.entriesOpen.isEmpty {
                        bigCardSection(
                            title: "Entries open",
                            subtitle: "Enter before the draw closes.",
                            drops: groups.entriesOpen,
                            now: now,
                            more: nil
                        )
                    }

                    if !groups.upcoming.isEmpty || model.feed(.upcoming).cursor != nil {
                        upcomingSection(groups.upcoming, now: now)
                    }

                    if !groups.past.isEmpty {
                        pastSection(groups.past)
                    }

                    howDropsWork
                }
                .padding(.bottom, Spacing.xxxl)
            }
            .refreshable { await model.reload(signedIn: session.isSignedIn) }
        }
    }

    // MARK: Sections

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Text("Drops")
                .yardDisplay(56)
                .foregroundStyle(Color.yard.ink)
            Text("Limited releases from independent brands, on a schedule. Small runs, clear rules, and a reminder when each one opens.")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.top, Spacing.s)
    }

    private func bigCardSection(title: String, subtitle: String, drops: [Drop], now: Date, more: DropsViewModel.Source?) -> some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            SectionHeader(title, subtitle: subtitle, display: true)
            VStack(spacing: Spacing.m) {
                ForEach(drops) { drop in
                    NavigationLink(value: Route.drop(id: drop.slug)) {
                        DropLiveCard(drop: drop, phase: drop.livePhase(at: now))
                    }
                    .buttonStyle(PressableButtonStyle())
                }
            }
            .padding(.horizontal, Spacing.gutter)
            if let more {
                loadMoreButton(more, title: "Load more drops")
            }
        }
    }

    private func upcomingSection(_ drops: [Drop], now: Date) -> some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            SectionHeader("Upcoming", subtitle: "Set a reminder for the next release.", display: true)
            VStack(alignment: .leading, spacing: Spacing.l) {
                ForEach(model.days(drops, now: now)) { day in
                    VStack(alignment: .leading, spacing: Spacing.s) {
                        HStack(spacing: Spacing.s) {
                            Text(DropText.dayTitle(day.day, now: now).uppercased())
                                .font(.yardCaptionEmphasis)
                                .foregroundStyle(Color.yard.ink)
                            Rectangle()
                                .fill(Color.yard.line)
                                .frame(height: 1)
                        }
                        ForEach(day.drops) { drop in
                            DropCalendarRow(
                                drop: drop,
                                now: now,
                                reminderOn: model.reminderIds.contains(drop.id),
                                isBusy: model.busyIds.contains(drop.id),
                                onToggleReminder: { toggleReminder(drop) }
                            )
                        }
                    }
                }
            }
            .padding(.horizontal, Spacing.gutter)
            loadMoreButton(.upcoming, title: "Load more drops")
        }
    }

    private func pastSection(_ drops: [Drop]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            SectionHeader("Past drops", subtitle: "Previous releases and draws.", display: true)
            MasonryGrid(drops, extraHeight: DropPastTile.captionHeight, heightRatio: { _ in 1.25 }) { drop in
                NavigationLink(value: Route.drop(id: drop.slug)) {
                    DropPastTile(drop: drop)
                }
                .buttonStyle(PressableButtonStyle())
            }
            .padding(.horizontal, Spacing.gridGap)
            loadMoreButton(.ended, title: "Load more past drops")
        }
    }

    private var howDropsWork: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            SectionHeader("How drops work", subtitle: "The rules are on every drop before it opens, and they don't change once it's scheduled.", display: true)
            VStack(spacing: Spacing.s) {
                howRow("First come", "Opens to everyone at release. Pieces go to whoever checks out first.")
                howRow("Draw", "Enter before release. Winners are picked at random and only winners pay.")
                howRow("Early access", "Followers who were following before early access opened get the first window. Everyone can buy at the public release.")
            }
            .padding(.horizontal, Spacing.gutter)
        }
    }

    private func howRow(_ title: String, _ body: String) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(title)
                    .yardDisplay(22)
                    .foregroundStyle(Color.yard.ink)
                Text(body)
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func loadMoreButton(_ source: DropsViewModel.Source, title: String) -> some View {
        let feed = model.feed(source)
        if feed.cursor != nil {
            HStack {
                Spacer()
                YardButton(title, systemImage: "arrow.down", style: .secondary, size: .medium, isLoading: feed.isLoadingMore, fullWidth: false) {
                    Task { @MainActor in await model.loadMore(source) }
                }
                Spacer()
            }
        }
    }

    // MARK: Actions

    private func toggleReminder(_ drop: Drop) {
        guard session.isSignedIn else {
            router.present(.signIn)
            return
        }
        Task { @MainActor in
            do {
                let message = try await model.toggleReminder(drop)
                if !message.text.isEmpty { toast.show(message.text, style: message.style) }
            } catch {
                toast.show(error)
            }
        }
    }
}

#Preview("DropsView — dark") {
    NavigationStack {
        DropsView(model: DropsViewModel(previewDrops: [
            DropsPreviewFixtures.live, DropsPreviewFixtures.draw, DropsPreviewFixtures.upcoming,
            DropsPreviewFixtures.tomorrow, DropsPreviewFixtures.past,
        ]))
    }
    .yardPreviewEnvironment()
    .preferredColorScheme(.dark)
}

#Preview("DropsView — light") {
    NavigationStack {
        DropsView(model: DropsViewModel(previewDrops: [
            DropsPreviewFixtures.live, DropsPreviewFixtures.upcoming, DropsPreviewFixtures.tomorrow, DropsPreviewFixtures.past,
        ]))
    }
    .yardPreviewEnvironment()
    .preferredColorScheme(.light)
}

#Preview("DropsView — loading (network)") {
    NavigationStack { DropsView() }
        .yardPreviewEnvironment(signedIn: false)
        .preferredColorScheme(.dark)
}
