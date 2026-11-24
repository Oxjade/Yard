import SwiftUI
import Observation

// MARK: - Model

@Observable
@MainActor
final class StudioSuggestionsModel {
    enum Busy: Equatable { case accept, decline }

    private(set) var items: [StudioProposal] = []
    private(set) var loaded: Bool = false
    private(set) var error: String?
    private(set) var busy: Busy?
    /// Why a suggestion was skipped by the last batch (shown on its row while it stays pending).
    private(set) var reasons: [String: String] = [:]
    var selected: Set<String> = []
    private var keys = StudioBatchKeys()

    var allNew: Bool { items.allSatisfy { $0.isNew } }

    func load(studio: StudioStore) async {
        do {
            let list = try await studio.call { try await StudioAPI.suggestions(status: "pending") }
            apply(list.pending)
            studio.suggestionsPending = items.count
            error = nil
        } catch {
            if (error as? APIError)?.isCancelled != true {
                self.error = APIError.message(for: error)
            }
        }
        loaded = true
    }

    private func apply(_ pending: [StudioProposal]) {
        items = pending
        let ids = Set(pending.map(\.id))
        selected = selected.intersection(ids)
        reasons = reasons.filter { ids.contains($0.key) }
    }

    /// Accept (or decline) `ids`, or every pending suggestion when nil. Returns the result, or
    /// nil with `error` set. A retry after a dropped answer reuses the key (nothing runs twice).
    func run(_ action: Busy, ids: [String]?, reason: String? = nil, studio: StudioStore) async -> Result<StudioBatchResult, APIError> {
        guard busy == nil else { return .failure(APIError(status: 0, code: "busy", message: "One moment, the last batch is still running.")) }
        let chosen: [String]? = ids.map { Array($0.prefix(200)) }
        let trimmed = reason?.trimmingCharacters(in: .whitespacesAndNewlines)
        let note: String? = (trimmed?.isEmpty ?? true) ? nil : String(trimmed!.prefix(300))
        let name = action == .accept ? "accept" : "decline"
        let key = keys.key(for: StudioBatchKeys.signature(action: name, ids: chosen, reason: note))
        let body = StudioBatchBody(ids: chosen, reason: action == .decline ? note : nil, idempotencyKey: key)
        busy = action
        defer { busy = nil }
        do {
            let accepting = action == .accept
            let result: StudioBatchResult = try await studio.call { () async throws -> StudioBatchResult in
                if accepting {
                    return try await StudioAPI.acceptAllSuggestions(body)
                }
                return try await StudioAPI.declineAllSuggestions(body)
            }
            keys.settle(nil)
            var next = reasons
            for id in result.accepted { next[id] = nil }
            for skip in result.skipped { next[skip.id] = skip.reason }
            reasons = next
            selected.subtract(result.accepted)
            studio.bumpData()
            await load(studio: studio)
            return .success(result)
        } catch {
            keys.settle(error)
            let api = (error as? APIError) ?? APIError(status: 0, code: "network", message: APIError.message(for: error))
            return .failure(api)
        }
    }
}

// MARK: - View

/// Studio › Products › Suggestions from Yard: "Accept all (N)" (slide), select mode with Accept
/// selected / Decline selected, and Decline all behind an inline confirm. A suggestion the batch
/// couldn't take stays in the list with its reason.
@MainActor
struct StudioSuggestionsView: View {
    let focusAcceptAll: Bool

    @Environment(StudioStore.self) private var studio
    @Environment(ToastCenter.self) private var toast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var model = StudioSuggestionsModel()
    @State private var selecting: Bool = false
    /// The inline decline confirm: nil (closed), [] (all) or the selected ids.
    @State private var confirmDecline: [String]?
    @State private var declineReason: String = ""
    @State private var highlight: Bool = false

    init(focusAcceptAll: Bool = false) {
        self.focusAcceptAll = focusAcceptAll
    }

    private var canPublish: Bool { studio.can(StudioPermission.contentPublish) }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.l) {
                    if !model.loaded && model.items.isEmpty {
                        StudioRowsSkeleton(count: 4)
                    } else if let error = model.error, model.items.isEmpty {
                        EmptyState.error(message: error) { await model.load(studio: studio) }
                    } else if model.items.isEmpty {
                        EmptyState(title: "Nothing waiting", message: "When Yard prepares products or changes for you, they show here. Nothing goes live until you accept.", systemImage: "sparkles")
                    } else {
                        intro
                        if canPublish {
                            actions.id("accept-all")
                        }
                        if let ids = confirmDecline {
                            declineConfirm(ids)
                        }
                        LazyVStack(spacing: Spacing.s) {
                            ForEach(model.items) { item in
                                row(item)
                            }
                        }
                    }
                }
                .padding(.horizontal, Spacing.gutter)
                .padding(.vertical, Spacing.l)
            }
            .task {
                await model.load(studio: studio)
                if focusAcceptAll, !model.items.isEmpty {
                    withAnimation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion)) {
                        proxy.scrollTo("accept-all", anchor: .center)
                        highlight = true
                    }
                    try? await Task.sleep(nanoseconds: 1_800_000_000)
                    withAnimation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion)) { highlight = false }
                }
            }
        }
        .yardScreenBackground()
        .navigationTitle("Suggestions from Yard")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if canPublish && !model.items.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(selecting ? "Done" : "Select") {
                        Haptics.selection()
                        withAnimation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion)) {
                            selecting.toggle()
                            if !selecting { model.selected = [] }
                            confirmDecline = nil
                        }
                    }
                }
            }
        }
        .refreshable { await model.load(studio: studio) }
    }

    // MARK: Parts

    private var intro: some View {
        let n = model.items.count
        return VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(StudioBatchCopy.preparedLine(n, allNew: model.allNew))
                .font(.yardHeadline)
                .foregroundStyle(Color.yard.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(n == 1 ? "Nothing goes live until you accept." : "Each one is checked on its own. Nothing goes live until you accept.")
                .font(.yardCaption)
                .foregroundStyle(Color.yard.ink2)
        }
    }

    @ViewBuilder
    private var actions: some View {
        let n = model.items.count
        let picked = model.items.filter { model.selected.contains($0.id) }.map(\.id)
        VStack(alignment: .leading, spacing: Spacing.s) {
            if selecting {
                HStack(spacing: Spacing.s) {
                    YardButton("Accept selected (\(picked.count))", systemImage: "checkmark", style: .primary, size: .medium, isLoading: model.busy == .accept) {
                        Haptics.impact(.medium)
                        accept(picked)
                    }
                    .disabled(picked.isEmpty || model.busy != nil)
                    .opacity(picked.isEmpty ? 0.6 : 1)
                    YardButton("Decline selected", style: .secondary, size: .medium) {
                        Haptics.selection()
                        openDecline(picked)
                    }
                    .disabled(picked.isEmpty || model.busy != nil)
                    .opacity(picked.isEmpty ? 0.6 : 1)
                }
                Button(picked.count == n ? "Clear selection" : "Select all \(n)") {
                    Haptics.selection()
                    model.selected = picked.count == n ? [] : Set(model.items.map(\.id))
                }
                .font(.yardCallout.weight(.semibold))
                .foregroundStyle(Color.yard.violet)
            } else {
                SlideToConfirm(StudioBatchCopy.acceptAll(n), systemImage: "checkmark", isLoading: model.busy == .accept, isEnabled: model.busy == nil) {
                    accept(nil)
                }
                .overlay(
                    Capsule()
                        .stroke(Color.yard.acid, lineWidth: 3)
                        .opacity(highlight ? 1 : 0)
                        .padding(-4)
                )
                .accessibilityHint(Text("Accepts every suggestion waiting. Each one is checked on its own."))
                YardButton("Decline all", style: .ghost, size: .small, fullWidth: false) {
                    Haptics.selection()
                    openDecline([])
                }
                .disabled(model.busy != nil)
            }
        }
    }

    private func declineConfirm(_ ids: [String]) -> some View {
        let count = ids.isEmpty ? model.items.count : ids.count
        return VStack(alignment: .leading, spacing: Spacing.m) {
            Text(count == 1 ? "Decline this suggestion?" : "Decline \(count) suggestions?")
                .font(.yardHeadline)
                .foregroundStyle(Color.yard.ink)
            Text("Nothing in your catalogue changes. Yard sees your answer.")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
            HStack(spacing: Spacing.m) {
                Image(systemName: "text.bubble").foregroundStyle(Color.yard.ink3).frame(width: 22)
                TextField("Reason for Yard (optional)", text: $declineReason)
                    .font(.yardBody)
            }
            .padding(.horizontal, Spacing.m)
            .frame(height: 48)
            .background(Color.yard.surface2, in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
            HStack(spacing: Spacing.s) {
                YardButton("Keep them", style: .secondary, size: .medium) {
                    Haptics.selection()
                    withAnimation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion)) { confirmDecline = nil }
                }
                YardButton(count == 1 ? "Decline" : "Decline \(count)", style: .destructive, size: .medium, isLoading: model.busy == .decline) {
                    Haptics.impact(.medium)
                    decline(ids.isEmpty ? nil : ids)
                }
                .disabled(model.busy != nil)
            }
        }
        .padding(Spacing.m)
        .yardCard()
        .transition(.opacity)
    }

    private func row(_ item: StudioProposal) -> some View {
        let isSelected = model.selected.contains(item.id)
        return Button {
            guard selecting else { return }
            Haptics.selection()
            if isSelected { model.selected.remove(item.id) } else { model.selected.insert(item.id) }
        } label: {
            VStack(alignment: .leading, spacing: Spacing.s) {
                HStack(spacing: Spacing.m) {
                    if selecting {
                        StudioSelectMark(isSelected: isSelected)
                    }
                    RemoteImage(url: item.coverURL, contentMode: .fill, maxPixelSize: 200) {
                        BrandArtwork(name: item.title, style: .initials)
                    }
                    .frame(width: 64, height: 64)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.title.isEmpty ? "Untitled product" : item.title)
                            .font(.yardBodyEmphasis)
                            .foregroundStyle(Color.yard.ink)
                            .lineLimit(2)
                        Tag(item.isNew ? "New product" : "Changes", style: item.isNew ? .violet : .neutral)
                        if let note = item.note, !note.isEmpty {
                            Text(note)
                                .font(.yardCaption)
                                .foregroundStyle(Color.yard.ink2)
                                .lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                }
                if let reason = model.reasons[item.id] {
                    Label(reason, systemImage: "exclamationmark.circle.fill")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(Spacing.m)
            .yardCard()
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selecting && isSelected ? .isSelected : [])
    }

    // MARK: Actions

    private func openDecline(_ ids: [String]) {
        declineReason = ""
        withAnimation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion)) { confirmDecline = ids }
    }

    private func accept(_ ids: [String]?) {
        Task { @MainActor in
            switch await model.run(.accept, ids: ids, studio: studio) {
            case .success(let result):
                report("Accepted", result)
                if model.items.isEmpty { selecting = false }
            case .failure(let error):
                Haptics.error()
                toast.show(error.message, style: .error)
            }
        }
    }

    private func decline(_ ids: [String]?) {
        let reason = declineReason
        Task { @MainActor in
            switch await model.run(.decline, ids: ids, reason: reason, studio: studio) {
            case .success(let result):
                withAnimation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion)) { confirmDecline = nil }
                report("Declined", result)
                if model.items.isEmpty { selecting = false }
            case .failure(let error):
                Haptics.error()
                toast.show(error.message, style: .error)
            }
        }
    }

    private func report(_ verb: String, _ result: StudioBatchResult) {
        if !result.accepted.isEmpty {
            Haptics.success()
            toast.show(StudioBatchCopy.result(verb, result), style: .success, systemImage: "checkmark")
        } else {
            Haptics.warning()
            toast.show(StudioBatchCopy.result(verb, result), style: .info)
        }
    }
}

/// The round check in select mode.
struct StudioSelectMark: View {
    let isSelected: Bool

    var body: some View {
        Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
            .font(.system(size: 22, weight: .semibold))
            .foregroundStyle(isSelected ? Color.yard.acid : Color.yard.ink3)
            .background(Circle().fill(isSelected ? Color.yard.onAcid : Color.clear).padding(4))
            .accessibilityHidden(true)
    }
}
