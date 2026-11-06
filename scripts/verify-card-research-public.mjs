/** Signed-out exact document reads only. Never initializes Auth or performs writes. */
import { readFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { collection, doc, getDocFromServer, getDocsFromServer, initializeFirestore, limit, query, setLogLevel, terminate } from 'firebase/firestore';
import { decodeCardResearch } from '../lib/card-research-model.ts';
import { stable } from './research-map-model.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const check = (value, message) => { if (!value) throw Error(message); };
const sourceSHA = 'adee7ab48de4bbf78d8286c150f9a1d7b7f392490c4c7de2c224a021719c4b74';
const [packetPath, applyPath, outputPath, expectedSHA] = process.argv.slice(2);
check(packetPath && applyPath && outputPath && /^[a-f0-9]{64}$/.test(expectedSHA ?? ''), 'Packet, completed apply receipt, new output and exact packet hash required.');
check(new Set([packetPath, applyPath, outputPath]).size === 3, 'Input and output must differ.');
check(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Use only explicitly live verification here.');
let app, db, stage = 'validation';
const result = { project: 'nye-restroom', signedOut: true, authAccountsCreated: 0, productionWrites: 0, status: 'preparing', startedAt: new Date().toISOString() };
async function save() { const fd = await open(outputPath, 'wx', 0o600); try { await fd.writeFile(JSON.stringify(result, null, 2) + '\n'); } finally { await fd.close(); } }
try {
  const text = await readFile(packetPath, 'utf8'), packet = JSON.parse(text), applied = JSON.parse(await readFile(applyPath, 'utf8'));
  check(hash(text) === expectedSHA && applied.project === 'nye-restroom' && applied.database === '(default)'
    && applied.mode === 'apply' && applied.status === 'complete' && applied.packetHash === expectedSHA
    && applied.sourceManifestSHA256 === sourceSHA && Array.isArray(applied.pendingPaths) && applied.pendingPaths.length === 0,
  'A completed exact-packet import is required.');
  check(packet.schemaVersion === 1 && packet.manifestSHA256 === sourceSHA && Array.isArray(packet.profiles)
    && packet.profiles.length > 0 && packet.profiles.length <= 5000 && applied.targets === packet.profiles.length
    && new Set(packet.profiles.map(profile => profile.placeID)).size === packet.profiles.length, 'Unexpected public packet.');
  result.packetSHA256 = expectedSHA;
  const config = JSON.parse(await readFile(new URL('../firebase/web-config.json', import.meta.url), 'utf8'));
  check(config.projectId === 'nye-restroom', 'Unexpected Firebase identity.');
  setLogLevel('silent'); app = initializeApp(config, `readonly-card-research-${Date.now()}`); db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  stage = 'exact-public-profiles'; result.profiles = 0; result.facts = 0; result.comments = 0; result.sources = 0;
  for (const expected of packet.profiles) {
    const snap = await getDocFromServer(doc(db, 'restroomResearchProfiles', expected.placeID));
    check(snap.exists() && !snap.metadata.fromCache && !snap.metadata.hasPendingWrites, 'A card profile was not confirmed by the live server.');
    const decoded = decodeCardResearch(expected.placeID, snap.data());
    check(stable(decoded) === stable(expected), 'A live profile differs from the reviewed card facts.');
    result.profiles++; result.facts += decoded.facts.length; result.comments += decoded.comments.length; result.sources += decoded.sources.length;
    if (result.profiles % 100 === 0) console.log(JSON.stringify({ stage, read: result.profiles, expected: packet.profiles.length }));
  }
  stage = 'enumeration-and-private-denial'; result.denied = 0;
  for (const read of [
    () => getDocsFromServer(query(collection(db, 'restroomResearchProfiles'), limit(1))),
    () => getDocFromServer(doc(db, 'restroomResearch', 'research-map-2026-10-24')),
  ]) {
    let denied = false;
    try { await read(); } catch (error) { check(error.code === 'permission-denied', 'A denial check failed for another reason.'); denied = true; }
    check(denied, 'Unexpected enumeration or private research access.'); result.denied++;
  }
  result.status = 'passed'; result.completedAt = new Date().toISOString(); await save(); console.log(JSON.stringify(result));
} catch {
  result.status = 'failed'; result.failedStage = stage; result.completedAt = new Date().toISOString(); await save().catch(() => {});
  console.error(`Signed-out card research verification failed at ${stage}; no write or sign-in was attempted.`); process.exitCode = 1;
} finally { if (db) await terminate(db).catch(() => {}); if (app) await deleteApp(app).catch(() => {}); }
