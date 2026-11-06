/** Manifest-bound, create-only public projections used by the native and web cards. */
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT, DATABASE, ROOT, ResearchError, check, stable, sha, createWrite, targetMatches, dataOf, validateInventory } from './research-map-model.mjs';
import { decodeCardResearch } from '../lib/card-research-model.ts';

const SOURCE_SHA = 'adee7ab48de4bbf78d8286c150f9a1d7b7f392490c4c7de2c224a021719c4b74';
async function saveNew(path, value) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
}
async function saveReceipt(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  try { await saveNew(temporary, value); await rename(temporary, path); } finally { await unlink(temporary).catch(() => {}); }
}
function argumentsOf(argv) {
  const [mode, ...tail] = argv;
  check(['preview', 'apply', 'verify'].includes(mode), 'Choose preview, apply or read-only verify.');
  const args = { mode }, allowed = new Set(['profiles', 'inventory', 'source-manifest', 'snapshot', 'report', 'firebase-tools-dir', 'expected-sha', 'expected-plan-sha']);
  for (let i = 0; i < tail.length; i += 2) {
    const key = tail[i]?.startsWith('--') ? tail[i].slice(2) : '';
    check(allowed.has(key) && !Object.hasOwn(args, key) && tail[i + 1] && !tail[i + 1].startsWith('--'), 'Invalid arguments.');
    args[key] = tail[i + 1];
  }
  check(['profiles', 'inventory', 'source-manifest', 'snapshot', 'report', 'firebase-tools-dir'].every(key => args[key]), 'Missing required paths.');
  if (mode === 'apply') check(/^[a-f0-9]{64}$/.test(args['expected-sha'] ?? '') && /^[a-f0-9]{64}$/.test(args['expected-plan-sha'] ?? ''), 'Apply needs the independently reviewed packet and preview-plan hashes.');
  for (const key of ['profiles', 'inventory', 'source-manifest', 'snapshot', 'report', 'firebase-tools-dir']) args[key] = resolve(args[key]);
  const files = ['profiles', 'inventory', 'source-manifest', 'snapshot', 'report'].map(key => args[key]);
  check(new Set(files).size === files.length, 'Inputs and exclusive outputs must differ.');
  return args;
}

export function validateCardPacket(packet, inventory, sourceManifest) {
  const places = validateInventory(inventory);
  check(packet && Object.keys(packet).sort().join('|') === ['schemaVersion', 'manifestSHA256', 'profiles'].sort().join('|')
    && packet.schemaVersion === 1 && packet.manifestSHA256 === SOURCE_SHA && Array.isArray(packet.profiles)
    && packet.profiles.length > 0 && packet.profiles.length <= places.size, 'Invalid public card packet.');
  const acceptedSources = new Map(sourceManifest.entries.map(entry => [entry.id, entry]));
  const ids = new Set();
  return packet.profiles.map(input => {
    check(places.has(input.placeID) && !ids.has(input.placeID), 'A public profile has a duplicate or unknown place ID.');
    ids.add(input.placeID);
    const profile = decodeCardResearch(input.placeID, input);
    check(stable(profile) === stable(input) && profile.manifestSHA256 === SOURCE_SHA
      && profile.generatedAt === sourceManifest.reviewedAt, 'A profile differs from its reviewed projection.');
    for (const source of profile.sources) {
      const evidence = acceptedSources.get(source.id);
      check(evidence?.placeID === profile.placeID && source.url === evidence.sourceURL
        && source.title === evidence.sourceTitle && source.publishedOn === evidence.publishedOn
        && source.retrievedAt === evidence.retrievedAt, 'Profile source identity or original dates differ from reviewed evidence.');
    }
    check(Buffer.byteLength(JSON.stringify(profile)) < 128_000, 'Public profile exceeds the safe per-place bound.');
    return { path: `restroomResearchProfiles/${profile.placeID}`, payload: profile, timestampFields: [], serverFields: [] };
  });
}
export async function planCardImport(targets, packetHash, store) {
  const snapshots = [], writes = [];
  for (let offset = 0; offset < targets.length; offset += 12) {
    const rows = await Promise.all(targets.slice(offset, offset + 12).map(async target => ({ target, document: await store.get(target.path) })));
    for (const { target, document } of rows) {
      snapshots.push({ path: target.path, document });
      if (document) check(targetMatches(target, document), 'An existing card profile differs; stop rather than overwrite it.');
      else writes.push(createWrite(target));
    }
  }
  return { snapshots, writes, planSHA256: sha(stable({ packetHash, snapshots, writes })) };
}
function commitBatches(writes) {
  const batches = []; let batch = [], bytes = 100;
  for (const write of writes) {
    const size = Buffer.byteLength(JSON.stringify(write)) + 1;
    check(size < 900_000, 'Individual card write exceeds its safe bound.');
    if (batch.length && (batch.length >= 150 || bytes + size > 7_000_000)) { batches.push(batch); batch = []; bytes = 100; }
    batch.push(write); bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
async function storeFor(cliDirectory) {
  const require = createRequire(pathToFileURL(resolve(cliDirectory, 'package.json')));
  const auth = require('./lib/auth.js'), { requireAuth } = require('./lib/requireAuth.js'), { Client } = require('./lib/apiv2.js');
  const account = auth.getGlobalDefaultAccount(); check(account, 'Use the configured Firebase CLI login.');
  const options = { project: PROJECT }; auth.setActiveAccount(options, account); await requireAuth(options);
  const api = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
  const database = (await api.get(`/projects/${PROJECT}/databases/${DATABASE}`)).body;
  check(database.name === `projects/${PROJECT}/databases/${DATABASE}` && database.databaseEdition === 'STANDARD', 'Unexpected database identity or edition.');
  return { api, async get(path) {
    try { return (await api.get(`/${ROOT}/${path}`)).body; }
    catch (error) { if (error.status === 404 || error.context?.response?.statusCode === 404 || error.context?.body?.error?.code === 404) return null; throw error; }
  } };
}
export async function run(argv = process.argv.slice(2), dependencies = {}) {
  let args, receipt, receiptCreated = false, stage = 'validation';
  try {
    args = argumentsOf(argv);
    const [packetText, inventoryText, sourceText] = await Promise.all(['profiles', 'inventory', 'source-manifest'].map(key => readFile(args[key], 'utf8')));
    check(Buffer.byteLength(packetText) < 35_000_000 && sha(sourceText) === SOURCE_SHA, 'Packet too large or source manifest changed.');
    const packetHash = sha(packetText), source = JSON.parse(sourceText), inventory = JSON.parse(inventoryText);
    check(sha(inventoryText) === source.inventorySHA256, 'Inventory differs from original exact-identity research.');
    const targets = validateCardPacket(JSON.parse(packetText), inventory, source);
    check(!args['expected-sha'] || args['expected-sha'] === packetHash, 'Profile packet differs from the reviewed hash.');
    stage = 'authentication'; const store = dependencies.store ?? await storeFor(args['firebase-tools-dir']);
    stage = 'public-identity-check';
    for (const place of inventory.places.filter(place => place.sourceKind === 'community' && targets.some(target => target.payload.placeID === place.id))) {
      const document = await store.get(`communityRestrooms/${place.id}`), current = document && dataOf(document);
      check(current && ['name', 'address', 'latitude', 'longitude'].every(field => current[field] === place.baseRecord?.[field]), 'Community venue identity changed; recheck before publishing.');
    }
    stage = 'preview'; const plan = await planCardImport(targets, packetHash, store);
    check(args.mode !== 'apply' || plan.planSHA256 === args['expected-plan-sha'], 'Fresh target preimages differ from the reviewed preview.');
    if (args.mode === 'verify') check(plan.writes.length === 0, 'A reviewed public profile is missing.');
    await saveNew(args.snapshot, { project: PROJECT, database: DATABASE, packetHash, planSHA256: plan.planSHA256, capturedAt: new Date().toISOString(), targets: plan.snapshots });
    receipt = { project: PROJECT, database: DATABASE, mode: args.mode, packetHash, sourceManifestSHA256: SOURCE_SHA,
      planSHA256: plan.planSHA256, plannedWrites: plan.writes.length, targets: targets.length, pendingPaths: [], committedPaths: [], status: 'planned', startedAt: new Date().toISOString() };
    await saveNew(args.report, receipt); receiptCreated = true;
    if (args.mode === 'apply') {
      stage = 'commit';
      for (const batch of commitBatches(plan.writes)) {
        receipt.status = 'applying'; receipt.pendingPaths = batch.map(write => write.update.name.slice(ROOT.length + 1)); await saveReceipt(args.report, receipt);
        await store.api.post(`/${ROOT}:commit`, { writes: batch });
        receipt.committedPaths.push(...receipt.pendingPaths); receipt.pendingPaths = []; await saveReceipt(args.report, receipt);
      }
      stage = 'exact-readback';
      for (let offset = 0; offset < targets.length; offset += 12) {
        const results = await Promise.all(targets.slice(offset, offset + 12).map(async target => targetMatches(target, await store.get(target.path))));
        check(results.every(Boolean), 'A public card profile differs on server readback.');
      }
      receipt.status = 'complete';
    } else if (args.mode === 'verify') receipt.status = 'verified';
    receipt.completedAt = new Date().toISOString(); await saveReceipt(args.report, receipt);
    console.log(JSON.stringify({ mode: receipt.mode, status: receipt.status, packetHash, planSHA256: receipt.planSHA256,
      targets: targets.length, plannedWrites: receipt.plannedWrites, committedWrites: receipt.committedPaths.length }));
    return receipt;
  } catch (error) {
    if (receiptCreated) {
      receipt.status = receipt.pendingPaths.length ? 'commit-outcome-unknown' : 'failed'; receipt.failedStage = stage;
      receipt.requiresReconciliation = ['commit', 'exact-readback'].includes(stage); await saveReceipt(args.report, receipt).catch(() => {});
    }
    throw new ResearchError(error instanceof ResearchError ? error.message : `Card research operation failed at ${stage}; provider details omitted.`);
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) run().catch(error => { console.error(error.message); process.exitCode = 1; });
