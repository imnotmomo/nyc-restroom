import Foundation
import CoreLocation
import Observation

@MainActor @Observable
final class LocationService: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private(set) var coordinate: CLLocationCoordinate2D?
    private(set) var accuracy: Double?
    private(set) var isLocating = false
    private(set) var message: String?
    private(set) var authorizationDenied = false
    private var requested = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        authorizationDenied = [.denied, .restricted].contains(manager.authorizationStatus)
    }

    /// Reuse permission already granted without prompting on a new launch.
    func locateIfAuthorized() {
        guard !requested, [.authorizedAlways, .authorizedWhenInUse].contains(manager.authorizationStatus) else { return }
        requestLocation()
    }

    func requestLocation() {
        requested = true
        message = nil
        coordinate = nil
        accuracy = nil
        switch manager.authorizationStatus {
        case .notDetermined:
            isLocating = true
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            authorizationDenied = false
            isLocating = true
            manager.requestLocation()
        case .denied, .restricted:
            authorizationDenied = true
            isLocating = false
            message = "Location is off. Allow it in Settings, or search for an address."
        @unknown default:
            isLocating = false
            message = "Location is unavailable. Search for an address instead."
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            authorizationDenied = [.denied, .restricted].contains(manager.authorizationStatus)
            guard requested else { return }
            if [.authorizedAlways, .authorizedWhenInUse].contains(manager.authorizationStatus) {
                isLocating = true
                manager.requestLocation()
            } else if authorizationDenied {
                isLocating = false
                coordinate = nil
                accuracy = nil
                message = "Location is off. Allow it in Settings, or search for an address."
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor [weak self] in
            guard let self, let location = locations.last, location.horizontalAccuracy >= 0,
                  abs(location.timestamp.timeIntervalSinceNow) < 120 else { return }
            coordinate = location.coordinate
            accuracy = location.horizontalAccuracy
            isLocating = false
            message = nil
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor [weak self] in
            self?.isLocating = false
            self?.message = "Couldn’t get your location. Try again or search for an address."
        }
    }
}

struct AddressCandidate: Identifiable {
    let id: String
    let name: String
    let address: String
    let latitude: Double
    let longitude: Double
    var coordinate: CLLocationCoordinate2D { .init(latitude: latitude, longitude: longitude) }
}
