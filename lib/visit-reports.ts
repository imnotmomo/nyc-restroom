import {
  collection, doc, getDocFromServer, getFirestore, limit, onSnapshot, orderBy, query, runTransaction,
  serverTimestamp, Timestamp, writeBatch, type DocumentData, type Firestore,
} from "firebase/firestore";
import { getFirebaseClient, getFirebaseConfigurationError, type FirebaseClient } from "@/lib/firebase-client";
import {
  PUBLIC_VISIT_REPORT_LIMIT, isVisitReportID, isVisitReportPlaceID, normalizeVisitReportInput,
  sameVisitReportInput, normalizeUnifiedVisitReport, type UnifiedVisitReport, type VisitReport, type VisitReportInput,
} from "@/lib/visit-report-model";

export type { ReportAnswer, ReportCondition, ReportEntryRule, ReportFloor, UnifiedVisitReport, VisitReport, VisitReportInput } from "@/lib/visit-report-model";
export { PUBLIC_VISIT_REPORT_LIMIT } from "@/lib/visit-report-model";

class VisitReportError extends Error {}

function requireClient(): FirebaseClient {
  const client = getFirebaseClient();
  if (!client) throw new VisitReportError(getFirebaseConfigurationError() ?? "Visit reporting isn’t connected in this build.");
  return client;
}

function assertAccount(client: FirebaseClient, uid: string): void {
  if (!uid || client.auth.currentUser?.uid !== uid) {
    throw new VisitReportError("Your account changed during this request. Return to your original account to check the report before trying again.");
  }
  if (client.auth.currentUser.isAnonymous) throw new VisitReportError("Sign in with Google to share or remove a visit report.");
}

function assertPlace(placeID: string): void {
  if (!isVisitReportPlaceID(placeID)) throw new VisitReportError("Choose a location from the current finder before sharing a report.");
}

function assertReportID(id: string): void {
  if (!isVisitReportID(id)) throw new VisitReportError("This report’s request ID is invalid. Reopen the observation form.");
}

function readableError(error: unknown): Error {
  if (error instanceof VisitReportError) return error;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code).replace(/^firestore\//, "") : "";
  if (code === "permission-denied" || code === "unauthenticated") {
    return new VisitReportError("This visit-report request wasn’t authorized. Check your account and retry the same report; no new save has been confirmed.");
  }
  return new VisitReportError("The visit-report request couldn’t be confirmed. Check your connection and retry the same report before creating another.");
}

const publicReference = (database: Firestore, placeID: string, id: string) => doc(database, "restroomVisitReports", placeID, "reports", id);
const receiptReference = (database: Firestore, uid: string, id: string) => doc(database, "users", uid, "restroomReadyVisitReceipts", id);

function decodeReport(id: string, expectedPlaceID: string, data: DocumentData): VisitReport {
  if (!isVisitReportID(id) || Object.keys(data).length !== 11 || data.placeID !== expectedPlaceID
    || !(data.observedAt instanceof Timestamp) || !(data.submittedAt instanceof Timestamp)) {
    throw new VisitReportError("A visit report couldn’t be read safely. Other valid reports can still be shown.");
  }
  const { placeID, observedAt, submittedAt, ...facts } = data;
  try {
    const normalized = normalizeVisitReportInput({ ...facts, observedAt: observedAt.toDate() }, submittedAt.toDate());
    return { ...normalized, id, placeID, submittedAt: submittedAt.toDate() };
  } catch {
    throw new VisitReportError("A visit report has invalid dates or details and is hidden. Other valid reports can still be shown.");
  }
}

function validReceipt(data: DocumentData, placeID: string): boolean {
  return Object.keys(data).length === 2 && data.placeID === placeID && data.submittedAt instanceof Timestamp
    && Number.isFinite(data.submittedAt.toMillis()) && data.submittedAt.toMillis() >= Date.UTC(2000, 0, 1);
}

export function newVisitReportID(): string {
  return doc(collection(getFirestore(requireClient().app), "restroomVisitReports")).id;
}

export function watchVisitReports(placeID: string, onChange: (reports: VisitReport[]) => void, onError: (error: Error) => void): () => void {
  try {
    assertPlace(placeID);
    const feed = query(collection(getFirestore(requireClient().app), "restroomVisitReports", placeID, "reports"), orderBy("observedAt", "desc"), limit(PUBLIC_VISIT_REPORT_LIMIT));
    return onSnapshot(feed, { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const reports: VisitReport[] = [];
      let hidden = 0;
      for (const entry of snapshot.docs) {
        try { reports.push(decodeReport(entry.id, placeID, entry.data())); }
        catch { hidden += 1; }
      }
      onChange(reports);
      if (hidden) onError(new VisitReportError("Some visit reports had invalid details and are hidden. Other available reports are shown."));
    }, (error) => onError(readableError(error)));
  } catch (error) {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) onError(readableError(error)); });
    return () => { cancelled = true; };
  }
}

/** New native reports are readable here; web publication/removal still uses only the legacy contract. */
export function watchUnifiedVisitReports(placeID: string, onChange: (reports: UnifiedVisitReport[]) => void, onError: (error: Error) => void): () => void {
  let active = true;
  try {
    assertPlace(placeID);
    const feed = query(collection(getFirestore(requireClient().app), "restroomUnifiedVisits", placeID, "reports"), orderBy("observedAt", "desc"), limit(PUBLIC_VISIT_REPORT_LIMIT));
    const unsubscribe = onSnapshot(feed, { includeMetadataChanges: true }, snapshot => {
      if (!active || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const reports: UnifiedVisitReport[] = [];
      let hidden = 0;
      for (const entry of snapshot.docs) {
        try {
          const data = entry.data();
          if (!(data.observedAt instanceof Timestamp) || !(data.submittedAt instanceof Timestamp)
            || data.submittedAt.toMillis() > Date.now()
            || data.observedAt.seconds > data.submittedAt.seconds
            || data.observedAt.seconds === data.submittedAt.seconds && data.observedAt.nanoseconds > data.submittedAt.nanoseconds) throw new VisitReportError("Invalid report time.");
          reports.push(normalizeUnifiedVisitReport(entry.id, placeID, { ...data, observedAt: data.observedAt.toDate(), submittedAt: data.submittedAt.toDate() }));
        } catch { hidden += 1; }
      }
      onChange(reports);
      if (active && hidden) onError(new VisitReportError("Some unified visit reports had invalid details and are hidden. Other available reports are shown."));
    }, () => { if (active) onError(new VisitReportError("Unified visitor reports could not load. Other available observations remain visible; retry reports.")); });
    return () => { active = false; unsubscribe(); };
  } catch (error) {
    queueMicrotask(() => { if (active) onError(readableError(error)); });
    return () => { active = false; };
  }
}

/** Only inspect private receipts for the at-most-ten public reports already visible. */
export async function readOwnVisitReportIDs(uid: string, placeID: string, visibleIDs: readonly string[]): Promise<string[]> {
  assertPlace(placeID);
  if (!Array.isArray(visibleIDs) || visibleIDs.length > PUBLIC_VISIT_REPORT_LIMIT || visibleIDs.some((id) => !isVisitReportID(id))) {
    throw new VisitReportError("Refresh the visible visit reports before checking which ones you can remove.");
  }
  const client = requireClient();
  assertAccount(client, uid);
  const database = getFirestore(client.app);
  try {
    const receipts = await Promise.all([...new Set(visibleIDs)].map(async (id) => {
      const snapshot = await getDocFromServer(receiptReference(database, uid, id));
      assertAccount(client, uid);
      if (!snapshot.exists()) return null;
      // A same-ID receipt for another place is not ownership of this public report.
      if (snapshot.data().placeID !== placeID) return null;
      if (!validReceipt(snapshot.data(), placeID)) throw new VisitReportError("A report’s ownership receipt couldn’t be read. Refresh before trying to remove it.");
      return id;
    }));
    assertAccount(client, uid);
    return receipts.filter((id): id is string => id !== null);
  } catch (error) { assertAccount(client, uid); throw readableError(error); }
}

async function readConfirmedReport(database: Firestore, client: FirebaseClient, uid: string, placeID: string, id: string): Promise<VisitReport | null> {
  // One server snapshot prevents a concurrent atomic commit from looking like a partial pair.
  const [report, receipt] = await runTransaction(database, async transaction => {
    assertAccount(client, uid);
    const pair = await Promise.all([
      transaction.get(publicReference(database, placeID, id)), transaction.get(receiptReference(database, uid, id)),
    ]);
    assertAccount(client, uid);
    return pair;
  });
  assertAccount(client, uid);
  if (!report.exists() && !receipt.exists()) return null;
  if (!report.exists() || !receipt.exists() || !validReceipt(receipt.data(), placeID)
    || !(report.data().submittedAt instanceof Timestamp) || !receipt.data().submittedAt.isEqual(report.data().submittedAt)) {
    throw new VisitReportError("An earlier request with this ID needs checking. Refresh the reports before creating another or removing anything.");
  }
  return decodeReport(id, placeID, report.data());
}

export async function createVisitReport(uid: string, placeID: string, id: string, input: VisitReportInput): Promise<VisitReport> {
  assertPlace(placeID); assertReportID(id);
  const normalized = normalizeVisitReportInput(input);
  const client = requireClient();
  assertAccount(client, uid);
  const database = getFirestore(client.app);
  const checkDraft = (report: VisitReport) => {
    if (!sameVisitReportInput(report, normalized)) throw new VisitReportError("An earlier version of this report was already shared. Refresh the reports before starting a different observation.");
    return report;
  };
  try {
    const existing = await readConfirmedReport(database, client, uid, placeID, id);
    if (existing) return checkDraft(existing);
    assertAccount(client, uid);
    const batch = writeBatch(database);
    batch.set(publicReference(database, placeID, id), {
      ...normalized, placeID, observedAt: Timestamp.fromDate(normalized.observedAt), submittedAt: serverTimestamp(),
    });
    batch.set(receiptReference(database, uid, id), { placeID, submittedAt: serverTimestamp() });
    assertAccount(client, uid);
    try { await batch.commit(); }
    catch (error) {
      assertAccount(client, uid);
      const recovered = await readConfirmedReport(database, client, uid, placeID, id);
      if (recovered) return checkDraft(recovered);
      throw error;
    }
    assertAccount(client, uid);
    const confirmed = await readConfirmedReport(database, client, uid, placeID, id);
    if (!confirmed) throw new VisitReportError("The report save couldn’t be confirmed. Retry this exact report before creating another.");
    return checkDraft(confirmed);
  } catch (error) { assertAccount(client, uid); throw readableError(error); }
}

export async function deleteVisitReport(uid: string, placeID: string, id: string): Promise<void> {
  assertPlace(placeID); assertReportID(id);
  const client = requireClient();
  assertAccount(client, uid);
  const database = getFirestore(client.app);
  try {
    const existing = await readConfirmedReport(database, client, uid, placeID, id);
    if (!existing) return; // A previously confirmed removal needs no further write.
    assertAccount(client, uid);
    const batch = writeBatch(database);
    batch.delete(publicReference(database, placeID, id));
    batch.delete(receiptReference(database, uid, id));
    try { await batch.commit(); }
    catch (error) {
      assertAccount(client, uid);
      if (await readConfirmedReport(database, client, uid, placeID, id)) throw error;
      return;
    }
    assertAccount(client, uid);
    if (await readConfirmedReport(database, client, uid, placeID, id)) throw new VisitReportError("Removal couldn’t be confirmed. Refresh the report and retry removing it.");
  } catch (error) { assertAccount(client, uid); throw readableError(error); }
}
