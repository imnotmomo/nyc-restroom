import SwiftUI
import CoreLocation
import UIKit

private enum DiscoveryDisplay: Equatable { case map, list }
private enum DiscoverySheet: Identifiable, Equatable {
    case place(Place, origin: NativeAnalyticsSource), filters, account, newPlace
    var id: String {
        switch self {
        case .place(let value, _): "place-" + value.id
        case .filters: "filters"
        case .account: "account"
        case .newPlace: "new-place"
        }
    }
    var place: Place? { if case .place(let value, _) = self { return value }; return nil }
}

struct NativeRootView: View {
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let store: NativeStore
    let places: [Place]
    private let citySource = try? CitySnapshot.load().source
    private let research = try? ResearchRegistry.load()
    private let reviewedAccessibility = try? ReviewedAccessibilityIndex.load()
    @State private var query = ""
    @State private var filters: Set<PlaceFilter> = []
    @State private var display: DiscoveryDisplay = .map
    @State private var location = LocationService()
    @State private var focus: MapFocus?
    @State private var sheet: DiscoverySheet?
    @State private var pendingSheet: DiscoverySheet?
    @State private var placeDetent: PresentationDetent = .medium
    @State private var ignoreInitialDetentReset = false
    @State private var analyticsLocatePending = false
    @State private var submittedRestroomRequest: OwnRestroomRequest?
    @State private var showsSubmissionNotice = false
    @State private var submissionNoticeTitle = "Submitted for review"
    @State private var submissionNoticeMessage = ""
    @State private var accountPlaceToOpen: (place: Place, source: NativeAnalyticsSource)?
    @State private var resumeAddAfterSignIn = false
    @State private var visibleCount = 50
    @State private var hideLocationNotice = false
    @State private var locatingByUser = false
    @State private var filterRowHeights: [PlaceFilter: CGFloat] = [:]
    @ScaledMetric(relativeTo: .body) private var suggestionRowHeight: CGFloat = 60
    @FocusState private var searchFocused: Bool

    private var allPlaces: [Place] {
        var values = Dictionary(uniqueKeysWithValues: places.map { ($0.id, $0) })
        for place in store.communityPlaces { values[place.id] = place }
        let merged = values.values.map { original in
            var place = original
            place.accessDetails = store.accessDetails[place.id]
            place.reviewedAccessibility = reviewedAccessibility?.evidence(for: place.id)
            return place
        }
        #if DEBUG
        if isMapPinReview {
            // Keep two real nearby directory pins for deterministic MapKit hit testing.
            return merged.filter { ["i7jb-7jku:row-cunh~tmjb_ktcf", "i7jb-7jku:row-tmt8_zzvc_8g8v"].contains($0.id) }
        }
        #endif
        return merged
    }

    private var isMapPinReview: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-review-map-pins")
        #else
        false
        #endif
    }

    @ViewBuilder
    private func discoveryMap(_ values: [Place], geometry: GeometryProxy) -> some View {
        let map = RestroomMapView(places: values, selectedID: sheet?.place?.id, focus: focus,
                                 showsUserLocation: location.coordinate != nil,
                                 viewportInsets: mapInsets(in: geometry), onSelect: { select($0, source: .map) })
        if isMapPinReview {
            // XCTest taps the actual annotation views, rather than a bypass action.
            map
        } else {
            map.accessibilityRepresentation {
                if display == .map {
                    Button("Map of matching NYC restrooms") { setDisplay(.list) }
                        .accessibilityHint("Opens the complete list of matching places and their details.")
                }
            }
        }
    }

    private func results() -> [Place] {
        // A missing/invalid feed cannot turn a sidecar override into a fallback match.
        if (filters.contains(.stairFree) || filters.contains(.elevator))
            && (store.accessDetailsLoading || store.accessDetailsFeedError != nil) { return [] }
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let elevatorPlaceIDs = research?.reportedElevatorPlaceIDs ?? []
        return allPlaces.filter { place in
            let rating = store.ratings[place.id]
            let average = rating.flatMap { $0.ratingCount > 0 ? $0.average : nil }
            return PlaceFilter.matchesAll(filters, place, average: average, savedIDs: store.savedIDs,
                                          elevatorPlaceIDs: elevatorPlaceIDs) &&
                (search.isEmpty || [place.name, place.address, place.locationType, place.operatorName, place.communityNotes]
                    .compactMap { $0 }.contains { $0.range(of: search, options: [.caseInsensitive, .diacriticInsensitive]) != nil })
        }.sorted { lhs, rhs in
            if let coordinate = location.coordinate,
               Place.containsNYC(latitude: coordinate.latitude, longitude: coordinate.longitude) {
                let origin = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
                let left = origin.distance(from: CLLocation(latitude: lhs.latitude, longitude: lhs.longitude))
                let right = origin.distance(from: CLLocation(latitude: rhs.latitude, longitude: rhs.longitude))
                if abs(left - right) > 1 { return left < right }
            }
            return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
        }
    }

    private func discoveryContent(_ values: [Place]) -> some View {
        GeometryReader { geometry in
            ZStack {
                // Keep the same map alive while using List so its camera is preserved.
                discoveryMap(values, geometry: geometry)
                    .ignoresSafeArea()
                    .opacity(display == .map || isSearching ? 1 : 0)
                    .allowsHitTesting(display == .map || isSearching)
                    .accessibilityHidden(display != .map || isSearching)
                    .accessibilityIdentifier("restroom-map")
                if display == .list {
                    Group {
                        if needsSavedState { RRStyle.background.ignoresSafeArea() }
                        else {
                            locationsList(values)
                                .opacity(isSearching ? 0 : 1)
                                .allowsHitTesting(!isSearching)
                                .accessibilityHidden(isSearching)
                        }
                    }
                    .transition(.opacity)
                    .zIndex(1)
                }
                if needsSavedState { savedState.padding(24).zIndex(2) }
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                RRGlassContainer(spacing: 8) {
                  VStack(spacing: 8) {
                    searchBar
                    if isSearching {
                        searchSuggestions(values, availableHeight: geometry.size.height)
                    } else if values.isEmpty && !needsSavedState {
                        searchResultFeedback
                    }
                    if store.publicFeedError != nil || store.ratingsFeedError != nil || store.accessDetailsFeedError != nil {
                        HStack {
                            Text("Some public reports couldn’t load.").font(.footnote)
                            Spacer(minLength: 8)
                            Button("Retry") { store.reloadPublic() }.frame(minHeight: 44)
                        }
                        .padding(.horizontal, 12).rrGlassSurface(cornerRadius: 12, interactive: false)
                    }
                  }
                }.padding(.horizontal, 16).padding(.top, 8).padding(.bottom, display == .list ? 8 : 0)
            }
            .safeAreaInset(edge: .bottom, spacing: 8) {
                if !searchFocused {
                    RRGlassContainer(spacing: 8) {
                      // Both glass surfaces share the native inset's trailing edge.
                      VStack(alignment: .trailing, spacing: 8) {
                        if let message = locationNotice { locationBanner(message) }
                        if showsMapAddButton {
                            addRestroomButton
                        }
                        browseControls
                      }
                      .frame(maxWidth: .infinity, alignment: .trailing)
                    }.padding(.horizontal, 16).padding(.bottom, 8)
                }
            }
        }
    }

    private var discoveryPresentation: some View {
        discoveryContent(results())
        .background(RRStyle.background)
        .foregroundStyle(RRStyle.ink)
        .tint(RRStyle.ink)
        .preferredColorScheme(.light)
        .sheet(item: $sheet, onDismiss: sheetDismissed, content: sheetContent)
    }

    @ViewBuilder private func sheetContent(_ value: DiscoverySheet) -> some View {
            switch value {
            case .place(let selected, _):
                let place = allPlaces.first { $0.id == selected.id } ?? selected
                PlaceDetailSheet(store: store, place: place, citySource: citySource, research: research)
                    .id(place.id)
                    .presentationDetents([.medium, .large], selection: $placeDetent)
                    .presentationContentInteraction(.resizes)
                    .presentationDragIndicator(.visible)
                    .presentationBackgroundInteraction(.enabled(upThrough: .medium))
                    .task(id: place.id) { store.selectPlace(place.id) }
            case .filters:
                filterSheet
                    .frame(idealHeight: filterSheetHeight)
                    .presentationSizing(.form.fitted(horizontal: false, vertical: true))
                    .presentationDetents([.height(filterSheetHeight)])
                    .presentationDragIndicator(.visible)
            case .account:
                NavigationStack {
                    NativeAccountView(store: store, onShowSaved: {
                        filters = [.saved]; display = .list; sheet = nil
                    }, onOpenPlace: { id in
                        guard !store.authBusy, let place = allPlaces.first(where: { $0.id == id }) else { return false }
                        resumeAddAfterSignIn = false
                        accountPlaceToOpen = (place, .comments)
                        sheet = nil
                        return true
                    }, onOpenRequestPlace: { id in
                        guard !store.authBusy, let place = allPlaces.first(where: { $0.id == id }) else { return false }
                        resumeAddAfterSignIn = false
                        accountPlaceToOpen = (place, .requests)
                        sheet = nil
                        return true
                    })
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { sheet = nil }.disabled(store.authBusy) } }
                }
                .interactiveDismissDisabled(store.authBusy)
            case .newPlace:
                NewRestroomForm(store: store) { request in submittedRestroomRequest = request; sheet = nil }
            }
    }

    var body: some View {
        discoveryPresentation
        .task {
            NativeAnalytics.track(.screen(discoveryAnalyticsScreen))
            store.publicStart()
            if !isMapPinReview { location.locateIfAuthorized() }
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-review-restroom-request-form") { present(.newPlace) }
            #endif
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active && !isMapPinReview { location.locateIfAuthorized() }
        }
        .onChange(of: placeDetent) { _, height in
            if ignoreInitialDetentReset && height == .medium {
                ignoreInitialDetentReset = false
                return
            }
            guard sheet?.place != nil else { return }
            NativeAnalytics.track(.cardHeight(height == .large ? .large : .medium))
        }
        .onChange(of: location.isLocating) { _, _ in recordLocateResult() }
        .onChange(of: query) { _, _ in visibleCount = 50 }
        .onChange(of: filters) { _, _ in visibleCount = 50 }
        .onChange(of: location.coordinate?.latitude) { _, _ in focusOnUser() }
        .onChange(of: location.coordinate?.longitude) { _, _ in focusOnUser() }
        .onChange(of: store.user?.uid) { previous, uid in
            visibleCount = 50
            if previous != uid {
                submittedRestroomRequest = nil; showsSubmissionNotice = false; submissionNoticeMessage = ""
            }
            if previous != nil && uid == nil { resumeAddAfterSignIn = false }
            completeAddSignIn()
        }
        .onChange(of: store.authBusy) { _, _ in completeAddSignIn() }
        .alert(submissionNoticeTitle, isPresented: $showsSubmissionNotice) {
            Button("OK", role: .cancel) { }
        } message: { Text(submissionNoticeMessage) }
    }

    private var searchBar: some View {
        HStack(spacing: 4) {
            Image(systemName: "magnifyingglass").font(.system(size: 17)).foregroundStyle(.secondary).padding(.leading, 14)
            TextField("Search restrooms", text: $query)
                .font(.body).textInputAutocapitalization(.never).autocorrectionDisabled()
                .frame(minWidth: 0, maxWidth: .infinity)
                .layoutPriority(-1)
                .focused($searchFocused).submitLabel(.search)
                .accessibilityLabel("Search restroom locations").accessibilityIdentifier("restroom-search")
                .onSubmit { submitSearch() }
            if !query.isEmpty {
                Button { query = ""; searchFocused = false } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 18)).foregroundStyle(.secondary).frame(width: 44, height: 44)
                }.accessibilityLabel("Clear search").accessibilityIdentifier("clear-search")
            }
            if searchFocused {
                Button("Done") { submitSearch() }.font(.body).frame(minWidth: 44, minHeight: 48)
                    .accessibilityIdentifier("search-done").padding(.trailing, 8)
            } else {
                Button { resumeAddAfterSignIn = false; present(.account) } label: {
                    Image(systemName: "person.crop.circle.fill").font(.system(size: 28))
                        .foregroundStyle(RRStyle.ink).frame(width: 52, height: 52)
                }
                .accessibilityLabel("Account").accessibilityIdentifier("account")
            }
        }
        .frame(minHeight: 52)
        .rrGlassSurface(cornerRadius: 20)
    }

    private var hasSearchQuery: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var isSearching: Bool { searchFocused && hasSearchQuery && !needsSavedState }

    private var showsMapAddButton: Bool { display == .map && !searchFocused && sheet == nil }

    private var addRestroomButton: some View {
        Button(action: requestNewPlace) {
            Image(systemName: "plus")
                .font(.system(size: 22, weight: .medium))
                .frame(width: 48, height: 48)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .rrGlassSurface(cornerRadius: 24)
        .disabled(store.authBusy || store.busy)
        .accessibilityLabel("Add a restroom")
        .accessibilityIdentifier("log-restroom")
    }

    @ViewBuilder
    private func searchSuggestions(_ values: [Place], availableHeight: CGFloat) -> some View {
        if values.isEmpty {
            searchResultFeedback
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(Array(values.enumerated()), id: \.element.id) { index, place in
                        if index > 0 { Divider().padding(.horizontal, 16) }
                        Button { select(place, source: .search) } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(place.name).font(.body).foregroundStyle(RRStyle.ink)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text(place.address ?? place.locationType).font(.caption)
                                    .foregroundStyle(.secondary).lineLimit(2)
                            }
                            .padding(.horizontal, 16).padding(.vertical, 8)
                            .frame(maxWidth: .infinity, minHeight: suggestionRowHeight, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("search-suggestion-" + place.id)
                    }
                }
            }
            .frame(height: min(CGFloat(min(values.count, 6)) * suggestionRowHeight,
                               min(320, max(88, availableHeight * 0.4))))
            .scrollDismissesKeyboard(.never)
            .rrGlassSurface(cornerRadius: 16)
            .accessibilityIdentifier("search-suggestions")
        }
    }

    private var searchResultFeedback: some View {
        Group {
            switch resultsReadiness {
            case .loading:
                ProgressView("Loading restrooms…")
            case .unavailable:
                Text("Results couldn’t load. Try again.").foregroundStyle(.secondary)
            case .ready:
                Text("No restroom was found").foregroundStyle(.secondary)
                    .accessibilityIdentifier("search-no-matches")
            }
        }
        .font(.subheadline)
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .rrGlassSurface(cornerRadius: 16, interactive: false)
    }

    private var browseControls: some View {
      VStack(alignment: .leading, spacing: 12) {
        HStack(spacing: 0) {
            if filters.contains(.saved) {
                Button(action: returnToMainMap) {
                    Label("Return to main map", systemImage: "arrow.left")
                        .font(.subheadline.weight(.medium))
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                        .padding(.horizontal, 8)
                        .frame(minHeight: 48)
                }
                .accessibilityIdentifier("return-main-map")
            } else {
                Button {
                    searchFocused = false; resumeAddAfterSignIn = false; present(.filters)
                } label: {
                    Group {
                        if textSize.isAccessibilitySize {
                            Image(systemName: "line.3.horizontal.decrease").font(.system(size: 22)).frame(width: 48)
                        } else {
                            Label(filterButtonTitle, systemImage: "line.3.horizontal.decrease")
                                .font(.body.weight(.medium)).lineLimit(1).padding(.horizontal, 12)
                        }
                    }.frame(minHeight: 48)
                }.accessibilityIdentifier("show-filters")
                    .accessibilityLabel(filters.isEmpty ? "Filters, all restrooms" : "Filters, " + selectedFilterTitles.joined(separator: ", ") + " selected")
            }
            Spacer(minLength: 0)
            Button { searchFocused = false; setDisplay(display == .map ? .list : .map) } label: {
                Group {
                    if textSize.isAccessibilitySize || filters.contains(.saved) {
                        Image(systemName: display == .map ? "list.bullet" : "map").font(.system(size: 21))
                    } else {
                        Label(display == .map ? "List" : "Map", systemImage: display == .map ? "list.bullet" : "map").font(.body.weight(.medium))
                    }
                }.frame(minWidth: filters.contains(.saved) ? 48 : 64, minHeight: 48)
                    .padding(.horizontal, filters.contains(.saved) ? 0 : 8)
            }
            .accessibilityLabel(display == .map ? "Show list" : "Show map")
            .accessibilityIdentifier(display == .map ? "display-list" : "display-map")
            Divider().frame(height: 24)
            Button {
                searchFocused = false; hideLocationNotice = false; locatingByUser = true
                analyticsLocatePending = true
                NativeAnalytics.track(.locateRequest)
                location.requestLocation()
                recordLocateResult()
            } label: {
                Group {
                    if location.isLocating { ProgressView() }
                    else { Image(systemName: "location.fill").font(.system(size: 21)) }
                }.frame(width: 52, height: 48)
            }
            .disabled(location.isLocating)
            .accessibilityLabel(location.isLocating ? "Locating" : "Locate me")
            .accessibilityIdentifier("locate-me")
        }
      }
      .padding(.horizontal, 16).padding(.vertical, 8)
      .frame(maxWidth: .infinity)
      .rrGlassSurface(cornerRadius: 28)
    }

    private var filterSheet: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(PlaceFilter.discoveryFilters) { option in
                        Button {
                            filters.remove(.saved)
                            if filters.contains(option) { filters.remove(option) }
                            else { filters.insert(option) }
                            if let filter = analyticsFilter(option) {
                                NativeAnalytics.track(.filterToggle(filter, enabled: filters.contains(option)))
                            }
                        } label: {
                            HStack(spacing: 12) {
                                Text(option.title).font(.body).foregroundStyle(RRStyle.ink)
                                Spacer(minLength: 8)
                                if filters.contains(option) { Image(systemName: "checkmark").font(.body.weight(.semibold)) }
                            }.frame(minHeight: 44).contentShape(Rectangle())
                                .onGeometryChange(for: CGFloat.self) { geometry in
                                    geometry.size.height.rounded(.up)
                                } action: { height in
                                    filterRowHeights[option] = height
                                }
                        }
                        .accessibilityAddTraits(filters.contains(option) ? .isSelected : [])
                        .accessibilityIdentifier("filter-" + option.rawValue)
                        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                    }
                }
            }
            .listStyle(.insetGrouped)
            .environment(\.defaultMinListRowHeight, 44)
            .contentMargins(.top, 8, for: .scrollContent)
            .navigationTitle("Filters").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { filters.removeAll(); NativeAnalytics.track(.filtersClear) } label: {
                        Text("Clear filters").foregroundStyle(.red)
                    }
                    .tint(.red).accessibilityIdentifier("filters-reset")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        NativeAnalytics.track(.filtersApply(analyticsFilters))
                        sheet = nil
                    } label: {
                        Text("Done").foregroundStyle(.blue)
                    }
                    .tint(.blue).accessibilityIdentifier("filters-done")
                }
            }
        }
        .tint(RRStyle.ink)
        .onAppear { NativeAnalytics.track(.screen(.filters)) }
    }

    private var discoveryAnalyticsScreen: NativeAnalyticsScreen {
        filters.contains(.saved) ? .savedPlaces : display == .map ? .finder : .list
    }

    private var analyticsFilters: NativeAnalyticsFilters {
        NativeAnalyticsFilters(clean: filters.contains(.clean), accessible: filters.contains(.accessible),
            stairFree: filters.contains(.stairFree), publicAccess: filters.contains(.public),
            elevatorAccess: filters.contains(.elevator))
    }

    private func analyticsFilter(_ value: PlaceFilter) -> NativeAnalyticsFilter? {
        switch value {
        case .clean: .clean
        case .accessible: .accessible
        case .stairFree: .stairFree
        case .public: .publicAccess
        case .elevator: .elevatorAccess
        case .noCode, .saved: nil
        }
    }

    private func recordLocateResult() {
        guard analyticsLocatePending, !location.isLocating else { return }
        analyticsLocatePending = false
        let outcome: NativeAnalyticsLocationOutcome
        if location.authorizationDenied { outcome = .permissionDenied }
        else if let coordinate = location.coordinate {
            outcome = Place.containsNYC(latitude: coordinate.latitude, longitude: coordinate.longitude) ? .success : .outsideNYC
        } else { outcome = .unavailable }
        NativeAnalytics.track(.locateResult(outcome))
    }

    private var selectedFilterTitles: [String] {
        (PlaceFilter.discoveryFilters + [.saved]).filter { filters.contains($0) }.map(\.title)
    }

    private var filterSheetHeight: CGFloat {
        // Native toolbar, grabber and grouped-list margins, plus the actual row heights.
        104 + PlaceFilter.discoveryFilters.reduce(CGFloat.zero) { height, option in
            height + max(44, filterRowHeights[option] ?? 44)
        }
    }

    private var filterButtonTitle: String {
        if filters.isEmpty { return "Filters" }
        if filters.count == 1 { return selectedFilterTitles.first ?? "Filters" }
        return "Filters (\(filters.count))"
    }

    private func locationsList(_ values: [Place]) -> some View {
        List {
            Section {
                ForEach(Array(values.prefix(visibleCount))) { place in
                    Button { select(place, source: filters.contains(.saved) ? .savedPlaces : .list) } label: {
                        NativePlaceRow(place: place, rating: store.ratings[place.id], saved: store.savedIDs.contains(place.id), origin: location.coordinate)
                    }
                    .buttonStyle(.automatic).accessibilityIdentifier("place-" + place.id)
                }
                if values.count > visibleCount {
                    Button("Show 50 more") { visibleCount += 50 }.frame(maxWidth: .infinity, minHeight: 44)
                }
            } header: {
                HStack {
                    Text("\(values.count.formatted()) \(values.count == 1 ? "location" : "locations")")
                    Spacer()
                    Text(hasNYCOrigin ? "Nearest first" : "Name A–Z")
                }.font(.footnote).textCase(nil)
            } footer: {
                if hasNYCOrigin { Text("Distances are straight-line estimates.") }
            }
        }
        .listStyle(.plain).scrollDismissesKeyboard(.interactively)
        .background(RRStyle.surface).accessibilityIdentifier("restroom-list")
    }

    private var hasNYCOrigin: Bool {
        location.coordinate.map { Place.containsNYC(latitude: $0.latitude, longitude: $0.longitude) } ?? false
    }

    private func setDisplay(_ next: DiscoveryDisplay) {
        guard display != next else { return }
        NativeAnalytics.track(.browseMode(next == .map ? .map : .list))
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.22)) {
            display = next
        }
        if sheet == nil { NativeAnalytics.track(.screen(discoveryAnalyticsScreen)) }
    }

    private func returnToMainMap() {
        let wasMap = display == .map
        searchFocused = false
        query = ""
        filters.removeAll()
        setDisplay(.map)
        if wasMap { NativeAnalytics.track(.screen(.finder)) }
    }

    private var needsSavedState: Bool {
        filters.contains(.saved) && (store.user == nil || store.privateLoading || store.libraryError != nil)
    }

    private var savedState: some View {
        VStack(spacing: 14) {
            if filters.contains(.saved) && store.user == nil {
                Image(systemName: "bookmark").font(.largeTitle).foregroundStyle(RRStyle.ink)
                Text("Your saved places").font(.title3.weight(.semibold))
                Text("Sign in to save a place for next time.").font(.body).foregroundStyle(.secondary)
                Button { resumeAddAfterSignIn = false; present(.account) } label: {
                    RRProminentButtonLabel(title: "Sign in")
                }.buttonStyle(.borderedProminent).controlSize(.large)
            } else if filters.contains(.saved) && store.privateLoading {
                ProgressView("Loading saved places…")
            } else if filters.contains(.saved), store.libraryError != nil {
                Text("Saved places couldn’t load.").font(.headline)
                Button("Try again") { Task { await store.refreshAccount() } }.buttonStyle(.bordered)
            }
        }
        .multilineTextAlignment(.center).padding(24)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
    }

    private func submitSearch() {
        searchFocused = false
        let matches = results()
        NativeAnalytics.track(.searchSubmit(results: resultsReadiness == .ready ? .from(matches.count) : .unknown))
        guard !matches.isEmpty else { return }
        focus = MapFocus(coordinate: matches[0].coordinate, coordinates: matches.map(\.coordinate))
    }

    private var resultsReadiness: DiscoveryResultsReadiness {
        .evaluate(filters: filters, publicLoading: store.publicLoading, publicFailed: store.publicFeedError != nil,
                  ratingsLoading: store.ratingsLoading, ratingsFailed: store.ratingsFeedError != nil,
                  signedIn: store.user != nil, privateLoading: store.privateLoading, privateFailed: store.libraryError != nil,
                  accessDetailsLoading: store.accessDetailsLoading, accessDetailsFailed: store.accessDetailsFeedError != nil)
    }

    private func select(_ place: Place, source: NativeAnalyticsSource) {
        if source == .search {
            NativeAnalytics.track(.searchSubmit(results: resultsReadiness == .ready ? .from(results().count) : .unknown))
        }
        searchFocused = false
        resumeAddAfterSignIn = false
        present(.place(place, origin: source))
    }

    private func present(_ requested: DiscoverySheet) {
        // A changed .sheet(item:) identity may reuse a native presentation at
        // large height. Finish dismissal before presenting a fresh place.
        // One queue also lets newer root intents supersede a pending pin tap.
        accountPlaceToOpen = nil
        submittedRestroomRequest = nil
        if sheet != nil || pendingSheet != nil {
            pendingSheet = requested
            sheet = nil
        } else {
            if let place = requested.place {
                if placeDetent != .medium { ignoreInitialDetentReset = true }
                placeDetent = .medium
                focus = MapFocus(coordinate: place.coordinate)
                if case .place(_, let origin) = requested { NativeAnalytics.track(.cardOpen(origin)) }
            }
            sheet = requested
        }
    }

    private func requestNewPlace() {
        searchFocused = false
        resumeAddAfterSignIn = true
        if store.user == nil {
            present(.account)
        } else {
            resumeAddAfterSignIn = false
            present(.newPlace)
        }
    }

    private func completeAddSignIn() {
        guard resumeAddAfterSignIn, store.user != nil, !store.authBusy,
              case .account = sheet else { return }
        sheet = nil
    }

    private func sheetDismissed() {
        guard sheet == nil else { pendingSheet = nil; return }
        store.selectPlace(nil)
        if let requested = pendingSheet {
            pendingSheet = nil
            present(requested)
        } else if let selection = accountPlaceToOpen {
            accountPlaceToOpen = nil
            select(allPlaces.first(where: { $0.id == selection.place.id }) ?? selection.place, source: selection.source)
        } else if let request = submittedRestroomRequest {
            submittedRestroomRequest = nil
            submissionNoticeTitle = request.state.status == .pending ? "Submitted for review" : request.state.status.title
            submissionNoticeMessage = request.state.status.confirmationMessage
            showsSubmissionNotice = true
            NativeAnalytics.track(.screen(discoveryAnalyticsScreen))
        } else if resumeAddAfterSignIn {
            resumeAddAfterSignIn = false
            if store.user != nil { sheet = .newPlace }
            else { NativeAnalytics.track(.screen(discoveryAnalyticsScreen)) }
        } else { NativeAnalytics.track(.screen(discoveryAnalyticsScreen)) }
    }

    private func focusOnUser() {
        guard let coordinate = location.coordinate, CLLocationCoordinate2DIsValid(coordinate) else { return }
        let requested = locatingByUser
        locatingByUser = false
        // An automatic fix should not replace an active search or leave List unexpectedly.
        guard requested || (query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && sheet == nil) else { return }
        hideLocationNotice = false
        focus = MapFocus(coordinate: coordinate)
        if requested { display = .map }
    }

    private var locationNotice: String? {
        guard !hideLocationNotice else { return nil }
        if let coordinate = location.coordinate,
           !Place.containsNYC(latitude: coordinate.latitude, longitude: coordinate.longitude) {
            return "You’re outside NYC. Search for a NYC place or address."
        }
        return location.message
    }

    private func locationBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 8) {
                Text(message).font(.footnote)
                if location.authorizationDenied {
                    Button("Open Settings") { openURL(URL(string: UIApplication.openSettingsURLString)!) }
                        .font(.subheadline).frame(minHeight: 44)
                }
            }
            Spacer(minLength: 0)
            Button { hideLocationNotice = true } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }
                .accessibilityLabel("Dismiss location message")
        }.padding(12).rrGlassSurface(cornerRadius: 16, interactive: false)
    }

    private func mapInsets(in geometry: GeometryProxy) -> UIEdgeInsets {
        let detail = sheet?.place != nil
        let controlsHeight: CGFloat = (locationNotice == nil ? 92 : 172) + (showsMapAddButton ? 56 : 0)
        return UIEdgeInsets(top: geometry.safeAreaInsets.top + 76, left: 28,
                            bottom: detail ? geometry.size.height * 0.52 : geometry.safeAreaInsets.bottom + controlsHeight, right: 28)
    }
}

private struct NativePlaceRow: View {
    let place: Place
    let rating: RatingSummary?
    let saved: Bool
    let origin: CLLocationCoordinate2D?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text(place.name).font(.headline).foregroundStyle(RRStyle.ink)
                if let address = place.address { Text(address).font(.subheadline).foregroundStyle(.secondary) }
                HStack(spacing: 8) {
                    Text(place.locationType).font(.caption)
                    if let rating, rating.ratingCount > 0 {
                        Label(rating.average.formatted(.number.precision(.fractionLength(1))), systemImage: "star.fill")
                            .font(.caption).foregroundStyle(RRStyle.ink)
                    }
                    if let distanceText { Text(distanceText).font(.caption) }
                }.foregroundStyle(.secondary)
                if place.isCommunity { Text(RRLabels.entry(place.entryRule ?? "unknown")).font(.caption).foregroundStyle(.secondary) }
            }.frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: saved ? "bookmark.fill" : "chevron.right")
                .font(.subheadline).foregroundStyle(saved ? RRStyle.ink : RRStyle.faint).padding(.top, 4)
        }
        .padding(.vertical, 8).frame(minHeight: 60)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine).accessibilityHint("View entry, route and dated reports")
    }

    private var distanceText: String? {
        guard let origin, Place.containsNYC(latitude: origin.latitude, longitude: origin.longitude) else { return nil }
        let distance = CLLocation(latitude: origin.latitude, longitude: origin.longitude).distance(from: CLLocation(latitude: place.latitude, longitude: place.longitude))
        return Measurement(value: distance, unit: UnitLength.meters).formatted(.measurement(width: .abbreviated, usage: .road))
    }
}
