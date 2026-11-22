import SwiftUI
import PhotosUI
import Observation
import UIKit

/// One generic option (any name: "Size", "Colour", "Scent", "Volume"…) and its values.
struct QuickAddOption: Identifiable, Equatable, Sendable {
    let id = UUID()
    var name: String
    var values: [String]

    static func == (a: QuickAddOption, b: QuickAddOption) -> Bool {
        a.id == b.id && a.name == b.name && a.values == b.values
    }
}

/// The pure part of Quick add: variants and the request body (category-neutral; 0–3 options).
enum QuickAddBuilder {
    /// Every combination of the options' values, in order ("S"+"Red", "S"+"Blue", …).
    static func combinations(_ options: [QuickAddOption]) -> [[String: String]] {
        let usable = options.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty && !$0.values.isEmpty }
        var result: [[String: String]] = [[:]]
        for option in usable {
            let name = option.name.trimmingCharacters(in: .whitespaces)
            var next: [[String: String]] = []
            for partial in result {
                for value in option.values {
                    var combo = partial
                    combo[name] = value
                    next.append(combo)
                }
            }
            result = next
        }
        return result
    }

    /// A stable key for a combination (stock dictionary key).
    static func key(_ combo: [String: String], order: [QuickAddOption]) -> String {
        order.compactMap { combo[$0.name.trimmingCharacters(in: .whitespaces)] }.joined(separator: " / ")
    }

    static func body(title: String, categorySlug: String, priceMinor: Int, options: [QuickAddOption], stock: [String: Int], singleStock: Int, mediaIds: [String], handle: String) -> StudioProductCreateBody {
        let usable = options.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty && !$0.values.isEmpty }
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        var taken: Set<String> = []
        var variants: [StudioProductCreateBody.Variant] = []
        if usable.isEmpty {
            let sku = StudioSKU.make(handle: handle, title: trimmedTitle, values: [], taken: taken)
            variants.append(StudioProductCreateBody.Variant(sku: sku, options: [:], initialStock: max(0, singleStock)))
        } else {
            for combo in combinations(usable) {
                let k = key(combo, order: usable)
                let values = usable.compactMap { combo[$0.name.trimmingCharacters(in: .whitespaces)] }
                let sku = StudioSKU.make(handle: handle, title: trimmedTitle, values: values, taken: taken)
                taken.insert(sku)
                variants.append(StudioProductCreateBody.Variant(sku: sku, options: combo, initialStock: max(0, stock[k] ?? 0)))
            }
        }
        return StudioProductCreateBody(
            title: trimmedTitle,
            description: "",
            categorySlug: categorySlug,
            priceMinor: priceMinor,
            options: usable.map { StudioProductCreateBody.Option(name: $0.name.trimmingCharacters(in: .whitespaces), values: $0.values.map { StudioProductCreateBody.OptionValue(value: $0) }) },
            variants: variants,
            images: mediaIds.map { StudioProductCreateBody.Image(mediaId: $0, alt: trimmedTitle) },
            badges: ["new"]
        )
    }
}

/// A picked photo and its upload.
struct QuickAddPhoto: Identifiable, Equatable {
    enum UploadState: Equatable {
        case uploading
        case uploaded(String)
        case failed(String)
    }
    let id = UUID()
    var source: UIImage
    var preview: UIImage
    var jpeg: Data
    var state: UploadState

    var mediaId: String? {
        if case .uploaded(let id) = state { return id }
        return nil
    }

    static func == (a: QuickAddPhoto, b: QuickAddPhoto) -> Bool { a.id == b.id && a.state == b.state && a.jpeg == b.jpeg }
}

@Observable
@MainActor
final class StudioQuickAddModel {
    enum Step: Int, CaseIterable {
        case photos, name, price, options, review

        var title: String {
            switch self {
            case .photos: return "Add photos"
            case .name: return "Name it"
            case .price: return "Set the price"
            case .options: return "Options and stock"
            case .review: return "Check and publish"
            }
        }
    }

    var step: Step = .photos
    var photos: [QuickAddPhoto] = []
    var title: String = ""
    var categorySlug: String?
    var priceText: String = ""
    var hasOptions: Bool = false
    var options: [QuickAddOption] = [QuickAddOption(name: "", values: [])]
    var stock: [String: Int] = [:]
    var singleStock: Int = 1
    var problem: String?

    private(set) var categories: [WelcomeCategory] = []
    private(set) var publishing: Bool = false
    private(set) var created: StudioProduct?
    private(set) var published: Bool = false

    static let maxPhotos = 12

    func currency(_ studio: StudioStore) -> String { studio.brandCurrency ?? "USD" }

    func loadCategories() async {
        guard categories.isEmpty else { return }
        categories = (try? await StudioAPI.categories()) ?? []
    }

    // MARK: Photos

    func add(_ image: UIImage, studio: StudioStore) {
        guard photos.count < Self.maxPhotos else { return }
        guard case .success(let upright) = ProfilePhotoPrep.image(from: image),
              let jpeg = ProfilePhotoCrop.renderJPEG(upright, frame: 300, zoom: 1, offset: .zero),
              let preview = UIImage(data: jpeg) else {
            problem = ProfilePhotoPrep.Problem.unreadable.message
            return
        }
        let photo = QuickAddPhoto(source: upright, preview: preview, jpeg: jpeg, state: .uploading)
        photos.append(photo)
        upload(photo.id, studio: studio)
    }

    func replaceCrop(_ id: UUID, result: ProfilePhotoCropResult, studio: StudioStore) {
        guard let index = photos.firstIndex(where: { $0.id == id }) else { return }
        photos[index].preview = result.preview
        photos[index].jpeg = result.jpeg
        photos[index].state = .uploading
        upload(id, studio: studio)
    }

    func remove(_ id: UUID) {
        photos.removeAll { $0.id == id }
    }

    func upload(_ id: UUID, studio: StudioStore) {
        guard let photo = photos.first(where: { $0.id == id }) else { return }
        let jpeg = photo.jpeg
        Task { @MainActor in
            let state: QuickAddPhoto.UploadState
            do {
                let mediaId = try await studio.call { try await StudioAPI.uploadPhoto(jpeg: jpeg) }
                state = .uploaded(mediaId)
            } catch {
                state = .failed(APIError.message(for: error))
            }
            if let index = photos.firstIndex(where: { $0.id == id }), photos[index].jpeg == jpeg {
                photos[index].state = state
            }
        }
    }

    var uploading: Bool { photos.contains { $0.state == .uploading } }
    var mediaIds: [String] { photos.compactMap(\.mediaId) }

    // MARK: Steps

    func problem(at step: Step, currency: String) -> String? {
        switch step {
        case .photos:
            if photos.isEmpty { return "Add at least one photo." }
            if uploading { return "Wait for the photos to finish uploading." }
            if mediaIds.isEmpty { return "The photos didn't upload. Tap one to try again." }
            return nil
        case .name:
            let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
            if t.count < 2 { return "Give it a name (2 characters or more)." }
            if t.count > 120 { return "Keep the name to 120 characters." }
            if categorySlug == nil { return "Choose a category." }
            return nil
        case .price:
            guard let minor = StudioMoney.minor(from: priceText, currency: currency), minor > 0 else { return "Enter a price." }
            return nil
        case .options:
            if hasOptions {
                let usable = options.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty && !$0.values.isEmpty }
                if usable.isEmpty { return "Name the option and add at least one value, or turn options off." }
                if QuickAddBuilder.combinations(usable).count > 100 { return "That's too many combinations. Use fewer values." }
            }
            return nil
        case .review:
            return nil
        }
    }

    func next(currency: String) -> Bool {
        if let p = problem(at: step, currency: currency) {
            problem = p
            return false
        }
        problem = nil
        if let s = Step(rawValue: step.rawValue + 1) { step = s }
        return true
    }

    func back() {
        problem = nil
        if let s = Step(rawValue: step.rawValue - 1) { step = s }
    }

    var usableOptions: [QuickAddOption] {
        hasOptions ? options.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty && !$0.values.isEmpty } : []
    }

    // MARK: Create

    /// Creates the draft, then publishes it when `publish` (slide to publish).
    func create(studio: StudioStore, publish: Bool) async -> Bool {
        let brandCurrency = self.currency(studio)
        for s in Step.allCases where s != .review {
            if let p = problem(at: s, currency: brandCurrency) {
                step = s
                problem = p
                return false
            }
        }
        guard let price = StudioMoney.minor(from: priceText, currency: brandCurrency), let category = categorySlug else { return false }
        let body = QuickAddBuilder.body(
            title: title,
            categorySlug: category,
            priceMinor: price,
            options: usableOptions,
            stock: stock,
            singleStock: singleStock,
            mediaIds: mediaIds,
            handle: studio.activeBrand?.handle ?? ""
        )
        publishing = true
        problem = nil
        defer { publishing = false }
        do {
            var product: StudioProduct
            if let existing = created {
                product = existing
            } else {
                product = try await studio.call { try await StudioAPI.createProduct(body) }
                created = product
            }
            if publish {
                let id = product.id
                let version = product.version
                product = try await studio.call { try await StudioAPI.setStatus(productId: id, action: "publish", version: version) }
                created = product
                published = true
            }
            studio.bumpData()
            return true
        } catch {
            problem = APIError.message(for: error)
            return false
        }
    }
}

/// Quick add: photos (camera or library, reusing the profile-photo crop) → name → price →
/// options & stock → review → slide to publish → success with a share link.
@MainActor
struct StudioQuickAddView: View {
    @Environment(StudioStore.self) private var studio
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var model = StudioQuickAddModel()
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var showsCamera = false
    @State private var cropping: QuickAddCropItem?
    @State private var newValue: [UUID: String] = [:]
    @FocusState private var focus: Field?

    private enum Field: Hashable { case title, price }

    var body: some View {
        ZStack {
            if let product = model.created, model.published || !canPublish {
                success(product)
                    .transition(.opacity)
            } else {
                flow
            }
        }
        .yardScreenBackground()
        .task { await model.loadCategories() }
        .onChange(of: pickerItems) { _, items in
            guard !items.isEmpty else { return }
            let picked = items
            pickerItems = []
            Task { @MainActor in
                for item in picked {
                    if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                        model.add(image, studio: studio)
                        Haptics.selection()
                    }
                }
            }
        }
        .fullScreenCover(isPresented: $showsCamera) {
            StudioCameraPicker { image in
                showsCamera = false
                if let image {
                    model.add(image, studio: studio)
                    Haptics.impact(.light)
                }
            }
            .ignoresSafeArea()
        }
        .fullScreenCover(item: $cropping) { item in
            ProfilePhotoCropView(image: item.image) { result in
                cropping = nil
                if let result { model.replaceCrop(item.photoId, result: result, studio: studio) }
            }
        }
        .sensoryFeedback(.error, trigger: model.problem) { _, new in new != nil }
        .sensoryFeedback(.selection, trigger: model.step)
    }

    private var canPublish: Bool {
        studio.can(StudioPermission.contentPublish) && !(studio.activeBrand?.isPending ?? false) && !(studio.activeBrand?.isRestricted ?? false)
    }

    // MARK: Flow

    private var flow: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.l) {
                    Text(model.step.title)
                        .yardDisplay(40)
                        .foregroundStyle(Color.yard.ink)
                        .accessibilityAddTraits(.isHeader)
                    Group {
                        switch model.step {
                        case .photos: photosStep
                        case .name: nameStep
                        case .price: priceStep
                        case .options: optionsStep
                        case .review: reviewStep
                        }
                    }
                    .id(model.step)
                    .transition(.asymmetric(insertion: reduceMotion ? .opacity : .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
                    if let problem = model.problem {
                        Label(problem, systemImage: "exclamationmark.circle.fill")
                            .font(.yardCallout)
                            .foregroundStyle(Color.yard.danger)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, Spacing.gutter)
                .padding(.vertical, Spacing.l)
                .animation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion), value: model.step)
            }
            .scrollDismissesKeyboard(.interactively)
            footer
        }
    }

    private var header: some View {
        VStack(spacing: Spacing.m) {
            HStack(spacing: Spacing.s) {
                GlassIconButton(systemImage: "xmark", accessibilityLabel: "Close") {
                    Haptics.impact(.light)
                    dismiss()
                }
                if model.step != .photos {
                    GlassIconButton(systemImage: "chevron.left", accessibilityLabel: "Back") {
                        Haptics.selection()
                        withAnimation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion)) { model.back() }
                    }
                }
                Spacer()
                Text("Quick add")
                    .font(.yardCaptionEmphasis)
                    .foregroundStyle(Color.yard.ink2)
            }
            HStack(spacing: 4) {
                ForEach(StudioQuickAddModel.Step.allCases, id: \.rawValue) { s in
                    Capsule()
                        .fill(s.rawValue <= model.step.rawValue ? Color.yard.acid : Color.yard.surface2)
                        .frame(height: 5)
                }
            }
            .animation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion), value: model.step)
            .accessibilityElement()
            .accessibilityLabel(Text("Step \(model.step.rawValue + 1) of \(StudioQuickAddModel.Step.allCases.count)"))
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.top, Spacing.s)
    }

    private var footer: some View {
        VStack(spacing: Spacing.s) {
            if model.step == .review {
                if canPublish {
                    SlideToConfirm("Slide to publish", systemImage: "sparkles", isLoading: model.publishing) {
                        Task { @MainActor in
                            if !(await model.create(studio: studio, publish: true)) { Haptics.error() }
                        }
                    }
                    YardButton("Save as draft", style: .ghost, size: .medium) {
                        Haptics.impact(.light)
                        Task { @MainActor in
                            if await model.create(studio: studio, publish: false) {
                                Haptics.success()
                                dismiss()
                            } else {
                                Haptics.error()
                            }
                        }
                    }
                    .disabled(model.publishing)
                } else {
                    SlideToConfirm("Slide to save draft", systemImage: "tray.and.arrow.down.fill", isLoading: model.publishing) {
                        Task { @MainActor in
                            if !(await model.create(studio: studio, publish: false)) { Haptics.error() }
                        }
                    }
                }
            } else {
                Button {
                    focus = nil
                    withAnimation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion)) {
                        if model.next(currency: model.currency(studio)) { Haptics.impact(.light) } else { Haptics.error() }
                    }
                } label: {
                    HStack(spacing: Spacing.s) {
                        Text("Continue").font(.yardBodyEmphasis)
                        Image(systemName: "arrow.right").font(.system(size: 15, weight: .bold))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                }
                .buttonStyle(YardPillButtonStyle(style: .inverted))
            }
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.vertical, Spacing.s)
        .yardGlassBar()
    }

    // MARK: Photos

    private var photosStep: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Text("Up to \(StudioQuickAddModel.maxPhotos). The first one is the cover. Tap a photo to crop it.")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
            HStack(spacing: Spacing.s) {
                Button {
                    Haptics.impact(.light)
                    showsCamera = true
                } label: {
                    Label("Camera", systemImage: "camera.fill")
                        .font(.yardBodyEmphasis)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                }
                .buttonStyle(YardPillButtonStyle(style: .secondary))
                .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera) || model.photos.count >= StudioQuickAddModel.maxPhotos)
                PhotosPicker(
                    selection: $pickerItems,
                    maxSelectionCount: max(1, StudioQuickAddModel.maxPhotos - model.photos.count),
                    matching: .images
                ) {
                    Label("Library", systemImage: "photo.on.rectangle")
                        .font(.yardBodyEmphasis)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .foregroundStyle(Color.yard.onAcid)
                        .background(Color.yard.acid, in: Capsule())
                }
                .disabled(model.photos.count >= StudioQuickAddModel.maxPhotos)
            }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: Spacing.s), GridItem(.flexible(), spacing: Spacing.s), GridItem(.flexible(), spacing: Spacing.s)], spacing: Spacing.s) {
                ForEach(Array(model.photos.enumerated()), id: \.element.id) { index, photo in
                    photoTile(photo, isCover: index == 0)
                }
            }
            .animation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion), value: model.photos.count)
        }
    }

    private func photoTile(_ photo: QuickAddPhoto, isCover: Bool) -> some View {
        Button {
            if case .failed = photo.state {
                Haptics.impact(.light)
                model.upload(photo.id, studio: studio)
            } else {
                Haptics.selection()
                cropping = QuickAddCropItem(photoId: photo.id, image: photo.source)
            }
        } label: {
            Color.clear
                .aspectRatio(1, contentMode: .fit)
                .overlay {
                    Image(uiImage: photo.preview)
                        .resizable()
                        .scaledToFill()
                }
                .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                .overlay {
                    switch photo.state {
                    case .uploading:
                        ZStack {
                            Color.yard.scrim.opacity(0.35)
                            ProgressView().tint(Color.yard.onPhoto)
                        }
                        .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                    case .failed:
                        ZStack {
                            Color.yard.scrim.opacity(0.55)
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 20, weight: .bold))
                                .foregroundStyle(Color.yard.onPhoto)
                        }
                        .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                    case .uploaded:
                        EmptyView()
                    }
                }
                .overlay(alignment: .bottomLeading) {
                    if isCover {
                        Tag("Cover", style: .acid).padding(6)
                    }
                }
        }
        .buttonStyle(PressableButtonStyle(scale: Motion.pressScale))
        .overlay(alignment: .topTrailing) {
            Button {
                Haptics.selection()
                withAnimation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion)) { model.remove(photo.id) }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Color.yard.ink)
                    .frame(width: 26, height: 26)
                    .yardGlass(Circle())
            }
            .buttonStyle(.plain)
            .padding(5)
            .accessibilityLabel(Text("Remove photo"))
        }
        .accessibilityLabel(Text(photoLabel(photo, isCover: isCover)))
    }

    private func photoLabel(_ photo: QuickAddPhoto, isCover: Bool) -> String {
        let base = isCover ? "Cover photo" : "Photo"
        switch photo.state {
        case .uploading: return "\(base), uploading"
        case .uploaded: return "\(base). Double-tap to crop."
        case .failed(let message): return "\(base) didn't upload: \(message) Double-tap to try again."
        }
    }

    // MARK: Name

    private var nameStep: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            TextField("What is it?", text: $model.title, axis: .vertical)
                .font(.system(size: 26, weight: .bold))
                .foregroundStyle(Color.yard.ink)
                .lineLimit(1...3)
                .focused($focus, equals: .title)
                .padding(Spacing.l)
                .yardCard()
                .onAppear { focus = .title }
            Text("Category")
                .font(.yardHeadline)
                .foregroundStyle(Color.yard.ink2)
            if model.categories.isEmpty {
                ProgressView().tint(Color.yard.ink)
            } else {
                WelcomeFlowLayout(spacing: Spacing.s) {
                    ForEach(model.categories) { c in
                        Chip(c.name, isSelected: model.categorySlug == c.slug) {
                            Haptics.selection()
                            model.categorySlug = c.slug
                        }
                    }
                }
            }
        }
    }

    // MARK: Price

    private var priceStep: some View {
        let currency = model.currency(studio)
        let minor = StudioMoney.minor(from: model.priceText, currency: currency)
        return VStack(alignment: .leading, spacing: Spacing.m) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
                Text(currency)
                    .font(.yardTitle)
                    .foregroundStyle(Color.yard.ink3)
                TextField("0", text: $model.priceText)
                    .font(.system(size: 56, weight: .black).width(.compressed))
                    .monospacedDigit()
                    .keyboardType(.decimalPad)
                    .foregroundStyle(Color.yard.ink)
                    .focused($focus, equals: .price)
                    .onAppear { focus = .price }
            }
            .padding(Spacing.l)
            .yardCard()
            if let minor, minor > 0 {
                Text("Shoppers see \(Formatters.price(minor: minor, currency: currency)).")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                    .contentTransition(.numericText())
            }
        }
    }

    // MARK: Options & stock

    private var optionsStep: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            Toggle(isOn: Binding(get: { model.hasOptions }, set: { v in
                Haptics.selection()
                withAnimation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion)) { model.hasOptions = v }
            })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("It comes in options").font(.yardBodyEmphasis).foregroundStyle(Color.yard.ink)
                    Text("Like size, colour, scent or volume.").font(.yardCaption).foregroundStyle(Color.yard.ink2)
                }
            }
            .tint(Color.yard.acid)
            .padding(Spacing.l)
            .yardCard()

            if model.hasOptions {
                ForEach($model.options) { $option in
                    optionEditor($option)
                }
                if model.options.count < 3 {
                    YardButton("Add another option", systemImage: "plus", style: .ghost, size: .small) {
                        Haptics.selection()
                        model.options.append(QuickAddOption(name: "", values: []))
                    }
                }
                let combos = QuickAddBuilder.combinations(model.usableOptions)
                if !model.usableOptions.isEmpty {
                    StudioGroup("Stock") {
                        ForEach(combos.indices, id: \.self) { i in
                            let key = QuickAddBuilder.key(combos[i], order: model.usableOptions)
                            HStack {
                                Text(key)
                                    .font(.yardBody)
                                    .foregroundStyle(Color.yard.ink)
                                Spacer()
                                StudioStockStepper(value: model.stock[key] ?? 0) { delta in
                                    model.stock[key] = max(0, (model.stock[key] ?? 0) + delta)
                                }
                            }
                            .padding(.horizontal, Spacing.m)
                            .frame(minHeight: 56)
                        }
                    }
                }
            } else {
                HStack {
                    Text("In stock")
                        .font(.yardBodyEmphasis)
                        .foregroundStyle(Color.yard.ink)
                    Spacer()
                    StudioStockStepper(value: model.singleStock) { delta in
                        model.singleStock = max(0, model.singleStock + delta)
                    }
                }
                .padding(Spacing.l)
                .yardCard()
            }
        }
    }

    private func optionEditor(_ option: Binding<QuickAddOption>) -> some View {
        let id = option.wrappedValue.id
        return VStack(alignment: .leading, spacing: Spacing.m) {
            HStack {
                TextField("Option name, like Size or Scent", text: option.name)
                    .font(.yardBodyEmphasis)
                    .textInputAutocapitalization(.words)
                if model.options.count > 1 {
                    Button {
                        Haptics.selection()
                        model.options.removeAll { $0.id == id }
                    } label: {
                        Image(systemName: "trash").foregroundStyle(Color.yard.danger)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Remove option"))
                }
            }
            WelcomeFlowLayout(spacing: Spacing.s) {
                ForEach(option.wrappedValue.values, id: \.self) { value in
                    Chip(value, systemImage: "xmark", isSelected: true) {
                        Haptics.selection()
                        option.wrappedValue.values.removeAll { $0 == value }
                    }
                }
            }
            HStack(spacing: Spacing.s) {
                TextField("Add a value", text: Binding(get: { newValue[id] ?? "" }, set: { newValue[id] = $0 }))
                    .font(.yardBody)
                    .submitLabel(.done)
                    .onSubmit { addValue(to: option) }
                    .padding(.horizontal, Spacing.m)
                    .frame(height: 44)
                    .background(Color.yard.surface2, in: Capsule())
                Button {
                    addValue(to: option)
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Color.yard.onAcid)
                        .frame(width: 44, height: 44)
                        .background(Color.yard.acid, in: Circle())
                }
                .buttonStyle(PressableButtonStyle(scale: Motion.pressScale))
                .accessibilityLabel(Text("Add value"))
            }
        }
        .padding(Spacing.l)
        .yardCard()
    }

    private func addValue(to option: Binding<QuickAddOption>) {
        let id = option.wrappedValue.id
        let value = (newValue[id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !option.wrappedValue.values.contains(value) else { return }
        Haptics.impact(.light)
        option.wrappedValue.values.append(value)
        newValue[id] = ""
    }

    // MARK: Review

    private var reviewStep: some View {
        let currency = model.currency(studio)
        let price = StudioMoney.minor(from: model.priceText, currency: currency) ?? 0
        let category = model.categories.first { $0.slug == model.categorySlug }?.name ?? ""
        let combos = QuickAddBuilder.combinations(model.usableOptions)
        let totalStock = model.usableOptions.isEmpty ? model.singleStock : combos.reduce(0) { $0 + (model.stock[QuickAddBuilder.key($1, order: model.usableOptions)] ?? 0) }
        return VStack(alignment: .leading, spacing: Spacing.m) {
            HStack(spacing: Spacing.m) {
                if let cover = model.photos.first {
                    Image(uiImage: cover.preview)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 96, height: 96)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(model.title.trimmingCharacters(in: .whitespacesAndNewlines))
                        .font(.yardTitle)
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(2)
                    Text(Formatters.price(minor: price, currency: currency))
                        .font(.yardBodyEmphasis)
                        .foregroundStyle(Color.yard.ink)
                    Text(category)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                }
            }
            .padding(Spacing.l)
            .frame(maxWidth: .infinity, alignment: .leading)
            .yardCard()
            StudioGroup {
                reviewRow("Photos", "\(model.mediaIds.count)")
                reviewRow("Options", model.usableOptions.isEmpty ? "None" : model.usableOptions.map { "\($0.name) (\($0.values.count))" }.joined(separator: ", "))
                reviewRow("Stock", "\(totalStock)")
            }
            if !canPublish {
                Text(studio.activeBrand?.isPending ?? false
                     ? "It's saved as a draft. You can publish once Yard approves your shop."
                     : "It's saved as a draft for someone who can publish.")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
            }
        }
    }

    private func reviewRow(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).font(.yardCallout).foregroundStyle(Color.yard.ink2)
            Spacer()
            Text(value).font(.yardBodyEmphasis).foregroundStyle(Color.yard.ink).lineLimit(1)
        }
        .padding(.horizontal, Spacing.l)
        .frame(minHeight: 44)
    }

    // MARK: Success

    private func success(_ product: StudioProduct) -> some View {
        ZStack {
            VStack(spacing: Spacing.xl) {
                Spacer()
                YardIllustration(model.published ? .stamp(small: "NOW", big: "LIVE") : .stamp(small: "SAVED AS", big: "DRAFT"))
                    .frame(height: 220)
                VStack(spacing: Spacing.s) {
                    Text(model.published ? "It's live." : "Saved as a draft.")
                        .yardDisplay(52)
                        .foregroundStyle(Color.yard.ink)
                        .multilineTextAlignment(.center)
                    Text(product.title)
                        .font(.yardBody)
                        .foregroundStyle(Color.yard.ink2)
                }
                Spacer()
                VStack(spacing: Spacing.s) {
                    if model.published {
                        ShareLink(item: Config.webURL("/products/\(product.slug)")) {
                            Label("Share it", systemImage: "square.and.arrow.up")
                                .font(.yardBodyEmphasis)
                                .frame(maxWidth: .infinity)
                                .frame(height: 52)
                        }
                        .buttonStyle(YardPillButtonStyle(style: .primary))
                    }
                    YardButton("Add another", style: .secondary) {
                        Haptics.impact(.light)
                        withAnimation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion)) {
                            model = StudioQuickAddModel()
                        }
                        Task { @MainActor in await model.loadCategories() }
                    }
                    YardButton("Done", style: .ghost) { dismiss() }
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.bottom, Spacing.l)
            if model.published {
                ConfettiView().ignoresSafeArea()
            }
        }
        .onAppear { Haptics.success() }
    }
}

struct QuickAddCropItem: Identifiable {
    let id = UUID()
    let photoId: UUID
    let image: UIImage
}

/// The system camera, back lens first (product photos).
struct StudioCameraPicker: UIViewControllerRepresentable {
    let onFinish: (UIImage?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraDevice = .rear
        picker.allowsEditing = false
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    @MainActor
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onFinish: (UIImage?) -> Void

        init(onFinish: @escaping (UIImage?) -> Void) {
            self.onFinish = onFinish
        }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onFinish(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onFinish(nil)
        }
    }
}
