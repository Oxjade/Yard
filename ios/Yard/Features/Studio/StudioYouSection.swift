import SwiftUI

/// The You tab's selling section: Switch to Studio (with each brand and its status), the pending
/// application ("In review"), a rejected application's note, or "Sell on Yard".
@MainActor
struct StudioYouSection: View {
    @Environment(StudioStore.self) private var studio
    @Environment(SessionStore.self) private var session

    @State private var application: StudioApplication?
    @State private var showsApplication = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Text("Selling")
                .font(.yardHeadline)
                .foregroundStyle(Color.yard.ink2)
                .padding(.horizontal, Spacing.xs)
                .accessibilityAddTraits(.isHeader)
            if !studio.studioBrands.isEmpty {
                ForEach(studio.studioBrands) { brand in
                    brandCard(brand)
                }
            } else if let application, application.isWaiting {
                pendingCard(name: application.brand?.name ?? "Your shop")
            } else if let application, application.isRejected {
                rejectedCard(application)
            } else {
                sellCard
            }
        }
        .task(id: session.shopper?.id ?? "") {
            application = try? await StudioAPI.application()
        }
        .fullScreenCover(isPresented: $showsApplication) {
            NavigationStack {
                SellerApplicationView(onClose: { showsApplication = false })
            }
        }
    }

    private func brandCard(_ brand: ShopperBrand) -> some View {
        Button {
            Haptics.impact(.medium)
            studio.enterStudio(brandId: brand.id)
        } label: {
            HStack(spacing: Spacing.m) {
                StudioBrandMark(brand: brand, size: 48, sessionOpen: false)
                VStack(alignment: .leading, spacing: 4) {
                    Text(brand.name)
                        .font(.yardHeadline)
                        .foregroundStyle(Color.yard.onPhoto)
                    HStack(spacing: Spacing.s) {
                        Text(brand.isPending ? "Yard is reviewing your shop" : "Open Studio")
                            .font(.yardCaption)
                            .foregroundStyle(Color.yard.onPhoto.opacity(0.8))
                        if brand.isPending || brand.isRestricted {
                            Tag(brand.statusLabel, style: .acid)
                        }
                    }
                }
                Spacer()
                Image(systemName: "arrow.right")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Color.yard.onAcid)
                    .frame(width: 36, height: 36)
                    .background(Color.yard.acid, in: Circle())
            }
            .padding(Spacing.l)
            .background(Color.yard.studio, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityLabel(Text("Switch to Studio for \(brand.name)"))
    }

    private func pendingCard(name: String) -> some View {
        HStack(spacing: Spacing.m) {
            Image(systemName: "hourglass")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.yard.onPhoto)
                .frame(width: 44, height: 44)
                .background(Color.yard.studio, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.yardHeadline)
                    .foregroundStyle(Color.yard.ink)
                Text("Pending review. We'll let you know.")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
            }
            Spacer()
            Tag("In review", style: .violet)
        }
        .padding(Spacing.l)
        .yardCard()
        .accessibilityElement(children: .combine)
    }

    private func rejectedCard(_ application: StudioApplication) -> some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Text("Your application needs changes")
                .font(.yardHeadline)
                .foregroundStyle(Color.yard.ink)
            if let note = application.reviewNote, !note.isEmpty {
                Text(note)
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            YardButton("Apply again", style: .primary, size: .medium) {
                Haptics.impact(.light)
                showsApplication = true
            }
        }
        .padding(Spacing.l)
        .yardCard()
    }

    private var sellCard: some View {
        Button {
            Haptics.impact(.light)
            showsApplication = true
        } label: {
            HStack(spacing: Spacing.m) {
                Image(systemName: "storefront.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.yard.onPhoto)
                    .frame(width: 44, height: 44)
                    .background(Color.yard.studio, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("Sell on Yard")
                        .font(.yardHeadline)
                        .foregroundStyle(Color.yard.ink)
                    Text("Apply in about a minute.")
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink2)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.yard.ink3)
            }
            .padding(Spacing.l)
            .yardCard()
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableButtonStyle())
    }
}
