import SwiftUI

/// Yard's Charts (website /charts): what's moving on Yard right now. A board rail (Top brands,
/// Trending, Emerging, Most followed, Most wishlisted, Top drops, City charts), Daily / Weekly /
/// Monthly editions, a location + category scope, then the board: podium for ranks 1–3 with big
/// display-face ranks, callouts, ranked rows with movement, and a separate Sponsored strip.
/// Tapping an entry opens the brand profile (or the drop on Top drops).
@MainActor
struct ChartsView: View {
    init() {}

    @State private var model = ChartsViewModel()
    @State private var showsFilters = false
    @State private var showsHowItWorks = false
    @Environment(CartStore.self) private var cart

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                header
                    .padding(.horizontal, Spacing.gutter)

                ChipRow {
                    ForEach(ChartSlug.allCases) { slug in
                        Chip(slug.label, isSelected: model.query.chart == slug) {
                            var next = model.query
                            next.chart = slug
                            model.apply(next)
                        }
                    }
                }

                controls
                    .padding(.horizontal, Spacing.gutter)

                boardSection
                    .padding(.horizontal, Spacing.gutter)

                howChartsWork
                    .padding(.horizontal, Spacing.gutter)
            }
            .padding(.top, Spacing.s)
            .padding(.bottom, Spacing.xxxl)
        }
        .yardScreenBackground()
        .navigationTitle("Charts")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.load() }
        .task {
            await model.loadScopes()
            model.resolveDefaultCity(shipToCity: cart.destinationCity, shipToCountry: cart.destinationCountry)
        }
        .task(id: model.effectiveQuery) {
            // Load this board, then keep it fresh while the screen is up (website cadence:
            // daily 30 s, weekly 5 min, monthly 15 min).
            await model.load()
            let period = model.effectiveQuery.period
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: period.refreshSeconds * 1_000_000_000)
                if Task.isCancelled { break }
                await model.load()
            }
        }
        .sheet(isPresented: $showsFilters) {
            ChartsFiltersSheet(query: model.query, scopes: model.scopes, resolvedCity: resolvedCity) { next in
                model.apply(next)
            }
        }
        .animation(Motion.spring, value: model.query)
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Text("Charts")
                .yardDisplay(52)
                .foregroundStyle(Color.yard.ink)
            Text("What's moving on Yard right now.")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
            if let edition = model.currentBoard?.edition {
                ChartsEditionLine(edition: edition, period: model.query.period)
                    .padding(.top, Spacing.xs)
            } else if model.isLoading {
                HStack(spacing: Spacing.s) {
                    Skeleton(shape: .capsule).frame(width: 60, height: 26)
                    Skeleton(cornerRadius: 4).frame(width: 180, height: 12)
                }
                .padding(.top, Spacing.xs)
            }
        }
    }

    // MARK: Period + scope

    private var periodBinding: Binding<ChartPeriod> {
        Binding<ChartPeriod>(
            get: { model.query.period },
            set: { newValue in
                var next = model.query
                next.period = newValue
                model.apply(next)
            }
        )
    }

    private var resolvedCity: (slug: String, name: String)? {
        guard model.query.chart == .city else { return nil }
        if let city = model.currentBoard?.scope.city { return (slug: city.slug, name: city.name) }
        if let slug = model.defaultCity {
            let name = model.scopes?.cities.first(where: { $0.slug == slug })?.name ?? slug
            return (slug: slug, name: name)
        }
        return nil
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            SegmentedPill(selection: periodBinding, options: ChartPeriod.allCases) { $0.label }

            HStack(spacing: Spacing.s) {
                Button {
                    showsFilters = true
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: model.query.chart == .city || model.effectiveQuery.city != nil || model.effectiveQuery.country != nil ? "mappin.and.ellipse" : "globe")
                            .font(.yardCaptionEmphasis)
                        Text(model.locationTitle)
                            .font(.yardCallout.weight(.semibold))
                            .lineLimit(1)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Color.yard.ink3)
                    }
                    .foregroundStyle(Color.yard.ink)
                    .padding(.horizontal, Spacing.l)
                    .frame(minHeight: 36)
                    .background(Color.yard.surface2, in: Capsule())
                    .overlay(Capsule().strokeBorder(Color.yard.line, lineWidth: 1))
                    .contentShape(Capsule())
                }
                .buttonStyle(PressableButtonStyle())
                .accessibilityLabel(Text("Location, \(model.locationTitle)"))

                Spacer(minLength: 0)

                Chip("Filters", systemImage: "slider.horizontal.3", isSelected: model.query.filterCount > 0, count: model.query.filterCount > 0 ? model.query.filterCount : nil) {
                    showsFilters = true
                }
            }
        }
    }

    // MARK: Board

    private var boardSection: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            boardHeading
            boardBody
        }
    }

    private var boardHeading: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(model.query.chart.label)
                .yardDisplay(32)
                .foregroundStyle(Color.yard.ink)
            Text(headingLine)
                .font(.yardCaption)
                .foregroundStyle(Color.yard.ink2)
        }
    }

    /// "Everywhere, weekly. 20 brands ranked".
    private var headingLine: String {
        let period = model.query.period.label
        var line: String
        if let place = model.whereWords() {
            line = "\(place), \(period.lowercased())"
        } else {
            line = period
        }
        if let b = model.currentBoard, b.state == .ok, !b.entries.isEmpty {
            let n = b.entries.count
            let noun = b.chart == .topDrops ? (n == 1 ? "drop" : "drops") : (n == 1 ? "brand" : "brands")
            line += ". \(n) \(noun) ranked"
        }
        return line
    }

    @ViewBuilder
    private var boardBody: some View {
        if let board = model.currentBoard {
            switch board.state {
            case .warmingUp:
                EmptyState(
                    title: "Charts are warming up — back in a moment.",
                    message: "The first editions are being written. Nothing is lost while you wait.",
                    systemImage: "hourglass",
                    actionTitle: "Retry",
                    action: { Task { @MainActor in await model.load() } }
                )
            case .smallCohort:
                ChartsSmallCohortView(board: board, query: model.query, scopes: model.scopes) { next in
                    model.apply(next)
                }
            case .ok:
                if board.entries.isEmpty {
                    EmptyState(
                        title: "No chart yet",
                        message: board.chart == .topDrops
                            ? "No drops are live, released this period or coming up in the next 7 days."
                            : "No brand qualifies for this chart in this period yet.",
                        systemImage: "chart.bar"
                    )
                } else {
                    entries(board)
                }
            }
        } else if let error = model.error, !model.isLoading {
            errorState(error)
        } else {
            ChartsBoardSkeleton()
        }
    }

    private func entries(_ board: ChartBoard) -> some View {
        let rows = Array(board.entries.dropFirst(3))
        let head = Array(rows.prefix(7))
        let tail = Array(rows.dropFirst(7))
        return VStack(alignment: .leading, spacing: Spacing.l) {
            ChartsPodium(entries: board.entries, period: board.period)
            ChartsCallouts(callouts: board.callouts, period: board.period)
            if !head.isEmpty {
                rowList(head)
            }
            if !tail.isEmpty {
                ChartsSponsoredStrip(items: board.sponsored)
                rowList(tail)
            } else {
                ChartsSponsoredStrip(items: board.sponsored)
            }
            if model.refreshFailed {
                Text("Couldn't refresh just now. This is the last edition Yard sent.")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink3)
            }
        }
    }

    private func rowList(_ rows: [ChartEntry]) -> some View {
        LazyVStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, entry in
                NavigationLink(value: entry.route) {
                    ChartsRow(entry: entry, period: model.query.period)
                }
                .buttonStyle(PressableButtonStyle())
                if index < rows.count - 1 {
                    Rectangle()
                        .fill(Color.yard.line)
                        .frame(height: 1)
                }
            }
        }
        .padding(.horizontal, Spacing.m)
        .yardCard()
    }

    private func errorState(_ error: Error) -> some View {
        let limited = (error as? APIError)?.isRateLimited ?? false
        return EmptyState(
            title: "Couldn't load this chart.",
            message: limited
                ? "Charts were loaded a lot from here in the last minute. Wait a moment, then try again. Your filters are kept."
                : APIError.message(for: error),
            systemImage: "exclamationmark.circle",
            actionTitle: "Retry",
            action: { Task { @MainActor in await model.load() } }
        )
    }

    // MARK: How Charts work

    private var howChartsWork: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(Motion.spring) { showsHowItWorks.toggle() }
            } label: {
                HStack(spacing: Spacing.s) {
                    Image(systemName: "info.circle")
                        .foregroundStyle(Color.yard.ink2)
                    Text("How Charts work")
                        .font(.yardBodyEmphasis)
                        .foregroundStyle(Color.yard.ink)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.yard.ink2)
                        .rotationEffect(.degrees(showsHowItWorks ? 180 : 0))
                }
                .padding(Spacing.l)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if showsHowItWorks {
                VStack(alignment: .leading, spacing: Spacing.m) {
                    point("What counts", "Follows, saves, product and storefront views, drop reminders, messages and post opens, plus orders. Follower growth, views and saves carry most of the weight, and an account adds at most one follow per brand however often it taps.")
                    point("Sales are capped", "Orders and sales make up at most a quarter of a brand's score, so no chart is ranked by sales alone.")
                    point("Newer brands get a lift", "Brands under 30,000 followers that joined in the last 18 months get a small boost on Top brands, Trending and City charts.")
                    point("Unusual activity is left out", "Bursts from new accounts, one network or coordinated follows are excluded. A brand under review is held off the charts until Yard decides.")
                    point("Sponsored is separate", "Paid placements appear in their own labelled strip. They never change a chart position.")
                }
                .padding([.horizontal, .bottom], Spacing.l)
                .transition(.opacity)
            }
        }
        .yardCard()
    }

    private func point(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.yardCaptionEmphasis)
                .foregroundStyle(Color.yard.ink)
            Text(text)
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Small cohort

/// A scope with too few eligible brands (website SmallCohortState): says why and offers only
/// actions that lead to a board that has a chart.
@MainActor
struct ChartsSmallCohortView: View {
    let board: ChartBoard
    let query: ChartsQuery
    let scopes: ChartScopes?
    let onChange: (ChartsQuery) -> Void

    private var minCohort: Int { scopes?.minCohort ?? 3 }

    private struct Action: Identifiable {
        let id: String
        let title: String
        let query: ChartsQuery
    }

    var body: some View {
        VStack(spacing: Spacing.l) {
            EmptyState(title: content.title, message: content.message, systemImage: "mappin.slash")
            VStack(spacing: Spacing.s) {
                ForEach(content.actions) { action in
                    YardButton(action.title, style: .secondary, size: .medium) {
                        onChange(action.query)
                    }
                }
            }
        }
    }

    private func brandWord(_ n: Int) -> String { n == 1 ? "brand" : "brands" }

    private var content: (title: String, message: String, actions: [Action]) {
        let place = board.scope.city?.name ?? board.scope.country?.name
        let category = board.scope.category?.label
        let n = board.cohortSize
        let fallbackCountry = board.fallback?.country
        let nearestCity = board.fallback?.nearestCity
        let categoryEverywhere: Int = query.category.map { slug in scopes?.categories.first(where: { $0.slug == slug })?.eligible ?? 0 } ?? Int.max
        let placeAll: Int = {
            if let c = board.scope.city { return scopes?.cities.first(where: { $0.slug == c.slug })?.eligible ?? 0 }
            if let k = board.scope.country { return scopes?.countries.first(where: { $0.code == k.code })?.eligible ?? 0 }
            return 0
        }()

        var actions: [Action] = []

        if query.chart == .city, let city = board.scope.city {
            if category != nil && placeAll >= minCohort {
                actions.append(Action(id: "all", title: "Show all categories", query: ChartsQuery(chart: .city, period: query.period, city: query.city)))
            }
            if let fallbackCountry, fallbackCountry.eligible >= minCohort {
                actions.append(Action(id: "country", title: "See Top brands in \(fallbackCountry.name)", query: ChartsQuery(chart: .top, period: query.period, country: fallbackCountry.code)))
            } else {
                actions.append(Action(id: "everywhere", title: "See Top brands everywhere", query: ChartsQuery(chart: .top, period: query.period)))
            }
            if category == nil, let nearestCity {
                var q = query
                q.city = nearestCity.slug
                q.country = nil
                actions.append(Action(id: "near", title: "See \(nearestCity.name)", query: q))
            }
            let title = category.map { "Not enough \($0) brands in \(city.name) yet." } ?? "Not enough brands in \(city.name) for a city chart yet."
            let message: String
            if let category {
                message = "A chart needs at least \(minCohort) brands. " + (n == 0 ? "No \(category) brand in \(city.name) is on the charts right now." : "\(city.name) has \(n) \(category) \(brandWord(n)) on the charts right now.")
            } else {
                message = "A city chart needs at least \(minCohort) brands. " + (n == 0 ? "No brand in \(city.name) is on the charts right now." : "\(city.name) has \(n) \(brandWord(n)) on the charts right now.")
            }
            return (title, message, actions)
        }

        let title: String
        if let place, let category { title = "Not enough \(category) brands in \(place) yet." }
        else if let place { title = "Not enough brands in \(place) yet." }
        else if let category { title = "Not enough \(category) brands yet." }
        else { title = "Not enough brands on this chart yet." }

        let whereText: String
        if let place, let category { whereText = "\(place) has \(n) \(category) \(brandWord(n))" }
        else if let place { whereText = "\(place) has \(n) \(brandWord(n))" }
        else { whereText = "There \(n == 1 ? "is" : "are") \(n) \(category.map { "\($0) " } ?? "")\(brandWord(n))" }

        if place != nil && categoryEverywhere >= minCohort {
            actions.append(Action(id: "everywhere", title: "Show everywhere", query: ChartsQuery(chart: query.chart, period: query.period, category: query.category)))
        }
        if category != nil && place != nil && placeAll >= minCohort {
            actions.append(Action(id: "all", title: "Show all categories", query: ChartsQuery(chart: query.chart, period: query.period, country: query.city == nil ? query.country : nil, city: query.city)))
        }
        if actions.isEmpty {
            actions.append(Action(id: "clear", title: "Show \(query.chart.label) everywhere", query: ChartsQuery(chart: query.chart, period: query.period)))
        }
        return (title, "A filtered chart needs at least \(minCohort) brands. \(whereText) on the charts right now.", actions)
    }
}

// MARK: - Previews

#Preview("ChartsView — dark") {
    NavigationStack { ChartsView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("ChartsView — light") {
    NavigationStack { ChartsView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}

#Preview("Small cohort — dark") {
    ChartsSmallCohortView(
        board: ChartBoard(
            chart: .city,
            period: .weekly,
            scope: ChartScopeInfo(key: "city:accra", city: .init(slug: "accra", name: "Accra", country: "GH"), country: nil, category: nil),
            state: .smallCohort,
            edition: nil,
            cohortSize: 2,
            entries: [],
            fallback: ChartFallback(country: nil, nearestCity: .init(slug: "lagos", name: "Lagos", eligible: 6))
        ),
        query: ChartsQuery(chart: .city, city: "accra"),
        scopes: ChartsFiltersPreview.scopes
    ) { _ in }
    .padding()
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.yard.bg)
    .yardPreviewEnvironment()
    .preferredColorScheme(.dark)
}

#Preview("Small cohort — light") {
    ChartsSmallCohortView(
        board: ChartBoard(
            chart: .top,
            period: .daily,
            scope: ChartScopeInfo(key: "country:GH", city: nil, country: .init(code: "GH", name: "Ghana"), category: nil),
            state: .smallCohort,
            edition: nil,
            cohortSize: 2,
            entries: []
        ),
        query: ChartsQuery(chart: .top, period: .daily, country: "GH"),
        scopes: ChartsFiltersPreview.scopes
    ) { _ in }
    .padding()
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.yard.bg)
    .yardPreviewEnvironment()
    .preferredColorScheme(.light)
}
