import { randomBytes } from 'node:crypto';
import { DELETION_POLICY_VERSION, ServiceError, deletionPolicyVersion, safeSegment, sameTimestamp, timestamp, validVote } from './policy.mjs';

const validReportID = value => typeof value === 'string' && /^[A-Za-z0-9]{20}$/u.test(value);
const sameFields = (actual, expected, keys) => keys.every(key => actual?.[key] === expected?.[key]);

async function checkCleanupLease(transaction, lease) {
  const receipt = await lease.check(transaction);
  if (receipt.phase !== 'pending' || deletionPolicyVersion(receipt) !== DELETION_POLICY_VERSION) {
    throw new ServiceError(503, 'deletion_unavailable');
  }
}

async function removeOwnedCode(db, uid, reservation, lease) {
  const before = reservation.data();
  if (!safeSegment(before?.placeID) || !validReportID(reservation.id)) throw new ServiceError(503, 'deletion_unavailable');
  const privateRef = db.doc(`users/${uid}/restroomReadyPasscodes/${before.placeID}`);
  const publicRef = db.doc(`restroomPasscodeReports/${before.placeID}/reports/${reservation.id}`);
  await db.runTransaction(async transaction => {
    await checkCleanupLease(transaction, lease);
    const [current, privateCode] = await transaction.getAll(reservation.ref, privateRef);
    if (!current.exists) return;
    if (current.data().ownerUID !== uid || current.data().placeID !== before.placeID) {
      throw new ServiceError(503, 'deletion_unavailable');
    }
    // The immutable reservation, rather than copied public/private fields, proves ownership.
    transaction.delete(publicRef);
    if (privateCode.data()?.reportID === reservation.id) transaction.delete(privateRef);
    transaction.delete(reservation.ref);
  });
}

async function removeOwnVerification(db, receipt, lease) {
  const before = receipt.data();
  if (!validReportID(receipt.id) || !safeSegment(before?.placeID)) return;
  const publicRef = db.doc(`restroomPasscodeReports/${before.placeID}/reports/${receipt.id}`);
  await db.runTransaction(async transaction => {
    await checkCleanupLease(transaction, lease);
    const [current, shared] = await transaction.getAll(receipt.ref, publicRef);
    const own = current.data(), report = shared.data();
    if (!own || !report || !sameFields(own, before, ['placeID']) || report.placeID !== own.placeID) return;
    if (sameTimestamp(own.codeUpdatedAt, report.codeUpdatedAt)
        && sameTimestamp(own.verifiedAt, report.lastVerifiedAt)) {
      // Remove only this account's exact current verification, not the other owner's code.
      transaction.update(publicRef, { lastVerifiedAt: null });
    }
  });
}

const feedbackKey = value => `${value.kind}_${value.reportID}`;
const privateFeedbackKey = value => `${value.placeID}~${feedbackKey(value)}`;
function validV2Owner(value, id, uid) {
  return value && Object.keys(value).length === 3 && validReportID(id)
    && value.ownerUID === uid && safeSegment(value.placeID) && timestamp(value.createdAt);
}
function validV2Own(value, owner) {
  return value && Object.keys(value).length === 6 && value.placeID === owner.placeID
    && typeof value.code === 'string' && value.code.length <= 40 && /^[!-~]([ -~]*[!-~])?$/u.test(value.code)
    && ['private', 'public'].includes(value.visibility) && sameTimestamp(value.createdAt, owner.createdAt)
    && sameTimestamp(value.createdAt, value.codeUpdatedAt)
    && (value.lastVerifiedAt === null || (timestamp(value.lastVerifiedAt)
      && value.lastVerifiedAt.toMillis() >= value.codeUpdatedAt.toMillis()));
}
function validFeedbackVote(value, id) {
  return value && Object.keys(value).length === 6 && safeSegment(value.placeID)
    && ['legacy', 'v2'].includes(value.kind) && validReportID(value.reportID)
    && privateFeedbackKey(value) === id && ['used', 'invalid'].includes(value.vote)
    && timestamp(value.codeUpdatedAt) && timestamp(value.updatedAt)
    && value.updatedAt.toMillis() >= value.codeUpdatedAt.toMillis();
}
function validFeedbackSummary(value, vote) {
  return value && Object.keys(value).length === 8
    && sameFields(value, vote, ['placeID', 'kind', 'reportID'])
    && timestamp(value.codeUpdatedAt) && timestamp(value.updatedAt)
    && value.updatedAt.toMillis() >= value.codeUpdatedAt.toMillis()
    && ['usedCount', 'invalidCount'].every(key => Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= 1_000_000)
    && (value.lastUsedAt === null || (timestamp(value.lastUsedAt)
      && value.lastUsedAt.toMillis() >= value.codeUpdatedAt.toMillis()
      && value.lastUsedAt.toMillis() <= value.updatedAt.toMillis()));
}

async function removeOwnedCodeV2(db, uid, reservation, lease) {
  const before = reservation.data();
  if (!validV2Owner(before, reservation.id, uid)) throw new ServiceError(503, 'deletion_unavailable');
  const ownRef = db.doc(`users/${uid}/restroomReadyPasscodesV2/${reservation.id}`);
  const publicRef = db.doc(`restroomPasscodeReportsV2/${before.placeID}/reports/${reservation.id}`);
  const feedbackRef = db.doc(`restroomPasscodeFeedback/${before.placeID}/codes/v2_${reservation.id}`);
  await db.runTransaction(async transaction => {
    await checkCleanupLease(transaction, lease);
    const [current, privateCode, shared, feedback] = await transaction.getAll(reservation.ref, ownRef, publicRef, feedbackRef);
    if (!current.exists) {
      if (privateCode.exists || shared.exists || feedback.exists) throw new ServiceError(503, 'deletion_unavailable');
      return;
    }
    const owner = current.data(), own = privateCode.data(), code = shared.data();
    if (!validV2Owner(owner, reservation.id, uid) || owner.placeID !== before.placeID
        || !sameTimestamp(owner.createdAt, before.createdAt) || !validV2Own(own, owner)) {
      throw new ServiceError(503, 'deletion_unavailable');
    }
    if (shared.exists && (Object.keys(code).length !== 3 || code.placeID !== own.placeID
        || code.code !== own.code || !sameTimestamp(code.codeUpdatedAt, own.codeUpdatedAt))) {
      throw new ServiceError(503, 'deletion_unavailable');
    }
    if (feedback.exists && !validFeedbackSummary(feedback.data(), { placeID: own.placeID, kind: 'v2', reportID: reservation.id })) {
      throw new ServiceError(503, 'deletion_unavailable');
    }
    transaction.delete(publicRef);
    transaction.delete(feedbackRef);
    transaction.delete(ownRef);
    transaction.delete(reservation.ref);
  });
}

async function removeOwnCodeFeedback(db, receipt, lease) {
  const before = receipt.data();
  if (!validFeedbackVote(before, receipt.id)) throw new ServiceError(503, 'deletion_unavailable');
  const summaryRef = db.doc(`restroomPasscodeFeedback/${before.placeID}/codes/${feedbackKey(before)}`);
  await db.runTransaction(async transaction => {
    await checkCleanupLease(transaction, lease);
    const [current, shared] = await transaction.getAll(receipt.ref, summaryRef);
    if (!current.exists) return;
    const own = current.data(), summary = shared.data();
    if (!validFeedbackVote(own, receipt.id) || !sameFields(own, before, ['placeID', 'kind', 'reportID', 'vote'])
        || !sameTimestamp(own.codeUpdatedAt, before.codeUpdatedAt) || !sameTimestamp(own.updatedAt, before.updatedAt)) {
      throw new ServiceError(503, 'deletion_unavailable');
    }
    if (shared.exists) {
      if (!validFeedbackSummary(summary, own)) throw new ServiceError(503, 'deletion_unavailable');
      if (sameTimestamp(summary.codeUpdatedAt, own.codeUpdatedAt)) {
        const field = own.vote === 'used' ? 'usedCount' : 'invalidCount';
        if (summary[field] < 1) throw new ServiceError(503, 'deletion_unavailable');
        const patch = { [field]: summary[field] - 1 };
        // Preserve other visitors' successful reports. If this account supplied
        // the exact newest Used time, conservatively leave that time unknown.
        if (own.vote === 'used' && sameTimestamp(summary.lastUsedAt, own.updatedAt)) patch.lastUsedAt = null;
        transaction.update(summaryRef, patch);
      }
    }
    transaction.delete(receipt.ref);
  });
}

async function removeOwnVisit(db, receipt, lease) {
  const before = receipt.data();
  if (!validReportID(receipt.id) || !safeSegment(before?.placeID)) return;
  const publicRef = db.doc(`restroomVisitReports/${before.placeID}/reports/${receipt.id}`);
  await db.runTransaction(async transaction => {
    await checkCleanupLease(transaction, lease);
    const [current, shared] = await transaction.getAll(receipt.ref, publicRef);
    const own = current.data(), report = shared.data();
    if (own && report && own.placeID === before.placeID && report.placeID === own.placeID
        && sameTimestamp(own.submittedAt, report.submittedAt)) transaction.delete(publicRef);
    if (current.exists) transaction.delete(receipt.ref);
  });
}

function validPublicNoteReceipt(value) {
  return value && Object.keys(value).length === 2 && typeof value.placeID === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9:._~-]{0,127}$/u.test(value.placeID)
    && (!value.placeID.startsWith('community-') || /^community-[A-Za-z0-9]{20}$/u.test(value.placeID))
    && timestamp(value.submittedAt);
}

async function removeOwnPublicNote(db, receipt, lease) {
  const before = receipt.data();
  if (!validReportID(receipt.id) || !validPublicNoteReceipt(before)) {
    throw new ServiceError(503, 'deletion_unavailable');
  }
  const publicRef = db.doc(`restroomPublicNotes/${before.placeID}/notes/${receipt.id}`);
  await db.runTransaction(async transaction => {
    await checkCleanupLease(transaction, lease);
    const [current, shared] = await transaction.getAll(receipt.ref, publicRef);
    if (!current.exists) {
      if (shared.exists) throw new ServiceError(503, 'deletion_unavailable');
      return;
    }
    const own = current.data(), note = shared.data();
    if (!validPublicNoteReceipt(own) || own.placeID !== before.placeID
        || !sameTimestamp(own.submittedAt, before.submittedAt)) {
      throw new ServiceError(503, 'deletion_unavailable');
    }
    if (shared.exists) {
      if (note.placeID !== own.placeID || !sameTimestamp(own.submittedAt, note.submittedAt)) {
        // Preserve the recovery pointer instead of deleting someone else's
        // note or orphaning public text through recursive private cleanup.
        throw new ServiceError(503, 'deletion_unavailable');
      }
      transaction.delete(publicRef);
    }
    transaction.delete(receipt.ref);
  });
}

function validUnifiedVisitReceipt(value) {
  return value && Object.keys(value).length === 3 && validPublicNoteReceipt({ placeID: value.placeID, submittedAt: value.submittedAt })
    && (value.codeReportID === null || validReportID(value.codeReportID));
}

async function removeOwnUnifiedVisit(db, receipt, lease) {
  const before = receipt.data();
  if (!validReportID(receipt.id) || !validUnifiedVisitReceipt(before)) throw new ServiceError(503, 'deletion_unavailable');
  const publicRef = db.doc(`restroomUnifiedVisits/${before.placeID}/reports/${receipt.id}`);
  await db.runTransaction(async transaction => {
    await checkCleanupLease(transaction, lease);
    const [current, shared] = await transaction.getAll(receipt.ref, publicRef);
    if (!current.exists) {
      if (shared.exists) throw new ServiceError(503, 'deletion_unavailable');
      return;
    }
    const own = current.data(), report = shared.data();
    if (!validUnifiedVisitReceipt(own) || own.placeID !== before.placeID
        || own.codeReportID !== before.codeReportID || !sameTimestamp(own.submittedAt, before.submittedAt)) {
      throw new ServiceError(503, 'deletion_unavailable');
    }
    if (shared.exists) {
      if (report.placeID !== own.placeID || !sameTimestamp(report.submittedAt, own.submittedAt)) {
        throw new ServiceError(503, 'deletion_unavailable');
      }
      transaction.delete(publicRef);
    }
    // A linked code has its own independent, checked ownership cleanup. Its
    // prior removal must not strand this public name/comment or its receipt.
    transaction.delete(receipt.ref);
  });
}

async function unlinkOwnListing(db, uid, receipt, lease) {
  if (!/^community-[A-Za-z0-9]{20}$/u.test(receipt.id)) throw new ServiceError(503, 'deletion_unavailable');
  await db.runTransaction(async transaction => {
    await checkCleanupLease(transaction, lease);
    const current = await transaction.get(receipt.ref);
    if (!current.exists) return;
    if (current.data().ownerUID !== uid) throw new ServiceError(503, 'deletion_unavailable');
    // Public IDs are random and the strict listing schema contains no account identity.
    // Remove only the private ownership link; leave the public document byte-for-byte intact.
    transaction.delete(receipt.ref);
  });
}

async function anonymizeOwnRating(db, uid, summaryRef, lease) {
  const voteRef = summaryRef.collection('ratings').doc(uid);
  // A new random ID per place carries no UID-derived value or cross-place identity link.
  // This unmatched sibling namespace is Admin-only under the existing client rules.
  const anonymousRef = summaryRef.collection('anonymousRatings').doc(randomBytes(32).toString('hex'));
  await db.runTransaction(async transaction => {
    await checkCleanupLease(transaction, lease);
    const [vote, target] = await transaction.getAll(voteRef, anonymousRef);
    if (!vote.exists) return; // A committed move is a no-op on every later retry.
    const value = vote.data();
    if (!validVote(value) || target.exists) throw new ServiceError(503, 'deletion_unavailable');
    // Copy only the exact existing valid vote. Never retain identity fields or change
    // public aggregate bytes, even when the summary is missing or malformed.
    transaction.create(anonymousRef, { stars: value.stars, updatedAt: value.updatedAt });
    transaction.delete(voteRef);
  });
}

export async function cleanupAccount(db, uid, lease, { checkpoint = async () => {} } = {}) {
  if (!safeSegment(uid)) throw new ServiceError(401, 'authentication_required');
  // Gather ownership while the account's rule lock prevents further client writes.
  // Never recursively delete the user's receipts before their public pairs are processed.
  const userRef = db.collection('users').doc(uid);
  const [reservations, reservationsV2, ownCodesV2, codeVotes, checks, visits, publicNotes, unifiedVisits, submissions, summaries] = await Promise.all([
    db.collection('restroomPasscodeOwners').where('ownerUID', '==', uid).get(),
    db.collection('restroomPasscodeV2Owners').where('ownerUID', '==', uid).get(),
    userRef.collection('restroomReadyPasscodesV2').get(),
    userRef.collection('restroomReadyPasscodeVotes').get(),
    userRef.collection('restroomReadyPasscodeChecks').get(),
    userRef.collection('restroomReadyVisitReceipts').get(),
    userRef.collection('restroomReadyPublicNoteReceipts').get(),
    userRef.collection('restroomReadyUnifiedVisitReceipts').get(),
    db.collection('restroomSubmissions').where('ownerUID', '==', uid).get(),
    // listDocuments includes missing parent documents that still contain private votes.
    db.collection('restroomRatingSummaries').listDocuments(),
  ]);
  const reservedV2IDs = new Set(reservationsV2.docs.map(record => record.id));
  if (ownCodesV2.docs.some(record => !reservedV2IDs.has(record.id))) throw new ServiceError(503, 'deletion_unavailable');
  await checkpoint('gathered');
  for (const reservation of reservations.docs) await removeOwnedCode(db, uid, reservation, lease);
  for (const reservation of reservationsV2.docs) {
    await removeOwnedCodeV2(db, uid, reservation, lease);
    await checkpoint('passcode-v2-cleaned');
  }
  for (const receipt of codeVotes.docs) {
    await removeOwnCodeFeedback(db, receipt, lease);
    await checkpoint('passcode-feedback-cleaned');
  }
  for (const check of checks.docs) await removeOwnVerification(db, check, lease);
  for (const visit of visits.docs) await removeOwnVisit(db, visit, lease);
  for (const note of publicNotes.docs) {
    await removeOwnPublicNote(db, note, lease);
    await checkpoint('public-note-cleaned');
  }
  for (const visit of unifiedVisits.docs) {
    await removeOwnUnifiedVisit(db, visit, lease);
    await checkpoint('unified-visit-cleaned');
  }
  for (const submission of submissions.docs) await unlinkOwnListing(db, uid, submission, lease);
  await checkpoint('public-pairs-cleaned');
  // Read only this account's vote at each discovered parent, in bounded RPC batches.
  for (let offset = 0; offset < summaries.length; offset += 200) {
    const group = summaries.slice(offset, offset + 200);
    const ownVotes = await db.getAll(...group.map(ref => ref.collection('ratings').doc(uid)));
    for (const vote of ownVotes) {
      if (vote.exists) {
        await anonymizeOwnRating(db, uid, vote.ref.parent.parent, lease);
        await checkpoint('rating-anonymized');
      }
    }
  }
  await checkpoint('ratings-anonymized');
  // Preserve safety case status while removing the deleted reporter's identity.
  // The deletion lock and API transaction fence prevent new reports during cleanup.
  for (;;) {
    const reports = await db.collection('restroomContentReports').where('reporterUID', '==', uid).limit(100).get();
    if (reports.empty) break;
    for (const report of reports.docs) await db.runTransaction(async transaction => {
      await checkCleanupLease(transaction, lease);
      const current = await transaction.get(report.ref);
      if (current.exists && current.get('reporterUID') === uid) transaction.update(report.ref, { reporterUID: null, fingerprint: null });
    });
  }
  await db.runTransaction(async transaction => {
    await checkCleanupLease(transaction, lease);
    transaction.delete(db.doc(`restroomContentReportLimits/${uid}`));
    transaction.delete(db.doc(`restroomContributorSuspensions/${uid}`));
  });
  await checkpoint('safety-data-unlinked');
  await db.runTransaction(async transaction => { await checkCleanupLease(transaction, lease); });
  // This exact UID root is the only recursive-delete target. Public collections are never recursive.
  await db.recursiveDelete(userRef);
  await checkpoint('private-data-deleted');
}
