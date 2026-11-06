/** Manifest-bound research import. Defaults to offline preparation or read-only preview. */
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT, DATABASE, ROOT, ResearchError, check, stable, sha, makeManifest, desiredTargets,
  validateInventory, createWrite, targetMatches, dataOf } from './research-map-model.mjs';

async function exclusiveJSON(path, value) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
}
async function replaceJSON(path, value) {
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  try { await exclusiveJSON(temporary, value); await rename(temporary, path); } finally { await unlink(temporary).catch(() => {}); }
}
function parseArgs(argv) {
  const [mode, ...rest] = argv;
  check(['prepare', 'preview', 'apply'].includes(mode), 'Choose prepare, preview or apply.');
  const allowed = new Set(['inventory', 'findings', 'manifest', 'coverage', 'audited-place-ids', 'reviewed-at',
    'snapshot', 'report', 'firebase-tools-dir', 'expected-sha', 'expected-plan-sha']);
  const args = { mode };
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.startsWith('--') ? rest[i].slice(2) : '';
    check(allowed.has(key) && !Object.hasOwn(args, key) && typeof rest[i + 1] === 'string' && !rest[i + 1].startsWith('--'),
      'Invalid or repeated command-line argument.'); args[key] = rest[i + 1];
  }
  const required = mode === 'prepare' ? ['inventory', 'findings', 'manifest', 'coverage', 'reviewed-at']
    : ['inventory', 'manifest', 'snapshot', 'report', 'firebase-tools-dir'];
  check(required.every(key => args[key]), 'Missing required research import arguments.');
  if (mode === 'apply') check(/^[a-f0-9]{64}$/.test(args['expected-sha'] ?? '') && /^[a-f0-9]{64}$/.test(args['expected-plan-sha'] ?? ''),
    'Apply requires exact independently reviewed manifest and preview-plan SHA256.');
  const paths = ['inventory', 'findings', 'manifest', 'coverage', 'audited-place-ids', 'snapshot', 'report', 'firebase-tools-dir'];
  for (const key of paths) if (args[key]) args[key] = resolve(args[key]);
  const filePaths = paths.filter(key => key !== 'firebase-tools-dir' && args[key]).map(key => args[key]);
  check(new Set(filePaths).size === filePaths.length, 'Input, output and backup files must have distinct paths.');
  return args;
}

export async function preparePlan(manifest, manifestHash, store) {
  const targets = desiredTargets(manifest), targetSnapshot = [], writes = [], skipped = [];
  // Read all public sidecars to enforce the app's fixed global supplemental-feed bound.
  const access = await store.list('restroomAccessDetails');
  check(access.length <= 1000, 'Existing sidecars exceed the supported global feed; stop for review.');
  let newSidecars = 0;
  for (let offset = 0; offset < targets.length; offset += 12) {
    const states = await Promise.all(targets.slice(offset, offset + 12).map(async target => ({ target, document: await store.get(target.path) })));
    for (const { target, document } of states) {
      targetSnapshot.push({ path: target.path, document });
      if (!document && target.path.startsWith('restroomAccessDetails/community-') && target.payload.stairFreeRoute !== 'yes') {
        const baselinePath = `communityRestrooms/${target.payload.placeID}`, baseline = await store.get(baselinePath);
        targetSnapshot.push({ path: baselinePath, document: baseline, readGuardOnly: true });
        if (baseline && dataOf(baseline).stepFreeAccess === 'yes') {
          skipped.push({ path: target.path, reason: 'preserve-newer-positive-baseline-route' }); continue;
        }
      }
      if (document) {
        if (target.path.startsWith('restroomAccessDetails/') && !targetMatches(target, document)) {
          // A newly supplied direct report wins even if it appeared after the inventory was captured.
          skipped.push({ path: target.path, reason: 'preserve-existing-access-report' }); continue;
        }
        check(targetMatches(target, document), 'An immutable research target differs; stop for review.');
      } else {
        if (target.path.startsWith('restroomAccessDetails/')) newSidecars++;
        writes.push(createWrite(target));
      }
    }
  }
  check(access.length + newSidecars <= 1000, 'Proposed access reports would overflow the global feed.');
  const planSHA256 = sha(stable({ manifestHash, targetSnapshot, accessPaths: access.map(document => document.name).sort(), writes, skipped }));
  return { targets, targetSnapshot, writes, skipped, planSHA256 };
}

async function authenticatedStore(firebaseToolsDir) {
  // Reuse only the configured CLI account in memory. Never export or log credentials.
  const cliRequire = createRequire(pathToFileURL(resolve(firebaseToolsDir, 'package.json')));
  const auth = cliRequire('./lib/auth.js'), { requireAuth } = cliRequire('./lib/requireAuth.js'), { Client } = cliRequire('./lib/apiv2.js');
  const account = auth.getGlobalDefaultAccount(); check(account, 'Use the configured project CLI login first.');
  const options = { project: PROJECT }; auth.setActiveAccount(options, account); await requireAuth(options);
  const api = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
  const database = (await api.get(`/projects/${PROJECT}/databases/${DATABASE}`)).body;
  check(database.name === `projects/${PROJECT}/databases/${DATABASE}` && database.databaseEdition === 'STANDARD',
    'Unexpected Firestore identity or edition.');
  return { database, api,
    async get(path) {
      try { return (await api.get(`/${ROOT}/${path}`)).body; }
      catch (error) {
        if (error.status === 404 || error.context?.response?.statusCode === 404 || error.context?.body?.error?.code === 404) return null;
        throw error;
      }
    },
    async list(path) {
      const result = []; let pageToken;
      do {
        const response = (await api.get(`/${ROOT}/${path}`, { queryParams: { pageSize: 1000, ...(pageToken ? { pageToken } : {}) } })).body;
        check(!response.documents || Array.isArray(response.documents), 'Unexpected public collection response.');
        result.push(...response.documents ?? []); check(result.length <= 10_000, 'Public collection is unexpectedly large.');
        pageToken = response.nextPageToken;
      } while (pageToken);
      return result;
    },
  };
}

export async function run(argv = process.argv.slice(2)) {
  let report, args, stage = 'validation', reportCreated = false;
  try {
    args = parseArgs(argv);
    const inventoryText = await readFile(args.inventory, 'utf8'); check(Buffer.byteLength(inventoryText) <= 30_000_000, 'Inventory too large.');
    const inventory = JSON.parse(inventoryText), inventoryHash = sha(inventoryText); validateInventory(inventory);
    if (args.mode === 'prepare') {
      const findingsText = await readFile(args.findings, 'utf8'); check(Buffer.byteLength(findingsText) <= 30_000_000, 'Findings too large.');
      const audited = args['audited-place-ids'] ? JSON.parse(await readFile(args['audited-place-ids'], 'utf8')) : [];
      const manifest = makeManifest(JSON.parse(findingsText), inventory, inventoryHash, args['reviewed-at'], audited);
      await exclusiveJSON(args.manifest, manifest); await exclusiveJSON(args.coverage, manifest.coverage);
      const manifestHash = sha(await readFile(args.manifest, 'utf8'));
      console.log(JSON.stringify({ mode: 'prepare', manifestHash, inventoryHash, places: manifest.coverage.length,
        evidence: manifest.entries.length, accessCandidates: manifest.access.length, unresolvedAccess: manifest.accessReviewRequired.length }));
      return manifest;
    }
    const manifestText = await readFile(args.manifest, 'utf8'); check(Buffer.byteLength(manifestText) <= 40_000_000, 'Manifest too large.');
    const manifestHash = sha(manifestText), manifest = JSON.parse(manifestText);
    check(manifest.project === PROJECT && manifest.database === DATABASE && manifest.inventorySHA256 === inventoryHash, 'Manifest identity/inventory mismatch.');
    const rebuilt = makeManifest({ schemaVersion: 1, batchID: manifest.batchID, inventorySHA256: inventoryHash,
      entries: manifest.entries.map(({ id, ...entry }) => entry) }, inventory, inventoryHash, manifest.reviewedAt,
    manifest.coverage.filter(row => row.status === 'source-checked-no-new-facts').map(row => row.placeID));
    check(stable(rebuilt) === stable(manifest), 'Manifest projections or coverage differ from validated evidence.');
    check(Date.parse(manifest.reviewedAt) <= Date.now(), 'Research compilation time cannot be in the future.');
    check(args.mode !== 'apply' || args['expected-sha'] === manifestHash, 'Manifest differs from the independently reviewed SHA256.');
    stage = 'authentication'; const store = await authenticatedStore(args['firebase-tools-dir']);
    stage = 'fresh-public-inventory'; const community = await store.list('communityRestrooms');
    check(stable(community.map(document => document.name.split('/').at(-1)).sort())
      === stable(inventory.places.filter(place => place.sourceKind === 'community').map(place => place.id).sort()),
    'Current community place identities changed; refresh the inventory before applying research.');
    const inventoryPlaces = validateInventory(inventory);
    for (const document of community) {
      const current = dataOf(document), expected = inventoryPlaces.get(document.name.split('/').at(-1));
      check(['name', 'address', 'latitude', 'longitude'].every(field => current[field] === expected.baseRecord?.[field]),
        'A community place name, address or pin changed; refresh exact source matching before applying research.');
    }
    stage = 'target-review'; const plan = await preparePlan(manifest, manifestHash, store);
    check(args.mode !== 'apply' || args['expected-plan-sha'] === plan.planSHA256,
      'Fresh target preimages differ from the independently reviewed preview plan.');
    stage = 'backup';
    await exclusiveJSON(args.snapshot, { project: PROJECT, database: DATABASE, manifestHash, planSHA256: plan.planSHA256,
      capturedAt: new Date().toISOString(), targetSnapshot: plan.targetSnapshot,
      publicCommunityPaths: community.map(document => document.name).sort() });
    report = { project: PROJECT, database: DATABASE, batchID: manifest.batchID, manifestHash, planSHA256: plan.planSHA256,
      mode: args.mode, status: 'planned', plannedWrites: plan.writes.length, plannedPaths: plan.writes.map(write => write.update.name.slice(ROOT.length + 1)),
      preservedAccess: plan.skipped, pendingPaths: [], committedPaths: [], startedAt: new Date().toISOString() };
    await exclusiveJSON(args.report, report); reportCreated = true;
    if (args.mode === 'apply') {
      stage = 'commit';
      for (let offset = 0; offset < plan.writes.length; offset += 200) {
        const batch = plan.writes.slice(offset, offset + 200);
        report.status = 'applying'; report.pendingPaths = batch.map(write => write.update.name.slice(ROOT.length + 1));
        await replaceJSON(args.report, report);
        await store.api.post(`/${ROOT}:commit`, { writes: batch });
        report.committedPaths.push(...report.pendingPaths); report.pendingPaths = []; await replaceJSON(args.report, report);
      }
      stage = 'readback';
      const skipped = new Set(plan.skipped.map(item => item.path));
      for (let offset = 0; offset < plan.targets.length; offset += 12) {
        const targets = plan.targets.slice(offset, offset + 12).filter(target => !skipped.has(target.path));
        const states = await Promise.all(targets.map(async target => ({ target, document: await store.get(target.path) })));
        for (const { target, document } of states) check(targetMatches(target, document), 'Post-apply readback differs from the reviewed target.');
      }
      report.status = 'complete';
    }
    report.completedAt = new Date().toISOString(); await replaceJSON(args.report, report);
    console.log(JSON.stringify({ mode: report.mode, status: report.status, manifestHash, planSHA256: plan.planSHA256,
      plannedWrites: report.plannedWrites, committedWrites: report.committedPaths.length, preservedAccess: plan.skipped.length }));
    return report;
  } catch (error) {
    const message = error instanceof ResearchError ? error.message : `Research operation failed during ${stage}; provider details are intentionally omitted.`;
    if (reportCreated) { report.status = report.pendingPaths.length ? 'commit-outcome-unknown' : 'failed'; report.failedStage = stage;
      report.error = message; report.requiresReconciliation = stage === 'commit' || stage === 'readback';
      await replaceJSON(args.report, report).catch(() => {}); }
    throw new ResearchError(message);
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
