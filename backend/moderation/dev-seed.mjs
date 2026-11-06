// Local integration fixtures only. This file is excluded from deployment.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
const projectId = process.env.MODERATION_DEMO_PROJECT;
if (projectId !== 'demo-moderation-ui' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8185'
  || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Demo configuration required.');
const environment = await initializeTestEnvironment({ projectId,
  firestore: { host: '127.0.0.1', port: 8185, rules: await readFile('firebase/firestore.rules', 'utf8') } });
const app = initializeApp({ projectId }, 'moderation-ui-seed'), auth = getAuth(app), db = getFirestore(app);
try {
  let hasSubmitter = false;
  try {
    const existing = await auth.getUser('qa-submitter');
    if (existing.email !== 'submitter@example.test') throw Error('Unexpected fixture identity.');
    hasSubmitter = true;
  } catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
  if (!hasSubmitter) {
    const result = await auth.importUsers([{ uid: 'qa-submitter', email: 'submitter@example.test', emailVerified: true,
      providerData: [{ providerId: 'google.com', uid: 'qa-submitter-google', email: 'submitter@example.test', displayName: 'Local QA submitter' }] }]);
    if (result.failureCount) throw Error('Fixture auth import failed.');
  }
  const at = Timestamp.fromMillis(Date.now() - 3600_000), reviewed = Timestamp.fromMillis(Date.now() - 1800_000), batch = db.batch();
  const publicID = 'community-BBBBBBBBBBBBBBBBBBBB';
  for (const [letter, status, code] of [['A', 'pending', null], ['B', 'approved', null], ['C', 'denied', null], ['D', 'pending', { code: '3434', visibility: 'private' }]]) {
    const id = `community-${letter.repeat(20)}`;
    const listing = { name: `QA — ${status} restroom ${letter}`, address: '1 Test Fixture Street, New York, NY', latitude: 40.75, longitude: -73.99,
      locationType: 'cafe', entryRule: 'customers', stepFreeAccess: 'unknown', passcodeRequired: code ? 'yes' : 'unknown',
      notes: 'Isolated emulator fixture. Not a production location.', observedOn: null, submittedAt: at };
    const request = { schemaVersion: 1, status, revision: status === 'pending' ? 1 : 2, submittedAt: at, listing, codeDraft: code };
    if (status !== 'pending') Object.assign(request, { reviewedAt: reviewed, reason: status === 'denied' ? 'insufficient_details' : '', codeFingerprint: null });
    batch.set(db.doc(`users/qa-submitter/restroomReadySubmissionRequests/${id}`), request);
    batch.set(db.doc(`restroomSubmissions/${id}`), { ownerUID: 'qa-submitter', submittedAt: at });
    if (status === 'approved') { batch.set(db.doc(`communityRestrooms/${id}`), listing); batch.set(db.doc(`restroomRatingSummaries/${id}`), { ratingCount: 0, ratingSum: 0, updatedAt: reviewed }); }
  }
  const noteID = 'LLLLLLLLLLLLLLLLLLLL';
  batch.set(db.doc(`restroomPublicNotes/${publicID}/notes/${noteID}`), { schemaVersion: 1, placeID: publicID, observedAt: at, submittedAt: at,
    body: 'QA text-only comment for removal. fixture@example.test', condition: 'not-reported', soap: 'not-reported', toiletPaper: 'not-reported', stairs: 'not-reported' });
  batch.set(db.doc(`users/qa-submitter/restroomReadyPublicNoteReceipts/${noteID}`), { placeID: publicID, submittedAt: at });
  const reportID = 'MMMMMMMMMMMMMMMMMMMM';
  batch.set(db.doc(`restroomUnifiedVisits/${publicID}/reports/${reportID}`), { schemaVersion: 1, placeID: publicID, observedAt: at, submittedAt: reviewed,
    entryRule: 'not-reported', purchaseRequired: 'not-reported', codeRequired: 'not-reported', stairs: 'not-reported', soap: 'yes', toiletPaper: 'not-reported',
    floor: 'not-reported', condition: 'usable', comment: '<script>QA literal text — never execute</script>', anonymous: true, authorName: null });
  batch.set(db.doc(`users/qa-submitter/restroomReadyUnifiedVisitReceipts/${reportID}`), { placeID: publicID, submittedAt: reviewed, codeReportID: null });
  const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
  const importedID = 'source-fixture', importedText = 'Imported synthetic source text.';
  batch.set(db.doc(`restroomSourceComments/${publicID}/comments/${importedID}`), { text: importedText });
  batch.set(db.doc(`restroomResearchProfiles/${publicID}`), { comments: [{ id: 'changed-fixture', text: 'Updated synthetic research text.' }] });
  const cases = [
    ['1', 'public-note', noteID, 'QA text-only comment for removal. fixture@example.test', 'pending', at],
    ['2', 'source-comment', importedID, importedText, 'pending', null],
    ['3', 'research-comment', 'changed-fixture', 'Previous synthetic research text.', 'pending', null],
    ['4', 'unified-visit', reportID, '<script>QA literal text — never execute</script>', 'resolved', reviewed],
  ];
  for (const [number, kind, recordID, text, status, posted] of cases) {
    batch.set(db.doc(`restroomContentReports/00000000-0000-4000-8000-${number.padStart(12,'0')}`), {
      schemaVersion: 1, reporterUID: 'qa-reporter', kind, placeID: publicID, recordID,
      postedAt: posted ? `${posted.seconds}:${posted.nanoseconds}` : null,
      contentHash: hash(text), fingerprint: 'synthetic-demo-receipt', reason: 'personal_information',
      createdAt: at, status, reviewedAt: status === 'resolved' ? reviewed : null,
      decision: status === 'resolved' ? 'dismiss' : null,
    });
  }
  for (const [number, kind, letter, owned] of [['5', 'legacy-code', 'Q', true], ['6', 'v2-code', 'R', true], ['7', 'v2-code', 'S', false]]) {
    const id = letter.repeat(20), legacy = kind === 'legacy-code', text = `DEMO-${letter}-CODE`;
    batch.set(db.doc(`${legacy ? 'restroomPasscodeReports' : 'restroomPasscodeReportsV2'}/${publicID}/reports/${id}`),
      { placeID: publicID, code: text, codeUpdatedAt: at, ...(legacy ? { lastVerifiedAt: null } : {}) });
    if (owned) {
      batch.set(db.doc(`${legacy ? 'restroomPasscodeOwners' : 'restroomPasscodeV2Owners'}/${id}`),
        { ownerUID: 'qa-submitter', placeID: publicID, createdAt: at });
      batch.set(db.doc(`users/qa-submitter/${legacy ? 'restroomReadyPasscodes/' + publicID : 'restroomReadyPasscodesV2/' + id}`),
        { placeID: publicID, code: text, visibility: 'public', createdAt: at, codeUpdatedAt: at, lastVerifiedAt: null,
          ...(legacy ? { reportID: id } : {}) });
    }
    batch.set(db.doc(`restroomContentReports/00000000-0000-4000-8000-${number.padStart(12,'0')}`), {
      schemaVersion: 1, reporterUID: 'qa-reporter', kind, placeID: publicID, recordID: id,
      postedAt: `${at.seconds}:${at.nanoseconds}`, contentHash: hash(text), fingerprint: 'synthetic-demo-receipt',
      reason: 'spam', createdAt: at, status: 'pending', reviewedAt: null, decision: null,
    });
  }
  await batch.commit(); console.log('Seeded demo-only moderation requests/comments, private safety cases and ownership pairs.');
} finally { await db.terminate(); await deleteApp(app); await environment.cleanup(); }
