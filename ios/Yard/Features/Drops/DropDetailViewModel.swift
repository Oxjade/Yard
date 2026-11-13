import Foundation
import Observation

/// One drop: GET /api/drops/{id or slug} (drop + the signed-in shopper's state), then its pieces
/// via GET /api/catalog/products?ids=…  Reloads quietly when the countdown crosses a phase.
@Observable
@MainActor
final class DropDetailViewModel {
    enum LoadState {
        case loading
        case loaded
        case failed(Error)
    }

    let id: String
    var state: LoadState = .loading
    var drop: Drop?
    var me: DropViewerState?
    var products: [Product] = []
    var productsFailed = false
    var isWorking = false

    /// The phase the last load saw, and the phase a reload was last requested for.
    private(set) var loadedPhase: DropLivePhase?
    private var requestedPhase: DropLivePhase?

    init(id: String) {
        self.id = id
    }

    /// Previews only.
    init(previewDrop: Drop, products: [Product], me: DropViewerState? = nil) {
        self.id = previewDrop.id
        self.drop = previewDrop
        self.products = products
        self.me = me
        self.loadedPhase = previewDrop.livePhase(at: Date())
        self.state = .loaded
    }

    func load() async {
        let safe = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        do {
            let detail: DropDetailResponse = try await APIClient.shared.get("/api/drops/\(safe)", as: DropDetailResponse.self)
            let needsProducts = drop == nil || drop?.productIds != detail.drop.productIds || productsFailed
            drop = detail.drop
            me = detail.me
            loadedPhase = detail.drop.livePhase(at: Date())
            state = .loaded
            if needsProducts { await loadProducts(detail.drop.productIds) }
            if let me = detail.me {
                await DropLocalReminder.sync(drop: detail.drop, reminderOn: me.reminder)
            }
        } catch {
            // A quiet reload that fails keeps what is on screen; only the first load shows the error.
            if drop == nil { state = .failed(error) }
        }
    }

    /// Called as the clock ticks: crossing a boundary (entries open/close, release, end) reloads
    /// the server's state once per new phase.
    func phaseDidChange(to phase: DropLivePhase) {
        guard let loadedPhase, phase != loadedPhase, requestedPhase != phase else { return }
        requestedPhase = phase
        Task { @MainActor in await self.load() }
    }

    private func loadProducts(_ ids: [String]) async {
        guard !ids.isEmpty else {
            products = []
            productsFailed = false
            return
        }
        var query: [URLQueryItem] = Array(ids.prefix(60)).map { URLQueryItem(name: "ids", value: $0) }
        query.append(URLQueryItem(name: "limit", value: "60"))
        do {
            let page: ProductsPage = try await APIClient.shared.get("/api/catalog/products", query: query, as: ProductsPage.self)
            let byId: [String: Product] = Dictionary(page.products.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            products = ids.compactMap { byId[$0] }
            productsFailed = false
        } catch {
            productsFailed = true
        }
    }

    /// Reminder on/off; returns the toast.
    func toggleReminder() async throws -> (text: String, style: Toast.Style) {
        guard let drop, !isWorking else { return ("", .info) }
        isWorking = true
        defer { isWorking = false }
        let turnOn = !(me?.reminder ?? false)
        let outcome = try await DropActions.setReminder(turnOn, drop: drop)
        await load()
        return DropActions.reminderMessage(on: turnOn, outcome: outcome)
    }

    /// Draw entry on/off; returns the toast text.
    func toggleEntry() async throws -> String {
        guard let drop, !isWorking else { return "" }
        isWorking = true
        defer { isWorking = false }
        let entered = isEntered
        try await DropActions.setEntry(!entered, dropId: drop.id)
        await load()
        return entered ? "Entry withdrawn" : "Entered the draw"
    }

    var isEntered: Bool {
        guard let entry = me?.entry else { return false }
        return entry.status != "withdrawn"
    }
}
