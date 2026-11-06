import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { authenticate } from '../src/auth.mjs';
import { httpServer, minimumPolicyVersion } from '../src/server.mjs';
import { COMPLETED_RETENTION_MS, DELETION_POLICY_VERSION, ServiceError, checkLease, deletionPolicyVersion, requestToken,
  requireRecentSession, responseFor, sameSession, validVote, validateBody, validateClaims, validateReceipt } from '../src/policy.mjs';

const NOW = 1_800_000_000_000;
const seconds = NOW / 1000;
const claims = (overrides = {}) => ({ uid: 'alice', sub: 'alice', auth_time: seconds,
  firebase: { sign_in_provider: 'google.com' }, ...overrides });
const code = (expected, action) => assert.throws(action, error => error instanceof ServiceError && error.code === expected);

test('a managed current symlink starts the executable instead of silently exiting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rr-deletion-entry-'));
  try {
    await symlink(fileURLToPath(new URL('../', import.meta.url)), join(directory, 'current'), 'dir');
    const environment = { ...process.env, NODE_OPTIONS: '',
      GOOGLE_APPLICATION_CREDENTIALS: join(directory, 'missing-credentials.json') };
    delete environment.FIRESTORE_EMULATOR_HOST;
    delete environment.FIREBASE_AUTH_EMULATOR_HOST;
    // No credential exists: reaching the fixed startup failure proves main executed,
    // without contacting Firebase or opening a production account-deletion server.
    const child = spawnSync(process.execPath, [join(directory, 'current', 'src', 'server.mjs')], {
      encoding: 'utf8', env: environment, timeout: 10_000,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 1);
    assert.equal(child.stdout, '');
    assert.equal(child.stderr, 'Account deletion service could not start.\n');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('only the native/no-Origin and exact production Origin accept a Bearer token', () => {
  assert.equal(requestToken({ authorization: 'Bearer aaa.bbb.ccc' }), 'aaa.bbb.ccc');
  assert.equal(requestToken({ authorization: 'Bearer aaa.bbb.ccc', origin: 'https://nyc.imfinethanku.me' }), 'aaa.bbb.ccc');
  for (const origin of ['null', '', 'https://evil.example', 'https://nyc.imfinethanku.me.evil.example']) {
    code('origin_not_allowed', () => requestToken({ authorization: 'Bearer aaa.bbb.ccc', origin }));
  }
  for (const authorization of [undefined, '', 'Basic aaa', 'Bearer aaa', 'Bearer aaa.bbb.ccc extra']) {
    code('authentication_required', () => requestToken({ authorization }));
  }
});

test('the JSON body cannot target any account or accept another operation', () => {
  validateBody({});
  for (const body of [null, [], '', { uid: 'bob' }, { account: 'alice' }, { confirmed: true }]) {
    code('invalid_request', () => validateBody(body));
  }
});

test('identity/provider validation and the 300-second new-job gate are separate', () => {
  const accepted = validateClaims(claims({ auth_time: seconds - 300 }), NOW);
  requireRecentSession(accepted, NOW);
  const resumable = validateClaims(claims({ auth_time: seconds - 301 }), NOW);
  code('recent_sign_in_required', () => requireRecentSession(resumable, NOW));
  for (const invalid of [claims({ uid: 'alice/bob' }), claims({ sub: 'bob' }),
    claims({ firebase: { sign_in_provider: 'anonymous' } }), claims({ auth_time: seconds + 1 }), claims({ auth_time: null })]) {
    assert.throws(() => validateClaims(invalid, NOW), ServiceError);
  }
});

test('revoked/disabled/wrong-provider users cannot authorize deletion; deleted users need a receipt later', async () => {
  const providerData = [{ providerId: 'google.com' }];
  const valid = { verifyIdToken: async () => claims(), getUser: async () => ({ uid: 'alice', disabled: false, providerData }) };
  assert.equal((await authenticate(valid, 'unused', NOW)).authMissing, false);
  for (const auth of [
    { ...valid, verifyIdToken: async (_, revoked) => { if (revoked) throw { code: 'auth/id-token-revoked' }; return claims(); } },
    { ...valid, getUser: async () => ({ uid: 'alice', disabled: true, providerData }) },
    { ...valid, getUser: async () => ({ uid: 'alice', disabled: false, providerData: [{ providerId: 'password' }] }) },
    { ...valid, getUser: async () => ({ uid: 'bob', disabled: false, providerData }) },
  ]) await assert.rejects(authenticate(auth, 'unused', NOW), ServiceError);
  assert.equal((await authenticate({ ...valid, getUser: async () => { throw { code: 'auth/user-not-found' }; } }, 'unused', NOW)).authMissing, true);
});

test('only the current unexpired lease can mutate and completed retention is two hours', () => {
  const session = { authTime: seconds, provider: 'google.com' };
  const receipt = { phase: 'pending', sessionAuthTime: seconds, provider: 'google.com', leaseOwner: 'one', leaseExpiresAt: Timestamp.fromMillis(NOW + 1) };
  checkLease(receipt, { owner: 'one' }, NOW);
  code('deletion_in_progress', () => checkLease(receipt, { owner: 'two' }, NOW));
  code('deletion_in_progress', () => checkLease(receipt, { owner: 'one' }, NOW + 1));
  code('deletion_in_progress', () => checkLease({ ...receipt, phase: 'completed' }, { owner: 'one' }, NOW));
  assert.equal(sameSession(receipt, session), true);
  assert.equal(sameSession(receipt, { ...session, authTime: seconds + 1 }), true);
  assert.equal(sameSession(receipt, { ...session, authTime: seconds - 1 }), false);
  assert.equal(COMPLETED_RETENTION_MS, 7_200_000);
});

test('anonymous retention accepts only the exact existing valid vote payload', () => {
  const date = Timestamp.fromMillis(NOW);
  for (const stars of [1, 3.5, 5]) assert.equal(validVote({ stars, updatedAt: date }), true);
  for (const invalid of [{ stars: 9, updatedAt: date }, { stars: 4.1, updatedAt: date },
    { stars: 4, updatedAt: date, ownerUID: 'alice' }, { stars: 2 },
    { stars: 4, updatedAt: date, anonymous: true }]) {
    assert.equal(Boolean(validVote(invalid)), false);
  }
});

test('legacy receipts are explicit policy 1 while unsupported versions fail closed', () => {
  const receipt = { phase: 'pending', sessionAuthTime: seconds, provider: 'google.com' };
  assert.equal(DELETION_POLICY_VERSION, 5);
  assert.equal(deletionPolicyVersion(receipt), 1);
  for (const policyVersion of [1, 2, 3, 4, 5]) {
    validateReceipt({ ...receipt, policyVersion });
    assert.equal(deletionPolicyVersion({ ...receipt, policyVersion }), policyVersion);
  }
  for (const policyVersion of [0, 6, null, '5', false]) {
    code('deletion_unavailable', () => validateReceipt({ ...receipt, policyVersion }));
  }
});

test('unknown errors cannot expose provider, token, UID or private payload details', () => {
  assert.deepEqual(responseFor(new Error('secret token alice private note')), { status: 503, body: { error: 'deletion_unavailable' } });
  assert.deepEqual(responseFor(new ServiceError(409, 'deletion_in_progress')), { status: 409, body: { error: 'deletion_in_progress' } });
});

test('HTTP exposes health and exact deletion response; invalid requests never call deletion', async () => {
  let calls = 0;
  const server = httpServer(async token => { calls++; assert.equal(token, 'aaa.bbb.ccc'); return { status: 'deleted' }; });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (body, headers = {}) => fetch(base + '/api/account/delete', { method: 'POST', body,
    headers: { authorization: 'Bearer aaa.bbb.ccc', 'content-type': 'application/json', ...headers } });
  try {
    assert.deepEqual(await (await fetch(base + '/health')).json(), { status: 'ok', policyVersion: DELETION_POLICY_VERSION, minimumPolicyVersion: null });
    for (const body of ['{"uid":"bob"}', '[]', 'null', '', 'x'.repeat(257)]) assert.equal((await send(body)).status, 400);
    assert.equal((await send('{}', { origin: 'https://evil.example' })).status, 403);
    assert.equal(calls, 0);
    const success = await send('{}');
    assert.equal(success.status, 200); assert.equal(await success.text(), '{"status":"deleted"}');
    assert.equal(success.headers.get('cache-control'), 'no-store'); assert.equal(calls, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('health capability floor read fails closed for absent, malformed and nonpositive local files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'rr-policy-floor-test-'));try{const path=join(root,'floor');assert.equal(await minimumPolicyVersion(path),null);for(const value of ['invalid','0','-1','5.0','999999999999999999999']){await writeFile(path,value);assert.equal(await minimumPolicyVersion(path),null);}await writeFile(path,'5\n');assert.equal(await minimumPolicyVersion(path),5);}finally{await rm(root,{recursive:true,force:true});}
});
