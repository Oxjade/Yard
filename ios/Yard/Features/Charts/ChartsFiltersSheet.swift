import SwiftUI

/// The website's phone Filters sheet: Category and Location (City on City charts) as chips.
/// It edits a draft; "Show chart" applies it, closing discards it. Options under the minimum
/// cohort are listed but can't be chosen, so two choices never combine into an empty board.
struct ChartsFiltersSheet: View {
    let scopes: ChartScopes?
    /// The city a City chart currently shows (the server's or the shopper's default).
    let resolvedCity: (slug: String, name: String)?
    let onApply: (ChartsQuery) -> Void

    @State private var draft: ChartsQuery
    @Environment(\.dismiss) private var dismiss

    init(query: ChartsQuery, scopes: ChartScopes?, resolvedCity: (slug: String, name: String)?, onApply: @escaping (ChartsQuery) -> Void) {
        self.scopes = scopes
        self.resolvedCity = resolvedCity
        self.onApply = onApply
        self._draft = State(initialValue: query)
    }

    private var minCohort: Int { scopes?.minCohort ?? 3 }

    var body: some View {
        VStack(spacing: 0) {
            YardSheetHeader("Filters", subtitle: draft.chart.label) { dismiss() }
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    section(draft.chart == .city ? "City" : "Location") {
                        ForEach(locationOptions) { option in
                            Chip(option.label, isSelected: locationValue == option.value, isEnabled: !option.disabled) {
                                applyLocation(option.value)
                            }
                        }
                    }
                    section("Category") {
                        ForEach(categoryOptions) { option in
                            Chip(option.label, isSelected: (draft.category ?? "all") == option.value, isEnabled: !option.disabled) {
                                draft.category = option.value == "all" ? nil : option.value
                            }
                        }
                    }
                    if scopes == nil {
                        Text("Places and categories couldn't load. You can still see every chart everywhere.")
                            .font(.yardCaption)
                            .foregroundStyle(Color.yard.ink3)
                    }
                }
                .padding(Spacing.gutter)
            }
            HStack(spacing: Spacing.s) {
                YardButton("Clear", style: .secondary, fullWidth: false) {
                    draft.category = nil
                    draft.country = nil
                    if draft.chart != .city { draft.city = nil }
                }
                .disabled(!canClear)
                YardButton("Show chart") {
                    onApply(draft)
                    dismiss()
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.vertical, Spacing.m)
        }
        .background(Color.yard.bg)
        .yardSheet(detents: [.medium, .large])
    }

    private var canClear: Bool {
        draft.category != nil || draft.country != nil || (draft.chart != .city && draft.city != nil)
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: @escaping () -> Content) -> some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Text(title)
                .font(.yardCaptionEmphasis)
                .foregroundStyle(Color.yard.ink2)
            ChartsFlowLayout(spacing: Spacing.s) {
                content()
            }
        }
    }

    // MARK: Options (website board-controls.tsx)

    struct Option: Identifiable {
        let value: String
        let label: String
        var disabled: Bool = false
        var id: String { value }
    }

    private var locationValue: String {
        if let city = draft.city { return "city:\(city)" }
        if let country = draft.country { return "country:\(country)" }
        if draft.chart == .city, let resolvedCity { return "city:\(resolvedCity.slug)" }
        return "all"
    }

    private func applyLocation(_ value: String) {
        let parts = value.split(separator: ":", maxSplits: 1).map(String.init)
        let kind = parts.first ?? "all"
        let val = parts.count > 1 ? parts[1] : nil
        draft.city = kind == "city" ? val : nil
        draft.country = kind == "country" ? val : nil
    }

    private func count(_ eligible: Int, _ byCategory: [String: Int]) -> Int {
        if let cat = draft.category { return byCategory[cat] ?? 0 }
        return eligible
    }

    private var locationOptions: [Option] {
        guard let scopes else {
            return draft.chart == .city ? [] : [Option(value: "all", label: "Everywhere")]
        }
        let currentCity = draft.city ?? (draft.chart == .city ? resolvedCity?.slug : nil)
        let cities = scopes.cities.filter { $0.eligible >= minCohort || $0.slug == currentCity }
        var cityOptions: [Option] = cities.map { c in
            let n = count(c.eligible, c.byCategory)
            return Option(value: "city:\(c.slug)", label: "\(c.name) · \(ChartsFormat.brands(n))", disabled: n < minCohort && c.slug != currentCity)
        }
        if let resolvedCity, !cities.contains(where: { $0.slug == resolvedCity.slug }) {
            cityOptions.append(Option(value: "city:\(resolvedCity.slug)", label: resolvedCity.name))
        }
        if draft.chart == .city { return cityOptions }
        let countries: [Option] = scopes.countries
            .filter { count($0.eligible, $0.byCategory) > 0 || $0.code == draft.country }
            .map { c in
                let n = count(c.eligible, c.byCategory)
                return Option(value: "country:\(c.code)", label: "\(c.name) · \(ChartsFormat.brands(n))", disabled: n < minCohort && c.code != draft.country)
            }
        return [Option(value: "all", label: "Everywhere")] + countries + cityOptions
    }

    private var categoryOptions: [Option] {
        var out: [Option] = [Option(value: "all", label: "All categories")]
        guard let scopes else { return out }
        let citySlug = draft.city ?? (draft.chart == .city ? resolvedCity?.slug : nil)
        for c in scopes.categories {
            let n: Int
            if let citySlug {
                n = scopes.cities.first(where: { $0.slug == citySlug })?.byCategory[c.slug] ?? 0
            } else if let code = draft.country {
                n = scopes.countries.first(where: { $0.code == code })?.byCategory[c.slug] ?? 0
            } else {
                n = c.eligible
            }
            let current = c.slug == draft.category
            if n == 0 && !current { continue }
            out.append(Option(value: c.slug, label: "\(c.label) · \(ChartsFormat.brands(n))", disabled: n < minCohort && !current))
        }
        return out
    }
}

/// A simple wrapping row layout for chips.
struct ChartsFlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            let w = min(size.width, maxWidth)
            if x > 0 && x + w > maxWidth {
                y += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += w + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x: CGFloat = bounds.minX
        var y: CGFloat = bounds.minY
        var rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            let w = min(size.width, bounds.width)
            if x > bounds.minX && x + w > bounds.maxX {
                y += rowHeight + spacing
                x = bounds.minX
                rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(width: w, height: size.height))
            x += w + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

#Preview("Charts filters — dark") {
    Color.clear.sheet(isPresented: .constant(true)) {
        ChartsFiltersSheet(query: ChartsQuery(), scopes: ChartsFiltersPreview.scopes, resolvedCity: nil) { _ in }
    }
    .yardPreviewEnvironment()
    .preferredColorScheme(.dark)
}

#Preview("Charts filters — light") {
    Color.clear.sheet(isPresented: .constant(true)) {
        ChartsFiltersSheet(query: ChartsQuery(chart: .city), scopes: ChartsFiltersPreview.scopes, resolvedCity: (slug: "lagos", name: "Lagos")) { _ in }
    }
    .yardPreviewEnvironment()
    .preferredColorScheme(.light)
}

enum ChartsFiltersPreview {
    static let scopes = ChartScopes(
        cities: [
            .init(slug: "lagos", name: "Lagos", country: "NG", eligible: 6, byCategory: ["streetwear": 4]),
            .init(slug: "accra", name: "Accra", country: "GH", eligible: 2, byCategory: ["streetwear": 1]),
        ],
        countries: [
            .init(code: "GH", name: "Ghana", eligible: 2, byCategory: ["streetwear": 1]),
            .init(code: "NG", name: "Nigeria", eligible: 7, byCategory: ["streetwear": 5]),
        ],
        categories: [
            .init(slug: "streetwear", label: "Streetwear", eligible: 6),
            .init(slug: "bags", label: "Bags", eligible: 1),
        ],
        minCohort: 3
    )
}
