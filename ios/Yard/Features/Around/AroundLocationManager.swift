import Foundation
import CoreLocation
import Observation

/// When-in-use location for Around. The fix stays on the device: the server only ever gets the
/// whole-world list (`scope=world`), and distances are computed here.
@Observable
@MainActor
final class AroundLocationManager: NSObject, CLLocationManagerDelegate {
    private(set) var authorization: CLAuthorizationStatus
    private(set) var location: CLLocation?
    /// Bumped on each new fix after the shopper asked to locate them, so the map can fly there once.
    private(set) var requestedFixCount: Int = 0

    @ObservationIgnored private let manager: CLLocationManager
    @ObservationIgnored private var wantsFix = false

    override init() {
        let m = CLLocationManager()
        self.manager = m
        self.authorization = m.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 100
    }

    var isAuthorized: Bool {
        authorization == .authorizedWhenInUse || authorization == .authorizedAlways
    }

    var isDenied: Bool {
        authorization == .denied || authorization == .restricted
    }

    /// Starts updates quietly when permission was already given (no prompt).
    func startIfAuthorized() {
        if isAuthorized { manager.startUpdatingLocation() }
    }

    func stop() {
        manager.stopUpdatingLocation()
    }

    /// The locate button: asks for permission the first time, then a fresh fix.
    func requestLocation() {
        wantsFix = true
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            manager.startUpdatingLocation()
            manager.requestLocation()
            if location != nil {
                wantsFix = false
                requestedFixCount += 1
            }
        case .denied, .restricted:
            wantsFix = false
        @unknown default:
            wantsFix = false
        }
    }

    // MARK: CLLocationManagerDelegate (called on the main thread: the manager was made there)

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            self.authorization = status
            if status == .authorizedWhenInUse || status == .authorizedAlways {
                self.manager.startUpdatingLocation()
            } else {
                self.wantsFix = false
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        Task { @MainActor in
            self.location = last
            if self.wantsFix {
                self.wantsFix = false
                self.requestedFixCount += 1
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            self.wantsFix = false
        }
    }
}
