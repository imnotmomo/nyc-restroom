import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INSERT, values, validateSignup } from '../worker/waitlist.mjs';
import {
  createD1ConfirmationStore, CONFIRMATION_HOUR_MS, CONFIRMATION_LEASE_MS,
  saveParameters, claimParameters, completionParameters,
} from '../worker/confirmation-outbox.mjs';

const NOW = 1_800_000_000_000;
const key = number => number.toString(16).padStart(64, '0');
const signup = number => validateSignup({ email: `outbox-${number}@example.test`, source: 'home' });
const queuedOptions = (client = 1, now = NOW) => ({ enqueueConfirmation: true, clientKey: key(client), now });
const accepted = { outcome: 'accepted', reason: 'queued', ambiguous: false };
const retry = { outcome: 'retry', reason: 'provider-unavailable', ambiguous: false };
const isRateLimit = error => error?.code === 'WAITLIST_CONFIRMATION_RATE_LIMIT';

// The production Node adapter and Cloudflare D1 share this contract. These tests
// execute the real SQL and transaction boundaries rather than mocking outcomes.
function d1Shape(database) {
  const prepare = sql => {
    const statement = database.prepare(sql);
    const bind = (...parameters) => {
      const run = () => {
        const result = statement.run(...parameters);
        return { success: true, meta: { changes: Number(result.changes) }, results: [] };
      };
      const all = () => {
        const rows = statement.all(...parameters);
        const changes = Number(database.prepare('SELECT changes() AS count').get().count);
        return { success: true, meta: { changes }, results: rows };
      };
      return { sql, run, all, first: () => all().results[0] ?? null };
    };
    return { bind };
  };
  return {
    prepare,
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = statements.map(statement => /^\s*SELECT\b|\bRETURNING\b/i.test(statement.sql) ? statement.all() : statement.run());
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function fixture(t, historical = []) {
  const directory = mkdtempSync(join(tmpdir(), 'restroom-confirmation-test-'));
  const filename = join(directory, 'waitlist.sqlite');
  const connections = [];
  const open = () => {
    const database = new DatabaseSync(filename);
    database.exec('PRAGMA busy_timeout = 1000');
    connections.push(database);
    return { database, store: createD1ConfirmationStore(d1Shape(database)) };
  };
  const current = open();
  current.database.exec(readFileSync(new URL('../drizzle/0000_waitlist.sql', import.meta.url), 'utf8'));
  for (const record of historical) current.database.prepare(INSERT).run(...values(record));
  current.database.exec(readFileSync(new URL('../drizzle/0001_waitlist_confirmations.sql', import.meta.url), 'utf8'));
  t.after(() => {
    for (const database of connections) { try { database.close(); } catch { /* A test may have explicitly reopened it. */ } }
    rmSync(directory, { recursive: true, force: true });
  });
  const row = email => current.database.prepare('SELECT * FROM waitlist_confirmation_outbox WHERE email = ?').get(email);
  const count = table => Number(current.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
  return { ...current, open, row, count };
}

test('new signup and confirmation are atomic, and duplicate submissions never enqueue again', async t => {
  const f = fixture(t);
  const record = signup(1);
  assert.deepEqual(await f.store.save(record, queuedOptions()), { inserted: true, queued: true });
  assert.deepEqual(await f.store.save(record, queuedOptions(2)), { inserted: false, queued: false });
  assert.equal(f.count('waitlist'), 1);
  assert.equal(f.count('waitlist_confirmation_outbox'), 1);
  assert.equal(f.row(record.email).attempts, 0);
  assert.equal(f.row(record.email).created_at, NOW);
  assert.equal(f.row(record.email).client_key, key(1));
});

test('migration never backfills history; unconfigured or unkeyed signups cannot enqueue on a later duplicate', async t => {
  const historical = signup('old');
  const f = fixture(t, [historical]);
  assert.equal(f.count('waitlist_confirmation_outbox'), 0);
  assert.deepEqual(await f.store.save(historical, queuedOptions()), { inserted: false, queued: false });
  for (const [index, options] of [
    {},
    { enqueueConfirmation: false, clientKey: key(1), now: NOW },
    { enqueueConfirmation: true, clientKey: '', now: NOW },
    { enqueueConfirmation: true, clientKey: '192.0.2.8', now: NOW },
    { enqueueConfirmation: true, clientKey: key(255).toUpperCase(), now: NOW },
  ].entries()) {
    const record = signup(`without-${index}`);
    assert.deepEqual(await f.store.save(record, options), { inserted: true, queued: false });
    assert.deepEqual(await f.store.save(record, queuedOptions()), { inserted: false, queued: false });
  }
  assert.equal(f.count('waitlist'), 6);
  assert.equal(f.count('waitlist_confirmation_outbox'), 0);
});

test('outbox failure rolls back the new waitlist row and allows a clean retry', async t => {
  const f = fixture(t);
  const record = signup('rollback');
  f.database.exec(`CREATE TRIGGER reject_confirmation BEFORE INSERT ON waitlist_confirmation_outbox
    BEGIN SELECT RAISE(ABORT, 'test rejection'); END`);
  await assert.rejects(f.store.save(record, queuedOptions()), /test rejection/);
  assert.equal(f.count('waitlist'), 0);
  assert.equal(f.count('waitlist_confirmation_outbox'), 0);
  f.database.exec('DROP TRIGGER reject_confirmation');
  assert.deepEqual(await f.store.save(record, queuedOptions()), { inserted: true, queued: true });
});

test('five jobs per hashed client per rolling hour, including already accepted jobs', async t => {
  const f = fixture(t);
  const another = f.open();
  for (let index = 0; index < 4; index++) await f.store.save(signup(index), queuedOptions());
  const results = await Promise.allSettled([
    f.store.save(signup(4), queuedOptions()),
    another.store.save(signup(5), queuedOptions()),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled' && result.value.queued && result.value.inserted).length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && isRateLimit(result.reason)).length, 1);
  assert.equal(f.count('waitlist'), 5);
  const job = await f.store.claim(NOW);
  await f.store.complete(job, accepted, NOW + 1);
  await assert.rejects(f.store.save(signup(6), queuedOptions()), isRateLimit);
  await assert.rejects(f.store.save(signup(0), queuedOptions()), isRateLimit);
  await assert.rejects(f.store.save(signup(7), queuedOptions(1, NOW + CONFIRMATION_HOUR_MS - 1)), isRateLimit);
  assert.equal(f.database.prepare('SELECT email FROM waitlist WHERE email = ?').get(signup(6).email), undefined);
  assert.equal(f.count('waitlist'), 5);
  // A rejected address was not silently saved; retrying after the window can
  // therefore create its confirmation job as well as its signup.
  assert.deepEqual(await f.store.save(signup(6), queuedOptions(1, NOW + CONFIRMATION_HOUR_MS)), { inserted: true, queued: true });
  assert.equal(f.count('waitlist'), 6);
});

test('sixty total jobs per rolling hour rejects before saving at the last slot; unconfigured baseline remains available', async t => {
  const f = fixture(t);
  const another = f.open();
  for (let index = 0; index < 59; index++) await f.store.save(signup(index), queuedOptions(index + 1));
  const results = await Promise.allSettled([
    f.store.save(signup(59), queuedOptions(60)),
    another.store.save(signup(60), queuedOptions(61)),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled' && result.value.queued && result.value.inserted).length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && isRateLimit(result.reason)).length, 1);
  assert.equal(f.count('waitlist_confirmation_outbox'), 60);
  assert.equal(f.count('waitlist'), 60);
  // Duplicate requests share the same fixed error as unknown addresses at cap.
  await assert.rejects(f.store.save(signup(0), queuedOptions(62)), isRateLimit);
  await assert.rejects(f.store.save(signup('over-cap'), queuedOptions(63)), isRateLimit);
  assert.equal(f.database.prepare('SELECT email FROM waitlist WHERE email = ?').get(signup('over-cap').email), undefined);
  assert.deepEqual(await f.store.save(signup('unconfigured'), { now: NOW }), { inserted: true, queued: false });
  assert.equal(f.count('waitlist'), 61);
  assert.deepEqual(await f.store.save(signup(61), queuedOptions(62, NOW + CONFIRMATION_HOUR_MS)), { inserted: true, queued: true });
  assert.equal(f.count('waitlist'), 62);
});

test('jobs and accepted status survive reopening the database', async t => {
  const f = fixture(t);
  const record = signup('persisted');
  await f.store.save(record, queuedOptions());
  f.database.close();
  const reopened = f.open();
  const job = await reopened.store.claim(NOW);
  assert.equal(job.email, record.email);
  assert.equal(job.attempts, 1);
  assert.equal(await reopened.store.complete(job, accepted, NOW + 10), true);
  reopened.database.close();
  const final = f.open();
  assert.equal(final.database.prepare('SELECT status FROM waitlist_confirmation_outbox WHERE email = ?').get(record.email).status, 'accepted');
  assert.equal(await final.store.claim(NOW + CONFIRMATION_HOUR_MS), null);
});

test('two store connections cannot claim the same pending row and claims have distinct bounded leases', async t => {
  const f = fixture(t);
  const another = f.open();
  await f.store.save(signup('a'), queuedOptions());
  await f.store.save(signup('b'), queuedOptions());
  const [first, second] = await Promise.all([f.store.claim(NOW), another.store.claim(NOW)]);
  assert.notEqual(first.email, second.email);
  assert.notEqual(first.lease_token, second.lease_token);
  for (const job of [first, second]) {
    assert.equal(job.status, 'sending');
    assert.equal(job.attempts, 1);
    assert.equal(job.lease_until, NOW + CONFIRMATION_LEASE_MS);
  }
  assert.equal(await f.store.claim(NOW + 1), null);
});

test('an expired in-flight lease becomes uncertain, cannot be reclaimed, and rejects its late completion', async t => {
  const f = fixture(t);
  await f.store.save(signup('expired'), queuedOptions());
  const job = await f.store.claim(NOW);
  assert.equal(await f.store.complete(job, accepted, NOW + CONFIRMATION_LEASE_MS), false);
  assert.equal(f.row(job.email).status, 'uncertain');
  assert.equal(f.row(job.email).last_reason, 'lease-expired');
  assert.equal(f.row(job.email).lease_token, null);
  assert.equal(await f.store.claim(NOW + CONFIRMATION_HOUR_MS), null);
  assert.equal(await f.store.complete(job, accepted, NOW + CONFIRMATION_HOUR_MS), false);
});

test('claim expires crashed jobs without replay while still claiming a different pending job', async t => {
  const f = fixture(t);
  await f.store.save(signup('a-crashed'), queuedOptions());
  const crashed = await f.store.claim(NOW);
  await f.store.save(signup('b-next'), queuedOptions(2, NOW + 10));
  const next = await f.store.claim(NOW + CONFIRMATION_LEASE_MS);
  assert.notEqual(next.email, crashed.email);
  assert.equal(f.row(crashed.email).status, 'uncertain');
  assert.equal(f.row(crashed.email).attempts, 1);
});

test('known rejection retries wait sixty then three hundred seconds and stop after three attempts', async t => {
  const f = fixture(t);
  await f.store.save(signup('retry'), queuedOptions());
  const first = await f.store.claim(NOW);
  assert.equal(await f.store.complete(first, { ...retry, reason: 'rate-limited' }, NOW + 1), true);
  assert.equal(f.row(first.email).available_at, NOW + 60_001);
  assert.equal(await f.store.claim(NOW + 60_000), null);
  const second = await f.store.claim(NOW + 60_001);
  assert.equal(second.attempts, 2);
  assert.notEqual(first.lease_token, second.lease_token);
  assert.equal(await f.store.complete(first, accepted, NOW + 60_002), false);
  assert.equal(await f.store.complete(second, retry, NOW + 60_002), true);
  assert.equal(f.row(first.email).available_at, NOW + 360_002);
  assert.equal(await f.store.claim(NOW + 360_001), null);
  const third = await f.store.claim(NOW + 360_002);
  assert.equal(third.attempts, 3);
  assert.equal(await f.store.complete(third, retry, NOW + 360_003), true);
  assert.equal(f.row(first.email).status, 'failed');
  assert.equal(f.row(first.email).last_reason, 'attempts-exhausted');
  assert.equal(await f.store.claim(NOW + CONFIRMATION_HOUR_MS), null);
});

test('ambiguous provider/network results are held for review and never automatically resent', async t => {
  const f = fixture(t);
  for (const [index, reason] of ['timeout', 'network', 'invalid-response', 'provider-unavailable'].entries()) {
    await f.store.save(signup(`ambiguous-${index}`), queuedOptions());
    const job = await f.store.claim(NOW);
    assert.equal(await f.store.complete(job, { outcome: 'retry', reason, ambiguous: true }, NOW + 1), true);
    assert.equal(f.row(job.email).status, 'uncertain');
    assert.equal(f.row(job.email).last_reason, reason);
  }
  assert.equal(await f.store.claim(NOW + CONFIRMATION_HOUR_MS), null);
});

test('permanent failure and missing configuration are terminal; completion is idempotent and token guarded', async t => {
  const f = fixture(t);
  const cases = [
    { outcome: 'failed', reason: 'permanent-bounce', ambiguous: false },
    { outcome: 'unconfigured', reason: 'not-configured', ambiguous: false },
  ];
  for (const [index, result] of cases.entries()) {
    await f.store.save(signup(`failed-${index}`), queuedOptions());
    const job = await f.store.claim(NOW);
    assert.equal(await f.store.complete({ ...job, lease_token: 'a-different-lease-token' }, accepted, NOW + 1), false);
    assert.equal(f.row(job.email).status, 'sending');
    assert.equal(await f.store.complete(job, result, NOW + 2), true);
    assert.equal(await f.store.complete(job, accepted, NOW + 3), false);
    assert.equal(f.row(job.email).status, 'failed');
    assert.equal(f.row(job.email).last_reason, result.reason);
  }
  assert.equal(await f.store.claim(NOW + CONFIRMATION_HOUR_MS), null);
});

test('only fixed safe reasons are persisted and unknown outcomes stay uncertain', async t => {
  const f = fixture(t);
  const unsafe = 'recipient@example.test provider raw response';
  const cases = [
    [{ outcome: 'retry', reason: unsafe, ambiguous: true }, 'uncertain', 'ambiguous'],
    [{ outcome: 'failed', reason: unsafe, ambiguous: false }, 'failed', 'permanent-failure'],
    [{ outcome: 'retry', reason: unsafe, ambiguous: false }, 'uncertain', 'invalid-response'],
    [{ outcome: 'unknown', reason: unsafe, ambiguous: false }, 'uncertain', 'invalid-response'],
    [null, 'uncertain', 'invalid-response'],
  ];
  for (const [index, [result, status, reason]] of cases.entries()) {
    await f.store.save(signup(`safe-${index}`), queuedOptions());
    const job = await f.store.claim(NOW);
    await f.store.complete(job, result, NOW + 1);
    assert.equal(f.row(job.email).status, status);
    assert.equal(f.row(job.email).last_reason, reason);
  }
  assert.equal(f.database.prepare('SELECT COUNT(*) AS count FROM waitlist_confirmation_outbox WHERE last_reason = ?').get(unsafe).count, 0);
});

test('parameter helpers reject invalid lease, clock and job inputs without recording them', () => {
  for (const now of [-1, Infinity, NaN, 1.5, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => saveParameters(signup('clock'), queuedOptions(1, now)), /Invalid confirmation time/);
  }
  assert.throws(() => claimParameters(NOW, 'short'), /Invalid confirmation lease/);
  assert.throws(() => completionParameters({ email: 'test@example.test', attempts: 0, lease_token: 'token' }, accepted, NOW), /Invalid confirmation job/);
});
