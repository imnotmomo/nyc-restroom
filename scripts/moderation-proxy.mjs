/** Local preview only; production Caddy routes directly to the loopback service. */
export async function moderationProxy(request, response) {
  if (!request.url?.startsWith('/api/moderation/')) return false;
  if (!['GET', 'POST'].includes(request.method)) {
    response.writeHead(405, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ error: 'method_not_allowed' })); return true;
  }
  try {
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 2048) throw Error('invalid_request'); chunks.push(chunk); }
    const headers = {};
    for (const key of ['authorization', 'content-type', 'origin', 'accept']) if (typeof request.headers[key] === 'string') headers[key] = request.headers[key];
    const result = await fetch('http://127.0.0.1:3003' + request.url, { method: request.method, headers,
      body: request.method === 'POST' ? Buffer.concat(chunks) : undefined, redirect: 'error', signal: AbortSignal.timeout(18_000) });
    response.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    response.writeHead(error.message === 'invalid_request' ? 400 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ error: error.message === 'invalid_request' ? 'invalid_request' : 'moderation_unavailable' }));
  }
  return true;
}
