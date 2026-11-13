import SwiftUI

/// A map pin: the brand's avatar in a ring with a pointer. Acid ring when selected; a small acid
/// dot when the place is live or open now.
struct AroundPin: View {
    let name: String
    let logoURL: URL?
    let isSelected: Bool
    let isOpen: Bool

    var body: some View {
        let ring: Color = isSelected ? Color.yard.acid : Color.yard.surface
        VStack(spacing: 0) {
            BrandAvatar(name: name, logoURL: logoURL, size: isSelected ? 42 : 34)
                .padding(3)
                .background(Circle().fill(ring))
                .overlay(alignment: .topTrailing) {
                    if isOpen {
                        Circle()
                            .fill(Color.yard.acid)
                            .frame(width: 10, height: 10)
                            .overlay(Circle().strokeBorder(Color.yard.onAcid, lineWidth: 1.5))
                            .offset(x: 1, y: -1)
                            .accessibilityHidden(true)
                    }
                }
            Image(systemName: "triangle.fill")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(ring)
                .rotationEffect(.degrees(180))
                .offset(y: -2)
                .accessibilityHidden(true)
        }
        .compositingGroup()
        .shadow(color: Color.yard.scrim.opacity(0.28), radius: 6, x: 0, y: 3)
        .animation(Motion.snappy, value: isSelected)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(name))
        .accessibilityAddTraits(.isButton)
    }
}

/// The status line with its dot: acid for live, success for open.
struct AroundStatusText: View {
    let line: AroundStatusLine

    var body: some View {
        HStack(spacing: Spacing.xs + 2) {
            switch line.tone {
            case .live:
                Circle().fill(Color.yard.acid).frame(width: 6, height: 6)
                    .overlay(Circle().strokeBorder(Color.yard.line, lineWidth: 0.5))
            case .open:
                Circle().fill(Color.yard.success).frame(width: 6, height: 6)
            case .neutral:
                EmptyView()
            }
            Text(line.text)
                .foregroundStyle(line.tone == .neutral ? Color.yard.ink2 : Color.yard.ink)
                .lineLimit(1)
        }
        .font(.yardCaption)
    }
}

/// A row of the places list: avatar, brand, "{category} · {kind}" in the area, status, next event,
/// and the distance only when the shopper's location is known.
struct AroundPlaceRow: View {
    let place: AroundPlace
    let logoURL: URL?
    let distanceText: String?
    let now: Date
    var isSelected: Bool = false

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.m) {
            BrandAvatar(name: place.brand.name, logoURL: logoURL, size: 44, verified: place.brand.verified)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: Spacing.s) {
                    Text(place.brand.name)
                        .font(.yardHeadline)
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(1)
                    if place.sample {
                        Tag("Sample place")
                    }
                    Spacer(minLength: 0)
                    if let distanceText {
                        Text(distanceText)
                            .font(.yardCaption.monospacedDigit())
                            .foregroundStyle(Color.yard.ink2)
                    }
                }
                Text("\(place.categoryKindText) · \(place.whereText)")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink2)
                    .lineLimit(1)
                if let line = AroundTime.statusLine(for: place, at: now) {
                    AroundStatusText(line: line)
                }
                if let next = AroundTime.nextEventLine(for: place, at: now) {
                    Text(next)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(1)
                }
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.yard.ink3)
                .padding(.top, Spacing.xs)
        }
        .padding(Spacing.m)
        .background(
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .fill(isSelected ? Color.yard.surface2 : Color.yard.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(isSelected ? Color.yard.purple : Color.yard.line, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Loading rows for the list.
struct AroundRowSkeleton: View {
    var body: some View {
        HStack(alignment: .top, spacing: Spacing.m) {
            Skeleton(shape: .circle).frame(width: 44, height: 44)
            VStack(alignment: .leading, spacing: 6) {
                Skeleton(cornerRadius: 6).frame(width: 140, height: 14)
                Skeleton(cornerRadius: 6).frame(width: 200, height: 11)
                Skeleton(cornerRadius: 6).frame(width: 120, height: 11)
            }
            Spacer()
        }
        .padding(Spacing.m)
        .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(Color.yard.surface))
    }
}

#Preview("Around rows — dark") {
    VStack(spacing: Spacing.s) {
        AroundPlaceRow(place: AroundFixtures.store, logoURL: nil, distanceText: "1.2 km", now: Date())
        AroundPlaceRow(place: AroundFixtures.popup, logoURL: nil, distanceText: nil, now: Date(), isSelected: true)
        AroundRowSkeleton()
        HStack(spacing: 24) {
            AroundPin(name: "Lagos Thread", logoURL: nil, isSelected: false, isOpen: true)
            AroundPin(name: "Acme", logoURL: nil, isSelected: true, isOpen: false)
        }
    }
    .padding()
    .frame(maxHeight: .infinity)
    .background(Color.yard.bg)
    .preferredColorScheme(.dark)
}

#Preview("Around rows — light") {
    VStack(spacing: Spacing.s) {
        AroundPlaceRow(place: AroundFixtures.store, logoURL: nil, distanceText: "850 m", now: Date())
        AroundPlaceRow(place: AroundFixtures.popup, logoURL: nil, distanceText: "24 km", now: Date())
        AroundPin(name: "Lagos Thread", logoURL: nil, isSelected: true, isOpen: true)
    }
    .padding()
    .frame(maxHeight: .infinity)
    .background(Color.yard.bg)
    .preferredColorScheme(.light)
}
