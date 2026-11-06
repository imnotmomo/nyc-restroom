/** Reviewed, preconditioned updates restricted to public restroom research profiles. */
import { open, readFile, rename, unlink, mkdir, lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PROJECT, DATABASE, ROOT, ResearchError, check, sha } from './research-map-model.mjs';
import { buildHoursTargets, checkedHoursPath, hoursTargetMatches, planHoursImport } from './hours-research-model.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const privateRoot = resolve(repository, '.firebase-agent');
function argsOf(argv) {
  const [mode, ...tail] = argv, args = { mode };
  check(['preview', 'apply', 'verify'].includes(mode), 'Choose preview, apply or read-only verify.');
  const allowed = new Set(['findings', 'inventory', 'preimages', 'snapshot', 'report', 'firebase-tools-dir', 'config-dir', 'expected-sha', 'expected-plan-sha']);
  for (let i = 0; i < tail.length; i += 2) {
    const key = tail[i]?.startsWith('--') ? tail[i].slice(2) : '';
    check(allowed.has(key) && !Object.hasOwn(args, key) && tail[i + 1] && !tail[i + 1].startsWith('--'), 'Invalid hours importer arguments.');
    args[key] = tail[i + 1];
  }
  check(['findings', 'inventory', 'preimages', 'snapshot', 'report'].every(key => args[key]), 'Missing hours importer paths.');
  if (mode === 'apply') check(/^[a-f0-9]{64}$/.test(args['expected-sha'] ?? '') && /^[a-f0-9]{64}$/.test(args['expected-plan-sha'] ?? ''),
    'Apply requires the reviewed packet SHA and fresh preview-plan SHA.');
  for (const key of ['findings', 'inventory', 'preimages', 'snapshot', 'report']) args[key] = resolve(args[key]);
  check(new Set(['findings', 'inventory', 'preimages', 'snapshot', 'report'].map(key => args[key])).size === 5, 'Inputs and exclusive outputs must differ.');
  args['firebase-tools-dir'] = resolve(args['firebase-tools-dir'] ?? '/opt/homebrew/lib/node_modules/firebase-tools');
  args['config-dir'] = resolve(args['config-dir'] ?? resolve(privateRoot, 'config'));
  return args;
}
async function privateOutput(path) {
  const rel = relative(privateRoot, path);
  check(rel && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('/'), 'Operational backups and receipts must stay in ignored .firebase-agent.');
  const parents = []; for (let p = dirname(path); p !== repository; p = dirname(p)) parents.push(p);
  for (const parent of parents.reverse()) {
    await mkdir(parent, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const stat = await lstat(parent); check(stat.isDirectory() && !stat.isSymbolicLink(), 'Private output ancestor is not a real directory.');
  }
}
async function saveNew(path, value) {
  await privateOutput(path);
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); }
  finally { await file.close(); }
}
async function receiptAt(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  try { await saveNew(temporary, value); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => {}); }
}
async function storeFor(cliDirectory, configDirectory) {
  process.env.XDG_CONFIG_HOME = configDirectory;
  const require = createRequire(pathToFileURL(resolve(cliDirectory, 'package.json')));
  const auth = require('./lib/auth.js'), { requireAuth } = require('./lib/requireAuth.js'), { Client } = require('./lib/apiv2.js');
  const account = auth.getGlobalDefaultAccount(); check(account, 'Use the existing authorized Firebase CLI login.');
  const options = { project: PROJECT }; auth.setActiveAccount(options, account); await requireAuth(options);
  const api = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
  const database = (await api.get(`/projects/${PROJECT}/databases/${DATABASE}`)).body;
  check(database.name === `projects/${PROJECT}/databases/${DATABASE}` && database.databaseEdition === 'STANDARD', 'Unexpected database identity or edition.');
  return { async get(path) {
    checkedHoursPath(path);
    const [collection, id] = path.split('/');
    try { return (await api.get(`/${ROOT}/${collection}/${encodeURIComponent(id)}`)).body; }
    catch (error) { if (error.status === 404 || error.context?.response?.statusCode === 404 || error.context?.body?.error?.code === 404) return null; throw error; }
  }, async commit(writes) {
    for (const write of writes) {
      check(write.update?.name?.startsWith(`${ROOT}/`), 'Foreign hours write target.');
      checkedHoursPath(write.update.name.slice(ROOT.length + 1), true);
    }
    await api.post(`/${ROOT}:commit`, { writes });
  } };
}
function batchesOf(writes) {
  const batches = []; let batch = [], bytes = 100;
  for (const write of writes) {
    check(write.update.name.startsWith(`${ROOT}/`), 'Foreign hours write target.');
    checkedHoursPath(write.update.name.slice(ROOT.length + 1), true);
    const size = Buffer.byteLength(JSON.stringify(write)); check(size < 500_000, 'Hours write exceeds its safe bound.');
    if (batch.length && (batch.length >= 100 || bytes + size > 5_000_000)) { batches.push(batch); batch = []; bytes = 100; }
    batch.push(write); bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
export async function run(argv = process.argv.slice(2), dependencies = {}) {
  let args, receipt, receiptCreated = false, stage = 'validation';
  try {
    args = argsOf(argv);
    await privateOutput(args.snapshot); await privateOutput(args.report);
    const [packetText, inventoryText, preimagesText] = await Promise.all(['findings', 'inventory', 'preimages'].map(key => readFile(args[key], 'utf8')));
    check(Buffer.byteLength(packetText) <= 10_000_000 && Buffer.byteLength(inventoryText) <= 20_000_000
      && Buffer.byteLength(preimagesText) <= 64_000_000, 'Hours operation input exceeds its safe bound.');
    const packetHash = sha(packetText), inventoryHash = sha(inventoryText), preimagesHash = sha(preimagesText);
    check(!args['expected-sha'] || args['expected-sha'] === packetHash, 'Hours packet differs from the reviewed SHA.');
    const { targets, skipped } = buildHoursTargets(JSON.parse(packetText), JSON.parse(inventoryText), JSON.parse(preimagesText), inventoryHash, packetHash);
    stage = 'authentication'; const store = dependencies.store ?? await storeFor(args['firebase-tools-dir'], args['config-dir']);
    stage = 'fresh-preview'; const plan = await planHoursImport(targets, packetHash, preimagesHash, store);
    check(args.mode !== 'apply' || plan.planSHA256 === args['expected-plan-sha'], 'Fresh preimages differ from the reviewed preview-plan SHA.');
    check(args.mode !== 'verify' || plan.writes.length === 0, 'Hours enrichment is not fully present.');
    await saveNew(args.snapshot, { project: PROJECT, database: DATABASE, packetHash, inventoryHash, preimagesHash,
      planSHA256: plan.planSHA256, capturedAt: new Date().toISOString(), targets: plan.snapshots });
    receipt = { project: PROJECT, database: DATABASE, mode: args.mode, packetHash, inventoryHash, preimagesHash,
      planSHA256: plan.planSHA256, targets: targets.length, plannedWrites: plan.writes.length, skipped,
      pendingPaths: [], committedPaths: [], status: 'planned', startedAt: new Date().toISOString() };
    await saveNew(args.report, receipt); receiptCreated = true;
    if (args.mode === 'apply') {
      stage = 'commit';
      for (const batch of batchesOf(plan.writes)) {
        receipt.status = 'applying'; receipt.pendingPaths = batch.map(write => write.update.name.slice(ROOT.length + 1)); await receiptAt(args.report, receipt);
        await store.commit(batch);
        receipt.committedPaths.push(...receipt.pendingPaths); receipt.pendingPaths = []; await receiptAt(args.report, receipt);
      }
      stage = 'exact-readback';
      for (let offset = 0; offset < targets.length; offset += 12) {
        const results = await Promise.all(targets.slice(offset, offset + 12).map(async target => hoursTargetMatches(target, await store.get(target.path))));
        check(results.every(Boolean), 'Hours profile differs on exact server readback.');
      }
      receipt.status = 'complete';
    } else if (args.mode === 'verify') receipt.status = 'verified';
    receipt.completedAt = new Date().toISOString(); await receiptAt(args.report, receipt);
    console.log(JSON.stringify({ mode: args.mode, status: receipt.status, packetHash, planSHA256: plan.planSHA256,
      targets: targets.length, plannedWrites: plan.writes.length, committedWrites: receipt.committedPaths.length, skipped: skipped.length }));
    return receipt;
  } catch (error) {
    if (receiptCreated) {
      receipt.status = receipt.pendingPaths.length ? 'commit-outcome-unknown' : 'failed'; receipt.failedStage = stage;
      receipt.requiresReconciliation = ['commit', 'exact-readback'].includes(stage); await receiptAt(args.report, receipt).catch(() => {});
    }
    throw new ResearchError(error instanceof ResearchError ? error.message : `Hours research operation failed at ${stage}; provider details omitted.`);
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) run().catch(error => { console.error(error.message); process.exitCode = 1; });
