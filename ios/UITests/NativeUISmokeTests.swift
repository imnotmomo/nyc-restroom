import XCTest
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Real anonymous screens only. These tests never sign in or write production data.
final class NativeUISmokeTests: XCTestCase {
    private let app = XCUIApplication()

    override func setUpWithError() throws { continueAfterFailure = false }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func launch() {
        app.launch()
        XCTAssertTrue(app.textFields["restroom-search"].waitForExistence(timeout: 25))
        // Location/feed startup can move the map controls. Do not tap a stale
        // pre-layout position that has become a map pin beneath the button.
        let filters = app.buttons["show-filters"]
        var previousFrame = CGRect.null
        var stableSamples = 0
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard filters.exists, filters.isHittable else { stableSamples = 0; return false }
            let frame = filters.frame
            guard frame.width >= 44, frame.height >= 44 else { stableSamples = 0; return false }
            if frame == previousFrame { stableSamples += 1 }
            else { previousFrame = frame; stableSamples = 0 }
            return stableSamples >= 2
        }, object: filters)
        XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 10), .completed)
    }

    @MainActor
    private func assertNoNoMatchAlert(timeout: TimeInterval = 0.8) {
        let absent = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true"),
            object: app.alerts["No matching restrooms"])
        absent.isInverted = true
        XCTAssertEqual(XCTWaiter.wait(for: [absent], timeout: timeout), .completed)
    }

    @MainActor
    private func confirmInlineNoMatches() -> XCUIElement {
        let message = app.staticTexts["search-no-matches"]
        XCTAssertTrue(message.waitForExistence(timeout: 25))
        XCTAssertEqual(message.label, "No restroom was found")
        XCTAssertTrue(message.isHittable)
        assertNoNoMatchAlert()
        return message
    }

    @MainActor
    private func assertInitialHalfHeightPlaceSheet() {
        // Every new restroom opening starts at the same half-height detent,
        // including largest text. Expansion is exercised separately below.
        let close = app.buttons["close-place"]
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            close.exists && close.frame.minY >= self.app.frame.midY - 64
                && close.frame.minY <= self.app.frame.midY + 96
        }, object: close)
        XCTAssertEqual(XCTWaiter.wait(for: [settled], timeout: 10), .completed)
        XCTAssertTrue(app.buttons["place-directions"].isHittable)
    }

    @MainActor
    private func scrollPlaceContent(upwards: Bool, distance: CGFloat? = nil) {
        let viewport = unobscuredContentViewport().insetBy(dx: 2, dy: 12)
        let candidates = app.scrollViews.allElementsBoundByIndex
            + app.collectionViews.allElementsBoundByIndex + app.tables.allElementsBoundByIndex
        let containers = candidates.filter {
            // Grouped Form parents may report !isHittable while their rows
            // remain interactive. Parent hittability is not a scrollability test.
            $0.exists && $0.frame.intersection(viewport).height >= 44
        }
        let scroll = containers.max(by: {
            $0.frame.intersection(viewport).height < $1.frame.intersection(viewport).height
        })
        if !app.buttons["place-directions"].exists, let scroll {
            // The full-screen native Form has no fixed Directions footer.
            // Its grouped-list gutter does not receive pans, so use its native
            // scroll gesture. Card/source sheets keep the bounded content pan.
            if upwards { scroll.swipeUp(velocity: .slow) }
            else { scroll.swipeDown(velocity: .slow) }
            return
        }
        // Some native picker/Form layouts expose no AX scroll parent. The
        // foreground content rectangle remains an observed, bounded gesture
        // area; the target visibility and full tap-area checks still decide pass.
        let safe = scroll.map { $0.frame.intersection(viewport) } ?? viewport
        guard safe.height > 64 else { XCTFail("No unobscured content pan area"); return }
        // The scroll container's accessibility frame can include the fixed
        // Directions footer. Keep both coordinates inside the actual content,
        // in the leading gutter rather than on a disclosure control.
        let travel = min(max(44, distance ?? safe.height * 0.55), safe.height - 32)
        let x = safe.minX + 4
        let startY = upwards ? safe.maxY - 16 : safe.minY + 16
        let endY = upwards ? startY - travel : startY + travel
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let start = origin.withOffset(CGVector(dx: x, dy: startY))
        let end = origin.withOffset(CGVector(dx: x, dy: endY))
        start.press(forDuration: 0.02, thenDragTo: end)
    }

    @MainActor
    private func reveal(_ element: XCUIElement, maxSwipes: Int = 6, scrollUpWhenAbsent: Bool = true) {
        for attempt in 0...maxSwipes {
            let viewport = unobscuredContentViewport().insetBy(dx: 2, dy: 4)
            if element.exists {
                let bounds = element.frame
                let tapPoint = CGPoint(x: bounds.midX, y: bounds.midY)
                let visible = bounds.intersection(viewport)
                if element.isHittable && viewport.contains(tapPoint) && !visible.isNull
                    && bounds.height > 0 && visible.height >= bounds.height - 0.5 { return }
                if attempt < maxSwipes {
                    // Move only far enough to reveal the full target. A whole-
                    // screen fling can oscillate past a tall Dynamic Type row.
                    let upwards = bounds.maxY > viewport.maxY
                    let missing = upwards ? bounds.maxY - viewport.maxY : viewport.minY - bounds.minY
                    let distance = min(max(44, missing + 8), viewport.height * 0.65)
                    scrollPlaceContent(upwards: upwards, distance: distance)
                }
            } else if attempt < maxSwipes { scrollPlaceContent(upwards: scrollUpWhenAbsent) }
        }
        let exists = element.exists
        let bounds = exists ? String(describing: element.frame) : "unavailable"
        XCTFail("Expected a fully visible, hittable action above the footer: exists=\(exists); frame=\(bounds)")
    }

    @MainActor
    private func unobscuredContentViewport() -> CGRect {
        let screen = app.frame
        let bar = app.navigationBars.firstMatch
        let directions = app.buttons["place-directions"]
        let top = bar.exists ? max(screen.minY, bar.frame.maxY) : screen.minY
        let bottom = directions.exists ? min(screen.maxY, directions.frame.minY) : screen.maxY
        return CGRect(x: screen.minX, y: top, width: screen.width, height: max(0, bottom - top))
    }

    /// Reading a combined fact requires visible content, rather than a tappable action.
    @MainActor
    private func revealReadable(_ element: XCUIElement, name: String, maxSwipes: Int = 6) {
        var recordedGesture = false
        for attempt in 0...maxSwipes {
            // List may not create a below-screen row until it is scrolled into view.
            guard element.exists else {
                if attempt < maxSwipes { scrollPlaceContent(upwards: true) }
                continue
            }
            let viewport = unobscuredContentViewport()
            let bounds = element.frame
            let visible = bounds.intersection(viewport)
            if !element.label.isEmpty && bounds.width > 0 && bounds.height > 0 && !visible.isNull
                && visible.width >= min(bounds.width, viewport.width) * 0.8
                && visible.height >= min(60, bounds.height) { return }
            if attempt < maxSwipes {
                let upwards = bounds.maxY > viewport.maxY
                let needed = min(60, bounds.height)
                let missing = upwards ? bounds.minY - (viewport.maxY - needed) : viewport.minY + needed - bounds.maxY
                let diagnose = ["Exact room inspection issue", "Dated Parks condition"].contains(name) && !recordedGesture
                let before = diagnose ? "target=\(bounds); close=\(app.buttons["close-place"].exists ? String(describing: app.buttons["close-place"].frame) : "absent"); nav=\(app.navigationBars.firstMatch.frame); viewport=\(viewport)" : ""
                if diagnose { capture("native-controlled-scroll-before") }
                scrollPlaceContent(upwards: upwards, distance: missing + 12)
                if diagnose {
                    let after = "target=\(element.frame); close=\(app.buttons["close-place"].exists ? String(describing: app.buttons["close-place"].frame) : "absent"); nav=\(app.navigationBars.firstMatch.frame)"
                    let diagnostic = XCTAttachment(string: "Before: \(before)\nAfter: \(after)")
                    diagnostic.name = "native-controlled-scroll-geometry"; diagnostic.lifetime = .keepAlways; add(diagnostic)
                    print("Native controlled scroll Before: \(before) After: \(after)")
                    capture("native-controlled-scroll-after"); recordedGesture = true
                }
            }
        }
        let exists = element.exists
        let bounds = exists ? String(describing: element.frame) : "unavailable"
        let label = exists ? String(element.label.prefix(700)) : "unavailable"
        capture("native-reading-failure-" + name)
        XCTFail("Readable fact \(name): exists=\(exists); frame=\(bounds); label=\(label)")
    }

    @MainActor
    private func tapVisibleReadingRow(_ element: XCUIElement) {
        let visible = element.frame.intersection(unobscuredContentViewport().insetBy(dx: 4, dy: 4))
        XCTAssertFalse(visible.isNull)
        XCTAssertGreaterThanOrEqual(visible.height, 44)
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: visible.midX, dy: visible.midY)).tap()
    }

    @MainActor
    private func returnToPlace(from title: String) {
        let bar = app.navigationBars[title]
        XCTAssertTrue(bar.waitForExistence(timeout: 10))
        let back = bar.buttons.matching(NSPredicate(format: "identifier != %@ AND identifier != %@", "close-place", "place-save")).firstMatch
        XCTAssertTrue(back.isHittable)
        back.tap()
        let returned = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: bar)
        XCTAssertEqual(XCTWaiter.wait(for: [returned], timeout: 10), .completed)
        XCTAssertTrue(app.buttons["close-place"].isHittable)
        XCTAssertTrue(app.buttons["place-directions"].isHittable)
    }

    @MainActor
    private func openSourcesAndDates() {
        let link = app.buttons["place-sources-dates"]
        reveal(link)
        XCTAssertGreaterThanOrEqual(link.frame.height, 44)
        XCTAssertLessThanOrEqual(link.frame.maxY, app.buttons["place-directions"].frame.minY - 4)
        link.tap()
        XCTAssertTrue(app.navigationBars["Sources & dates"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["place-directions"].isHittable)
        XCTAssertTrue(app.buttons["close-place"].isHittable)
    }

    @MainActor
    private func expandReportedDetails() {
        let disclosure = app.buttons["Reported details"]
        reveal(disclosure, maxSwipes: 12)
        disclosure.tap()
    }

    @MainActor
    private var ratingStars: XCUIElement {
        app.descendants(matching: .any).matching(identifier: "rating-stars").firstMatch
    }

    /// Read the real device capability. The shipped app receives no test override.
    @MainActor
    private var visitorSummaryAvailable: Bool {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let model = SystemLanguageModel.default
            if case .available = model.availability {
                return model.supportsLocale(Locale(identifier: "en_US"))
            }
        }
        #endif
        return false
    }

    @MainActor
    private func assertMainHasNoContributionEditors() {
        XCTAssertFalse(ratingStars.exists)
        XCTAssertFalse(app.buttons["save-rating"].exists)
        XCTAssertFalse(app.buttons["Add private note"].exists)
        XCTAssertFalse(app.buttons["add-public-note"].exists)
        XCTAssertFalse(app.buttons["Share a visit"].exists)
        XCTAssertFalse(app.buttons["add-visit-details"].exists)
    }

    @MainActor
    private func openRateAndComment() {
        let link = app.buttons["place-rate-comment"]
        reveal(link)
        XCTAssertGreaterThanOrEqual(link.frame.height, 44)
        XCTAssertLessThanOrEqual(link.frame.maxY, app.buttons["place-directions"].frame.minY - 4)
        link.tap()
        XCTAssertTrue(app.navigationBars["Rate and Comment"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Cleanliness rating"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == %@", "Cleanliness rating")).count, 1)
        XCTAssertFalse(app.staticTexts["Public visit reports"].exists)
        XCTAssertTrue(app.buttons["place-directions"].isHittable)
        XCTAssertTrue(app.buttons["close-place"].isHittable)
    }

    @MainActor
    private func assertConditionOverview(readable: Bool = true) {
        let row = app.descendants(matching: .any).matching(identifier: "place-summary-condition").firstMatch
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            row.exists && !row.label.contains("Loading reports") && !row.label.contains("Reports unavailable")
        }, object: row)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed)
        if readable { revealReadable(row, name: "place-summary-condition") }
        XCTAssertTrue(row.label.contains("Condition"))
        let sourced = ["Closure reported:", "Listed ", "Acceptable", "Unacceptable", "Not rated"].contains { row.label.contains($0) }
        if sourced {
            XCTAssertTrue(row.label.contains("From "), "A source condition retains source attribution")
            XCTAssertTrue(["Inspected ", "Observed ", "Published ", "Date not shown"].contains { row.label.contains($0) })
        } else {
            XCTAssertTrue(["Not reported", "Usable — reported", "Needs attention — reported", "Conflicting reports"]
                .contains { row.label.contains($0) })
        }
        if !sourced && !row.label.contains("Not reported") {
            XCTAssertTrue(row.label.contains("Visited "), "A reported condition retains its actual visit date")
        }
    }

    @MainActor
    private func assertMainDestinationGroup(capturePrefix: String) {
        let rate = app.buttons["place-rate-comment"]
        let codes = app.buttons["place-passcodes"]
        let details = app.buttons["place-sources-dates"]
        let amenities = app.descendants(matching: .any).matching(identifier: "place-summary-amenities").firstMatch
        reveal(codes)
        XCTAssertTrue(codes.isHittable)
        XCTAssertGreaterThanOrEqual(codes.frame.height, 44)
        XCTAssertLessThanOrEqual(codes.frame.maxY, app.buttons["place-directions"].frame.minY - 4)
        XCTAssertTrue(amenities.exists)
        XCTAssertLessThanOrEqual(amenities.frame.maxY, codes.frame.minY + 1)
        let condition = app.descendants(matching: .any).matching(identifier: "place-summary-condition").firstMatch
        XCTAssertTrue(condition.exists)
        XCTAssertLessThanOrEqual(condition.frame.maxY, codes.frame.minY + 1)
        capture(capturePrefix + "-passcodes-under-condition")
        assertConditionOverview()
        capture(capturePrefix + "-condition")
        reveal(details)
        for control in [rate, details] {
            XCTAssertTrue(control.isHittable)
            XCTAssertGreaterThanOrEqual(control.frame.height, 44)
            XCTAssertGreaterThanOrEqual(control.frame.minY, unobscuredContentViewport().minY)
            XCTAssertLessThanOrEqual(control.frame.maxY, app.buttons["place-directions"].frame.minY - 4)
        }
        XCTAssertLessThanOrEqual(rate.frame.maxY, details.frame.minY + 1)
        XCTAssertLessThanOrEqual(details.frame.minY - rate.frame.maxY, 4)
        assertMainHasNoContributionEditors()
        capture(capturePrefix + "-grouped-destinations")
    }

    @MainActor
    private func assertAISummaryAvailabilityOnMain(capturePrefix: String) {
        if visitorSummaryAvailable {
            let title = app.staticTexts["visitor-reports-title"]
            revealReadable(title, name: "visitor-reports-title")
            XCTAssertEqual(title.label, "Visitor reports")
            XCTAssertFalse(app.buttons["Visitor reports"].exists)
            XCTAssertFalse(app.buttons["place-visitor-reports"].exists)
        } else {
            for identifier in ["visitor-reports-title", "visitor-reports-section", "place-visitor-reports", "visitor-report-summary"] {
                XCTAssertFalse(app.descendants(matching: .any).matching(identifier: identifier).firstMatch.exists)
            }
            XCTAssertFalse(app.staticTexts["Visitor reports"].exists)
            XCTAssertFalse(app.buttons["Share a visit"].exists)
            XCTAssertFalse(app.buttons["add-visit-details"].exists)
        }
        capture(capturePrefix + (visitorSummaryAvailable ? "-ai-summary-available" : "-ai-summary-unavailable-hidden"))
    }

    @MainActor
    private func assertSourcesHasNoDuplicateDestinations() {
        XCTAssertTrue(app.navigationBars["Sources & dates"].exists)
        for identifier in ["details-access", "details-visits", "details-sources", "details-notes"] {
            XCTAssertFalse(app.buttons[identifier].exists, identifier)
        }
        XCTAssertFalse(app.navigationBars["Details & reports"].exists)
    }

    /// Star choices stay local. This never invokes a provider or submits a production vote.
    @MainActor
    private func checkRatingDraft(capturePrefix: String) {
        XCTAssertTrue(app.navigationBars["Rate and Comment"].exists)
        let stars = ratingStars
        reveal(stars)
        XCTAssertGreaterThanOrEqual(stars.frame.height, 44)
        XCTAssertEqual(stars.value as? String, "No rating selected")
        XCTAssertFalse(app.buttons["save-rating"].exists)

        // A vertical drag over the control scrolls the card without choosing a score.
        let verticalStart = stars.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
        let verticalEnd = stars.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: -0.8))
        verticalStart.press(forDuration: 0.1, thenDragTo: verticalEnd)
        XCTAssertEqual(stars.value as? String, "No rating selected")
        XCTAssertFalse(app.buttons["save-rating"].exists)
        reveal(stars)
        capture(capturePrefix + "-empty-stars-after-vertical-scroll")

        stars.coordinate(withNormalizedOffset: CGVector(dx: 0.48, dy: 0.5)).tap()
        XCTAssertEqual(stars.value as? String, "2.5 of 5 stars")
        let submit = app.buttons["save-rating"]
        XCTAssertTrue(submit.waitForExistence(timeout: 10))
        XCTAssertEqual(submit.label, "Submit rating")
        XCTAssertFalse(app.navigationBars["Sign in"].exists)

        let dragStart = stars.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5))
        let dragEnd = stars.coordinate(withNormalizedOffset: CGVector(dx: 0.68, dy: 0.5))
        dragStart.press(forDuration: 0.1, thenDragTo: dragEnd)
        XCTAssertEqual(stars.value as? String, "3.5 of 5 stars")
        XCTAssertFalse(app.navigationBars["Sign in"].exists)
        reveal(submit)
        XCTAssertGreaterThanOrEqual(submit.frame.height, 44)
        capture(capturePrefix + "-half-star-draft")
        submit.tap()
        XCTAssertTrue(app.navigationBars["Sign in"].waitForExistence(timeout: 10))
        capture(capturePrefix + "-rating-provider-choices")
        cancelSignInChoices()
        XCTAssertEqual(stars.value as? String, "3.5 of 5 stars")
        XCTAssertTrue(submit.isEnabled)
        XCTAssertFalse(app.staticTexts["Rating saved"].exists)
        capture(capturePrefix + "-rating-cancel-keeps-draft")
    }

    @MainActor
    private func checkCompactDetailNavigation(capturePrefix: String) {
        let summary = app.descendants(matching: .any).matching(identifier: "place-current-rating").firstMatch
        XCTAssertTrue(summary.waitForExistence(timeout: 10))
        XCTAssertFalse(summary.label.isEmpty)
        XCTAssertLessThanOrEqual(summary.frame.maxX, app.frame.maxX)
        XCTAssertFalse(app.buttons["save-rating"].exists)
        assertMainHasNoContributionEditors()

        let codes = app.buttons["place-passcodes"]
        reveal(codes)
        codes.tap()
        XCTAssertTrue(app.navigationBars["Passcodes"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["place-directions"].isHittable)
        XCTAssertTrue(app.buttons["close-place"].isHittable)
        capture(capturePrefix + "-passcodes")
        returnToPlace(from: "Passcodes")

        openSourcesAndDates()
        XCTAssertFalse(app.buttons["rate-restroom"].exists)
        XCTAssertFalse(ratingStars.exists)
        XCTAssertFalse(app.buttons["save-rating"].exists)
        assertSourcesHasNoDuplicateDestinations()
        capture(capturePrefix + "-sources-and-dates")
        expandReportedDetails()
        let hours = app.descendants(matching: .any).matching(identifier: "access-restroom-hours").firstMatch
        revealReadable(hours, name: "access-restroom-hours")
        XCTAssertTrue(hours.label.contains("8am-4pm, Open later seasonally"))
        capture(capturePrefix + "-reported-details")
        returnToPlace(from: "Sources & dates")
    }

    @MainActor
    func testAnonymousDiscoveryAndDetail() throws {
        launch()
        XCTAssertFalse(app.staticTexts["Find a restroom you can use."].exists)
        XCTAssertTrue(app.buttons["show-filters"].isHittable)
        capture("01-map-first-liquid-glass")
        app.buttons["display-list"].tap()
        let search = app.textFields["restroom-search"]
        search.tap()
        search.typeText("100% Playground\n")
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        let row = app.buttons["place-i7jb-7jku:row-pu48.fixg-qdtc"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        capture("02-native-search-list")
        row.tap()
        XCTAssertTrue(app.buttons["close-place"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["place-directions"].isHittable)
        XCTAssertTrue(app.buttons["place-save"].isHittable)
        let hours = app.descendants(matching: .any).matching(identifier: "place-summary-hours").firstMatch
        revealReadable(hours, name: "place-summary-hours")
        XCTAssertTrue(hours.label.contains("8am-4pm, Open later seasonally"))
        let amenities = app.descendants(matching: .any).matching(identifier: "place-summary-amenities").firstMatch
        revealReadable(amenities, name: "place-summary-amenities")
        XCTAssertTrue(amenities.label.contains("Accessible"))
        for identifier in ["place-summary-entry", "place-summary-route-inside"] {
            XCTAssertFalse(app.descendants(matching: .any).matching(identifier: identifier).firstMatch.exists)
        }
        capture("03-native-medium-place-sheet")
        assertInitialHalfHeightPlaceSheet()
        capture("04-native-initial-half-place")
        checkCompactDetailNavigation(capturePrefix: "04-native-compact")
        app.buttons["close-place"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        XCTAssertEqual(search.value as? String, "100% Playground")
        app.buttons["display-map"].tap()
        XCTAssertTrue(app.buttons["locate-me"].isHittable)
        capture("05-return-to-map")
    }

    /// Preflight: grant this simulator app Location and set a NYC simulator location.
    @MainActor
    func testAuthorizedLocationOnLaunch() throws {
        launch()
        let locate = app.buttons["locate-me"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: locate)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 15), .completed)
        app.buttons["display-list"].tap()
        XCTAssertTrue(app.staticTexts["Nearest first"].waitForExistence(timeout: 10))
        app.buttons["display-map"].tap()
        capture("11-authorized-location-auto-zoom")
    }

    @MainActor
    func testFiltersEmptyRecoveryAndAccountMenu() throws {
        launch()
        XCTAssertEqual(app.buttons["show-filters"].label, "Filters, all restrooms")
        app.buttons["show-filters"].tap()
        XCTAssertTrue(app.buttons["filter-clean"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons["filter-clean"].label, "Clean")
        XCTAssertEqual(app.buttons["filter-accessible"].label, "Accessible")
        XCTAssertEqual(app.buttons["filter-stairFree"].label, "Stair Free")
        XCTAssertEqual(app.buttons["filter-public"].label, "Public")
        XCTAssertEqual(app.buttons["filter-elevator"].label, "Elevator access")
        XCTAssertEqual(app.buttons["filters-reset"].label, "Clear filters")
        for identifier in ["filter-all", "filter-noCode", "filter-saved"] {
            XCTAssertFalse(app.buttons[identifier].exists, identifier)
        }
        app.buttons["filter-clean"].tap()
        XCTAssertTrue(app.buttons["filter-clean"].isSelected)
        app.buttons["filter-accessible"].tap()
        app.buttons["filter-stairFree"].tap()
        app.buttons["filter-public"].tap()
        app.buttons["filter-elevator"].tap()
        for identifier in ["filter-clean", "filter-accessible", "filter-stairFree", "filter-public", "filter-elevator"] {
            XCTAssertTrue(app.buttons[identifier].isSelected, identifier)
        }
        capture("06-native-multiple-filters")
        app.buttons["filters-done"].tap()
        assertNoNoMatchAlert()
        XCTAssertEqual(app.buttons["show-filters"].label, "Filters, Clean, Accessible, Stair Free, Public, Elevator access selected")

        // Done dismisses the sheet without losing any selections; toggling one keeps the others.
        app.buttons["show-filters"].tap()
        for identifier in ["filter-clean", "filter-accessible", "filter-stairFree", "filter-public", "filter-elevator"] {
            XCTAssertTrue(app.buttons[identifier].isSelected, identifier)
        }
        app.buttons["filter-public"].tap()
        app.buttons["filter-elevator"].tap()
        app.buttons["filter-stairFree"].tap()
        XCTAssertFalse(app.buttons["filter-stairFree"].isSelected)
        XCTAssertFalse(app.buttons["filter-public"].isSelected)
        XCTAssertFalse(app.buttons["filter-elevator"].isSelected)
        XCTAssertTrue(app.buttons["filter-clean"].isSelected)
        XCTAssertTrue(app.buttons["filter-accessible"].isSelected)
        app.buttons["filters-done"].tap()
        assertNoNoMatchAlert()
        XCTAssertEqual(app.buttons["show-filters"].label, "Filters, Clean, Accessible selected")
        capture("06-native-two-filters-summary")

        app.buttons["show-filters"].tap()
        app.buttons["filter-accessible"].tap()
        app.buttons["filters-done"].tap()
        assertNoNoMatchAlert()
        XCTAssertEqual(app.buttons["show-filters"].label, "Filters, Clean selected")
        app.buttons["show-filters"].tap()
        app.buttons["filters-reset"].tap()
        for identifier in ["filter-clean", "filter-accessible", "filter-stairFree", "filter-public", "filter-elevator"] {
            XCTAssertFalse(app.buttons[identifier].isSelected, identifier)
        }
        XCTAssertFalse(app.buttons["filter-all"].exists)
        capture("06-native-clear-filters")
        app.buttons["filters-done"].tap()
        XCTAssertEqual(app.buttons["show-filters"].label, "Filters, all restrooms")
        let search = app.textFields["restroom-search"]
        search.tap()
        search.typeText("zzzz-no-such-restroom-9876")
        _ = confirmInlineNoMatches()
        app.buttons["clear-search"].tap()
        app.buttons["account"].tap()
        XCTAssertTrue(app.navigationBars["Account"].waitForExistence(timeout: 10))
        assertAnonymousAccountLayout()
        XCTAssertFalse(app.buttons["log-restroom"].exists)
        capture("07-native-account")
        app.navigationBars["Account"].buttons["Done"].tap()
        XCTAssertTrue(app.buttons["account"].isHittable)
        assertNoNoMatchAlert()
    }

    @MainActor
    func testSearchSuggestionsOpenPlaceWhileTyping() throws {
        launch()
        XCTAssertTrue(app.buttons["display-list"].isHittable)
        XCTAssertFalse(app.buttons["display-map"].exists)
        let search = app.textFields["restroom-search"]
        search.tap()
        search.typeText("park")
        let suggestions = app.scrollViews["search-suggestions"]
        XCTAssertTrue(suggestions.waitForExistence(timeout: 10))
        XCTAssertGreaterThan(suggestions.frame.height, 0)
        XCTAssertLessThan(suggestions.frame.height, app.frame.height / 2)
        let firstID = suggestions.buttons.firstMatch.identifier
        XCTAssertTrue(firstID.hasPrefix("search-suggestion-"))
        let firstSuggestion = app.buttons[firstID]
        let originalTop = firstSuggestion.frame.minY
        suggestions.swipeUp()
        XCTAssertTrue(!firstSuggestion.exists || !firstSuggestion.isHittable || firstSuggestion.frame.minY < originalTop,
                      "Matching options should scroll within the bounded map dropdown")
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        assertNoNoMatchAlert()
        capture("14-native-map-search-dropdown")
        app.buttons["clear-search"].tap()
        XCTAssertTrue(app.buttons["display-list"].isHittable)
        search.tap()
        search.typeText("100% Playground")
        let suggestion = app.buttons["search-suggestion-i7jb-7jku:row-pu48.fixg-qdtc"]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 10))
        XCTAssertTrue(suggestion.isHittable)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        XCTAssertFalse(app.staticTexts["search-no-matches"].exists)
        assertNoNoMatchAlert()
        capture("14-native-search-suggestions")
        suggestion.tap()
        XCTAssertTrue(app.buttons["close-place"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        XCTAssertTrue(app.buttons["place-directions"].isHittable)
        app.buttons["close-place"].tap()
        XCTAssertTrue(search.waitForExistence(timeout: 10))
        XCTAssertEqual(search.value as? String, "100% Playground")
        XCTAssertTrue(app.buttons["display-list"].isHittable)
        XCTAssertFalse(app.buttons["display-map"].exists)
        assertNoNoMatchAlert()
    }

    @MainActor
    func testNoMatchesStayInlineAndFiltersRetainCriteria() throws {
        launch()
        app.buttons["display-list"].tap()
        app.buttons["show-filters"].tap()
        app.buttons["filter-accessible"].tap()
        app.buttons["filter-public"].tap()
        app.buttons["filters-done"].tap()
        let search = app.textFields["restroom-search"]
        let impossibleQuery = "zzzz-no-such-restroom-9876"
        search.tap()
        search.typeText(impossibleQuery)
        _ = confirmInlineNoMatches()
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        capture("15-native-inline-no-matches")
        XCTAssertEqual(search.value as? String, impossibleQuery)
        search.typeText("\n")
        assertNoNoMatchAlert()
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        XCTAssertEqual(search.value as? String, impossibleQuery)
        XCTAssertEqual(app.buttons["show-filters"].label, "Filters, Accessible, Public selected")

        // Empty results never interrupt selection or dismissal of the sheet.
        app.buttons["show-filters"].tap()
        XCTAssertTrue(app.navigationBars["Filters"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Choose any combination.")).count, 0)
        app.buttons["filter-accessible"].tap()
        assertNoNoMatchAlert()
        app.buttons["filters-done"].tap()
        XCTAssertEqual(search.value as? String, impossibleQuery)
        XCTAssertEqual(app.buttons["show-filters"].label, "Filters, Public selected")
        assertNoNoMatchAlert()

        app.buttons["show-filters"].tap()
        let bar = app.navigationBars["Filters"]
        XCTAssertTrue(bar.waitForExistence(timeout: 10))
        app.buttons["filter-accessible"].tap()
        assertNoNoMatchAlert()
        let start = bar.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5))
        start.press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.95)))
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: bar)
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 10), .completed)
        XCTAssertEqual(search.value as? String, impossibleQuery)
        XCTAssertEqual(app.buttons["show-filters"].label, "Filters, Accessible, Public selected")
        assertNoNoMatchAlert()

        search.tap()
        _ = confirmInlineNoMatches()
        app.buttons["clear-search"].tap()
        XCTAssertFalse(app.buttons["clear-search"].exists)
        XCTAssertEqual(app.buttons["show-filters"].label, "Filters, Accessible, Public selected")
        assertNoNoMatchAlert()
        app.buttons["show-filters"].tap()
        app.buttons["filters-reset"].tap()
        app.buttons["filters-done"].tap()
        XCTAssertEqual(app.buttons["show-filters"].label, "Filters, all restrooms")
        assertNoNoMatchAlert()
    }

    /// Requires the reviewed public Peninsula access sidecar and its public-read rules.
    /// This reads real data; it never creates a visit, rating, code, or verification.
    @MainActor
    private func checkStructuredPeninsula(capturePrefix: String) {
        launch()
        app.buttons["show-filters"].tap()
        XCTAssertTrue(app.buttons["filters-reset"].waitForExistence(timeout: 10))
        app.buttons["filters-reset"].tap()
        for identifier in ["filter-accessible", "filter-stairFree", "filter-elevator"] {
            let option = app.buttons[identifier]
            reveal(option)
            option.tap()
            XCTAssertTrue(option.isSelected, identifier)
        }
        capture(capturePrefix + "-filters")
        app.buttons["filters-done"].tap()
        XCTAssertEqual(app.buttons["show-filters"].label, "Filters, Accessible, Stair Free, Elevator access selected")
        let search = app.textFields["restroom-search"]
        search.tap()
        search.typeText("Peninsula")
        let suggestion = app.buttons["search-suggestion-community-7398fe084d3d87eed23c"]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 30))
        suggestion.tap()
        XCTAssertTrue(app.buttons["close-place"].waitForExistence(timeout: 10))
        capture(capturePrefix + "-medium-card")
        assertMainHasNoContributionEditors()
        // Passcodes follows Condition; Rate and Comment stays beside Sources & dates.
        // Each destination retains a full unobscured 44-point target after reveal.
        assertInitialHalfHeightPlaceSheet()
        capture(capturePrefix + "-card-before-reading")
        let hoursSummary = app.descendants(matching: .any).matching(identifier: "place-summary-hours").firstMatch
        revealReadable(hoursSummary, name: "place-summary-hours")
        XCTAssertTrue(hoursSummary.label.contains("24 hours daily"))
        let amenities = app.descendants(matching: .any).matching(identifier: "place-summary-amenities").firstMatch
        revealReadable(amenities, name: "place-summary-amenities")
        for text in ["Elevator", "Accessible", "Stair free"] {
            XCTAssertTrue(amenities.label.contains(text), "Missing compact amenity: \(text)")
        }
        for text in ["right side", "23rd floor", "Penthouse", "Not reported"] {
            XCTAssertFalse(amenities.label.contains(text), "Detailed route should stay under Details: \(text)")
        }
        for identifier in ["place-summary-entry", "place-summary-route-inside"] {
            XCTAssertFalse(app.descendants(matching: .any).matching(identifier: identifier).firstMatch.exists)
        }
        XCTAssertTrue(app.buttons["place-directions"].isHittable)
        capture(capturePrefix + "-card-route")
        assertMainDestinationGroup(capturePrefix: capturePrefix)
        let publicSummary = app.descendants(matching: .any).matching(identifier: "place-current-rating").firstMatch
        revealReadable(publicSummary, name: "place-current-rating")
        let publicRating = publicSummary.label
        openRateAndComment()
        checkRatingDraft(capturePrefix: capturePrefix)
        let publishedComment = app.descendants(matching: .any).matching(identifier: "research-comment-0dca757299328a5c6e99").firstMatch
        revealReadable(publishedComment, name: "Peninsula published comment", maxSwipes: 10)
        XCTAssertFalse(app.staticTexts["Source comments"].exists)
        XCTAssertTrue(app.staticTexts["From Travels with Sophie · Date not shown"].exists)
        capture(capturePrefix + "-inline-published-comment")
        returnToPlace(from: "Rate and Comment")
        revealReadable(publicSummary, name: "place-current-rating")
        XCTAssertEqual(publicSummary.label, publicRating)
        assertMainHasNoContributionEditors()
        assertAISummaryAvailabilityOnMain(capturePrefix: capturePrefix)
        openSourcesAndDates()
        XCTAssertFalse(ratingStars.exists)
        XCTAssertFalse(app.buttons["save-rating"].exists)
        XCTAssertFalse(app.buttons["rate-restroom"].exists)
        assertSourcesHasNoDuplicateDestinations()
        capture(capturePrefix + "-sources-and-dates")
        assertPeninsulaSourceDates(capturePrefix: capturePrefix)
        expandReportedDetails()
        let hours = app.descendants(matching: .any).matching(identifier: "access-restroom-hours").firstMatch
        revealReadable(hours, name: "access-restroom-hours")
        XCTAssertTrue(hours.label.contains("Open 24 hours a day, 7 days a week"))
        for (identifier, text) in [("access-entrance-location", "right side of the main entrance"),
                                   ("access-restroom-floor", "23rd floor"), ("access-stairs-after-entry", "0"),
                                   ("access-elevator-route", "Penthouse")] {
            let fact = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
            revealReadable(fact, name: identifier)
            XCTAssertTrue(fact.label.contains(text), identifier)
            if identifier == "access-stairs-after-entry" {
                XCTAssertEqual(fact.label.components(separatedBy: CharacterSet.decimalDigits.inverted).filter { !$0.isEmpty }, ["0"])
            }
        }
        capture(capturePrefix + "-entry-route")
        XCTAssertTrue(app.buttons["place-directions"].isHittable)
        app.buttons["close-place"].tap()
        XCTAssertEqual(search.value as? String, "Peninsula")
    }

    @MainActor
    private func assertPeninsulaSourceDates(capturePrefix: String) {
        let reported = app.descendants(matching: .any).matching(identifier: "access-reported-date").firstMatch
        revealReadable(reported, name: "access-reported-date", maxSwipes: 10)
        XCTAssertFalse(reported.label.contains("Not reported"))
        let observed = app.descendants(matching: .any).matching(identifier: "access-observed-date").firstMatch
        revealReadable(observed, name: "access-observed-date")
        XCTAssertTrue(observed.label.contains("Not reported"))
        let updated = app.descendants(matching: .any).matching(identifier: "access-updated-date").firstMatch
        revealReadable(updated, name: "access-updated-date")
        XCTAssertFalse(updated.label.contains("Not reported"))
        capture(capturePrefix + "-source-dates")
    }

    /// Exact source facts only; avoids repeating unrelated rating/provider paths.
    @MainActor
    func testPeninsulaSourcesAndDatesRetainsReportedFacts() throws {
        openResearchedPlace("Peninsula", id: "community-7398fe084d3d87eed23c")
        let hoursSummary = app.descendants(matching: .any).matching(identifier: "place-summary-hours").firstMatch
        let loaded = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            hoursSummary.exists && hoursSummary.label.contains("24 hours daily")
        }, object: hoursSummary)
        XCTAssertEqual(XCTWaiter.wait(for: [loaded], timeout: 30), .completed)
        openSourcesAndDates()
        assertSourcesHasNoDuplicateDestinations()
        assertPeninsulaSourceDates(capturePrefix: "39-native-peninsula-sources")
        expandReportedDetails()
        let hours = app.descendants(matching: .any).matching(identifier: "access-restroom-hours").firstMatch
        revealReadable(hours, name: "access-restroom-hours")
        XCTAssertTrue(hours.label.contains("Open 24 hours a day, 7 days a week"))
        for (identifier, text) in [("access-entrance-location", "right side of the main entrance"),
                                   ("access-restroom-floor", "23rd floor"), ("access-stairs-after-entry", "0"),
                                   ("access-elevator-route", "Penthouse")] {
            let fact = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
            revealReadable(fact, name: identifier)
            XCTAssertTrue(fact.label.contains(text), identifier)
            if identifier == "access-stairs-after-entry" {
                XCTAssertEqual(fact.label.components(separatedBy: CharacterSet.decimalDigits.inverted).filter { !$0.isEmpty }, ["0"])
            }
        }
        capture("39-native-peninsula-reported-facts")
        returnToPlace(from: "Sources & dates")
        XCTAssertTrue(app.buttons["place-directions"].isHittable)
        app.buttons["close-place"].tap()
    }

    @MainActor
    func testKnownWeeklyHoursKeepRawScheduleInDetails() throws {
        launch()
        let search = app.textFields["restroom-search"]
        search.tap()
        search.typeText("58th Street Library")
        let suggestion = app.buttons["search-suggestion-i7jb-7jku:row-ahsi-k4c4-scek"]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 15))
        suggestion.tap()
        XCTAssertTrue(app.buttons["close-place"].waitForExistence(timeout: 10))
        let summary = app.descendants(matching: .any).matching(identifier: "place-summary-hours").firstMatch
        revealReadable(summary, name: "place-summary-hours")
        for text in ["Mon–Thu: 10:00 am - 6:00 pm", "Fri–Sat: 10:00 am - 5:00 pm", "Sun: Closed"] {
            XCTAssertTrue(summary.label.contains(text), text)
        }
        assertConditionOverview(readable: false)
        capture("25-native-weekly-hours-card")
        openSourcesAndDates()
        assertSourcesHasNoDuplicateDestinations()
        capture("26-native-weekly-sources-and-dates")
        expandReportedDetails()
        let raw = app.descendants(matching: .any).matching(identifier: "access-restroom-hours").firstMatch
        revealReadable(raw, name: "access-restroom-hours")
        for day in ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] {
            XCTAssertTrue(raw.label.contains(day + ":"), day)
        }
        XCTAssertTrue(raw.label.contains("10:00 am - 6:00 pm"))
        XCTAssertTrue(raw.label.contains("10:00 am - 5:00 pm"))
        capture("27-native-weekly-raw-hours")
        returnToPlace(from: "Sources & dates")
        XCTAssertEqual(search.value as? String, "58th Street Library")
        app.buttons["close-place"].tap()
    }

    @MainActor
    func testStructuredPeninsulaHoursEntranceAndRoute() throws {
        checkStructuredPeninsula(capturePrefix: "17-native-structured-peninsula")
    }

    @MainActor
    private func assertSignInProviderChoices() {
        let apple = app.buttons["apple-sign-in"]
        let google = app.buttons["google-sign-in"]
        XCTAssertTrue(apple.waitForExistence(timeout: 10))
        XCTAssertTrue(google.waitForExistence(timeout: 10))
        XCTAssertTrue(apple.isHittable)
        XCTAssertTrue(google.isHittable)
        XCTAssertTrue(apple.isEnabled)
        XCTAssertTrue(google.isEnabled)
        XCTAssertGreaterThanOrEqual(apple.frame.height, 44)
        XCTAssertGreaterThanOrEqual(google.frame.height, 44)
        XCTAssertEqual(apple.frame.width, google.frame.width, accuracy: 2)
        XCTAssertLessThanOrEqual(apple.frame.maxX, app.frame.maxX)
        XCTAssertLessThanOrEqual(google.frame.maxX, app.frame.maxX)
    }

    @MainActor
    private func cancelSignInChoices() {
        XCTAssertTrue(app.navigationBars["Sign in"].waitForExistence(timeout: 10))
        assertSignInProviderChoices()
        app.buttons["sign-in-cancel"].tap()
        let dismissed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"),
            object: app.navigationBars["Sign in"])
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 10), .completed)
    }

    @MainActor
    private func assertMapAddControl() {
        let add = app.buttons["log-restroom"]
        XCTAssertTrue(add.waitForExistence(timeout: 10))
        XCTAssertTrue(add.isHittable)
        XCTAssertEqual(add.label, "Add a restroom")
        let bounds = add.frame
        XCTAssertGreaterThanOrEqual(bounds.width, 44)
        XCTAssertGreaterThanOrEqual(bounds.height, 44)
        XCTAssertLessThanOrEqual(bounds.width, 56)
        XCTAssertEqual(bounds.width, bounds.height, accuracy: 1)
        XCTAssertTrue(app.frame.contains(bounds))
        XCTAssertEqual(bounds.maxX, app.frame.maxX - 16, accuracy: 1, "Add aligns with the bottom glass bar's trailing inset")
        for identifier in ["show-filters", "display-list", "locate-me", "account"] {
            let control = app.buttons[identifier]
            XCTAssertTrue(control.isHittable, identifier)
            XCTAssertFalse(bounds.intersects(control.frame), identifier)
        }
        XCTAssertFalse(bounds.intersects(app.textFields["restroom-search"].frame))
        XCTAssertLessThanOrEqual(bounds.maxY, app.buttons["locate-me"].frame.minY - 8)
    }

    /// Exercises only anonymous navigation; neither provider nor a contribution is invoked.
    @MainActor
    func testMapAddRestroomCancellationAndSimplifiedAccount() throws {
        launch()
        assertMapAddControl()
        capture("23-native-circular-map-add")
        app.buttons["log-restroom"].tap()
        XCTAssertTrue(app.navigationBars["Account"].waitForExistence(timeout: 10))
        assertSignInProviderChoices()
        XCTAssertFalse(app.navigationBars["Add restroom"].exists)
        XCTAssertFalse(app.buttons["log-restroom"].exists)
        app.navigationBars["Account"].buttons["Done"].tap()
        assertMapAddControl()
        XCTAssertFalse(app.navigationBars["Add restroom"].exists)

        // Returning through Account must not resume the canceled Add intent.
        app.buttons["account"].tap()
        XCTAssertTrue(app.navigationBars["Account"].waitForExistence(timeout: 10))
        app.navigationBars["Account"].buttons["Done"].tap()
        assertMapAddControl()
        XCTAssertFalse(app.navigationBars["Add restroom"].exists)

        let search = app.textFields["restroom-search"]
        search.tap()
        search.typeText("park")
        XCTAssertFalse(app.buttons["log-restroom"].exists)
        app.buttons["clear-search"].tap()
        assertMapAddControl()
        app.buttons["display-list"].tap()
        XCTAssertTrue(app.buttons["display-map"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["log-restroom"].exists)
        app.buttons["display-map"].tap()
        assertMapAddControl()

        app.buttons["account"].tap()
        XCTAssertTrue(app.navigationBars["Account"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Your library"].exists)
        XCTAssertFalse(app.buttons["Refresh library"].exists)
        XCTAssertFalse(app.buttons["log-restroom"].exists)
        XCTAssertFalse(app.buttons["Add a restroom"].exists)
        assertAnonymousAccountLayout()
        capture("24-native-simplified-account")
        app.navigationBars["Account"].buttons["Done"].tap()
        assertMapAddControl()
        XCTAssertFalse(app.navigationBars["Add restroom"].exists)
    }

    @MainActor
    private func assertAnonymousAccountLayout(capturePrefix: String? = nil) {
        XCTAssertFalse(app.buttons["account-comments"].exists)
        XCTAssertTrue(app.navigationBars["Account"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Browse without an account."].exists)
        XCTAssertFalse(app.buttons["account-saved"].exists)
        XCTAssertFalse(app.buttons["account-sign-out"].exists)
        XCTAssertFalse(app.buttons["account-delete"].exists)
        XCTAssertFalse(app.staticTexts["Your library"].exists)
        XCTAssertFalse(app.buttons["Refresh library"].exists)
        XCTAssertFalse(app.buttons["log-restroom"].exists)
        for identifier in ["apple-sign-in", "google-sign-in"] {
            let provider = app.buttons[identifier]
            reveal(provider)
            XCTAssertGreaterThanOrEqual(provider.frame.height, 44, identifier)
            XCTAssertGreaterThanOrEqual(provider.frame.minY, unobscuredContentViewport().minY, identifier)
            XCTAssertLessThanOrEqual(provider.frame.maxY, unobscuredContentViewport().maxY - 4, identifier)
        }
        assertSignInProviderChoices()
        if let capturePrefix { capture(capturePrefix + "-providers") }

        let privacy = app.descendants(matching: .any).matching(identifier: "account-privacy").firstMatch
        let dated = app.staticTexts["account-dated-information"]
        // Signed-out content has no spacer: the footer follows the provider card.
        // Accessibility text still reveals each control and the full notice separately.
        if !app.launchArguments.contains("UICTContentSizeCategoryAccessibilityXXXL") {
            XCTAssertTrue(privacy.waitForExistence(timeout: 10))
            for identifier in ["apple-sign-in", "google-sign-in"] {
                XCTAssertLessThanOrEqual(app.buttons[identifier].frame.maxY, privacy.frame.minY, identifier)
            }
            XCTAssertLessThanOrEqual(privacy.frame.minY - app.buttons["google-sign-in"].frame.maxY, 60,
                "The footer follows the provider card without a large empty gap")
            XCTAssertGreaterThan(app.navigationBars["Account"].frame.minY, app.frame.midY - 64,
                "Normal-text Account uses a compact sheet, allowing for navigation and typography")
        }
        reveal(privacy)
        XCTAssertEqual(privacy.label, "Privacy and data use")
        XCTAssertTrue(privacy.isHittable)
        XCTAssertGreaterThanOrEqual(privacy.frame.height, 44)
        XCTAssertTrue(app.frame.contains(privacy.frame))
        if let capturePrefix { capture(capturePrefix + "-privacy-link") }
        reveal(dated)
        XCTAssertEqual(dated.label, "Listings and visitor reports are dated information. Entry, codes and conditions can change.")
        XCTAssertTrue(app.frame.contains(dated.frame))
        XCTAssertLessThanOrEqual(privacy.frame.maxY, dated.frame.minY)
        let done = app.navigationBars["Account"].buttons["Done"]
        XCTAssertTrue(done.isHittable)
        XCTAssertEqual(app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", "Open web finder")).count, 0)
        XCTAssertFalse(app.alerts["Delete your account?"].exists)
    }

    @MainActor
    private func checkAnonymousAccountPrivacy(capturePrefix: String) {
        launch()
        app.buttons["account"].tap()
        assertAnonymousAccountLayout(capturePrefix: capturePrefix)
        capture(capturePrefix)
        // Read the footer without opening its web destination or invoking a provider.
        app.navigationBars["Account"].buttons["Done"].tap()
        XCTAssertTrue(app.buttons["account"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["account"].isHittable)
        XCTAssertFalse(app.navigationBars["Sign in"].exists)
        XCTAssertFalse(app.alerts["Delete your account?"].exists)
    }

    /// Account management stays unavailable anonymously; this never authenticates or deletes data.
    @MainActor
    func testAnonymousAccountPrivacyAndDeletionBoundary() throws {
        checkAnonymousAccountPrivacy(capturePrefix: "22-native-account-privacy-and-anonymous-boundary")
    }

    @MainActor
    func testZAnonymousAccountPrivacyAccessibilityTextLayout() throws {
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        checkAnonymousAccountPrivacy(capturePrefix: "22-native-account-privacy-accessibility")
    }

    /// Checks the choice screen and cancellation only; no provider is invoked and no data is written.
    @MainActor
    func testAppleAndGoogleChoicesFromAccountAndPlaceActions() throws {
        launch()
        app.buttons["account"].tap()
        XCTAssertTrue(app.navigationBars["Account"].waitForExistence(timeout: 10))
        assertAnonymousAccountLayout()
        capture("19-native-account-sign-in-providers")
        XCTAssertFalse(app.buttons["log-restroom"].exists)
        app.navigationBars["Account"].buttons["Done"].tap()
        let add = app.buttons["log-restroom"]
        XCTAssertTrue(add.waitForExistence(timeout: 10))
        XCTAssertTrue(add.isHittable)
        add.tap()
        // Map Add presents the same Account choices without starting a provider automatically.
        XCTAssertTrue(app.navigationBars["Account"].waitForExistence(timeout: 10))
        assertSignInProviderChoices()
        app.navigationBars["Account"].buttons["Done"].tap()
        XCTAssertTrue(app.buttons["account"].waitForExistence(timeout: 10))

        let search = app.textFields["restroom-search"]
        search.tap()
        search.typeText("100% Playground")
        let suggestion = app.buttons["search-suggestion-i7jb-7jku:row-pu48.fixg-qdtc"]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 15))
        suggestion.tap()
        XCTAssertTrue(app.buttons["place-save"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons["place-save"].value as? String, "Not saved")
        app.buttons["place-save"].tap()
        XCTAssertTrue(app.navigationBars["Sign in"].waitForExistence(timeout: 10))
        capture("20-native-save-sign-in-providers")
        cancelSignInChoices()
        XCTAssertTrue(app.buttons["place-save"].isHittable)
        XCTAssertEqual(app.buttons["place-save"].value as? String, "Not saved")

        assertInitialHalfHeightPlaceSheet()
        assertMainHasNoContributionEditors()
        assertMainDestinationGroup(capturePrefix: "21-native-rating")
        openRateAndComment()
        checkRatingDraft(capturePrefix: "21-native-rating")
        XCTAssertFalse(app.buttons["Add private note"].exists)
        XCTAssertFalse(app.staticTexts["Private visit notes"].exists)
        XCTAssertFalse(app.buttons["add-visit-details"].exists)
        XCTAssertFalse(app.buttons["Add a note or comment"].exists)
        XCTAssertFalse(app.buttons["Report visit details"].exists)
        let share = app.buttons["add-public-note"]
        reveal(share)
        XCTAssertEqual(share.label, "Add a public note")
        XCTAssertGreaterThanOrEqual(share.frame.height, 44)
        share.tap()
        XCTAssertTrue(app.navigationBars["Sign in"].waitForExistence(timeout: 10))
        cancelSignInChoices()
        XCTAssertTrue(app.navigationBars["Rate and Comment"].exists)
        XCTAssertFalse(app.navigationBars["Add a public note"].exists)
        capture("28-native-unified-visit-sign-in-cancel")
        returnToPlace(from: "Rate and Comment")
        assertMainHasNoContributionEditors()
        assertAISummaryAvailabilityOnMain(capturePrefix: "21-native-rating")
        openSourcesAndDates()
        XCTAssertFalse(app.buttons["save-rating"].exists)
        XCTAssertFalse(app.buttons["rate-restroom"].exists)
        XCTAssertFalse(ratingStars.exists)
        XCTAssertFalse(app.buttons["add-public-note"].exists)
        assertSourcesHasNoDuplicateDestinations()
        capture("29-native-readonly-sources-and-dates")
        app.buttons["close-place"].tap()
        XCTAssertEqual(search.value as? String, "100% Playground")
    }

    @MainActor
    func testZStructuredPeninsulaAccessibilityTextLayout() throws {
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        checkStructuredPeninsula(capturePrefix: "18-native-structured-peninsula-accessibility")
    }

    @MainActor
    private func revealCodeSearchTarget(_ target: XCUIElement, capturePrefix: String) {
        let suggestions = app.scrollViews["search-suggestions"]
        XCTAssertTrue(suggestions.waitForExistence(timeout: 30))
        // At the largest Dynamic Type size, one broad-query result fills the
        // lazy dropdown. Scroll that real list to the same expected stable ID.
        for attempt in 0...24 {
            if target.exists {
                let visible = target.frame.intersection(suggestions.frame)
                if target.isHittable && !visible.isNull && visible.height >= 44 {
                    capture(capturePrefix + "-search-target")
                    return
                }
            }
            if attempt < 24 { suggestions.swipeUp() }
        }
        XCTFail("Expected the exact code-history venue in the scrollable search suggestions")
    }

    @MainActor
    private func checkPublicCodeHistory(capturePrefix: String) {
        launch()
        let search = app.textFields["restroom-search"]
        search.tap(); search.typeText("Whole Foods Market")
        let suggestion = app.buttons["search-suggestion-community-66ea1a33929286315e13"]
        revealCodeSearchTarget(suggestion, capturePrefix: capturePrefix)
        XCTAssertTrue(suggestion.exists)
        XCTAssertTrue(suggestion.isHittable)
        suggestion.tap()
        XCTAssertTrue(app.buttons["close-place"].waitForExistence(timeout: 10))
        capture(capturePrefix + "-medium")
        assertInitialHalfHeightPlaceSheet()
        assertMainHasNoContributionEditors()
        assertMainDestinationGroup(capturePrefix: capturePrefix)
        let codes = app.buttons["place-passcodes"]
        reveal(codes)
        let mainLabel = codes.label
        codes.tap()
        XCTAssertTrue(app.navigationBars["Passcodes"].waitForExistence(timeout: 10))
        capture(capturePrefix + "-passcodes-initial")
        let identifiers = app.buttons.allElementsBoundByIndex.map(\.identifier).filter { identifier in
            ["place-", "code-", "public-code-card-", "report-new-code", "close-place"].contains { identifier.hasPrefix($0) }
        }
        let diagnostic = XCTAttachment(string: "Passcodes navigation: \(app.navigationBars["Passcodes"].exists)\nAction identifiers:\n" + identifiers.sorted().joined(separator: "\n"))
        diagnostic.name = capturePrefix + "-navigation-identifiers"
        diagnostic.lifetime = .keepAlways
        add(diagnostic)
        let used = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "code-used-"))
        XCTAssertTrue(used.firstMatch.waitForExistence(timeout: 30))
        XCTAssertGreaterThanOrEqual(used.count, 3)
        let invalid = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "code-invalid-"))
        XCTAssertEqual(invalid.count, used.count)
        let codeLabels = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Restroom code: "))
        XCTAssertGreaterThanOrEqual(codeLabels.count, 3)
        // Read actual public reports without copying their values into test logs.
        let values = codeLabels.allElementsBoundByIndex.map { element -> String in
            let spaced = String(element.label.dropFirst("Restroom code: ".count))
            return String(spaced.enumerated().compactMap { $0.offset.isMultiple(of: 2) ? $0.element : nil })
        }
        guard let newest = values.first, !newest.isEmpty else { XCTFail("Expected a readable public code"); return }
        XCTAssertTrue(mainLabel.contains(newest))
        for older in values.dropFirst() where older != newest && !newest.contains(older) {
            XCTAssertFalse(mainLabel.contains(older))
        }
        for (action, identifier, confirmation) in [(used.firstMatch, "used", "Yes, it worked"),
                                                   (invalid.firstMatch, "invalid", "Yes, it didn’t work")] {
            reveal(action)
            XCTAssertTrue(action.isHittable)
            XCTAssertGreaterThanOrEqual(action.frame.height, 44)
            XCTAssertLessThanOrEqual(action.frame.maxY, app.buttons["place-directions"].frame.minY - 4)
            capture(capturePrefix + "-" + identifier + "-target")
            action.tap()
            XCTAssertTrue(app.navigationBars["Sign in"].waitForExistence(timeout: 10))
            assertSignInProviderChoices()
            cancelSignInChoices()
            XCTAssertTrue(app.navigationBars["Passcodes"].exists)
            XCTAssertFalse(app.buttons[confirmation].exists)
            XCTAssertTrue(action.isEnabled)
        }
        let report = app.buttons["report-new-code"]
        reveal(report)
        XCTAssertGreaterThanOrEqual(report.frame.height, 44)
        XCTAssertLessThanOrEqual(report.frame.maxY, app.buttons["place-directions"].frame.minY - 4)
        capture(capturePrefix + "-report-new-code")
        report.tap()
        XCTAssertTrue(app.navigationBars["Sign in"].waitForExistence(timeout: 10))
        cancelSignInChoices()
        XCTAssertTrue(app.navigationBars["Passcodes"].exists)
        XCTAssertFalse(app.navigationBars["Report a new code"].exists)
        XCTAssertFalse(app.textFields["new-code-value"].exists)
        XCTAssertFalse(app.buttons["save-code-report"].exists)
        capture(capturePrefix + "-provider-cancel")
        returnToPlace(from: "Passcodes")
        XCTAssertTrue(app.buttons["place-directions"].isHittable)
        app.buttons["close-place"].tap()
        XCTAssertEqual(search.value as? String, "Whole Foods Market")
    }

    @MainActor
    func testPublicCodeHistoryAndProtectedFeedback() throws {
        checkPublicCodeHistory(capturePrefix: "30-native-public-codes")
    }

    @MainActor
    func testZPublicCodeHistoryAccessibilityTextLayout() throws {
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        checkPublicCodeHistory(capturePrefix: "31-native-public-codes-accessibility")
    }

    @MainActor
    private func openResearchedPlace(_ query: String, id: String) {
        launch()
        let search = app.textFields["restroom-search"]
        search.tap(); search.typeText(query)
        let target = app.buttons["search-suggestion-" + id]
        revealCodeSearchTarget(target, capturePrefix: "34-native-research")
        target.tap()
        XCTAssertTrue(app.buttons["close-place"].waitForExistence(timeout: 10))
        assertInitialHalfHeightPlaceSheet()
        assertMainHasNoContributionEditors()
    }

    @MainActor
    private func checkParksResearch(capturePrefix: String) {
        openResearchedPlace("St Nicholas", id: "i7jb-7jku:row-23tw-52x4~fjrq")
        resizePlaceSheet(expanded: true)
        let condition = app.descendants(matching: .any).matching(identifier: "place-summary-condition").firstMatch
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            condition.exists && condition.label.contains("Inspected Jul 27, 2026")
        }, object: condition)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed)
        revealReadable(condition, name: "Dated Parks condition")
        XCTAssertTrue(condition.label.contains("Men’s room: Acceptable"))
        XCTAssertTrue(condition.label.contains("Women’s room: Acceptable"))
        XCTAssertTrue(condition.label.contains("3 issues reported"))
        XCTAssertFalse(condition.label.contains("2026-10-24"), "Retrieval is not the inspection date")
        capture(capturePrefix + "-dated-condition")
        tapVisibleReadingRow(condition)
        let issues = app.buttons["Reported issues (3)"]
        reveal(issues); XCTAssertGreaterThanOrEqual(issues.frame.height, 44); issues.tap()
        let sink = app.descendants(matching: .any).matching(identifier: "research-fact-958cc58614ea65c5b5c5").firstMatch
        revealReadable(sink, name: "Exact room inspection issue", maxSwipes: 16)
        XCTAssertTrue(app.staticTexts["Condition: Sinks OOS"].exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Extent: 1; Count: 1")).firstMatch.exists)
        capture(capturePrefix + "-room-issue")
        revealReadable(condition, name: "Dated Parks condition", maxSwipes: 16)
        tapVisibleReadingRow(condition)
        let amenities = app.descendants(matching: .any).matching(identifier: "place-summary-amenities").firstMatch
        revealReadable(amenities, name: "Amenities")
        XCTAssertTrue(amenities.label.contains("Changing stations"))
        tapVisibleReadingRow(amenities)
        let problem = app.buttons["report-amenity-problem"]
        reveal(problem)
        XCTAssertGreaterThanOrEqual(problem.frame.height, 44)
        openSourcesAndDates()
        let fixtures = app.buttons["Fixture inventory (17)"]
        reveal(fixtures, maxSwipes: 12); XCTAssertGreaterThanOrEqual(fixtures.frame.height, 44); fixtures.tap()
        let zero = app.descendants(matching: .any).matching(identifier: "research-fact-0afbf512eff34c25b254").firstMatch
        revealReadable(zero, name: "Zero fixture count", maxSwipes: 10)
        XCTAssertTrue(app.staticTexts["Paper towel dispensers"].exists)
        XCTAssertTrue(app.staticTexts["Men’s room: 0"].exists)
        capture(capturePrefix + "-fixture-count")
        XCTAssertTrue(app.buttons["place-directions"].isHittable)
        XCTAssertTrue(app.buttons["close-place"].isHittable)
    }

    @MainActor
    func testDatedParksResearchInsideMainCard() throws {
        checkParksResearch(capturePrefix: "34-native-research-parks")
    }

    @MainActor
    private func resizePlaceSheet(expanded: Bool) {
        let close = app.buttons["close-place"]
        XCTAssertTrue(close.waitForExistence(timeout: 10))
        // Use the actual system grabber. At large text the navigation bar's
        // blank centre does not reliably forward pans to the presentation.
        let grabber = app.buttons["Sheet Grabber"]
        XCTAssertTrue(grabber.waitForExistence(timeout: 5))
        let origin = app.coordinate(withNormalizedOffset: .zero)
        let start = grabber.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let endY = expanded ? app.frame.minY + 90 : app.frame.midY + 58
        start.press(forDuration: 0.1, thenDragTo:
            origin.withOffset(CGVector(dx: app.frame.midX, dy: endY)))
        if expanded {
            let resized = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                close.exists && close.frame.minY < self.app.frame.minY + self.app.frame.height * 0.25
            }, object: close)
            XCTAssertEqual(XCTWaiter.wait(for: [resized], timeout: 10), .completed)
            XCTAssertTrue(app.buttons["place-directions"].isHittable)
            XCTAssertGreaterThanOrEqual(app.buttons["place-directions"].frame.height, 44)
        } else {
            assertInitialHalfHeightPlaceSheet()
        }
    }

    @MainActor
    private func checkPlaceSheetExpansion(capturePrefix: String) {
        openResearchedPlace("Peninsula", id: "community-7398fe084d3d87eed23c")
        let firstTop = app.buttons["close-place"].frame.minY
        capture(capturePrefix + "-half-search")
        resizePlaceSheet(expanded: true)
        capture(capturePrefix + "-expanded-search")
        openSourcesAndDates()
        expandReportedDetails()
        let entrance = app.descendants(matching: .any).matching(identifier: "access-entrance-location").firstMatch
        revealReadable(entrance, name: "Expanded entrance route", maxSwipes: 16)
        XCTAssertTrue(entrance.label.contains("right side of the main entrance"))
        XCTAssertLessThan(app.buttons["close-place"].frame.minY, app.frame.minY + app.frame.height * 0.25)
        returnToPlace(from: "Sources & dates")
        let rate = app.buttons["place-rate-comment"]
        reveal(rate); rate.tap()
        XCTAssertTrue(app.navigationBars["Rate and Comment"].waitForExistence(timeout: 10))
        let publicNote = app.buttons["add-public-note"]
        reveal(publicNote, maxSwipes: 12)
        XCTAssertGreaterThanOrEqual(publicNote.frame.height, 44)
        publicNote.tap()
        XCTAssertTrue(app.navigationBars["Sign in"].waitForExistence(timeout: 10))
        assertSignInProviderChoices()
        cancelSignInChoices()
        XCTAssertTrue(app.navigationBars["Rate and Comment"].exists)
        XCTAssertLessThan(app.buttons["close-place"].frame.minY, app.frame.minY + app.frame.height * 0.25)
        returnToPlace(from: "Rate and Comment")
        resizePlaceSheet(expanded: false)
        XCTAssertEqual(app.buttons["close-place"].frame.minY, firstTop, accuracy: 12)
        capture(capturePrefix + "-collapsed")
        resizePlaceSheet(expanded: true)
        app.buttons["close-place"].tap()
        let list = app.buttons["display-list"]
        XCTAssertTrue(list.waitForExistence(timeout: 10)); list.tap()
        let row = app.buttons["place-community-7398fe084d3d87eed23c"]
        XCTAssertTrue(row.waitForExistence(timeout: 10)); row.tap()
        assertInitialHalfHeightPlaceSheet()
        XCTAssertEqual(app.buttons["close-place"].frame.minY, firstTop, accuracy: 12)
        capture(capturePrefix + "-half-list-reopen")
        resizePlaceSheet(expanded: true)
        capture(capturePrefix + "-expanded-list")
    }

    @MainActor
    func testRestroomSearchAndListOpenAtSameHalfHeight() throws {
        checkPlaceSheetExpansion(capturePrefix: "38-native-resizable-card")
    }

    @MainActor
    private func checkMapPinReplacementStartsHalfHeight(capturePrefix: String, analyticsOptIn: Bool = false) {
        app.launchArguments += ["-review-map-pins"]
        launch()
        if analyticsOptIn { setAnalyticsConsentThroughAccount(true) }
        // Fit the real two-place search results after MKMapView has laid out;
        // a launch-time camera request can precede its first nonzero bounds.
        let search = app.textFields["restroom-search"]
        search.tap(); search.typeText("\n")
        let parkID = "i7jb-7jku:row-cunh~tmjb_ktcf"
        let libraryID = "i7jb-7jku:row-tmt8_zzvc_8g8v"
        func tapPin(_ id: String, name: String, behindCard: Bool) {
            // MapKit may keep invisible individual annotation AX entries while
            // rendering their cluster. Use the real cluster's existing zoom
            // action before targeting its exposed individual pins.
            let cluster = app.buttons["review-map-cluster"].firstMatch
            if cluster.waitForExistence(timeout: 3), cluster.isHittable {
                capture(capturePrefix + "-cluster-before-zoom")
                let frame = cluster.frame
                app.coordinate(withNormalizedOffset: .zero)
                    .withOffset(CGVector(dx: frame.midX, dy: frame.midY)).tap()
            }
            let pin = app.buttons["review-map-pin-" + id]
            var lastFrame = CGRect.null
            var stableSamples = 0
            var samples: [String] = []
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                guard pin.exists else { samples.append("absent"); return false }
                let frame = pin.frame
                samples.append("frame=\(frame); hit=\(pin.isHittable)")
                guard pin.isHittable, frame.height >= 44,
                      frame.minY > self.app.textFields["restroom-search"].frame.maxY + 12 else { return false }
                guard !behindCard || frame.maxY < self.app.buttons["close-place"].frame.minY - 12 else { return false }
                if abs(frame.midX - lastFrame.midX) < 2 && abs(frame.midY - lastFrame.midY) < 2 { stableSamples += 1 }
                else { stableSamples = 0 }
                lastFrame = frame
                return stableSamples >= 2
            }, object: pin)
            let readyResult = XCTWaiter.wait(for: [ready], timeout: 15)
            capture(capturePrefix + "-settled-map")
            let diagnostic = XCTAttachment(string: samples.suffix(8).joined(separator: "\n"))
            diagnostic.name = capturePrefix + "-pin-frames"; diagnostic.lifetime = .keepAlways; add(diagnostic)
            XCTAssertEqual(readyResult, .completed)
            // This is the real MKAnnotationView: MapKit didSelect drives the
            // same shared selection action as a physical map tap.
            capture(capturePrefix + "-before-pin-" + (behindCard ? "replacement" : "open"))
            let frame = pin.frame
            app.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: frame.midX, dy: frame.midY)).tap()
            XCTAssertTrue(app.staticTexts[name].waitForExistence(timeout: 10))
            assertInitialHalfHeightPlaceSheet()
        }
        tapPin(parkID, name: "Bryant Park", behindCard: false)
        let initialTop = app.buttons["close-place"].frame.minY
        capture(capturePrefix + "-first-pin-half")
        tapPin(libraryID, name: "Starvos Niarchos Foundation Library, NYPL", behindCard: true)
        XCTAssertEqual(app.buttons["close-place"].frame.minY, initialTop, accuracy: 12)
        capture(capturePrefix + "-second-pin-half")
        resizePlaceSheet(expanded: true)
        capture(capturePrefix + "-second-pin-expanded")
        // Nested navigation does not restart this place presentation.
        openSourcesAndDates()
        returnToPlace(from: "Sources & dates")
        XCTAssertLessThan(app.buttons["close-place"].frame.minY, app.frame.minY + app.frame.height * 0.25)
        app.buttons["close-place"].tap()
        XCTAssertFalse(app.buttons["close-place"].exists)
        tapPin(libraryID, name: "Starvos Niarchos Foundation Library, NYPL", behindCard: false)
        XCTAssertEqual(app.buttons["close-place"].frame.minY, initialTop, accuracy: 12)
        capture(capturePrefix + "-reopen-after-large-half")
        resizePlaceSheet(expanded: true)
        capture(capturePrefix + "-reopen-expanded")
    }

    @MainActor
    func testMapPinReplacementAndReopenStartAtHalfHeight() throws {
        checkMapPinReplacementStartsHalfHeight(capturePrefix: "46-native-map-selection")
    }

    @MainActor
    func testZMapPinReplacementAccessibilityTextLayout() throws {
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        checkMapPinReplacementStartsHalfHeight(capturePrefix: "47-native-map-selection-large")
    }

    @MainActor
    private func captureCompactSummaryRows(capturePrefix: String) {
        openResearchedPlace("58th Street Library", id: "i7jb-7jku:row-ahsi-k4c4-scek")
        resizePlaceSheet(expanded: true)
        for title in ["hours", "amenities", "condition"] {
            let row = app.descendants(matching: .any).matching(identifier: "place-summary-" + title).firstMatch
            // Require the entire value and detail above the fixed Directions
            // footer, not merely the first readable label of a tall row.
            reveal(row, maxSwipes: 12)
            XCTAssertLessThanOrEqual(row.frame.maxY, app.buttons["place-directions"].frame.minY - 4)
            capture(capturePrefix + "-" + title)
        }
    }

    @MainActor
    func testCompactCardMainSummaryAlignment() throws {
        captureCompactSummaryRows(capturePrefix: "48-native-main-summary")
    }

    @MainActor
    func testZCompactCardMainSummaryAccessibilityTextLayout() throws {
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        captureCompactSummaryRows(capturePrefix: "49-native-main-summary-large")
    }

    @MainActor
    private func checkTodayHoursAndExpandedWeek(capturePrefix: String) {
        openResearchedPlace("58th Street Library", id: "i7jb-7jku:row-ahsi-k4c4-scek")
        // Use the card's real native pull-up affordance before reading the
        // longer schedule, including when large text puts Hours below the fold.
        resizePlaceSheet(expanded: true)
        let hours = app.descendants(matching: .any).matching(identifier: "place-summary-hours").firstMatch
        revealReadable(hours, name: "Today's reported hours")
        XCTAssertTrue(hours.label.contains("Today:"))
        for day in ["Monday:", "Tuesday:", "Wednesday:", "Thursday:", "Friday:", "Saturday:", "Sunday:"] {
            XCTAssertFalse(hours.label.contains(day), "The collapsed Hours row must not contain the weekly schedule")
        }
        capture(capturePrefix + "-today")
        tapVisibleReadingRow(hours)
        let expected = [("Monday", "10:00 am - 6:00 pm"), ("Tuesday", "10:00 am - 6:00 pm"),
            ("Wednesday", "10:00 am - 6:00 pm"), ("Thursday", "10:00 am - 6:00 pm"),
            ("Friday", "10:00 am - 5:00 pm"), ("Saturday", "10:00 am - 5:00 pm"), ("Sunday", "Closed")]
        for (index, day) in expected.enumerated() {
            let row = app.staticTexts["hours-day-" + String(index)]
            revealReadable(row, name: day.0 + "'s reported hours", maxSwipes: 16)
            reveal(row, maxSwipes: 16)
            XCTAssertEqual(row.label, day.0 + ": " + day.1)
            let visible = row.frame.intersection(unobscuredContentViewport())
            XCTAssertGreaterThanOrEqual(visible.height, row.frame.height - 0.5, day.0 + " must be fully readable")
            if [0, 3, 6].contains(index) { capture(capturePrefix + "-full-week-" + String(index)) }
        }
        XCTAssertTrue(app.buttons["place-directions"].isHittable)
        XCTAssertTrue(app.buttons["close-place"].isHittable)
        let originalID = "research-fact-90efd293145c277e4cad"
        XCTAssertFalse(app.buttons[originalID].exists, "Hours must not repeat the original complete weekly block")
        let reference = app.buttons["hours-source-90efd293145c277e4cad"]
        XCTAssertTrue(reference.waitForExistence(timeout: 30))
        reveal(reference, maxSwipes: 16)
        XCTAssertTrue(reference.label.contains("NYC Open Data"))
        XCTAssertGreaterThanOrEqual(reference.frame.height, 44)
        capture(capturePrefix + "-source-reference")
        openSourcesAndDates()
        let original = app.buttons[originalID]
        revealReadable(original, name: "Original hours source evidence", maxSwipes: 16)
        XCTAssertTrue(original.label.contains("Sunday: Closed"))
        XCTAssertTrue(original.label.contains("Monday: 10:00 am - 6:00 pm"))
        capture(capturePrefix + "-original-source")
    }

    @MainActor
    func testTodayHoursAndExpandableWeeklySchedule() throws {
        checkTodayHoursAndExpandedWeek(capturePrefix: "42-native-today-hours")
    }

    @MainActor
    func testZTodayHoursAccessibilityTextLayout() throws {
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        checkTodayHoursAndExpandedWeek(capturePrefix: "43-native-today-hours-accessibility")
    }

    @MainActor
    func testZRestroomSheetExpansionAccessibilityTextLayout() throws {
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        checkPlaceSheetExpansion(capturePrefix: "39-native-resizable-card-accessibility")
    }

    @MainActor
    private func checkReviewedAccessibleAmenities(capturePrefix: String) {
        launch()
        app.buttons["show-filters"].tap()
        XCTAssertTrue(app.buttons["filters-reset"].waitForExistence(timeout: 10))
        app.buttons["filters-reset"].tap()
        app.buttons["filter-accessible"].tap()
        app.buttons["filters-done"].tap()
        XCTAssertEqual(app.buttons["show-filters"].label, "Filters, Accessible selected")
        let search = app.textFields["restroom-search"]
        search.tap(); search.typeText("Morgan Library")
        let target = app.buttons["search-suggestion-community-82d3c2a31534b1f5fcfd"]
        // The filter must match before the selected place's live research loads.
        revealCodeSearchTarget(target, capturePrefix: capturePrefix)
        target.tap()
        assertInitialHalfHeightPlaceSheet()
        resizePlaceSheet(expanded: true)
        let amenities = app.descendants(matching: .any).matching(identifier: "place-summary-amenities").firstMatch
        revealReadable(amenities, name: "Reviewed accessibility amenity")
        XCTAssertTrue(amenities.label.contains("Accessible"))
        for prose in ["Operator says", "Building:", "From Morgan", "Date not shown", "Listing + source details"] {
            XCTAssertFalse(amenities.label.contains(prose), prose)
        }
        tapVisibleReadingRow(amenities)
        let problem = app.buttons["report-amenity-problem"]
        reveal(problem)
        XCTAssertGreaterThanOrEqual(problem.frame.height, 44)
        capture(capturePrefix + "-amenities")
        problem.tap()
        XCTAssertTrue(app.navigationBars["Sign in"].waitForExistence(timeout: 10))
        assertSignInProviderChoices()
        cancelSignInChoices()
        XCTAssertTrue(app.buttons["close-place"].isHittable)
        XCTAssertLessThan(app.buttons["close-place"].frame.minY, app.frame.minY + app.frame.height * 0.25)
        openSourcesAndDates()
        let source = app.staticTexts.matching(NSPredicate(format: "label == %@", "Operator says the Museum and its programs are wheelchair accessible")).firstMatch
        revealReadable(source, name: "Original Morgan accessibility evidence", maxSwipes: 16)
        capture(capturePrefix + "-original-source")
    }

    @MainActor
    func testReviewedAccessibleAmenitiesMatchFilter() throws {
        checkReviewedAccessibleAmenities(capturePrefix: "40-native-accessible-amenities")
    }

    @MainActor
    func testRoomSpecificChangingStationUsesShortAmenity() throws {
        openResearchedPlace("Claremont", id: "i7jb-7jku:row-ngvw_4mc5.tcmy")
        resizePlaceSheet(expanded: true)
        let amenities = app.descendants(matching: .any).matching(identifier: "place-summary-amenities").firstMatch
        revealReadable(amenities, name: "Room-specific changing station")
        XCTAssertTrue(amenities.label.contains("Changing stations"))
        XCTAssertFalse(amenities.label.contains("restroom only"))
        XCTAssertFalse(amenities.label.contains("From "))
        capture("42-native-room-specific-short-amenity")
    }

    @MainActor
    func testZReviewedAccessibleAmenitiesAccessibilityTextLayout() throws {
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        checkReviewedAccessibleAmenities(capturePrefix: "41-native-accessible-amenities-accessibility")
    }

    @MainActor
    func testZDatedParksResearchAccessibilityTextLayout() throws {
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        checkParksResearch(capturePrefix: "35-native-research-parks-accessibility")
    }

    @MainActor
    func testPublishedClosureOverridesOlderOperationalListing() throws {
        openResearchedPlace("Canarsie Library", id: "i7jb-7jku:row-8bhn.bnzq~2ihw")
        let condition = app.descendants(matching: .any).matching(identifier: "place-summary-condition").firstMatch
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            condition.exists && condition.label.contains("closed for renovations")
        }, object: condition)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed)
        revealReadable(condition, name: "Library closure warning")
        XCTAssertTrue(condition.label.contains("Closure reported:"))
        XCTAssertTrue(condition.label.contains("From BPL · Date not shown"))
        XCTAssertFalse(condition.label.contains("Listed Operational"))
        capture("36-native-research-library-closure")
    }

    @MainActor
    func testPublishedHistoricalCodeStaysUnverifiedAndOutsideFeedback() throws {
        openResearchedPlace("Pret A Manger", id: "community-55ac3597b30585801aaf")
        let codes = app.buttons["place-passcodes"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in codes.exists && codes.label.contains("0225") }, object: codes)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 30), .completed)
        let hours = app.descendants(matching: .any).matching(identifier: "place-summary-hours").firstMatch
        revealReadable(hours, name: "Explicit unknown hours")
        XCTAssertTrue(hours.label.contains("Hours unknown"))
        reveal(codes)
        XCTAssertFalse(codes.label.contains("No known passcode"))
        codes.tap()
        XCTAssertTrue(app.navigationBars["Passcodes"].waitForExistence(timeout: 10))
        let source = app.descendants(matching: .any).matching(identifier: "research-fact-dfe8a6bfc81e8ae479d2").firstMatch
        revealReadable(source, name: "Historical code source")
        XCTAssertTrue(app.staticTexts["0225"].exists)
        XCTAssertTrue(app.staticTexts["From FACILITY · Date not shown"].exists)
        // A matching pre-existing code report may retain its real controls.
        // The source fact itself must not acquire a vote or ownership identity.
        XCTAssertFalse(app.buttons["code-used-v2_dfe8a6bfc81e8ae479d2"].exists)
        XCTAssertFalse(app.buttons["code-invalid-v2_dfe8a6bfc81e8ae479d2"].exists)
        XCTAssertFalse(app.buttons["code-used-legacy_dfe8a6bfc81e8ae479d2"].exists)
        capture("37-native-research-historical-code")
        XCTAssertTrue(app.buttons["report-new-code"].exists)
    }

    @MainActor
    func testZAccessibilityTextLayout() throws {
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        launch()
        let search = app.textFields["restroom-search"]
        let screenFrame = app.frame
        XCTAssertLessThanOrEqual(search.frame.maxX, screenFrame.maxX)
        for identifier in ["account", "show-filters", "display-list", "locate-me", "log-restroom"] {
            let button = app.buttons[identifier]
            XCTAssertTrue(button.isHittable, identifier)
            let bounds = button.frame
            XCTAssertGreaterThanOrEqual(bounds.height, 44, identifier)
            XCTAssertLessThanOrEqual(bounds.maxX, screenFrame.maxX, identifier)
        }
        assertMapAddControl()
        capture("09-native-accessibility-map")
        app.buttons["show-filters"].tap()
        XCTAssertTrue(app.navigationBars["Filters"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["filters-done"].isHittable)
        XCTAssertTrue(app.buttons["filters-reset"].isHittable)
        for identifier in ["filter-clean", "filter-accessible", "filter-stairFree", "filter-public", "filter-elevator"] {
            let option = app.buttons[identifier]
            reveal(option)
            XCTAssertGreaterThanOrEqual(option.frame.height, 44, identifier)
            XCTAssertLessThanOrEqual(option.frame.maxX, screenFrame.maxX, identifier)
            option.tap()
            XCTAssertTrue(option.isSelected, identifier)
        }
        capture("10-native-accessibility-filters")
        XCTAssertTrue(app.buttons["filters-reset"].isHittable)
        XCTAssertTrue(app.buttons["filters-done"].isHittable)
        app.buttons["filters-reset"].tap()
        app.buttons["filters-done"].tap()
        XCTAssertEqual(app.buttons["show-filters"].label, "Filters, all restrooms")
        app.buttons["display-list"].tap()
        search.tap()
        search.typeText("100% Playground\n")
        let row = app.buttons["place-i7jb-7jku:row-pu48.fixg-qdtc"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        XCTAssertTrue(app.buttons["close-place"].waitForExistence(timeout: 10))
        assertInitialHalfHeightPlaceSheet()
        capture("12-native-accessibility-place")
        checkCompactDetailNavigation(capturePrefix: "13-native-accessibility")
        app.buttons["close-place"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        XCTAssertEqual(search.value as? String, "100% Playground")
        app.buttons["clear-search"].tap()
        search.tap()
        search.typeText("zzzz-no-such-restroom-9876")
        let noMatches = confirmInlineNoMatches()
        XCTAssertLessThanOrEqual(noMatches.frame.maxX, screenFrame.maxX)
        capture("16-native-accessibility-inline-no-matches")
        let clearSearch = app.buttons["clear-search"]
        XCTAssertTrue(clearSearch.isHittable)
        XCTAssertGreaterThanOrEqual(clearSearch.frame.height, 44)
        clearSearch.tap()
        XCTAssertFalse(app.buttons["clear-search"].exists)
        XCTAssertEqual(app.buttons["show-filters"].label, "Filters, all restrooms")
        assertNoNoMatchAlert()
    }
    /// DEBUG-only actual-form review: no Auth user is fabricated and Share stays disabled.
    @MainActor
    private func checkUnifiedVisitFormReview(capturePrefix: String) {
        app.launchArguments += ["-review-visit-form"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Add a public note"].waitForExistence(timeout: 25))
        let anonymous = app.switches["visit-anonymous"]
        XCTAssertTrue(anonymous.waitForExistence(timeout: 10))
        XCTAssertEqual(anonymous.value as? String, "1")
        XCTAssertFalse(app.buttons["share-public-note"].isEnabled)
        capture(capturePrefix + "-visited-anonymous")
        // SwiftUI exposes the full row and its native switch separately; operate the actual switch.
        anonymous.switches.firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Posting as Review Tester"].waitForExistence(timeout: 5))
        anonymous.switches.firstMatch.tap()
        XCTAssertEqual(anonymous.value as? String, "1")
        let comment = app.descendants(matching: .any).matching(identifier: "visit-comment").firstMatch
        reveal(comment)
        XCTAssertTrue(comment.isHittable)
        capture(capturePrefix + "-public-note")
        for (identifier, title, choice) in [
            ("visit-elevator-present", "Elevator present", "Yes"),
            ("visit-automatic-door-present", "Automatic door present", "No")
        ] {
            let picker = app.buttons[identifier]
            reveal(picker)
            XCTAssertEqual(picker.value as? String, "Not reported")
            XCTAssertGreaterThanOrEqual(picker.frame.height, 44)
            picker.tap()
            XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 5))
            app.buttons[choice].tap()
            XCTAssertEqual(picker.value as? String, choice)
        }
        capture(capturePrefix + "-observed-amenities")
        XCTAssertFalse(app.buttons["share-public-note"].isEnabled)
        let required = app.buttons["visit-code-required"]
        // These Entry controls are above the amenities we just visited. At
        // largest text List may have deallocated those offscreen rows.
        reveal(required, scrollUpWhenAbsent: false)
        required.tap()
        XCTAssertTrue(app.navigationBars["Code required"].waitForExistence(timeout: 5))
        app.buttons["Yes"].tap()
        let code = app.textFields["visit-optional-code"]
        reveal(code)
        XCTAssertTrue(code.isHittable)
        code.tap()
        code.typeText("0042#")
        app.buttons["Done"].tap()
        let visibility = app.buttons["Who can see this code?"]
        reveal(visibility)
        XCTAssertEqual(visibility.value as? String, "Only me")
        XCTAssertFalse(app.buttons["share-public-note"].isEnabled)
        capture(capturePrefix + "-optional-code")
        reveal(required, scrollUpWhenAbsent: false)
        required.tap()
        app.buttons["No"].tap()
        XCTAssertFalse(app.textFields["visit-optional-code"].exists)
        reveal(comment, scrollUpWhenAbsent: false)
        XCTAssertTrue(comment.isHittable)
        capture(capturePrefix + "-optional-comment")
        // Mark a local draft dirty, then exercise the existing safe-discard flow.
        app.navigationBars["Add a public note"].buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["Discard changes"].waitForExistence(timeout: 5))
        if app.buttons["Keep editing"].exists {
            app.buttons["Keep editing"].tap()
        } else {
            // iOS 26 renders the cancel role as outside-popover dismissal.
            let outside = app.otherElements["PopoverDismissRegion"]
            XCTAssertTrue(outside.exists)
            outside.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5)).tap()
        }
        XCTAssertTrue(app.navigationBars["Add a public note"].exists)
        XCTAssertFalse(app.buttons["share-public-note"].isEnabled)
    }

    @MainActor
    func testUnifiedVisitFormReview() throws {
        checkUnifiedVisitFormReview(capturePrefix: "32-native-unified-visit")
    }

    @MainActor
    func testZUnifiedVisitFormReviewAccessibilityTextLayout() throws {
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        checkUnifiedVisitFormReview(capturePrefix: "33-native-unified-visit-accessibility")
    }

    @MainActor
    func testAnalyticsDiscoveryAndProtectedActions() throws {
        app.launchArguments = ["-review-analytics"]
        launch()
        setAnalyticsConsentThroughAccount(true)
        app.buttons["account"].tap()
        XCTAssertTrue(app.navigationBars["Account"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Signing out clears this app’s memory. Your saved data remains in your account."].exists)
        app.buttons["Done"].tap()
        app.buttons["show-filters"].tap()
        XCTAssertTrue(app.buttons["filter-accessible"].waitForExistence(timeout: 10))
        app.buttons["filter-accessible"].tap()
        app.buttons["filters-done"].tap()
        app.buttons["show-filters"].tap()
        app.buttons["filters-reset"].tap()
        app.buttons["filters-done"].tap()
        let search = app.textFields["restroom-search"]
        search.tap(); search.typeText("telemetry-private-query-3434-no-match\n")
        _ = confirmInlineNoMatches()
        app.buttons["clear-search"].tap()
        app.buttons["display-list"].tap()
        XCTAssertTrue(app.buttons["display-map"].waitForExistence(timeout: 10))
        app.buttons["display-map"].tap()
        search.tap(); search.typeText("58th Street Library")
        let suggestion = app.buttons["search-suggestion-i7jb-7jku:row-ahsi-k4c4-scek"]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 25)); suggestion.tap()
        assertInitialHalfHeightPlaceSheet()
        resizePlaceSheet(expanded: true)
        for section in ["hours", "amenities"] {
            let row = app.descendants(matching: .any).matching(identifier: "place-summary-" + section).firstMatch
            revealReadable(row, name: "Analytics " + section, maxSwipes: 12)
            tapVisibleReadingRow(row)
            tapVisibleReadingRow(row)
        }
        let passcodes = app.buttons["place-passcodes"]
        reveal(passcodes, maxSwipes: 12); passcodes.tap()
        XCTAssertTrue(app.navigationBars["Passcodes"].waitForExistence(timeout: 10))
        let report = app.buttons["report-new-code"]
        reveal(report, maxSwipes: 12); report.tap()
        XCTAssertTrue(app.navigationBars["Sign in"].waitForExistence(timeout: 10))
        cancelSignInChoices()
        XCTAssertTrue(app.navigationBars["Passcodes"].exists)
        returnToPlace(from: "Passcodes")
        let rate = app.buttons["place-rate-comment"]
        reveal(rate, maxSwipes: 12); rate.tap()
        XCTAssertTrue(app.navigationBars["Rate and Comment"].waitForExistence(timeout: 10))
        let note = app.buttons["add-public-note"]
        reveal(note, maxSwipes: 12); note.tap()
        XCTAssertTrue(app.navigationBars["Sign in"].waitForExistence(timeout: 10))
        cancelSignInChoices()
        returnToPlace(from: "Rate and Comment")
        openSourcesAndDates()
        returnToPlace(from: "Sources & dates")
        resizePlaceSheet(expanded: false)
        capture("50-native-analytics-public-flow")
        // No provider choice, authentication or production write is performed.
    }

    @MainActor
    func testAnalyticsVisitPreviewExplicitCancellation() throws {
        app.launchArguments = ["-review-analytics", "-review-visit-form"]
        optInAnalyticsBeforeRootPreview()
        app.launch()
        XCTAssertTrue(app.navigationBars["Add a public note"].waitForExistence(timeout: 25))
        let comment = app.descendants(matching: .any).matching(identifier: "visit-comment").firstMatch
        reveal(comment)
        comment.tap(); comment.typeText("Telemetry QA note body must never be emitted")
        app.buttons["Cancel"].tap()
        let discard = app.buttons["Discard changes"]
        XCTAssertTrue(discard.waitForExistence(timeout: 5))
        if app.buttons["Keep editing"].exists { app.buttons["Keep editing"].tap() }
        else {
            // Compact iOS popovers omit the cancel-role row: dismiss outside
            // the popover to keep the exact draft rather than discarding it.
            app.coordinate(withNormalizedOffset: .zero)
                .withOffset(CGVector(dx: app.frame.maxX - 12, dy: app.frame.midY)).tap()
        }
        let kept = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: discard)
        XCTAssertEqual(XCTWaiter.wait(for: [kept], timeout: 5), .completed)
        XCTAssertTrue(app.navigationBars["Add a public note"].exists)
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["Discard changes"].waitForExistence(timeout: 5))
        app.buttons["Discard changes"].tap()
        capture("51-native-analytics-explicit-form-cancel")
        // This DEBUG-only root preview never has an Auth user; Share is disabled.
    }

    @MainActor
    private func checkAccountPresentationTransition(reduceMotion: Bool) {
        app.launchArguments = ["-review-analytics", "-review-account-transition"]
        if reduceMotion { app.launchArguments.append("-review-account-reduce-motion") }
        launch()
        setAnalyticsConsentThroughAccount(true)
        app.buttons["account"].tap()
        let preview = app.buttons["review-signout-transition"]
        XCTAssertTrue(preview.waitForExistence(timeout: 10))
        XCTAssertLessThan(app.buttons["Done"].frame.minY, app.frame.height * 0.25)
        capture(reduceMotion ? "53-native-account-reduce-motion-before" : "52-native-account-transition-before")
        preview.tap()
        XCTAssertTrue(app.buttons["google-sign-in"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["google-sign-in"].isHittable)
        XCTAssertTrue(app.buttons["apple-sign-in"].isHittable)
        let fitted = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.app.buttons["Done"].frame.minY > self.app.frame.height * 0.25
        }, object: app.buttons["Done"])
        XCTAssertEqual(XCTWaiter.wait(for: [fitted], timeout: 10), .completed)
        XCTAssertFalse(app.staticTexts["Signing out clears this app’s memory. Your saved data remains in your account."].exists)
        capture(reduceMotion ? "53-native-account-reduce-motion-after" : "52-native-account-transition-after")
        // The fixture changes presentation only; it never constructs a Firebase
        // identity, calls signOut, or logs a successful account mutation.
    }

    @MainActor
    func testAccountPresentationCrossfade() throws {
        checkAccountPresentationTransition(reduceMotion: false)
    }

    @MainActor
    func testAccountPresentationReduceMotion() throws {
        checkAccountPresentationTransition(reduceMotion: true)
    }

    @MainActor
    func testAnalyticsMapPinReplacementKeepsFreshMedium() throws {
        app.launchArguments = ["-review-analytics"]
        checkMapPinReplacementStartsHalfHeight(capturePrefix: "54-native-analytics-map-pins", analyticsOptIn: true)
    }

    @MainActor
    private func captureReadableRequest(_ row: XCUIElement, name: String, prefix: String) {
        // A request row can exceed one viewport at the largest Dynamic Type
        // size. Prove the whole row is reachable, rather than accepting a
        // label merely because its first line intersects the screen.
        revealReadable(row, name: name, maxSwipes: 12)
        func pan(upwards: Bool, distance: CGFloat) {
            // Keep the gesture above the home-indicator region. Starting a
            // drag at the physical screen bottom invokes the system gesture,
            // which is not a test of this List's scrolling.
            let viewport = unobscuredContentViewport().insetBy(dx: 12, dy: 72)
            let travel = min(max(8, distance), viewport.height * 0.6)
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let startY = upwards ? viewport.maxY : viewport.minY
            let endY = upwards ? startY - travel : startY + travel
            origin.withOffset(CGVector(dx: viewport.midX, dy: startY))
                .press(forDuration: 0.1, thenDragTo: origin.withOffset(CGVector(dx: viewport.midX, dy: endY)),
                       withVelocity: .slow, thenHoldForDuration: 0.3)
        }
        let content = unobscuredContentViewport()
        let viewport = CGRect(x: content.minX + 2, y: content.minY + 8,
            width: content.width - 4, height: content.height - 52)
        for _ in 0..<16 {
            let difference = row.frame.minY - viewport.minY
            if abs(difference) <= 12 { break }
            // A short final row may already be fully visible at the end of a List.
            if row.frame.minY >= viewport.minY && row.frame.maxY <= viewport.maxY { break }
            pan(upwards: difference > 0, distance: abs(difference))
        }
        XCTAssertGreaterThanOrEqual(row.frame.minY, viewport.minY - 12, "The request's first line must be visible")
        XCTAssertLessThan(row.frame.minY, viewport.maxY - 60)
        capture(prefix + "-top")
        var geometry = ["top: row=\(row.frame); viewport=\(viewport)"]
        var segment = 0
        for _ in 0..<16 {
            // Native List resting geometry can differ by a few display
            // points; this allowance still clears the home-indicator area.
            if row.frame.maxY <= viewport.maxY + 4 { break }
            let before = row.frame
            pan(upwards: true, distance: min(viewport.height * 0.55, before.maxY - viewport.maxY + 8))
            XCTAssertLessThan(row.frame.minY, before.minY - 1,
                "Request content must scroll inside the List; before=\(before); after=\(row.frame); viewport=\(viewport)")
            segment += 1
            geometry.append("segment \(segment): row=\(row.frame); viewport=\(viewport)")
            capture(prefix + "-segment-\(segment)")
        }
        XCTAssertLessThanOrEqual(row.frame.maxY, viewport.maxY + 4, "The request's final date line must be reachable")
        XCTAssertGreaterThan(row.frame.maxY, viewport.minY + 40)
        let record = XCTAttachment(string: geometry.joined(separator: "\n"))
        record.name = prefix + "-geometry"; record.lifetime = .keepAlways; add(record)
    }

    @MainActor
    private func checkModerationRequestHistory(largeText: Bool) {
        app.launchArguments = ["-review-analytics", "-review-account-transition", "-review-submission-requests"]
        if largeText { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
        launch()
        app.buttons["account"].tap()
        let preview = app.buttons["review-restroom-requests"]
        XCTAssertTrue(preview.waitForExistence(timeout: 10))
        reveal(preview); preview.tap()
        XCTAssertTrue(app.navigationBars["Restroom requests"].waitForExistence(timeout: 10))
        let pending = app.descendants(matching: .any).matching(identifier: "restroom-request-community-00000000000000000001").firstMatch
        revealReadable(pending, name: "Awaiting approval request", maxSwipes: 12)
        XCTAssertTrue(pending.label.contains("Awaiting approval"))
        XCTAssertFalse(app.buttons["approved-request-community-00000000000000000001"].exists)
        captureReadableRequest(pending, name: "Awaiting approval request",
            prefix: largeText ? "56-native-request-status-large-pending" : "55-native-request-status-pending")
        let approved = app.buttons["approved-request-community-00000000000000000002"]
        revealReadable(approved, name: "Approved request", maxSwipes: 12)
        XCTAssertTrue(approved.label.contains("Approved"))
        XCTAssertFalse(approved.isEnabled, "Presentation examples cannot open or publish fake locations")
        let denied = app.descendants(matching: .any).matching(identifier: "restroom-request-community-00000000000000000003").firstMatch
        revealReadable(denied, name: "Denied request", maxSwipes: 12)
        XCTAssertTrue(denied.label.contains("Not approved"))
        XCTAssertTrue(denied.label.contains("already listed"))
        XCTAssertFalse(app.buttons["approved-request-community-00000000000000000003"].exists)
        captureReadableRequest(denied, name: "Denied request",
            prefix: largeText ? "56-native-request-status-large-denied" : "55-native-request-status-denied")
        // The preview changes presentation only. No identity, queue read/write,
        // approval, code publication or new-restroom success event is created.
    }

    @MainActor
    func testModerationRequestHistoryPresentation() throws {
        checkModerationRequestHistory(largeText: false)
    }

    @MainActor
    func testZModerationRequestHistoryAccessibilityText() throws {
        checkModerationRequestHistory(largeText: true)
    }

    @MainActor
    func testModerationRequestFormReviewAndPrivateCode() throws {
        app.launchArguments = ["-review-analytics", "-review-restroom-request-form"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Add restroom"].waitForExistence(timeout: 25))
        XCTAssertTrue(app.staticTexts["Presentation-only request form"].exists)
        let submit = app.buttons["submit-restroom-request"]
        XCTAssertTrue(submit.exists); XCTAssertEqual(submit.label, "Submit request"); XCTAssertFalse(submit.isEnabled)
        let required = app.buttons["restroom-request-code-required"]
        reveal(required, maxSwipes: 12); required.tap()
        XCTAssertTrue(app.navigationBars["Code required"].waitForExistence(timeout: 5))
        app.buttons["Yes"].tap()
        let code = app.textFields["restroom-request-code"]
        reveal(code, maxSwipes: 12); code.tap(); code.typeText("TELEMETRY-PRIVATE-0042#")
        app.buttons["Done"].tap()
        let visibility = app.buttons["Who can see this code?"]
        reveal(visibility, maxSwipes: 12)
        XCTAssertEqual(visibility.value as? String, "Only me")
        let privateFooter = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "If approved, this code stays")).firstMatch
        revealReadable(privateFooter, name: "Deferred private code and Saved behavior", maxSwipes: 12)
        XCTAssertFalse(submit.isEnabled)
        capture("57-native-request-private-code")
        visibility.tap()
        XCTAssertTrue(app.navigationBars["Who can see this code?"].waitForExistence(timeout: 5))
        app.buttons["Everyone"].tap()
        let publicFooter = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "If approved, this code becomes public")).firstMatch
        revealReadable(publicFooter, name: "Code publication waits for approval", maxSwipes: 12)
        XCTAssertFalse(submit.isEnabled)
        capture("57-native-request-public-code-intent")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["Discard changes"].waitForExistence(timeout: 5))
        app.buttons["Discard changes"].tap()
        XCTAssertTrue(app.textFields["restroom-search"].waitForExistence(timeout: 10))
        // Submission is disabled even if a session exists. Neither visibility
        // choice creates a public code, Saved entry, or pending request.
    }

    /// Change consent with the same visible control available to every user.
    /// No launch argument or test-only preference bypass enables Analytics.
    @MainActor
    private func setAnalyticsConsentThroughAccount(_ allowed: Bool) {
        app.buttons["account"].tap()
        XCTAssertTrue(app.navigationBars["Account"].waitForExistence(timeout: 10))
        let choice = app.switches["account-analytics-consent"]
        revealReadable(choice, name: "Optional app usage switch", maxSwipes: 12)
        if (choice.value as? String == "1") != allowed { choice.tap() }
        XCTAssertEqual(choice.value as? String, allowed ? "1" : "0")
        app.buttons["Done"].tap()
        XCTAssertTrue(app.textFields["restroom-search"].waitForExistence(timeout: 10))
    }

    @MainActor
    private func optInAnalyticsBeforeRootPreview() {
        let previewArguments = app.launchArguments
        app.launchArguments = previewArguments.filter { $0 != "-review-visit-form" && $0 != "-review-content-report" }
        launch()
        setAnalyticsConsentThroughAccount(true)
        app.terminate()
        app.launchArguments = previewArguments
    }

    /// Run first on a fresh app installation; later steps use only the real switch.
    @MainActor
    func testAnalyticsConsentDefaultsOffAndStaysOff() throws {
        app.launchArguments = ["-review-analytics"]
        launch()
        app.buttons["account"].tap()
        let choice = app.switches["account-analytics-consent"]
        XCTAssertTrue(choice.waitForExistence(timeout: 10))
        XCTAssertEqual(choice.value as? String, "0")
        capture("58-native-analytics-default-off")
        app.buttons["Done"].tap()
        app.buttons["display-list"].tap()
        XCTAssertTrue(app.buttons["display-map"].waitForExistence(timeout: 10))
        app.buttons["display-map"].tap()
        app.terminate()
        launch()
        app.buttons["account"].tap()
        XCTAssertTrue(choice.waitForExistence(timeout: 10))
        XCTAssertEqual(choice.value as? String, "0")
        capture("58-native-analytics-off-after-relaunch")
        // Coordinator checks the simulator-only trace is [] after this case.
    }

    @MainActor
    func testAnalyticsConsentCanBeWithdrawn() throws {
        app.launchArguments = ["-review-analytics"]
        launch()
        setAnalyticsConsentThroughAccount(true)
        app.buttons["display-list"].tap()
        XCTAssertTrue(app.buttons["display-map"].waitForExistence(timeout: 10))
        app.buttons["display-map"].tap()
        setAnalyticsConsentThroughAccount(false)
        app.buttons["display-list"].tap()
        XCTAssertTrue(app.buttons["display-map"].waitForExistence(timeout: 10))
        app.buttons["display-map"].tap()
        app.terminate()
        launch()
        app.buttons["account"].tap()
        let choice = app.switches["account-analytics-consent"]
        XCTAssertTrue(choice.waitForExistence(timeout: 10))
        XCTAssertEqual(choice.value as? String, "0")
        capture("59-native-analytics-withdrawn-after-relaunch")
        // Withdrawal removes the prior local trace; no later events are queued.
    }

    @MainActor
    private func checkPrivateContentReportForm(largeText: Bool) {
        app.launchArguments = ["-review-content-report"]
        if largeText { app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"] }
        app.launch()
        XCTAssertTrue(app.navigationBars["Report content"].waitForExistence(timeout: 25))
        let send = app.buttons["content-report-send"]
        XCTAssertTrue(send.exists); XCTAssertFalse(send.isEnabled)
        XCTAssertFalse(app.textViews.firstMatch.exists, "A private report must not copy note text into another public form.")
        let reason = app.buttons["content-report-reason"]
        revealReadable(reason, name: "Private report reason", maxSwipes: 12)
        reason.tap()
        let harassment = app.buttons["Harassment or abuse"]
        revealReadable(harassment, name: "Report harassment reason", maxSwipes: 12)
        harassment.tap()
        XCTAssertTrue(app.navigationBars["Report content"].waitForExistence(timeout: 5))
        XCTAssertFalse(send.isEnabled, "The presentation fixture can never send a report.")
        let privacy = app.staticTexts["Sent privately to moderators. Your report will not appear in visitor notes."]
        revealReadable(privacy, name: "Private reporting disclosure", maxSwipes: 12)
        capture(largeText ? "61-native-private-report-large" : "60-native-private-report")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["Discard changes"].waitForExistence(timeout: 5))
        app.buttons["Discard changes"].tap()
        // No synthetic Firebase identity, token request, public note or report is created.
    }

    @MainActor
    func testPrivateContentReportForm() throws { checkPrivateContentReportForm(largeText: false) }

    @MainActor
    func testZPrivateContentReportFormLargeText() throws { checkPrivateContentReportForm(largeText: true) }

    @MainActor
    func testPrivateReportOnRealImportedCommentRequiresSignIn() throws {
        launch()
        let search = app.textFields["restroom-search"]
        search.tap(); search.typeText("Peninsula")
        let suggestion = app.buttons["search-suggestion-community-7398fe084d3d87eed23c"]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 30)); suggestion.tap()
        assertInitialHalfHeightPlaceSheet()
        resizePlaceSheet(expanded: true)
        openRateAndComment()
        let comment = app.descendants(matching: .any).matching(identifier: "research-comment-0dca757299328a5c6e99").firstMatch
        revealReadable(comment, name: "Real published comment", maxSwipes: 12)
        tapVisibleReadingRow(comment)
        let report = app.buttons["report-content-research-comment-0dca757299328a5c6e99"]
        revealReadable(report, name: "Report this published comment", maxSwipes: 12)
        report.tap()
        XCTAssertTrue(app.navigationBars["Sign in"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["content-report-send"].exists)
        capture("62-native-private-report-sign-in")
        cancelSignInChoices()
        XCTAssertTrue(app.navigationBars["Rate and Comment"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["content-report-send"].exists)
        // Canceling provider selection does not submit a private report or public note.
    }

    @MainActor
    func testPublicCodeContentReportRequiresSignIn() throws {
        launch()
        let search = app.textFields["restroom-search"]
        search.tap(); search.typeText("Whole Foods Market")
        let venue = app.buttons["search-suggestion-community-66ea1a33929286315e13"]
        revealCodeSearchTarget(venue, capturePrefix: "63-native-code-content-report")
        venue.tap()
        assertInitialHalfHeightPlaceSheet()
        resizePlaceSheet(expanded: true)
        let passcodes = app.buttons["place-passcodes"]
        reveal(passcodes); passcodes.tap()
        XCTAssertTrue(app.navigationBars["Passcodes"].waitForExistence(timeout: 10))
        let report = app.buttons.matching(NSPredicate(format:
            "identifier BEGINSWITH %@ OR identifier BEGINSWITH %@", "report-content-legacy-code-", "report-content-v2-code-")).firstMatch
        revealReadable(report, name: "Public code content report", maxSwipes: 12)
        XCTAssertGreaterThanOrEqual(report.frame.height, 44)
        report.tap()
        XCTAssertTrue(app.navigationBars["Sign in"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["content-report-send"].exists)
        cancelSignInChoices()
        XCTAssertTrue(app.navigationBars["Passcodes"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["content-report-send"].exists)
        // Only the private target reference/version is selected. No code value,
        // verification vote, report or authentication is submitted by this case.
    }

}
