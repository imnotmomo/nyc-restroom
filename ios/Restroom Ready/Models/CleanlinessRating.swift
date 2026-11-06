import Foundation

enum CleanlinessRating {
    /// Firestore Rules list membership distinguishes integral doubles from integers.
    /// Keep whole-star votes compatible with the existing allowed-value list.
    static func firestoreNumber(for stars: Double) -> NSNumber? {
        guard stars.isFinite, stars >= 1, stars <= 5,
              (stars * 2).rounded() == stars * 2 else { return nil }
        if stars.rounded() == stars {
            return NSNumber(value: Int64(stars))
        }
        return NSNumber(value: stars)
    }
}
