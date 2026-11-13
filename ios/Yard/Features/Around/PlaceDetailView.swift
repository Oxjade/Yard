import SwiftUI
import MapKit

/// How the Around sheet leaves for the rest of the app. Around keeps its list in its own sheet,
/// so it must close that sheet before the main stack pushes or the root presents.
enum AroundExit: Equatable {
    case push(Route)
    case present(Route)
}

/// One place (GET /api/around/places/{id}): photos, brand with Follow, address and status, Visit
/// storefront (the one acid action), Directions in Apple Maps, opening hours or dates, what's
/// happening there and featured pieces. Shown inside the Around sheet's NavigationStack.
@MainActor
struct PlaceDetailView: View {
    let placeId: String
    let summary: AroundPlace?
    let distanceMeters: Double?
    let logoURL: URL?
    let onExit: (AroundExit) -> Void

    @Environment(FollowStore.self) private var follows
    @Environment(SessionStore.self) private var session
    @Environment(ToastCenter.self) private var toast
    @Environment(\.openURL) private var openURL

    @State private var detail: AroundPlaceDetail?
    @State private var loadError: Error?
    @State private var isLoading = false
    @State private var followBusy = false
    @State private var followTick = 0
    @State private var now = Date()

    init(placeId: String, summary: AroundPlace? = nil, distanceMeters: Double? = nil, logoURL: URL? = nil, previewDetail: AroundPlaceDetail? = nil, onExit: @escaping (AroundExit) -> Void) {
        self.placeId = placeId
        self.summary = summary
        self.distanceMeters = distanceMeters
        self.logoURL = logoURL
        self.onExit = onExit
        self._detail = State(initialValue: previewDetail)
    }

    private var place: AroundPlace? { detail?.summary ?? summary }

    var body: some View {
        ScrollView {
            if let place {
                content(place)
            } else if let loadError {
                errorView(loadError)
                    .padding(.top, Spacing.xxl)
            } else {
                skeleton
            }
        }
        .scrollIndicators(.hidden)
        .background(Color.yard.bg)
        .navigationTitle(place?.brand.name ?? "Place")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: Config.webURL("/around?place=\(placeId)")) {
                    Image(systemName: "square.and.arrow.up")
                        .foregroundStyle(Color.yard.ink)
                }
                .accessibilityLabel(Text("Share this place"))
            }
        }
        .task(id: placeId) {
            if detail == nil { await load() }
        }
        .sensoryFeedback(.success, trigger: followTick)
    }

    // MARK: Loading

    private func load() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }
        do {
            let res = try await APIClient.shared.get("/api/around/places/\(placeId)", as: AroundPlaceDetailResponse.self)
            withAnimation(Motion.fade) { detail = res.place }
        } catch {
            if (error as? APIError)?.isCancelled == true { return }
            loadError = error
        }
    }

    // MARK: Content

    @ViewBuilder
    private func content(_ p: AroundPlace) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            photos(p)
            header(p)
            actions(p)
            if let detail {
                if p.kind.isDated, let starts = YardDate.parse(p.startsAt), let ends = YardDate.parse(p.endsAt) {
                    datesSection(p, starts: starts, ends: ends)
                } else {
                    hoursSection(detail)
                }
                eventsSection(detail)
                featuredSection(detail)
            } else if let loadError {
                // The summary is known but the details failed: say so, never keep a skeleton spinning.
                errorView(loadError)
            } else {
                VStack(alignment: .leading, spacing: Spacing.s) {
                    Skeleton(cornerRadius: 6).frame(width: 120, height: 14)
                    Skeleton(cornerRadius: Radius.small).frame(height: 160)
                }
                .padding(.horizontal, Spacing.gutter)
            }
        }
        .padding(.bottom, Spacing.xxl)
    }

    @ViewBuilder
    private func photos(_ p: AroundPlace) -> some View {
        let images: [AroundImage] = {
            if let d = detail, !d.images.isEmpty { return d.images }
            if let i = p.image { return [i] }
            return []
        }()
        if !images.isEmpty {
            ScrollView(.horizontal) {
                HStack(spacing: Spacing.s) {
                    ForEach(Array(images.enumerated()), id: \.offset) { _, image in
                        RemoteImage(url: image.url, maxPixelSize: 1400) {
                            Image(systemName: "photo")
                                .foregroundStyle(Color.yard.ink3)
                        }
                        .aspectRatio(4.0 / 3.0, contentMode: .fit)
                        .containerRelativeFrame(.horizontal) { width, _ in
                            images.count > 1 ? (width - Spacing.gutter * 2) * 0.88 : width - Spacing.gutter * 2
                        }
                        .clipShape(.yardImage)
                        .accessibilityLabel(Text(image.alt))
                    }
                }
                .scrollTargetLayout()
            }
            .contentMargins(.horizontal, Spacing.gutter, for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
            .scrollIndicators(.hidden)
            .padding(.top, Spacing.s)
        }
    }

    private func header(_ p: AroundPlace) -> some View {
        let following = follows.isFollowing(p.brand.id)
        return VStack(alignment: .leading, spacing: Spacing.m) {
            HStack(spacing: Spacing.m) {
                Button {
                    onExit(.push(.brand(handle: p.brand.handle)))
                } label: {
                    HStack(spacing: Spacing.m) {
                        BrandAvatar(name: p.brand.name, logoURL: logoURL, size: 48, verified: p.brand.verified)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(p.brand.name)
                                .font(.yardHeadline)
                                .foregroundStyle(Color.yard.ink)
                                .lineLimit(1)
                            Text(p.name)
                                .font(.yardCaption)
                                .foregroundStyle(Color.yard.ink2)
                                .lineLimit(1)
                        }
                    }
                }
                .buttonStyle(PressableButtonStyle())
                Spacer(minLength: Spacing.s)
                YardButton(following ? "Following" : "Follow",
                           style: following ? .secondary : .inverted,
                           size: .small,
                           isLoading: followBusy,
                           fullWidth: false) {
                    toggleFollow(p)
                }
            }

            HStack(spacing: Spacing.s) {
                Tag(p.categoryKindText, systemImage: p.kind.systemImage)
                if p.sample { Tag("Sample place", style: .violet) }
            }

            VStack(alignment: .leading, spacing: Spacing.xs) {
                if let detail, !detail.addressLine.isEmpty {
                    Text(detail.addressLine)
                        .font(.yardBody)
                        .foregroundStyle(Color.yard.ink)
                }
                Text([p.neighbourhood ?? "", p.city, AroundCountry.name(p.country)]
                    .filter { !$0.isEmpty }
                    .joined(separator: ", "))
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                if let distanceMeters {
                    Text("\(AroundTime.distance(distanceMeters)) from you")
                        .font(.yardCaption.monospacedDigit())
                        .foregroundStyle(Color.yard.ink2)
                }
                if let line = AroundTime.statusLine(for: p, at: now) {
                    AroundStatusText(line: line)
                }
            }

            if let text = detail?.description, !text.isEmpty {
                Text(text)
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, Spacing.gutter)
    }

    private func actions(_ p: AroundPlace) -> some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            YardButton("Visit storefront", style: .primary) {
                onExit(.push(.brand(handle: p.brand.handle)))
            }
            if p.sample {
                Text("Sample location — not a real address.")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink2)
            } else if let detail {
                YardButton("Directions", systemImage: "arrow.triangle.turn.up.right.diamond", style: .secondary) {
                    openDirections(detail)
                }
                Text("Opens Apple Maps")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink3)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, Spacing.gutter)
    }

    // MARK: Sections

    private func sectionTitle(_ title: String, aside: String? = nil) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.yardHeadline)
                .foregroundStyle(Color.yard.ink)
            Spacer()
            if let aside {
                Text(aside)
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink2)
            }
        }
    }

    @ViewBuilder
    private func hoursSection(_ d: AroundPlaceDetail) -> some View {
        let p = d.summary
        if p.hours != nil || p.byAppointment {
            let aside: String? = AroundTime.sameClock(p.timeZone, at: now) ? nil : "\(p.city) time (\(AroundTime.zoneShort(p.timeZone, at: now)))"
            let today = AroundTime.localClock(now, tz: p.timeZone).day
            let state = AroundTime.openState(p.hours, tz: p.timeZone, at: now)
            VStack(alignment: .leading, spacing: Spacing.s) {
                sectionTitle("Opening hours", aside: aside)
                if let state {
                    let isOpen: Bool = {
                        if case .open = state { return true }
                        return false
                    }()
                    AroundStatusText(line: AroundStatusLine(text: AroundTime.openNowLine(state), tone: isOpen ? .open : .neutral))
                }
                if let hours = p.hours {
                    Card(padding: Spacing.m) {
                        VStack(spacing: 0) {
                            ForEach(AroundHours.dayKeys, id: \.self) { day in
                                HStack {
                                    Text(AroundHours.dayLabels[day] ?? day)
                                    Spacer()
                                    Text(hours.label(day))
                                        .monospacedDigit()
                                }
                                .font(day == today ? .yardBodyEmphasis : .yardBody)
                                .foregroundStyle(day == today ? Color.yard.ink : Color.yard.ink2)
                                .padding(.vertical, 7)
                                .accessibilityElement(children: .combine)
                                .accessibilityAddTraits(day == today ? .isSelected : [])
                                if day != AroundHours.dayKeys.last {
                                    Rectangle().fill(Color.yard.line).frame(height: 1)
                                }
                            }
                        }
                    }
                }
                if p.byAppointment {
                    Text(d.hoursNote.map { "By appointment. \($0)" } ?? "By appointment")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                } else if let note = d.hoursNote, !note.isEmpty {
                    Text(note)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                }
            }
            .padding(.horizontal, Spacing.gutter)
        }
    }

    private func datesSection(_ p: AroundPlace, starts: Date, ends: Date) -> some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            sectionTitle("Dates", aside: "\(p.city) time (\(AroundTime.zoneShort(p.timeZone, at: starts)))")
            Card(padding: Spacing.m) {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(AroundTime.dateRange(starts, ends, tz: p.timeZone))
                        .font(.yardBodyEmphasis)
                        .foregroundStyle(Color.yard.ink)
                    Text("From \(AroundTime.dayTimeIn(starts, tz: p.timeZone)) to \(AroundTime.dayTimeIn(ends, tz: p.timeZone))")
                        .font(.yardCaption.monospacedDigit())
                        .foregroundStyle(Color.yard.ink2)
                }
            }
        }
        .padding(.horizontal, Spacing.gutter)
    }

    @ViewBuilder
    private func eventsSection(_ d: AroundPlaceDetail) -> some View {
        if !d.events.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.s) {
                sectionTitle("Happening here")
                ForEach(d.events) { event in
                    eventCard(event, tz: d.summary.timeZone)
                }
            }
            .padding(.horizontal, Spacing.gutter)
        }
    }

    private func eventCard(_ e: AroundEvent, tz: String) -> some View {
        let starts = YardDate.parse(e.startsAt)
        let ends = YardDate.parse(e.endsAt)
        let live = (starts.map { $0 <= now }) ?? false
        let when: String = {
            guard let starts, let ends else { return "" }
            return live ? "On now, until \(AroundTime.dayTimeIn(ends, tz: tz))" : AroundTime.dateRange(starts, ends, tz: tz)
        }()
        return Card(padding: Spacing.m) {
            HStack(alignment: .top, spacing: Spacing.m) {
                Image(systemName: "calendar")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.yard.ink2)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(e.title)
                        .font(.yardBodyEmphasis)
                        .foregroundStyle(Color.yard.ink)
                    if !when.isEmpty {
                        AroundStatusText(line: AroundStatusLine(text: when, tone: live ? .live : .neutral))
                    }
                    Text(e.kind.label)
                        .font(.yardMicro)
                        .foregroundStyle(Color.yard.ink3)
                    if let desc = e.description, !desc.isEmpty {
                        Text(desc)
                            .font(.yardCaption)
                            .foregroundStyle(Color.yard.ink2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let promo = e.promoText, !promo.isEmpty {
                        Label(promo, systemImage: "tag")
                            .font(.yardCaption)
                            .foregroundStyle(Color.yard.ink)
                    }
                    if let drop = e.drop {
                        Button {
                            onExit(.push(.drop(id: drop.slug)))
                        } label: {
                            Text("See \(drop.name)")
                                .font(.yardCaptionEmphasis)
                                .foregroundStyle(Color.yard.ink)
                                .underline()
                        }
                        .buttonStyle(.plain)
                    }
                    if e.sample { Tag("Sample", style: .violet) }
                }
                Spacer(minLength: 0)
            }
        }
    }

    @ViewBuilder
    private func featuredSection(_ d: AroundPlaceDetail) -> some View {
        if !d.featured.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.s) {
                sectionTitle("Pieces here")
                    .padding(.horizontal, Spacing.gutter)
                ScrollView(.horizontal) {
                    HStack(alignment: .top, spacing: Spacing.s) {
                        ForEach(d.featured) { item in
                            Button {
                                onExit(.push(.product(slug: item.slug)))
                            } label: {
                                VStack(alignment: .leading, spacing: Spacing.xs) {
                                    RemoteImage(url: item.imageURL, maxPixelSize: 500) {
                                        Image(systemName: "photo")
                                            .foregroundStyle(Color.yard.ink3)
                                    }
                                    .frame(width: 132, height: 165)
                                    .clipShape(.yardImage)
                                    Text(item.name)
                                        .font(.yardCaption)
                                        .foregroundStyle(Color.yard.ink)
                                        .lineLimit(1)
                                    if let price = item.price {
                                        PriceText(minor: price.amount, currency: price.currency, font: .yardCaptionEmphasis)
                                    }
                                }
                                .frame(width: 132, alignment: .leading)
                            }
                            .buttonStyle(PressableButtonStyle())
                        }
                    }
                }
                .contentMargins(.horizontal, Spacing.gutter, for: .scrollContent)
                .scrollIndicators(.hidden)
            }
        }
    }

    // MARK: States

    @ViewBuilder
    private func errorView(_ error: Error) -> some View {
        if let api = error as? APIError, api.isNotFound {
            EmptyState(title: "Not on Around any more",
                       message: "This place isn't on Yard Around any more. It may have ended or been taken down.",
                       systemImage: "mappin.slash")
        } else {
            EmptyState.error(error) { await load() }
        }
    }

    private var skeleton: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            Skeleton().aspectRatio(4.0 / 3.0, contentMode: .fit)
            HStack(spacing: Spacing.m) {
                Skeleton(shape: .circle).frame(width: 48, height: 48)
                VStack(alignment: .leading, spacing: 6) {
                    Skeleton(cornerRadius: 6).frame(width: 140, height: 14)
                    Skeleton(cornerRadius: 6).frame(width: 100, height: 11)
                }
            }
            Skeleton(shape: .capsule).frame(height: 52)
            Skeleton(cornerRadius: Radius.card).frame(height: 180)
        }
        .padding(Spacing.gutter)
    }

    // MARK: Actions

    private func toggleFollow(_ p: AroundPlace) {
        guard session.isSignedIn else {
            onExit(.present(.signIn))
            return
        }
        followBusy = true
        Task { @MainActor in
            defer { followBusy = false }
            do {
                try await follows.toggle(brandId: p.brand.id)
                followTick += 1
            } catch {
                toast.show(error)
            }
        }
    }

    /// Exact pins go to Apple Maps by coordinate; area pins by the address text (the coordinate is
    /// only the area's centre), as the website does with its map link.
    private func openDirections(_ d: AroundPlaceDetail) {
        let p = d.summary
        if p.pinPrecision == "street" {
            let item = MKMapItem(placemark: MKPlacemark(coordinate: p.coordinate))
            item.name = "\(p.brand.name) — \(p.name)"
            item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDefault])
            return
        }
        let query = [d.addressLine, p.neighbourhood ?? "", p.city, AroundCountry.name(p.country)]
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
        var comps = URLComponents(string: "https://maps.apple.com/")
        comps?.queryItems = [URLQueryItem(name: "daddr", value: query)]
        if let url = comps?.url { openURL(url) }
    }
}

#Preview("Place detail — dark") {
    NavigationStack {
        PlaceDetailView(placeId: AroundFixtures.store.id, summary: AroundFixtures.store, distanceMeters: 1200, previewDetail: AroundFixtures.detail) { _ in }
    }
    .yardPreviewEnvironment()
    .preferredColorScheme(.dark)
}

#Preview("Place detail — light") {
    NavigationStack {
        PlaceDetailView(placeId: AroundFixtures.store.id, summary: AroundFixtures.store, previewDetail: AroundFixtures.detail) { _ in }
    }
    .yardPreviewEnvironment()
    .preferredColorScheme(.light)
}
