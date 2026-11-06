import assert from 'node:assert/strict';
import test from 'node:test';
import { planCardImport, run } from '../scripts/import-card-research.mjs';
import { ROOT, createWrite, encode } from '../scripts/research-map-model.mjs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const profile = { schemaVersion: 1, placeID: 'city-fixture', facts: [], sources: [] };
const target = { path: 'restroomResearchProfiles/city-fixture', payload: profile, timestampFields: [], serverFields: [] };
const stored = createWrite(target).update;

test('a first card import can only create an exact public projection; replay makes no writes', async () => {
  const plan = await planCardImport([target], 'a'.repeat(64), { get: async () => null });
  assert.equal(plan.writes.length, 1);
  assert.equal(plan.writes[0].update.name, `${ROOT}/restroomResearchProfiles/city-fixture`);
  assert.deepEqual(plan.writes[0].currentDocument, { exists: false });
  assert.equal((await planCardImport([target], 'a'.repeat(64), { get: async () => stored })).writes.length, 0);
});
test('an existing different profile stops instead of overwriting an independently updated card', async () => {
  const changed = createWrite({ ...target, payload: { ...profile, facts: ['Different source fact'] } }).update;
  await assert.rejects(planCardImport([target], 'a'.repeat(64), { get: async () => changed }), /rather than overwrite/);
});
test('the reviewed plan binds complete preimages, the packet and exact target identity', async () => {
  const empty = { get: async () => null }, full = { get: async () => stored };
  const a = await planCardImport([target], 'a'.repeat(64), empty);
  assert.equal((await planCardImport([target], 'a'.repeat(64), empty)).planSHA256, a.planSHA256);
  assert.notEqual((await planCardImport([target], 'b'.repeat(64), empty)).planSHA256, a.planSHA256);
  assert.notEqual((await planCardImport([target], 'a'.repeat(64), full)).planSHA256, a.planSHA256);
});
test('an existing operational receipt stays byte-exact when exclusive creation fails before any commit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rr-card-import-receipt-'));
  const output = join(directory, 'existing.json'), backup = join(directory, 'backup.json');
  const sentinel = '{"previous":"independently reviewed receipt"}\n';
  let commits = 0;
  try {
    await writeFile(output, sentinel);
    const inventory = JSON.parse(await readFile(new URL('../data/research-map-2026-10-24/map-inventory.json', import.meta.url), 'utf8'));
    const byID = new Map(inventory.places.map(place => [place.id, place]));
    const store = { api: { post: async () => { commits++; } }, get: async path => {
      if (!path.startsWith('communityRestrooms/')) return null;
      const place = byID.get(path.split('/').at(-1));
      return { fields: Object.fromEntries(Object.entries(place.baseRecord).map(([key, value]) => [key, encode(value)])) };
    } };
    await assert.rejects(run(['preview', '--profiles', resolve('data/research-map-2026-10-24/public-card-profiles.json'),
      '--inventory', resolve('data/research-map-2026-10-24/map-inventory.json'), '--source-manifest', resolve('data/research-map-2026-10-24/manifest.json'),
      '--snapshot', backup, '--report', output, '--firebase-tools-dir', directory], { store }));
    assert.equal(await readFile(output, 'utf8'), sentinel); assert.equal(commits, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
