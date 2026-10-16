// Server-only Cloudflare Email Sending adapter. Never log its input or response:
// the configuration contains a bearer token and provider bodies contain addresses.
const SENDER = 'welcome@nyc.imfinethanku.me';
const DEMO_URL = 'https://nyc.imfinethanku.me/demo/';
const MAX_RESPONSE_BYTES = 16_384;
const MAX_TIMEOUT_MS = 10_000;
const SUBJECT = "You're on the Restroom Ready waitlist";
const TEXT = [
  "You're on the waitlist.",
  '',
  'Thanks for joining Restroom Ready. We saved your signup.',
  `Try the public demo: ${DEMO_URL}`,
  '',
  'Know before you go.',
  "If you didn't request this signup, you can ignore this message.",
].join('\n');
const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Restroom Ready</title></head><body><h1>You're on the waitlist.</h1><p>Thanks for joining Restroom Ready. We saved your signup.</p><p><a href="${DEMO_URL}">Try the public demo</a></p><p>Know before you go.</p><p>If you didn't request this signup, you can ignore this message.</p></body></html>`;
const result = (outcome, reason, ambiguous = false) => ({ outcome, reason, ambiguous });

function configuration(env) {
  const accountID = env?.CLOUDFLARE_ACCOUNT_ID;
  const token = env?.CLOUDFLARE_EMAIL_API_TOKEN;
  const from = env?.WAITLIST_EMAIL_FROM;
  if ([accountID, token, from].every(value => value == null || value === '')) return { state: 'missing' };
  if (typeof accountID !== 'string' || !/^[a-f0-9]{32}$/i.test(accountID)
    || typeof token !== 'string' || token.length < 20 || token.length > 2048
    || !/^[A-Za-z0-9._~+/-]+=*$/.test(token) || from !== SENDER) return { state: 'invalid' };
  return { state: 'ready', accountID: accountID.toLowerCase(), token };
}

export function confirmationEmailReady(env) {
  return configuration(env).state === 'ready';
}

function recipientAddress(value) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || /[<>(),;:"\\]/.test(normalized)
    || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(normalized)) return null;
  return normalized;
}

function cancelBody(response) {
  try { response.body?.cancel().catch(() => {}); } catch { /* No provider details leave the adapter. */ }
}

async function boundedJson(response, signal) {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength != null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)) {
    cancelBody(response);
    throw new Error('Invalid provider response');
  }
  if (!response.body) throw new Error('Invalid provider response');
  const reader = response.body.getReader();
  const onAbort = () => { try { reader.cancel().catch(() => {}); } catch { /* Best-effort cancellation. */ } };
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Invalid provider response');
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid provider response');
    return body;
  } catch {
    try { reader.cancel().catch(() => {}); } catch { /* Cancellation is best-effort. */ }
    throw new Error('Invalid provider response');
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

function codedFailure(body) {
  if (!Array.isArray(body.errors) || body.errors.length === 0 || body.errors.length > 10) return null;
  const codes = body.errors.map(error => error?.code);
  if (codes.some(code => [10000, 10101, 10102, 10103, 10105, 10203].includes(code))) return result('failed', 'invalid-config');
  if (codes.some(code => [10001, 10200, 10201, 10202].includes(code))) return result('failed', 'invalid-request');
  if (codes.includes(10004)) return result('retry', 'rate-limited');
  if (codes.some(code => [10002, 10003, 10100].includes(code))) return result('retry', 'provider-unavailable');
  return null;
}

function deliveryResult(body, recipient) {
  if (body.success !== true) return codedFailure(body) ?? result('retry', 'invalid-response', true);
  if (body.errors != null && (!Array.isArray(body.errors) || body.errors.length > 0)) return result('retry', 'invalid-response', true);
  const data = body.result;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return result('retry', 'invalid-response', true);
  const groups = {};
  for (const key of ['delivered', 'queued', 'permanent_bounces', 'suppressed_recipients']) {
    const values = key === 'suppressed_recipients' && data[key] == null ? [] : data[key];
    if (!Array.isArray(values) || values.length > 50) return result('retry', 'invalid-response', true);
    const addresses = values.map(recipientAddress);
    if (addresses.some(address => address !== recipient)) return result('retry', 'invalid-response', true);
    groups[key] = addresses;
  }
  if (groups.permanent_bounces.length) return result('failed', 'permanent-bounce');
  if (groups.suppressed_recipients.length) return result('failed', 'recipient-suppressed');
  if (groups.delivered.length + groups.queued.length !== 1) return result('retry', 'invalid-response', true);
  return result('accepted', groups.delivered.length ? 'delivered' : 'queued');
}

/**
 * One receipt send attempt. The caller owns durable outbox state and retries.
 * An ambiguous retry can duplicate a message if the provider accepted it before
 * the connection failed; this endpoint has no documented idempotency guarantee.
 * Results contain fixed reason codes only, never addresses or provider messages.
 */
export async function sendConfirmationEmail(email, env, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const config = configuration(env);
  if (config.state === 'missing') return result('unconfigured', 'not-configured');
  if (config.state !== 'ready') return result('failed', 'invalid-config');
  const recipient = recipientAddress(email);
  if (!recipient) return result('failed', 'invalid-recipient');
  if (typeof fetchImpl !== 'function') return result('failed', 'invalid-config');
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, MAX_TIMEOUT_MS) : 8000;
  const controller = new AbortController();
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve(result('retry', 'timeout', true)); }, duration);
  });
  const attempt = (async () => {
    let response;
    try {
      response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${config.accountID}/email/sending/send`, {
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recipient, from: SENDER, subject: SUBJECT, text: TEXT, html: HTML }),
        signal: controller.signal,
      });
    } catch {
      return result('retry', controller.signal.aborted ? 'timeout' : 'network', true);
    }
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      cancelBody(response);
      return result('failed', 'invalid-config');
    }
    if (response.status === 429) { cancelBody(response); return result('retry', 'rate-limited'); }
    if (response.status >= 500) { cancelBody(response); return result('retry', 'provider-unavailable'); }
    if (response.status === 408) { cancelBody(response); return result('retry', 'provider-unavailable', true); }
    if (!response.ok) { cancelBody(response); return result('failed', 'invalid-request'); }
    try { return deliveryResult(await boundedJson(response, controller.signal), recipient); }
    catch { return result('retry', controller.signal.aborted ? 'timeout' : 'invalid-response', true); }
  })().catch(() => result('retry', controller.signal.aborted ? 'timeout' : 'invalid-response', true));
  try { return await Promise.race([attempt, timeout]); }
  finally { clearTimeout(timer); }
}
