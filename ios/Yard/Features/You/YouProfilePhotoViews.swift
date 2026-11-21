import SwiftUI
import UIKit
import PhotosUI
import AVFoundation

// MARK: - Section (Settings › Your details)

/// The profile photo row at the top of Your details: tap the avatar (or Add/Change photo) to pick
/// from the library or take one with the camera, then position it in the crop screen. Remove asks
/// first, from the Remove button and from the chooser alike (as Android's photo sheet does).
@MainActor
struct YouProfilePhotoSection: View {
    let account: YouAccount
    let onAccount: (YouAccount) -> Void

    @Environment(SessionStore.self) private var session
    @Environment(ToastCenter.self) private var toast
    @Environment(Router.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @State private var model = YouProfilePhotoModel()
    @State private var showsChooser = false
    @State private var showsLibrary = false
    @State private var showsCamera = false
    @State private var confirmsRemove = false
    @State private var libraryItem: PhotosPickerItem? = nil
    @State private var cropping: ProfilePhotoCropItem? = nil
    @State private var isPreparing = false

    init(account: YouAccount, onAccount: @escaping (YouAccount) -> Void) {
        self.account = account
        self.onAccount = onAccount
    }

    private var hasPhoto: Bool { account.photo != nil }
    private var cameraAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Text("Photo")
                .font(.yardHeadline)
                .foregroundStyle(Color.yard.ink2)
                .padding(.horizontal, Spacing.xs)
                .accessibilityAddTraits(.isHeader)
            Card {
                // At accessibility text sizes the buttons go under the avatar, so their labels
                // get the card's full width (the YouQuickLinks pattern).
                let layout: AnyLayout = dynamicTypeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: Spacing.m))
                    : AnyLayout(HStackLayout(alignment: .center, spacing: Spacing.l))
                layout {
                    avatarButton
                    VStack(alignment: .leading, spacing: Spacing.s) {
                        YardButton(
                            hasPhoto || model.pendingImage != nil ? "Change photo" : "Add photo",
                            systemImage: "camera",
                            style: .secondary,
                            size: .small,
                            isLoading: model.busy == .uploading || isPreparing,
                            fullWidth: false
                        ) { showsChooser = true }
                        .disabled(account.demo || model.isBusy || isPreparing)
                        if hasPhoto && model.pendingImage == nil {
                            YardButton("Remove", systemImage: "trash", style: .ghost, size: .small, isLoading: model.busy == .removing, fullWidth: false) {
                                confirmsRemove = true
                            }
                            .disabled(account.demo || model.isBusy)
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
            statusLine
                .padding(.horizontal, Spacing.xs)
                .animation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion), value: model.problem)
        }
        .confirmationDialog("Profile photo", isPresented: $showsChooser, titleVisibility: .visible) {
            Button("Choose from library") { showsLibrary = true }
            if cameraAvailable {
                Button("Take photo") { openCamera() }
            }
            if hasPhoto && model.pendingImage == nil {
                Button("Remove photo", role: .destructive) {
                    // Same confirmation as the Remove button; shown once this dialog has gone.
                    Task { @MainActor in confirmsRemove = true }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog(ProfilePhotoCopy.removeTitle, isPresented: $confirmsRemove, titleVisibility: .visible) {
            Button("Remove photo", role: .destructive) { remove() }
            Button(ProfilePhotoCopy.keepPhoto, role: .cancel) {}
        } message: {
            Text(ProfilePhotoCopy.removeMessage)
        }
        .photosPicker(isPresented: $showsLibrary, selection: $libraryItem, matching: .images, preferredItemEncoding: .compatible)
        .onChange(of: libraryItem) { _, item in
            guard let item else { return }
            libraryItem = nil
            Task { @MainActor in await loadLibrary(item) }
        }
        .fullScreenCover(isPresented: $showsCamera) {
            YouCameraPicker { image in
                showsCamera = false
                if let image { prepare(camera: image) }
            }
            .ignoresSafeArea()
        }
        .fullScreenCover(item: $cropping) { item in
            ProfilePhotoCropView(image: item.image) { result in
                cropping = nil
                if let result { save(result) }
            }
        }
        .sensoryFeedback(.success, trigger: model.savedCount)
        .sensoryFeedback(.success, trigger: model.removedCount)
        .sensoryFeedback(.error, trigger: model.problem) { _, new in new != nil }
    }

    // MARK: Avatar

    private var avatarButton: some View {
        Button {
            showsChooser = true
        } label: {
            ZStack(alignment: .bottomTrailing) {
                PersonAvatar(
                    initials: account.initials,
                    photoURL: Config.url(for: account.photo?.src),
                    localImage: model.optimisticImage,
                    size: 88,
                    dimmed: model.hasFailedUpload
                )
                .overlay {
                    if model.busy == .uploading {
                        ProfilePhotoProgressRing(progress: model.progress)
                    } else if model.busy == .removing {
                        Circle().fill(Color.yard.scrim.opacity(0.35))
                        ProgressView().tint(Color.yard.onPhoto)
                    }
                }
                if !account.demo {
                    Image(systemName: hasPhoto ? "pencil" : "camera.fill")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Color.yard.onAcid)
                        .frame(width: 28, height: 28)
                        .background(Color.yard.acid, in: Circle())
                        .overlay(Circle().strokeBorder(Color.yard.surface, lineWidth: 2))
                        .offset(x: 2, y: 2)
                }
            }
            .contentShape(Circle())
        }
        .buttonStyle(PressableButtonStyle(scale: Motion.pressScale))
        .disabled(account.demo || model.isBusy || isPreparing)
        .accessibilityLabel(Text(hasPhoto ? "Your photo" : "Add a photo"))
        .accessibilityHint(Text(account.demo ? ProfilePhotoCopy.demo : "Opens choices for your photo"))
        .accessibilityValue(Text(model.busy == .uploading ? "Uploading, \(Int(model.progress * 100)) percent" : ""))
    }

    // MARK: Status

    @ViewBuilder
    private var statusLine: some View {
        if let problem = model.problem {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(problem.text)
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.danger)
                    .fixedSize(horizontal: false, vertical: true)
                let keepsSquare = model.pendingJPEG != nil && !model.isBusy
                if keepsSquare || problem.signIn {
                    HStack(spacing: Spacing.s) {
                        if keepsSquare && problem.canRetry {
                            YardButton("Try again", systemImage: "arrow.clockwise", style: .ghost, size: .small, fullWidth: false) { retry() }
                        }
                        if problem.signIn {
                            YardButton("Sign in", style: .secondary, size: .small, fullWidth: false) { router.present(.signIn) }
                        }
                        if keepsSquare {
                            YardButton("Discard", style: .ghost, size: .small, fullWidth: false) {
                                model.discard()
                                session.setPendingPhoto(nil)
                            }
                        }
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .transition(.opacity)
        } else {
            Text(account.demo ? ProfilePhotoCopy.demo : ProfilePhotoCopy.footer)
                .font(.yardCaption)
                .foregroundStyle(Color.yard.ink3)
                .fixedSize(horizontal: false, vertical: true)
                .transition(.opacity)
        }
    }

    // MARK: Actions

    private func openCamera() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .denied, .restricted:
            model.report(ProfilePhotoCopy.cameraDenied)
        case .notDetermined, .authorized:
            // UIImagePickerController asks for permission itself (NSCameraUsageDescription).
            model.clearProblem()
            showsCamera = true
        @unknown default:
            showsCamera = true
        }
    }

    private func loadLibrary(_ item: PhotosPickerItem) async {
        model.clearProblem()
        isPreparing = true
        defer { isPreparing = false }
        let data: Data?
        do {
            data = try await item.loadTransferable(type: Data.self)
        } catch {
            data = nil
        }
        guard let data else {
            model.report(ProfilePhotoPrep.Problem.unreadable.message)
            return
        }
        let result = await Task.detached(priority: .userInitiated) { ProfilePhotoPrep.image(from: data) }.value
        open(result)
    }

    private func prepare(camera image: UIImage) {
        model.clearProblem()
        isPreparing = true
        Task { @MainActor in
            let result = await Task.detached(priority: .userInitiated) { ProfilePhotoPrep.image(from: image) }.value
            isPreparing = false
            open(result)
        }
    }

    private func open(_ result: Result<UIImage, ProfilePhotoPrep.Problem>) {
        switch result {
        case .success(let image):
            cropping = ProfilePhotoCropItem(image: image)
        case .failure(let problem):
            model.report(problem.message)
        }
    }

    private func save(_ result: ProfilePhotoCropResult) {
        session.setPendingPhoto(result.preview)
        let preview = result.preview
        Task { @MainActor in
            let next = await model.save(jpeg: result.jpeg, preview: preview)
            finishUpload(next, preview: preview)
        }
    }

    private func retry() {
        let preview = model.pendingImage
        if let preview { session.setPendingPhoto(preview) }
        Task { @MainActor in
            let next = await model.retry()
            finishUpload(next, preview: preview)
        }
    }

    /// The avatar sizes that show the signed-in shopper's photo: Settings row, You header, this card.
    private static let avatarSizes: [CGFloat] = [28, 60, 88]

    private func finishUpload(_ next: YouAccount?, preview: UIImage?) {
        guard let next else {
            session.setPendingPhoto(nil)
            return
        }
        // The square just uploaded IS the new photo: put it in the image cache under the new URL
        // so every avatar keeps showing it (no flash of initials while the URL downloads).
        if let preview, let url = Config.url(for: next.photo?.src) {
            for size in Self.avatarSizes {
                ImagePipeline.shared.store(preview, for: url, maxPixelSize: PersonAvatar.pixelSize(for: size))
            }
        }
        onAccount(next)
        session.applyPhoto(src: next.photo?.src)
        toast.show(ProfilePhotoCopy.saved, style: .success, systemImage: "checkmark")
        Task { @MainActor in await session.refresh() }
    }

    private func remove() {
        Task { @MainActor in
            guard let next = await model.remove() else { return }
            onAccount(next)
            session.applyPhoto(src: next.photo?.src)
            toast.show(ProfilePhotoCopy.removed, style: .info)
            await session.refresh()
        }
    }
}

/// A ring that fills as the upload is sent, over a soft scrim.
private struct ProfilePhotoProgressRing: View {
    let progress: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Circle().fill(Color.yard.scrim.opacity(0.35))
            Circle()
                .stroke(Color.yard.onPhoto.opacity(0.25), lineWidth: 3)
                .padding(6)
            Circle()
                .trim(from: 0, to: max(0.04, min(1, progress)))
                .stroke(Color.yard.acid, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .padding(6)
                .animation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion), value: progress)
        }
        .allowsHitTesting(false)
    }
}

// MARK: - Crop screen

struct ProfilePhotoCropItem: Identifiable {
    let id = UUID()
    let image: UIImage
}

struct ProfilePhotoCropResult {
    let jpeg: Data
    let preview: UIImage
}

/// The square crop step: drag to move, pinch (or the slider, or double-tap) to zoom; the photo
/// overshoots a little at the edges and settles back (no overshoot under Reduce Motion).
/// Everything outside the circle is dimmed: that's what a round avatar shows.
@MainActor
struct ProfilePhotoCropView: View {
    let image: UIImage
    let onDone: (ProfilePhotoCropResult?) -> Void

    /// Internal so other features can reuse the crop step (Studio Quick add).
    init(image: UIImage, onDone: @escaping (ProfilePhotoCropResult?) -> Void) {
        self.image = image
        self.onDone = onDone
    }

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var zoom: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var dragFrom: CGSize? = nil
    @State private var pinchFrom: (zoom: CGFloat, offset: CGSize)? = nil
    @State private var frameSide: CGFloat = 300
    @State private var isSaving = false
    @State private var problem: String? = nil
    @State private var settleTick = 0

    private var imageSize: CGSize { image.size }

    var body: some View {
        VStack(spacing: Spacing.l) {
            header
            Spacer(minLength: 0)
            cropArea
            zoomControls
            if let problem {
                Text(problem)
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.danger)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .layoutPriority(1)
            }
            Spacer(minLength: 0)
            VStack(spacing: Spacing.s) {
                YardButton("Save photo", style: .primary, isLoading: isSaving) { save() }
                YardButton("Cancel", style: .secondary) { onDone(nil) }
                    .disabled(isSaving)
            }
            // The square gives way first: Save photo and Cancel always keep their room.
            .layoutPriority(1)
        }
        // The square takes drags, so this screen doesn't scroll; capping the text keeps the
        // header, controls and buttons on screen at the largest sizes on SE-class heights.
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .padding(.horizontal, Spacing.gutter)
        .padding(.vertical, Spacing.l)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.yard.bg.ignoresSafeArea())
        .environment(\.colorScheme, .dark)
        .sensoryFeedback(.impact(weight: .light), trigger: settleTick)
        // Closed only by Cancel or Save photo.
        .interactiveDismissDisabled()
    }

    private var header: some View {
        VStack(spacing: Spacing.xs) {
            Text("Position your photo")
                .font(.yardTitle)
                .foregroundStyle(Color.yard.ink)
                .accessibilityAddTraits(.isHeader)
            Text("Drag to move it. Pinch to fit your face in the circle.")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .layoutPriority(1)
        .padding(.top, Spacing.s)
    }

    // MARK: Crop area

    private var cropArea: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, 360)
            let short = max(1, min(imageSize.width, imageSize.height))
            let scale = side / short * zoom
            ZStack {
                Image(uiImage: image)
                    .resizable()
                    .frame(width: imageSize.width * scale, height: imageSize.height * scale)
                    .offset(offset)
                ProfilePhotoCircleMask()
                    .fill(Color.yard.scrim.opacity(0.6), style: FillStyle(eoFill: true))
                    .allowsHitTesting(false)
                Circle()
                    .strokeBorder(Color.yard.onPhoto.opacity(0.45), lineWidth: 1)
                    .allowsHitTesting(false)
            }
            .frame(width: side, height: side)
            .clipShape(Rectangle())
            .contentShape(Rectangle())
            .gesture(dragGesture(side).simultaneously(with: pinchGesture(side)))
            .onTapGesture(count: 2) { toggleZoom(side) }
            .frame(maxWidth: .infinity)
            .onAppear { frameSide = side }
            .onChange(of: side) { _, next in
                frameSide = next
                offset = ProfilePhotoCrop.clampOffset(image: imageSize, frame: next, zoom: zoom, offset: offset)
            }
            .accessibilityElement()
            .accessibilityLabel(Text("Photo crop area"))
            .accessibilityValue(Text("Zoom \(String(format: "%.1f", Double(zoom)))×"))
            .accessibilityHint(Text("Swipe up or down to zoom. Use the actions to move the photo."))
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: setZoom(zoom + 0.25, side: side)
                case .decrement: setZoom(zoom - 0.25, side: side)
                @unknown default: break
                }
            }
            .accessibilityAction(named: Text("Move left")) { nudge(CGSize(width: 24, height: 0), side: side) }
            .accessibilityAction(named: Text("Move right")) { nudge(CGSize(width: -24, height: 0), side: side) }
            .accessibilityAction(named: Text("Move up")) { nudge(CGSize(width: 0, height: 24), side: side) }
            .accessibilityAction(named: Text("Move down")) { nudge(CGSize(width: 0, height: -24), side: side) }
        }
        .aspectRatio(1, contentMode: .fit)
        .frame(maxWidth: 360)
    }

    private func dragGesture(_ side: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 1)
            .onChanged { value in
                let from = dragFrom ?? offset
                if dragFrom == nil { dragFrom = offset }
                let raw = CGSize(width: from.width + value.translation.width, height: from.height + value.translation.height)
                offset = livePosition(raw, side: side)
            }
            .onEnded { _ in
                dragFrom = nil
                settle(side)
            }
    }

    private func pinchGesture(_ side: CGFloat) -> some Gesture {
        MagnifyGesture()
            .onChanged { value in
                let from: (zoom: CGFloat, offset: CGSize) = pinchFrom ?? (zoom: zoom, offset: offset)
                if pinchFrom == nil { pinchFrom = (zoom: zoom, offset: offset) }
                let target = from.zoom * value.magnification
                let live = reduceMotion ? ProfilePhotoCrop.clampZoom(target) : ProfilePhotoCrop.rubberZoom(target)
                let k = live / max(0.01, from.zoom)
                zoom = live
                // While a drag runs too it owns the offset; otherwise keep the centre point.
                if dragFrom == nil {
                    offset = livePosition(CGSize(width: from.offset.width * k, height: from.offset.height * k), side: side)
                }
            }
            .onEnded { _ in
                pinchFrom = nil
                settle(side)
            }
    }

    /// Inside the limits the photo follows the finger; past them it resists (or stops, under Reduce Motion).
    private func livePosition(_ raw: CGSize, side: CGFloat) -> CGSize {
        let limits = ProfilePhotoCrop.maxOffset(image: imageSize, frame: side, zoom: zoom)
        if reduceMotion {
            return ProfilePhotoCrop.clampOffset(image: imageSize, frame: side, zoom: zoom, offset: raw)
        }
        return CGSize(
            width: ProfilePhotoCrop.rubberBand(raw.width, limit: limits.width, dimension: side * 0.25),
            height: ProfilePhotoCrop.rubberBand(raw.height, limit: limits.height, dimension: side * 0.25)
        )
    }

    /// Snaps zoom and position back inside the limits (a spring, or a short fade under Reduce Motion).
    private func settle(_ side: CGFloat) {
        let z = ProfilePhotoCrop.clampZoom(zoom)
        let o = ProfilePhotoCrop.clampOffset(image: imageSize, frame: side, zoom: z, offset: offset)
        let moved = z != zoom || o != offset
        withAnimation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion)) {
            zoom = z
            offset = o
        }
        if moved { settleTick += 1 }
    }

    private func setZoom(_ next: CGFloat, side: CGFloat) {
        let r = ProfilePhotoCrop.zoomTo(image: imageSize, frame: side, fromZoom: zoom, fromOffset: offset, nextZoom: next)
        withAnimation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion)) {
            zoom = r.zoom
            offset = r.offset
        }
    }

    private func toggleZoom(_ side: CGFloat) {
        let next: CGFloat = zoom < 1.75 ? 2 : 1
        let r = ProfilePhotoCrop.zoomTo(image: imageSize, frame: side, fromZoom: zoom, fromOffset: offset, nextZoom: next)
        withAnimation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion)) {
            zoom = r.zoom
            offset = r.offset
        }
    }

    private func nudge(_ delta: CGSize, side: CGFloat) {
        let raw = CGSize(width: offset.width + delta.width, height: offset.height + delta.height)
        withAnimation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion)) {
            offset = ProfilePhotoCrop.clampOffset(image: imageSize, frame: side, zoom: zoom, offset: raw)
        }
    }

    // MARK: Zoom controls

    private var zoomControls: some View {
        HStack(spacing: Spacing.m) {
            Button { setZoom(zoom - 0.25, side: frameSide) } label: {
                Image(systemName: "minus.magnifyingglass")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.yard.ink2)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(PressableButtonStyle(scale: Motion.pressScale))
            .accessibilityLabel(Text("Zoom out"))
            Slider(
                value: Binding(
                    get: { Double(ProfilePhotoCrop.clampZoom(zoom)) },
                    set: { value in
                        let r = ProfilePhotoCrop.zoomTo(image: imageSize, frame: frameSide, fromZoom: zoom, fromOffset: offset, nextZoom: CGFloat(value))
                        zoom = r.zoom
                        offset = r.offset
                    }
                ),
                in: Double(ProfilePhotoCrop.minZoom)...Double(ProfilePhotoCrop.maxZoom)
            )
            .tint(Color.yard.acid)
            .accessibilityLabel(Text("Zoom"))
            Button { setZoom(zoom + 0.25, side: frameSide) } label: {
                Image(systemName: "plus.magnifyingglass")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.yard.ink2)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(PressableButtonStyle(scale: Motion.pressScale))
            .accessibilityLabel(Text("Zoom in"))
        }
        .frame(maxWidth: 360)
    }

    // MARK: Save

    private func save() {
        guard !isSaving else { return }
        isSaving = true
        problem = nil
        let side = frameSide
        let z = ProfilePhotoCrop.clampZoom(zoom)
        let o = ProfilePhotoCrop.clampOffset(image: imageSize, frame: side, zoom: z, offset: offset)
        let source = image
        Task { @MainActor in
            let jpeg = await Task.detached(priority: .userInitiated) {
                ProfilePhotoCrop.renderJPEG(source, frame: side, zoom: z, offset: o)
            }.value
            guard let jpeg, let preview = UIImage(data: jpeg) else {
                isSaving = false
                problem = ProfilePhotoCopy.renderFailed
                return
            }
            onDone(ProfilePhotoCropResult(jpeg: jpeg, preview: preview))
        }
    }
}

/// A square with a circular hole (even-odd fill): dims everything a round avatar won't show.
private struct ProfilePhotoCircleMask: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.addRect(rect)
        p.addEllipse(in: rect)
        return p
    }
}

// MARK: - Camera

/// The system camera (UIImagePickerController). It asks for camera permission itself, using
/// NSCameraUsageDescription. Returns the photo, or nil when cancelled.
struct YouCameraPicker: UIViewControllerRepresentable {
    let onFinish: (UIImage?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraDevice = UIImagePickerController.isCameraDeviceAvailable(.front) ? .front : .rear
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

// MARK: - Previews

#Preview("Photo section — dark") {
    ScrollView {
        YouProfilePhotoSection(
            account: YouAccount(name: "Ada Obi", email: "ada@example.com", emailVerified: true, hasPassword: true, signInProviders: [], pendingEmail: nil, demo: false),
            onAccount: { _ in }
        )
        .padding()
    }
    .yardScreenBackground()
    .yardPreviewEnvironment()
    .preferredColorScheme(.dark)
}

#Preview("Photo section — light, demo") {
    ScrollView {
        YouProfilePhotoSection(
            account: YouAccount(name: "Ada Obi", email: "ada@example.com", emailVerified: true, hasPassword: true, signInProviders: [], pendingEmail: nil, demo: true),
            onAccount: { _ in }
        )
        .padding()
    }
    .yardScreenBackground()
    .yardPreviewEnvironment()
    .preferredColorScheme(.light)
}
