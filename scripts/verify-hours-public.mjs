/** Signed-out exact server reads only; no Auth initialization or database writes. */
import { open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initializeApp, deleteApp } from 'firebase/app';
import { doc, getDocFromServer, initializeFirestore, setLogLevel, terminate } from 'firebase/firestore';
import { decodeCardResearch } from '../lib/card-research-model.ts';
import { PROJECT, DATABASE, sha, stable, validInstant } from './research-map-model.mjs';
import { buildHoursTargets, checkedHoursPath } from './hours-research-model.mjs';

const expectedTargets = 80;
const hashPattern = /^[a-f0-9]{64}$/;
class VerificationError extends Error {}
const check = (value, message) => { if (!value) throw new VerificationError(message); };
const providerCodes = new Set(['cancelled', 'unknown', 'invalid-argument', 'deadline-exceeded', 'not-found',
  'already-exists', 'permission-denied', 'resource-exhausted', 'failed-precondition', 'aborted',
  'out-of-range', 'unimplemented', 'internal', 'unavailable', 'data-loss', 'unauthenticated']);
function providerCode(error) {
  const code = typeof error?.code === 'string' ? error.code.replace(/^firestore\//, '') : '';
  return providerCodes.has(code) ? code : 'details-omitted';
}
async function boundedReads(db, targets) {
  let timeout;
  try {
    return await Promise.race([
      Promise.allSettled(targets.map(async target => {
        const snapshot = await getDocFromServer(doc(db, target.path));
        check(snapshot.exists() && !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites,
          'An exact profile was not confirmed by the live server.');
        const placeID = target.path.split('/')[1];
        const decoded = decodeCardResearch(placeID, snapshot.data());
        check(stable(decoded) === stable(target.payload), 'A live profile differs from the frozen-baseline target.');
        return { placeID, profileSHA256: sha(stable(decoded)), facts: decoded.facts.length,
          sources: decoded.sources.length, comments: decoded.comments.length };
      })),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new VerificationError('Live read batch timed out.')), 45_000); }),
    ]);
  } finally { clearTimeout(timeout); }
}

export async function run(argv = process.argv.slice(2)) {
  let app, db, output, stage = 'arguments';
  const result = { schemaVersion: 1, project: PROJECT, database: DATABASE, signedOut: true,
    authAccountsCreated: 0, productionWrites: 0, status: 'preparing', startedAt: new Date().toISOString() };
  try {
    check(argv.length === 6 && argv.every(value => typeof value === 'string' && value.length > 0),
      'Findings, inventory, frozen preimages, completed apply receipt, new output and expected packet SHA are required.');
    const [findingsPath, inventoryPath, preimagesPath, applyPath, outputPath] = argv.slice(0, 5).map(value => resolve(value));
    const expectedSHA = argv[5];
    check(hashPattern.test(expectedSHA) && new Set([findingsPath, inventoryPath, preimagesPath, applyPath, outputPath]).size === 5,
      'Exact packet SHA and distinct input/output paths are required.');
    check(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST
      && !process.env.FIREBASE_EMULATOR_HUB, 'Emulators are not permitted for live public verification.');
    stage = 'new-output'; output = await open(outputPath, 'wx', 0o600);
    stage = 'frozen-inputs';
    const [packetText, inventoryText, preimagesText, applyText] = await Promise.all(
      [findingsPath, inventoryPath, preimagesPath, applyPath].map(path => readFile(path, 'utf8')));
    check(Buffer.byteLength(packetText) <= 10_000_000 && Buffer.byteLength(inventoryText) <= 20_000_000
      && Buffer.byteLength(preimagesText) <= 64_000_000 && Buffer.byteLength(applyText) <= 2_000_000,
      'Verification input exceeds its safe bound.');
    const packetHash = sha(packetText), inventoryHash = sha(inventoryText), preimagesHash = sha(preimagesText);
    check(packetHash === expectedSHA, 'Findings differ from the expected packet hash.');
    const packet = JSON.parse(packetText), inventory = JSON.parse(inventoryText), preimages = JSON.parse(preimagesText);
    const { targets, skipped } = buildHoursTargets(packet, inventory, preimages, inventoryHash, packetHash);
    check(targets.length === expectedTargets && new Set(targets.map(target => target.path)).size === expectedTargets,
      'The frozen baseline must produce exactly 80 distinct hours targets.');
    for (const target of targets) {
      checkedHoursPath(target.path, true);
      const placeID = target.path.split('/')[1];
      check(stable(decodeCardResearch(placeID, target.payload)) === stable(target.payload), 'Invalid desired public profile.');
    }
    stage = 'completed-apply-receipt';
    const applied = JSON.parse(applyText), targetPaths = new Set(targets.map(target => target.path));
    check(applied.project === PROJECT && applied.database === DATABASE && applied.mode === 'apply'
      && applied.status === 'complete' && applied.packetHash === packetHash && applied.inventoryHash === inventoryHash
      && applied.preimagesHash === preimagesHash && hashPattern.test(applied.planSHA256 ?? '')
      && applied.targets === expectedTargets && Array.isArray(applied.pendingPaths) && applied.pendingPaths.length === 0
      && applied.requiresReconciliation !== true && validInstant(applied.startedAt) && validInstant(applied.completedAt)
      && Date.parse(applied.completedAt) >= Date.parse(applied.startedAt)
      && Array.isArray(applied.skipped) && stable(applied.skipped) === stable(skipped)
      && Number.isInteger(applied.plannedWrites) && applied.plannedWrites >= 0 && applied.plannedWrites <= expectedTargets
      && Array.isArray(applied.committedPaths) && applied.committedPaths.length === applied.plannedWrites
      && new Set(applied.committedPaths).size === applied.committedPaths.length
      && applied.committedPaths.every(path => targetPaths.has(path)), 'A completed exact-input apply receipt is required.');
    Object.assign(result, { packetSHA256: packetHash, inventorySHA256: inventoryHash, preimagesSHA256: preimagesHash,
      planSHA256: applied.planSHA256, expectedTargets, verifiedProfiles: 0, facts: 0, sources: 0, comments: 0,
      verifiedPlaceIDs: [], targetSetSHA256: sha(stable(targets.map(target => ({ path: target.path, payload: target.payload })))) });
    stage = 'firebase-identity';
    const config = JSON.parse(await readFile(new URL('../firebase/web-config.json', import.meta.url), 'utf8'));
    check(config.projectId === PROJECT && inventory.edition === 'STANDARD', 'Unexpected Firebase project or edition.');
    setLogLevel('silent');
    app = initializeApp(config, `readonly-hours-${Date.now()}`);
    db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true }, DATABASE);
    stage = 'exact-public-profiles';
    const profileHashes = [];
    for (let offset = 0; offset < targets.length; offset += 4) {
      const batch = targets.slice(offset, offset + 4), reads = await boundedReads(db, batch);
      const failed = reads.flatMap((read, index) => read.status === 'rejected' ? [batch[index].path.split('/')[1]] : []);
      if (failed.length) {
        result.failedPlaceIDs = failed;
        throw reads.find(read => read.status === 'rejected').reason;
      }
      for (const read of reads) {
        const value = read.value;
        result.verifiedProfiles++; result.facts += value.facts; result.sources += value.sources; result.comments += value.comments;
        result.verifiedPlaceIDs.push(value.placeID); profileHashes.push({ placeID: value.placeID, profileSHA256: value.profileSHA256 });
      }
    }
    check(result.verifiedProfiles === expectedTargets, 'Public verification did not cover every target.');
    result.profileSetSHA256 = sha(stable(profileHashes)); result.status = 'passed';
  } catch (error) {
    result.status = 'failed'; result.failedStage = stage;
    result.error = error instanceof VerificationError
      ? { kind: 'validation', message: error.message }
      : { kind: 'provider-or-input', code: providerCode(error), message: 'Details omitted; no sign-in or database write was attempted.' };
    process.exitCode = 1;
  } finally {
    if (db) await terminate(db).catch(() => {});
    if (app) await deleteApp(app).catch(() => {});
    result.completedAt = new Date().toISOString();
    if (output) {
      try { await output.writeFile(JSON.stringify(result, null, 2) + '\n'); await output.sync(); }
      catch { result.status = 'failed'; result.failedStage = 'save-public-result'; process.exitCode = 1; }
      finally { await output.close().catch(() => {}); }
    }
  }
  console.log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await run();
