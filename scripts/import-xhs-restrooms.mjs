/** Administrative XHS importer. Dry-run unless --apply is explicitly supplied. */
import { readFile, open, rename, unlink, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname, basename, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT, DATABASE, ROOT, XHSImportError, check, sha, stable, validateManifest, validInstant, buildPlan, dataOf } from './xhs-import-model.mjs';

async function exclusiveJSON(path, value) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
}
async function replaceJSON(path, value) {
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  try { await exclusiveJSON(temporary, value); await rename(temporary, path); } finally { await unlink(temporary).catch(() => {}); }
}
function parseArgs(argv) {
  const args = {}, values = new Set(['manifest', 'snapshot', 'report', 'evidence-root', 'firebase-tools-dir', 'expected-sha', 'expected-target-sha', 'review']);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : '';
    check((values.has(key) || key === 'apply') && !(key in args), 'Invalid or repeated import option.');
    if (key === 'apply') args.apply = true;
    else { check(argv[i + 1] && !argv[i + 1].startsWith('--'), 'Missing import option value.'); args[key] = argv[++i]; }
  }
  for (const key of ['manifest', 'snapshot', 'report', 'evidence-root', 'firebase-tools-dir']) { check(args[key], `Missing --${key}.`); args[key] = resolve(args[key]); }
  check(new Set([args.manifest, args.snapshot, args.report]).size === 3, 'Manifest, snapshot and report must be distinct files.');
  if (args.review) args.review = resolve(args.review);
  if (args.apply) check(args.review && /^[a-f0-9]{64}$/.test(args['expected-sha']) && /^[a-f0-9]{64}$/.test(args['expected-target-sha']), 'Apply requires manifest SHA, fresh target SHA and an independent review file.');
  return args;
}
export async function verifyCaptures(manifest, evidenceRoot) {
  const root = await realpath(evidenceRoot), inventory = new Map();
  for (const source of manifest.sources) for (const capture of source.captures) {
    const path = await realpath(resolve(root, capture.file));
    check(path.startsWith(root + sep), 'Screenshot reference escapes the evidence directory.');
    const fileHash = sha(await readFile(path));
    check(fileHash === capture.sha256, 'Native screenshot hash differs from reviewed evidence.');
    check(!inventory.has(capture.file) || inventory.get(capture.file) === fileHash, 'Capture hashes disagree across sources.');
    inventory.set(capture.file, fileHash);
  }
  return sha(stable([...inventory].sort(([a], [b]) => a.localeCompare(b))));
}
export function validateReview(review, manifest, manifestHash, captureDigest, targetDigest, now = new Date()) {
  check(review && Object.keys(review).sort().join(',') === ['reviewer', 'reviewedAt', 'verdict', 'manifestHash', 'captureDigest', 'targetDigest', 'eligibilityPolicy'].sort().join(',')
    && typeof review.reviewer === 'string' && review.reviewer.trim().length >= 3 && !/^(?:self|importer)$/i.test(review.reviewer.trim())
    && validInstant(review.reviewedAt) && Date.parse(review.reviewedAt) <= now.getTime()
    && now.getTime() - Date.parse(review.reviewedAt) <= 86400000 && review.verdict === 'approved'
    && review.manifestHash === manifestHash && review.captureDigest === captureDigest && review.targetDigest === targetDigest
    && review.eligibilityPolicy === manifest.eligibilityPolicy, 'Independent review is absent, stale, rejected or bound to different evidence/targets.');
}
async function firebaseStore(directory) {
  const require = createRequire(pathToFileURL(resolve(directory, 'package.json')));
  const auth = require('./lib/auth.js'), { requireAuth } = require('./lib/requireAuth.js'), { Client } = require('./lib/apiv2.js');
  const account = auth.getGlobalDefaultAccount(); check(account, 'Use the configured Firebase CLI login first.');
  const options = { project: PROJECT }; auth.setActiveAccount(options, account); await requireAuth(options);
  const api = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
  const database = (await api.get(`/projects/${PROJECT}/databases/${DATABASE}`)).body;
  check(database.name === `projects/${PROJECT}/databases/${DATABASE}` && database.databaseEdition === 'STANDARD', 'Unexpected Firestore identity or edition.');
  return {
    databaseIdentity: { name: database.name, databaseEdition: database.databaseEdition },
    get: async path => { try { return (await api.get(`/${ROOT}/${path}`)).body; } catch (error) {
      if (error.status === 404 || error.context?.response?.statusCode === 404 || error.context?.body?.error?.code === 404) return null; throw error;
    } },
    list: async path => {
      const documents = []; let pageToken;
      do { const body = (await api.get(`/${ROOT}/${path}`, { queryParams: { pageSize: 1000, ...(pageToken ? { pageToken } : {}) } })).body;
        check(!body.documents || Array.isArray(body.documents), 'Unexpected collection response.'); documents.push(...body.documents ?? []);
        check(documents.length <= 100000, 'Collection exceeds snapshot bound.'); pageToken = body.nextPageToken;
      } while (pageToken); return documents;
    },
    commit: writes => api.post(`/${ROOT}:commit`, { writes }),
  };
}
export async function run(argv = process.argv.slice(2), dependencies = {}) {
  let report, reportPath, stage = 'validation', reportCreated = false;
  try {
    const args = parseArgs(argv); reportPath = args.report;
    const manifestText = await readFile(args.manifest, 'utf8'); check(Buffer.byteLength(manifestText) <= 20000000, 'Manifest exceeds safe size.');
    const manifestHash = sha(manifestText), manifest = JSON.parse(manifestText); validateManifest(manifest);
    check(!args.apply || args['expected-sha'] === manifestHash, 'Manifest SHA differs from independent review.');
    stage = 'evidence-verification'; const captureDigest = await verifyCaptures(manifest, args['evidence-root']);
    const city = dependencies.city ?? JSON.parse(await readFile(new URL('../data/nyc-restrooms/restrooms.json', import.meta.url), 'utf8')).restrooms;
    check(Array.isArray(city), 'Invalid city inventory.');
    stage = 'authentication'; const store = dependencies.store ?? await firebaseStore(args['firebase-tools-dir']);
    check(store.databaseIdentity?.name === `projects/${PROJECT}/databases/${DATABASE}` && store.databaseIdentity.databaseEdition === 'STANDARD', 'Unexpected database identity or edition.');
    stage = 'target-review'; const plan = await buildPlan(manifest, manifestHash, captureDigest, store, city);
    if (args.apply) {
      check(args['expected-target-sha'] === plan.targetDigest, 'Fresh target state differs from reviewed dry run; rerun independent review.');
      validateReview(JSON.parse(await readFile(args.review, 'utf8')), manifest, manifestHash, captureDigest, plan.targetDigest);
    }
    stage = 'snapshot';
    await exclusiveJSON(args.snapshot, { project: PROJECT, database: DATABASE, batchID: manifest.batchID, eligibilityPolicy: manifest.eligibilityPolicy,
      capturedAt: new Date().toISOString(), manifestHash, captureDigest, targetDigest: plan.targetDigest,
      databaseIdentity: store.databaseIdentity, targetSnapshot: plan.targetSnapshot, queryInventory: plan.queryInventory });
    report = { project: PROJECT, database: DATABASE, batchID: manifest.batchID, eligibilityPolicy: manifest.eligibilityPolicy,
      mode: args.apply ? 'apply' : 'dry-run', status: 'planned', manifestHash, captureDigest, targetDigest: plan.targetDigest,
      startedAt: new Date().toISOString(), counts: plan.counts, codeTargets: plan.codeTargets,
      plannedPaths: plan.groups.flat().map(write => write.update.name.slice(ROOT.length + 1)), committedPaths: [], pendingBatchPaths: [], batchesCommitted: 0 };
    await exclusiveJSON(args.report, report); reportCreated = true;
    if (args.apply) {
      stage = 'commit'; let batch = [];
      const flush = async () => {
        if (!batch.length) return;
        report.status = 'applying'; report.pendingBatchPaths = batch.map(write => write.update.name.slice(ROOT.length + 1)); await replaceJSON(args.report, report);
        await store.commit(batch); report.committedPaths.push(...report.pendingBatchPaths); report.pendingBatchPaths = []; report.batchesCommitted++; await replaceJSON(args.report, report); batch = [];
      };
      for (const group of plan.groups) { if (batch.length + group.length > 300) await flush(); batch.push(...group); } await flush();
      stage = 'readback';
      // Replanning validates immutable payloads, preserves changed ratings/checks, and must produce zero writes.
      const replay = await buildPlan(manifest, manifestHash, captureDigest, store, city);
      check(replay.groups.length === 0, 'Post-apply replay still plans writes; reconcile the private report.');
      report.readback = { zeroWriteReplay: true, replayTargetDigest: replay.targetDigest };
      report.status = 'complete';
    }
    report.completedAt = new Date().toISOString(); await replaceJSON(args.report, report);
    (dependencies.log ?? console.log)(JSON.stringify({ project: PROJECT, database: DATABASE, batchID: manifest.batchID, mode: report.mode, status: report.status,
      eligibilityPolicy: manifest.eligibilityPolicy, manifestHash, captureDigest, targetDigest: plan.targetDigest, ...plan.counts, committedWrites: report.committedPaths.length }));
    return report;
  } catch (error) {
    if (reportCreated) {
      report.status = report.pendingBatchPaths.length ? 'commit-outcome-unknown' : 'failed'; report.failedStage = stage;
      report.requiresReconciliation = stage === 'commit' || stage === 'readback' || report.committedPaths.length > 0;
      report.error = error instanceof XHSImportError ? error.message : 'Provider error omitted to protect credentials and source text.';
      await replaceJSON(reportPath, report).catch(() => {});
    }
    throw new XHSImportError(error instanceof XHSImportError ? error.message : `XHS import failed during ${stage}; raw provider details are omitted.`);
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) run().catch(error => { console.error(error.message); process.exitCode = 1; });
