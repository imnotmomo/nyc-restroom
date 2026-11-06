import Foundation
import MapKit
import Observation

@MainActor @Observable
final class AddressSearch {
    var query = ""
    private(set) var results: [AddressCandidate] = []
    private(set) var isSearching = false
    private(set) var error: String?
    private var searchTask: MKLocalSearch?
    private var generation = UUID()

    func cancel() {
        generation = UUID()
        searchTask?.cancel()
        searchTask = nil
        isSearching = false
    }

    func search(near: CLLocationCoordinate2D? = nil) async {
        cancel()
        results = []
        error = nil
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty || near != nil else {
            error = "Enter a place or NYC street address."
            return
        }
        if let near, !Place.containsNYC(latitude: near.latitude, longitude: near.longitude) {
            error = "Your location is outside NYC. Search for a NYC place or address instead."
            return
        }
        let token = generation
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = text.isEmpty ? "shops libraries cafes" : text
        request.resultTypes = [.address, .pointOfInterest]
        request.region = .init(center: near ?? .init(latitude: 40.73, longitude: -73.97),
                               span: .init(latitudeDelta: near == nil ? 0.4 : 0.012,
                                           longitudeDelta: near == nil ? 0.4 : 0.012))
        let task = MKLocalSearch(request: request)
        searchTask = task
        isSearching = true
        do {
            let response = try await task.start()
            guard generation == token, !Task.isCancelled else { return }
            results = response.mapItems.compactMap { item in
                let p = item.placemark
                guard Place.containsNYC(latitude: p.coordinate.latitude, longitude: p.coordinate.longitude) else { return nil }
                let street = [p.subThoroughfare, p.thoroughfare].compactMap { $0 }.joined(separator: " ")
                let area = [p.locality, p.administrativeArea, p.postalCode].compactMap { $0 }.joined(separator: ", ")
                let address = [street, area].filter { !$0.isEmpty }.joined(separator: ", ")
                guard !address.isEmpty else { return nil }
                return AddressCandidate(id: "\(p.coordinate.latitude):\(p.coordinate.longitude):\(item.name ?? address)",
                                        name: item.name ?? street, address: address,
                                        latitude: p.coordinate.latitude, longitude: p.coordinate.longitude)
            }
            if let near {
                let origin = CLLocation(latitude: near.latitude, longitude: near.longitude)
                results.sort {
                    CLLocation(latitude: $0.latitude, longitude: $0.longitude).distance(from: origin)
                    < CLLocation(latitude: $1.latitude, longitude: $1.longitude).distance(from: origin)
                }
            }
            if results.isEmpty { error = "No NYC matches. Try a more specific place name or street address." }
        } catch {
            guard generation == token, !Task.isCancelled else { return }
            self.error = "Address search failed. Check your connection and try again."
        }
        if generation == token { isSearching = false; searchTask = nil }
    }
}
