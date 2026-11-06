import SwiftUI
import MapKit

struct MapFocus: Identifiable {
    var id = UUID()
    var coordinate: CLLocationCoordinate2D
    var span: Double = 0.015
    var coordinates: [CLLocationCoordinate2D] = []
}

struct RestroomMapView: UIViewRepresentable {
    var places: [Place]
    var selectedID: String?
    var focus: MapFocus?
    var showsUserLocation: Bool
    var viewportInsets: UIEdgeInsets = .init(top: 80, left: 28, bottom: 90, right: 28)
    var onSelect: (Place) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView(frame: .zero)
        map.delegate = context.coordinator
        map.preferredConfiguration = MKStandardMapConfiguration(elevationStyle: .flat, emphasisStyle: .muted)
        map.pointOfInterestFilter = .excludingAll
        map.register(RestroomDotAnnotationView.self, forAnnotationViewWithReuseIdentifier: "place")
        map.register(RestroomDotAnnotationView.self, forAnnotationViewWithReuseIdentifier: "cluster")
        map.setRegion(.init(center: .init(latitude: 40.731, longitude: -73.977),
                            span: .init(latitudeDelta: 0.30, longitudeDelta: 0.24)), animated: false)
        map.showsCompass = true
        map.showsScale = true
        map.isPitchEnabled = false
        // SwiftUI supplies a concise accessible entry to the complete venue list.
        // Traversing MapKit's citywide annotation tree is slow and obscures the app controls.
        #if DEBUG
        map.accessibilityElementsHidden = !ProcessInfo.processInfo.arguments.contains("-review-map-pins")
        #else
        map.accessibilityElementsHidden = true
        #endif
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        map.layoutMargins = viewportInsets
        coordinator.places = Dictionary(uniqueKeysWithValues: places.map { ($0.id, $0) })
        map.showsUserLocation = showsUserLocation
        let wanted = Set(places.map(\.id))
        let old = map.annotations.compactMap { $0 as? PlaceAnnotation }
        map.removeAnnotations(old.filter { !wanted.contains($0.placeID) })
        let existing = Set(old.map(\.placeID))
        map.addAnnotations(places.filter { !existing.contains($0.id) }.map(PlaceAnnotation.init))

        // Data updates must not snap the map back to the initial NYC region.
        if let focus, coordinator.lastFocus != focus.id {
            coordinator.lastFocus = focus.id
            let coordinates = focus.coordinates.isEmpty ? [focus.coordinate] : focus.coordinates
            var rect = coordinates.reduce(MKMapRect.null) { result, coordinate in
                let point = MKMapPoint(coordinate)
                return result.union(.init(x: point.x, y: point.y, width: 1, height: 1))
            }
            // One result still needs street context. Center it above the place sheet.
            let minimumSide = MKMapPointsPerMeterAtLatitude(focus.coordinate.latitude) * 700
            let width = max(rect.width, minimumSide)
            let height = max(rect.height, minimumSide)
            rect = MKMapRect(x: rect.midX - width / 2, y: rect.midY - height / 2, width: width, height: height)
            map.setVisibleMapRect(rect, edgePadding: viewportInsets, animated: !UIAccessibility.isReduceMotionEnabled)
        }
        if coordinator.lastSelection != selectedID {
            coordinator.lastSelection = selectedID
            for annotation in map.annotations.compactMap({ $0 as? PlaceAnnotation }) {
                if let view = map.view(for: annotation) as? RestroomDotAnnotationView {
                    view.configure(count: nil, selected: annotation.placeID == selectedID)
                }
            }
        }
    }

    static func dismantleUIView(_ map: MKMapView, coordinator: Coordinator) {
        map.delegate = nil
        map.showsUserLocation = false
    }

    final class PlaceAnnotation: NSObject, MKAnnotation {
        let placeID: String
        let coordinate: CLLocationCoordinate2D
        let title: String?
        init(_ place: Place) {
            placeID = place.id
            coordinate = place.coordinate
            title = place.name
        }
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var parent: RestroomMapView
        var places: [String: Place] = [:]
        var lastFocus: UUID?
        var lastSelection: String?
        static let blue = UIColor(red: 43/255, green: 89/255, blue: 195/255, alpha: 1)
        static let selected = UIColor(red: 23/255, green: 42/255, blue: 79/255, alpha: 1)
        init(_ parent: RestroomMapView) { self.parent = parent }

        func mapView(_ map: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            if annotation is MKUserLocation { return nil }
            if let cluster = annotation as? MKClusterAnnotation {
                let view = map.dequeueReusableAnnotationView(withIdentifier: "cluster", for: cluster) as! RestroomDotAnnotationView
                view.clusteringIdentifier = nil
                view.configure(count: cluster.memberAnnotations.count, selected: false)
                view.displayPriority = .defaultHigh
                view.accessibilityLabel = "\(cluster.memberAnnotations.count) restrooms. Tap to zoom in."
                #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("-review-map-pins") {
                    view.accessibilityIdentifier = "review-map-cluster"
                }
                #endif
                return view
            }
            guard let place = annotation as? PlaceAnnotation else { return nil }
            let view = map.dequeueReusableAnnotationView(withIdentifier: "place", for: place) as! RestroomDotAnnotationView
            view.clusteringIdentifier = "restrooms"
            view.configure(count: nil, selected: place.placeID == parent.selectedID)
            view.displayPriority = .defaultLow
            view.canShowCallout = false
            view.accessibilityLabel = "\(place.title ?? "Restroom"). View restroom details."
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-review-map-pins") {
                view.accessibilityIdentifier = "review-map-pin-" + place.placeID
            }
            #endif
            return view
        }

        func mapView(_ map: MKMapView, didSelect view: MKAnnotationView) {
            guard let annotation = view.annotation else { return }
            if let cluster = annotation as? MKClusterAnnotation {
                NativeAnalytics.track(.mapClusterOpen(size: .from(cluster.memberAnnotations.count)))
                let rect = cluster.memberAnnotations.reduce(MKMapRect.null) { result, item in
                    let p = MKMapPoint(item.coordinate)
                    return result.union(.init(x: p.x, y: p.y, width: 1, height: 1))
                }
                map.setVisibleMapRect(rect, edgePadding: parent.viewportInsets,
                                      animated: !UIAccessibility.isReduceMotionEnabled)
                map.deselectAnnotation(annotation, animated: false)
            } else if let point = annotation as? PlaceAnnotation, let place = places[point.placeID] {
                parent.onSelect(place)
                map.deselectAnnotation(annotation, animated: false)
            }
        }
    }
}

/// Small directory dots and larger count circles match the approved finder map.
/// The interactive annotation frame remains at least 44pt even for a 16pt dot.
final class RestroomDotAnnotationView: MKAnnotationView {
    private let dot = UIView()
    private let countLabel = UILabel()

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        frame = CGRect(x: 0, y: 0, width: 48, height: 48)
        backgroundColor = .clear
        collisionMode = .circle
        dot.isUserInteractionEnabled = false
        countLabel.isUserInteractionEnabled = false
        countLabel.textAlignment = .center
        countLabel.textColor = .white
        countLabel.font = .monospacedDigitSystemFont(ofSize: 15, weight: .semibold)
        addSubview(dot)
        dot.addSubview(countLabel)
        isAccessibilityElement = true
        accessibilityTraits = .button
    }

    required init?(coder: NSCoder) { fatalError("Programmatic map annotations only") }

    func configure(count: Int?, selected: Bool) {
        let diameter: CGFloat = count.map { $0 >= 1000 ? 48 : 42 } ?? (selected ? 22 : 16)
        dot.frame = CGRect(x: (48 - diameter) / 2, y: (48 - diameter) / 2, width: diameter, height: diameter)
        dot.layer.cornerRadius = diameter / 2
        dot.layer.borderColor = UIColor.white.cgColor
        dot.layer.borderWidth = count == nil ? 2 : 2.5
        dot.backgroundColor = selected
            ? UIColor(red: 30/255, green: 42/255, blue: 48/255, alpha: 1)
            : UIColor(red: 43/255, green: 89/255, blue: 195/255, alpha: 1)
        countLabel.frame = dot.bounds
        countLabel.text = count.map(String.init)
        countLabel.isHidden = count == nil
    }
}
