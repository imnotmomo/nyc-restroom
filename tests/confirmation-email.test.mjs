import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmationEmailReady, sendConfirmationEmail } from '../worker/confirmation-email.mjs';

const recipient = 'visitor@example.test';
const env = {
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  CLOUDFLARE_EMAIL_API_TOKEN: 'test-only-token-with-no-network-access',
  WAITLIST_EMAIL_FROM: 'welcome@nyc.imfinethanku.me',
};
const accepted = (group = 'delivered') => ({ success: true, errors: [], result: { delivered: [], queued: [], permanent_bounces: [], [group]: [recipient] } });
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const mocked = body => ({ fetchImpl: async () => reply(body) });

test('configuration readiness requires an exact approved sender and bounded header-safe account/token', async () => {
  assert.equal(confirmationEmailReady(env), true);
  let calls = 0;
  const options = { fetchImpl: async () => { calls++; throw new Error('Must not fetch'); } };
  assert.deepEqual(await sendConfirmationEmail(recipient, {}, options), { outcome: 'unconfigured', reason: 'not-configured', ambiguous: false });
  for (const config of [
    { ...env, CLOUDFLARE_ACCOUNT_ID: 'bad-account' },
    { ...env, CLOUDFLARE_ACCOUNT_ID: `${'a'.repeat(32)}\n` },
    { ...env, CLOUDFLARE_EMAIL_API_TOKEN: 'short' },
    { ...env, CLOUDFLARE_EMAIL_API_TOKEN: `${env.CLOUDFLARE_EMAIL_API_TOKEN}\r\nX-Header: injected` },
    { ...env, CLOUDFLARE_EMAIL_API_TOKEN: 'a'.repeat(2049) },
    { ...env, WAITLIST_EMAIL_FROM: 'visitor@example.test' },
    { ...env, WAITLIST_EMAIL_FROM: `${env.WAITLIST_EMAIL_FROM}\nBcc: other@example.test` },
    { CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID },
  ]) {
    assert.equal(confirmationEmailReady(config), false);
    assert.deepEqual(await sendConfirmationEmail(recipient, config, options), { outcome: 'failed', reason: 'invalid-config', ambiguous: false });
  }
  assert.equal(calls, 0);
});

for (const delivery of ['delivered', 'queued']) test(`one ${delivery} recipient is accepted with fixed receipt content and endpoint`, async () => {
  let calls = 0;
  const sent = await sendConfirmationEmail('  VISITOR@EXAMPLE.TEST  ', env, { fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/email/sending/send`);
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${env.CLOUDFLARE_EMAIL_API_TOKEN}`);
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.deepEqual(Object.keys(body).sort(), ['from', 'html', 'subject', 'text', 'to']);
    assert.equal(body.to, recipient);
    assert.equal(body.from, 'welcome@nyc.imfinethanku.me');
    assert.match(body.subject, /Restroom Ready waitlist/);
    assert.match(body.text, /You're on the waitlist/);
    assert.match(body.html, /You're on the waitlist/);
    for (const content of [body.text, body.html]) {
      assert.match(content, /https:\/\/nyc\.imfinethanku\.me\/demo\//);
      assert.doesNotMatch(content, /verified|confirm your email|finder[-_ ]?(?:access|passcode)|visitor@example/);
    }
    return reply(accepted(delivery));
  } });
  assert.equal(calls, 1);
  assert.deepEqual(sent, { outcome: 'accepted', reason: delivery, ambiguous: false });
});

test('permanent bounce and suppressed recipient are terminal without leaking the address', async () => {
  for (const [group, reason] of [['permanent_bounces', 'permanent-bounce'], ['suppressed_recipients', 'recipient-suppressed']]) {
    assert.deepEqual(await sendConfirmationEmail(recipient, env, mocked(accepted(group))), { outcome: 'failed', reason, ambiguous: false });
  }
});

test('success true must actually acknowledge this recipient exactly once', async () => {
  const invalid = [
    { success: true },
    { success: 'true', result: accepted().result },
    { success: true, result: { delivered: [], queued: [], permanent_bounces: [] } },
    { success: true, result: { delivered: ['someone-else@example.test'], queued: [], permanent_bounces: [] } },
    { success: true, result: { delivered: [recipient], queued: [recipient], permanent_bounces: [] } },
    { success: true, result: { delivered: [recipient, recipient], queued: [], permanent_bounces: [] } },
    { ...accepted(), errors: [{ code: 10002, message: 'must-not-leak' }] },
    { success: true, result: { delivered: recipient, queued: [], permanent_bounces: [] } },
  ];
  for (const body of invalid) assert.deepEqual(await sendConfirmationEmail(recipient, env, mocked(body)), { outcome: 'retry', reason: 'invalid-response', ambiguous: true });
});

test('a bounce or suppression is never accepted just because delivered is also populated', async () => {
  for (const [group, reason] of [['permanent_bounces', 'permanent-bounce'], ['suppressed_recipients', 'recipient-suppressed']]) {
    const body = accepted(); body.result[group] = [recipient];
    assert.deepEqual(await sendConfirmationEmail(recipient, env, mocked(body)), { outcome: 'failed', reason, ambiguous: false });
  }
});

for (const [status, outcome, reason, ambiguous] of [
  [400, 'failed', 'invalid-request', false], [401, 'failed', 'invalid-config', false],
  [403, 'failed', 'invalid-config', false], [404, 'failed', 'invalid-config', false],
  [429, 'retry', 'rate-limited', false], [500, 'retry', 'provider-unavailable', false],
  [503, 'retry', 'provider-unavailable', false], [408, 'retry', 'provider-unavailable', true],
]) test(`HTTP ${status} is classified without exposing provider details`, async () => {
  const response = await sendConfirmationEmail(recipient, env, { fetchImpl: async () => reply({ secret: env.CLOUDFLARE_EMAIL_API_TOKEN, email: recipient }, status) });
  assert.deepEqual(response, { outcome, reason, ambiguous });
});

test('documented numeric error codes are mapped to fixed safe categories', async () => {
  for (const [code, outcome, reason] of [[10101, 'failed', 'invalid-config'], [10203, 'failed', 'invalid-config'], [10202, 'failed', 'invalid-request'], [10004, 'retry', 'rate-limited'], [10100, 'retry', 'provider-unavailable']]) {
    const response = await sendConfirmationEmail(recipient, env, mocked({ success: false, errors: [{ code, message: `${recipient} ${env.CLOUDFLARE_EMAIL_API_TOKEN}` }] }));
    assert.deepEqual(response, { outcome, reason, ambiguous: false });
  }
});

test('malformed, oversized and invalid-UTF8 responses are ambiguous retry outcomes', async () => {
  const body = new TextEncoder().encode(JSON.stringify(accepted()));
  const factories = [
    () => new Response('not json'),
    () => new Response('null'),
    () => new Response('[]'),
    () => new Response(new Uint8Array([0xff])),
    () => new Response(' '.repeat(16_385)),
    () => new Response(body, { headers: { 'Content-Length': '999999' } }),
    () => new Response(body, { headers: { 'Content-Length': 'not-a-size' } }),
    () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(9000)); controller.enqueue(new Uint8Array(9000)); controller.close(); } })),
  ];
  for (const response of factories) assert.deepEqual(await sendConfirmationEmail(recipient, env, { fetchImpl: async () => response() }), { outcome: 'retry', reason: 'invalid-response', ambiguous: true });
});

test('network failure is ambiguous and raw exceptions never reach the result or logs', async () => {
  const response = await sendConfirmationEmail(recipient, env, { fetchImpl: async () => { throw new Error(`${recipient} ${env.CLOUDFLARE_EMAIL_API_TOKEN}`); } });
  assert.deepEqual(response, { outcome: 'retry', reason: 'network', ambiguous: true });
  assert.doesNotMatch(JSON.stringify(response), /visitor@|test-only-token/);
});

test('deadline aborts an uncooperative fetch and classifies uncertainty', async () => {
  let signal;
  const response = await sendConfirmationEmail(recipient, env, { timeoutMs: 10, fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  assert.equal(signal.aborted, true);
  assert.deepEqual(response, { outcome: 'retry', reason: 'timeout', ambiguous: true });
});

test('deadline also bounds a stalled response stream', async () => {
  let cancelled = false;
  const response = await sendConfirmationEmail(recipient, env, { timeoutMs: 10, fetchImpl: async () => new Response(new ReadableStream({ start() {}, cancel() { cancelled = true; } })) });
  assert.deepEqual(response, { outcome: 'retry', reason: 'timeout', ambiguous: true });
  assert.equal(cancelled, true);
});

test('timeout configuration cannot exceed ten seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const pending = sendConfirmationEmail(recipient, env, { timeoutMs: 60_000, fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  t.mock.timers.tick(9999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  assert.deepEqual(await pending, { outcome: 'retry', reason: 'timeout', ambiguous: true });
  assert.equal(signal.aborted, true);
});

test('an unusable provider response never escapes as an exception', async () => {
  assert.deepEqual(await sendConfirmationEmail(recipient, env, { fetchImpl: async () => null }), { outcome: 'retry', reason: 'invalid-response', ambiguous: true });
});

test('invalid recipients do not call the provider', async () => {
  let calls = 0;
  for (const email of [null, {}, '', 'not-an-email', 'one@example.test\r\nBcc:two@example.test', 'one@example.test,two@example.test', '<one@example.test>', 'a'.repeat(250) + '@example.test']) {
    assert.deepEqual(await sendConfirmationEmail(email, env, { fetchImpl: async () => { calls++; return reply(accepted()); } }), { outcome: 'failed', reason: 'invalid-recipient', ambiguous: false });
  }
  assert.equal(calls, 0);
});
