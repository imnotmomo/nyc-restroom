import { createServer } from 'node:http';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DELETION_POLICY_VERSION, ServiceError, requestToken, responseFor, validateBody } from './policy.mjs';
import { createDeletionService } from './service.mjs';
import { productionRuntime } from './runtime.mjs';
import { pruneCompletedReceipts } from './lease.mjs';

export async function minimumPolicyVersion(path = '/etc/restroom-ready-account/minimum-policy-version') {
  try {
    const value = (await readFile(path, 'utf8')).trim();
    const version = /^\d{1,9}$/u.test(value) ? Number(value) : null;
    return Number.isSafeInteger(version) && version >= 1 ? version : null;
  } catch { return null; }
}
import { recoveryWorker } from './recovery.mjs';
import { deleteApp } from 'firebase-admin/app';

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}

async function bodyFrom(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers['content-type'] ?? '')) {
    throw new ServiceError(400, 'invalid_request');
  }
  if (Number(request.headers['content-length'] ?? 0) > 256) throw new ServiceError(400, 'invalid_request');
  let body = '';
  for await (const chunk of request) {
    body += chunk.toString('utf8');
    if (Buffer.byteLength(body) > 256) throw new ServiceError(400, 'invalid_request');
  }
  try { const value = JSON.parse(body); validateBody(value); }
  catch { throw new ServiceError(400, 'invalid_request'); }
}

export function httpServer(deletion) {
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') return send(response, 200, { status: 'ok', policyVersion: DELETION_POLICY_VERSION, minimumPolicyVersion: await minimumPolicyVersion() });
      if (request.url !== '/api/account/delete') return send(response, 404, { error: 'not_found' });
      if (request.method !== 'POST') return send(response, 405, { error: 'method_not_allowed' });
      const token = requestToken(request.headers);
      await bodyFrom(request);
      const result = await deletion(token);
      send(response, 200, result);
    } catch (error) {
      const result = responseFor(error);
      if (!response.destroyed) send(response, result.status, result.body);
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  return server;
}

export async function start() {
  const runtime = await productionRuntime();
  const deletion = createDeletionService(runtime);
  const server = httpServer(deletion);
  await new Promise((resolveStarted, reject) => {
    server.once('error', reject);
    server.listen(3002, '127.0.0.1', resolveStarted);
  });
  // Only completed, expired receipts can be pruned; pending work is never expired.
  const timer = setInterval(() => { void pruneCompletedReceipts(runtime.db).catch(() => {}); }, 5 * 60_000);
  timer.unref();
  const recovery = recoveryWorker({ db: runtime.db, deletion });
  recovery.start();
  server.on('close', () => clearInterval(timer));
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    clearInterval(timer);
    const closed = new Promise(resolveClosed => server.close(resolveClosed));
    await recovery.stop(); await deletion.drain(); await closed;
    await runtime.db.terminate(); await deleteApp(runtime.app);
  };
  process.once('SIGTERM', () => { void stop().catch(() => { process.exitCode = 1; }); });
  process.once('SIGINT', () => { void stop().catch(() => { process.exitCode = 1; }); });
  process.stdout.write('Account deletion service listening on loopback port 3002.\n');
  return server;
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  start().catch(() => { process.stderr.write('Account deletion service could not start.\n'); process.exitCode = 1; });
}
