import { confirmationEmailReady, sendConfirmationEmail } from './confirmation-email.mjs';

export const CONFIRMATION_DISPATCH_PATH = '/api/waitlist-confirmations/dispatch';
export const SITES_CONFIRMATION_DISPATCH_URL = 'https://restroom-ready-nyc.clcii.chatgpt.site' + CONFIRMATION_DISPATCH_PATH;

export function confirmationDispatchReady(env) {
  return confirmationEmailReady(env) && typeof env?.WAITLIST_DISPATCH_SECRET === 'string'
    && /^[a-f0-9]{64}$/.test(env.WAITLIST_DISPATCH_SECRET);
}

export async function confirmationClientKey(clientIP, env) {
  if (!confirmationDispatchReady(env)) return '';
  const ip = typeof clientIP === 'string' && clientIP.length <= 80 ? clientIP : 'unknown';
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(env.WAITLIST_DISPATCH_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(ip))), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function drainConfirmations(store, env, { send = sendConfirmationEmail, now = Date.now, limit = 2 } = {}) {
  const counts = { processed: 0, accepted: 0, pending: 0, failed: 0, uncertain: 0 };
  if (!confirmationDispatchReady(env)) return counts;
  const maximum = Number.isInteger(limit) ? Math.max(0, Math.min(2, limit)) : 2;
  for (let index = 0; index < maximum; index++) {
    const job = await store.claim(now());
    if (!job) break;
    let result;
    try { result = await send(job.email, env); }
    catch { result = { outcome: 'retry', reason: 'network', ambiguous: true }; }
    const completed = await store.complete(job, result, now());
    if (!completed) continue;
    counts.processed++;
    if (result.ambiguous) counts.uncertain++;
    else if (result.outcome === 'accepted') counts.accepted++;
    else if (result.outcome === 'retry' && job.attempts < 3) counts.pending++;
    else counts.failed++;
  }
  return counts;
}

function authorized(request, env) {
  const secret = env?.WAITLIST_DISPATCH_SECRET;
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) return false;
  const provided = request.headers.get('Authorization') ?? '';
  const expected = 'Bearer ' + secret;
  let mismatch = provided.length ^ expected.length;
  for (let index = 0; index < expected.length; index++) mismatch |= (provided.charCodeAt(index) || 0) ^ expected.charCodeAt(index);
  return mismatch === 0;
}

export async function confirmationDispatchResponse(request, store, env) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
  if (!authorized(request, env)) return new Response('{"error":"Not found"}', { status: 404, headers });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...headers, Allow: 'POST' } });
  if (!confirmationDispatchReady(env)) return new Response('{"error":"Email dispatch unavailable"}', { status: 503, headers });
  try { return new Response(JSON.stringify(await drainConfirmations(typeof store === 'function' ? store() : store, env)), { headers }); }
  catch { return new Response('{"error":"Email dispatch unavailable"}', { status: 503, headers }); }
}

// One process coordinates both existing durable stores. The fixed authenticated
// Sites endpoint exposes counts only; no recipient or token is returned.
export function startConfirmationDispatcher(store, env, { fetchImpl = globalThis.fetch, intervalMs = 30_000 } = {}) {
  if (!confirmationDispatchReady(env)) return { stop() {}, async run() {} };
  let running = false;
  let stopped = false;
  async function run() {
    if (running || stopped) return;
    running = true;
    try { await drainConfirmations(store, env); }
    catch { /* A local store failure must not block the independent Sites store. */ }
    try {
      const response = await fetchImpl(SITES_CONFIRMATION_DISPATCH_URL, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(22_000),
        headers: { Authorization: 'Bearer ' + env.WAITLIST_DISPATCH_SECRET },
      });
      try { await response.body?.cancel(); } catch { /* Counts are not needed by the timer. */ }
    } catch { /* Durable pending jobs remain available on a later timer tick. */ }
    finally { running = false; }
  }
  const timer = setInterval(() => { void run(); }, Math.max(30_000, intervalMs));
  timer.unref?.();
  void run();
  return { run, stop() { stopped = true; clearInterval(timer); } };
}
