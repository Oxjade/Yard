import Foundation

// GET /api/session (src/lib/api/contracts/session.ts SessionDto). Who this device is signed in as.
// The app only acts as a shopper; `brand`/`admin` are decoded leniently for completeness.
// Sign out: POST /api/auth/sign-out?actor=shopper (SessionStore.signOut()).

struct Session: Decodable, Sendable {
    let shopper: Shopper?
    let brand: BrandMember?
    let sampleData: Bool

    static let signedOut = Session(shopper: nil, brand: nil, sampleData: false)

    init(shopper: Shopper?, brand: BrandMember?, sampleData: Bool) {
        self.shopper = shopper
        self.brand = brand
        self.sampleData = sampleData
    }

    enum CodingKeys: String, CodingKey { case shopper, brand, sampleData }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        shopper = c.lenientOptional(.shopper)
        brand = c.lenientOptional(.brand)
        sampleData = c.lenient(.sampleData, false)
    }
}

/// The signed-in shopper.
struct Shopper: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let name: String
    let email: String
    /// "active" | "restricted" | "suspended".
    let status: String
    let demo: Bool

    /// First name for greetings ("Hi, Ada").
    var firstName: String { name.split(separator: " ").first.map(String.init) ?? name }
    /// Initials for an avatar.
    var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        let letters = parts.compactMap { $0.first }.map { String($0) }.joined()
        return letters.isEmpty ? "Y" : letters.uppercased()
    }

    init(id: String, name: String, email: String, status: String = "active", demo: Bool = false) {
        self.id = id
        self.name = name
        self.email = email
        self.status = status
        self.demo = demo
    }
}

extension Shopper {
    enum CodingKeys: String, CodingKey { case id, name, email, status, demo }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = c.lenient(.name, "")
        email = c.lenient(.email, "")
        status = c.lenient(.status, "active")
        demo = c.lenient(.demo, false)
    }
}

/// A brand membership on this device (the web Studio; the app just knows it exists).
struct BrandMember: Decodable, Hashable, Sendable {
    struct Brand: Decodable, Hashable, Sendable {
        let id: String
        let handle: String
        let name: String
    }
    let userId: String
    let name: String
    let brand: Brand
    let role: String
}
