import CoreFoundation
import XCTest
@testable import RestroomDirectory

final class CleanlinessRatingTests: XCTestCase {
    func testEveryAllowedRatingPreservesTheFirestoreNumericType() throws {
        for step in 2...10 {
            let stars = Double(step) / 2
            let number = try XCTUnwrap(CleanlinessRating.firestoreNumber(for: stars))
            XCTAssertEqual(number.doubleValue, stars)
            XCTAssertNotEqual(CFGetTypeID(number), CFBooleanGetTypeID())
            let floating = ["f", "d"].contains(String(cString: number.objCType))
            XCTAssertEqual(floating, step % 2 != 0,
                           "Whole stars must encode as integers; half stars must remain decimal values.")
        }
    }

    func testInvalidRatingsNeverProduceAWriteValue() {
        for stars in [0, 0.5, 5.5, -1, 1.1, 4.99, .nan, .infinity, -.infinity] {
            XCTAssertNil(CleanlinessRating.firestoreNumber(for: stars))
        }
    }
}
