import Foundation

// Charts API models (website: src/lib/api/contracts/charts.ts).
//   GET /api/charts?chart=&period=&category=&country=&city=  → ChartBoard
//   GET /api/charts/scopes                                   → ChartScopes
// Every field the server may omit decodes leniently, so one odd value never blanks the board.

// MARK: - Query enums

/// The boards (`?chart=`), in the order the website's rail shows them.
enum ChartSlug: String, CaseIterable, Identifiable, Hashable, Sendable {
    case top
    case trending
    case emerging
    case mostFollowed = "most-followed"
    case mostWishlisted = "most-wishlisted"
    case topDrops = "top-drops"
    case city

    var id: String { rawValue }

    /// Sentence case, as the website's board rail shows them.
    var label: String {
        switch self {
        case .top: return "Top brands"
        case .trending: return "Trending"
        case .emerging: return "Emerging"
        case .mostFollowed: return "Most followed"
        case .mostWishlisted: return "Most wishlisted"
        case .topDrops: return "Top drops"
        case .city: return "City charts"
        }
    }
}

/// Edition period (`?period=`).
enum ChartPeriod: String, CaseIterable, Identifiable, Hashable, Sendable {
    case daily
    case weekly
    case monthly

    var id: String { rawValue }

    var label: String {
        switch self {
        case .daily: return "Daily"
        case .weekly: return "Weekly"
        case .monthly: return "Monthly"
        }
    }

    /// "Yesterday" / "Last week" / "Last month".
    var previous: String {
        switch self {
        case .daily: return "Yesterday"
        case .weekly: return "Last week"
        case .monthly: return "Last month"
        }
    }

    var previousLower: String { previous.lowercased() }

    /// "New today" / "New this week" / "New this month".
    var isNewText: String {
        switch self {
        case .daily: return "New today"
        case .weekly: return "New this week"
        case .monthly: return "New this month"
        }
    }

    /// "3 days" / "3 wks" / "3 mos" on the chart.
    func unit(_ n: Int) -> String {
        switch self {
        case .daily: return "\(n) \(n == 1 ? "day" : "days")"
        case .weekly: return "\(n) \(n == 1 ? "wk" : "wks")"
        case .monthly: return "\(n) \(n == 1 ? "mo" : "mos")"
        }
    }

    /// How often the website refreshes a board of this period while it is on screen.
    var refreshSeconds: UInt64 {
        switch self {
        case .daily: return 30
        case .weekly: return 300
        case .monthly: return 900
        }
    }
}

/// Movement since the previous edition.
enum ChartMovement: String, Sendable {
    case up
    case down
    case same
    case new
    case reentry

    /// "up 2 places", "new entry" (VoiceOver).
    func words(delta: Int) -> String {
        switch self {
        case .up: return "up \(delta) \(delta == 1 ? "place" : "places")"
        case .down: return "down \(-delta) \(-delta == 1 ? "place" : "places")"
        case .same: return "no change"
        case .new: return "new entry"
        case .reentry: return "re-entry"
        }
    }
}

/// Board state: ok, small_cohort (too few brands in scope), warming_up (no edition yet).
enum ChartBoardState: String, Sendable {
    case ok
    case smallCohort = "small_cohort"
    case warmingUp = "warming_up"
}

// MARK: - Board

struct ChartImageRef: Decodable, Hashable, Sendable {
    let src: String
    let alt: String

    var url: URL? { Config.url(for: src) }

    enum CodingKeys: String, CodingKey { case src, alt }

    init(src: String, alt: String = "") {
        self.src = src
        self.alt = alt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        src = c.lenient(.src, "")
        alt = c.lenient(.alt, "")
    }
}

struct ChartBrand: Decodable, Hashable, Sendable {
    let id: String
    let handle: String
    let name: String
    let verified: Bool
    let city: String
    let country: String
    let countryName: String
    /// The brand's first category as a label ("Streetwear"); may be empty.
    let category: String
    let cover: ChartImageRef?

    enum CodingKeys: String, CodingKey { case id, handle, name, verified, city, country, countryName, category, cover }

    init(id: String, handle: String, name: String, verified: Bool = false, city: String = "", country: String = "", countryName: String = "", category: String = "", cover: ChartImageRef? = nil) {
        self.id = id
        self.handle = handle
        self.name = name
        self.verified = verified
        self.city = city
        self.country = country
        self.countryName = countryName
        self.category = category
        self.cover = cover
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        handle = c.lenient(.handle, "")
        name = c.lenient(.name, "")
        verified = c.lenient(.verified, false)
        city = c.lenient(.city, "")
        country = c.lenient(.country, "")
        countryName = c.lenient(.countryName, "")
        category = c.lenient(.category, "")
        cover = c.lenientOptional(.cover, as: ChartImageRef.self)
    }

    /// "Streetwear, Lagos".
    var originText: String {
        [category, city].filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

struct ChartDrop: Decodable, Hashable, Sendable {
    let id: String
    let slug: String
    let name: String
    let image: ChartImageRef?
    /// live, sold_out, upcoming, ended.
    let status: String

    enum CodingKeys: String, CodingKey { case id, slug, name, image, status }

    init(id: String, slug: String, name: String, image: ChartImageRef? = nil, status: String = "live") {
        self.id = id
        self.slug = slug
        self.name = name
        self.image = image
        self.status = status
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        slug = c.lenient(.slug, "")
        name = c.lenient(.name, "")
        image = c.lenientOptional(.image, as: ChartImageRef.self)
        status = c.lenient(.status, "live")
    }

    var statusLabel: String {
        switch status {
        case "live": return "Live"
        case "sold_out": return "Sold out"
        case "upcoming": return "Upcoming"
        case "ended": return "Ended"
        default: return status.capitalized
        }
    }
}

/// The public stat an entry is ranked on ("+1.2K" / "new followers"). Never revenue.
struct ChartStat: Decodable, Hashable, Sendable {
    let label: String
    let figure: String
    let caption: String

    enum CodingKeys: String, CodingKey { case label, figure, caption }

    init(label: String, figure: String, caption: String) {
        self.label = label
        self.figure = figure
        self.caption = caption
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        label = c.lenient(.label, "")
        figure = c.lenient(.figure, "")
        caption = c.lenient(.caption, "")
    }
}

struct ChartSubject: Decodable, Hashable, Sendable {
    let type: String
    let id: String
}

struct ChartEntry: Decodable, Hashable, Identifiable, Sendable {
    let rank: Int
    let prevRank: Int?
    let movement: ChartMovement
    let delta: Int
    let peak: Int
    let editionsOnChart: Int
    let subject: ChartSubject
    let brand: ChartBrand
    let drop: ChartDrop?
    let stat: ChartStat

    var id: String { "\(subject.type):\(subject.id)" }

    enum CodingKeys: String, CodingKey { case rank, prevRank, movement, delta, peak, editionsOnChart, subject, brand, drop, stat }

    init(rank: Int, prevRank: Int?, movement: ChartMovement, delta: Int, peak: Int, editionsOnChart: Int, subject: ChartSubject, brand: ChartBrand, drop: ChartDrop? = nil, stat: ChartStat) {
        self.rank = rank
        self.prevRank = prevRank
        self.movement = movement
        self.delta = delta
        self.peak = peak
        self.editionsOnChart = editionsOnChart
        self.subject = subject
        self.brand = brand
        self.drop = drop
        self.stat = stat
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rank = c.lenient(.rank, 0)
        prevRank = c.lenientOptional(.prevRank, as: Int.self)
        let rawMovement: String = c.lenient(.movement, "same")
        movement = ChartMovement(rawValue: rawMovement) ?? .same
        delta = c.lenient(.delta, 0)
        peak = c.lenient(.peak, rank)
        editionsOnChart = c.lenient(.editionsOnChart, 1)
        brand = try c.decode(ChartBrand.self, forKey: .brand)
        subject = c.lenientOptional(.subject, as: ChartSubject.self) ?? ChartSubject(type: "brand", id: brand.id)
        drop = c.lenientOptional(.drop, as: ChartDrop.self)
        stat = c.lenientOptional(.stat, as: ChartStat.self) ?? ChartStat(label: "", figure: "", caption: "")
    }

    var title: String { drop?.name ?? brand.name }

    /// The drop for drop entries, else the brand's storefront.
    var route: Route {
        if let drop {
            return .drop(id: drop.slug.isEmpty ? drop.id : drop.slug)
        }
        return .brand(handle: brand.handle)
    }

    /// "Last week #4", "New this week", "Back on the chart".
    func previousText(_ period: ChartPeriod) -> String {
        switch movement {
        case .new: return period.isNewText
        case .reentry: return "Back on the chart"
        case .up, .down, .same:
            if let prevRank { return "\(period.previous) #\(prevRank)" }
            return period.previous
        }
    }

    /// The website's accessible row: "Acme. Rank 5, up 2 places, last week 7, peak 2. 120 new followers."
    func accessibilityText(_ period: ChartPeriod) -> String {
        let name = drop.map { "\($0.name) by \(brand.name)" } ?? brand.name
        if movement == .new { return "\(name). Rank \(rank), new entry. \(stat.label)." }
        let prev = prevRank.map { ", \(period.previousLower) \($0)" } ?? ""
        return "\(name). Rank \(rank), \(movement.words(delta: delta))\(prev), peak \(peak), \(period.unit(editionsOnChart)) on chart. \(stat.label)."
    }
}

struct ChartScopeInfo: Decodable, Hashable, Sendable {
    struct City: Decodable, Hashable, Sendable { let slug: String; let name: String; let country: String? }
    struct Country: Decodable, Hashable, Sendable { let code: String; let name: String }
    struct Category: Decodable, Hashable, Sendable { let slug: String; let label: String }

    let key: String?
    let city: City?
    let country: Country?
    let category: Category?
}

struct ChartEditionInfo: Decodable, Hashable, Sendable {
    struct Window: Decodable, Hashable, Sendable { let from: String; let to: String }

    /// UTC as-of date (yyyy-MM-dd).
    let date: String
    /// live / final.
    let status: String
    let computedAt: String
    let window: Window

    var isLive: Bool { status == "live" }
}

struct ChartSponsored: Decodable, Hashable, Identifiable, Sendable {
    let kind: String
    let brand: ChartBrand
    let drop: ChartDrop?

    var id: String { drop.map { "d:\($0.id)" } ?? "b:\(brand.id)" }

    var route: Route {
        if let drop { return .drop(id: drop.slug.isEmpty ? drop.id : drop.slug) }
        return .brand(handle: brand.handle)
    }
}

struct ChartCallouts: Decodable, Hashable, Sendable {
    let biggestClimber: ChartEntry?
    let highestDebut: ChartEntry?

    init(biggestClimber: ChartEntry? = nil, highestDebut: ChartEntry? = nil) {
        self.biggestClimber = biggestClimber
        self.highestDebut = highestDebut
    }

    enum CodingKeys: String, CodingKey { case biggestClimber, highestDebut }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        biggestClimber = c.lenientOptional(.biggestClimber, as: ChartEntry.self)
        highestDebut = c.lenientOptional(.highestDebut, as: ChartEntry.self)
    }
}

struct ChartFallback: Decodable, Hashable, Sendable {
    struct Country: Decodable, Hashable, Sendable { let code: String; let name: String; let eligible: Int }
    struct NearCity: Decodable, Hashable, Sendable { let slug: String; let name: String; let eligible: Int }

    let country: Country?
    let nearestCity: NearCity?
}

struct ChartBoard: Decodable, Sendable {
    let chart: ChartSlug
    let period: ChartPeriod
    let scope: ChartScopeInfo
    let state: ChartBoardState
    let edition: ChartEditionInfo?
    let cohortSize: Int
    let entries: [ChartEntry]
    let sponsored: [ChartSponsored]
    let callouts: ChartCallouts
    let fallback: ChartFallback?

    enum CodingKeys: String, CodingKey { case chart, period, scope, state, edition, cohortSize, entries, sponsored, callouts, fallback }

    init(chart: ChartSlug, period: ChartPeriod, scope: ChartScopeInfo, state: ChartBoardState, edition: ChartEditionInfo?, cohortSize: Int, entries: [ChartEntry], sponsored: [ChartSponsored] = [], callouts: ChartCallouts = ChartCallouts(), fallback: ChartFallback? = nil) {
        self.chart = chart
        self.period = period
        self.scope = scope
        self.state = state
        self.edition = edition
        self.cohortSize = cohortSize
        self.entries = entries
        self.sponsored = sponsored
        self.callouts = callouts
        self.fallback = fallback
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let rawChart: String = c.lenient(.chart, "top")
        chart = ChartSlug(rawValue: rawChart) ?? .top
        let rawPeriod: String = c.lenient(.period, "weekly")
        period = ChartPeriod(rawValue: rawPeriod) ?? .weekly
        scope = c.lenientOptional(.scope, as: ChartScopeInfo.self) ?? ChartScopeInfo(key: nil, city: nil, country: nil, category: nil)
        let rawState: String = c.lenient(.state, "ok")
        state = ChartBoardState(rawValue: rawState) ?? .ok
        edition = c.lenientOptional(.edition, as: ChartEditionInfo.self)
        cohortSize = c.lenient(.cohortSize, 0)
        // One entry that fails to decode is dropped, never the whole board.
        let lossy: [ChartsLossy<ChartEntry>] = c.lenient(.entries, [])
        entries = lossy.compactMap { $0.value }
        let lossySponsored: [ChartsLossy<ChartSponsored>] = c.lenient(.sponsored, [])
        sponsored = lossySponsored.compactMap { $0.value }
        callouts = c.lenientOptional(.callouts, as: ChartCallouts.self) ?? ChartCallouts()
        fallback = c.lenientOptional(.fallback, as: ChartFallback.self)
    }
}

/// Decodes an element or nil, so one bad array element doesn't fail the array.
struct ChartsLossy<T: Decodable>: Decodable {
    let value: T?

    init(from decoder: Decoder) throws {
        value = try? T(from: decoder)
    }
}

// MARK: - Scopes

struct ChartScopes: Decodable, Sendable {
    struct City: Decodable, Hashable, Identifiable, Sendable {
        let slug: String
        let name: String
        let country: String
        let eligible: Int
        let byCategory: [String: Int]
        var id: String { slug }
    }

    struct Country: Decodable, Hashable, Identifiable, Sendable {
        let code: String
        let name: String
        let eligible: Int
        let byCategory: [String: Int]
        var id: String { code }
    }

    struct Category: Decodable, Hashable, Identifiable, Sendable {
        let slug: String
        let label: String
        let eligible: Int
        var id: String { slug }
    }

    let cities: [City]
    let countries: [Country]
    let categories: [Category]
    let minCohort: Int

    enum CodingKeys: String, CodingKey { case cities, countries, categories, minCohort }

    init(cities: [City], countries: [Country], categories: [Category], minCohort: Int = 3) {
        self.cities = cities
        self.countries = countries
        self.categories = categories
        self.minCohort = minCohort
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let lc: [ChartsLossy<City>] = c.lenient(.cities, [])
        cities = lc.compactMap { $0.value }
        let lk: [ChartsLossy<Country>] = c.lenient(.countries, [])
        countries = lk.compactMap { $0.value }
        let lg: [ChartsLossy<Category>] = c.lenient(.categories, [])
        categories = lg.compactMap { $0.value }
        minCohort = c.lenient(.minCohort, 3)
    }
}

// MARK: - Formatting

enum ChartsFormat {
    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "d MMM"
        return f
    }()

    private static let parser: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func day(_ iso: String) -> String {
        if let d = parser.date(from: String(iso.prefix(10))) { return dayFormatter.string(from: d) }
        return iso
    }

    /// "Weekly edition, 31 Oct – 6 Nov", "Daily edition, 6 Nov"; finals read "Week of 31 Oct".
    static func editionText(_ e: ChartEditionInfo, period: ChartPeriod) -> String {
        if !e.isLive {
            switch period {
            case .daily: return "Edition of \(day(e.window.to))"
            case .weekly: return "Week of \(day(e.window.from))"
            case .monthly: return "Month to \(day(e.window.to))"
            }
        }
        switch period {
        case .daily: return "Daily edition, \(day(e.window.to))"
        case .weekly: return "Weekly edition, \(day(e.window.from)) – \(day(e.window.to))"
        case .monthly: return "Monthly edition, \(day(e.window.from)) – \(day(e.window.to))"
        }
    }

    /// "just now", "2 min ago", "1 h ago".
    static func updatedAgo(_ iso: String, now: Date = Date()) -> String? {
        guard let d = YardDate.parse(iso) else { return nil }
        let s = max(0, Int(now.timeIntervalSince(d).rounded()))
        if s < 45 { return "just now" }
        let m = Int((Double(s) / 60).rounded())
        if m < 60 { return "\(m) min ago" }
        return "\(Int((Double(m) / 60).rounded())) h ago"
    }

    static func two(_ n: Int) -> String {
        n < 10 && n >= 0 ? "0\(n)" : "\(n)"
    }

    static func brands(_ n: Int) -> String { "\(n) \(n == 1 ? "brand" : "brands")" }
}
