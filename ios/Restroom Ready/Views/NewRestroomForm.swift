import SwiftUI
import MapKit
import UIKit

struct NewRestroomForm: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    let store: NativeStore
    var onSubmitted: (OwnRestroomRequest) -> Void
    @State private var draft = NewPlaceDraft()
    @State private var addressSearch = AddressSearch()
    @State private var location = LocationService()
    @State private var code = ""
    @State private var visibility = "private"
    @State private var includeObservationDate = false
    @State private var observationDate = Date()
    @State private var wantsNearby = false
    @State private var choosingVenue = true
    @State private var suggestedVenueName: String?
    @State private var attempt: NewPlaceDraft?
    @State private var analyticsLocatePending = false

    private var isRequestFormReview: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-review-restroom-request-form")
        #else
        false
        #endif
    }

    init(store: NativeStore, onSubmitted: @escaping (OwnRestroomRequest) -> Void) {
        self.store = store; self.onSubmitted = onSubmitted
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-review-restroom-request-form"),
           let place = (try? CitySnapshot.load())?.places.first(where: { $0.id == "i7jb-7jku:row-tmt8_zzvc_8g8v" }) {
            // Local presentation only: a real directory pin, a labeled example
            // draft, no synthetic Auth identity, and submission is disabled.
            var preview = NewPlaceDraft()
            preview.name = "Presentation-only request"
            preview.address = place.address ?? ""; preview.latitude = place.latitude; preview.longitude = place.longitude
            _draft = State(initialValue: preview); _choosingVenue = State(initialValue: false)
        }
        #endif
    }

    private var pin: CLLocationCoordinate2D? {
        guard let latitude = draft.latitude, let longitude = draft.longitude else { return nil }
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    private var valid: Bool {
        let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let address = draft.address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.utf16.count <= 120, !address.isEmpty, address.utf16.count <= 240,
              draft.notes.utf16.count <= 1_000, let pin,
              [name, address, draft.notes].allSatisfy(PublicTextSafety.allows),
              Place.containsNYC(latitude: pin.latitude, longitude: pin.longitude) else { return false }
        let value = code.trimmingCharacters(in: .whitespacesAndNewlines)
        return draft.passcodeRequired != "yes" || value.isEmpty || (value.utf8.count <= 40
            && value.unicodeScalars.allSatisfy { $0.value >= 32 && $0.value <= 126 }
            && PublicTextSafety.allowsCodeSharing(value, visibility: visibility))
    }

    private var isDirty: Bool {
        pin != nil || !draft.name.isEmpty || !draft.address.isEmpty || !addressSearch.query.isEmpty ||
        !draft.notes.isEmpty || !code.isEmpty || includeObservationDate
    }

    var body: some View {
        NavigationStack {
            RRFormSurface {
                #if DEBUG
                if isRequestFormReview {
                    Section {
                        Text("Local request preview. Submission is disabled.")
                            .font(.footnote).foregroundStyle(RRStyle.faint)
                    } header: { Text("Presentation-only request form") }
                }
                #endif
                Section {
                    if let pin {
                        Map(initialPosition: .region(MKCoordinateRegion(center: pin, span: MKCoordinateSpan(latitudeDelta: 0.005, longitudeDelta: 0.005))), interactionModes: []) {
                            Marker(draft.name.isEmpty ? "Chosen venue" : draft.name, coordinate: pin).tint(RRStyle.blue)
                        }
                        .frame(height: 150)
                        .id("\(pin.latitude),\(pin.longitude)")
                        .accessibilityLabel("Selected venue pin, latitude \(pin.latitude), longitude \(pin.longitude)")
                    }
                    if pin == nil || choosingVenue {
                        addressSearchRows
                    } else {
                        Button("Choose a different venue", systemImage: "mappin.and.ellipse") { choosingVenue = true }
                            .frame(minHeight: 44)
                    }
                } header: {
                    Text("Venue location")
                } footer: {
                    Text(pin == nil
                         ? "Search an address or find places near you, then select the actual venue. Your GPS position is not published."
                         : "The chosen address and pin belong to this venue. Your current GPS position is not its public pin.")
                }
                .disabled(store.busy || attempt != nil)

                if pin != nil {
                    Section {
                        RRField("Venue name") {
                            TextField("Name of the place", text: $draft.name).textInputAutocapitalization(.words)
                        }
                        RRField("Public address") {
                            TextField("Street address", text: $draft.address, axis: .vertical)
                                .textInputAutocapitalization(.words)
                        }
                        Picker("Location type", selection: $draft.locationType) {
                            Text("Park").tag("park")
                            Text("Library").tag("library")
                            Text("Café").tag("cafe")
                            Text("Restaurant").tag("restaurant")
                            Text("Store").tag("store")
                            Text("Other").tag("other")
                        }.pickerStyle(.navigationLink)
                    } header: {
                        Text("Venue details")
                    } footer: {
                        Text("Moderators review these details before they appear on the map. You can correct the address without moving the pin.")
                    }
                    .disabled(store.busy || attempt != nil)

                    Section {
                        Picker("Entry permission", selection: $draft.entryRule) {
                            Text("Not reported").tag("unknown")
                            Text("Public entry").tag("public")
                            Text("Customers only").tag("customers")
                        }.pickerStyle(.navigationLink)
                        AnswerPicker(title: "Code required", selection: $draft.passcodeRequired, unknown: "unknown")
                            .accessibilityIdentifier("restroom-request-code-required")
                        AnswerPicker(title: "Accessible", selection: $draft.stepFreeAccess, unknown: "unknown")
                    } header: {
                        Text("Entry and route")
                    } footer: {
                        Text("Step-free means from the street entrance to the restroom. It does not certify an accessible stall.")
                    }
                    .disabled(store.busy || attempt != nil)

                    Section {
                        RRField("Entry and route notes (optional)") {
                            TextField("Fees, keys, floor or route inside", text: $draft.notes, axis: .vertical)
                                .lineLimit(3...8)
                                .textInputAutocapitalization(.sentences)
                        }
                        if draft.notes.utf16.count > 1_000 { RRIssue(message: "Keep notes within 1,000 characters.") }
                        if ![draft.name, draft.address, draft.notes].allSatisfy(PublicTextSafety.allows) {
                            RRIssue(message: PublicTextSafetyError.objectionable.localizedDescription)
                        }
                    } footer: {
                        Text("These notes become public if approved. No personal or contact information. Up to 1,000 characters.")
                    }
                    .disabled(store.busy || attempt != nil)

                    if draft.passcodeRequired == "yes" {
                        Section {
                            RRField("Restroom code (optional)") {
                                TextField("Enter the code", text: $code)
                                    .font(.body.monospaced())
                                    .keyboardType(.asciiCapable)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .accessibilityIdentifier("restroom-request-code")
                            }
                            if !code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                CodeVisibilityPicker(visibility: $visibility)
                                if !PublicTextSafety.allowsCodeSharing(code, visibility: visibility) {
                                    RRIssue(message: PublicTextSafetyError.objectionable.localizedDescription)
                                }
                            }
                        } header: {
                            Text("Restroom code")
                        } footer: {
                            Text(code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                 ? "You can add a code later. A code does not establish permission to enter."
                                 : visibility == "private"
                                 ? "If approved, this code stays in your account and the venue is added to Saved. Submitting does not verify successful use."
                                 : "If approved, this code becomes public with the venue. Only you can change its visibility. Submitting does not verify successful use.")
                        }
                        .disabled(store.busy || attempt != nil)
                    }

                    Section {
                        Toggle("I know when I visited", isOn: $includeObservationDate)
                        if includeObservationDate {
                            DatePicker("Visited", selection: $observationDate, in: Date(timeIntervalSince1970: 946_684_800)...Date(), displayedComponents: .date)
                                .environment(\.timeZone, TimeZone(identifier: "America/New_York")!)
                        }
                    } header: {
                        Text("Observation date")
                    } footer: {
                        if !includeObservationDate { Text("The observation date will be Not reported.") }
                    }
                    .disabled(store.busy || attempt != nil)
                }

                if let error = store.error { Section { RRIssue(message: error) } }
                if attempt != nil {
                    Section { RRInfo(message: "Your exact request is kept for a safe retry. Check Restroom requests in Account before submitting it again.") }
                }
            }
            .navigationTitle("Add restroom")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(store.busy ? "Submitting…" : attempt == nil ? "Submit request" : "Retry submission") { save() }
                        .fontWeight(.semibold)
                        .disabled(isRequestFormReview || store.busy || store.user == nil || (!valid && attempt == nil))
                        .accessibilityIdentifier("submit-restroom-request")
                }
            }
            .rrFormDismissal(isDirty: isDirty, busy: store.busy, hasAttempt: attempt != nil,
                onCancel: { NativeAnalytics.track(.formCancel(.newRestroom)) })
            .rrFormAnalytics(.newRestroom, screen: .newRestroom)
            .onDisappear { addressSearch.cancel() }
            .onChange(of: store.user?.uid) { _, _ in dismiss() }
            .onChange(of: location.isLocating) { _, _ in recordLocateResult() }
            .onChange(of: location.coordinate?.latitude) { _, _ in
                guard wantsNearby, let coordinate = location.coordinate else { return }
                wantsNearby = false
                Task { await addressSearch.search(near: coordinate) }
            }
        }
        .tint(RRStyle.ink)
    }

    @ViewBuilder private var addressSearchRows: some View {
        RRField("Search a NYC address or place") {
            TextField("Address or venue", text: $addressSearch.query)
                .textInputAutocapitalization(.words)
                .submitLabel(.search)
                .onSubmit { searchAddress() }
        }
        Button("Search address", systemImage: "magnifyingglass") { searchAddress() }
            .frame(minHeight: 44)
            .disabled(addressSearch.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || addressSearch.isSearching)
        Button("Find places near me", systemImage: "location") { searchNearby() }
            .frame(minHeight: 44)
            .disabled(location.isLocating || addressSearch.isSearching)
        if addressSearch.isSearching || location.isLocating {
            ProgressView(location.isLocating ? "Finding your location…" : "Searching places…")
        }
        if let message = location.message { Text(message).font(.footnote).foregroundStyle(RRStyle.faint) }
        if location.authorizationDenied {
            Button("Open location settings") { openURL(URL(string: UIApplication.openSettingsURLString)!) }
                .frame(minHeight: 44)
        }
        if let accuracy = location.accuracy {
            Text("GPS accuracy: about \(Int(accuracy.rounded())) m. Select the actual venue below.")
                .font(.footnote).foregroundStyle(RRStyle.faint)
        }
        if let error = addressSearch.error { RRIssue(message: error) }
        ForEach(addressSearch.results) { candidate in
            Button {
                NativeAnalytics.track(.venueSelect)
                draft.latitude = candidate.latitude
                draft.longitude = candidate.longitude
                draft.address = candidate.address
                if draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.name == suggestedVenueName {
                    draft.name = candidate.name
                }
                suggestedVenueName = candidate.name
                choosingVenue = false
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            } label: {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(candidate.name).foregroundStyle(RRStyle.ink)
                        Text(candidate.address).font(.subheadline).foregroundStyle(RRStyle.faint)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: draft.latitude == candidate.latitude && draft.longitude == candidate.longitude ? "checkmark.circle.fill" : "mappin.circle")
                        .foregroundStyle(RRStyle.ink)
                }.frame(minHeight: 44)
            }
            .accessibilityHint("Selects this address and venue pin together.")
        }
    }

    private func searchAddress() {
        wantsNearby = false
        NativeAnalytics.track(.searchSubmit(results: .unknown, context: .address))
        Task { await addressSearch.search(near: nil) }
    }

    private func searchNearby() {
        addressSearch.query = ""
        NativeAnalytics.track(.locateRequest)
        if let coordinate = location.coordinate {
            NativeAnalytics.track(.locateResult(Place.containsNYC(latitude: coordinate.latitude, longitude: coordinate.longitude) ? .success : .outsideNYC))
            Task { await addressSearch.search(near: coordinate) }
        } else {
            wantsNearby = true
            analyticsLocatePending = true
            location.requestLocation()
            recordLocateResult()
        }
    }

    private func recordLocateResult() {
        guard analyticsLocatePending, !location.isLocating else { return }
        analyticsLocatePending = false
        let result: NativeAnalyticsLocationOutcome
        if location.authorizationDenied { result = .permissionDenied }
        else if let coordinate = location.coordinate {
            result = Place.containsNYC(latitude: coordinate.latitude, longitude: coordinate.longitude) ? .success : .outsideNYC
        } else { result = .unavailable }
        NativeAnalytics.track(.locateResult(result))
    }

    private func save() {
        guard !isRequestFormReview else { return }
        if attempt == nil {
            var submission = draft
            submission.observedOn = includeObservationDate ? observationDate : nil
            let value = code.trimmingCharacters(in: .whitespacesAndNewlines)
            submission.code = submission.passcodeRequired == "yes" && !value.isEmpty ? CodeDraft(code: value, visibility: visibility) : nil
            attempt = submission
        }
        guard let attempt else { return }
        Task { if let request = await store.submitRestroomRequest(draft: attempt) { onSubmitted(request) } }
    }
}
