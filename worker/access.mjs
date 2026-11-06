const EXPIRED_FINDER_COOKIE = '__Host-rr-finder-access=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';

function legacyPaths(pathname) {
  const paths = [];
  let path = pathname;
  for (let step = 0; step < 5; step++) {
    const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
    paths.push(normalized);
    try { paths.push(new URL(normalized, 'https://route.invalid').pathname); } catch { /* Invalid URLs are handled by the static resolver. */ }
    let decoded;
    try { decoded = decodeURIComponent(path); } catch { break; }
    if (decoded === path) break;
    path = decoded;
  }
  return paths;
}

/** Old bookmarks remain useful; no shared passcode or access session is required. */
export function legacyFinderAccessResponse(request) {
  const paths = legacyPaths(new URL(request.url).pathname);
  const retiredEndpoint = paths.some(path => path.replace(/\/$/, '') === '/api/finder-access');
  const oldAccessPage = paths.some(path => path === '/access' || path.startsWith('/access/') || path.startsWith('/access.'));
  if (!retiredEndpoint && !oldAccessPage) return null;

  const headers = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Set-Cookie': EXPIRED_FINDER_COOKIE,
  };
  if (retiredEndpoint) {
    // Do not read or echo passcodes sent by an older browser bundle.
    return new Response(request.method === 'HEAD' ? null : JSON.stringify({ error: 'Shared finder access has been retired. Open /find/ directly.' }), {
      status: 410,
      headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
  return new Response(null, { status: 308, headers: { ...headers, Location: '/find/' } });
}
