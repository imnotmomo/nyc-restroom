import { createHash } from 'node:crypto';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { authenticateModerator } from './auth.mjs';
import { KINDS, actionID, commentDTO, compareTime, exact, hasStructuredFacts, iso,
  placeID, recordID, requireValue, revision, sameTime, timestamp, uidSafe } from './policy.mjs';

export const REPORT_REASONS = new Set(['personal_information', 'harassment', 'sexual_content', 'spam', 'misleading', 'other']);
const imported = kind => ['source-comment', 'research-comment'].includes(kind);
const CODE_KINDS = {
  'legacy-code': { root: 'restroomPasscodeReports', owners: 'restroomPasscodeOwners', own: 'restroomReadyPasscodes', marker: 'legacyCodes' },
  'v2-code': { root: 'restroomPasscodeReportsV2', owners: 'restroomPasscodeV2Owners', own: 'restroomReadyPasscodesV2', marker: 'v2Codes' },
};
const codeKind = kind => Object.hasOwn(CODE_KINDS, kind);
const sourceID = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._~-]{0,159}$/u.test(id);
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');
const textValid = text => typeof text === 'string' && text.trim().length > 0 && text.length <= 2000
  && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text);
const authored = kind => Object.hasOwn(KINDS, kind);
const reportKinds = kind => authored(kind) || imported(kind) || codeKind(kind);

export function validateContentReport(body) {
  requireValue(body && reportKinds(body.kind));
  exact(body, ['kind', 'placeID', 'recordID', imported(body.kind) ? 'contentHash' : 'postedAt', 'reason', 'actionId']);
  requireValue(placeID(body.placeID) && (imported(body.kind) ? sourceID(body.recordID) : recordID(body.recordID))
    && REPORT_REASONS.has(body.reason) && actionID(body.actionId));
  requireValue(imported(body.kind) ? typeof body.contentHash === 'string' && /^[a-f0-9]{64}$/u.test(body.contentHash)
    : typeof body.postedAt === 'string' && /^\d{1,12}:\d{1,9}$/u.test(body.postedAt));
}

async function reporterFor({ auth, db }, token) {
  let claims, user;
  try {
    claims = await auth.verifyIdToken(token, true);
    requireValue(uidSafe(claims.uid) && ['google.com', 'apple.com'].includes(claims.firebase?.sign_in_provider), 401, 'authentication_required');
    user = await auth.getUser(claims.uid);
    requireValue(!user.disabled && user.providerData?.some(p => p.providerId === claims.firebase.sign_in_provider), 401, 'authentication_required');
  } catch { requireValue(false, 401, 'authentication_required'); }
  requireValue(!(await db.doc(`accountDeletionLocks/${user.uid}`).get()).exists, 403, 'reporter_required');
  return user.uid;
}

export function createContentSafetyService({ auth, db, roster, now = () => Date.now(), cursors, safetyReady = async () => false }) {
  function targetRef(kind, place, id) {
    if (authored(kind)) return db.doc(`${KINDS[kind].root}/${place}/${KINDS[kind].group}/${id}`);
    if (codeKind(kind)) return db.doc(`${CODE_KINDS[kind].root}/${place}/reports/${id}`);
    return db.doc(kind === 'research-comment' ? `restroomResearchProfiles/${place}` : `restroomSourceComments/${place}/comments/${id}`);
  }
  function targetText(kind, snapshot, id) {
    requireValue(snapshot.exists, 404, 'not_found');
    if (codeKind(kind)) {
      const d = snapshot.data(), keys = ['placeID', 'code', 'codeUpdatedAt', ...(kind === 'legacy-code' ? ['lastVerifiedAt'] : [])];
      requireValue(Object.keys(d).length === keys.length && keys.every(key => Object.hasOwn(d, key)) && placeID(d.placeID)
        && d.placeID === snapshot.ref.path.split('/')[1]
        && typeof d.code === 'string' && d.code.length > 0 && d.code.length <= 40 && /^[!-~]([ -~]*[!-~])?$/u.test(d.code)
        && timestamp(d.codeUpdatedAt) && (kind !== 'legacy-code' || d.lastVerifiedAt === null
          || timestamp(d.lastVerifiedAt) && compareTime(d.lastVerifiedAt, d.codeUpdatedAt) >= 0), 404, 'not_found');
      return d.code;
    }
    if (authored(kind)) {
      requireValue(commentDTO(kind, snapshot, 'Restroom', true), 404, 'not_found');
      const data = snapshot.data(), text = data[KINDS[kind].text];
      const named = kind === 'unified-visit' && data.anonymous === false;
      requireValue(text.trim().length > 0 || named && hasStructuredFacts(kind, data), 404, 'not_found');
      // Authored clients pin the immutable posting timestamp. The private hash
      // also binds opt-in attribution, so a changed name cannot be redacted by an old report.
      return named ? `${data.authorName}\n${text}` : text;
    }
    const data = snapshot.data();
    if (kind === 'source-comment') { requireValue(textValid(data.text), 404, 'not_found'); return data.text; }
    requireValue(Array.isArray(data.comments) && data.comments.length <= 100, 503, 'moderation_unavailable');
    const matches = data.comments.filter(comment => comment?.id === id);
    requireValue(matches.length === 1 && textValid(matches[0].text), 404, 'not_found'); return matches[0].text;
  }
  function pinned(body, snapshot) {
    const text = targetText(body.kind, snapshot, body.recordID);
    requireValue(imported(body.kind) ? digest(text) === body.contentHash
      : revision(snapshot.get(codeKind(body.kind) ? 'codeUpdatedAt' : 'submittedAt')) === body.postedAt, 409, 'stale_revision');
    return digest(text);
  }
  function validReport(data) {
    requireValue(data?.schemaVersion === 1 && reportKinds(data.kind) && placeID(data.placeID)
      && sourceID(data.recordID) && (data.reporterUID === null || uidSafe(data.reporterUID))
      && /^[a-f0-9]{64}$/u.test(data.contentHash ?? '') && REPORT_REASONS.has(data.reason)
      && (imported(data.kind) ? data.postedAt === null : typeof data.postedAt === 'string' && /^\d{1,12}:\d{1,9}$/u.test(data.postedAt))
      && ['pending', 'resolved'].includes(data.status) && timestamp(data.createdAt), 503, 'moderation_unavailable');
    return data;
  }
  const targetFingerprint = body => JSON.stringify([body.kind, body.placeID, body.recordID, body.postedAt ?? body.contentHash, body.reason]);
  async function contributionStatus(token) {
    const uid = await reporterFor({ auth, db }, token);
    return { status: (await db.doc(`restroomContributorSuspensions/${uid}`).get()).exists ? 'suspended' : 'allowed' };
  }
  async function reportContent(token, body) {
    validateContentReport(body); const uid = await reporterFor({ auth, db }, token);
    requireValue(await safetyReady(), 503, 'moderation_unavailable');
    const report = db.doc(`restroomContentReports/${body.actionId}`), rate = db.doc(`restroomContentReportLimits/${uid}`);
    const ref = targetRef(body.kind, body.placeID, body.recordID), fingerprint = targetFingerprint(body);
    return db.runTransaction(async tx => {
      const [existing, target, limit, lock] = await tx.getAll(report, ref, rate, db.doc(`accountDeletionLocks/${uid}`));
      requireValue(!lock.exists, 403, 'reporter_required');
      if (existing.exists) {
        const old = validReport(existing.data());
        requireValue(old.reporterUID === uid && old.fingerprint === fingerprint, 409, 'action_conflict');
        return { status: 'received', reportID: body.actionId };
      }
      const hash = pinned(body, target), at = Timestamp.fromMillis(now()), old = limit.data();
      const sameWindow = old && timestamp(old.windowStart) && at.toMillis() >= old.windowStart.toMillis()
        && at.toMillis() - old.windowStart.toMillis() < 3_600_000;
      const count = sameWindow ? old.count : 0;
      requireValue(Number.isInteger(count) && count >= 0 && count < 20, 429, 'rate_limited');
      tx.set(rate, { windowStart: sameWindow ? old.windowStart : at, count: count + 1 });
      tx.create(report, { schemaVersion: 1, reporterUID: uid, kind: body.kind, placeID: body.placeID,
        recordID: body.recordID, postedAt: body.postedAt ?? null, contentHash: hash, fingerprint,
        reason: body.reason, createdAt: at, status: 'pending', reviewedAt: null, decision: null });
      return { status: 'received', reportID: body.actionId };
    });
  }
  async function reports(token, params = {}) {
    const actor = await authenticateModerator({ auth, db, roster }, token), status = params.status ?? 'pending';
    const limit = params.limit === undefined ? 25 : Number(params.limit);
    requireValue(['pending', 'resolved'].includes(status) && Number.isInteger(limit) && limit > 0 && limit <= 50);
    const scope = `safety:${status}`, after = cursors.read(params.cursor, actor.uid, scope);
    let query = db.collection('restroomContentReports').where('status', '==', status).orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
    if (after) query = query.startAfter(new Timestamp(after.seconds, after.nanoseconds), db.doc(after.path));
    const snapshot = await query.limit(limit + 1).get(), docs = snapshot.docs.slice(0, limit);
    const items = await Promise.all(docs.map(async doc => {
      const d = validReport(doc.data()); let text = null, available = false;
      try { const target = await targetRef(d.kind, d.placeID, d.recordID).get(); text = targetText(d.kind, target, d.recordID); available = pinned(d, target) === d.contentHash; if (!available) text = null; } catch { text = null; }
      let canSuspend = false;
      if (available && (authored(d.kind) || codeKind(d.kind))) {
        try {
          if (codeKind(d.kind)) canSuspend = Boolean(await codeOwner(d.kind, d.placeID, d.recordID, await targetRef(d.kind, d.placeID, d.recordID).get()));
          else { await findOwner(d.kind, d.placeID, d.recordID, (await targetRef(d.kind, d.placeID, d.recordID).get()).get('submittedAt')); canSuspend = true; }
        } catch { canSuspend = false; }
      }
      return { id: doc.id, kind: d.kind, placeID: d.placeID, recordID: d.recordID, reason: d.reason,
        status: d.status, createdAt: iso(d.createdAt), reviewedAt: iso(d.reviewedAt), decision: d.decision,
        revision: revision(doc.updateTime), text, available, canSuspend };
    }));
    const last = docs.at(-1);
    return { items, nextCursor: snapshot.size > limit && last ? cursors.put(actor.uid, scope,
      { path: last.ref.path, seconds: last.get('createdAt').seconds, nanoseconds: last.get('createdAt').nanoseconds }) : null };
  }
  async function findOwner(kind, place, id, at) {
    const config = KINDS[kind];
    const results = await db.collectionGroup(config.receipts).where('placeID', '==', place).where('submittedAt', '==', at).limit(51).get();
    requireValue(results.size <= 50, 503, 'ownership_unavailable');
    const matches = results.docs.filter(doc => { const p = doc.ref.path.split('/'); return p.length === 4 && p[0] === 'users' && uidSafe(p[1]) && p[2] === config.receipts && p[3] === id; });
    requireValue(matches.length === 1, 503, 'ownership_unavailable');
    const own = matches[0].data(), keys = kind === 'public-note' ? ['placeID', 'submittedAt'] : ['placeID', 'submittedAt', 'codeReportID'];
    requireValue(Object.keys(own).length === keys.length && keys.every(key => Object.hasOwn(own, key))
      && (kind !== 'unified-visit' || own.codeReportID === null || recordID(own.codeReportID)), 503, 'ownership_unavailable');
    return matches[0].ref;
  }
  function validCodeOwner(kind, place, id, target, reservation, own) {
    if (!reservation?.exists || !own?.exists) return false;
    const owner = reservation.data(), value = own.data();
    const keys = ['placeID', 'code', 'visibility', 'createdAt', 'codeUpdatedAt', 'lastVerifiedAt', ...(kind === 'legacy-code' ? ['reportID'] : [])];
    return Object.keys(owner).length === 3 && ['ownerUID', 'placeID', 'createdAt'].every(k => Object.hasOwn(owner, k))
      && uidSafe(owner.ownerUID) && owner.placeID === place && timestamp(owner.createdAt)
      && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k))
      && value.placeID === place && value.visibility === 'public' && value.code === target.get('code')
      && sameTime(value.codeUpdatedAt, target.get('codeUpdatedAt')) && sameTime(value.createdAt, owner.createdAt)
      && timestamp(value.createdAt) && compareTime(value.createdAt, value.codeUpdatedAt) <= 0
      && (value.lastVerifiedAt === null || timestamp(value.lastVerifiedAt) && compareTime(value.lastVerifiedAt, value.codeUpdatedAt) >= 0)
      && (kind === 'legacy-code' ? value.reportID === id : sameTime(value.createdAt, value.codeUpdatedAt));
  }
  async function codeOwner(kind, place, id, target) {
    const config = CODE_KINDS[kind], reservation = db.doc(`${config.owners}/${id}`), record = await reservation.get();
    if (!record.exists || !uidSafe(record.get('ownerUID'))) return null;
    const uid = record.get('ownerUID'), own = db.doc(`users/${uid}/${config.own}/${kind === 'legacy-code' ? place : id}`);
    return validCodeOwner(kind, place, id, target, record, await own.get()) ? { reservation, own, uid } : null;
  }
  async function resolveReport(token, id, body) {
    const actor = await authenticateModerator({ auth, db, roster }, token);
    requireValue(actionID(id)); exact(body, ['decision', 'revision', 'reason', 'actionId']);
    requireValue(['dismiss', 'remove', 'remove-and-suspend'].includes(body.decision) && REPORT_REASONS.has(body.reason)
      && typeof body.revision === 'string' && /^\d{1,12}:\d{1,9}$/u.test(body.revision) && actionID(body.actionId));
    const report = db.doc(`restroomContentReports/${id}`), action = db.doc(`restroomModerationActions/${body.actionId}`);
    const fingerprint = JSON.stringify([id, body.decision, body.revision, body.reason]);
    const recordedAction = await action.get();
    if (recordedAction.exists) {
      requireValue(recordedAction.get('actorUID') === actor.uid && recordedAction.get('fingerprint') === fingerprint, 409, 'action_conflict');
      return recordedAction.get('result');
    }
    if (body.decision === 'remove-and-suspend') requireValue(await safetyReady(), 503, 'moderation_unavailable');
    const before = await report.get(); requireValue(before.exists, 404, 'not_found'); const d = validReport(before.data());
    const ref = targetRef(d.kind, d.placeID, d.recordID), initial = await ref.get();
    if (body.decision !== 'dismiss') targetText(d.kind, initial, d.recordID);
    const receipt = body.decision !== 'dismiss' && authored(d.kind)
      ? await findOwner(d.kind, d.placeID, d.recordID, initial.get('submittedAt')) : null;
    const codeOwnership = body.decision !== 'dismiss' && codeKind(d.kind) ? await codeOwner(d.kind, d.placeID, d.recordID, initial) : null;
    const ownerUID = receipt?.path.split('/')[1] ?? codeOwnership?.uid;
    requireValue(body.decision !== 'remove-and-suspend' || !imported(d.kind), 400, 'invalid_request');
    requireValue(body.decision !== 'remove-and-suspend' || uidSafe(ownerUID), 503, 'ownership_unavailable');
    return db.runTransaction(async tx => {
      const refs = [report, action, db.doc(`accountDeletionLocks/${actor.uid}`), ref];
      if (receipt) refs.push(receipt, db.doc(`accountDeletionLocks/${ownerUID}`));
      if (codeOwnership) refs.push(codeOwnership.reservation, db.doc(`accountDeletionLocks/${ownerUID}`), codeOwnership.own);
      const [current, oldAction, actorLock, target, own, ownerLock, privateCode] = await tx.getAll(...refs);
      requireValue(!actorLock.exists, 403, 'moderator_required');
      if (oldAction.exists) {
        requireValue(oldAction.get('actorUID') === actor.uid && oldAction.get('fingerprint') === fingerprint, 409, 'action_conflict');
        return oldAction.get('result');
      }
      requireValue(current.exists && current.get('status') === 'pending' && revision(current.updateTime) === body.revision, 409, 'stale_revision');
      const currentData = validReport(current.data()), at = Timestamp.fromMillis(now());
      requireValue(compareTime(at, currentData.createdAt) >= 0);
      let mode = null;
      if (body.decision !== 'dismiss') {
        const text = targetText(d.kind, target, d.recordID); requireValue(digest(text) === d.contentHash, 409, 'stale_revision');
        if (authored(d.kind)) {
          requireValue(own?.exists && !ownerLock?.exists && own.get('placeID') === d.placeID
            && sameTime(own.get('submittedAt'), target.get('submittedAt')) && revision(target.get('submittedAt')) === d.postedAt, 503, 'ownership_unavailable');
          const receiptKeys = d.kind === 'public-note' ? ['placeID', 'submittedAt'] : ['placeID', 'submittedAt', 'codeReportID'];
          requireValue(Object.keys(own.data()).length === receiptKeys.length && receiptKeys.every(key => Object.hasOwn(own.data(), key))
            && (d.kind !== 'unified-visit' || own.get('codeReportID') === null || recordID(own.get('codeReportID'))), 503, 'ownership_unavailable');
          const config = KINDS[d.kind]; mode = hasStructuredFacts(d.kind, target.data()) ? 'redacted' : 'deleted';
          if (mode === 'redacted') tx.update(ref, { [config.text]: '', ...(d.kind === 'unified-visit' ? { anonymous: true, authorName: null } : {}) }); else { tx.delete(ref); tx.delete(receipt); }
          tx.set(db.doc(`restroomModerationRemovals/${d.placeID}/${config.marker}/${d.recordID}`),
            { kind: d.kind, placeID: d.placeID, recordID: d.recordID, reason: body.reason, removedAt: at });
          if (body.decision === 'remove-and-suspend') tx.set(db.doc(`restroomContributorSuspensions/${ownerUID}`),
            { schemaVersion: 1, reason: body.reason, suspendedAt: at, moderatorUID: actor.uid, reportID: id });
        } else if (codeKind(d.kind)) {
          requireValue(revision(target.get('codeUpdatedAt')) === d.postedAt, 409, 'stale_revision');
          if (body.decision === 'remove-and-suspend') requireValue(!ownerLock?.exists
            && validCodeOwner(d.kind, d.placeID, d.recordID, target, own, privateCode), 503, 'ownership_unavailable');
          tx.delete(ref); mode = 'deleted';
          tx.set(db.doc(`restroomModerationRemovals/${d.placeID}/${CODE_KINDS[d.kind].marker}/${d.recordID}`),
            { kind: d.kind, placeID: d.placeID, recordID: d.recordID, codeUpdatedAt: target.get('codeUpdatedAt'), reason: body.reason, removedAt: at });
          if (body.decision === 'remove-and-suspend') tx.set(db.doc(`restroomContributorSuspensions/${ownerUID}`),
            { schemaVersion: 1, reason: body.reason, suspendedAt: at, moderatorUID: actor.uid, reportID: id });
        } else if (d.kind === 'source-comment') { tx.delete(ref); mode = 'deleted'; }
        else { tx.update(ref, { comments: target.get('comments').filter(c => c.id !== d.recordID) }); mode = 'deleted'; }
      }
      const result = { reportID: id, status: 'resolved', decision: body.decision, mode };
      tx.update(report, { status: 'resolved', reviewedAt: at, decision: body.decision });
      tx.create(action, { actorUID: actor.uid, operation: 'resolve-report', target: id, reason: body.reason, fingerprint, result, createdAt: at });
      return result;
    });
  }
  return { reportContent, reports, resolveReport, contributionStatus };
}
