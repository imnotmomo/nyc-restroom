import { createServer } from 'node:http';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { deleteApp } from 'firebase-admin/app';
import { ModerationError, ORIGIN, requireValue } from './policy.mjs';
import { createModerationService } from './service.mjs';
import { productionRuntime } from './runtime.mjs';

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  response.end(JSON.stringify(body));
}
async function jsonBody(request) {
  requireValue(/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers['content-type'] ?? ''));
  requireValue(!request.headers['content-encoding'] && Number(request.headers['content-length'] ?? 0) <= 2048);
  let body = '';
  for await (const chunk of request) { body += chunk.toString('utf8'); requireValue(Buffer.byteLength(body) <= 2048); }
  try { return JSON.parse(body); } catch { throw new ModerationError(400, 'invalid_request'); }
}
export function httpServer(service, { allowedOrigin = ORIGIN } = {}) {
  return createServer({ maxHeaderSize: 12_288, requestTimeout: 20_000, headersTimeout: 10_000 }, async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') return send(response, 200, { status: 'ok' });
      const url = new URL(request.url, 'http://127.0.0.1');
      requireValue(url.pathname.startsWith('/api/moderation/'), 404, 'not_found');
      requireValue(request.headers.origin === undefined || request.headers.origin === allowedOrigin, 403, 'moderator_required');
      const auth = request.headers.authorization;
      requireValue(typeof auth === 'string' && /^Bearer [A-Za-z0-9._-]{1,8192}$/u.test(auth), 401, 'authentication_required');
      const token = auth.slice(7);
      const params = Object.fromEntries(url.searchParams);
      requireValue([...url.searchParams.keys()].every(k => ['status', 'limit', 'cursor'].includes(k))
        && [...url.searchParams.keys()].length === Object.keys(params).length);
      let result;
      if (request.method === 'GET' && url.pathname === '/api/moderation/session') {
        requireValue(Object.keys(params).length === 0); result = await service.session(token);
      } else if (request.method === 'GET' && url.pathname === '/api/moderation/contribution-status') {
        requireValue(Object.keys(params).length === 0); result = await service.contributionStatus(token);
      } else if (request.method === 'GET' && url.pathname === '/api/moderation/requests') result = await service.requests(token, params);
      else if (request.method === 'GET' && url.pathname === '/api/moderation/reports') result = await service.reports(token, params);
      else if (request.method === 'POST' && url.pathname === '/api/moderation/reports') {
        requireValue(Object.keys(params).length === 0); result = await service.reportContent(token, await jsonBody(request));
      }
      else if (request.method === 'GET' && url.pathname === '/api/moderation/comments') {
        requireValue(!Object.hasOwn(params, 'status')); result = await service.comments(token, params);
      } else {
        requireValue(request.method === 'POST', 405, 'method_not_allowed');
        requireValue(Object.keys(params).length === 0);
        const parts = url.pathname.split('/').map(part => decodeURIComponent(part));
        if (parts.length === 6 && parts[3] === 'requests' && parts[5] === 'decision') {
          result = await service.decide(token, parts[4], await jsonBody(request));
        } else if (parts.length === 6 && parts[3] === 'reports' && parts[5] === 'resolve') {
          result = await service.resolveReport(token, parts[4], await jsonBody(request));
        } else if (parts.length === 8 && parts[3] === 'comments' && parts[7] === 'remove') {
          result = await service.remove(token, parts[4], parts[5], parts[6], await jsonBody(request));
        } else throw new ModerationError(404, 'not_found');
      }
      send(response, 200, result);
    } catch (error) {
      const known = error instanceof ModerationError;
      if (!response.destroyed) send(response, known ? error.status : 503, { error: known ? error.code : 'moderation_unavailable' });
    }
  });
}
export async function start() {
  const runtime = await productionRuntime();
  const service = createModerationService(runtime), server = httpServer(service);
  await new Promise((resolveStarted, reject) => { server.once('error', reject); server.listen(3003, '127.0.0.1', resolveStarted); });
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    await new Promise(resolveClosed => server.close(resolveClosed));
    await runtime.db.terminate(); await deleteApp(runtime.app);
  };
  process.once('SIGTERM', () => { void stop().catch(() => { process.exitCode = 1; }); });
  process.once('SIGINT', () => { void stop().catch(() => { process.exitCode = 1; }); });
  process.stdout.write('Moderation service listening on loopback port 3003.\n');
  return server;
}
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  start().catch(() => { process.stderr.write('Moderation service could not start.\n'); process.exitCode = 1; });
}
