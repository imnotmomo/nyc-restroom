export const FINDER_ACCESS_COOKIE = '__Host-rr-finder-access';
export const FINDER_ACCESS_SECONDS = 8 * 60 * 60;
const ACCESS_BODY_LIMIT = 1024;
const ACCESS_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const ACCESS_ATTEMPT_LIMIT = 10;
const ACCESS_BUCKET_LIMIT = 1000;
const accessEncoder = new TextEncoder();
const accessDecoder = new TextDecoder();
class AccessBodyLimitError extends Error {}

async function accessReadBoundedBody(request) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > ACCESS_BODY_LIMIT) {
        void reader.cancel().catch(() => {});
        throw new AccessBodyLimitError();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function accessBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function accessDecodeBase64(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid access token.');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), character => character.charCodeAt(0));
}

async function accessDigest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', accessEncoder.encode(value)));
}

function accessEqual(left, right) {
  let difference = left.length ^ right.length;
  // Every passcode digest has the same fixed size; comparison never exits early.
  for (let index = 0; index < 32; index++) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

function accessConfiguration(env) {
  return typeof env?.FINDER_ACCESS_PASSCODE === 'string' && env.FINDER_ACCESS_PASSCODE.length > 0
    && env.FINDER_ACCESS_PASSCODE.length <= 128 && env.FINDER_ACCESS_PASSCODE.trim().length > 0
    && typeof env.FINDER_ACCESS_SECRET === 'string' && env.FINDER_ACCESS_SECRET.length >= 32
    && env.FINDER_ACCESS_SECRET.length <= 1024;
}

function accessCookie(value, lifetime = FINDER_ACCESS_SECONDS) {
  return `${FINDER_ACCESS_COOKIE}=${value}; Path=/; Max-Age=${lifetime}; HttpOnly; Secure; SameSite=Lax`;
}

function accessReadCookie(request) {
  const cookies = request.headers.get('Cookie') ?? '';
  if (cookies.length > 8192) return null;
  const matches = cookies.split(';').map(value => value.trim()).filter(value => value.startsWith(`${FINDER_ACCESS_COOKIE}=`));
  // Ambiguous duplicate cookies are not an authenticated session.
  return matches.length === 1 ? matches[0].slice(FINDER_ACCESS_COOKIE.length + 1) : null;
}

export function privateFinderResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.delete('ETag');
  headers.delete('Last-Modified');
  const vary = (headers.get('Vary') ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (!vary.some(value => value.toLowerCase() === 'cookie')) vary.push('Cookie');
  headers.set('Vary', vary.join(', '));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function accessJSON(body, status = 200, extraHeaders = {}) {
  return privateFinderResponse(new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...extraHeaders },
  }));
}

function accessPaths(pathname) {
  const paths = [];
  let path = pathname;
  for (let step = 0; step < 5; step++) {
    const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
    paths.push(normalized);
    try { paths.push(new URL(normalized, 'https://route.invalid').pathname); } catch { /* The static resolver will reject invalid URLs. */ }
    let decoded;
    try { decoded = decodeURIComponent(path); } catch { break; }
    if (decoded === path) break;
    path = decoded;
  }
  return paths;
}

/** Classify more strictly than the static resolver, including encoded/RSC aliases. */
export function isFinderResource(pathname) {
  return accessPaths(pathname).some(path => path === '/find' || path.startsWith('/find/') || path.startsWith('/find.'));
}

export function isFinderAccessPage(pathname) {
  return accessPaths(pathname).some(path => path === '/access' || path.startsWith('/access/') || path.startsWith('/access.'));
}

function accessPayloadRequest(request) {
  return request.headers.get('RSC') === '1' || request.headers.has('Next-Router-State-Tree')
    || request.headers.get('Accept')?.includes('text/x-component')
    || accessPaths(new URL(request.url).pathname).some(path => /\.(?:txt|rsc)(?:\/|$)/.test(path) || path.includes('__next'));
}

export function createFinderAccessGate({ now = () => Date.now() } = {}) {
  const buckets = new Map();

  async function signingKey(env) {
    return crypto.subtle.importKey('raw', accessEncoder.encode(env.FINDER_ACCESS_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  }

  async function signingMessage(payload, env) {
    // Passcode rotation invalidates cookies without exposing its digest in the cookie.
    return accessEncoder.encode(`${payload}.${accessBase64(await accessDigest(env.FINDER_ACCESS_PASSCODE))}`);
  }

  async function authorized(request, env) {
    if (!accessConfiguration(env)) return false;
    const token = accessReadCookie(request);
    if (!token || token.length > 2048) return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    try {
      const payload = JSON.parse(accessDecoder.decode(accessDecodeBase64(parts[0])));
      const seconds = Math.floor(now() / 1000);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || Object.keys(payload).length !== 4 || payload.v !== 1 || payload.aud !== new URL(request.url).origin
        || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
        || payload.iat > seconds || payload.exp <= seconds || payload.exp - payload.iat !== FINDER_ACCESS_SECONDS) return false;
      return await crypto.subtle.verify('HMAC', await signingKey(env), accessDecodeBase64(parts[1]), await signingMessage(parts[0], env));
    } catch { return false; }
  }

  async function rateBucket(request, env) {
    const timestamp = now();
    for (const [key, value] of buckets) if (value.expires <= timestamp) buckets.delete(key);
    // Only trusted runtime information is supplied by Node; edge IP headers are platform-owned.
    const identity = env?.FINDER_ACCESS_CLIENT_IP ?? request.headers.get('CF-Connecting-IP') ?? 'unknown-client';
    const key = accessBase64(await accessDigest(String(identity).slice(0, 256)));
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= ACCESS_BUCKET_LIMIT) buckets.delete(buckets.keys().next().value);
      bucket = { count: 0, expires: timestamp + ACCESS_FAILURE_WINDOW_MS };
      buckets.set(key, bucket);
    }
    return { key, bucket };
  }

  async function handle(request, env) {
    if (!['POST', 'DELETE'].includes(request.method)) return accessJSON({ error: 'Use the access form.' }, 405, { Allow: 'POST, DELETE' });
    const origin = new URL(request.url).origin;
    if (request.headers.get('Origin') !== origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return accessJSON({ error: 'Submit the access form from this site.' }, 403);
    if (!accessConfiguration(env)) return accessJSON({ error: 'Finder access is not configured. Please try the demo or return later.' }, 503);
    if (request.method === 'DELETE') return accessJSON({ ok: true }, 200, { 'Set-Cookie': accessCookie('', 0) });
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return accessJSON({ error: 'Use the access form with JavaScript enabled.' }, 415);
    let input;
    try {
      const declared = Number(request.headers.get('Content-Length'));
      if (Number.isFinite(declared) && declared > ACCESS_BODY_LIMIT) return accessJSON({ error: 'This request is too large.' }, 413);
      const body = await accessReadBoundedBody(request);
      input = JSON.parse(body);
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1
        || typeof input.passcode !== 'string' || !input.passcode || input.passcode.length > 128) return accessJSON({ error: 'Enter the finder passcode.' }, 400);
    } catch (error) {
      return error instanceof AccessBodyLimitError ? accessJSON({ error: 'This request is too large.' }, 413)
        : accessJSON({ error: 'Enter the finder passcode.' }, 400);
    }
    const { key, bucket } = await rateBucket(request, env);
    if (bucket.count >= ACCESS_ATTEMPT_LIMIT) return accessJSON({ error: 'Too many attempts. Try again in a few minutes.' }, 429, { 'Retry-After': String(Math.max(1, Math.ceil((bucket.expires - now()) / 1000))) });
    // Reserve attempts before asynchronous digest work, including concurrent requests.
    bucket.count += 1;
    if (!accessEqual(await accessDigest(input.passcode), await accessDigest(env.FINDER_ACCESS_PASSCODE))) return accessJSON({ error: 'Incorrect passcode.' }, 401);
    buckets.delete(key);
    const seconds = Math.floor(now() / 1000);
    const payload = accessBase64(accessEncoder.encode(JSON.stringify({ v: 1, iat: seconds, exp: seconds + FINDER_ACCESS_SECONDS, aud: origin })));
    const signature = accessBase64(await crypto.subtle.sign('HMAC', await signingKey(env), await signingMessage(payload, env)));
    return accessJSON({ ok: true }, 200, { 'Set-Cookie': accessCookie(`${payload}.${signature}`) });
  }

  async function protect(request, env) {
    if (!accessConfiguration(env)) return accessJSON({ error: 'Finder access is not configured. Please try the demo or return later.' }, 503);
    if (!['GET', 'HEAD'].includes(request.method)) return accessJSON({ error: 'Method not allowed.' }, 405, { Allow: 'GET, HEAD' });
    if (await authorized(request, env)) return null;
    if (accessPayloadRequest(request)) return accessJSON({ error: 'Finder access is required.' }, 401);
    return privateFinderResponse(new Response(null, { status: 303, headers: { Location: '/access/' } }));
  }

  return { handle, protect, authorized };
}

export const finderAccess = createFinderAccessGate();
