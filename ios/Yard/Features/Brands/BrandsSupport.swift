import SwiftUI

// Small helpers shared by the Brands screens (directory + profile). Brands-owned; prefixed
// `Brands…` so nothing clashes with other feature folders.

// MARK: - Categories

/// Category slug → name, the website's catalog list (src/lib/data/catalog.ts `categories`).
enum BrandsCategory {
    static let names: [String: String] = [
        "fashion": "Fashion",
        "streetwear": "Streetwear",
        "sneakers": "Sneakers",
        "accessories": "Accessories",
        "jewelry": "Jewelry",
        "beauty": "Beauty",
        "technology": "Technology",
        "art-design": "Art & design",
        "home-lifestyle": "Home & lifestyle",
        "creative": "Independent creative",
    ]

    /// The website's order for the category chips.
    static let order: [String] = ["fashion", "streetwear", "sneakers", "accessories", "jewelry", "beauty", "technology", "art-design", "home-lifestyle", "creative"]

    /// A category's display name; nil for slugs the app doesn't know.
    static func name(for slug: String) -> String? { names[slug] }

    /// The first known category name in a brand's list.
    static func firstName(in slugs: [String]) -> String? {
        for slug in slugs {
            if let name = names[slug] { return name }
        }
        return nil
    }
}

// MARK: - Places

enum BrandsPlace {
    /// "Lagos, Nigeria" (the website shows the country's name, not its code).
    static func text(city: String, country: String) -> String {
        let countryName: String
        if country.count == 2 {
            countryName = Locale.current.localizedString(forRegionCode: country.uppercased()) ?? country
        } else {
            countryName = country
        }
        return [city, countryName].filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

// MARK: - Follow

/// Follow/unfollow with the sign-in gate, haptics left to the caller.
@MainActor
enum BrandsFollow {
    /// Toggles following `brandId`. Signed out → presents Sign in and returns nil.
    /// Errors are shown as a toast (the server's message) and return nil.
    @discardableResult
    static func toggle(brandId: String, brandName: String, session: SessionStore, follows: FollowStore, router: Router, toast: ToastCenter) async -> FollowResult? {
        guard session.isSignedIn else {
            router.present(.signIn)
            return nil
        }
        do {
            let result = try await follows.toggle(brandId: brandId)
            if result.following {
                toast.show("Following \(brandName)", style: .success, systemImage: "checkmark")
            }
            return result
        } catch {
            toast.show(error)
            return nil
        }
    }
}

// MARK: - Storefront extras

/// Fields of GET /api/catalog/storefronts/{handle} that the shared `StorefrontBrand` model doesn't
/// carry. The server returns the whole public brand row, which includes `story` (≤ 2,000 chars).
struct BrandsStorefrontExtras: Decodable, Sendable {
    struct Brand: Decodable, Sendable {
        let story: String?

        enum CodingKeys: String, CodingKey { case story }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            story = c.lenientOptional(.story)
        }
    }

    let brand: Brand?

    enum CodingKeys: String, CodingKey { case brand }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        brand = c.lenientOptional(.brand)
    }
}

// MARK: - Glass circle (for Menu labels, which can't be a Button)

/// The same look as `GlassIconButton`, as a plain label (used inside `Menu`).
@MainActor
struct BrandsGlassCircle: View {
    let systemImage: String
    var size: CGFloat = 40

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: size * 0.4, weight: .semibold))
            .foregroundStyle(Color.yard.onPhoto)
            .frame(width: size, height: size)
            .background(.ultraThinMaterial, in: Circle())
            .overlay(Circle().strokeBorder(Color.yard.onPhoto.opacity(0.18), lineWidth: 0.5))
            .environment(\.colorScheme, .dark)
            .contentShape(Circle())
    }
}

// MARK: - Founding badge

/// "Founding brand" (the website's FoundingBadge: sparkle + text, violet tint).
@MainActor
struct BrandsFoundingBadge: View {
    var onPhoto: Bool = false

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "sparkle")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(onPhoto ? Color.yard.onPhoto : Color.yard.violet)
            Text("Founding brand")
                .font(.yardMicro)
                .foregroundStyle(onPhoto ? Color.yard.onPhoto : Color.yard.ink)
                .lineLimit(1)
        }
        .padding(.horizontal, 8)
        .frame(height: 22)
        .background(
            Capsule().fill(onPhoto ? Color.yard.onPhoto.opacity(0.16) : Color.yard.violet.opacity(0.12))
        )
        .overlay(
            Capsule().strokeBorder(onPhoto ? Color.yard.onPhoto.opacity(0.3) : Color.yard.violet.opacity(0.4), lineWidth: 1)
        )
        .fixedSize()
        .accessibilityElement(children: .combine)
    }
}
