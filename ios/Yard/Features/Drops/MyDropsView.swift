import SwiftUI

/// "Your drops": every draw the shopper entered (with results and purchase windows) and every
/// release reminder they set. GET /api/drops/me (shopper only).
@MainActor
struct MyDropsView: View {
    @Environment(Router.self) private var router
    @Environment(SessionStore.self) private var session
    @Environment(ToastCenter.self) private var toast

    @State private var model: MyDropsViewModel

    init() {
        _model = State(initialValue: MyDropsViewModel())
    }

    /// Previews only.
    fileprivate init(model: MyDropsViewModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        Group {
            if !session.isSignedIn {
                EmptyState.signedOut(
                    title: "Your drops",
                    message: "Sign in to see every draw you enter and every release reminder you set, across your followed brands."
                ) {
                    router.present(.signIn)
                }
            } else {
                switch model.state {
                case .loading:
                    ScrollView { DropsSkeleton() }
                        .scrollDisabled(true)
                case .failed(let error):
                    EmptyState.error(error) { await model.load() }
                case .loaded:
                    if let response = model.response {
                        list(response)
                    } else {
                        EmptyView()
                    }
                }
            }
        }
        .yardScreenBackground()
        .navigationTitle("Your drops")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: session.isSignedIn) {
            if session.isSignedIn { await model.load() } else { model.reset() }
        }
    }

    private func list(_ response: MyDropsResponse) -> some View {
        let entries = response.entries.filter { $0.status != "withdrawn" }
        let reminders = response.reminders.filter { $0.drop != nil }
        return ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xxl) {
                VStack(alignment: .leading, spacing: Spacing.s) {
                    Text("Your drops")
                        .yardDisplay(48)
                        .foregroundStyle(Color.yard.ink)
                    Text("Every draw you enter and every reminder you set, across the brands you follow.")
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, Spacing.gutter)
                .padding(.top, Spacing.s)

                VStack(alignment: .leading, spacing: Spacing.m) {
                    SectionHeader("Draw entries", subtitle: "Results and winner purchase windows.", display: true)
                    if entries.isEmpty {
                        emptyLine("You haven't entered a draw yet.")
                    } else {
                        VStack(spacing: Spacing.s) {
                            ForEach(entries) { entry in
                                NavigationLink(value: Route.drop(id: entry.drop.slug)) {
                                    DropListRow(
                                        drop: entry.drop,
                                        caption: entryCaption(entry),
                                        entryStatus: entry.status,
                                        footnote: windowFootnote(entry)
                                    )
                                }
                                .buttonStyle(PressableButtonStyle())
                            }
                        }
                        .padding(.horizontal, Spacing.gutter)
                    }
                }

                VStack(alignment: .leading, spacing: Spacing.m) {
                    SectionHeader("Reminders", subtitle: "Drops you asked us to notify you about.", display: true)
                    if reminders.isEmpty {
                        emptyLine("You haven't set a drop reminder yet.")
                    } else {
                        VStack(spacing: Spacing.s) {
                            ForEach(reminders) { reminder in
                                if let drop = reminder.drop {
                                    NavigationLink(value: Route.drop(id: drop.slug)) {
                                        DropListRow(drop: drop, caption: reminderCaption(reminder, drop: drop))
                                    }
                                    .buttonStyle(PressableButtonStyle())
                                    .contextMenu {
                                        Button(role: .destructive) {
                                            removeReminder(drop)
                                        } label: {
                                            Label("Remove reminder", systemImage: "bell.slash")
                                        }
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, Spacing.gutter)
                    }
                }

                HStack {
                    YardButton("Explore drops", systemImage: "sparkles", style: .secondary, size: .medium, fullWidth: false) {
                        router.push(.drops)
                    }
                    Spacer()
                }
                .padding(.horizontal, Spacing.gutter)
            }
            .padding(.bottom, Spacing.xxxl)
        }
        .refreshable { await model.load() }
    }

    private func emptyLine(_ text: String) -> some View {
        Text(text)
            .font(.yardCallout)
            .foregroundStyle(Color.yard.ink3)
            .padding(.horizontal, Spacing.gutter)
    }

    private func entryCaption(_ entry: MyDropsResponse.Entry) -> String {
        if entry.status == "won", let ends = YardDate.parse(entry.windowEndsAt) {
            return "Purchase by \(Formatters.dateTime(ends)) · your time"
        }
        if entry.status == "entered", let at = YardDate.parse(entry.enteredAt) {
            return "Entered \(Formatters.dateTime(at)) · your time"
        }
        if let rank = entry.rank { return "Queue position \(rank)" }
        return "Draw result is available on the drop page."
    }

    private func windowFootnote(_ entry: MyDropsResponse.Entry) -> String? {
        guard entry.drop.isDraw, entry.status == "won", let minutes = entry.drop.purchaseWindowMinutes else { return nil }
        return "Purchase window: \(DropText.windowLength(minutes))"
    }

    private func reminderCaption(_ reminder: MyDropsResponse.Reminder, drop: Drop) -> String {
        let phase = drop.livePhase(at: Date())
        if phase == .upcoming, let opens = drop.reminderOpenDate(now: Date()) {
            return "\(drop.isDrawWaiting(phase, now: Date()) ? "Entries open" : "Opens") \(Formatters.dateTime(opens)) · \(Formatters.future(opens))"
        }
        if let set = YardDate.parse(reminder.setAt) {
            return "Reminder set \(Formatters.dateTime(set)) · \(drop.statusLabel(phase))"
        }
        return drop.statusLabel(phase)
    }

    private func removeReminder(_ drop: Drop) {
        Task { @MainActor in
            do {
                _ = try await DropActions.setReminder(false, drop: drop)
                toast.show("Reminder removed", style: .info)
                await model.load()
            } catch {
                toast.show(error)
            }
        }
    }
}

@Observable
@MainActor
final class MyDropsViewModel {
    enum LoadState {
        case loading
        case loaded
        case failed(Error)
    }

    var state: LoadState = .loading
    var response: MyDropsResponse?

    init() {}

    /// Previews only.
    init(preview: MyDropsResponse) {
        response = preview
        state = .loaded
    }

    func load() async {
        if response == nil { state = .loading }
        do {
            let r: MyDropsResponse = try await APIClient.shared.get("/api/drops/me", as: MyDropsResponse.self)
            response = r
            state = .loaded
            // Keep this iPhone's "10 minutes before" alerts in line with reminders set anywhere.
            for reminder in r.reminders {
                if let drop = reminder.drop { await DropLocalReminder.sync(drop: drop, reminderOn: true) }
            }
        } catch {
            if response == nil { state = .failed(error) }
        }
    }

    func reset() {
        response = nil
        state = .loading
    }
}

#Preview("MyDropsView — dark") {
    NavigationStack {
        MyDropsView(model: MyDropsViewModel(preview: MyDropsResponse(
            entries: [MyDropsResponse.Entry(drop: DropsPreviewFixtures.draw, status: "entered", rank: nil, windowOpensAt: nil, windowEndsAt: nil, enteredAt: "2026-11-12T10:00:00.000Z")],
            reminders: [MyDropsResponse.Reminder(dropId: DropsPreviewFixtures.upcoming.id, setAt: "2026-11-12T10:00:00.000Z", drop: DropsPreviewFixtures.upcoming)]
        )))
    }
    .yardPreviewEnvironment()
    .preferredColorScheme(.dark)
}

#Preview("MyDropsView — light") {
    NavigationStack {
        MyDropsView(model: MyDropsViewModel(preview: MyDropsResponse(entries: [], reminders: [])))
    }
    .yardPreviewEnvironment()
    .preferredColorScheme(.light)
}

#Preview("MyDropsView — signed out") {
    NavigationStack { MyDropsView() }
        .yardPreviewEnvironment(signedIn: false)
        .preferredColorScheme(.dark)
}
