import Foundation
import CoreFoundation
import Observation
import UIKit
@preconcurrency import FirebaseCore
@preconcurrency import FirebaseAuth
@preconcurrency import FirebaseFirestore
@preconcurrency import GoogleSignIn

private final class NativeListeners: @unchecked Sendable {
    var publicFeeds: [ListenerRegistration] = []
    var details: [ListenerRegistration] = []
    var own: ListenerRegistration?
    var ownCodeReports: ListenerRegistration?
    var codeFeedback: [ListenerRegistration] = []
    var auth: (Auth, AuthStateDidChangeListenerHandle)?
    func clearDetails() {
        details.forEach { $0.remove() }; details = []; own?.remove(); own = nil
        ownCodeReports?.remove(); ownCodeReports = nil
        codeFeedback.forEach { $0.remove() }; codeFeedback = []
    }
    deinit {
        publicFeeds.forEach { $0.remove() }; details.forEach { $0.remove() }; own?.remove()
        ownCodeReports?.remove(); codeFeedback.forEach { $0.remove() }
        if let (auth, handle) = auth { auth.removeStateDidChangeListener(handle) }
    }
}

private func assertNativeAccount(_ auth: Auth, _ uid: String) throws {
    guard !uid.isEmpty, uid.utf16.count <= 128, !uid.contains("/"), auth.currentUser?.uid == uid, auth.currentUser?.isAnonymous == false else {
        throw NativeDataError("Your account changed. Sign in again and refresh before retrying this request.")
    }
}

/// A callback can replace a session with the same UID. UID equality alone is insufficient.
private final class NativeSessionEpoch: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    func advance() { lock.lock(); value += 1; lock.unlock() }
    func current() -> Int { lock.lock(); defer { lock.unlock() }; return value }
}

private struct NativeMutationScope: @unchecked Sendable {
    let uid: String
    let auth: Auth
    let epoch: NativeSessionEpoch
    let generation: Int
    func check() throws {
        try assertNativeAccount(auth, uid)
        guard epoch.current() == generation else { throw NativeDataError("Your account session changed during this request. Refresh and check the result before retrying.") }
    }
}

/// The SDK can evaluate rules against stale aggregate reads before retrying a
/// contending transaction. Keep only in-memory prewrite evidence for that case.
private final class NativeCodeFeedbackAttempt: @unchecked Sendable {
    private let lock = NSLock()
    private var before: [Timestamp?]?
    func record(_ summary: DocumentSnapshot, _ vote: DocumentSnapshot) {
        lock.lock(); defer { lock.unlock() }
        before = [summary.data()?["updatedAt"] as? Timestamp, vote.data()?["updatedAt"] as? Timestamp]
    }
    func changed(_ summary: DocumentSnapshot, _ vote: DocumentSnapshot) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard let before else { return false }
        return Self.advanced(summary.data()?["updatedAt"] as? Timestamp, from: before[0])
            || Self.advanced(vote.data()?["updatedAt"] as? Timestamp, from: before[1])
    }
    func voteChanged(_ vote: DocumentSnapshot) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard let before else { return false }
        return Self.advanced(vote.data()?["updatedAt"] as? Timestamp, from: before[1])
    }
    private static func advanced(_ after: Timestamp?, from before: Timestamp?) -> Bool {
        guard let after else { return false }
        return before.map { after.compare($0) == .orderedDescending } ?? true
    }
}

/// A bearer token must never follow a server redirect to another endpoint.
private final class NativeDeletionRedirectGuard: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

private struct NativePendingAccountDeletion {
    var attempt: AccountDeletionAttempt
    let idToken: String
    let expiresAt: Date
    let googleID: String?
}

/// A native client of the existing production schemas. No alternate or simulated write path.
@MainActor @Observable
final class NativeStore {
    var user: FirebaseAuth.User?
    var authBusy = false
    var busy = false
    var error: String?
    var publicLoading = true
    var ratingsLoading = true
    var accessDetailsLoading = true
    var privateLoading = false
    var detailsLoading = false
    var ownCodeLoading = false
    var ownRatingLoading = false
    var ownCodeError: String?
    var ownRatingError: String?
    var codeFeedError: String?
    var visitFeedError: String?
    var sourceFeedError: String?
    var publicNotesLoading = false
    var publicNotesFeedError: String?
    var ownPublicNotesLoading = false
    var ownPublicNotesError: String?
    var ownContributions: [OwnPublicContribution] = []
    var ownContributionsLoading = false
    var ownContributionsError: String?
    var ownContributionsTruncated = false
    var ownRestroomRequests: [OwnRestroomRequest] = []
    var ownRestroomRequestsLoading = false
    var ownRestroomRequestsError: String?
    var ownRestroomRequestsTruncated = false
    var libraryError: String?
    var publicFeedError: String?
    var ratingsFeedError: String?
    var accessDetailsFeedError: String?
    var communityPlaces: [Place] = []
    var ratings: [String: RatingSummary] = [:]
    var accessDetails: [String: RestroomAccessDetails] = [:]
    var savedIDs: Set<String> = []
    var notes: [PrivateNote] = []
    var publicCodes: [PasscodeReport] = []
    var ownCode: OwnPasscode?
    var publicCodeReports: [PublicCodeReport] = []
    private var listedOwnCodeReports: [OwnCodeReport] = []
    private var publicCodeOwnership: [String: OwnCodeReport] = [:]
    private var codeOwnershipReads = Set<String>()
    var ownCodeReports: [OwnCodeReport] {
        var records = Dictionary(uniqueKeysWithValues: listedOwnCodeReports.map { ($0.id, $0) })
        for record in publicCodeOwnership.values { records[record.id] = record }
        return records.values.sorted {
            let order = $0.versionTimestamp.compare($1.versionTimestamp)
            return order == .orderedSame ? $0.id > $1.id : order == .orderedDescending
        }
    }
    var ownCodeReportsLoading = false
    var ownCodeReportsError: String?
    private var legacyCodesLoading = false
    private var codeReportsLoading = false
    private var codeReportsError: String?
    private var codeFeedbackError: String?
    private var codeEvidenceGeneration = 0
    private var codeSummaries: [String: CodeFeedbackSummary] = [:]
    private var codeVotes: [String: CodeFeedbackVote] = [:]
    private var codeSummaryReads = Set<String>()
    private var codeVoteReads = Set<String>()
    var codeEvidenceLoading: Bool { legacyCodesLoading || codeReportsLoading }
    var codeEvidenceError: String? { codeFeedError ?? codeReportsError ?? codeFeedbackError }

    var codeEvidence: [CodeEvidence] {
        let signedIn = user != nil && user?.isAnonymous == false
        let ownershipReady = !signedIn || (!ownCodeLoading && ownCodeError == nil && !ownCodeReportsLoading && ownCodeReportsError == nil)
        func evidence(_ source: CodeEvidenceSource, _ id: String, _ place: String, _ code: String,
                      _ updated: Date, _ verified: Date?, _ version: String, _ visibility: String, _ owned: Bool) -> CodeEvidence {
            let key = source.rawValue + ":" + id
            let summary = codeSummaries[key].flatMap { "\($0.versionTimestamp.seconds):\($0.versionTimestamp.nanoseconds)" == version ? $0 : nil }
            let vote = codeVotes[key].flatMap { "\($0.versionTimestamp.seconds):\($0.versionTimestamp.nanoseconds)" == version ? $0.vote : nil }
            let missing = codeSummaryReads.contains(key) && codeSummaries[key] == nil
            let legacyTime = source == .legacy ? publicCodes.first(where: { $0.reportID == id && $0.codeVersion == version })?.verificationTimestamp : nil
            let legacyVersion = source == .legacy ? legacyTime.map { "\($0.seconds):\($0.nanoseconds)" }
                ?? verified.flatMap(CodeTimestampVersion.init(date:))?.description : nil
            let feedbackVersion = summary?.lastUsedTimestamp.map { "\($0.seconds):\($0.nanoseconds)" }
            let verifiedVersion = visibility == "private" ? nil
                : CodeEvidencePresentation.latestVerificationVersion(legacy: legacyVersion, feedback: feedbackVersion)
            return CodeEvidence(source: source, placeID: place, reportID: id, code: code, updatedAt: updated,
                verifiedAt: visibility == "private" ? verified : verifiedVersion.flatMap(CodeTimestampVersion.init)?.date,
                version: version, visibility: visibility,
                ownership: owned ? .own : (source == .report && signedIn ? codeOwnershipReads.contains(key) : ownershipReady) ? .other : .unknown,
                positiveCount: summary?.usedCount ?? (missing ? 0 : nil), invalidCount: summary?.invalidCount ?? (missing ? 0 : nil),
                currentFeedback: vote, feedbackLoaded: codeSummaryReads.contains(key) && (!signedIn || owned || codeVoteReads.contains(key)),
                verifiedVersion: verifiedVersion)
        }
        var records = publicCodes.map { item in
            evidence(.legacy, item.reportID, item.placeID, item.code, item.codeUpdatedAt, item.lastVerifiedAt,
                     item.codeVersion, "public", ownCode?.reportID == item.reportID)
        }
        records += publicCodeReports.map { item in
            evidence(.report, item.id, item.placeID, item.code, item.codeUpdatedAt, nil, item.codeVersion, "public",
                     ownCodeReports.contains { $0.id == item.id })
        }
        if let own = ownCode, !records.contains(where: { $0.source == .legacy && $0.reportID == own.reportID }) {
            records.append(evidence(.legacy, own.reportID, own.placeID, own.code, own.codeUpdatedAt, own.lastVerifiedAt, own.codeVersion, own.visibility, true))
        }
        for own in ownCodeReports where !records.contains(where: { $0.source == .report && $0.reportID == own.id }) {
            records.append(evidence(.report, own.id, own.placeID, own.code, own.codeUpdatedAt, own.lastVerifiedAt, own.codeVersion, own.visibility, true))
        }
        return CodeEvidencePresentation.sorted(records)
    }
    var ownStars: Double?
    var visitReports: [VisitReport] = []
    private var legacyVisitReports: [VisitReport] = []
    private var unifiedVisitReports: [VisitReport] = []
    private var legacyVisitError: String?
    private var unifiedVisitError: String?
    private var visitOwnershipGeneration = 0
    var sourceComments: [SourceComment] = []
    var researchProfile: CardResearchProfile?
    var researchProfileLoading = false
    var researchProfileError: String?
    var ownVisitIDs: Set<String> = []
    var publicNotes: [PublicNote] = []
    var ownPublicNoteIDs: Set<String> = []
    @ObservationIgnored private let auth: Auth
    @ObservationIgnored private let db: Firestore
    @ObservationIgnored private let listeners = NativeListeners()
    @ObservationIgnored private let sessionEpoch = NativeSessionEpoch()
    @ObservationIgnored private var selectedID: String?
    @ObservationIgnored private var accountGeneration = 0
    @ObservationIgnored private var selectionGeneration = 0
    @ObservationIgnored private var publicNoteOwnershipGeneration = 0
    @ObservationIgnored private var ownContributionsGeneration = 0
    @ObservationIgnored private var ownContributionsRequested = false
    @ObservationIgnored private var ownRestroomRequestsGeneration = 0
    @ObservationIgnored private var ownRestroomRequestsRequested = false
    @ObservationIgnored private var started = false
    @ObservationIgnored private var publicGeneration = 0
    @ObservationIgnored private var detailFeedsPending: Set<String> = []
    @ObservationIgnored private var appleSignInCoordinator: NativeAppleSignIn?
    @ObservationIgnored private var pendingAccountDeletion: NativePendingAccountDeletion?
    @ObservationIgnored private var pendingDeletionExpiry: Task<Void, Never>?

    init() {
        precondition(FirebaseApp.app()?.options.projectID == "nye-restroom", "Configure the nye-restroom iOS Firebase app before NativeStore.")
        auth = Auth.auth()
        db = Firestore.firestore()
        let settings = db.settings
        settings.cacheSettings = MemoryCacheSettings()
        db.settings = settings
        user = auth.currentUser
        let handle = auth.addStateDidChangeListener { [weak self] _, user in
            Task { @MainActor [weak self] in self?.accountChanged(user) }
        }
        listeners.auth = (auth, handle)
    }

    private func accountChanged(_ next: FirebaseAuth.User?) {
        let refreshContributions = next?.uid == user?.uid && ownContributionsRequested
        let refreshRequests = next?.uid == user?.uid && ownRestroomRequestsRequested
        if next?.uid != user?.uid || next == nil { ownContributionsRequested = false }
        if next?.uid != user?.uid || next == nil { ownRestroomRequestsRequested = false }
        clearPendingAccountDeletion()
        sessionEpoch.advance()
        accountGeneration += 1
        user = next; savedIDs = []; notes = []; ownCode = nil; ownStars = nil; ownVisitIDs = []
        listedOwnCodeReports = []; publicCodeOwnership = [:]; codeOwnershipReads = []; ownCodeReportsLoading = false; ownCodeReportsError = nil
        listeners.ownCodeReports?.remove(); listeners.ownCodeReports = nil
        publicNoteOwnershipGeneration += 1; ownPublicNoteIDs = []
        ownPublicNotesLoading = false; ownPublicNotesError = nil
        ownContributionsGeneration += 1; ownContributions = []
        ownContributionsLoading = false; ownContributionsError = nil; ownContributionsTruncated = false
        ownRestroomRequestsGeneration += 1; ownRestroomRequests = []
        ownRestroomRequestsLoading = false; ownRestroomRequestsError = nil; ownRestroomRequestsTruncated = false
        listeners.own?.remove(); listeners.own = nil
        privateLoading = next != nil; libraryError = nil; ownCodeLoading = false; ownRatingLoading = false; ownCodeError = nil; ownRatingError = nil
        if let next, !next.isAnonymous {
            let generation = accountGeneration
            Task { [weak self] in await self?.loadLibrary(uid: next.uid, generation: generation) }
            if refreshContributions { Task { [weak self] in await self?.loadOwnContributions() } }
            if refreshRequests { Task { [weak self] in await self?.loadOwnRestroomRequests() } }
            startOwnDetail()
        } else { privateLoading = false; restartCodeFeedback() }
    }

    func publicStart() {
        guard !started else { return }; started = true
        publicGeneration += 1
        let generation = publicGeneration
        let community = db.collection("communityRestrooms").order(by: "submittedAt", descending: true).limit(to: 1000)
        listeners.publicFeeds.append(community.addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, failure in
            Task { @MainActor [weak self] in
                guard let self, self.publicGeneration == generation else { return }
                if failure != nil { self.publicLoading = false; self.publicFeedError = "Community locations could not load. The dated city collection is still available."; self.error = self.publicFeedError; return }
                guard let snapshot, !snapshot.metadata.isFromCache, !snapshot.metadata.hasPendingWrites else { return }
                var hidden = false
                self.communityPlaces = snapshot.documents.compactMap { item in
                    do { return try Self.decodeCommunity(item.documentID, item.data()) }
                    catch { hidden = true; return nil }
                }
                self.publicLoading = false
                self.publicFeedError = hidden ? "Some community locations had invalid details and are hidden." : nil
                if hidden { self.error = self.publicFeedError }
            }
        })
        let access = db.collection("restroomAccessDetails").limit(to: 1000)
        listeners.publicFeeds.append(access.addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, failure in
            Task { @MainActor [weak self] in
                guard let self, self.publicGeneration == generation else { return }
                if failure != nil {
                    self.accessDetailsLoading = false
                    self.accessDetailsFeedError = "Entrance and route details could not load. Retry before relying on these reports."
                    self.error = self.accessDetailsFeedError
                    return
                }
                guard let snapshot, !snapshot.metadata.isFromCache, !snapshot.metadata.hasPendingWrites else { return }
                var result: [String: RestroomAccessDetails] = [:], hidden = false
                for item in snapshot.documents {
                    do { result[item.documentID] = try Self.decodeAccessDetails(item.documentID, item.data()) }
                    catch { hidden = true }
                }
                self.accessDetails = result
                self.accessDetailsLoading = false
                self.accessDetailsFeedError = hidden ? "Some entrance and route reports had invalid details and are unavailable." : nil
                if hidden { self.error = self.accessDetailsFeedError }
            }
        })
        let totals = db.collection("restroomRatingSummaries").whereField("ratingCount", isGreaterThan: 0)
        listeners.publicFeeds.append(totals.addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, failure in
            Task { @MainActor [weak self] in
                guard let self, self.publicGeneration == generation else { return }
                if failure != nil { self.ratingsLoading = false; self.ratingsFeedError = "Public ratings could not load. Unavailable ratings are not treated as zero."; self.error = self.ratingsFeedError; return }
                guard let snapshot, !snapshot.metadata.isFromCache, !snapshot.metadata.hasPendingWrites else { return }
                self.ratingsLoading = false
                var result: [String: RatingSummary] = [:], hidden = false
                for item in snapshot.documents {
                    do { result[item.documentID] = try NativeSchema.summary(item.documentID, item.data()) }
                    catch { hidden = true }
                }
                self.ratings = result
                self.ratingsFeedError = hidden ? "Some public ratings had invalid details and are hidden." : nil
                if hidden { self.error = self.ratingsFeedError }
            }
        })
    }

    func reloadPublic() {
        guard !busy else { return }
        listeners.publicFeeds.forEach { $0.remove() }; listeners.publicFeeds = []
        started = false; publicLoading = true; ratingsLoading = true; accessDetailsLoading = true
        error = nil; publicFeedError = nil; ratingsFeedError = nil; accessDetailsFeedError = nil; publicStart()
    }

    func selectPlace(_ id: String?) {
        guard selectedID != id else { return }
        selectedID = id; selectionGeneration += 1; listeners.clearDetails()
        publicCodes = []; ownCode = nil; ownStars = nil; visitReports = []; legacyVisitReports = []; unifiedVisitReports = []; legacyVisitError = nil; unifiedVisitError = nil; visitOwnershipGeneration += 1; sourceComments = []; ownVisitIDs = []
        publicCodeReports = []; listedOwnCodeReports = []; publicCodeOwnership = [:]; codeOwnershipReads = []; ownCodeReportsLoading = false; ownCodeReportsError = nil
        codeEvidenceGeneration += 1; codeSummaries = [:]; codeVotes = [:]; codeSummaryReads = []; codeVoteReads = []
        legacyCodesLoading = false; codeReportsLoading = false; codeReportsError = nil; codeFeedbackError = nil
        publicNotes = []; publicNotesLoading = false; publicNotesFeedError = nil
        researchProfile = nil; researchProfileLoading = false; researchProfileError = nil
        publicNoteOwnershipGeneration += 1; ownPublicNoteIDs = []; ownPublicNotesLoading = false; ownPublicNotesError = nil
        detailFeedsPending = []; detailsLoading = false; ownCodeLoading = false; ownRatingLoading = false
        ownCodeError = nil; ownRatingError = nil; codeFeedError = nil; visitFeedError = nil; sourceFeedError = nil
        guard let id, NativeSchema.place(id) else { return }
        let generation = selectionGeneration
        researchProfileLoading = true
        let profile = db.collection("restroomResearchProfiles").document(id)
        listeners.details.append(profile.addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, failure in
            Task { @MainActor [weak self] in
                guard let self, self.selectionGeneration == generation, self.selectedID == id else { return }
                if failure != nil {
                    self.researchProfileLoading = false
                    self.researchProfileError = "Additional restroom details could not refresh. Previously reported details remain available."
                    return
                }
                guard let snapshot, !snapshot.metadata.isFromCache, !snapshot.metadata.hasPendingWrites else { return }
                self.researchProfileLoading = false
                guard snapshot.exists else { self.researchProfile = nil; self.researchProfileError = nil; return }
                do {
                    self.researchProfile = try CardResearchProfile.decode(id: id, data: snapshot.data() ?? [:])
                    self.researchProfileError = nil
                } catch {
                    self.researchProfileError = "Some additional restroom details have an invalid format and are hidden."
                }
            }
        })
        detailFeedsPending = ["codes", "codesV2", "visits", "unifiedVisits", "sources", "publicNotes"]; detailsLoading = true; publicNotesLoading = true
        legacyCodesLoading = true; codeReportsLoading = true
        let codes = db.collection("restroomPasscodeReports").document(id).collection("reports").order(by: "codeUpdatedAt", descending: true).limit(to: 10)
        listeners.details.append(codes.addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, failure in
            Task { @MainActor [weak self] in
                guard let self, self.selectionGeneration == generation, self.selectedID == id else { return }
                if failure != nil { self.legacyCodesLoading = false; self.finishFeed("codes"); self.codeFeedError = "Public codes could not load. Retry before relying on a code."; self.error = self.codeFeedError; return }
                guard let snapshot, !snapshot.metadata.isFromCache, !snapshot.metadata.hasPendingWrites else { return }
                var hidden = false
                self.publicCodes = snapshot.documents.compactMap { item in
                    do { return try NativeSchema.publicCode(id, item.documentID, item.data()) } catch { hidden = true; return nil }
                }
                self.legacyCodesLoading = false; self.finishFeed("codes")
                self.codeFeedError = hidden ? "Some public code reports had invalid details and are hidden." : nil
                if hidden { self.error = self.codeFeedError }
                self.restartCodeFeedback()
            }
        })
        let codeReports = db.collection("restroomPasscodeReportsV2").document(id).collection("reports")
            .order(by: "codeUpdatedAt", descending: true).limit(to: 10)
        listeners.details.append(codeReports.addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, failure in
            Task { @MainActor [weak self] in
                guard let self, self.selectionGeneration == generation, self.selectedID == id else { return }
                if failure != nil {
                    self.codeReportsLoading = false; self.finishFeed("codesV2")
                    self.codeReportsError = "New public code reports could not load."; self.error = self.codeReportsError; return
                }
                guard let snapshot, !snapshot.metadata.isFromCache, !snapshot.metadata.hasPendingWrites else { return }
                var hidden = false
                self.publicCodeReports = snapshot.documents.compactMap { item in
                    do { return try NativeSchema.publicCodeReport(id, item.documentID, item.data()) }
                    catch { hidden = true; return nil }
                }
                self.codeReportsLoading = false; self.finishFeed("codesV2")
                self.codeReportsError = hidden ? "Some code reports had invalid details and are hidden." : nil
                if hidden { self.error = self.codeReportsError }
                self.restartCodeFeedback()
            }
        })
        let visits = db.collection("restroomVisitReports").document(id).collection("reports").order(by: "observedAt", descending: true).limit(to: 10)
        listeners.details.append(visits.addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, failure in
            Task { @MainActor [weak self] in
                guard let self, self.selectionGeneration == generation, self.selectedID == id else { return }
                if failure != nil { self.finishFeed("visits"); self.legacyVisitError = "Visit observations could not load."; self.rebuildVisitReports(); self.error = self.visitFeedError; return }
                guard let snapshot, !snapshot.metadata.isFromCache, !snapshot.metadata.hasPendingWrites else { return }
                var hidden = false
                self.legacyVisitReports = snapshot.documents.compactMap { item in
                    do { return try NativeSchema.visit(item.documentID, id, item.data()) } catch { hidden = true; return nil }
                }
                self.finishFeed("visits")
                self.legacyVisitError = hidden ? "Some visit observations had invalid details and are hidden." : nil
                self.rebuildVisitReports()
                if hidden { self.error = self.visitFeedError }
                await self.loadOwnVisitIDs()
            }
        })
        let unifiedVisits = db.collection("restroomUnifiedVisits").document(id).collection("reports")
            .order(by: "observedAt", descending: true).limit(to: 10)
        listeners.details.append(unifiedVisits.addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, failure in
            Task { @MainActor [weak self] in
                guard let self, self.selectionGeneration == generation, self.selectedID == id else { return }
                if failure != nil {
                    self.finishFeed("unifiedVisits"); self.unifiedVisitError = "New visit observations could not load."
                    self.rebuildVisitReports(); self.error = self.visitFeedError; return
                }
                guard let snapshot, !snapshot.metadata.isFromCache, !snapshot.metadata.hasPendingWrites else { return }
                var hidden = false
                self.unifiedVisitReports = snapshot.documents.compactMap { item in
                    do { return try NativeSchema.unifiedVisit(item.documentID, id, item.data()) }
                    catch { hidden = true; return nil }
                }
                self.finishFeed("unifiedVisits")
                self.unifiedVisitError = hidden ? "Some new visit observations had invalid details and are hidden." : nil
                self.rebuildVisitReports(); if hidden { self.error = self.visitFeedError }
                await self.loadOwnVisitIDs()
            }
        })
        let publicNotesQuery = db.collection("restroomPublicNotes").document(id).collection("notes").order(by: "submittedAt", descending: true).limit(to: 10)
        listeners.details.append(publicNotesQuery.addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, failure in
            Task { @MainActor [weak self] in
                guard let self, self.selectionGeneration == generation, self.selectedID == id else { return }
                if failure != nil {
                    self.finishFeed("publicNotes"); self.publicNotesLoading = false
                    self.publicNotesFeedError = "Public visit notes could not load."; self.error = self.publicNotesFeedError
                    return
                }
                guard let snapshot, !snapshot.metadata.isFromCache, !snapshot.metadata.hasPendingWrites else { return }
                var hidden = false
                self.publicNotes = snapshot.documents.compactMap { item in
                    do { return try NativeSchema.publicNote(item.documentID, id, item.data()) }
                    catch { hidden = true; return nil }
                }
                self.finishFeed("publicNotes"); self.publicNotesLoading = false
                self.publicNotesFeedError = hidden ? "Some public visit notes had invalid details and are hidden." : nil
                if hidden { self.error = self.publicNotesFeedError }
                await self.loadOwnPublicNoteIDs()
            }
        })
        let sources = db.collection("restroomSourceComments").document(id).collection("comments").order(by: "submittedAt", descending: true).limit(to: 10)
        listeners.details.append(sources.addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, failure in
            Task { @MainActor [weak self] in
                guard let self, self.selectionGeneration == generation, self.selectedID == id else { return }
                if failure != nil { self.finishFeed("sources"); self.sourceFeedError = "Imported source notes could not load."; self.error = self.sourceFeedError; return }
                guard let snapshot, !snapshot.metadata.isFromCache, !snapshot.metadata.hasPendingWrites else { return }
                var hidden = false
                self.sourceComments = snapshot.documents.compactMap { item in
                    do { return try Self.decodeSourceComment(item.documentID, id, item.data()) } catch { hidden = true; return nil }
                }
                self.finishFeed("sources")
                self.sourceFeedError = hidden ? "Some imported source notes had invalid details and are hidden." : nil
                if hidden { self.error = self.sourceFeedError }
            }
        })
        startOwnDetail()
    }

    private func rebuildVisitReports() {
        visitReports = Array((legacyVisitReports + unifiedVisitReports).sorted {
            $0.observedAt == $1.observedAt ? $0.id > $1.id : $0.observedAt > $1.observedAt
        }.prefix(20))
        visitFeedError = legacyVisitError ?? unifiedVisitError
    }
    private func putVisit(_ report: VisitReport) {
        if report.source == .legacy {
            legacyVisitReports.removeAll { $0.reportID == report.reportID }; legacyVisitReports.append(report)
            legacyVisitReports.sort { $0.observedAt > $1.observedAt }; legacyVisitReports = Array(legacyVisitReports.prefix(10))
        } else {
            unifiedVisitReports.removeAll { $0.reportID == report.reportID }; unifiedVisitReports.append(report)
            unifiedVisitReports.sort { $0.observedAt > $1.observedAt }; unifiedVisitReports = Array(unifiedVisitReports.prefix(10))
        }
        rebuildVisitReports()
    }
    private func forgetVisit(_ report: VisitReport) {
        if report.source == .legacy { legacyVisitReports.removeAll { $0.reportID == report.reportID } }
        else { unifiedVisitReports.removeAll { $0.reportID == report.reportID } }
        ownVisitIDs.remove(report.ownershipID); rebuildVisitReports()
    }
    private func finishFeed(_ name: String) { detailFeedsPending.remove(name); detailsLoading = !detailFeedsPending.isEmpty }

    func reloadSelectedPlace() {
        let current = selectedID
        error = nil; selectedID = nil; selectPlace(current)
    }

    private func startOwnDetail() {
        listeners.own?.remove(); listeners.own = nil; ownCode = nil; ownStars = nil; ownVisitIDs = []
        listeners.ownCodeReports?.remove(); listeners.ownCodeReports = nil
        listedOwnCodeReports = []; publicCodeOwnership = [:]; codeOwnershipReads = []; ownCodeReportsLoading = false; ownCodeReportsError = nil
        ownCodeError = nil; ownRatingError = nil
        guard let uid = user?.uid, user?.isAnonymous == false, let id = selectedID else { restartCodeFeedback(); return }
        Task { [weak self] in await self?.loadOwnPublicNoteIDs() }
        ownCodeLoading = true; ownRatingLoading = true; ownCodeReportsLoading = true
        restartCodeFeedback()
        let account = accountGeneration, selection = selectionGeneration
        listeners.own = ownRef(uid, id).addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, failure in
            Task { @MainActor [weak self] in
                guard let self, self.matches(uid, account, id, selection) else { return }
                if failure != nil { self.ownCodeLoading = false; self.ownCodeError = "Your private code could not load. It has not been overwritten."; self.error = self.ownCodeError; return }
                guard let snapshot, !snapshot.metadata.isFromCache, !snapshot.metadata.hasPendingWrites else { return }
                self.ownCodeLoading = false
                do { self.ownCode = try snapshot.exists ? NativeSchema.ownCode(id, snapshot.data() ?? [:]) : nil; self.ownCodeError = nil }
                catch { self.ownCodeError = "Your private code has invalid details. It has not been overwritten."; self.error = self.ownCodeError }
            }
        }
        let ownReports = db.collection("users").document(uid).collection("restroomReadyPasscodesV2")
            .whereField("placeID", isEqualTo: id).order(by: "createdAt", descending: true).limit(to: 10)
        listeners.ownCodeReports = ownReports.addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, failure in
            Task { @MainActor [weak self] in
                guard let self, self.matches(uid, account, id, selection) else { return }
                if failure != nil {
                    self.ownCodeReportsLoading = false; self.ownCodeReportsError = "Your code reports could not load. They have not been changed."
                    self.error = self.ownCodeReportsError; return
                }
                guard let snapshot, !snapshot.metadata.isFromCache, !snapshot.metadata.hasPendingWrites else { return }
                do {
                    self.listedOwnCodeReports = try snapshot.documents.map { try NativeSchema.ownCodeReport(id, $0.documentID, $0.data()) }
                    self.ownCodeReportsError = nil
                } catch { self.listedOwnCodeReports = []; self.ownCodeReportsError = "Your code reports have invalid details and are hidden."; self.error = self.ownCodeReportsError }
                self.ownCodeReportsLoading = false; self.restartCodeFeedback()
            }
        }
        Task { [weak self] in
            guard let self else { return }
            do {
                let vote = try await self.db.collection("restroomRatingSummaries").document(id).collection("ratings").document(uid).getDocument(source: .server)
                guard self.matches(uid, account, id, selection) else { return }
                self.ownRatingLoading = false
                self.ownStars = try Self.vote(vote)
                self.ownRatingError = nil
                await self.loadOwnVisitIDs()
            } catch { if self.matches(uid, account, id, selection) { self.ownRatingLoading = false; self.ownRatingError = "Your rating could not load. Reload before changing it."; self.error = self.ownRatingError } }
        }
    }

    private func matches(_ uid: String, _ account: Int, _ place: String, _ selection: Int) -> Bool {
        user?.uid == uid && auth.currentUser?.uid == uid && accountGeneration == account && selectedID == place && selectionGeneration == selection
    }

    private func restartCodeFeedback() {
        codeEvidenceGeneration += 1
        let generation = codeEvidenceGeneration, selection = selectionGeneration, account = accountGeneration
        listeners.codeFeedback.forEach { $0.remove() }; listeners.codeFeedback = []
        codeSummaries = [:]; codeVotes = [:]; codeSummaryReads = []; codeVoteReads = []; codeFeedbackError = nil
        publicCodeOwnership = [:]; codeOwnershipReads = []
        guard let place = selectedID else { return }
        let reports = codeEvidence.filter { $0.placeID == place && $0.visibility == "public" }
        let uid = user?.isAnonymous == false ? user?.uid : nil
        for report in reports {
            let key = report.id
            let summaryRef = codeFeedbackRef(place, report.source, report.reportID)
            listeners.codeFeedback.append(summaryRef.addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, failure in
                Task { @MainActor [weak self] in
                    guard let self, self.selectedID == place, self.selectionGeneration == selection,
                          self.accountGeneration == account, self.codeEvidenceGeneration == generation else { return }
                    if failure != nil {
                        self.codeSummaries[key] = nil; self.codeSummaryReads.remove(key)
                        self.codeFeedbackError = "Code feedback could not load. Earlier codes remain visible."; return
                    }
                    guard let snapshot, !snapshot.metadata.isFromCache, !snapshot.metadata.hasPendingWrites else { return }
                    do {
                        self.codeSummaries[key] = try snapshot.exists ? NativeSchema.codeFeedbackSummary(place, report.source, report.reportID, snapshot.data() ?? [:]) : nil
                        self.codeSummaryReads.insert(key)
                    } catch {
                        self.codeSummaries[key] = nil; self.codeSummaryReads.remove(key)
                        self.codeFeedbackError = "Some code feedback has invalid details. Earlier codes remain visible."
                    }
                }
            })
            guard let uid else { continue }
            if report.source == .report {
                listeners.codeFeedback.append(ownCodeReportRef(uid, report.reportID).addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, failure in
                    Task { @MainActor [weak self] in
                        guard let self, self.matches(uid, account, place, selection), self.codeEvidenceGeneration == generation else { return }
                        if failure != nil {
                            self.publicCodeOwnership[key] = nil; self.codeOwnershipReads.remove(key)
                            self.codeFeedbackError = "Code ownership could not load. Feedback is unavailable until it refreshes."; return
                        }
                        guard let snapshot, !snapshot.metadata.isFromCache, !snapshot.metadata.hasPendingWrites else { return }
                        do {
                            if snapshot.exists {
                                let own = try NativeSchema.ownCodeReport(place, report.reportID, snapshot.data() ?? [:])
                                guard own.code == report.code, own.codeVersion == report.version, own.visibility == "public" else {
                                    throw NativeDataError("Code ownership changed. Refresh the current reports.")
                                }
                                self.publicCodeOwnership[key] = own
                            } else { self.publicCodeOwnership[key] = nil }
                            self.codeOwnershipReads.insert(key)
                        } catch {
                            self.publicCodeOwnership[key] = nil; self.codeOwnershipReads.remove(key)
                            self.codeFeedbackError = "Code ownership could not be confirmed. Feedback is unavailable until it refreshes."
                        }
                    }
                })
            }
            listeners.codeFeedback.append(codeVoteRef(uid, place, report.source, report.reportID).addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, failure in
                Task { @MainActor [weak self] in
                    guard let self, self.matches(uid, account, place, selection), self.codeEvidenceGeneration == generation else { return }
                    if failure != nil {
                        self.codeVotes[key] = nil; self.codeVoteReads.remove(key)
                        self.codeFeedbackError = "Your code feedback could not load. Refresh before reporting another check."; return
                    }
                    guard let snapshot, !snapshot.metadata.isFromCache, !snapshot.metadata.hasPendingWrites else { return }
                    do {
                        self.codeVotes[key] = try snapshot.exists ? NativeSchema.codeFeedbackVote(place, report.source, report.reportID, snapshot.data() ?? [:]) : nil
                        self.codeVoteReads.insert(key)
                    } catch {
                        self.codeVotes[key] = nil; self.codeVoteReads.remove(key)
                        self.codeFeedbackError = "Your code feedback has invalid details. Refresh before reporting another check."
                    }
                }
            })
        }
    }

    private func loadLibrary(uid: String, generation: Int) async {
        guard accountGeneration == generation, user?.uid == uid else { return }
        libraryError = nil
        do {
            try assertNativeAccount(auth, uid)
            let saved = try await db.collection("users").document(uid).collection("restroomReadySaved").getDocuments(source: .server)
            try assertNativeAccount(auth, uid)
            let ids = try saved.documents.map { item -> String in
                let data = item.data(); try NativeSchema.exact(data, ["placeID", "savedAt"])
                guard data["placeID"] as? String == item.documentID, NativeSchema.place(item.documentID) else { throw NativeDataError("A saved-place record has invalid details.") }
                _ = try NativeSchema.timestamp(data["savedAt"]); return item.documentID
            }
            guard accountGeneration == generation, user?.uid == uid else { return }
            savedIDs = Set(ids); privateLoading = false; libraryError = nil
        } catch {
            guard accountGeneration == generation, user?.uid == uid else { return }
            privateLoading = false; libraryError = safeError(error); self.error = libraryError
        }
    }

    /// Owner-only private request history. No draft code or fingerprint enters
    /// observable UI state, and late replies cannot cross account generations.
    func loadOwnRestroomRequests() async {
        ownRestroomRequestsGeneration += 1
        let lookup = ownRestroomRequestsGeneration, account = accountGeneration
        ownRestroomRequests = []; ownRestroomRequestsLoading = false
        ownRestroomRequestsError = nil; ownRestroomRequestsTruncated = false
        guard let uid = user?.uid, user?.isAnonymous == false else { return }
        ownRestroomRequestsRequested = true
        let scope = NativeMutationScope(uid: uid, auth: auth, epoch: sessionEpoch, generation: sessionEpoch.current())
        ownRestroomRequestsLoading = true
        func current() -> Bool {
            accountGeneration == account && ownRestroomRequestsGeneration == lookup && user?.uid == uid && !Task.isCancelled
        }
        defer { if current() { ownRestroomRequestsLoading = false } }
        do {
            try scope.check(); try Task.checkCancellation()
            let snapshot = try await db.collection("users").document(uid)
                .collection("restroomReadySubmissionRequests").order(by: "submittedAt", descending: true)
                .limit(to: 50).getDocuments(source: .server)
            try scope.check(); try Task.checkCancellation(); guard current() else { return }
            guard !snapshot.metadata.isFromCache, !snapshot.metadata.hasPendingWrites else {
                throw NativeDataError("Your requests could not be refreshed from the server.")
            }
            ownRestroomRequests = try snapshot.documents.map { try Self.decodeRestroomRequest($0.documentID, $0.data()).request }
            ownRestroomRequestsTruncated = snapshot.documents.count == 50
        } catch {
            guard current() else { return }
            ownRestroomRequests = []
            ownRestroomRequestsError = "Your restroom requests could not load. Check your connection and retry."
        }
    }

    /// Read only this account's recent contribution receipts, then confirm each
    /// public/private pair coherently. No public author query or UID is used.
    func loadOwnContributions() async {
        ownContributionsGeneration += 1
        let lookup = ownContributionsGeneration, account = accountGeneration
        ownContributions = []; ownContributionsLoading = false
        ownContributionsError = nil; ownContributionsTruncated = false
        guard let uid = user?.uid, user?.isAnonymous == false else { return }
        ownContributionsRequested = true
        let scope = NativeMutationScope(uid: uid, auth: auth, epoch: sessionEpoch, generation: sessionEpoch.current())
        ownContributionsLoading = true
        func current() -> Bool {
            accountGeneration == account && ownContributionsGeneration == lookup && user?.uid == uid && !Task.isCancelled
        }
        defer {
            if accountGeneration == account && ownContributionsGeneration == lookup { ownContributionsLoading = false }
        }
        do {
            try scope.check(); try Task.checkCancellation()
            let privateRoot = db.collection("users").document(uid)
            let noteReceipts = try await privateRoot.collection("restroomReadyPublicNoteReceipts")
                .order(by: "submittedAt", descending: true).limit(to: 50).getDocuments(source: .server)
            try scope.check(); try Task.checkCancellation()
            let visitReceipts = try await privateRoot.collection("restroomReadyUnifiedVisitReceipts")
                .order(by: "submittedAt", descending: true).limit(to: 50).getDocuments(source: .server)
            try scope.check(); try Task.checkCancellation()
            guard current() else { return }
            guard !noteReceipts.metadata.isFromCache, !noteReceipts.metadata.hasPendingWrites,
                  !visitReceipts.metadata.isFromCache, !visitReceipts.metadata.hasPendingWrites else {
                throw NativeDataError("Your comments could not be refreshed from the server.")
            }
            let cityNames = Dictionary(uniqueKeysWithValues: ((try? CitySnapshot.load())?.places ?? []).map { ($0.id, $0.name) })
            func placeName(_ id: String) -> String {
                communityPlaces.first(where: { $0.id == id })?.name ?? cityNames[id] ?? "Restroom"
            }
            var results: [OwnPublicContribution] = []
            for receipt in noteReceipts.documents {
                try scope.check(); try Task.checkCancellation(); guard current() else { return }
                let proof = receipt.data(); try NativeSchema.exact(proof, ["placeID", "submittedAt"])
                guard NativeSchema.id(receipt.documentID), let place = proof["placeID"] as? String,
                      NativeSchema.place(place) else { throw NativeDataError("A comment receipt has invalid details.") }
                let submitted = try NativeSchema.timestamp(proof["submittedAt"])
                guard let note = try await confirmedPublicNote(scope, place, receipt.documentID) else { continue }
                guard current() else { return }
                guard note.submissionTimestamp.isEqual(submitted) else { throw NativeDataError("A comment ownership receipt changed. Refresh your comments.") }
                let fields = try UnifiedVisitFields(observedAt: note.observedAt, entryRule: "not-reported",
                    purchaseRequired: "not-reported", codeRequired: "not-reported", stairs: note.stairs,
                    soap: note.soap, toiletPaper: note.toiletPaper, floor: "not-reported", condition: note.condition,
                    comment: note.body, anonymous: true, authorName: nil, now: note.submittedAt)
                results.append(OwnPublicContribution(id: "note:" + note.id, placeID: place, placeName: placeName(place),
                    observedAt: note.observedAt, submittedAt: note.submittedAt,
                    body: note.body.isEmpty ? fields.observationSummary : note.body,
                    source: .note, publicNote: note, visitReport: nil))
            }
            for receipt in visitReceipts.documents {
                try scope.check(); try Task.checkCancellation(); guard current() else { return }
                let proof = receipt.data(); try NativeSchema.exact(proof, ["placeID", "submittedAt", "codeReportID"])
                guard NativeSchema.id(receipt.documentID), let place = proof["placeID"] as? String,
                      NativeSchema.place(place) else { throw NativeDataError("A comment receipt has invalid details.") }
                let submitted = try NativeSchema.timestamp(proof["submittedAt"])
                let pair = try await readUnifiedSubmission(scope, place, receipt.documentID, nil)
                guard current() else { return }
                guard let (report, _) = try Self.checkedUnifiedVisit(place, receipt.documentID, pair[0], pair[1]) else { continue }
                guard report.submissionTimestamp.isEqual(submitted) else { throw NativeDataError("A comment ownership receipt changed. Refresh your comments.") }
                let fields = try UnifiedVisitFields(observedAt: report.observedAt, entryRule: report.entryRule,
                    purchaseRequired: report.purchaseRequired, codeRequired: report.codeRequired, stairs: report.stairs,
                    soap: report.soap, toiletPaper: report.toiletPaper, floor: report.floor, condition: report.condition,
                    elevatorPresent: report.elevatorPresent, automaticDoorPresent: report.automaticDoorPresent,
                    comment: report.comment, anonymous: report.anonymous, authorName: report.authorName, now: report.submittedAt)
                results.append(OwnPublicContribution(id: "unified:" + report.reportID, placeID: place, placeName: placeName(place),
                    observedAt: report.observedAt, submittedAt: report.submittedAt,
                    body: report.comment.isEmpty ? fields.observationSummary : report.comment,
                    source: .unified, publicNote: nil, visitReport: report))
            }
            guard current() else { return }
            results.sort { $0.submittedAt == $1.submittedAt ? $0.id > $1.id : $0.submittedAt > $1.submittedAt }
            ownContributionsTruncated = noteReceipts.count == 50 || visitReceipts.count == 50 || results.count > 50
            ownContributions = Array(results.prefix(50))
        } catch {
            guard current() else { return }
            ownContributions = []
            ownContributionsError = "Your comments could not load. Check your connection and retry."
        }
    }

    private func loadOwnVisitIDs() async {
        visitOwnershipGeneration += 1; let lookup = visitOwnershipGeneration
        ownVisitIDs = []
        guard let uid = user?.uid, let place = selectedID, user?.isAnonymous == false else { return }
        let account = accountGeneration, selection = selectionGeneration, visible = visitReports
        let scope = NativeMutationScope(uid: uid, auth: auth, epoch: sessionEpoch, generation: sessionEpoch.current())
        do {
            var owned: Set<String> = []
            for report in visible {
                let publicRef = report.source == .legacy ? visitRef(place, report.reportID) : unifiedVisitRef(place, report.reportID)
                let privateRef = report.source == .legacy ? visitReceipt(uid, report.reportID) : unifiedVisitReceipt(uid, report.reportID)
                let pair = try await db.runTransaction { transaction, pointer in
                    do { try scope.check(); let result = [try transaction.getDocument(publicRef), try transaction.getDocument(privateRef)]; try scope.check(); return result }
                    catch { pointer?.pointee = error as NSError; return nil }
                }
                guard matches(uid, account, place, selection), visitOwnershipGeneration == lookup else { return }
                guard let pair = pair as? [DocumentSnapshot], pair.count == 2 else { throw NativeDataError("Report ownership could not be confirmed.") }
                if pair[1].exists, let data = pair[1].data() {
                    try NativeSchema.exact(data, report.source == .legacy ? ["placeID", "submittedAt"] : ["placeID", "submittedAt", "codeReportID"])
                    let submitted = try NativeSchema.timestamp(data["submittedAt"])
                    if report.source == .unified, !NativeSchema.null(data["codeReportID"]) {
                        guard let codeID = data["codeReportID"] as? String, NativeSchema.id(codeID) else { throw NativeDataError("Invalid visit ownership receipt.") }
                    }
                    guard data["placeID"] as? String == place, pair[0].exists,
                          let publicTime = pair[0].data()?["submittedAt"] as? Timestamp,
                          publicTime.isEqual(submitted), submitted.isEqual(report.submissionTimestamp) else {
                        throw NativeDataError("An observation ownership receipt does not match its public report.")
                    }
                    owned.insert(report.ownershipID)
                }
            }
            if matches(uid, account, place, selection), visitOwnershipGeneration == lookup { ownVisitIDs = owned }
        } catch { if matches(uid, account, place, selection), visitOwnershipGeneration == lookup { ownVisitIDs = []; self.error = "Report ownership could not load. Removal is unavailable until it refreshes." } }
    }

    private func loadOwnPublicNoteIDs() async {
        publicNoteOwnershipGeneration += 1
        let lookup = publicNoteOwnershipGeneration
        ownPublicNoteIDs = []; ownPublicNotesLoading = false; ownPublicNotesError = nil
        guard let uid = user?.uid, user?.isAnonymous == false, let place = selectedID else { return }
        let account = accountGeneration, selection = selectionGeneration, visible = publicNotes
        let scope = NativeMutationScope(uid: uid, auth: auth, epoch: sessionEpoch, generation: sessionEpoch.current())
        ownPublicNotesLoading = true
        do {
            var owned = Set<String>()
            for note in visible {
                try assertNativeAccount(auth, uid)
                guard matches(uid, account, place, selection), publicNoteOwnershipGeneration == lookup else { return }
                let pair = try await readPublicNotePair(scope, place, note.id)
                guard matches(uid, account, place, selection), publicNoteOwnershipGeneration == lookup else { return }
                let record = pair[0], receipt = pair[1]
                if receipt.exists, let data = receipt.data() {
                    try NativeSchema.exact(data, ["placeID", "submittedAt"])
                    let submitted = try NativeSchema.timestamp(data["submittedAt"])
                    guard record.exists, let publicData = record.data(), data["placeID"] as? String == place,
                          submitted.isEqual(note.submissionTimestamp),
                          try NativeSchema.publicNote(note.id, place, publicData).submissionTimestamp.isEqual(submitted) else {
                        throw NativeDataError("A public note ownership receipt does not match its note.")
                    }
                    owned.insert(note.id)
                }
            }
            guard matches(uid, account, place, selection), publicNoteOwnershipGeneration == lookup else { return }
            ownPublicNoteIDs = owned; ownPublicNotesLoading = false
        } catch {
            guard matches(uid, account, place, selection), publicNoteOwnershipGeneration == lookup else { return }
            ownPublicNoteIDs = []; ownPublicNotesLoading = false
            ownPublicNotesError = "Note ownership could not load. Removal is unavailable until it refreshes."
            self.error = ownPublicNotesError
        }
    }

    func signIn() async {
        guard !authBusy else { return }; authBusy = true; error = nil
        let generation = sessionEpoch.current()
        NativeAnalytics.track(.authStart(.google))
        defer { authBusy = false }
        do {
            guard let clientID = FirebaseApp.app()?.options.clientID else { throw NativeDataError("The native Google Sign-in client is missing from the iOS Firebase configuration.") }
            guard let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).flatMap(\.windows).first(where: \.isKeyWindow), var presenter = window.rootViewController else { throw NativeDataError("Sign-in could not open. Return to the app and retry.") }
            while let next = presenter.presentedViewController { presenter = next }
            GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter)
            guard sessionEpoch.current() == generation else { throw NativeDataError("Your account session changed while Google Sign-in was open. Retry from the current account.") }
            guard let idToken = result.user.idToken?.tokenString else { throw NativeDataError("Google did not return a sign-in credential. Retry signing in.") }
            try Task.checkCancellation()
            let credential = GoogleAuthProvider.credential(withIDToken: idToken, accessToken: result.user.accessToken.tokenString)
            let authResult = try await auth.signIn(with: credential)
            guard auth.currentUser?.uid == authResult.user.uid else { return }
            NativeAnalytics.confirmedAccount(
                isNewUser: authResult.additionalUserInfo?.isNewUser,
                providerID: authResult.additionalUserInfo?.providerID,
                accountID: authResult.user.uid,
                currentAccountID: auth.currentUser?.uid,
                credentialProviderID: "google.com"
            )
        } catch {
            if error is CancellationError || ((error as NSError).domain == kGIDSignInErrorDomain && (error as NSError).code == GIDSignInError.canceled.rawValue) {
                if sessionEpoch.current() == generation { NativeAnalytics.track(.authCancel(.google)) }
                return
            }
            guard sessionEpoch.current() == generation else { return }
            NativeAnalytics.track(.authFailure(.google, analyticsFailure(error)))
            let failure = error as NSError
            let keychainFailure = (failure.domain == AuthErrors.domain && failure.code == AuthErrorCode.keychainError.rawValue) ||
                (failure.domain == kGIDSignInErrorDomain && failure.code == GIDSignInError.keychain.rawValue)
            if keychainFailure {
                #if targetEnvironment(simulator)
                self.error = "Sign-in couldn’t access this simulator’s Keychain. Check the simulator build’s signing entitlements, then retry."
                #else
                self.error = "Your sign-in session couldn’t be saved securely on this device. Restart the app and try again."
                #endif
            } else {
                self.error = "Google Sign-in did not finish. Check your connection and native Firebase configuration, then retry."
            }
        }
    }

    func signInWithApple() async {
        guard !authBusy else { return }; authBusy = true; error = nil
        let generation = sessionEpoch.current()
        NativeAnalytics.track(.authStart(.apple))
        defer { appleSignInCoordinator = nil; authBusy = false }
        do {
            guard let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                .filter({ $0.activationState == .foregroundActive }).flatMap(\.windows).first(where: \.isKeyWindow) else {
                throw NativeDataError("Sign-in could not open. Return to the app and retry.")
            }
            let coordinator = try NativeAppleSignIn(anchor: window, sessionGeneration: generation,
                                                    currentSessionGeneration: { [weak self] in self?.sessionEpoch.current() ?? -1 })
            appleSignInCoordinator = coordinator
            let authorization = try await coordinator.signIn()
            guard sessionEpoch.current() == generation else {
                throw NativeDataError("Your account session changed while Apple sign-in was open. Retry from the current account.")
            }
            try Task.checkCancellation()
            let credential = OAuthProvider.appleCredential(withIDToken: authorization.identityToken,
                                                           rawNonce: authorization.rawNonce, fullName: authorization.fullName)
            let result = try await auth.signIn(with: credential)
            guard auth.currentUser?.uid == result.user.uid else { return }
            NativeAnalytics.confirmedAccount(isNewUser: result.additionalUserInfo?.isNewUser,
                                             providerID: result.additionalUserInfo?.providerID,
                                             accountID: result.user.uid, currentAccountID: auth.currentUser?.uid,
                                             credentialProviderID: "apple.com")
        } catch {
            if error is CancellationError {
                if sessionEpoch.current() == generation { NativeAnalytics.track(.authCancel(.apple)) }
                return
            }
            guard sessionEpoch.current() == generation else { return }
            NativeAnalytics.track(.authFailure(.apple, analyticsFailure(error)))
            let failure = error as NSError
            if failure.domain == AuthErrors.domain && failure.code == AuthErrorCode.accountExistsWithDifferentCredential.rawValue {
                self.error = "An account already uses another sign-in method. Use its original provider; accounts are not merged automatically."
            } else if failure.domain == AuthErrors.domain && failure.code == AuthErrorCode.keychainError.rawValue {
                self.error = "Your sign-in session couldn’t be saved securely on this device. Restart the app and try again."
            } else if let failure = error as? AppleSignInError {
                self.error = failure.errorDescription
            } else if let failure = error as? NativeDataError {
                self.error = failure.message
            } else {
                self.error = "Apple sign-in did not finish. Check your connection and account configuration, then retry."
            }
        }
    }

    func signOut() {
        guard !busy, !authBusy else { return }
        let signedIn = auth.currentUser?.isAnonymous == false
        do {
            try auth.signOut(); GIDSignIn.sharedInstance.signOut(); accountChanged(nil)
            if signedIn, auth.currentUser == nil { NativeAnalytics.track(.mutationSucceeded(.signOut)) }
        } catch {
            if signedIn { NativeAnalytics.track(.mutationFailed(.signOut, analyticsFailure(error))) }
            self.error = "Sign-out could not finish. Retry before sharing this device."
        }
    }

    @discardableResult
    func deleteAccount(expectedUID: String) async -> Bool {
        guard !busy, !authBusy else { return false }
        error = nil
        guard let current = auth.currentUser, user?.uid == expectedUID, current.uid == expectedUID, !current.isAnonymous else {
            error = AccountDeletionError.sessionChanged.errorDescription
            return false
        }
        authBusy = true
        let generation = sessionEpoch.current()
        defer { appleSignInCoordinator = nil; authBusy = false }
        do {
            if var pending = pendingAccountDeletion,
               pending.attempt.canResumeAfterUserConfirmation(currentUID: current.uid, isAnonymous: current.isAnonymous,
                                                               currentGeneration: generation, expiresAt: pending.expiresAt, now: Date()) {
                try pending.attempt.resumeAfterUserConfirmation(currentUID: current.uid, isAnonymous: current.isAnonymous,
                                                                 currentGeneration: generation, expiresAt: pending.expiresAt, now: Date())
                try await requestAccountDeletion(idToken: pending.idToken, expiresAt: pending.expiresAt,
                                                 googleID: pending.googleID, attempt: &pending.attempt)
                await clearDeletedAccount(pending.attempt, googleID: pending.googleID)
                return true
            }
            clearPendingAccountDeletion()
            var attempt = try AccountDeletionAttempt(expectedUID: expectedUID, sessionGeneration: generation,
                                                      providerIDs: current.providerData.map(\.providerID))
            let googleID = current.providerData.first(where: { $0.providerID == "google.com" })?.uid
            let credential: AuthCredential
            var appleCode: String?
            switch attempt.provider {
            case .apple:
                guard let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                    .filter({ $0.activationState == .foregroundActive }).flatMap(\.windows).first(where: \.isKeyWindow) else {
                    throw NativeDataError("Account verification could not open. Return to the app and retry.")
                }
                let coordinator = try NativeAppleSignIn(anchor: window, sessionGeneration: generation,
                                                        currentSessionGeneration: { [weak self] in self?.sessionEpoch.current() ?? -1 })
                appleSignInCoordinator = coordinator
                let authorization = try await coordinator.signIn()
                appleCode = try AccountDeletionAttempt.appleAuthorizationCode(authorization.authorizationCode)
                credential = OAuthProvider.appleCredential(withIDToken: authorization.identityToken,
                                                           rawNonce: authorization.rawNonce, fullName: authorization.fullName)
            case .google:
                guard let clientID = FirebaseApp.app()?.options.clientID,
                      let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                        .filter({ $0.activationState == .foregroundActive }).flatMap(\.windows).first(where: \.isKeyWindow),
                      var presenter = window.rootViewController else {
                    throw NativeDataError("Account verification could not open. Return to the app and retry.")
                }
                while let next = presenter.presentedViewController { presenter = next }
                GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
                let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenter)
                guard let idToken = result.user.idToken?.tokenString, !idToken.isEmpty else {
                    throw NativeDataError("Google did not return an account verification credential. Retry with the same Google account.")
                }
                credential = GoogleAuthProvider.credential(withIDToken: idToken, accessToken: result.user.accessToken.tokenString)
            }
            try checkDeletionAccount(attempt)
            try Task.checkCancellation()
            // Reauthentication verifies this credential belongs to the captured user;
            // signing in here could silently switch or create an account.
            let result = try await current.reauthenticate(with: credential)
            guard result.user.uid == expectedUID else { throw AccountDeletionError.sessionChanged }
            try checkDeletionAccount(attempt)
            try attempt.didReauthenticate()
            if let appleCode {
                try Task.checkCancellation()
                do { try await auth.revokeToken(withAuthorizationCode: appleCode) }
                catch {
                    if error is CancellationError || Task.isCancelled { throw CancellationError() }
                    throw NativeDataError("Apple access could not be revoked, so account deletion has not started. Check your connection and retry.")
                }
                try checkDeletionAccount(attempt)
                try attempt.didRevokeApple()
            }
            try Task.checkCancellation()
            // Keep this one fresh token for the entire bounded request/retry. An
            // earlier request may delete Auth before its response reaches us.
            let token = try await current.getIDTokenResult(forcingRefresh: true)
            try checkDeletionAccount(attempt)
            try await requestAccountDeletion(idToken: token.token, expiresAt: token.expirationDate,
                                             googleID: googleID, attempt: &attempt)
            await clearDeletedAccount(attempt, googleID: googleID)
            return true
        } catch {
            let failure = error as NSError
            if error is CancellationError || Task.isCancelled ||
                (failure.domain == NSURLErrorDomain && failure.code == URLError.cancelled.rawValue) ||
                (failure.domain == kGIDSignInErrorDomain && failure.code == GIDSignInError.canceled.rawValue) { return false }
            guard auth.currentUser?.uid == expectedUID, sessionEpoch.current() == generation else { return false }
            NativeAnalytics.track(.mutationFailed(.deleteAccount, analyticsFailure(error)))
            if let failure = error as? AccountDeletionError { self.error = failure.errorDescription }
            else if let failure = error as? NativeDataError { self.error = failure.message }
            else if let failure = error as? AppleSignInError { self.error = failure.errorDescription }
            else { self.error = "Account deletion could not verify your sign-in. Use the same account and check your connection before retrying." }
            return false
        }
    }

    private func checkDeletionAccount(_ attempt: AccountDeletionAttempt) throws {
        try attempt.check(currentUID: auth.currentUser?.uid, isAnonymous: auth.currentUser?.isAnonymous ?? true,
                          currentGeneration: sessionEpoch.current())
    }

    private func clearPendingAccountDeletion() {
        pendingDeletionExpiry?.cancel()
        pendingDeletionExpiry = nil
        pendingAccountDeletion = nil
    }

    private func retainPendingAccountDeletion(_ pending: NativePendingAccountDeletion) {
        clearPendingAccountDeletion()
        pendingAccountDeletion = pending
        let expiresAt = pending.expiresAt, generation = pending.attempt.sessionGeneration
        let remaining = max(0, expiresAt.timeIntervalSinceNow)
        pendingDeletionExpiry = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .seconds(remaining)) }
            catch { return }
            guard let self, self.pendingAccountDeletion?.expiresAt == expiresAt,
                  self.pendingAccountDeletion?.attempt.sessionGeneration == generation else { return }
            self.clearPendingAccountDeletion()
        }
    }

    private func requestAccountDeletion(idToken: String, expiresAt: Date, googleID: String?, attempt: inout AccountDeletionAttempt) async throws {
        guard !idToken.isEmpty, !idToken.contains(where: \.isWhitespace) else { throw AccountDeletionError.notConfirmed }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.urlCredentialStorage = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 90
        configuration.timeoutIntervalForResource = 180
        let session = URLSession(configuration: configuration, delegate: NativeDeletionRedirectGuard(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: URL(string: "https://nyc.imfinethanku.me/api/account/delete")!, cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = "POST"
        request.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpShouldHandleCookies = false
        request.httpBody = Data("{}".utf8)
        while true {
            try Task.checkCancellation()
            guard expiresAt > Date() else {
                clearPendingAccountDeletion()
                throw AccountDeletionError.notConfirmed
            }
            try attempt.beginRequest(currentUID: auth.currentUser?.uid, isAnonymous: auth.currentUser?.isAnonymous ?? true,
                                     currentGeneration: sessionEpoch.current())
            retainPendingAccountDeletion(NativePendingAccountDeletion(attempt: attempt, idToken: idToken,
                                                                       expiresAt: expiresAt, googleID: googleID))
            do {
                let (data, response) = try await session.data(for: request)
                guard let response = response as? HTTPURLResponse else { throw AccountDeletionError.notConfirmed }
                if response.statusCode == 401 || response.statusCode == 403 { clearPendingAccountDeletion() }
                if attempt.canRetry(httpStatus: response.statusCode) { continue }
                try attempt.confirm(httpStatus: response.statusCode, data: data)
                if attempt.matches(currentUID: auth.currentUser?.uid, isAnonymous: auth.currentUser?.isAnonymous ?? true,
                                   currentGeneration: sessionEpoch.current()) {
                    NativeAnalytics.track(.mutationSucceeded(.deleteAccount), deduplicationKey: "delete-account:" + attempt.expectedUID)
                }
                return
            } catch let failure as URLError {
                if failure.code == .cancelled || Task.isCancelled { throw CancellationError() }
                if AccountDeletionAttempt.isRetryableTransport(failure.code), attempt.canRetry(transportFailure: true) { continue }
                throw AccountDeletionError.notConfirmed
            }
        }
    }

    private func clearDeletedAccount(_ attempt: AccountDeletionAttempt, googleID: String?) async {
        clearPendingAccountDeletion()
        guard attempt.isConfirmed,
              attempt.matches(currentUID: auth.currentUser?.uid, isAnonymous: auth.currentUser?.isAnonymous ?? true,
                              currentGeneration: sessionEpoch.current()) else { return }
        if let googleID, GIDSignIn.sharedInstance.currentUser?.userID == googleID {
            // Revocation is best effort after deletion. Never disconnect a newer
            // account or turn confirmed deletion into a reported failure.
            try? await GIDSignIn.sharedInstance.disconnect()
        }
        guard attempt.matches(currentUID: auth.currentUser?.uid, isAnonymous: auth.currentUser?.isAnonymous ?? true,
                              currentGeneration: sessionEpoch.current()) else { return }
        do { try auth.signOut() }
        catch { self.error = "Your account was deleted, but this device’s session could not be cleared. Restart the app before signing in again." }
        if let googleID, GIDSignIn.sharedInstance.currentUser?.userID == googleID { GIDSignIn.sharedInstance.signOut() }
        accountChanged(nil)
    }

    func refreshAccount() async {
        guard let uid = user?.uid, !busy else { return }
        privateLoading = true
        await loadLibrary(uid: uid, generation: accountGeneration)
        startOwnDetail()
    }

    private func requireUID() throws -> String {
        guard let uid = user?.uid else { throw NativeDataError("Sign in to save or contribute. Public browsing does not need an account.") }
        try assertNativeAccount(auth, uid); return uid
    }

    /// Reports are private moderation requests, never public visitor notes.
    /// The exact target/reason/action ID stays pinned in the form for retries.
    func reportContent(_ attempt: ContentReportAttempt) async -> Bool {
        guard !busy, !authBusy else { return false }
        busy = true; error = nil
        defer { busy = false }
        var requestScope: NativeMutationScope?
        do {
            let uid = try requireUID()
            let scope = NativeMutationScope(uid: uid, auth: auth, epoch: sessionEpoch, generation: sessionEpoch.current())
            requestScope = scope
            try scope.check()
            guard selectedID == attempt.target.placeID, let current = auth.currentUser else {
                throw ContentReportError.invalidTarget
            }
            let token = try await current.getIDTokenResult(forcingRefresh: true)
            try scope.check(); try Task.checkCancellation()
            guard token.expirationDate > Date(), selectedID == attempt.target.placeID else {
                throw ContentReportError.authenticationRequired
            }
            let configuration = URLSessionConfiguration.ephemeral
            configuration.urlCache = nil; configuration.urlCredentialStorage = nil
            configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false
            configuration.timeoutIntervalForRequest = 30; configuration.timeoutIntervalForResource = 45
            let session = URLSession(configuration: configuration, delegate: NativeDeletionRedirectGuard(), delegateQueue: nil)
            defer { session.invalidateAndCancel() }
            var request = URLRequest(url: URL(string: "https://nyc.imfinethanku.me/api/moderation/reports")!,
                                     cachePolicy: .reloadIgnoringLocalCacheData)
            request.httpMethod = "POST"; request.httpShouldHandleCookies = false
            request.setValue("Bearer \(token.token)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try attempt.encodedBody()
            let (data, response) = try await session.data(for: request)
            try scope.check(); try Task.checkCancellation()
            guard selectedID == attempt.target.placeID, let response = response as? HTTPURLResponse,
                  response.value(forHTTPHeaderField: "Content-Type")?.lowercased().hasPrefix("application/json") == true else {
                throw ContentReportError.notConfirmed
            }
            try attempt.confirm(httpStatus: response.statusCode, data: data)
            NativeAnalytics.track(.mutationSucceeded(.reportContent), deduplicationKey: uid + ":" + attempt.actionID)
            return true
        } catch {
            // Never display an old session's reply or private draft in a new account.
            guard requestScope.map({ (try? $0.check()) != nil }) ?? true else { return false }
            if error is CancellationError || Task.isCancelled { return false }
            guard selectedID == attempt.target.placeID else { return false }
            if let failure = error as? ContentReportError { self.error = failure.localizedDescription }
            else if requestScope == nil { self.error = ContentReportError.authenticationRequired.localizedDescription }
            else { self.error = ContentReportError.notConfirmed.localizedDescription }
            NativeAnalytics.track(.mutationFailed(.reportContent, analyticsFailure(error)))
            return false
        }
    }
    private func validatePlace(_ place: String) throws {
        guard NativeSchema.place(place) else { throw NativeDataError("Choose a valid city or community restroom.") }
    }
    private func perform(analytics mutations: () -> [NativeAnalyticsMutation] = { [] },
                         deduplicationKey: String? = nil,
                         publicContribution: Bool = false,
                         _ operation: (NativeMutationScope) async throws -> Void) async -> Bool {
        guard !busy, !authBusy else { return false }; busy = true; error = nil
        defer { busy = false }
        // This key is held only in memory and is never an Analytics parameter.
        // A single explicit request keeps its key through transaction/readback retries.
        let requestKey = deduplicationKey ?? UUID().uuidString
        var requestScope: NativeMutationScope?
        do {
            let uid = try requireUID()
            let scope = NativeMutationScope(uid: uid, auth: auth, epoch: sessionEpoch, generation: sessionEpoch.current())
            requestScope = scope
            try scope.check(); try await operation(scope); try scope.check()
            for mutation in mutations() {
                NativeAnalytics.track(.mutationSucceeded(mutation), deduplicationKey: uid + ":" + requestKey)
            }
            return true
        } catch {
            // Do not attribute a stale request to a different account/session.
            let currentScope = requestScope.map { scope in (try? scope.check()) != nil } ?? true
            let failure = error as NSError
            let cancelled = error is CancellationError || Task.isCancelled ||
                (failure.domain == NSURLErrorDomain && failure.code == URLError.cancelled.rawValue)
            if currentScope, !cancelled {
                let failure: NativeAnalyticsFailure = requestScope == nil ? .authenticationRequired : analyticsFailure(error)
                for mutation in mutations() {
                    NativeAnalytics.track(.mutationFailed(mutation, failure),
                                          deduplicationKey: (requestScope?.uid ?? "signed-out") + ":" + requestKey)
                }
            }
            var message = safeError(error)
            if currentScope, publicContribution, let scope = requestScope,
               (error as NSError).domain == "FIRFirestoreErrorDomain",
               (error as NSError).code == FirestoreErrorCode.permissionDenied.rawValue,
               await isContributionSuspended(scope) {
                message = "This account cannot add public contributions right now. You can still browse, manage saved places and delete your account. Contact support for help."
            }
            guard requestScope.map({ (try? $0.check()) != nil }) ?? true else { return false }
            if !cancelled { self.error = message }
            return false
        }
    }

    /// A failed permission check stays failed. An unavailable status service
    /// never grants access, retries a write, or discards the original draft.
    private func isContributionSuspended(_ scope: NativeMutationScope) async -> Bool {
        do {
            try scope.check()
            guard let current = auth.currentUser else { return false }
            let token = try await current.getIDTokenResult(forcingRefresh: true)
            try scope.check(); try Task.checkCancellation()
            guard token.expirationDate > Date() else { return false }
            let configuration = URLSessionConfiguration.ephemeral
            configuration.urlCache = nil; configuration.urlCredentialStorage = nil
            configuration.httpCookieStorage = nil; configuration.httpShouldSetCookies = false
            configuration.timeoutIntervalForRequest = 10; configuration.timeoutIntervalForResource = 15
            let session = URLSession(configuration: configuration, delegate: NativeDeletionRedirectGuard(), delegateQueue: nil)
            defer { session.invalidateAndCancel() }
            var request = URLRequest(url: URL(string: "https://nyc.imfinethanku.me/api/moderation/contribution-status")!,
                                     cachePolicy: .reloadIgnoringLocalCacheData)
            request.httpMethod = "GET"; request.httpShouldHandleCookies = false
            request.setValue("Bearer \(token.token)", forHTTPHeaderField: "Authorization")
            let (data, response) = try await session.data(for: request)
            try scope.check(); try Task.checkCancellation()
            guard let response = response as? HTTPURLResponse, response.statusCode == 200,
                  response.value(forHTTPHeaderField: "Content-Type")?.lowercased().hasPrefix("application/json") == true else { return false }
            return try PublicContributionStatus.decode(data) == .suspended
        } catch { return false }
    }
    /// Only coarse, allowlisted categories cross the Analytics boundary.
    private func analyticsFailure(_ error: Error) -> NativeAnalyticsFailure {
        let failure = error as NSError
        if failure.domain == NSURLErrorDomain { return .network }
        if failure.domain == "FIRFirestoreErrorDomain" {
            if failure.code == FirestoreErrorCode.unauthenticated.rawValue { return .authenticationRequired }
            if failure.code == FirestoreErrorCode.permissionDenied.rawValue { return .permissionDenied }
            if failure.code == FirestoreErrorCode.unavailable.rawValue { return .unavailable }
            if failure.code == FirestoreErrorCode.deadlineExceeded.rawValue { return .network }
        }
        if failure.domain == AuthErrors.domain {
            if failure.code == AuthErrorCode.networkError.rawValue { return .network }
            if failure.code == AuthErrorCode.keychainError.rawValue { return .unavailable }
        }
        if failure.domain == kGIDSignInErrorDomain && failure.code == GIDSignInError.keychain.rawValue { return .unavailable }
        return .unknown
    }
    private func safeError(_ failure: Error) -> String {
        if let own = failure as? NativeDataError { return own.message }
        let code = (failure as NSError).code
        if code == FirestoreErrorCode.permissionDenied.rawValue || code == FirestoreErrorCode.unauthenticated.rawValue {
            return "This request was not authorized. Refresh your account and retry the same draft; no change has been confirmed."
        }
        return "The request could not be confirmed. Check your connection and retry the same draft before creating another."
    }
    private func ownRef(_ uid: String, _ place: String) -> DocumentReference { db.collection("users").document(uid).collection("restroomReadyPasscodes").document(place) }
    private func savedRef(_ uid: String, _ place: String) -> DocumentReference { db.collection("users").document(uid).collection("restroomReadySaved").document(place) }
    private func codeRef(_ place: String, _ id: String) -> DocumentReference { db.collection("restroomPasscodeReports").document(place).collection("reports").document(id) }
    private func ownerRef(_ id: String) -> DocumentReference { db.collection("restroomPasscodeOwners").document(id) }
    private func ownCodeReportRef(_ uid: String, _ id: String) -> DocumentReference { db.collection("users").document(uid).collection("restroomReadyPasscodesV2").document(id) }
    private func codeReportOwnerRef(_ id: String) -> DocumentReference { db.collection("restroomPasscodeV2Owners").document(id) }
    private func publicCodeReportRef(_ place: String, _ id: String) -> DocumentReference { db.collection("restroomPasscodeReportsV2").document(place).collection("reports").document(id) }
    private func codeFeedbackRef(_ place: String, _ source: CodeEvidenceSource, _ id: String) -> DocumentReference {
        db.collection("restroomPasscodeFeedback").document(place).collection("codes").document(source.wireKind + "_" + id)
    }
    private func codeVoteRef(_ uid: String, _ place: String, _ source: CodeEvidenceSource, _ id: String) -> DocumentReference {
        db.collection("users").document(uid).collection("restroomReadyPasscodeVotes").document(place + "~" + source.wireKind + "_" + id)
    }
    private func visitRef(_ place: String, _ id: String) -> DocumentReference { db.collection("restroomVisitReports").document(place).collection("reports").document(id) }
    private func visitReceipt(_ uid: String, _ id: String) -> DocumentReference { db.collection("users").document(uid).collection("restroomReadyVisitReceipts").document(id) }
    private func unifiedVisitRef(_ place: String, _ id: String) -> DocumentReference { db.collection("restroomUnifiedVisits").document(place).collection("reports").document(id) }
    private func unifiedVisitReceipt(_ uid: String, _ id: String) -> DocumentReference { db.collection("users").document(uid).collection("restroomReadyUnifiedVisitReceipts").document(id) }
    private func publicNoteRef(_ place: String, _ id: String) -> DocumentReference { db.collection("restroomPublicNotes").document(place).collection("notes").document(id) }
    private func publicNoteReceipt(_ uid: String, _ id: String) -> DocumentReference { db.collection("users").document(uid).collection("restroomReadyPublicNoteReceipts").document(id) }

    func toggleSaved(_ place: Place) async -> Bool {
        var target = !savedIDs.contains(place.id)
        return await perform(analytics: { [target ? .savePlace : .unsavePlace] }) { scope in
            let uid = scope.uid; try scope.check(); try validatePlace(place.id)
            target = !savedIDs.contains(place.id)
            if target { try await savedRef(uid, place.id).setData(["placeID": place.id, "savedAt": FieldValue.serverTimestamp()]) }
            else { try await savedRef(uid, place.id).delete() }
            try scope.check()
            let confirmed = try await savedRef(uid, place.id).getDocument(source: .server)
            try scope.check()
            guard confirmed.exists == target else { throw NativeDataError("The saved-place change could not be confirmed. Refresh before retrying.") }
            if target { savedIDs.insert(place.id) } else { savedIDs.remove(place.id) }
        }
    }

    func saveNote(placeID: String, draft: NoteDraft) async -> Bool {
        await perform { scope in
            let uid = scope.uid; try scope.check(); try validatePlace(placeID)
            guard NativeSchema.id(draft.id), draft.observedAt >= NativeSchema.firstDate, draft.observedAt <= Date(), NativeSchema.condition.contains(draft.condition), [draft.soap, draft.toiletPaper, draft.stairs].allSatisfy({ NativeSchema.answer.contains($0) }) else { throw NativeDataError("Choose a valid visit time and one of the listed answers.") }
            let text = try NativeSchema.text(draft.entryNote.trimmingCharacters(in: .whitespacesAndNewlines), max: 1000, required: false)
            let ref = db.collection("users").document(uid).collection("restroomReadyNotes").document(draft.id)
            let data: [String: Any] = ["placeID": placeID, "observedAt": Timestamp(date: draft.observedAt), "submittedAt": FieldValue.serverTimestamp(), "condition": draft.condition, "soap": draft.soap, "toiletPaper": draft.toiletPaper, "stairs": draft.stairs, "entryNote": text]
            let before = try await ref.getDocument(source: .server); try scope.check()
            if !before.exists {
                do { try await ref.setData(data) }
                catch { try scope.check(); if !(try await ref.getDocument(source: .server)).exists { throw error } }
            }
            let result = try await ref.getDocument(source: .server); try scope.check()
            let note = try NativeSchema.note(draft.id, result.data() ?? [:])
            guard note.placeID == placeID, abs(note.observedAt.timeIntervalSince(draft.observedAt)) < 0.001, note.condition == draft.condition, note.soap == draft.soap, note.toiletPaper == draft.toiletPaper, note.stairs == draft.stairs, note.entryNote == text else { throw NativeDataError("An earlier version of this note was saved. Refresh before starting another.") }
            notes.removeAll { $0.id == note.id }; notes.append(note); notes.sort { $0.observedAt > $1.observedAt }
        }
    }

    func removeNote(_ id: String) async -> Bool {
        await perform { scope in
            let uid = scope.uid; try scope.check(); guard NativeSchema.id(id) else { throw NativeDataError("Choose a valid private note.") }
            let ref = db.collection("users").document(uid).collection("restroomReadyNotes").document(id)
            try await ref.delete(); try scope.check()
            guard !(try await ref.getDocument(source: .server)).exists else { throw NativeDataError("Note removal could not be confirmed.") }
            try scope.check(); notes.removeAll { $0.id == id }
        }
    }

    /// A read-only server transaction observes the atomic pair at one revision.
    /// Independent GETs could straddle another device's create or delete.
    private func readPublicNotePair(_ scope: NativeMutationScope, _ place: String, _ id: String) async throws -> [DocumentSnapshot] {
        try scope.check()
        let recordRef = publicNoteRef(place, id), receiptRef = publicNoteReceipt(scope.uid, id)
        let result = try await db.runTransaction { transaction, pointer in
            do {
                try scope.check()
                let record = try transaction.getDocument(recordRef)
                let receipt = try transaction.getDocument(receiptRef)
                try scope.check()
                return [record, receipt]
            } catch { pointer?.pointee = error as NSError; return nil }
        }
        try scope.check()
        guard let pair = result as? [DocumentSnapshot], pair.count == 2 else {
            throw NativeDataError("This public note's paired records could not be checked. Retry the same request.")
        }
        return pair
    }

    private func confirmedPublicNote(_ scope: NativeMutationScope, _ place: String, _ id: String) async throws -> PublicNote? {
        let pair = try await readPublicNotePair(scope, place, id)
        let record = pair[0], receipt = pair[1]
        if !record.exists && !receipt.exists { return nil }
        guard record.exists, receipt.exists, let data = record.data(), let ownership = receipt.data() else {
            throw NativeDataError("An earlier public note request needs checking. Retry the same note before creating another.")
        }
        try NativeSchema.exact(ownership, ["placeID", "submittedAt"])
        let submitted = try NativeSchema.timestamp(ownership["submittedAt"])
        let note = try NativeSchema.publicNote(id, place, data)
        guard ownership["placeID"] as? String == place, submitted.isEqual(note.submissionTimestamp) else {
            throw NativeDataError("This public note's ownership receipt could not be confirmed.")
        }
        return note
    }

    private func samePublicNote(_ note: PublicNote, _ fields: PublicNoteFields) -> Bool {
        note.observationTimestamp.isEqual(Timestamp(date: fields.observedAt)) && note.fields?.matches(fields) == true
    }

    func savePublicNote(placeID: String, draft: PublicNoteDraft) async -> Bool {
        await perform(analytics: { [.submitVisitNote] }, deduplicationKey: "public-note:" + placeID + ":" + draft.id, publicContribution: true) { scope in
            try scope.check(); try validatePlace(placeID)
            guard NativeSchema.id(draft.id) else { throw NativeDataError("Choose a valid public note.") }
            let fields: PublicNoteFields
            do { fields = try draft.fields() }
            catch { throw NativeDataError(error.localizedDescription) }
            if let existing = try await confirmedPublicNote(scope, placeID, draft.id) {
                guard samePublicNote(existing, fields) else {
                    throw NativeDataError("An earlier version of this note is already public. Refresh before starting another.")
                }
                if selectedID == placeID { ownPublicNoteIDs.insert(existing.id) }
                return
            }
            let payload: [String: Any] = ["schemaVersion": 1, "placeID": placeID,
                "observedAt": Timestamp(date: fields.observedAt), "submittedAt": FieldValue.serverTimestamp(),
                "body": fields.body, "condition": fields.condition, "soap": fields.soap,
                "toiletPaper": fields.toiletPaper, "stairs": fields.stairs]
            let batch = db.batch()
            batch.setData(payload, forDocument: publicNoteRef(placeID, draft.id))
            batch.setData(["placeID": placeID, "submittedAt": FieldValue.serverTimestamp()],
                forDocument: publicNoteReceipt(scope.uid, draft.id))
            try scope.check()
            do { try await batch.commit() }
            catch {
                try scope.check()
                guard let saved = try await confirmedPublicNote(scope, placeID, draft.id),
                      samePublicNote(saved, fields) else { throw error }
            }
            guard let saved = try await confirmedPublicNote(scope, placeID, draft.id),
                  samePublicNote(saved, fields) else {
                throw NativeDataError("The public note could not be confirmed. Retry this same note before creating another.")
            }
            if selectedID == placeID {
                publicNotes.removeAll { $0.id == saved.id }; publicNotes.append(saved)
                publicNotes.sort { $0.submittedAt == $1.submittedAt ? $0.id > $1.id : $0.submittedAt > $1.submittedAt }
                publicNotes = Array(publicNotes.prefix(10))
                await loadOwnPublicNoteIDs()
            }
        }
    }

    func removePublicNote(_ note: PublicNote) async -> Bool {
        await perform(analytics: { [.removeVisitNote] }, deduplicationKey: "remove-public-note:" + note.placeID + ":" + note.id) { scope in
            try scope.check(); try validatePlace(note.placeID)
            guard NativeSchema.id(note.id) else { throw NativeDataError("Choose a valid public note.") }
            if let current = try await confirmedPublicNote(scope, note.placeID, note.id) {
                guard current.submissionTimestamp.isEqual(note.submissionTimestamp) else {
                    throw NativeDataError("This public note changed. Refresh before removing it.")
                }
                let batch = db.batch()
                batch.deleteDocument(publicNoteRef(note.placeID, note.id))
                batch.deleteDocument(publicNoteReceipt(scope.uid, note.id))
                try scope.check()
                do { try await batch.commit() }
                catch {
                    try scope.check()
                    if try await confirmedPublicNote(scope, note.placeID, note.id) != nil { throw error }
                }
                guard try await confirmedPublicNote(scope, note.placeID, note.id) == nil else {
                    throw NativeDataError("Public note removal could not be confirmed. Refresh before retrying.")
                }
            }
            if selectedID == note.placeID {
                publicNotes.removeAll { $0.id == note.id }; ownPublicNoteIDs.remove(note.id)
                await loadOwnPublicNoteIDs()
            }
        }
    }

    func rate(placeID: String, stars: Double?) async -> Bool {
        await perform(analytics: { [stars == nil ? .removeRating : .submitRating] }, publicContribution: stars != nil) { scope in
            let uid = scope.uid; try scope.check(); try validatePlace(placeID)
            let storedStars = stars.flatMap { CleanlinessRating.firestoreNumber(for: $0) }
            if stars != nil && storedStars == nil { throw NativeDataError("Choose 1–5 stars in half-star steps.") }
            let database = db
            let summary = db.collection("restroomRatingSummaries").document(placeID), vote = db.collection("restroomRatingSummaries").document(placeID).collection("ratings").document(uid)
            var lastFailure: Error?
            for attempt in 0..<3 {
                do {
                    _ = try await database.runTransaction { transaction, pointer in
                        do {
                            try scope.check()
                            let oldSummary = try transaction.getDocument(summary), oldVote = try transaction.getDocument(vote)
                            guard oldSummary.exists else { throw NativeDataError("This location's ratings have not been initialized. No rating was saved.") }
                            let totals = try NativeSchema.summary(placeID, oldSummary.data() ?? [:]), previous = try Self.vote(oldVote)
                            if previous == stars { return true }
                            let count = totals.ratingCount + (stars == nil ? 0 : 1) - (previous == nil ? 0 : 1)
                            let sum = totals.ratingSum + (stars ?? 0) - (previous ?? 0)
                            guard count >= 0, count <= 1_000_000, sum >= Double(count), sum <= Double(count) * 5 else { throw NativeDataError("Rating totals need checking before another rating is saved.") }
                            transaction.updateData(["ratingCount": FieldValue.increment(Int64(count - totals.ratingCount)), "ratingSum": FieldValue.increment(sum - totals.ratingSum), "updatedAt": FieldValue.serverTimestamp()], forDocument: summary)
                            if let storedStars { transaction.setData(["stars": storedStars, "updatedAt": FieldValue.serverTimestamp()], forDocument: vote) }
                            else { transaction.deleteDocument(vote) }
                            try scope.check(); return true
                        } catch { pointer?.pointee = error as NSError; return nil }
                    }
                    try scope.check()
                    let fresh = try await vote.getDocument(source: .server); try scope.check()
                    guard try Self.vote(fresh) == stars else { throw NativeDataError("Your rating changed before confirmation. Reload before trying again.") }
                    if selectedID == placeID { ownStars = stars }; return
                } catch {
                    try scope.check(); lastFailure = error
                    if attempt == 2 || (error as NSError).code != FirestoreErrorCode.permissionDenied.rawValue { throw error }
                    // Rules may see another vote before the SDK sees the version conflict.
                    let fresh = try await vote.getDocument(source: .server); try scope.check()
                    if try Self.vote(fresh) == stars { if selectedID == placeID { ownStars = stars }; return }
                }
            }
            throw lastFailure ?? NativeDataError("Your rating could not be confirmed.")
        }
    }

    nonisolated private static func checkedCodeReportPair(_ uid: String, _ place: String, _ id: String,
        _ own: DocumentSnapshot, _ owner: DocumentSnapshot, _ shared: DocumentSnapshot) throws -> OwnCodeReport? {
        if !own.exists && !owner.exists && !shared.exists { return nil }
        guard own.exists, owner.exists else { throw NativeDataError("An earlier code report needs checking. Retry the same report.") }
        let report = try NativeSchema.ownCodeReport(place, id, own.data() ?? [:])
        let reservation = owner.data() ?? [:]
        try NativeSchema.exact(reservation, ["ownerUID", "placeID", "createdAt"])
        guard reservation["ownerUID"] as? String == uid, reservation["placeID"] as? String == place,
              let created = reservation["createdAt"] as? Timestamp, created.isEqual(report.creationTimestamp) else {
            throw NativeDataError("Code report ownership could not be confirmed.")
        }
        if report.visibility == "public" {
            let projection = try NativeSchema.publicCodeReport(place, id, shared.data() ?? [:])
            guard shared.exists, projection.code == report.code, projection.versionTimestamp.isEqual(report.versionTimestamp) else {
                throw NativeDataError("The public code report could not be confirmed.")
            }
        } else if shared.exists { throw NativeDataError("This code report's privacy could not be confirmed.") }
        return report
    }

    private func confirmedCodeReport(_ scope: NativeMutationScope, _ place: String, _ id: String) async throws -> OwnCodeReport? {
        let own = ownCodeReportRef(scope.uid, id), owner = codeReportOwnerRef(id), shared = publicCodeReportRef(place, id)
        let result = try await db.runTransaction { transaction, pointer in
            do {
                try scope.check()
                let snapshots = [try transaction.getDocument(own), try transaction.getDocument(owner), try transaction.getDocument(shared)]
                try scope.check(); return snapshots
            } catch { pointer?.pointee = error as NSError; return nil }
        }
        try scope.check()
        guard let pair = result as? [DocumentSnapshot], pair.count == 3 else { throw NativeDataError("The code report could not be checked.") }
        return try Self.checkedCodeReportPair(scope.uid, place, id, pair[0], pair[1], pair[2])
    }

    func saveCodeReport(placeID: String, draft: CodeReportDraft) async -> Bool {
        await perform(analytics: { [.submitCodeReport] }, deduplicationKey: "code-report:" + placeID + ":" + draft.id, publicContribution: draft.visibility == "public") { scope in
            try validatePlace(placeID)
            guard NativeSchema.id(draft.id) else { throw NativeDataError("Choose a valid code report.") }
            let fields: CodeReportFields
            do { fields = try CodeReportFields(code: draft.code, visibility: draft.visibility) }
            catch { throw NativeDataError(error.localizedDescription) }
            if fields.visibility == "public" { try PublicTextSafety.validateForPublication(fields.code) }
            let own = ownCodeReportRef(scope.uid, draft.id), owner = codeReportOwnerRef(draft.id)
            let shared = publicCodeReportRef(placeID, draft.id), saved = savedRef(scope.uid, placeID)
            do {
                _ = try await db.runTransaction { transaction, pointer in
                    do {
                        try scope.check()
                        let before = try transaction.getDocument(own), reservation = try transaction.getDocument(owner), projection = try transaction.getDocument(shared)
                        let savedBefore = fields.visibility == "private" ? try transaction.getDocument(saved) : nil
                        if let current = try Self.checkedCodeReportPair(scope.uid, placeID, draft.id, before, reservation, projection) {
                            guard current.code == fields.code, current.visibility == fields.visibility else {
                                throw NativeDataError("This report was already saved with different details. Start a new report for a changed code.")
                            }
                            return true
                        }
                        transaction.setData(["placeID": placeID, "code": fields.code, "visibility": fields.visibility,
                            "createdAt": FieldValue.serverTimestamp(), "codeUpdatedAt": FieldValue.serverTimestamp(), "lastVerifiedAt": NSNull()], forDocument: own)
                        transaction.setData(["ownerUID": scope.uid, "placeID": placeID, "createdAt": FieldValue.serverTimestamp()], forDocument: owner)
                        if fields.visibility == "public" {
                            transaction.setData(["placeID": placeID, "code": fields.code, "codeUpdatedAt": FieldValue.serverTimestamp()], forDocument: shared)
                        } else if savedBefore?.exists != true {
                            transaction.setData(["placeID": placeID, "savedAt": FieldValue.serverTimestamp()], forDocument: saved)
                        }
                        try scope.check(); return true
                    } catch { pointer?.pointee = error as NSError; return nil }
                }
            } catch {
                try scope.check()
                guard let current = try await confirmedCodeReport(scope, placeID, draft.id),
                      current.code == fields.code, current.visibility == fields.visibility else { throw error }
            }
            guard let current = try await confirmedCodeReport(scope, placeID, draft.id),
                  current.code == fields.code, current.visibility == fields.visibility else { throw NativeDataError("The code report could not be confirmed. Retry this same report.") }
            if selectedID == placeID {
                listedOwnCodeReports.removeAll { $0.id == current.id }; listedOwnCodeReports.append(current)
                if current.visibility == "private" { savedIDs.insert(placeID) }
                restartCodeFeedback()
            }
        }
    }

    func setCodeReportVisibility(report: OwnCodeReport, visibility: String) async -> Bool {
        await perform(analytics: { [.changeCodeVisibility] }, publicContribution: visibility == "public") { scope in
            try validatePlace(report.placeID)
            guard NativeSchema.id(report.id), ["private", "public"].contains(visibility) else { throw NativeDataError("Choose a valid code report and visibility.") }
            if visibility == "public" { try PublicTextSafety.validateForPublication(report.code) }
            let own = ownCodeReportRef(scope.uid, report.id), owner = codeReportOwnerRef(report.id)
            let shared = publicCodeReportRef(report.placeID, report.id), saved = savedRef(scope.uid, report.placeID)
            do {
                _ = try await db.runTransaction { transaction, pointer in
                    do {
                        try scope.check()
                        let before = try transaction.getDocument(own), reservation = try transaction.getDocument(owner), projection = try transaction.getDocument(shared)
                        let savedBefore = visibility == "private" ? try transaction.getDocument(saved) : nil
                        guard let current = try Self.checkedCodeReportPair(scope.uid, report.placeID, report.id, before, reservation, projection),
                              current.code == report.code, current.versionTimestamp.isEqual(report.versionTimestamp),
                              current.visibility == report.visibility || current.visibility == visibility else {
                            throw NativeDataError("This code report changed. Refresh before changing visibility.")
                        }
                        if current.visibility == visibility { return true }
                        transaction.updateData(["visibility": visibility], forDocument: own)
                        if visibility == "public" {
                            transaction.setData(["placeID": report.placeID, "code": current.code, "codeUpdatedAt": current.versionTimestamp], forDocument: shared)
                        } else {
                            transaction.deleteDocument(shared)
                            if savedBefore?.exists != true { transaction.setData(["placeID": report.placeID, "savedAt": FieldValue.serverTimestamp()], forDocument: saved) }
                        }
                        try scope.check(); return true
                    } catch { pointer?.pointee = error as NSError; return nil }
                }
            } catch {
                try scope.check()
                guard let current = try await confirmedCodeReport(scope, report.placeID, report.id), current.visibility == visibility,
                      current.versionTimestamp.isEqual(report.versionTimestamp) else { throw error }
            }
            guard let current = try await confirmedCodeReport(scope, report.placeID, report.id), current.visibility == visibility,
                  current.versionTimestamp.isEqual(report.versionTimestamp) else { throw NativeDataError("The visibility change could not be confirmed.") }
            if selectedID == report.placeID {
                listedOwnCodeReports.removeAll { $0.id == report.id }; listedOwnCodeReports.append(current)
                publicCodeOwnership["report:" + report.id] = nil
                if visibility == "private" { publicCodeReports.removeAll { $0.id == report.id }; savedIDs.insert(report.placeID) }
                restartCodeFeedback()
            }
        }
    }

    func removeCodeReport(_ report: OwnCodeReport) async -> Bool {
        await perform(analytics: { [.removeCodeReport] }, deduplicationKey: "remove-code-report:" + report.placeID + ":" + report.id) { scope in
            try validatePlace(report.placeID)
            guard NativeSchema.id(report.id) else { throw NativeDataError("Choose a valid code report.") }
            let own = ownCodeReportRef(scope.uid, report.id), owner = codeReportOwnerRef(report.id), shared = publicCodeReportRef(report.placeID, report.id)
            do {
                _ = try await db.runTransaction { transaction, pointer in
                    do {
                        try scope.check()
                        let before = try transaction.getDocument(own), reservation = try transaction.getDocument(owner), projection = try transaction.getDocument(shared)
                        guard let current = try Self.checkedCodeReportPair(scope.uid, report.placeID, report.id, before, reservation, projection) else { return true }
                        guard current.versionTimestamp.isEqual(report.versionTimestamp), current.visibility == report.visibility else {
                            throw NativeDataError("This code report changed. Refresh before removing it.")
                        }
                        transaction.deleteDocument(own); transaction.deleteDocument(owner)
                        if projection.exists { transaction.deleteDocument(shared) }
                        try scope.check(); return true
                    } catch { pointer?.pointee = error as NSError; return nil }
                }
            } catch { try scope.check(); if try await confirmedCodeReport(scope, report.placeID, report.id) != nil { throw error } }
            guard try await confirmedCodeReport(scope, report.placeID, report.id) == nil else { throw NativeDataError("The code report's removal could not be confirmed.") }
            if selectedID == report.placeID {
                listedOwnCodeReports.removeAll { $0.id == report.id }; publicCodeOwnership["report:" + report.id] = nil
                publicCodeReports.removeAll { $0.id == report.id }; restartCodeFeedback()
            }
        }
    }

    func verifyOwnCodeReport(_ report: OwnCodeReport) async -> Bool {
        await perform(analytics: { [.verifyCode] }) { scope in
            try validatePlace(report.placeID)
            guard NativeSchema.id(report.id), report.visibility == "private" else { throw NativeDataError("Public code consensus comes from other visitors. Only a private code can use this check.") }
            let own = ownCodeReportRef(scope.uid, report.id), saved = savedRef(scope.uid, report.placeID)
            _ = try await db.runTransaction { transaction, pointer in
                do {
                    try scope.check()
                    let before = try transaction.getDocument(own), savedBefore = try transaction.getDocument(saved)
                    let current = try NativeSchema.ownCodeReport(report.placeID, report.id, before.data() ?? [:])
                    guard before.exists, current.visibility == "private", current.versionTimestamp.isEqual(report.versionTimestamp) else {
                        throw NativeDataError("Your code or visibility changed. Refresh before recording successful use.")
                    }
                    transaction.updateData(["lastVerifiedAt": FieldValue.serverTimestamp()], forDocument: own)
                    if !savedBefore.exists { transaction.setData(["placeID": report.placeID, "savedAt": FieldValue.serverTimestamp()], forDocument: saved) }
                    try scope.check(); return true
                } catch { pointer?.pointee = error as NSError; return nil }
            }
            guard let current = try await confirmedCodeReport(scope, report.placeID, report.id), current.visibility == "private",
                  current.versionTimestamp.isEqual(report.versionTimestamp), current.lastVerifiedAt != nil else {
                throw NativeDataError("Your private code check could not be confirmed.")
            }
            if selectedID == report.placeID {
                listedOwnCodeReports.removeAll { $0.id == report.id }; listedOwnCodeReports.append(current); savedIDs.insert(report.placeID)
            }
        }
    }

    nonisolated private static func checkedPublicCode(_ report: CodeEvidence, _ snapshot: DocumentSnapshot) throws -> Timestamp {
        guard snapshot.exists else { throw NativeDataError("This code is no longer public. Refresh the reports.") }
        let code: String, version: Timestamp
        if report.source == .legacy {
            let current = try NativeSchema.publicCode(report.placeID, report.reportID, snapshot.data() ?? [:])
            code = current.code; version = current.versionTimestamp
        } else {
            let current = try NativeSchema.publicCodeReport(report.placeID, report.reportID, snapshot.data() ?? [:])
            code = current.code; version = current.versionTimestamp
        }
        guard code == report.code, "\(version.seconds):\(version.nanoseconds)" == report.version else {
            throw NativeDataError("This code changed. Refresh before reporting a check for its new version.")
        }
        return version
    }

    func setCodeFeedback(_ report: CodeEvidence, vote: CodeFeedback) async -> Bool {
        await perform(analytics: { [vote == .used ? .codeWorked : .codeInvalid] }, publicContribution: true) { scope in
            try validatePlace(report.placeID)
            guard NativeSchema.id(report.reportID), report.visibility == "public", report.ownership == .other else {
                throw NativeDataError("Load a public code from another visitor before reporting a check.")
            }
            let shared = report.source == .legacy ? codeRef(report.placeID, report.reportID) : publicCodeReportRef(report.placeID, report.reportID)
            let summaryRef = codeFeedbackRef(report.placeID, report.source, report.reportID)
            let voteRef = codeVoteRef(scope.uid, report.placeID, report.source, report.reportID)
            for attemptIndex in 0..<3 {
                let baseline = NativeCodeFeedbackAttempt()
                do {
                _ = try await db.runTransaction { transaction, pointer in
                    do {
                        try scope.check()
                        let publicBefore = try transaction.getDocument(shared), summaryBefore = try transaction.getDocument(summaryRef), voteBefore = try transaction.getDocument(voteRef)
                        let version = try Self.checkedPublicCode(report, publicBefore)
                        let summary = try summaryBefore.exists ? NativeSchema.codeFeedbackSummary(report.placeID, report.source, report.reportID, summaryBefore.data() ?? [:]) : nil
                        let previous = try voteBefore.exists ? NativeSchema.codeFeedbackVote(report.placeID, report.source, report.reportID, voteBefore.data() ?? [:]) : nil
                        let sameSummary = summary?.versionTimestamp.isEqual(version) == true
                        let sameVote = previous?.versionTimestamp.isEqual(version) == true
                        guard !sameVote || sameSummary else { throw NativeDataError("Your code feedback needs checking. Refresh before retrying.") }
                        let counts = try CodeFeedbackCounts(used: sameSummary ? summary!.usedCount : 0, invalid: sameSummary ? summary!.invalidCount : 0)
                            .applying(previous: sameVote ? previous?.vote : nil, next: vote)
                        let lastUsed: Any = vote == .used ? FieldValue.serverTimestamp() : sameSummary ? (summaryBefore.data()?["lastUsedAt"] ?? NSNull()) : NSNull()
                        baseline.record(summaryBefore, voteBefore)
                        transaction.setData(["placeID": report.placeID, "kind": report.source.wireKind, "reportID": report.reportID,
                            "codeUpdatedAt": version, "usedCount": counts.used, "invalidCount": counts.invalid,
                            "lastUsedAt": lastUsed, "updatedAt": FieldValue.serverTimestamp()], forDocument: summaryRef)
                        transaction.setData(["placeID": report.placeID, "kind": report.source.wireKind, "reportID": report.reportID,
                            "codeUpdatedAt": version, "vote": vote.rawValue, "updatedAt": FieldValue.serverTimestamp()], forDocument: voteRef)
                        try scope.check(); return true
                    } catch { pointer?.pointee = error as NSError; return nil }
                }
                    let pair = try await readCodeFeedback(scope, report, shared, summaryRef, voteRef)
                    try confirmCodeFeedback(scope, report, vote, pair, baseline)
                    return
                } catch {
                    let failure = error
                    try scope.check()
                    let pair = try await readCodeFeedback(scope, report, shared, summaryRef, voteRef)
                    if (try? confirmCodeFeedback(scope, report, vote, pair, baseline)) != nil { return }
                    guard !(failure is NativeDataError), (failure as NSError).code == FirestoreErrorCode.permissionDenied.rawValue,
                          attemptIndex < 2, baseline.changed(pair[1], pair[2]) else { throw failure }
                    // Same explicit request only, after coherent server evidence
                    // proves contention; unchanged authorization failures stop.
                }
            }
            throw NativeDataError("Code feedback changed repeatedly. Refresh before retrying this same check.")
        }
    }

    private func readCodeFeedback(_ scope: NativeMutationScope, _ report: CodeEvidence,
        _ shared: DocumentReference, _ summaryRef: DocumentReference, _ voteRef: DocumentReference) async throws -> [DocumentSnapshot] {
        let result = try await db.runTransaction { transaction, pointer in
            do {
                try scope.check()
                let snapshots = [try transaction.getDocument(shared), try transaction.getDocument(summaryRef), try transaction.getDocument(voteRef)]
                try scope.check(); return snapshots
            } catch { pointer?.pointee = error as NSError; return nil }
        }
        try scope.check()
        guard let pair = result as? [DocumentSnapshot], pair.count == 3 else { throw NativeDataError("Your code feedback could not be checked.") }
        _ = try Self.checkedPublicCode(report, pair[0])
        if pair[1].exists { _ = try NativeSchema.codeFeedbackSummary(report.placeID, report.source, report.reportID, pair[1].data() ?? [:]) }
        if pair[2].exists { _ = try NativeSchema.codeFeedbackVote(report.placeID, report.source, report.reportID, pair[2].data() ?? [:]) }
        return pair
    }

    private func confirmCodeFeedback(_ scope: NativeMutationScope, _ report: CodeEvidence, _ vote: CodeFeedback,
        _ pair: [DocumentSnapshot], _ baseline: NativeCodeFeedbackAttempt) throws {
        try scope.check()
        let version = try Self.checkedPublicCode(report, pair[0])
        let summary = try NativeSchema.codeFeedbackSummary(report.placeID, report.source, report.reportID, pair[1].data() ?? [:])
        let receipt = try NativeSchema.codeFeedbackVote(report.placeID, report.source, report.reportID, pair[2].data() ?? [:])
        guard pair[1].exists, pair[2].exists, summary.versionTimestamp.isEqual(version), receipt.versionTimestamp.isEqual(version),
              receipt.vote == vote, baseline.voteChanged(pair[2]) else {
            throw NativeDataError("Your code feedback could not be confirmed. Retry this same check.")
        }
        if selectedID == report.placeID {
            codeSummaries[report.id] = summary; codeVotes[report.id] = receipt
            codeSummaryReads.insert(report.id); codeVoteReads.insert(report.id)
        }
    }

    private func confirmCode(_ scope: NativeMutationScope, _ uid: String, _ place: String, _ code: String, _ visibility: String) async throws -> OwnPasscode {
        let own = try await ownRef(uid, place).getDocument(source: .server); try scope.check()
        guard own.exists else { throw NativeDataError("The code save could not be confirmed. Refresh before retrying.") }
        let result = try NativeSchema.ownCode(place, own.data() ?? [:])
        guard result.code == code, result.visibility == visibility else { throw NativeDataError("Your saved code changed before confirmation. Load its current version.") }
        let reservation = try await ownerRef(result.reportID).getDocument(source: .server); try scope.check()
        let reservationData = reservation.data() ?? [:]; try NativeSchema.exact(reservationData, ["ownerUID", "placeID", "createdAt"])
        guard reservationData["ownerUID"] as? String == uid, reservationData["placeID"] as? String == place,
              let created = reservationData["createdAt"] as? Timestamp, let ownCreated = own.data()?["createdAt"] as? Timestamp, created.isEqual(ownCreated) else { throw NativeDataError("Code ownership could not be confirmed.") }
        let shared = try await codeRef(place, result.reportID).getDocument(source: .server); try scope.check()
        if visibility == "public" {
            let projection = try NativeSchema.publicCode(place, result.reportID, shared.data() ?? [:])
            guard shared.exists, projection.code == result.code, projection.codeVersion == result.codeVersion else { throw NativeDataError("The public code projection could not be confirmed.") }
        } else {
            guard !shared.exists else { throw NativeDataError("Your code's privacy could not be confirmed.") }
            let saved = try await savedRef(uid, place).getDocument(source: .server); try scope.check()
            guard saved.exists, saved.data()?["placeID"] as? String == place else { throw NativeDataError("The private code's saved-place receipt could not be confirmed.") }
            savedIDs.insert(place)
        }
        return result
    }

    func saveCode(placeID: String, draft: CodeDraft) async -> Bool {
        var mutation: NativeAnalyticsMutation = .submitCodeReport
        return await perform(analytics: { [mutation] }, publicContribution: draft.visibility == "public") { scope in
            let uid = scope.uid; try scope.check(); try validatePlace(placeID)
            let code = try NativeSchema.code(draft.code), visibility = draft.visibility
            if visibility == "public" { try PublicTextSafety.validateForPublication(code) }
            if let expected = draft.expected, expected.code == code, expected.visibility != visibility { mutation = .changeCodeVisibility }
            guard ["private", "public"].contains(visibility) else { throw NativeDataError("Choose Only me or Everyone for code visibility.") }
            let database = db, own = ownRef(uid, placeID), saved = savedRef(uid, placeID)
            let candidate = NativeIDs.make(), expected = draft.expected
            do {
                _ = try await database.runTransaction { transaction, pointer in
                    do {
                        try scope.check()
                        let before = try transaction.getDocument(own), beforeData = before.data() ?? [:]
                        let current = try before.exists ? NativeSchema.ownCode(placeID, beforeData) : nil
                        if !NativeSchema.sameRevision(current, expected) {
                            // A previous save may have committed before its server readback failed.
                            // Accept only the identical desired state; never overwrite a conflicting revision.
                            if let current, current.code == code, current.visibility == visibility,
                               expected == nil || current.reportID == expected?.reportID { return true }
                            throw NativeDataError("Your code or its visibility changed. Refresh before saving.")
                        }
                        let reportID = current?.reportID ?? candidate
                        let shared = database.collection("restroomPasscodeReports").document(placeID).collection("reports").document(reportID)
                        let publicBefore = try transaction.getDocument(shared)
                        let savedBefore = visibility == "private" ? try transaction.getDocument(saved) : nil
                        if current?.visibility == "public" {
                            let projection = try NativeSchema.publicCode(placeID, reportID, publicBefore.data() ?? [:])
                            guard publicBefore.exists, projection.code == current?.code, projection.codeVersion == current?.codeVersion else { throw NativeDataError("Your public code changed. Refresh before saving.") }
                        } else if publicBefore.exists { throw NativeDataError("Your code's visibility could not be confirmed.") }
                        let sameCode = current?.code == code
                        let verified: Any = !sameCode ? NSNull() : current?.visibility == "public" ? (publicBefore.data()?["lastVerifiedAt"] ?? NSNull()) : (beforeData["lastVerifiedAt"] ?? NSNull())
                        let updated: Any = sameCode ? (beforeData["codeUpdatedAt"] ?? FieldValue.serverTimestamp()) : FieldValue.serverTimestamp()
                        transaction.setData(["placeID": placeID, "reportID": reportID, "code": code, "visibility": visibility, "createdAt": beforeData["createdAt"] ?? FieldValue.serverTimestamp(), "codeUpdatedAt": updated, "lastVerifiedAt": verified], forDocument: own)
                        if current == nil {
                            transaction.setData(["ownerUID": uid, "placeID": placeID, "createdAt": FieldValue.serverTimestamp()], forDocument: database.collection("restroomPasscodeOwners").document(reportID))
                        }
                        if visibility == "public" && (current == nil || current?.visibility != "public" || !sameCode) {
                            transaction.setData(["placeID": placeID, "code": code, "codeUpdatedAt": updated, "lastVerifiedAt": verified], forDocument: shared)
                        } else if visibility == "private" && publicBefore.exists { transaction.deleteDocument(shared) }
                        if visibility == "private" && savedBefore?.exists != true { transaction.setData(["placeID": placeID, "savedAt": FieldValue.serverTimestamp()], forDocument: saved) }
                        try scope.check(); return true
                    } catch { pointer?.pointee = error as NSError; return nil }
                }
            } catch {
                try scope.check()
                if error is NativeDataError { throw error }
                let recovered = try await confirmCode(scope, uid, placeID, code, visibility)
                if selectedID == placeID { ownCode = recovered }; return
            }
            try scope.check()
            let confirmed = try await confirmCode(scope, uid, placeID, code, visibility)
            if selectedID == placeID { ownCode = confirmed }
        }
    }

    func deleteOwnCode(placeID: String) async -> Bool {
        await perform(analytics: { [.removeCodeReport] }) { scope in
            let uid = scope.uid; try scope.check(); try validatePlace(placeID)
            guard let expected = ownCode, expected.placeID == placeID else { throw NativeDataError("Load your current code before removing it.") }
            let database = db, own = ownRef(uid, placeID), reservation = ownerRef(expected.reportID), shared = codeRef(placeID, expected.reportID)
            _ = try await database.runTransaction { transaction, pointer in
                do {
                    try scope.check()
                    let before = try transaction.getDocument(own)
                    if !before.exists {
                        let owner = try transaction.getDocument(reservation), projection = try transaction.getDocument(shared)
                        guard !owner.exists, !projection.exists else { throw NativeDataError("This code's removal needs checking. Refresh before retrying.") }
                        return true
                    }
                    let current = try NativeSchema.ownCode(placeID, before.data() ?? [:])
                    guard NativeSchema.sameRevision(current, expected) else { throw NativeDataError("Your code changed. Refresh before removing it.") }
                    transaction.deleteDocument(own); transaction.deleteDocument(reservation)
                    if current.visibility == "public" { transaction.deleteDocument(shared) }
                    try scope.check(); return true
                } catch { pointer?.pointee = error as NSError; return nil }
            }
            try scope.check()
            for ref in [own, reservation, shared] {
                guard !(try await ref.getDocument(source: .server)).exists else { throw NativeDataError("The code's removal could not be confirmed.") }
                try scope.check()
            }
            if selectedID == placeID { ownCode = nil }
        }
    }

    private func confirmPublicCodeUse(_ scope: NativeMutationScope, _ uid: String, _ expected: PasscodeReport) async throws {
        let database = db, shared = codeRef(expected.placeID, expected.reportID)
        let receipt = db.collection("users").document(uid).collection("restroomReadyPasscodeChecks").document(expected.reportID)
        _ = try await database.runTransaction { transaction, pointer in
            do {
                try scope.check()
                let before = try transaction.getDocument(shared)
                guard before.exists else { throw NativeDataError("This code is no longer public. Refresh the current reports.") }
                let current = try NativeSchema.publicCode(expected.placeID, expected.reportID, before.data() ?? [:])
                guard current.code == expected.code, current.codeVersion == expected.codeVersion else { throw NativeDataError("This code changed after you opened it. Its new version has not been verified.") }
                transaction.updateData(["lastVerifiedAt": FieldValue.serverTimestamp()], forDocument: shared)
                transaction.setData(["placeID": expected.placeID, "codeUpdatedAt": current.versionTimestamp, "verifiedAt": FieldValue.serverTimestamp()], forDocument: receipt)
                try scope.check(); return true
            } catch { pointer?.pointee = error as NSError; return nil }
        }
        try scope.check()
        let fresh = try await shared.getDocument(source: .server); try scope.check()
        let result = try NativeSchema.publicCode(expected.placeID, expected.reportID, fresh.data() ?? [:])
        guard result.codeVersion == expected.codeVersion else { throw NativeDataError("The code changed after your confirmation. The new version has not been checked by this action.") }
        let check = try await receipt.getDocument(source: .server); try scope.check()
        let data = check.data() ?? [:]; try NativeSchema.exact(data, ["placeID", "codeUpdatedAt", "verifiedAt"])
        guard check.exists, data["placeID"] as? String == expected.placeID, let version = data["codeUpdatedAt"] as? Timestamp, version.isEqual(expected.versionTimestamp) else { throw NativeDataError("Your verification receipt could not be confirmed.") }
        _ = try NativeSchema.timestamp(data["verifiedAt"])
        if selectedID == expected.placeID { publicCodes.removeAll { $0.reportID == result.reportID }; publicCodes.append(result); publicCodes.sort { $0.codeUpdatedAt > $1.codeUpdatedAt } }
    }

    func verifyCode(_ report: PasscodeReport) async -> Bool {
        await perform(analytics: { [.verifyCode] }, publicContribution: true) { scope in let uid = scope.uid; try scope.check(); try validatePlace(report.placeID); try await confirmPublicCodeUse(scope, uid, report) }
    }

    func verifyOwnCode() async -> Bool {
        await perform(analytics: { [.verifyCode] }, publicContribution: ownCode?.visibility == "public") { scope in
            let uid = scope.uid; try scope.check()
            guard let expected = ownCode else { throw NativeDataError("Load your code before confirming successful use.") }
            if expected.visibility == "public" {
                try await confirmPublicCodeUse(scope, uid, PasscodeReport(placeID: expected.placeID, reportID: expected.reportID, code: expected.code, codeUpdatedAt: expected.codeUpdatedAt, lastVerifiedAt: expected.lastVerifiedAt, versionTimestamp: expected.versionTimestamp))
                return
            }
            let database = db, own = ownRef(uid, expected.placeID), saved = savedRef(uid, expected.placeID)
            _ = try await database.runTransaction { transaction, pointer in
                do {
                    try scope.check()
                    let before = try transaction.getDocument(own), savedBefore = try transaction.getDocument(saved)
                    let current = try before.exists ? NativeSchema.ownCode(expected.placeID, before.data() ?? [:]) : nil
                    guard NativeSchema.sameRevision(current, expected), current?.visibility == "private" else { throw NativeDataError("Your code or its visibility changed. Refresh before confirming it.") }
                    transaction.updateData(["lastVerifiedAt": FieldValue.serverTimestamp()], forDocument: own)
                    if !savedBefore.exists { transaction.setData(["placeID": expected.placeID, "savedAt": FieldValue.serverTimestamp()], forDocument: saved) }
                    try scope.check(); return true
                } catch { pointer?.pointee = error as NSError; return nil }
            }
            let result = try await confirmCode(scope, uid, expected.placeID, expected.code, "private")
            guard NativeSchema.sameRevision(result, expected) else { throw NativeDataError("Your code changed after confirmation. Refresh its current version.") }
            if selectedID == expected.placeID { ownCode = result }
        }
    }

    private struct DecodedRestroomRequest {
        let request: OwnRestroomRequest
        let listing: [String: Any]
        let submittedAt: Timestamp
        let codeDraft: (code: String, visibility: String)?
        let codeFingerprint: String?
    }

    nonisolated private static func decodeRestroomRequest(_ id: String, _ data: [String: Any]) throws -> DecodedRestroomRequest {
        let pending = data["status"] as? String == "pending"
        let fields = ["schemaVersion", "status", "revision", "submittedAt", "listing", "codeDraft"]
        try NativeSchema.exact(data, fields + (pending ? [] : ["reviewedAt", "reason", "codeFingerprint"]))
        func integer(_ key: String) throws -> Int {
            guard let number = data[key] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                  !["f", "d"].contains(String(cString: number.objCType)),
                  (0...2).contains(number.int64Value) else {
                throw NativeDataError("This restroom request has an invalid version.")
            }
            return Int(number.int64Value)
        }
        guard let status = data["status"] as? String, let listing = data["listing"] as? [String: Any] else {
            throw NativeDataError("This restroom request has invalid details.")
        }
        try NativeSchema.exact(listing, ["name", "address", "latitude", "longitude", "locationType", "entryRule",
            "stepFreeAccess", "passcodeRequired", "notes", "observedOn", "submittedAt"])
        let submitted = try NativeSchema.timestamp(data["submittedAt"])
        let place = try decodeCommunity(id, listing)
        let listingTime = try NativeSchema.timestamp(listing["submittedAt"])
        guard submitted.isEqual(listingTime) else { throw NativeDataError("This restroom request's dates do not match.") }
        let reviewed: Timestamp?
        let reason: String?
        if pending { reviewed = nil; reason = nil }
        else {
            reviewed = try NativeSchema.timestamp(data["reviewedAt"])
            guard let value = data["reason"] as? String,
                  reviewed!.compare(submitted) != .orderedAscending else {
                throw NativeDataError("This restroom request's review could not be read safely.")
            }
            reason = value
        }
        let state: RestroomSubmissionState
        do {
            state = try RestroomSubmissionState(schemaVersion: integer("schemaVersion"), status: status,
                revision: integer("revision"), submittedAt: submitted.dateValue(), reviewedAt: reviewed?.dateValue(), reason: reason)
        } catch { throw NativeDataError("This restroom request has an invalid review status.") }
        var draft: (String, String)?
        var fingerprint: String?
        if pending {
            if !NativeSchema.null(data["codeDraft"]) {
                guard let record = data["codeDraft"] as? [String: Any] else { throw NativeDataError("This request's optional code could not be checked.") }
                try NativeSchema.exact(record, ["code", "visibility"])
                guard let raw = record["code"] as? String, let visibility = record["visibility"] as? String,
                      ["private", "public"].contains(visibility), listing["passcodeRequired"] as? String == "yes" else {
                    throw NativeDataError("This request's optional code could not be checked.")
                }
                let code = try NativeSchema.code(raw)
                guard code == raw else { throw NativeDataError("This request's optional code has invalid formatting.") }
                _ = try RestroomSubmissionCodeCommitment.fingerprint(normalizedCode: code, visibility: visibility)
                draft = (code, visibility)
            }
        } else {
            guard NativeSchema.null(data["codeDraft"]) else { throw NativeDataError("This reviewed request has an invalid private draft.") }
            if !NativeSchema.null(data["codeFingerprint"]) {
                guard let value = data["codeFingerprint"] as? String, RestroomSubmissionCodeCommitment.valid(value),
                      listing["passcodeRequired"] as? String == "yes" else {
                    throw NativeDataError("This reviewed request could not be checked safely.")
                }
                fingerprint = value
            }
        }
        guard let address = place.address else { throw NativeDataError("This request's venue address could not be read.") }
        return DecodedRestroomRequest(request: OwnRestroomRequest(id: id, name: place.name, address: address,
            submittedAt: submitted.dateValue(), state: state), listing: listing, submittedAt: submitted,
            codeDraft: draft, codeFingerprint: fingerprint)
    }

    #if DEBUG
    /// Native Firestore wire-type/decoder checks for the presentation preview.
    /// No Auth user, Firestore query, reservation or publication is created.
    nonisolated static func reviewSubmissionRequests() -> [OwnRestroomRequest] {
        let stamp = Timestamp(date: Date(timeIntervalSince1970: 1_790_000_000))
        let reviewed = Timestamp(date: stamp.dateValue().addingTimeInterval(60))
        func listing(_ name: String) -> [String: Any] {
            ["name": name, "address": "Local presentation example", "latitude": 40.754,
             "longitude": -73.984, "locationType": "other", "entryRule": "unknown", "stepFreeAccess": "unknown",
             "passcodeRequired": "yes", "notes": "", "observedOn": NSNull(), "submittedAt": stamp]
        }
        let pending: [String: Any] = ["schemaVersion": 1, "status": "pending", "revision": 1, "submittedAt": stamp,
            "listing": listing("Pending request"), "codeDraft": ["code": "TELEMETRY-PRIVATE-0042#", "visibility": "private"]]
        guard let commitment = try? RestroomSubmissionCodeCommitment.fingerprint(normalizedCode: "TELEMETRY-PRIVATE-0042#", visibility: "private") else { return [] }
        let approved: [String: Any] = ["schemaVersion": 1, "status": "approved", "revision": 2, "submittedAt": stamp,
            "listing": listing("Approved request"), "codeDraft": NSNull(), "reviewedAt": reviewed, "reason": "", "codeFingerprint": commitment]
        var denied = approved; denied["status"] = "denied"; denied["reason"] = "duplicate"
        denied["listing"] = listing("Denied request"); denied["codeFingerprint"] = NSNull()
        var bad: [[String: Any]] = []
        var changed = pending; changed["schemaVersion"] = true; bad.append(changed)
        changed = pending; changed["revision"] = 1.0; bad.append(changed)
        changed = pending; changed["revision"] = 2; bad.append(changed)
        changed = pending; changed["codeFingerprint"] = commitment; bad.append(changed)
        var changedListing = listing("Pending request"); changedListing["moderationStatus"] = "approved"
        changed = pending; changed["listing"] = changedListing; bad.append(changed)
        changedListing = listing("Pending request"); changedListing["submittedAt"] = reviewed
        changed = pending; changed["listing"] = changedListing; bad.append(changed)
        changed = pending; changed["codeDraft"] = ["code": " CODE ", "visibility": "private"]; bad.append(changed)
        changed = pending; changed["codeDraft"] = ["code": "CODE", "visibility": "everyone"]; bad.append(changed)
        changed = approved; changed["codeDraft"] = ["code": "CODE", "visibility": "private"]; bad.append(changed)
        changed = approved; changed["codeFingerprint"] = "not-a-valid-commitment"; bad.append(changed)
        changed = approved; changed["reason"] = "free text"; bad.append(changed)
        changed = approved; changed["reviewedAt"] = Timestamp(date: stamp.dateValue().addingTimeInterval(-1)); bad.append(changed)
        changedListing = listing("Approved request"); changedListing["passcodeRequired"] = "no"
        changed = approved; changed["listing"] = changedListing; bad.append(changed)
        let testID = "community-00000000000000000001"
        for candidate in bad {
            do { _ = try decodeRestroomRequest(testID, candidate); return [] }
            catch { }
        }
        do {
            return try [pending, approved, denied].enumerated().map { index, fields in
                try decodeRestroomRequest("community-" + String(format: "%020d", index + 1), fields).request
            }
        } catch { return [] }
    }
    #endif

    private func confirmedRestroomRequest(_ scope: NativeMutationScope, _ id: String,
        _ expected: [String: Any], _ code: (code: String, visibility: String)?) async throws -> OwnRestroomRequest? {
        try scope.check()
        let request = db.collection("users").document(scope.uid).collection("restroomReadySubmissionRequests").document(id)
        let reservation = db.collection("restroomSubmissions").document(id)
        let result = try await db.runTransaction { transaction, pointer in
            do {
                try scope.check()
                let record = try transaction.getDocument(request)
                let receipt = try transaction.getDocument(reservation)
                try scope.check(); return [record, receipt]
            } catch { pointer?.pointee = error as NSError; return nil }
        }
        try scope.check()
        guard let pair = result as? [DocumentSnapshot], pair.count == 2 else {
            throw NativeDataError("Your restroom request could not be confirmed. Retry the same form.")
        }
        if !pair[0].exists && !pair[1].exists { return nil }
        guard pair[0].exists, pair[1].exists, let record = pair[0].data(), let ownership = pair[1].data() else {
            throw NativeDataError("An earlier restroom request needs checking. Retry the same form.")
        }
        try NativeSchema.exact(ownership, ["ownerUID", "submittedAt"])
        let decoded = try Self.decodeRestroomRequest(id, record)
        guard ownership["ownerUID"] as? String == scope.uid,
              let reservedAt = ownership["submittedAt"] as? Timestamp, reservedAt.isEqual(decoded.submittedAt) else {
            throw NativeDataError("Your restroom request's ownership could not be confirmed.")
        }
        var listing = decoded.listing; listing.removeValue(forKey: "submittedAt")
        guard NSDictionary(dictionary: listing).isEqual(to: expected) else {
            throw NativeDataError("An earlier version of this restroom request was already submitted. Check Restroom requests in Account.")
        }
        if decoded.request.state.status == .pending {
            guard decoded.codeDraft?.code == code?.code, decoded.codeDraft?.visibility == code?.visibility else {
                throw NativeDataError("An earlier version of this request's optional code was already submitted.")
            }
        } else {
            let expectedFingerprint = try code.map { try RestroomSubmissionCodeCommitment.fingerprint(normalizedCode: $0.code, visibility: $0.visibility) }
            guard decoded.codeFingerprint == expectedFingerprint else {
                throw NativeDataError("This reviewed request does not match the original optional code draft.")
            }
        }
        return decoded.request
    }

    func submitRestroomRequest(draft: NewPlaceDraft) async -> OwnRestroomRequest? {
        var confirmedRequest: OwnRestroomRequest?
        let success = await perform(analytics: { [.submitRestroomRequest] },
            deduplicationKey: "new-restroom-request:" + draft.id, publicContribution: true) { scope in
            let uid = scope.uid; try scope.check()
            guard draft.id.range(of: "^community-[A-Za-z0-9]{20}$", options: .regularExpression) != nil,
                  let latitude = draft.latitude, latitude.isFinite, (40.49...40.93).contains(latitude),
                  let longitude = draft.longitude, longitude.isFinite, (-74.26 ... -73.68).contains(longitude),
                  ["park", "library", "cafe", "restaurant", "store", "other"].contains(draft.locationType),
                  ["public", "customers", "unknown"].contains(draft.entryRule), ["yes", "no", "unknown"].contains(draft.stepFreeAccess),
                  ["yes", "no", "unknown"].contains(draft.passcodeRequired) else {
                throw NativeDataError("Choose a NYC location pin and valid entry details before submitting.")
            }
            func compact(_ text: String) -> String { text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ") }
            let name = try NativeSchema.text(compact(draft.name), max: 120), address = try NativeSchema.text(compact(draft.address), max: 240)
            let notes = try NativeSchema.text(draft.notes.trimmingCharacters(in: .whitespacesAndNewlines), max: 1000, required: false)
            for text in [name, address, notes] { try PublicTextSafety.validateForPublication(text) }
            var observed: Any = NSNull()
            if let date = draft.observedOn {
                var ny = Calendar(identifier: .gregorian); ny.timeZone = TimeZone(identifier: "America/New_York")!
                var utc = Calendar(identifier: .gregorian); utc.timeZone = TimeZone(secondsFromGMT: 0)!
                let parts = ny.dateComponents([.year, .month, .day], from: date)
                guard let midnight = utc.date(from: parts), midnight >= NativeSchema.firstDate,
                      ny.startOfDay(for: date) <= ny.startOfDay(for: Date()), midnight <= Date() else {
                    throw NativeDataError("Choose a real observation date from 2000 through today, or leave it blank.")
                }
                observed = Timestamp(date: midnight)
            }
            let fields: [String: Any] = ["name": name, "address": address, "latitude": latitude, "longitude": longitude,
                "locationType": draft.locationType, "entryRule": draft.entryRule, "stepFreeAccess": draft.stepFreeAccess,
                "passcodeRequired": draft.passcodeRequired, "notes": notes, "observedOn": observed]
            var optionalCode: (code: String, visibility: String)?
            if let code = draft.code {
                guard draft.passcodeRequired == "yes", ["private", "public"].contains(code.visibility) else {
                    throw NativeDataError("Choose Code required and a visibility before adding a code.")
                }
                let normalized = try NativeSchema.code(code.code)
                if code.visibility == "public" { try PublicTextSafety.validateForPublication(normalized) }
                _ = try RestroomSubmissionCodeCommitment.fingerprint(normalizedCode: normalized, visibility: code.visibility)
                optionalCode = (normalized, code.visibility)
            }
            if let existing = try await confirmedRestroomRequest(scope, draft.id, fields, optionalCode) {
                confirmedRequest = existing; return
            }
            let batch = db.batch(), id = draft.id
            var listing = fields; listing["submittedAt"] = FieldValue.serverTimestamp()
            let rawCode: Any = optionalCode.map { ["code": $0.code, "visibility": $0.visibility] as Any } ?? NSNull()
            let request: [String: Any] = ["schemaVersion": 1, "status": "pending", "revision": 1,
                "submittedAt": FieldValue.serverTimestamp(), "listing": listing, "codeDraft": rawCode]
            batch.setData(request, forDocument: db.collection("users").document(uid).collection("restroomReadySubmissionRequests").document(id))
            batch.setData(["ownerUID": uid, "submittedAt": FieldValue.serverTimestamp()],
                          forDocument: db.collection("restroomSubmissions").document(id))
            try scope.check()
            do { try await batch.commit() }
            catch {
                try scope.check()
                guard let _ = try await confirmedRestroomRequest(scope, id, fields, optionalCode) else { throw error }
            }
            try scope.check()
            guard let confirmed = try await confirmedRestroomRequest(scope, id, fields, optionalCode) else {
                throw NativeDataError("The request could not be confirmed. Retry the same form before creating another.")
            }
            confirmedRequest = confirmed
        }
        return success ? confirmedRequest : nil
    }

    nonisolated private static func unifiedObservationTime(_ date: Date) -> Timestamp {
        let stamp = Timestamp(date: date)
        return Timestamp(seconds: stamp.seconds, nanoseconds: stamp.nanoseconds / 1_000 * 1_000)
    }

    nonisolated private static func checkedUnifiedVisit(_ place: String, _ id: String,
        _ publicRecord: DocumentSnapshot, _ receipt: DocumentSnapshot) throws -> (VisitReport, String?)? {
        if !publicRecord.exists && !receipt.exists { return nil }
        guard publicRecord.exists, receipt.exists, let data = publicRecord.data(), let ownership = receipt.data() else {
            throw NativeDataError("An earlier visit report needs checking. Retry the same report.")
        }
        try NativeSchema.exact(ownership, ["placeID", "submittedAt", "codeReportID"])
        let report = try NativeSchema.unifiedVisit(id, place, data)
        let submitted = try NativeSchema.timestamp(ownership["submittedAt"])
        guard ownership["placeID"] as? String == place, submitted.isEqual(report.submissionTimestamp) else {
            throw NativeDataError("This visit report's ownership receipt could not be confirmed.")
        }
        var codeID: String?
        if !NativeSchema.null(ownership["codeReportID"]) {
            guard let value = ownership["codeReportID"] as? String, NativeSchema.id(value), report.codeRequired == "yes" else {
                throw NativeDataError("This visit report's optional code receipt is invalid.")
            }
            codeID = value
        }
        return (report, codeID)
    }

    nonisolated private static func unifiedSaved(_ snapshot: DocumentSnapshot, _ place: String) throws -> Bool {
        guard snapshot.exists else { return false }
        let data = snapshot.data() ?? [:]; try NativeSchema.exact(data, ["placeID", "savedAt"])
        guard data["placeID"] as? String == place, try NativeSchema.timestamp(data["savedAt"]).dateValue() <= Date() else {
            throw NativeDataError("The saved-place receipt could not be confirmed.")
        }
        return true
    }

    nonisolated private static func sameUnifiedVisit(_ report: VisitReport, _ fields: UnifiedVisitFields) -> Bool {
        report.observationTimestamp?.isEqual(unifiedObservationTime(fields.observedAt)) == true
            && report.entryRule == fields.entryRule && report.purchaseRequired == fields.purchaseRequired
            && report.codeRequired == fields.codeRequired && report.stairs == fields.stairs
            && report.soap == fields.soap && report.toiletPaper == fields.toiletPaper
            && report.floor == fields.floor && report.condition == fields.condition
            && report.elevatorPresent == fields.elevatorPresent && report.automaticDoorPresent == fields.automaticDoorPresent
            && report.comment == fields.comment && report.anonymous == fields.anonymous && report.authorName == fields.authorName
    }

    nonisolated private static func checkedUnifiedSubmission(_ scope: NativeMutationScope, _ place: String,
        _ id: String, _ fields: UnifiedVisitFields, _ optionalCode: CodeReportDraft?,
        _ snapshots: [DocumentSnapshot], requireSaved: Bool) throws -> VisitReport? {
        guard snapshots.count == (optionalCode == nil ? 2 : 6) else { throw NativeDataError("The visit save could not be checked.") }
        let existing = try checkedUnifiedVisit(place, id, snapshots[0], snapshots[1])
        guard let (report, linkedCodeID) = existing else {
            if optionalCode != nil && snapshots[2...4].contains(where: \.exists) {
                throw NativeDataError("This optional code ID is already in use. Reopen the form before starting another report.")
            }
            return nil
        }
        guard sameUnifiedVisit(report, fields), linkedCodeID == optionalCode?.id else {
            throw NativeDataError("An earlier version of this visit report was already shared. Retry its original draft or start a new report.")
        }
        if let draft = optionalCode {
            let expected = try CodeReportFields(code: draft.code, visibility: draft.visibility)
            guard let code = try checkedCodeReportPair(scope.uid, place, draft.id, snapshots[2], snapshots[3], snapshots[4]),
                  code.code == expected.code, code.visibility == expected.visibility,
                  code.creationTimestamp.isEqual(report.submissionTimestamp) else {
                throw NativeDataError("The visit is stored, but its original optional code changed or was removed. It has not been recreated.")
            }
            if requireSaved, code.visibility == "private", !(try unifiedSaved(snapshots[5], place)) {
                throw NativeDataError("The visit is stored, but its saved-place confirmation is unavailable. Retry this same report.")
            }
        }
        return report
    }

    private func readUnifiedSubmission(_ scope: NativeMutationScope, _ place: String, _ id: String,
        _ optionalCode: CodeReportDraft?) async throws -> [DocumentSnapshot] {
        var references = [unifiedVisitRef(place, id), unifiedVisitReceipt(scope.uid, id)]
        if let code = optionalCode {
            references += [ownCodeReportRef(scope.uid, code.id), codeReportOwnerRef(code.id),
                publicCodeReportRef(place, code.id), savedRef(scope.uid, place)]
        }
        let refs = references
        let result = try await db.runTransaction { transaction, pointer in
            do { try scope.check(); let records = try refs.map { try transaction.getDocument($0) }; try scope.check(); return records }
            catch { pointer?.pointee = error as NSError; return nil }
        }
        try scope.check()
        guard let snapshots = result as? [DocumentSnapshot] else { throw NativeDataError("This visit save could not be confirmed.") }
        return snapshots
    }

    func submitUnifiedVisit(placeID: String, draft: VisitDraft, reportingProblem: Bool = false) async -> Bool {
        await perform(analytics: {
            [reportingProblem ? .submitAmenityProblem : .submitVisitNote] + (draft.optionalCode == nil ? [] : [.submitCodeReport])
        }, deduplicationKey: "unified-visit:" + placeID + ":" + draft.id, publicContribution: true) { scope in
            try scope.check(); try validatePlace(placeID)
            let fields = try NativeSchema.unifiedVisitFields(draft)
            var optionalFields: CodeReportFields?
            if let code = draft.optionalCode {
                guard fields.codeRequired == "yes", NativeSchema.id(code.id) else { throw NativeDataError("Choose Code required before adding an optional code.") }
                optionalFields = try CodeReportFields(code: code.code, visibility: code.visibility)
                if code.visibility == "public" { try PublicTextSafety.validateForPublication(code.code) }
            }
            if !fields.anonymous {
                guard let current = auth.currentUser, current.uid == scope.uid else { throw NativeDataError("Your account changed. Retry with the same account.") }
                let token = try await current.getIDTokenResult(forcingRefresh: true); try scope.check()
                guard auth.currentUser === current, let name = token.claims["name"] as? String,
                      UnifiedVisitFields.validAuthorName(name), fields.authorName == name else {
                    throw NativeDataError("Your public display name changed or is unavailable. Reopen the form and choose Anonymous or the current account name.")
                }
            }
            let publicRef = unifiedVisitRef(placeID, draft.id), receipt = unifiedVisitReceipt(scope.uid, draft.id)
            var references = [publicRef, receipt]
            if let code = draft.optionalCode {
                references += [ownCodeReportRef(scope.uid, code.id), codeReportOwnerRef(code.id), publicCodeReportRef(placeID, code.id), savedRef(scope.uid, placeID)]
            }
            let refs = references
            var body: [String: Any] = ["schemaVersion": 1, "placeID": placeID,
                "observedAt": Self.unifiedObservationTime(fields.observedAt), "submittedAt": FieldValue.serverTimestamp(),
                "entryRule": fields.entryRule, "purchaseRequired": fields.purchaseRequired, "codeRequired": fields.codeRequired,
                "stairs": fields.stairs, "soap": fields.soap, "toiletPaper": fields.toiletPaper, "floor": fields.floor,
                "condition": fields.condition, "comment": fields.comment, "anonymous": fields.anonymous,
                "authorName": fields.authorName as Any? ?? NSNull()]
            if fields.elevatorPresent != "not-reported" { body["elevatorPresent"] = fields.elevatorPresent }
            if fields.automaticDoorPresent != "not-reported" { body["automaticDoorPresent"] = fields.automaticDoorPresent }
            let publicBody = body
            do {
                _ = try await db.runTransaction { transaction, pointer in
                    do {
                        try scope.check(); let snapshots = try refs.map { try transaction.getDocument($0) }; try scope.check()
                        if try Self.checkedUnifiedSubmission(scope, placeID, draft.id, fields, draft.optionalCode, snapshots, requireSaved: false) != nil {
                            if optionalFields?.visibility == "private", !(try Self.unifiedSaved(snapshots[5], placeID)) {
                                transaction.setData(["placeID": placeID, "savedAt": FieldValue.serverTimestamp()], forDocument: refs[5])
                            }
                            try scope.check(); return true
                        }
                        if optionalFields?.visibility == "private", snapshots[5].exists { _ = try Self.unifiedSaved(snapshots[5], placeID) }
                        transaction.setData(publicBody, forDocument: publicRef)
                        transaction.setData(["placeID": placeID, "submittedAt": FieldValue.serverTimestamp(), "codeReportID": draft.optionalCode?.id as Any? ?? NSNull()], forDocument: receipt)
                        if let code = optionalFields {
                            transaction.setData(["placeID": placeID, "code": code.code, "visibility": code.visibility,
                                "createdAt": FieldValue.serverTimestamp(), "codeUpdatedAt": FieldValue.serverTimestamp(), "lastVerifiedAt": NSNull()], forDocument: refs[2])
                            transaction.setData(["ownerUID": scope.uid, "placeID": placeID, "createdAt": FieldValue.serverTimestamp()], forDocument: refs[3])
                            if code.visibility == "public" {
                                transaction.setData(["placeID": placeID, "code": code.code, "codeUpdatedAt": FieldValue.serverTimestamp()], forDocument: refs[4])
                            } else if !snapshots[5].exists {
                                transaction.setData(["placeID": placeID, "savedAt": FieldValue.serverTimestamp()], forDocument: refs[5])
                            }
                        }
                        try scope.check(); return true
                    } catch { pointer?.pointee = error as NSError; return nil }
                }
            } catch {
                try scope.check()
                guard try Self.checkedUnifiedSubmission(scope, placeID, draft.id, fields, draft.optionalCode,
                    await readUnifiedSubmission(scope, placeID, draft.id, draft.optionalCode), requireSaved: true) != nil else { throw error }
            }
            guard let confirmed = try Self.checkedUnifiedSubmission(scope, placeID, draft.id, fields, draft.optionalCode,
                await readUnifiedSubmission(scope, placeID, draft.id, draft.optionalCode), requireSaved: true) else {
                throw NativeDataError("The visit save could not be confirmed. Retry this same report before creating another.")
            }
            if selectedID == placeID {
                ownVisitIDs.insert(confirmed.ownershipID); putVisit(confirmed)
                if optionalFields?.visibility == "private" { savedIDs.insert(placeID) }
            }
        }
    }

    private func removeUnifiedVisit(_ report: VisitReport) async -> Bool {
        await perform(analytics: { [.removeVisitNote] }, deduplicationKey: "remove-unified-visit:" + report.placeID + ":" + report.reportID) { scope in
            try scope.check(); try validatePlace(report.placeID)
            guard NativeSchema.id(report.reportID) else { throw NativeDataError("Choose a valid visit report.") }
            let record = unifiedVisitRef(report.placeID, report.reportID), receipt = unifiedVisitReceipt(scope.uid, report.reportID)
            func confirm() async throws -> (VisitReport, String?)? {
                let result = try await db.runTransaction { transaction, pointer in
                    do { try scope.check(); let pair = [try transaction.getDocument(record), try transaction.getDocument(receipt)]; try scope.check(); return pair }
                    catch { pointer?.pointee = error as NSError; return nil }
                }
                try scope.check()
                guard let pair = result as? [DocumentSnapshot], pair.count == 2 else { throw NativeDataError("Visit removal could not be confirmed.") }
                return try Self.checkedUnifiedVisit(report.placeID, report.reportID, pair[0], pair[1])
            }
            if let (current, _) = try await confirm() {
                guard current.submissionTimestamp.isEqual(report.submissionTimestamp) else { throw NativeDataError("This visit report changed. Refresh before removing it.") }
                let batch = db.batch(); batch.deleteDocument(record); batch.deleteDocument(receipt); try scope.check()
                do { try await batch.commit() }
                catch { try scope.check(); if try await confirm() != nil { throw error } }
                guard try await confirm() == nil else { throw NativeDataError("Visit removal could not be confirmed. Retry the same removal.") }
            }
            if selectedID == report.placeID { forgetVisit(report) }
        }
    }

    private func confirmedVisit(_ scope: NativeMutationScope, _ uid: String, _ place: String, _ id: String) async throws -> VisitReport? {
        let publicRecord = try await visitRef(place, id).getDocument(source: .server); try scope.check()
        let receipt = try await visitReceipt(uid, id).getDocument(source: .server); try scope.check()
        if !publicRecord.exists && !receipt.exists { return nil }
        guard publicRecord.exists, receipt.exists, let data = publicRecord.data(), let ownership = receipt.data() else { throw NativeDataError("An earlier observation request needs checking. Refresh before starting another.") }
        try NativeSchema.exact(ownership, ["placeID", "submittedAt"])
        guard ownership["placeID"] as? String == place, let publicTime = data["submittedAt"] as? Timestamp, let privateTime = ownership["submittedAt"] as? Timestamp, publicTime.isEqual(privateTime) else { throw NativeDataError("This observation's ownership receipt could not be confirmed.") }
        return try NativeSchema.visit(id, place, data)
    }

    private func sameVisit(_ report: VisitReport, _ draft: VisitDraft) -> Bool {
        abs(report.observedAt.timeIntervalSince(draft.observedAt)) < 0.001 && report.entryRule == draft.entryRule && report.purchaseRequired == draft.purchaseRequired && report.codeRequired == draft.codeRequired
            && report.stairs == draft.stairs && report.soap == draft.soap && report.toiletPaper == draft.toiletPaper && report.floor == draft.floor && report.condition == draft.condition
    }

    func submitVisit(placeID: String, draft: VisitDraft) async -> Bool {
        await perform(analytics: { [.submitVisitNote] }, deduplicationKey: "legacy-visit:" + placeID + ":" + draft.id, publicContribution: true) { scope in
            let uid = scope.uid; try scope.check(); try validatePlace(placeID)
            var fields = try NativeSchema.visitFields(draft)
            if let existing = try await confirmedVisit(scope, uid, placeID, draft.id) {
                guard sameVisit(existing, draft) else { throw NativeDataError("An earlier version of this observation was already shared. Refresh before starting another.") }
                if selectedID == placeID { ownVisitIDs.insert(existing.id) }; return
            }
            fields["placeID"] = placeID; fields["submittedAt"] = FieldValue.serverTimestamp()
            let batch = db.batch()
            batch.setData(fields, forDocument: visitRef(placeID, draft.id))
            batch.setData(["placeID": placeID, "submittedAt": FieldValue.serverTimestamp()], forDocument: visitReceipt(uid, draft.id))
            try scope.check()
            do { try await batch.commit() }
            catch {
                try scope.check()
                guard let existing = try await confirmedVisit(scope, uid, placeID, draft.id), sameVisit(existing, draft) else { throw error }
            }
            guard let confirmed = try await confirmedVisit(scope, uid, placeID, draft.id), sameVisit(confirmed, draft) else { throw NativeDataError("The observation save could not be confirmed. Retry this same observation before creating another.") }
            if selectedID == placeID { ownVisitIDs.insert(confirmed.ownershipID); putVisit(confirmed) }
        }
    }

    func removeVisit(_ report: VisitReport) async -> Bool {
        if report.source == .unified { return await removeUnifiedVisit(report) }
        return await perform(analytics: { [.removeVisitNote] }, deduplicationKey: "remove-legacy-visit:" + report.placeID + ":" + report.id) { scope in
            let uid = scope.uid; try scope.check(); try validatePlace(report.placeID)
            guard NativeSchema.id(report.id) else { throw NativeDataError("Choose a valid visit observation.") }
            if try await confirmedVisit(scope, uid, report.placeID, report.id) == nil {
                if selectedID == report.placeID { forgetVisit(report) }
                return
            }
            let batch = db.batch(); batch.deleteDocument(visitRef(report.placeID, report.id)); batch.deleteDocument(visitReceipt(uid, report.id))
            try scope.check()
            do { try await batch.commit() }
            catch {
                try scope.check()
                if try await confirmedVisit(scope, uid, report.placeID, report.id) != nil { throw error }
            }
            guard try await confirmedVisit(scope, uid, report.placeID, report.id) == nil else { throw NativeDataError("Observation removal could not be confirmed. Refresh before retrying.") }
            if selectedID == report.placeID { forgetVisit(report) }
        }
    }

    nonisolated private static func vote(_ snapshot: DocumentSnapshot) throws -> Double? {
        guard snapshot.exists else { return nil }
        let data = snapshot.data() ?? [:]; try NativeSchema.exact(data, ["stars", "updatedAt"])
        let value = try NativeSchema.number(data["stars"])
        guard NativeSchema.stars(value) else { throw NativeDataError("Your stored rating has invalid details.") }
        _ = try NativeSchema.timestamp(data["updatedAt"]); return value
    }

    nonisolated private static func decodeAccessDetails(_ id: String, _ data: [String: Any]) throws -> RestroomAccessDetails {
        var decoded = data
        for key in ["reportedAt", "updatedAt"] {
            guard let value = data[key] as? Timestamp else { throw RestroomAccessDetails.DecodeError.invalidRecord }
            decoded[key] = value.dateValue()
        }
        if !(data["observedOn"] is NSNull) {
            guard let value = data["observedOn"] as? Timestamp else { throw RestroomAccessDetails.DecodeError.invalidRecord }
            decoded["observedOn"] = value.dateValue()
        }
        return try RestroomAccessDetails.decode(id: id, data: decoded)
    }

    nonisolated private static func decodeCommunity(_ id: String, _ data: [String: Any]) throws -> Place {
        let required = ["name", "address", "latitude", "longitude", "locationType", "entryRule", "stepFreeAccess", "notes", "observedOn", "submittedAt"]
        guard id.range(of: "^community-[A-Za-z0-9]{20}$", options: .regularExpression) != nil,
              Set(required).isSubset(of: Set(data.keys)), Set(data.keys).isSubset(of: Set(required + ["passcodeRequired"])) else { throw NativeDataError("Invalid community location schema.") }
        let name = try NativeSchema.text(data["name"], max: 120), address = try NativeSchema.text(data["address"], max: 240), notes = try NativeSchema.text(data["notes"], max: 1000, required: false)
        let latitude = try NativeSchema.number(data["latitude"]), longitude = try NativeSchema.number(data["longitude"])
        guard (40.49...40.93).contains(latitude), (-74.26 ... -73.68).contains(longitude),
              let type = data["locationType"] as? String, ["park", "library", "cafe", "restaurant", "store", "other"].contains(type),
              let entry = data["entryRule"] as? String, ["public", "customers", "unknown"].contains(entry),
              let access = data["stepFreeAccess"] as? String, ["yes", "no", "unknown"].contains(access) else { throw NativeDataError("Invalid community location details.") }
        if data.keys.contains("passcodeRequired"), !(data["passcodeRequired"] is String) { throw NativeDataError("Invalid code requirement.") }
        let requirement = data["passcodeRequired"] as? String ?? "unknown"
        guard ["yes", "no", "unknown"].contains(requirement) else { throw NativeDataError("Invalid code requirement.") }
        let submitted = try NativeSchema.timestamp(data["submittedAt"])
        var decoded = data; decoded["name"] = name; decoded["address"] = address; decoded["notes"] = notes
        decoded["submittedAt"] = submitted.dateValue(); decoded["passcodeRequired"] = requirement
        if NativeSchema.null(data["observedOn"]) { decoded.removeValue(forKey: "observedOn") }
        else {
            let observed = try NativeSchema.timestamp(data["observedOn"])
            guard observed.compare(submitted) != .orderedDescending, observed.nanoseconds == 0, observed.seconds % 86_400 == 0 else { throw NativeDataError("Invalid observation date.") }
            decoded["observedOn"] = observed.dateValue()
        }
        guard let result = Place.community(id: id, data: decoded) else { throw NativeDataError("The community location could not be decoded.") }
        return result
    }

    nonisolated private static func decodeSourceComment(_ id: String, _ place: String, _ data: [String: Any]) throws -> SourceComment {
        try NativeSchema.exact(data, ["placeID", "sourceID", "sourceKind", "text", "displayName", "publishedOn", "displayedDate", "dateStatus", "sourceURL", "sourceTitle", "capturedAt", "observedOn", "verified", "limitations", "submittedAt"])
        guard id.range(of: "^[a-f0-9]{20}$", options: .regularExpression) != nil, data["placeID"] as? String == place,
              let source = data["sourceID"] as? String, source.range(of: "^[A-Za-z0-9][A-Za-z0-9:._~-]{0,159}$", options: .regularExpression) != nil,
              let kind = data["sourceKind"] as? String, ["post", "comment"].contains(kind), data["displayName"] as? String == "Anonymous user", NativeSchema.null(data["observedOn"]),
              let verified = data["verified"] as? NSNumber, CFGetTypeID(verified) == CFBooleanGetTypeID(), !verified.boolValue,
              let status = data["dateStatus"] as? String, ["explicit-year", "resolved-relative", "unknown-year", "unknown"].contains(status),
              let capturedString = data["capturedAt"] as? String,
              capturedString.range(of: "^\\d{4}-\\d{2}-\\d{2}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,9})?(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$", options: .regularExpression) != nil,
              calendarDate(String(capturedString.prefix(10))) != nil else { throw NativeDataError("Invalid source note.") }
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let basic = ISO8601DateFormatter()
        guard let captured = formatter.date(from: capturedString) ?? basic.date(from: capturedString) else { throw NativeDataError("Invalid source capture date.") }
        let submitted = try NativeSchema.timestamp(data["submittedAt"]).dateValue()
        guard captured >= NativeSchema.firstDate, captured <= submitted else { throw NativeDataError("Invalid source dates.") }
        let published = data["publishedOn"] as? String
        if ["unknown-year", "unknown"].contains(status) { guard NativeSchema.null(data["publishedOn"]) else { throw NativeDataError("An undated source note cannot receive an invented year.") } }
        else {
            guard let published, calendarDate(published) != nil, published <= String(capturedString.prefix(10)) else { throw NativeDataError("Invalid publication date.") }
        }
        var url: URL?
        if !NativeSchema.null(data["sourceURL"]) {
            guard let text = data["sourceURL"] as? String, text.utf16.count <= 4096, text.hasPrefix("https://"), text.range(of: "[\\s\\\\]", options: .regularExpression) == nil,
                  let candidate = URLComponents(string: text), candidate.scheme == "https", candidate.user == nil, candidate.password == nil,
                  candidate.port == nil || candidate.port == 443, let rawHost = candidate.host?.lowercased() else { throw NativeDataError("Invalid source link.") }
            let host = rawHost.hasSuffix(".") ? String(rawHost.dropLast()) : rawHost
            guard host.contains("."), !host.contains(":"),
                  !["localhost", "local", "internal", "test", "invalid"].contains(where: { host == $0 || host.hasSuffix("." + $0) }), host.range(of: "^[0-9.]+$", options: .regularExpression) == nil,
                  !(candidate.queryItems ?? []).contains(where: { $0.name.range(of: "token|password|secret|authorization|api.?key|credential|session|signature|key-pair-id|policy", options: [.regularExpression, .caseInsensitive]) != nil }), let safe = candidate.url else { throw NativeDataError("Invalid source link.") }
            url = safe
        }
        func english(_ value: Any?, _ maximum: Int, _ required: Bool = true) throws -> String {
            let text = try NativeSchema.text(value, max: maximum, required: required)
            guard text.range(of: "\\p{Han}", options: .regularExpression) == nil else { throw NativeDataError("A source note has not been translated into English.") }
            return text
        }
        return SourceComment(id: id, placeID: place, sourceID: source, sourceKind: kind, text: try english(data["text"], 1000), displayName: "Anonymous user", publishedOn: published, displayedDate: try english(data["displayedDate"], 500, false), dateStatus: status, sourceURL: url, sourceTitle: try english(data["sourceTitle"], 300), capturedAt: captured, limitations: try english(data["limitations"], 4000), submittedAt: submitted)
    }

    nonisolated private static func calendarDate(_ value: String) -> Date? {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
        guard let date = formatter.date(from: value), formatter.string(from: date) == value, date >= NativeSchema.firstDate else { return nil }; return date
    }
}
