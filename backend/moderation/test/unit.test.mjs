import assert from 'node:assert/strict';
import { allowedPublicText } from '../src/text-filter.mjs';
import { validateContentReport } from '../src/content-safety.mjs';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Timestamp } from 'firebase-admin/firestore';
import { requestDTO, codeFingerprint, validateDecision, validateRemoval, commentDTO } from '../src/policy.mjs';
import { CursorStore } from '../src/cursors.mjs';
import { authenticateModerator, FileModeratorRoster } from '../src/auth.mjs';
import { httpServer } from '../src/server.mjs';
const at = Timestamp.fromMillis(Date.UTC(2026, 10, 5));
const id = 'community-AAAAAAAAAAAAAAAAAAAA';
const listing = { name: 'Fixture café', address: '1 Fixture Street', latitude: 40.75, longitude: -73.99,
  locationType: 'cafe', entryRule: 'customers', stepFreeAccess: 'unknown', passcodeRequired: 'yes', notes: '', observedOn: null, submittedAt: at };
const pending = () => ({ schemaVersion: 1, status: 'pending', revision: 1, submittedAt: at, listing: { ...listing }, codeDraft: { code: '3434', visibility: 'private' } });
const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('request DTO never exposes private code, fingerprint or ownership paths', () => {
  const data = pending(), dto = requestDTO(id, data), text = JSON.stringify(dto);
  assert.equal(dto.hasCodeDraft, true); assert.equal(dto.listing.observedOn, null);
  for (const forbidden of ['3434', 'codeDraft', 'codeFingerprint', 'ownerUID', 'users/']) assert.equal(text.includes(forbidden), false);
  const terminal = { ...data, status: 'approved', revision: 2, codeDraft: null, codeFingerprint: codeFingerprint(data.codeDraft), reason: '', reviewedAt: at };
  const result = requestDTO(id, terminal); assert.equal(result.hasCodeDraft, true);
  assert.equal(JSON.stringify(result).includes(terminal.codeFingerprint), false);
});
test('private commitment matches independent UTF-8/NUL vector, not visibility-agnostic text', () => {
  assert.equal(codeFingerprint({ code: '3434', visibility: 'private' }), '23c35eb763da936366b6efeefa0577de853356f1ef008cb779d8e6e8ecee95ad');
  assert.notEqual(codeFingerprint({ code: '3434', visibility: 'public' }), codeFingerprint({ code: '3434', visibility: 'private' }));
  assert.equal(codeFingerprint(null), null);
});
test('malformed requests cannot be published or projected', () => {
  for (const patch of [{ ownerUID: 'leak' }, { revision: true }, { revision: 1.5 }, { status: 'approved' }, { schemaVersion: 2 }]) {
    assert.throws(() => requestDTO(id, { ...pending(), ...patch }));
  }
  assert.throws(() => requestDTO(id, { ...pending(), listing: { ...listing, accountID: 'not-public' } }));
  assert.throws(() => requestDTO(id, { ...pending(), listing: { ...listing, latitude: NaN } }));
  assert.throws(() => codeFingerprint({ code: 'line\nbreak', visibility: 'public' }));
  assert.throws(() => codeFingerprint({ code: '界', visibility: 'private' }));
  assert.doesNotThrow(() => codeFingerprint({ code: '1'.repeat(40), visibility: 'private' }));
});
test('decision/removal accepts only fixed reasons and explicit stable action IDs', () => {
  assert.doesNotThrow(() => validateDecision({ decision: 'approve', revision: 1, reason: '', actionId: uuid }));
  assert.throws(() => validateDecision({ decision: 'approve', revision: 1, reason: 'user text', actionId: uuid }));
  assert.throws(() => validateDecision({ decision: 'deny', revision: 1, reason: '', actionId: uuid }));
  assert.throws(() => validateDecision({ decision: 'approve', revision: 1, reason: '', actionId: uuid, ownerUID: 'forged' }));
  assert.doesNotThrow(() => validateRemoval({ revision: '1:123456789', reason: 'spam', actionId: uuid }));
  assert.throws(() => validateRemoval({ revision: 'hash-containing-a-code', reason: 'spam', actionId: uuid }));
});
test('opaque cursors are actor/scope/expiry bound and cap memory', () => {
  let now = 0; const store = new CursorStore({ now: () => now, ttl: 100, capacity: 2 });
  const token = store.put('first', 'requests:pending', { path: 'users/private/request/path' });
  assert.equal(token.length, 32); assert.equal(token.includes('private'), false);
  assert.deepEqual(store.read(token, 'first', 'requests:pending'), { path: 'users/private/request/path' });
  assert.throws(() => store.read(token, 'other', 'requests:pending'), e => e.code === 'cursor_expired');
  assert.throws(() => store.read(token, 'first', 'comments'));
  store.put('first', 'comments', {}); store.put('first', 'comments', {}); assert.equal(store.entries.size, 2);
  assert.throws(() => store.read(token, 'first', 'requests:pending'));
  const next = store.put('first', 'comments', {}); now = 101; assert.throws(() => store.read(next, 'first', 'comments'));
});
test('comment DTO rejects colliding passcode/private collections and uses exact update time', () => {
  const data = { schemaVersion: 1, placeID: 'nyc-fixture', body: '<script>untrusted public text</script>', observedAt: at, submittedAt: at,
    condition: 'not-reported', soap: 'not-reported', toiletPaper: 'not-reported', stairs: 'not-reported' };
  const snapshot = path => ({ ref: { path }, data: () => data, updateTime: new Timestamp(at.seconds, 123) });
  assert.equal(commentDTO('public-note', snapshot('users/private/notes/AAAAAAAAAAAAAAAAAAAA')), null);
  assert.equal(commentDTO('unified-visit', snapshot('restroomPasscodeReports/nyc-fixture/reports/AAAAAAAAAAAAAAAAAAAA')), null);
  const dto = commentDTO('public-note', snapshot('restroomPublicNotes/nyc-fixture/notes/AAAAAAAAAAAAAAAAAAAA'));
  assert.equal(dto.text, data.body); assert.equal(dto.revision, `${at.seconds}:123`); assert.equal(dto.authorLabel, 'Anonymous');
});
test('authorization checks verified, unrevoked Google identity and live role/deletion lock', async () => {
  const user = { uid: 'moderator', email: 'moderator@example.test', emailVerified: true, providerData: [{ providerId: 'google.com' }] };
  const calls = [];
  const base = { auth: { verifyIdToken: async (token, revoked) => { calls.push([token, revoked]); return { uid: user.uid, email_verified: true, firebase: { sign_in_provider: 'google.com' } }; }, getUser: async () => user },
    db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) }, roster: { allows: async () => true } };
  assert.equal((await authenticateModerator(base, 'fixture-token')).uid, user.uid);
  assert.deepEqual(calls, [['fixture-token', true]]);
  await assert.rejects(authenticateModerator({ ...base, roster: { allows: async () => false } }, 'fixture-token'), e => e.status === 403);
  await assert.rejects(authenticateModerator({ ...base, auth: { ...base.auth, verifyIdToken: async () => { throw Error('revoked'); } } }, 'fixture-token'), e => e.status === 401);
  await assert.rejects(authenticateModerator({ ...base, auth: { ...base.auth, getUser: async () => ({ ...user, disabled: true }) } }, 'fixture-token'), e => e.status === 401);
  await assert.rejects(authenticateModerator({ ...base, db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: true }) }) }) } }, 'fixture-token'), e => e.status === 403);
});
test('first selected Google UID enrolls atomically; recycled email cannot inherit access', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rr-moderator-role-'));
  try {
    const path = join(dir, 'roster.json'), roster = new FileModeratorRoster({ path, bootstrapEmail: 'moderator@example.test' });
    const user = { uid: 'initial', email: 'moderator@example.test', emailVerified: true, providerData: [{ providerId: 'google.com', email: 'moderator@example.test' }] };
    assert.equal(await roster.allows({ ...user, email: 'other@example.test' }), false);
    assert.deepEqual(await Promise.all([roster.allows(user), roster.allows(user)]), [true, true]);
    assert.equal(await roster.allows({ ...user, uid: 'recycled-email' }), false);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).uids, ['initial']);
    await writeFile(path, JSON.stringify({ version: 1, uids: [] })); await chmod(path, 0o600);
    assert.equal(await roster.allows(user), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('HTTP boundary rejects unauthenticated, foreign-origin, malformed and oversized actions without logging payloads', async () => {
  const calls = [];
  const server = httpServer({ session: async token => { calls.push(token); return { role: 'moderator' }; } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let r = await fetch(base + '/api/moderation/session'); assert.equal(r.status, 401);
    r = await fetch(base + '/api/moderation/session', { headers: { Authorization: 'Bearer fixture-token', Origin: 'https://evil.test' } }); assert.equal(r.status, 403);
    r = await fetch(base + '/api/moderation/session', { headers: { Authorization: 'Bearer fixture-token' } }); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(calls, ['fixture-token']);
    r = await fetch(base + '/api/moderation/requests/x/decision', { method: 'POST', headers: { Authorization: 'Bearer fixture-token', 'Content-Type': 'application/json' }, body: 'x'.repeat(2049) }); assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'invalid_request' });
  } finally { await new Promise(r => server.close(r)); }
});

test('public-text first-pass filter blocks whole abusive tokens without ordinary restroom-word collisions',()=>{
 for(const text of ['Accessible assistance is available.','A class next door.','Cockroaches near the sink.','The basement was usable.','No comment.'])assert.equal(allowedPublicText(text),true);
 for(const text of ['FUCK you','Please go die.','kill yourself','spam child porn link'])assert.equal(allowedPublicText(text),false);
});
test('private content report request accepts pinned exact unions and rejects extra user/body/identity data',()=>{
 const common={kind:'public-note',placeID:'i7jb-7jku:test',recordID:'N'.repeat(20),postedAt:'1790000000:123456',reason:'harassment',actionId:'00000000-0000-4000-8000-000000000001'};
 assert.doesNotThrow(()=>validateContentReport(common));
 for(const key of ['body','authorUID','reporterUID','text','code'])assert.throws(()=>validateContentReport({...common,[key]:'private'}));
 for(const kind of ['source-comment','research-comment']){const {postedAt,...body}=common;assert.doesNotThrow(()=>validateContentReport({...body,kind,recordID:'source:original-1',contentHash:'a'.repeat(64)}));assert.throws(()=>validateContentReport({...body,kind,contentHash:'a'.repeat(64),postedAt}));}
});

test('new report capability requires current compiled cleanup and persistent floor without credentials or redirects',async()=>{
 const {deletionSafetyReady}=await import('../src/runtime.mjs');
 const response=(body,status=200,type='application/json')=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':type}});
 let seen;assert.equal(await deletionSafetyReady(async(url,options)=>{seen={url,options};return response({status:'ok',policyVersion:5,minimumPolicyVersion:5});}),true);assert.equal(seen.url,'http://127.0.0.1:3002/health');assert.equal(seen.options.redirect,'error');assert.ok(seen.options.signal);
 for(const body of [{status:'ok',policyVersion:4,minimumPolicyVersion:5},{status:'ok',policyVersion:5,minimumPolicyVersion:4},{status:'ok',policyVersion:5,minimumPolicyVersion:null},{status:'ok',policyVersion:5,minimumPolicyVersion:'5'},{status:'ok',policyVersion:5,minimumPolicyVersion:6},{status:'ok',policyVersion:5,minimumPolicyVersion:5,extra:true}])assert.equal(await deletionSafetyReady(async()=>response(body)),false);
 assert.equal(await deletionSafetyReady(async()=>{throw Error('fixture offline');}),false);assert.equal(await deletionSafetyReady(async()=>response({status:'ok',policyVersion:5,minimumPolicyVersion:5},503)),false);assert.equal(await deletionSafetyReady(async()=>response({status:'ok',policyVersion:5,minimumPolicyVersion:5},200,'text/html')),false);
});
