//
//  Restroom_ReadyApp.swift
//  Restroom Ready
//
//  Created by Zheli Chen on 10/22/26.
//

import SwiftUI
import FirebaseCore
import GoogleSignIn

@main
@MainActor
struct Restroom_ReadyApp: App {
    @State private var store: NativeStore
    private let city: CitySnapshot?

    init() {
        // Firebase must be configured before any Auth or Firestore store is constructed.
        NativeAnalytics.prepareForLaunch()
        FirebaseApp.configure()
        NativeAnalytics.configure()
        _store = State(initialValue: NativeStore())
        city = try? CitySnapshot.load()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if let city {
                    #if DEBUG
                    if ProcessInfo.processInfo.arguments.contains("-review-content-report"), let place = city.places.first,
                       let target = try? ContentReportTarget(kind: .publicNote, placeID: place.id,
                           recordID: "ReportPreviewOnly001", postedAt: "1790000000:0") {
                        // Local presentation only. This route cannot submit a report.
                        ContentReportForm(store: store, place: place, target: target, previewOnly: true)
                    } else if ProcessInfo.processInfo.arguments.contains("-review-visit-form"), let place = city.places.first {
                        // UI-only review. No synthetic Auth user; publishing is disabled in the form.
                        PublicVisitForm(store: store, place: place, previewOnly: true)
                    } else {
                        NativeRootView(store: store, places: city.places)
                    }
                    #else
                    NativeRootView(store: store, places: city.places)
                    #endif
                } else {
                    ContentUnavailableView("The NYC directory could not load",
                                           systemImage: "exclamationmark.triangle",
                                           description: Text("Reinstall this build to restore its bundled city data."))
                        .onAppear { NativeAnalytics.track(.screen(.directoryUnavailable)) }
                }
            }
            .onOpenURL { url in
                GIDSignIn.sharedInstance.handle(url)
            }
        }
    }
}
