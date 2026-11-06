import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { authenticateModerator } from './auth.mjs';
import { CursorStore } from './cursors.mjs';
import { createContentSafetyService } from './content-safety.mjs';
import { allowedPublicText } from './text-filter.mjs';
import { KINDS, ModerationError, requireValue, communityID, recordID, placeID, uidSafe,
  exact, sameTime, compareTime, timestamp, iso, revision, requestDTO, validCodeDraft, codeFingerprint,
  validateDecision, validateRemoval, commentDTO, hasStructuredFacts } from './policy.mjs';

const REQUESTS = 'restroomReadySubmissionRequests';
const ACTIONS = 'restroomModerationActions';
const timePosition = doc => {
  requireValue(timestamp(doc.get('submittedAt')), 503, 'moderation_unavailable');
  return { path: doc.ref.path, seconds: doc.get('submittedAt').seconds, nanoseconds: doc.get('submittedAt').nanoseconds };
};
const targetHash = (operation, target, body) => JSON.stringify({ operation, target, revision: body.revision, reason: body.reason, decision: body.decision ?? null });

export function createModerationService({ auth, db, roster, now = () => Date.now(), cursors = new CursorStore({ now }), safetyReady = async () => false }) {
  const dependencies = { auth, db, roster };
  const actorFor = token => authenticateModerator(dependencies, token);
  const queryAfter = (query, position) => position
    ? query.startAfter(new Timestamp(position.seconds, position.nanoseconds), db.doc(position.path)) : query;
  function pageSize(value) {
    const limit = value === undefined || value === null ? 25 : Number(value);
    requireValue(Number.isSafeInteger(limit) && limit >= 1 && limit <= 50); return limit;
  }
  async function fenceActor(transaction, actor) {
    const lock = await transaction.get(db.collection('accountDeletionLocks').doc(actor.uid));
    requireValue(!lock.exists, 403, 'moderator_required');
  }
  function repeatedAction(snapshot, actor, fingerprint) {
    if (!snapshot.exists) return null;
    const d = snapshot.data();
    requireValue(d.actorUID === actor.uid && d.fingerprint === fingerprint, 409, 'action_conflict');
    return d.result;
  }
  function writeAction(transaction, ref, actor, operation, target, body, fingerprint, result, at) {
    // Minimal action receipt; no request body, comment text, private code or requester identity.
    transaction.create(ref, { actorUID: actor.uid, operation, target, reason: body.reason,
      fingerprint, result, createdAt: at });
  }
  async function session(token) {
    const actor = await actorFor(token);
    return { user: { email: actor.email, displayName: actor.displayName }, role: 'moderator' };
  }
  async function requests(token, params = {}) {
    const actor = await actorFor(token), status = params.status ?? 'pending', limit = pageSize(params.limit);
    requireValue(['pending', 'approved', 'denied'].includes(status));
    const scope = `requests:${status}`, position = cursors.read(params.cursor, actor.uid, scope);
    const query = db.collectionGroup(REQUESTS).where('status', '==', status)
      .orderBy('submittedAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
    const snapshot = await queryAfter(query, position).limit(limit + 1).get();
    const docs = snapshot.docs.slice(0, limit);
    const items = docs.map(doc => {
      const parts = doc.ref.path.split('/');
      requireValue(parts.length === 4 && parts[0] === 'users' && uidSafe(parts[1]) && parts[2] === REQUESTS && communityID(parts[3]), 503, 'moderation_unavailable');
      return requestDTO(doc.id, doc.data());
    });
    return { items, nextCursor: snapshot.size > limit ? cursors.put(actor.uid, scope, timePosition(docs.at(-1))) : null };
  }
  async function decide(token, id, body) {
    const actor = await actorFor(token); requireValue(communityID(id)); validateDecision(body);
    const action = db.collection(ACTIONS).doc(body.actionId), reservation = db.collection('restroomSubmissions').doc(id);
    const fingerprint = targetHash('decision', id, body);
    const recorded = repeatedAction(await action.get(), actor, fingerprint); if (recorded) return recorded;
    // Current Auth lookup is outside the Firestore transaction; its deletion lock fences the actual commit.
    const priorReservation = await reservation.get();
    requireValue(priorReservation.exists && uidSafe(priorReservation.get('ownerUID')), 404, 'not_found');
    const ownerUID = priorReservation.get('ownerUID');
    if (body.decision === 'approve') {
      let owner;
      try { owner = await auth.getUser(ownerUID); } catch { throw new ModerationError(409, 'request_unavailable'); }
      requireValue(!owner.disabled && owner.providerData?.some(p => ['google.com', 'apple.com'].includes(p.providerId)), 409, 'request_unavailable');
    }
    const request = db.collection('users').doc(ownerUID).collection(REQUESTS).doc(id);
    const published = db.collection('communityRestrooms').doc(id), summary = db.collection('restroomRatingSummaries').doc(id);
    const report = db.collection('restroomPasscodeOwners').doc();
    return db.runTransaction(async transaction => {
      await fenceActor(transaction, actor);
      const [receipt, owned, oldAction, lock, publicBefore, summaryBefore] = await transaction.getAll(
        reservation, request, action, db.collection('accountDeletionLocks').doc(ownerUID), published, summary);
      const previous = repeatedAction(oldAction, actor, fingerprint); if (previous) return previous;
      requireValue(!lock.exists && receipt.exists && owned.exists, 409, 'request_unavailable');
      exact(receipt.data(), ['ownerUID', 'submittedAt']);
      const data = owned.data(); requestDTO(id, data);
      requireValue(receipt.get('ownerUID') === ownerUID && sameTime(receipt.get('submittedAt'), data.submittedAt), 409, 'request_unavailable');
      requireValue(data.status === 'pending' && data.revision === body.revision, 409, 'stale_revision');
      requireValue(!publicBefore.exists && !summaryBefore.exists, 409, 'request_unavailable');
      const code = validCodeDraft(data.codeDraft);
      requireValue(code === null || data.listing.passcodeRequired === 'yes', 409, 'request_unavailable');
      let codeOwner, ownCode, publicCode, saved;
      if (body.decision === 'approve' && code) {
        codeOwner = report; ownCode = db.collection('users').doc(ownerUID).collection('restroomReadyPasscodes').doc(id);
        publicCode = db.collection('restroomPasscodeReports').doc(id).collection('reports').doc(report.id);
        saved = db.collection('users').doc(ownerUID).collection('restroomReadySaved').doc(id);
        const checks = await transaction.getAll(codeOwner, ownCode, publicCode, saved);
        requireValue(!checks[0].exists && !checks[1].exists && !checks[2].exists && !checks[3].exists, 409, 'request_unavailable');
      }
      const at = Timestamp.fromMillis(now()), status = body.decision === 'approve' ? 'approved' : 'denied';
      requireValue(compareTime(at, data.submittedAt) >= 0, 409, 'request_unavailable');
      if (status === 'approved') {
        requireValue([data.listing.name, data.listing.address, data.listing.notes].every(allowedPublicText), 400, 'content_not_allowed');
        requireValue(!code || code.visibility !== 'public' || allowedPublicText(code.code), 400, 'content_not_allowed');
        requireValue(!(await transaction.get(db.doc(`restroomContributorSuspensions/${ownerUID}`))).exists, 409, 'request_unavailable');
        transaction.create(published, data.listing);
        transaction.create(summary, { ratingCount: 0, ratingSum: 0, updatedAt: at });
        if (code) {
          const original = data.submittedAt;
          transaction.create(codeOwner, { ownerUID, placeID: id, createdAt: original });
          transaction.create(ownCode, { placeID: id, reportID: report.id, code: code.code, visibility: code.visibility,
            createdAt: original, codeUpdatedAt: original, lastVerifiedAt: null });
          if (code.visibility === 'private') transaction.create(saved, { placeID: id, savedAt: at });
          else transaction.create(publicCode, { placeID: id, code: code.code, codeUpdatedAt: original, lastVerifiedAt: null });
        }
      }
      transaction.update(request, { status, revision: 2, reviewedAt: at, reason: body.reason,
        codeFingerprint: codeFingerprint(code), codeDraft: null });
      const result = { id, status, revision: 2, reviewedAt: iso(at) };
      writeAction(transaction, action, actor, 'decision', id, body, fingerprint, result, at);
      return result;
    });
  }
  async function comments(token, params = {}) {
    const actor = await actorFor(token), limit = pageSize(params.limit), scope = 'comments';
    const prior = cursors.read(params.cursor, actor.uid, scope) ?? {};
    const sources = await Promise.all(Object.entries(KINDS).map(async ([kind, config]) => {
      if (prior[kind]?.done) return { kind, docs: [], done: true, entries: [] };
      const query = db.collectionGroup(config.group).orderBy('submittedAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
      const snapshot = await queryAfter(query, prior[kind]?.after).limit(limit + 1).get();
      return { kind, docs: snapshot.docs, done: snapshot.size < limit + 1,
        entries: snapshot.docs.map(doc => ({ doc, dto: commentDTO(kind, doc) })).filter(e => e.dto) };
    }));
    const merged = sources.flatMap(s => s.entries).sort((a, b) => {
      const at = a.doc.get('submittedAt'), bt = b.doc.get('submittedAt');
      return bt.seconds - at.seconds || bt.nanoseconds - at.nanoseconds || b.doc.ref.path.localeCompare(a.doc.ref.path);
    }).slice(0, limit);
    const selected = new Set(merged.map(e => e.doc.ref.path)), next = {};
    for (const source of sources) {
      let after = prior[source.kind]?.after ?? null, consumed = 0;
      const valid = new Set(source.entries.map(e => e.doc.ref.path));
      for (const doc of source.docs) {
        if (valid.has(doc.ref.path) && !selected.has(doc.ref.path)) break;
        after = timePosition(doc); consumed++;
      }
      next[source.kind] = { after, done: source.done && consumed === source.docs.length };
    }
    const items = merged.map(e => e.dto);
    const names = new Map();
    const ids = [...new Set(items.map(i => i.placeID).filter(communityID))];
    if (ids.length) for (const doc of await db.getAll(...ids.map(id => db.collection('communityRestrooms').doc(id)))) {
      if (doc.exists && typeof doc.get('name') === 'string' && doc.get('name').length <= 120) names.set(doc.id, doc.get('name'));
    }
    for (const item of items) item.venueName = names.get(item.placeID) ?? 'NYC restroom';
    return { items, nextCursor: Object.values(next).some(s => !s.done) ? cursors.put(actor.uid, scope, next) : null };
  }
  async function findReceipt(kind, place, id, at) {
    const config = KINDS[kind];
    const candidates = await db.collectionGroup(config.receipts).where('placeID', '==', place).where('submittedAt', '==', at).limit(51).get();
    requireValue(candidates.size <= 50, 503, 'ownership_unavailable');
    const matches = candidates.docs.filter(doc => {
      const p = doc.ref.path.split('/');
      return p.length === 4 && p[0] === 'users' && uidSafe(p[1]) && p[2] === config.receipts && p[3] === id;
    });
    requireValue(matches.length === 1, 503, 'ownership_unavailable'); return matches[0].ref;
  }
  async function remove(token, kind, place, id, body) {
    const actor = await actorFor(token); requireValue(Object.hasOwn(KINDS, kind) && placeID(place) && recordID(id)); validateRemoval(body);
    const config = KINDS[kind], publicRef = db.collection(config.root).doc(place).collection(config.group).doc(id);
    const marker = db.collection('restroomModerationRemovals').doc(place).collection(config.marker).doc(id);
    const action = db.collection(ACTIONS).doc(body.actionId), target = `${kind}:${place}:${id}`;
    const fingerprint = targetHash('remove', target, body);
    const beforeAction = await action.get();
    const done = repeatedAction(beforeAction, actor, fingerprint); if (done) return done;
    const before = await publicRef.get();
    requireValue(before.exists && commentDTO(kind, before), 404, 'not_found');
    const receiptRef = await findReceipt(kind, place, id, before.get('submittedAt'));
    return db.runTransaction(async transaction => {
      await fenceActor(transaction, actor);
      const [doc, receipt, removed, currentAction] = await transaction.getAll(publicRef, receiptRef, marker, action);
      const repeated = repeatedAction(currentAction, actor, fingerprint); if (repeated) return repeated;
      requireValue(doc.exists && !removed.exists, 409, 'stale_revision');
      requireValue(revision(doc.updateTime) === body.revision && commentDTO(kind, doc), 409, 'stale_revision');
      const data = doc.data(), r = receipt.data();
      exact(r, kind === 'public-note' ? ['placeID', 'submittedAt'] : ['placeID', 'submittedAt', 'codeReportID']);
      requireValue(r.placeID === place && sameTime(r.submittedAt, data.submittedAt), 503, 'ownership_unavailable');
      const at = Timestamp.fromMillis(now()), mode = hasStructuredFacts(kind, data) ? 'redacted' : 'deleted';
      if (mode === 'redacted') transaction.update(publicRef, { [config.text]: '', ...(kind === 'unified-visit' ? { anonymous: true, authorName: null } : {}) });
      else { transaction.delete(publicRef); transaction.delete(receiptRef); }
      transaction.create(marker, { kind, placeID: place, recordID: id, reason: body.reason, removedAt: at });
      const result = { id, placeID: place, kind, status: 'removed', mode };
      writeAction(transaction, action, actor, 'remove', target, body, fingerprint, result, at);
      return result;
    });
  }
  return { session, requests, decide, comments, remove,
    ...createContentSafetyService({ auth, db, roster, now, cursors, safetyReady }) };
}
