import SwiftUI
import MapKit

/// Around: independent brands' stores, showrooms, pop-ups and exhibitions on a map, with a
/// bottom sheet listing the places in view, nearest first (website: /around,
/// src/components/around). Data: GET /api/around/places?scope=world, then
/// GET /api/around/places/{id} for a place. The shopper's location stays on the device.
///
/// The list and place details live in a sheet with its own NavigationStack; anything that leaves
/// Around (storefront, drop, product, sign-in) closes that sheet first, then pushes/presents on the
/// main router, and the sheet comes back when Around is on screen again.
@MainActor
struct AroundView: View {
    init() {}

    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast

    @State private var model = AroundViewModel()
    @State private var locator = AroundLocationManager()
    @State private var position: MapCameraPosition = .automatic
    @State private var region: MKCoordinateRegion?
    @State private var selectedId: String?
    @State private var showSheet = false
    @State private var isOnScreen = false
    @State private var detent: PresentationDetent = AroundView.peekDetent
    @State private var sheetPath: [String] = []
    @State private var query = ""
    @State private var isSearching = false
    @State private var hasCenteredOnUser = false
    @State private var now = Date()
    @FocusState private var searchFocused: Bool

    static let peekDetent: PresentationDetent = .height(150)

    /// Previews only.
    init(previewModel: AroundViewModel) {
        self._model = State(initialValue: previewModel)
    }

    var body: some View {
        mapView
            .ignoresSafeArea(edges: .bottom)
            .safeAreaInset(edge: .top, spacing: 0) { searchBar }
            .background(Color.yard.bg)
            .navigationTitle("Around")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $showSheet) { sheetContent }
            .task {
                await model.load()
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 60_000_000_000)
                    now = Date()
                }
            }
            .onAppear {
                isOnScreen = true
                showSheet = true
                locator.startIfAuthorized()
            }
            .onDisappear {
                isOnScreen = false
                showSheet = false
                locator.stop()
            }
            .onChange(of: locator.requestedFixCount) { _, _ in
                flyToUser()
            }
            .onChange(of: locator.location?.timestamp) { _, _ in
                if !hasCenteredOnUser && selectedId == nil { flyToUser() }
            }
            .onChange(of: sheetPath) { _, newValue in
                if newValue.isEmpty { selectedId = nil }
            }
            .onChange(of: model.error != nil) { _, failed in
                if failed { detent = .medium }
            }
            .onChange(of: router.sheet) { _, newValue in
                // Back from a sign-in sheet the place detail asked for: bring the list back.
                if newValue == nil && isOnScreen { showSheet = true }
            }
    }

    // MARK: Map

    private var mapView: some View {
        Map(position: $position) {
            ForEach(model.places) { place in
                Annotation(place.brand.name, coordinate: place.coordinate, anchor: .bottom) {
                    AroundPin(
                        name: place.brand.name,
                        logoURL: model.logoURL(for: place),
                        isSelected: selectedId == place.id,
                        isOpen: AroundTime.isOpenNow(place, at: now)
                    )
                    .onTapGesture { select(place) }
                }
                .annotationTitles(.hidden)
            }
            if locator.isAuthorized {
                UserAnnotation()
            }
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .mapControls {
            MapCompass()
        }
        .onMapCameraChange(frequency: .onEnd) { context in
            region = context.region
        }
    }

    // MARK: Search + locate

    private var searchBar: some View {
        HStack(spacing: Spacing.s) {
            HStack(spacing: Spacing.s) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(Color.yard.ink2)
                TextField("Search a city or area", text: $query)
                    .font(.yardBody)
                    .foregroundStyle(Color.yard.ink)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .focused($searchFocused)
                    .onSubmit { runSearch() }
                if isSearching {
                    ProgressView().controlSize(.small)
                } else if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(Color.yard.ink3)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Clear search"))
                }
            }
            .padding(.horizontal, Spacing.m)
            .frame(height: 44)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.yard.line, lineWidth: 1))

            GlassIconButton(
                systemImage: locator.isAuthorized ? "location.fill" : "location",
                accessibilityLabel: "Show places near me",
                size: 44
            ) {
                locate()
            }
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.vertical, Spacing.s)
    }

    // MARK: Sheet

    private var visiblePlaces: [AroundPlace] {
        model.visiblePlaces(in: region, from: locator.location)
    }

    private func distance(to place: AroundPlace?) -> Double? {
        guard let place, let me = locator.location else { return nil }
        return place.location.distance(from: me)
    }

    private var sheetContent: some View {
        NavigationStack(path: $sheetPath) {
            AroundPlacesList(
                places: visiblePlaces,
                totalCount: model.places.count,
                isLoading: model.isLoading || !(model.hasLoaded || model.error != nil),
                error: model.places.isEmpty ? model.error : nil,
                isLocated: locator.location != nil,
                selectedId: selectedId,
                now: now,
                logo: { model.logoURL(for: $0) },
                distanceText: { p in distance(to: p).map { AroundTime.distance($0) } },
                onSelect: { select($0) },
                onRetry: { await model.load() },
                onShowAll: { showAll() },
                onBrowseBrands: { leave(.push(.brandsDirectory)) }
            )
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { id in
                let summary = model.place(id)
                PlaceDetailView(
                    placeId: id,
                    summary: summary,
                    distanceMeters: distance(to: summary),
                    logoURL: summary.flatMap { model.logoURL(for: $0) },
                    onExit: { leave($0) }
                )
            }
        }
        .tint(Color.yard.ink)
        .presentationDetents([AroundView.peekDetent, .medium, .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(Radius.sheet)
        .presentationBackground(Color.yard.bg)
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
        .interactiveDismissDisabled()
        .yardToastHost(toast)
    }

    // MARK: Actions

    private func select(_ place: AroundPlace) {
        selectedId = place.id
        sheetPath = [place.id]
        if detent == AroundView.peekDetent { detent = .medium }
        searchFocused = false
        // Keep the zoom when already close; pull the pin into the upper half, above the sheet.
        let current = region?.span ?? MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05)
        let span = current.latitudeDelta > 0.5 ? MKCoordinateSpan(latitudeDelta: 0.04, longitudeDelta: 0.04) : current
        let center = CLLocationCoordinate2D(latitude: place.lat - span.latitudeDelta * 0.22, longitude: place.lng)
        withAnimation(Motion.spring) {
            position = .region(MKCoordinateRegion(center: center, span: span))
        }
    }

    private func showAll() {
        sheetPath = []
        withAnimation(Motion.spring) {
            if let r = AroundViewModel.region(fitting: model.places.map { $0.coordinate }) {
                position = .region(r)
            } else {
                position = .automatic
            }
        }
    }

    private func locate() {
        if locator.isDenied {
            toast.show("Location is off for Yard. Turn it on in Settings to see places near you.", style: .info, systemImage: "location.slash")
            return
        }
        locator.requestLocation()
    }

    private func flyToUser() {
        guard let me = locator.location else { return }
        hasCenteredOnUser = true
        sheetPath = []
        withAnimation(Motion.spring) {
            position = .region(MKCoordinateRegion(center: me.coordinate, latitudinalMeters: 20_000, longitudinalMeters: 20_000))
        }
    }

    private func runSearch() {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !isSearching else { return }
        isSearching = true
        Task { @MainActor in
            let target = await model.region(forSearch: q)
            isSearching = false
            if let target {
                searchFocused = false
                sheetPath = []
                if detent == AroundView.peekDetent { detent = .medium }
                withAnimation(Motion.spring) { position = .region(target) }
            } else {
                toast.show("Couldn't find “\(q)”. Try Lagos, London, Seoul…", style: .info)
            }
        }
    }

    /// Closes the sheet, then leaves through the main router (a sheet can't push the stack under it).
    private func leave(_ exit: AroundExit) {
        showSheet = false
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 350_000_000)
            switch exit {
            case .push(let route):
                router.push(route)
            case .present(let route):
                router.present(route)
            }
        }
    }
}

/// The sheet's list: header, then the places in view nearest first, with loading, error and the
/// two empty states (nothing on Around at all; nothing in this part of the map).
@MainActor
struct AroundPlacesList: View {
    let places: [AroundPlace]
    let totalCount: Int
    let isLoading: Bool
    let error: Error?
    let isLocated: Bool
    let selectedId: String?
    let now: Date
    let logo: (AroundPlace) -> URL?
    let distanceText: (AroundPlace) -> String?
    let onSelect: (AroundPlace) -> Void
    let onRetry: @MainActor () async -> Void
    let onShowAll: () -> Void
    let onBrowseBrands: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.m) {
                header
                if let error {
                    EmptyState.error(error) { await onRetry() }
                        .padding(.top, Spacing.l)
                } else if isLoading && totalCount == 0 {
                    VStack(spacing: Spacing.s) {
                        ForEach(0..<3, id: \.self) { _ in AroundRowSkeleton() }
                    }
                } else if totalCount == 0 {
                    EmptyState(
                        title: "No places on Yard Around yet",
                        message: "When brands open stores, showrooms and pop-ups, they show up here. Until then, shop them online.",
                        systemImage: "mappin.and.ellipse",
                        actionTitle: "Browse brands",
                        action: onBrowseBrands
                    )
                    .padding(.top, Spacing.l)
                } else if places.isEmpty {
                    EmptyState(
                        title: "No places here yet",
                        message: "Zoom out or pick another city.",
                        systemImage: "map",
                        actionTitle: "Show all places",
                        action: onShowAll
                    )
                    .padding(.top, Spacing.l)
                } else {
                    LazyVStack(spacing: Spacing.s) {
                        ForEach(places) { place in
                            Button {
                                onSelect(place)
                            } label: {
                                AroundPlaceRow(
                                    place: place,
                                    logoURL: logo(place),
                                    distanceText: distanceText(place),
                                    now: now,
                                    isSelected: place.id == selectedId
                                )
                            }
                            .buttonStyle(PressableButtonStyle())
                        }
                    }
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.l)
            .padding(.bottom, Spacing.xxl)
        }
        .scrollIndicators(.hidden)
        .background(Color.yard.bg)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Around").yardDisplay(30)
                .foregroundStyle(Color.yard.ink)
            Text(subtitle)
                .font(.yardCaption)
                .foregroundStyle(Color.yard.ink2)
        }
    }

    private var subtitle: String {
        if error != nil { return "Stores, showrooms, pop-ups and exhibitions" }
        if isLoading && totalCount == 0 { return "Loading places…" }
        if totalCount == 0 { return "Stores, showrooms, pop-ups and exhibitions" }
        let n = places.count
        let count = "\(n) \(n == 1 ? "place" : "places") in view"
        return isLocated && n > 1 ? "\(count) · nearest first" : count
    }
}

#Preview("Around — dark") {
    NavigationStack { AroundView(previewModel: AroundViewModel(places: AroundFixtures.places)) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("Around — light") {
    NavigationStack { AroundView(previewModel: AroundViewModel(places: AroundFixtures.places)) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}

#Preview("Around list empty — dark") {
    AroundPlacesList(places: [], totalCount: 0, isLoading: false, error: nil, isLocated: false, selectedId: nil, now: Date(),
                     logo: { _ in nil }, distanceText: { _ in nil }, onSelect: { _ in }, onRetry: {}, onShowAll: {}, onBrowseBrands: {})
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("Around list — light") {
    AroundPlacesList(places: AroundFixtures.places, totalCount: 2, isLoading: false, error: nil, isLocated: true, selectedId: nil, now: Date(),
                     logo: { _ in nil }, distanceText: { _ in "1.2 km" }, onSelect: { _ in }, onRetry: {}, onShowAll: {}, onBrowseBrands: {})
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
