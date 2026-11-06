import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { buildHoursTargets, checkedHoursPath, hoursTargetMatches, planHoursImport } from '../scripts/hours-research-model.mjs';
import { run } from '../scripts/import-hours-research.mjs';
import { ROOT, encode, dataOf, sha, stable } from '../scripts/research-map-model.mjs';
import { decodeCardResearch } from '../lib/card-research-model.ts';

const placeID = 'community-0123456789abcdef0123';
const id = n => n.toString(16).padStart(20, '0');
const timestamp = '2026-11-05T06:00:00.123456Z';
const rawDocument = (path, data, updateTime = timestamp) => ({ name: `${ROOT}/${path}`,
  fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)])),
  createTime: '2026-10-20T01:00:00.000000Z', updateTime });
function oldProfile() {
  return { schemaVersion: 1, placeID, manifestSHA256: 'a'.repeat(64), generatedAt: '2026-10-24T07:00:00Z',
    sources: [{ id: id(1), label: 'Reddit', title: 'Older exact source', url: 'https://www.reddit.com/r/example/comments/fixture/',
      kind: 'social-comment', publishedOn: '2026-01-02', displayedDate: 'January 2, 2026', observedOn: null,
      retrievedAt: '2026-10-24T05:00:00Z', limitations: 'Historical source report, not a current inspection.' }],
    facts: [
      { id: id(2), field: 'passcode', label: 'Code reported online', value: 'fixture-only', scope: 'restroom', sourceID: id(1), section: 'passcodes', context: '' },
      { id: id(3), field: 'elevatorToRestroom', label: 'Elevator to restroom', value: 'yes', scope: 'route', sourceID: id(1), section: 'entryRoute', context: '' },
      { id: id(4), field: 'hours', label: 'Listed hours', value: 'Not reported', scope: 'restroom', sourceID: id(1), section: 'hours', context: '' }
    ], comments: [{ id: id(5), text: 'Existing public comment remains exact.', sourceID: id(1) }], coveredCommentIDs: [id(1)] };
}
function fixture() {
  const place = { id: placeID, sourceKind: 'community', name: 'Exact branch', address: '1 Example Street, New York, NY',
    latitude: 40.75, longitude: -73.99, directHours: null, scheduleFacts: [], needsHoursResearch: true };
  const inventory = { schemaVersion: 1, project: 'nye-restroom', databaseID: '(default)', edition: 'STANDARD',
    readTime: '2026-11-05T06:20:00Z', total: 1, city: 0, community: 1, profiles: 1, places: [place] };
  const profile = oldProfile();
  const preimages = { project: 'nye-restroom', databaseID: '(default)', readTime: '2026-11-05T06:20:00Z',
    collections: { communityRestrooms: [rawDocument(`communityRestrooms/${placeID}`, { name: place.name, address: place.address,
      latitude: place.latitude, longitude: place.longitude, notes: 'Existing public location notes.' })],
    restroomAccessDetails: [], restroomResearchProfiles: [rawDocument(`restroomResearchProfiles/${placeID}`, profile)] } };
  const entry = { placeID, name: place.name, address: place.address, status: 'found', field: 'venueHours',
    schedule: 'Mon–Fri: 9am–5pm; Sat: 10am–4pm; Sun: Closed', sourceURL: 'https://operator.example.org/exact-branch',
    sourceTitle: 'Exact branch opening hours', retrievedAt: '2026-11-05T07:00:00Z', publishedOn: null,
    sourceExcerpt: 'Published branch schedule.', limitations: 'Venue hours; restroom opening hours remain unconfirmed.',
    evidenceURLs: ['https://operator.example.org/exact-branch'] };
  const packet = { schemaVersion: 1, inventorySHA256: sha(stable(inventory)), reviewedAt: '2026-11-05T07:30:00Z', entries: [entry] };
  return { place, profile, inventory, preimages, entry, packet };
}
function prepare(f) {
  f.packet.inventorySHA256 = sha(stable(f.inventory));
  const packetHash = sha(stable(f.packet)), preimagesHash = sha(stable(f.preimages));
  return { ...buildHoursTargets(f.packet, f.inventory, f.preimages, f.packet.inventorySHA256, packetHash), packetHash, preimagesHash };
}
function memoryStore(f) {
  const documents = new Map(Object.values(f.preimages.collections).flat().map(document => [document.name.slice(ROOT.length + 1), structuredClone(document)]));
  let commits = 0;
  return { documents, get commits() { return commits; }, get: async path => structuredClone(documents.get(path) ?? null),
    async commit(writes) {
      for (const write of writes) {
        assert.ok(write.update.name.startsWith(`${ROOT}/restroomResearchProfiles/`));
        const path = write.update.name.slice(ROOT.length + 1), before = documents.get(path);
        if (write.currentDocument.exists === false) assert.equal(before, undefined, 'create precondition');
        else assert.equal(before?.updateTime, write.currentDocument.updateTime, 'update precondition');
      }
      commits++;
      for (const write of writes) {
        const path = write.update.name.slice(ROOT.length + 1), before = documents.get(path);
        const fields = write.updateMask ? { ...before.fields, ...write.update.fields } : write.update.fields;
        documents.set(path, { name: write.update.name, fields, createTime: before?.createTime ?? timestamp,
          updateTime: `2026-11-05T07:40:${String(commits).padStart(2, '0')}.000000Z` });
      }
    } };
}

test('appending hours preserves all old facts, sources, comments, coverage, and date boundaries', () => {
  const f = fixture(), { targets, packetHash } = prepare(f), target = targets[0];
  assert.equal(targets.length, 1);
  assert.deepEqual(target.payload.facts.slice(0, 3), f.profile.facts);
  assert.deepEqual(target.payload.sources.slice(0, 1), f.profile.sources);
  assert.deepEqual(target.payload.comments, f.profile.comments);
  assert.deepEqual(target.payload.coveredCommentIDs, f.profile.coveredCommentIDs);
  assert.equal(target.payload.manifestSHA256, packetHash); assert.equal(target.payload.generatedAt, f.packet.reviewedAt);
  const source = target.payload.sources.at(-1), fact = target.payload.facts.at(-1);
  assert.equal(source.observedOn, null); assert.equal(source.publishedOn, null);
  assert.equal(source.retrievedAt, f.entry.retrievedAt); assert.match(source.limitations, /not a visit or inspection/);
  assert.equal(fact.field, 'venueHours'); assert.equal(fact.scope, 'venue'); assert.equal(fact.context, '');
  assert.deepEqual(decodeCardResearch(placeID, target.payload), target.payload);
  assert.deepEqual(f.preimages.collections.restroomResearchProfiles[0], target.before);
});

test('existing updates mask only the four append/compilation fields and pin the exact original updateTime', async () => {
  const f = fixture(), prepared = prepare(f), store = memoryStore(f);
  const plan = await planHoursImport(prepared.targets, prepared.packetHash, prepared.preimagesHash, store);
  assert.equal(plan.writes.length, 1);
  assert.deepEqual(plan.writes[0].currentDocument, { updateTime: timestamp });
  assert.deepEqual(plan.writes[0].updateMask.fieldPaths, ['sources', 'facts', 'generatedAt', 'manifestSHA256']);
  assert.deepEqual(Object.keys(plan.writes[0].update.fields), ['sources', 'facts', 'generatedAt', 'manifestSHA256']);
  await store.commit(plan.writes);
  assert.equal(hoursTargetMatches(prepared.targets[0], await store.get(prepared.targets[0].path)), true);
  const replay = await planHoursImport(prepared.targets, prepared.packetHash, prepared.preimagesHash, store);
  assert.equal(replay.writes.length, 0);
  assert.deepEqual(dataOf(await store.get(prepared.targets[0].path)).comments, f.profile.comments);
});

test('a missing profile can only be created, retaining the exact public location ID', async () => {
  const f = fixture(); f.preimages.collections.restroomResearchProfiles = []; f.inventory.profiles = 0;
  const p = prepare(f), store = memoryStore(f), plan = await planHoursImport(p.targets, p.packetHash, p.preimagesHash, store);
  assert.deepEqual(plan.writes[0].currentDocument, { exists: false }); assert.equal(plan.writes[0].updateMask, undefined);
  assert.equal(plan.writes[0].update.name, `${ROOT}/restroomResearchProfiles/${placeID}`);
  assert.deepEqual(p.targets[0].payload.comments, []); assert.deepEqual(p.targets[0].payload.coveredCommentIDs, []);
  await store.commit(plan.writes); assert.equal((await planHoursImport(p.targets, p.packetHash, p.preimagesHash, store)).writes.length, 0);
});

test('partial or mixed-time inventory/preimage inputs cannot create a guessed baseline', () => {
  for (const mutate of [
    f => { f.inventory.total = 2; }, f => { f.inventory.community = 0; f.inventory.city = 1; },
    f => { f.preimages.readTime = '2026-11-05T06:21:00Z'; },
    f => { f.preimages.collections.restroomResearchProfiles = []; },
    f => { f.preimages.collections.communityRestrooms = []; },
    f => { f.preimages.collections.restroomResearchProfiles[0].createTime = '2026-11-06T00:00:00Z'; }
  ]) { const f = fixture(); mutate(f); assert.throws(() => prepare(f), /inventory|partial|snapshot|preimage/i); }
});

test('name/address/source identity, inventory binding and private or foreign paths fail closed', () => {
  for (const mutate of [
    f => { f.entry.name = 'Different branch'; }, f => { f.entry.address = 'Another address'; },
    f => { f.entry.placeID = '../ratings'; }, f => { f.preimages.project = 'other-project'; },
    f => { f.preimages.collections.communityRestrooms[0].fields.name = encode('New branch'); },
    f => { f.preimages.collections.restroomResearchProfiles[0].name = `${ROOT}/users/private`; },
    f => { f.entry.sourceURL = 'https://example.org/?token=private'; }, f => { f.entry.owner = 'hidden'; }
  ]) { const f = fixture(); mutate(f); assert.throws(() => prepare(f)); }
  const f = fixture(); assert.throws(() => buildHoursTargets(f.packet, f.inventory, f.preimages, 'b'.repeat(64), 'a'.repeat(64)), /exact fresh inventory/);
  for (const path of ['users/account', 'restroomResearchProfiles/../users', 'restroomResearchProfiles/x?y', 'restroomRatingSummaries/x']) {
    assert.throws(() => checkedHoursPath(path, true));
  }
});

test('known inventory, existing profile or direct access schedules cannot be overwritten', () => {
  for (const mutate of [
    f => { f.place.needsHoursResearch = false; }, f => { f.place.directHours = '9am–5pm'; },
    f => { f.place.scheduleFacts = [{ field: 'venueHours', value: '9am–5pm' }]; },
    f => { f.preimages.collections.restroomResearchProfiles[0].fields.facts = encode([...f.profile.facts,
      { ...f.profile.facts[2], id: id(99), value: 'Closed' }]); },
    f => { f.preimages.collections.restroomAccessDetails = [rawDocument(`restroomAccessDetails/${placeID}`, { restroomHours: '24/7' })]; }
  ]) { const f = fixture(); mutate(f); assert.throws(() => prepare(f), /known|Known|existing direct|ineligible/); }
});

test('venue/restroom scopes remain distinct; directory fallbacks are explicitly qualified', () => {
  for (const field of ['hours', 'restroomHours']) {
    const f = fixture(); f.entry.field = field;
    assert.equal(prepare(f).targets[0].payload.facts.at(-1).scope, 'restroom');
  }
  const f = fixture(); f.entry.sourceKind = 'directory';
  let target = prepare(f).targets[0]; assert.equal(target.payload.sources.at(-1).kind, 'directory');
  assert.match(target.payload.sources.at(-1).limitations, /Directory-listed venue hours; restroom hours remain unconfirmed/);
  f.entry.field = 'restroomHours'; assert.throws(() => prepare(f), /venue-only/);
});

test('missing or ambiguous schedules are skipped, while malformed evidence and future publication dates are rejected', () => {
  for (const status of ['not-found', 'ambiguous', 'closed']) {
    const f = fixture(); f.entry.status = status; f.entry.field = null; f.entry.schedule = null;
    const p = prepare(f); assert.equal(p.targets.length, 0); assert.equal(p.skipped.length, 1);
  }
  for (const mutate of [
    f => { f.entry.schedule = 'unknown'; }, f => { f.entry.schedule = 'x'.repeat(3001); },
    f => { f.entry.retrievedAt = '2026-11-06T00:00:00Z'; }, f => { f.entry.publishedOn = '2026-11-06'; },
    f => { f.entry.sourceKind = 'inspection'; }, f => { f.entry.sourceKind = 'official-dataset'; f.entry.publishedOn = '2026-11-04'; },
    f => { f.packet.entries.push(structuredClone(f.entry)); }
  ]) { const f = fixture(); mutate(f); assert.throws(() => prepare(f)); }
});

test('strict source, fact and UTF-8 document caps are enforced before any commit', () => {
  const sources = fixture(); const p = oldProfile();
  p.sources = Array.from({ length: 16 }, (_, n) => ({ ...p.sources[0], id: id(n + 1) }));
  sources.preimages.collections.restroomResearchProfiles[0].fields = rawDocument('unused', p).fields;
  assert.throws(() => prepare(sources));
  const facts = fixture(); const q = oldProfile();
  q.facts = Array.from({ length: 128 }, (_, n) => ({ ...q.facts[0], id: id(n + 100) }));
  facts.preimages.collections.restroomResearchProfiles[0].fields = rawDocument('unused', q).fields;
  assert.throws(() => prepare(facts));
  const bytes = fixture(); const large = oldProfile(); let next = 100;
  while (Buffer.byteLength(JSON.stringify(large)) < 128_500) {
    large.facts.push({ ...large.facts[1], id: id(next++), field: 'accessNotes', label: 'Access details', value: 'x'.repeat(2800), context: '' });
  }
  decodeCardResearch(placeID, large);
  bytes.entry.schedule = 'x'.repeat(3000); bytes.preimages.collections.restroomResearchProfiles[0].fields = rawDocument('unused', large).fields;
  assert.throws(() => prepare(bytes));
});

test('fresh plan hashes bind original versions, guard documents and packet; concurrent changes refuse overwrite', async () => {
  const f = fixture(), p = prepare(f), store = memoryStore(f);
  const first = await planHoursImport(p.targets, p.packetHash, p.preimagesHash, store);
  assert.equal((await planHoursImport(p.targets, p.packetHash, p.preimagesHash, store)).planSHA256, first.planSHA256);
  assert.notEqual((await planHoursImport(p.targets, 'b'.repeat(64), p.preimagesHash, store)).planSHA256, first.planSHA256);
  const changed = structuredClone(store.documents.get(p.targets[0].path)); changed.updateTime = '2026-11-05T06:01:00Z';
  store.documents.set(p.targets[0].path, changed);
  await assert.rejects(planHoursImport(p.targets, p.packetHash, p.preimagesHash, store), /preimage changed/);
  await assert.rejects(store.commit(first.writes), /update precondition/);
  const fresh = memoryStore(f); fresh.documents.set(`restroomAccessDetails/${placeID}`, rawDocument(`restroomAccessDetails/${placeID}`, { restroomHours: '9–5' }));
  await assert.rejects(planHoursImport(p.targets, p.packetHash, p.preimagesHash, fresh), /direct-hours preimage changed/);
  assert.equal(store.commits, 0); assert.equal(fresh.commits, 0);
});

async function operationFixture() {
  await mkdir(resolve('.firebase-agent'), { recursive: true });
  const folder = await mkdtemp(resolve('.firebase-agent/hours-import-test-'));
  const f = fixture(), store = memoryStore(f); prepare(f);
  for (const [name, value] of [['findings', f.packet], ['inventory', f.inventory], ['preimages', f.preimages]]) await writeFile(join(folder, name + '.json'), stable(value));
  let sequence = 0;
  const args = (mode, extra = []) => { const suffix = ++sequence; return [mode, '--findings', join(folder, 'findings.json'),
    '--inventory', join(folder, 'inventory.json'), '--preimages', join(folder, 'preimages.json'),
    '--snapshot', join(folder, `backup-${suffix}.json`), '--report', join(folder, `receipt-${suffix}.json`), ...extra]; };
  return { f, folder, store, args };
}

test('CLI preview is zero-write; reviewed apply reads back, stores private backups, and replay verifies without writes', async () => {
  const f = await operationFixture();
  try {
    const argv = f.args('preview'), preview = await run(argv, { store: f.store }); assert.equal(f.store.commits, 0);
    assert.equal((await stat(argv[argv.indexOf('--snapshot') + 1])).mode & 0o777, 0o600);
    const apply = await run(f.args('apply', ['--expected-sha', preview.packetHash, '--expected-plan-sha', preview.planSHA256]), { store: f.store });
    assert.equal(apply.status, 'complete'); assert.equal(apply.committedPaths.length, 1); assert.equal(f.store.commits, 1);
    const replay = await run(f.args('preview'), { store: f.store }); assert.equal(replay.plannedWrites, 0);
    const zero = await run(f.args('apply', ['--expected-sha', replay.packetHash, '--expected-plan-sha', replay.planSHA256]), { store: f.store });
    assert.equal(zero.committedPaths.length, 0); assert.equal(f.store.commits, 1);
    assert.equal((await run(f.args('verify'), { store: f.store })).status, 'verified');
  } finally { await rm(f.folder, { recursive: true, force: true }); }
});

test('CLI rejects unreviewed/stale plans and public backups without committing', async () => {
  const f = await operationFixture();
  try {
    await assert.rejects(run(f.args('apply'), { store: f.store }), /reviewed packet SHA/);
    const preview = await run(f.args('preview'), { store: f.store });
    await assert.rejects(run(f.args('apply', ['--expected-sha', 'b'.repeat(64), '--expected-plan-sha', preview.planSHA256]), { store: f.store }), /reviewed SHA/);
    await assert.rejects(run(f.args('apply', ['--expected-sha', preview.packetHash, '--expected-plan-sha', 'b'.repeat(64)]), { store: f.store }), /preview-plan SHA/);
    const argv = f.args('preview'); argv[argv.indexOf('--snapshot') + 1] = resolve('data/public-backup.json');
    await assert.rejects(run(argv, { store: f.store }), /ignored .firebase-agent/);
    assert.equal(f.store.commits, 0);
  } finally { await rm(f.folder, { recursive: true, force: true }); }
});

test('uncertain commits retain pending receipt paths and redact provider errors for reconciliation', async () => {
  const f = await operationFixture();
  try {
    const preview = await run(f.args('preview'), { store: f.store });
    const argv = f.args('apply', ['--expected-sha', preview.packetHash, '--expected-plan-sha', preview.planSHA256]);
    const original = f.store.commit; f.store.commit = async writes => { await original.call(f.store, writes); throw new Error('provider-private-content'); };
    await assert.rejects(run(argv, { store: f.store }), error => !error.message.includes('provider-private-content') && /provider details omitted/.test(error.message));
    const receipt = JSON.parse(await readFile(argv[argv.indexOf('--report') + 1], 'utf8'));
    assert.equal(receipt.status, 'commit-outcome-unknown'); assert.equal(receipt.requiresReconciliation, true);
    assert.equal(receipt.pendingPaths.length, 1); assert.equal(receipt.committedPaths.length, 0);
  } finally { await rm(f.folder, { recursive: true, force: true }); }
});

test('existing operational receipt stays byte-exact and a failed readback cannot claim completion', async () => {
  const f = await operationFixture();
  try {
    const argv = f.args('preview'), reportPath = argv[argv.indexOf('--report') + 1];
    const sentinel = '{"earlier":"reviewed receipt"}\n'; await writeFile(reportPath, sentinel);
    await assert.rejects(run(argv, { store: f.store }));
    assert.equal(await readFile(reportPath, 'utf8'), sentinel); assert.equal(f.store.commits, 0);
    const preview = await run(f.args('preview'), { store: f.store });
    const commit = f.store.commit; f.store.commit = async writes => {
      await commit.call(f.store, writes);
      const doc = f.store.documents.get(`restroomResearchProfiles/${placeID}`);
      doc.fields.comments = encode([]);
    };
    const apply = f.args('apply', ['--expected-sha', preview.packetHash, '--expected-plan-sha', preview.planSHA256]);
    await assert.rejects(run(apply, { store: f.store }), /exact server readback/);
    const receipt = JSON.parse(await readFile(apply[apply.indexOf('--report') + 1], 'utf8'));
    assert.equal(receipt.status, 'failed'); assert.equal(receipt.failedStage, 'exact-readback');
    assert.equal(receipt.requiresReconciliation, true);
  } finally { await rm(f.folder, { recursive: true, force: true }); }
});
