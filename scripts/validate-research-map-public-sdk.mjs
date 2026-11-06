/** Read-only, signed-out Web SDK verification. `plan` never initializes Firebase. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PROJECT, DATABASE, desiredTargets, makeManifest, stable } from './research-map-model.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PINS = Object.freeze({
  'lib/source-comments.ts': '3ef175b06503ca0283375bd5c28c7d1b14a9a17024fce05e0b583eca9d9f53ad',
  'lib/restroom-access-details-model.ts': '8b6902fb6c03e763a85331e6464a88cee02056a25d41d8b198de86ae27ec26eb',
  'scripts/research-map-model.mjs': '56af4491f263f2e19ceaf3d6d9b88ecb0f588c602c52778c6d71ab91fed8d1c8',
});
const hash = value => createHash('sha256').update(value).digest('hex');
const check = (value, message) => { if (!value) throw new Error(message); };
const require = createRequire(import.meta.url);

function argumentsOf(argv) {
  const [mode, ...tail] = argv;
  check(mode === 'plan' || mode === 'verify', 'Choose offline plan or explicitly authorized verify.');
  const allowed = new Set(['manifest', 'inventory', 'report', 'expected-sha', 'apply-report']);
  const args = { mode };
  for (let i = 0; i < tail.length; i += 2) {
    const key = tail[i]?.startsWith('--') ? tail[i].slice(2) : '';
    check(allowed.has(key) && !Object.hasOwn(args, key) && tail[i + 1] && !tail[i + 1].startsWith('--'), 'Invalid arguments.');
    args[key] = tail[i + 1];
  }
  check(args.manifest && args.inventory && args.report, 'Manifest, inventory and new report paths are required.');
  if (mode === 'verify') check(/^[a-f0-9]{64}$/.test(args['expected-sha'] ?? '') && args['apply-report'], 'Verify requires the final reviewed manifest SHA256 and completed apply report.');
  for (const key of ['manifest', 'inventory', 'report', 'apply-report']) if (args[key]) args[key] = resolve(args[key]);
  const paths = [args.manifest, args.inventory, args.report, args['apply-report']].filter(Boolean);
  check(new Set(paths).size === paths.length, 'Input and new output paths must differ.');
  return args;
}

async function writeNewJSON(path, value) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); } finally { await file.close(); }
}

async function actualDecoders(Timestamp) {
  const { loadBindings, transform } = await import('next/dist/build/swc/index.js');
  await loadBindings();
  const blocked = () => { throw new Error('A decoder attempted an unapproved client operation.'); };
  const sdk = { Timestamp, collection: blocked, getFirestore: blocked, limit: blocked,
    onSnapshot: blocked, orderBy: blocked, query: blocked };
  async function compile(file, imports) {
    const source = await readFile(resolve(ROOT, file), 'utf8');
    check(hash(source) === PINS[file], 'A reviewed decoder/source pin changed; stop for review.');
    const compiled = await transform(source, { filename: file,
      jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' } });
    const module = { exports: {} };
    new Function('module', 'exports', 'require', compiled.code)(module, module.exports,
      name => Object.hasOwn(imports, name) ? imports[name] : require(name));
    return module.exports;
  }
  const comments = await compile('lib/source-comments.ts', { 'firebase/firestore': sdk,
    '@/lib/firebase-client': { getFirebaseClient: blocked } });
  const access = await compile('lib/restroom-access-details-model.ts', {});
  check(comments.PUBLIC_SOURCE_COMMENT_LIMIT === 10 && access.ACCESS_DETAILS_FEED_LIMIT === 1000, 'Actual app feed bounds changed.');
  return { comments, access };
}

// Exact timestamp comparison retains all nine fractional digits, including non-millisecond values.
function instantParts(value) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  check(match, 'Expected manifest timestamp must use UTC.');
  return { seconds: Math.floor(Date.parse(`${match[1]}Z`) / 1000), nanoseconds: Number((match[2] ?? '').padEnd(9, '0')) };
}
function equalTarget(target, data, Timestamp) {
  const expected = [...Object.keys(target.payload), ...target.serverFields].sort();
  assert.deepEqual(Object.keys(data).sort(), expected, 'Unexpected public fields.');
  for (const [key, value] of Object.entries(target.payload)) {
    if (target.timestampFields.includes(key) && value !== null) {
      check(data[key] instanceof Timestamp, 'Manifest timestamp was not a Firestore Timestamp.');
      const expectedTime = instantParts(value);
      check(data[key].seconds === expectedTime.seconds && data[key].nanoseconds === expectedTime.nanoseconds, 'Public timestamp differs from exact manifest precision.');
    } else assert.deepEqual(data[key], value, 'Public projection differs from reviewed manifest.');
  }
  for (const key of target.serverFields) check(data[key] instanceof Timestamp, 'Import timestamp must remain a server Timestamp.');
}

export async function run(argv = process.argv.slice(2)) {
  const args = argumentsOf(argv);
  let stage = 'offline-validation', app, database;
  const report = { mode: args.mode, project: PROJECT, database: DATABASE, productionWrites: 0, authSDKLoaded: false,
    authAccountsCreated: 0, signedOut: true, startedAt: new Date().toISOString(), status: 'preparing', decoderSHA256: PINS };
  try {
    for (const [file, expected] of Object.entries(PINS)) check(hash(await readFile(resolve(ROOT, file))) === expected, 'Reviewed source pin changed.');
    const manifestText = await readFile(args.manifest, 'utf8'), inventoryText = await readFile(args.inventory, 'utf8');
    check(Buffer.byteLength(manifestText) <= 40_000_000 && Buffer.byteLength(inventoryText) <= 30_000_000, 'Input too large.');
    const manifest = JSON.parse(manifestText), inventory = JSON.parse(inventoryText);
    report.manifestSHA256 = hash(manifestText);
    check(manifest.project === 'nye-restroom' && manifest.database === '(default)' && manifest.inventorySHA256 === hash(inventoryText), 'Unexpected project, database or inventory.');
    if (args['expected-sha']) check(args['expected-sha'] === report.manifestSHA256, 'Manifest is not the exact reviewed final manifest.');
    const rebuilt = makeManifest({ schemaVersion: 1, batchID: manifest.batchID, inventorySHA256: manifest.inventorySHA256,
      entries: manifest.entries.map(({ id, ...entry }) => entry) }, inventory, manifest.inventorySHA256, manifest.reviewedAt,
    manifest.coverage.filter(row => row.status === 'source-checked-no-new-facts').map(row => row.placeID));
    check(stable(rebuilt) === stable(manifest), 'Manifest cannot be reproduced from its reviewed source evidence.');
    const targets = desiredTargets(manifest), commentTargets = targets.filter(target => target.path.startsWith('restroomSourceComments/'));
    const accessTargets = targets.filter(target => target.path.startsWith('restroomAccessDetails/'));
    const groups = new Map();
    for (const target of commentTargets) {
      const placeID = target.payload.placeID;
      if (!groups.has(placeID)) groups.set(placeID, []);
      groups.get(placeID).push(target);
    }
    report.planned = { sourceComments: commentTargets.length, sourceCommentPlaces: groups.size,
      newAccessCandidates: accessTargets.length, placesWithMoreThanTenTargets: [...groups.values()].filter(rows => rows.length > 10).length,
      maximumTargetsPerPlace: Math.max(0, ...[...groups.values()].map(rows => rows.length)), sourceFeedLimit: 10, accessFeedLimit: 1000 };
    check(commentTargets.length > 0 && groups.size <= 1167, 'Unexpected source-comment scope.');
    const { Timestamp, collection, doc, getDocFromServer, getDocsFromServer, initializeFirestore, limit,
      orderBy, query, terminate, setLogLevel } = await import('firebase/firestore');
    const { comments, access } = await actualDecoders(Timestamp);
    // Offline schema checks use synthetic import timestamps only; no Firebase app or network operation exists in plan mode.
    const syntheticImportedAt = Timestamp.fromMillis(Math.max(Date.now(), ...commentTargets.map(target => Date.parse(target.payload.capturedAt))) + 1000);
    for (const target of commentTargets) comments.decodeSourceComment(target.path.split('/').at(-1), target.payload.placeID,
      { ...target.payload, submittedAt: syntheticImportedAt });
    for (const target of accessTargets) {
      const data = { ...target.payload };
      for (const key of target.timestampFields) if (data[key] !== null) { const t = instantParts(data[key]); data[key] = new Timestamp(t.seconds, t.nanoseconds); }
      access.decodeRestroomAccessDetails(target.payload.placeID, data, value => value instanceof Timestamp ? value.toDate() : null);
    }
    if (args.mode === 'plan') {
      report.status = 'offline-ready-not-run'; report.liveReads = 0; report.completedAt = new Date().toISOString();
      await writeNewJSON(args.report, report); console.log(JSON.stringify(report)); return report;
    }
    const applyText = await readFile(args['apply-report'], 'utf8'), applied = JSON.parse(applyText);
    check(applied.project === PROJECT && applied.database === DATABASE && applied.mode === 'apply' && applied.status === 'complete'
      && applied.manifestHash === report.manifestSHA256 && Array.isArray(applied.preservedAccess) && applied.pendingPaths?.length === 0,
    'A completed exact-manifest apply receipt is required before live readback.');
    const preserved = new Map(applied.preservedAccess.map(row => [row.path, row.reason]));
    const preservedPaths = new Set(preserved.keys());
    check(preserved.size === applied.preservedAccess.length && [...preserved].every(([path, reason]) => accessTargets.some(target => target.path === path)
      && ['preserve-existing-access-report', 'preserve-newer-positive-baseline-route'].includes(reason)), 'Apply receipt preservation scope differs from this manifest.');
    report.applyReceiptSHA256 = hash(applyText);
    stage = 'anonymous-initialization';
    check(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Emulator environment is forbidden for this explicitly live read-only check.');
    const config = JSON.parse(await readFile(resolve(ROOT, 'firebase/web-config.json'), 'utf8'));
    check(config.projectId === 'nye-restroom' && typeof config.apiKey === 'string' && config.apiKey.length > 20, 'Unexpected public Firebase client config.');
    setLogLevel('silent');
    const { initializeApp, deleteApp } = await import('firebase/app');
    app = initializeApp(config, `rr-public-research-readonly-${Date.now()}`);
    database = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
    report.sourceComments = { placesRead: 0, feedDocumentsDecoded: 0, manifestTargetsInFeeds: 0,
      manifestTargetsOutsideLatestTen: 0, exactOlderTargetsDecoded: 0, matchedTargets: 0, sourcePublications: 0,
      sourceComments: 0, dated: 0, undated: 0, anonymous: 0, unverified: 0, unknownObservationDate: 0 };
    const matchedIDs = new Set();
    stage = 'bounded-public-source-feeds';
    // Sequential places avoid a burst of hundreds of active WebChannel RPCs. Every query is server-only and limit 10.
    for (const [placeID, expected] of groups) {
      const snapshot = await getDocsFromServer(query(collection(database, 'restroomSourceComments', placeID, 'comments'), orderBy('submittedAt', 'desc'), limit(10)));
      check(!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites && snapshot.size <= 10, 'Public source feed was not a confirmed bounded server result.');
      const present = new Map(); let previous;
      for (const row of snapshot.docs) {
        const data = row.data(), decoded = comments.decodeSourceComment(row.id, placeID, data);
        check(data.submittedAt instanceof Timestamp, 'Invalid import timestamp.');
        if (previous) check(previous.seconds > data.submittedAt.seconds || previous.seconds === data.submittedAt.seconds && previous.nanoseconds >= data.submittedAt.nanoseconds, 'Source feed import ordering differs.');
        previous = data.submittedAt; present.set(row.id, { data, decoded }); report.sourceComments.feedDocumentsDecoded++;
      }
      for (const target of expected) {
        const id = target.path.split('/').at(-1); let record = present.get(id);
        if (record) report.sourceComments.manifestTargetsInFeeds++;
        else {
          // The app intentionally shows only ten. Exact GETs validate older manifest targets without expanding list access.
          report.sourceComments.manifestTargetsOutsideLatestTen++;
          const row = await getDocFromServer(doc(database, target.path));
          check(row.exists() && !row.metadata.fromCache && !row.metadata.hasPendingWrites, 'A manifest source target is missing from the server.');
          record = { data: row.data(), decoded: comments.decodeSourceComment(id, placeID, row.data()) };
          report.sourceComments.exactOlderTargetsDecoded++;
        }
        equalTarget(target, record.data, Timestamp);
        const value = record.decoded;
        check(value.displayName === 'Anonymous user' && value.verified === false && value.observedOn === null, 'Imported anonymity/observation boundary changed.');
        check(value.publishedOn === target.payload.publishedOn && value.displayedDate === target.payload.displayedDate
          && value.capturedAt.getTime() === Date.parse(target.payload.capturedAt), 'Source publication and capture dates changed.');
        report.sourceComments[value.sourceKind === 'post' ? 'sourcePublications' : 'sourceComments']++;
        report.sourceComments[value.publishedOn === null ? 'undated' : 'dated']++;
        report.sourceComments.anonymous++; report.sourceComments.unverified++; report.sourceComments.unknownObservationDate++;
        matchedIDs.add(target.path);
      }
      report.sourceComments.placesRead++;
      if (report.sourceComments.placesRead % 50 === 0) console.log(JSON.stringify({ stage, placesRead: report.sourceComments.placesRead, expectedPlaces: groups.size }));
    }
    report.sourceComments.matchedTargets = matchedIDs.size;
    check(matchedIDs.size === commentTargets.length, 'Not every reviewed public source target was validated.');
    stage = 'bounded-global-access-feed';
    const accessSnapshot = await getDocsFromServer(query(collection(database, 'restroomAccessDetails'), orderBy('updatedAt', 'desc'), limit(1000)));
    check(!accessSnapshot.metadata.fromCache && !accessSnapshot.metadata.hasPendingWrites && accessSnapshot.size < 1000, 'The global access feed may be truncated or unconfirmed.');
    const accessByID = new Map();
    for (const row of accessSnapshot.docs) {
      access.decodeRestroomAccessDetails(row.id, row.data(), value => value instanceof Timestamp ? value.toDate() : null);
      accessByID.set(row.id, row.data());
    }
    // A newer direct report may intentionally replace a candidate or prevent its creation; report mismatches without rewriting it.
    report.access = { decoded: accessSnapshot.size, candidateMatches: 0, reviewedPreservedCandidates: 0,
      reviewedPreservedAbsentCandidates: 0, positiveCommunityBaselinesConfirmed: 0 };
    for (const target of accessTargets) {
      const data = accessByID.get(target.payload.placeID);
      if (!data) {
        check(preserved.get(target.path) === 'preserve-newer-positive-baseline-route'
          && target.path.startsWith('restroomAccessDetails/community-'), 'An applied access candidate is missing without a reviewed positive-baseline preservation reason.');
        const baseline = await getDocFromServer(doc(database, 'communityRestrooms', target.payload.placeID));
        check(baseline.exists() && !baseline.metadata.fromCache && !baseline.metadata.hasPendingWrites
          && baseline.data().stepFreeAccess === 'yes', 'The preserved positive community baseline is no longer confirmed.');
        report.access.positiveCommunityBaselinesConfirmed++;
        report.access.reviewedPreservedAbsentCandidates++; continue;
      }
      try { equalTarget(target, data, Timestamp); report.access.candidateMatches++; }
      catch {
        check(preservedPaths.has(target.path), 'An applied access candidate changed without a reviewed preservation reason.');
        report.access.reviewedPreservedCandidates++;
      }
    }
    stage = 'private-archive-denial';
    const archiveTargets = targets.filter(target => target.path.startsWith(`restroomResearch/${manifest.batchID}`));
    const denialPaths = [archiveTargets[0].path, archiveTargets.find(target => target.path.includes('/manifests/'))?.path,
      archiveTargets.find(target => target.path.includes('/entries/'))?.path].filter(Boolean);
    let denied = 0;
    for (const path of denialPaths) {
      try { await getDocFromServer(doc(database, path)); }
      catch (error) { check(error?.code === 'permission-denied', 'Private-archive check failed for a reason other than denial.'); denied++; continue; }
      throw new Error('A private research archive was anonymously readable.');
    }
    report.privateArchive = { representativeExactGets: denialPaths.length, permissionDenied: denied, privateBodiesRead: 0 };
    report.status = 'passed'; report.completedAt = new Date().toISOString();
    await terminate(database); database = undefined; await deleteApp(app); app = undefined;
    await writeNewJSON(args.report, report);
    console.log(JSON.stringify(report)); return report;
  } catch {
    report.status = 'failed'; report.failedStage = stage; report.completedAt = new Date().toISOString();
    // Report contains aggregate counts only: no source bodies, user names, credential values or provider diagnostics.
    await writeNewJSON(args.report, report).catch(() => {});
    throw new Error(`Read-only SDK validation failed during ${stage}; no production write or sign-in was attempted.`);
  } finally {
    if (database) { const { terminate } = await import('firebase/firestore'); await terminate(database).catch(() => {}); }
    if (app) { const { deleteApp } = await import('firebase/app'); await deleteApp(app).catch(() => {}); }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
