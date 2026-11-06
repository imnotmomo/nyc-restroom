import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, test } from 'node:test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

// REST preserves integerValue/doubleValue explicitly. The web SDK normalizes
// integral JavaScript numbers, which otherwise hides the native whole-star bug.
const PROJECT = 'demo-restroom-native-rating-wire';
const OWNER = 'native-wire-alice';
const OTHER = 'native-wire-bob';
const PLACE = 'native-wire:source-fixture';
const COMMUNITY = 'community-fa70232e34087fcb585e';
const DOCUMENT_ROOT = `projects/${PROJECT}/databases/(default)/documents`;
let environment, base;

const integer = value => ({ integerValue: String(value) });
const decimal = value => ({ doubleValue: value });
const canonicalStars = value => Number.isInteger(value) ? integer(value) : decimal(value);
const summaryPath = (place = PLACE) => `restroomRatingSummaries/${place}`;
const votePath = (uid = OWNER, place = PLACE) => `${summaryPath(place)}/ratings/${uid}`;
const serverTime = [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }];

// Unsigned identities are accepted only by the Firestore emulator, just like
// rules-unit-testing's authenticatedContext. Never use these as real credentials.
function emulatorToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT,
    sub: uid, user_id: uid, iat: now, exp: now + 3600, auth_time: now,
    firebase: { identities: {}, sign_in_provider: 'google.com' },
  })}.`;
}

async function request(path, { body, token = 'owner' } = {}) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

async function seed(place = PLACE) {
  const writes = [{ update: { name: `${DOCUMENT_ROOT}/${summaryPath(place)}`, fields: {
    ratingCount: integer(0), ratingSum: integer(0),
    updatedAt: { timestampValue: '2020-01-01T00:00:00Z' },
  } } }];
  if (place === COMMUNITY) writes.push({ update: {
    name: `${DOCUMENT_ROOT}/communityRestrooms/${place}`,
    fields: { name: { stringValue: 'Synthetic emulator venue' } },
  } });
  const result = await request(':commit', { body: { writes } });
  assert.equal(result.status, 200, 'Emulator fixture initialization must succeed');
}

function ratingWrites(stars, {
  uid = OWNER, place = PLACE, wireStars = stars === null ? null : canonicalStars(stars),
  count = stars === null ? 0 : 1, sum = stars ?? 0,
  wireSum = decimal(sum),
} = {}) {
  return [
    {
      update: { name: `${DOCUMENT_ROOT}/${summaryPath(place)}`, fields: {
        ratingCount: integer(count), ratingSum: wireSum,
      } },
      updateMask: { fieldPaths: ['ratingCount', 'ratingSum'] }, updateTransforms: serverTime,
    },
    stars === null
      ? { delete: `${DOCUMENT_ROOT}/${votePath(uid, place)}` }
      : { update: { name: `${DOCUMENT_ROOT}/${votePath(uid, place)}`, fields: { stars: wireStars } }, updateTransforms: serverTime },
  ];
}

async function changeRating(stars, options = {}) {
  return request(':commit', {
    token: options.token ?? emulatorToken(OWNER),
    body: { writes: ratingWrites(stars, options) },
  });
}

async function assertConfirmed(stars, place = PLACE) {
  const summary = await request(`/${summaryPath(place)}`, { token: null });
  assert.equal(summary.status, 200);
  assert.equal(Number(summary.data.fields.ratingCount.integerValue), stars === null ? 0 : 1);
  const total = summary.data.fields.ratingSum;
  assert.equal(Number(total.integerValue ?? total.doubleValue), stars ?? 0);
  const own = await request(`/${votePath(OWNER, place)}`, { token: emulatorToken(OWNER) });
  if (stars === null) assert.equal(own.status, 404);
  else {
    assert.equal(own.status, 200);
    assert.deepEqual(own.data.fields.stars, canonicalStars(stars));
    assert.ok(own.data.fields.updatedAt.timestampValue);
  }
}

describe('native rating wire types against the real Firestore rules', { concurrency: false }, () => {
  before(async () => {
    const address = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8088';
    assert.ok(!address.includes('://'), 'Use an emulator host:port without a protocol');
    const endpoint = new URL(`http://${address}`);
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname), 'Wire tests permit loopback emulators only');
    assert.ok(endpoint.port && !endpoint.username && !endpoint.password && endpoint.pathname === '/' && !endpoint.search && !endpoint.hash);
    assert.ok(PROJECT.startsWith('demo-'));
    base = `${endpoint.origin}/v1/${DOCUMENT_ROOT}`;
    environment = await initializeTestEnvironment({
      projectId: PROJECT,
      firestore: { host: endpoint.hostname.replace(/^\[|\]$/g, ''), port: Number(endpoint.port),
        rules: await readFile(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8') },
    });
  });
  beforeEach(async () => { await environment.clearFirestore(); await seed(); });
  after(async () => {
    if (environment) {
      try { await environment.clearFirestore(); }
      finally { await environment.cleanup(); }
    }
  });

  for (const { label, stars, wireStars, wireSum, permitted } of [
    { label: 'integer whole stars and integer sum', stars: 5, wireStars: integer(5), wireSum: integer(5), permitted: true },
    { label: 'native double whole stars and double sum', stars: 5, wireStars: decimal(5), wireSum: decimal(5), permitted: false },
    { label: 'double whole stars fail even with integer sum', stars: 5, wireStars: decimal(5), wireSum: integer(5), permitted: false },
    { label: 'integer whole stars remain valid with double sum', stars: 5, wireStars: integer(5), wireSum: decimal(5), permitted: true },
    { label: 'decimal half stars and double sum', stars: 4.5, wireStars: decimal(4.5), wireSum: decimal(4.5), permitted: true },
    { label: 'native double one star is also rejected', stars: 1, wireStars: decimal(1), wireSum: decimal(1), permitted: false },
  ]) {
    test(label, async () => {
      const result = await changeRating(stars, { wireStars, wireSum });
      assert.equal(result.status, permitted ? 200 : 403);
      if (!permitted) assert.equal(result.data.error.status, 'PERMISSION_DENIED');
      if (permitted) await assertConfirmed(stars);
      else await assertConfirmed(null);
    });
  }

  for (let step = 2; step <= 10; step++) {
    const stars = step / 2;
    test(`canonical ${stars} stars can be created, changed and removed`, async () => {
      assert.equal((await changeRating(stars)).status, 200);
      await assertConfirmed(stars);
      const next = stars === 5 ? 4.5 : 5;
      assert.equal((await changeRating(next)).status, 200);
      await assertConfirmed(next);
      assert.equal((await changeRating(null)).status, 200);
      await assertConfirmed(null);
    });
  }

  test('the synthetic Capital One community ID accepts whole/half edits and removal', async () => {
    await seed(COMMUNITY);
    for (const stars of [5, 4.5, 1, null]) {
      assert.equal((await changeRating(stars, { place: COMMUNITY })).status, 200);
      await assertConfirmed(stars, COMMUNITY);
    }
  });

  test('correct numeric types cannot bypass vote ownership', async () => {
    assert.equal((await changeRating(5, { uid: OTHER })).status, 403);
    await assertConfirmed(null);
    assert.equal((await changeRating(5)).status, 200);
    const stolenRead = await request(`/${votePath()}`, { token: emulatorToken(OTHER) });
    assert.equal(stolenRead.status, 403);
    await assertConfirmed(5);
  });

  test('correct numeric types cannot forge aggregate counts or sums', async () => {
    assert.equal((await changeRating(5, { count: 2, sum: 10 })).status, 403);
    await assertConfirmed(null);
    assert.equal((await changeRating(5, { sum: 4 })).status, 403);
    await assertConfirmed(null);
  });
});
