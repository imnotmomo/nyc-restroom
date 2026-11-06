import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { loadBindings, transform } from 'next/dist/build/swc/index.js';
import { desiredTargets } from '../scripts/research-map-model.mjs';

const require = createRequire(import.meta.url);
await loadBindings();
const source = await readFile(new URL('../lib/card-research-model.ts', import.meta.url), 'utf8');
const compiled = await transform(source, { filename: 'card-research-model.ts',
  jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' } });
const module = { exports: {} };
new Function('module', 'exports', 'require', compiled.code)(module, module.exports, require);
const model = module.exports;
const path = new URL('../data/research-map-2026-10-24/', import.meta.url);
const bundleText = await readFile(new URL('public-card-profiles.json', path), 'utf8');
const bundle = JSON.parse(bundleText), manifest = JSON.parse(await readFile(new URL('manifest.json', path), 'utf8'));
const inventory = JSON.parse(await readFile(new URL('map-inventory.json', path), 'utf8'));
const frozenSHA = 'adee7ab48de4bbf78d8286c150f9a1d7b7f392490c4c7de2c224a021719c4b74';
const id = n => n.toString(16).padStart(20, '0');
const copy = value => structuredClone(value);
const fixture = () => ({ schemaVersion: 1, placeID: 'community-example', manifestSHA256: frozenSHA,
  generatedAt: '2026-10-24T07:00:00.000000001Z',
  sources: [{ id: id(1), label: 'Example museum', title: 'Official access information', url: 'https://museum.example.org/access/',
    kind: 'official-page', publishedOn: null, displayedDate: 'Date unknown', observedOn: null,
    retrievedAt: '2026-10-24T07:00:00.000000000Z', limitations: 'Building access does not establish a restroom route or current inspection.' }],
  facts: [{ id: id(2), field: 'buildingAccessibility', label: 'Building accessibility', value: 'Wheelchair-accessible building',
    scope: 'building', sourceID: id(1), section: 'amenities', context: '' }], comments: [], coveredCommentIDs: [id(1)] });
const decode = value => model.decodeCardResearch('community-example', value);

test('the entire exact public artifact decodes and retains its deterministic profile/source identity', () => {
  assert.deepEqual(Object.keys(bundle).sort(), ['schemaVersion', 'manifestSHA256', 'profiles'].sort());
  assert.equal(bundle.manifestSHA256, frozenSHA); assert.equal(bundle.profiles.length, 1146);
  assert.equal(new Set(bundle.profiles.map(profile => profile.placeID)).size, 1146);
  const entries = new Map(manifest.entries.map(entry => [entry.id, entry]));
  const publicIDs = desiredTargets(manifest).filter(target => target.path.startsWith('restroomSourceComments/')).map(target => target.path.split('/').at(-1)).sort();
  const covered = [];
  for (const profile of bundle.profiles) {
    assert.deepEqual(model.decodeCardResearch(profile.placeID, profile), profile);
    assert.equal(profile.generatedAt, manifest.reviewedAt);
    for (const source of profile.sources) {
      const entry = entries.get(source.id); assert.ok(entry); assert.equal(entry.placeID, profile.placeID);
      assert.equal(source.url, entry.sourceURL); assert.equal(source.publishedOn, entry.publishedOn);
      assert.equal(source.retrievedAt, entry.retrievedAt); assert.equal(source.limitations, entry.limitations);
      assert.equal(source.displayedDate, entry.originalTimestamp || 'Date unknown');
      assert.equal(source.observedOn, entry.evidenceType === 'inspection' ? entry.facts.find(fact => fact.field === 'inspectionDate').value : null);
    }
    covered.push(...profile.coveredCommentIDs);
  }
  assert.deepEqual(covered.sort(), publicIDs); assert.equal(covered.length, 863);
  const cityIDs = inventory.places.filter(place => place.sourceKind === 'city').map(place => place.id).sort();
  assert.deepEqual(bundle.profiles.filter(profile => profile.placeID.startsWith('i7jb-7jku:')).map(profile => profile.placeID).sort(), cityIDs);
});

test('strict exact schemas reject unknown/missing account, author, verification and arbitrary nested fields', () => {
  const value = fixture(); assert.deepEqual(decode(value), value);
  for (const key of Object.keys(value)) { const bad = fixture(); delete bad[key]; assert.throws(() => decode(bad)); }
  for (const field of ['uid', 'ownerUID', 'email', 'authorName', 'ratingCount', 'lastVerifiedAt', 'private']) {
    assert.throws(() => decode({ ...fixture(), [field]: 'not-public' }));
    const bad = fixture(); bad.sources[0][field] = 'not-public'; assert.throws(() => decode(bad));
  }
  for (const location of ['sources', 'facts']) for (const key of Object.keys(value[location][0])) {
    const bad = fixture(); delete bad[location][0][key]; assert.throws(() => decode(bad));
  }
  const note = fixture(); note.sources[0].kind = 'social-comment'; note.comments = [{ id: id(3), sourceID: id(1), text: 'A dated source claim, not a confirmed visit.' }];
  assert.equal(decode(note).comments.length, 1);
  for (const key of Object.keys(note.comments[0])) { const bad = copy(note); delete bad.comments[0][key]; assert.throws(() => decode(bad)); }
  assert.throws(() => decode({ ...fixture(), placeID: 'community-other' }));
  for (const place of ['', '../users/private', 'name with spaces', 'x'.repeat(161)]) assert.throws(() => model.decodeCardResearch(place, fixture()));
});

test('calendar and nanosecond boundaries never turn compilation or dataset metadata into a source observation', () => {
  const value = fixture();
  for (const date of ['2026-02-29', '2026-04-31', '2026-1-1', '1999-12-31', '2026-10-25']) {
    const bad = copy(value); bad.sources[0].publishedOn = date; assert.throws(() => decode(bad));
    bad.sources[0].publishedOn = null; bad.sources[0].observedOn = date; assert.throws(() => decode(bad));
  }
  for (const instant of ['2026-02-30T07:00:00Z', '2026-10-24T24:00:00Z', '2026-10-24', '2026-10-24T07:00:00+00:00']) {
    const bad = copy(value); bad.generatedAt = instant; assert.throws(() => decode(bad));
  }
  const nextNano = copy(value); nextNano.sources[0].retrievedAt = '2026-10-24T07:00:00.000000002Z'; assert.throws(() => decode(nextNano));
  for (const kind of ['official-dataset', 'inspection']) {
    const bad = copy(value); bad.sources[0].kind = kind; bad.sources[0].publishedOn = '2024-05-21'; assert.throws(() => decode(bad));
  }
  const inspected = copy(value); inspected.sources[0].kind = 'inspection'; assert.throws(() => decode(inspected));
  inspected.sources[0].observedOn = '2016-03-30'; assert.equal(decode(inspected).sources[0].observedOn, '2016-03-30');
  assert.equal(model.cardResearchCaption(value.sources[0]), 'From Example museum · Date unknown');
  assert.equal(model.cardResearchCaption(inspected.sources[0]), 'From Example museum · Inspected Mar 30, 2016');
  const dated = copy(value); dated.sources[0].publishedOn = '2025-11-11';
  assert.equal(model.cardResearchCaption(dated.sources[0]), 'From Example museum · Nov 11, 2025');
  assert.equal(model.formatCardResearchDate('2026-07-27'), 'Jul 27, 2026');
});

test('URLs are safe public HTTPS links and source content remains literal plain text', () => {
  for (const url of ['javascript:alert(1)', 'http://example.org', 'https://u:p@example.org', 'https://127.1/',
    'https://host.local/', 'https://[::1]/', 'https://example.org:8443/', 'https://example.org/a b', 'https://example.org/?xsec_token=private']) {
    const bad = fixture(); bad.sources[0].url = url; assert.throws(() => decode(bad));
  }
  const value = fixture(); value.facts[0].value = '<script>literal source claim</script>';
  assert.equal(decode(value).facts[0].value, value.facts[0].value);
  for (const text of ['bad\u0000text', 'bad\u0085text', 'untranslated 中文']) {
    const bad = fixture(); bad.facts[0].value = text; assert.throws(() => decode(bad));
  }
});

test('all cross-references, uniqueness, enum/section and explicit venue/building scopes are enforced', () => {
  for (const mutate of [v => v.sources.push(copy(v.sources[0])), v => v.facts.push(copy(v.facts[0])),
    v => v.coveredCommentIDs.push(v.coveredCommentIDs[0]), v => v.facts[0].sourceID = id(999),
    v => v.coveredCommentIDs.push(id(999)), v => v.sources[0].kind = 'verified-visit',
    v => v.facts[0].section = 'passcodes', v => v.facts[0].scope = 'unknown',
    v => v.facts[0].field = '__proto__', v => v.facts[0].scope = 'restroom']) {
    const bad = fixture(); mutate(bad); assert.throws(() => decode(bad));
  }
  const venue = fixture(); Object.assign(venue.facts[0], { field: 'venueHours', label: 'Venue hours', value: '10am–6pm', scope: 'venue', section: 'hours' });
  assert.equal(decode(venue).facts[0].scope, 'venue'); venue.facts[0].scope = 'restroom'; assert.throws(() => decode(venue));
  assert.deepEqual(model.factsForSection(decode(fixture()), 'hours'), []);
  assert.equal(model.sourceForFact(decode(fixture()), fixture().facts[0]).id, id(1));
  assert.throws(() => model.sourceForFact(decode(fixture()), { ...fixture().facts[0], sourceID: id(999) }));
});

test('bounded public arrays/text fail closed rather than truncating source evidence', () => {
  for (const [key, maximum, item] of [['sources', 16, fixture().sources[0]], ['facts', 128, fixture().facts[0]],
    ['comments', 32, { id: id(5), sourceID: id(1), text: 'Source narrative.' }], ['coveredCommentIDs', 32, id(1)]]) {
    const bad = fixture(); bad[key] = Array.from({ length: maximum + 1 }, () => copy(item)); assert.throws(() => decode(bad));
  }
  for (const [key, maximum] of [['label', 100], ['value', 3000], ['context', 100]]) {
    const bad = fixture(); bad.facts[0][key] = 'x'.repeat(maximum + 1); assert.throws(() => decode(bad));
  }
  const bad = fixture(); bad.facts = []; assert.throws(() => decode(bad));
});

test('all original meaningful facts, scope corrections, historical code claims and external scores remain source-bound', () => {
  const byID = new Map(bundle.profiles.map(profile => [profile.placeID, profile]));
  for (const entry of manifest.entries) for (const original of entry.facts) {
    if (original.field === 'identity') continue;
    const expected = typeof original.value === 'boolean' ? original.value ? 'Yes' : 'No' : String(original.value);
    const fact = byID.get(entry.placeID)?.facts.find(fact => fact.sourceID === entry.id && fact.field === original.field && fact.value === expected);
    assert.ok(fact, `Missing ${original.field} source fact`);
    assert.equal(fact.scope, original.field === 'venueHours' ? 'venue' : original.field === 'buildingAccessibility' ? 'building' : original.scope);
  }
  const facts = bundle.profiles.flatMap(profile => profile.facts);
  assert.equal(facts.filter(fact => fact.field === 'passcode').length, 15);
  assert.equal(facts.filter(fact => fact.field === 'sourceRating').length, 2);
  assert.ok(facts.filter(fact => fact.field === 'sourceRating').every(fact => fact.scope === 'venue' && fact.section === 'ratings'));
  assert.equal(bundle.profiles.flatMap(profile => profile.comments).length, 9);
  for (const profile of bundle.profiles) for (const comment of profile.comments) assert.ok(profile.coveredCommentIDs.includes(comment.id));
  assert.ok(!JSON.stringify(bundle).includes('"ownerUID"')); assert.ok(!JSON.stringify(bundle).includes('"lastVerifiedAt"'));
});

test('every reviewed inspection room retains exact counts including zero, feature grades and issue details under its actual date', async () => {
  const details = [...JSON.parse(await readFile(new URL('parks/matched-inspection-details.json', path), 'utf8')),
    ...JSON.parse(await readFile(new URL('parks/building-supplement-details.json', path), 'utf8'))];
  const byID = new Map(bundle.profiles.map(profile => [profile.placeID, profile]));
  const labels = { handDryers: 'Hand dryers', changingTables: 'Changing tables', mirrors: 'Mirrors', urinals: 'Urinals', toilets: 'Toilets',
    sinks: 'Sinks', toiletPaperDispensers: 'Toilet paper dispensers', soapDispensers: 'Soap dispensers', paperTowelDispensers: 'Paper towel dispensers' };
  let roomCount = 0, zeroCount = 0;
  for (const detail of details) {
    const profile = byID.get(detail.placeID), source = profile.sources.find(source => source.kind === 'inspection');
    assert.equal(source.observedOn, detail.latestInspectionDate); assert.equal(source.publishedOn, null);
    assert.ok(profile.facts.some(fact => fact.field === 'conditionDetail' && fact.sourceID === source.id));
    for (const room of detail.roomEvidence) {
      roomCount++; const context = room.room === 'M1' ? 'Men’s room' : 'Women’s room';
      for (const [key, value] of Object.entries(room.fixtureCountsAtInspection)) {
        assert.ok(profile.facts.some(fact => fact.field === 'inspectionFixtureCount' && fact.sourceID === source.id
          && fact.context === context && fact.label === labels[key] && fact.value === String(value)));
        if (value === 0) zeroCount++;
      }
      for (const feature of room.features) if (feature.rating !== undefined && feature.rating !== null) {
        assert.ok(profile.facts.some(fact => fact.field === 'inspectionFeatureRating' && fact.sourceID === source.id
          && fact.context === context && fact.label === `${feature.feature_1} grade` && fact.value === feature.rating));
      }
      for (const issue of room.hazards) {
        const fact = profile.facts.find(fact => fact.field === 'inspectionIssue' && fact.sourceID === source.id
          && fact.context === context && fact.label === `${issue.class ? `${issue.class}: ` : ''}${issue.type || 'Type not reported'}`);
        assert.ok(fact);
        if (issue.location_comments) assert.ok(profile.facts.some(fact => fact.sourceID === source.id && fact.context === context && fact.value.includes(issue.location_comments)));
      }
    }
  }
  assert.equal(details.length, 635); assert.equal(roomCount, 1270); assert.ok(zeroCount > 0);
  assert.ok(bundle.profiles.flatMap(profile => profile.facts).filter(fact => fact.field === 'inspectionFixtureCount')
    .every(fact => /^\d+$/.test(fact.value) && !/stock|available|working/i.test(fact.value)));
  const unknownTypes = bundle.profiles.flatMap(profile => profile.facts).filter(fact => fact.field === 'inspectionIssue' && fact.label.endsWith('Type not reported'));
  assert.equal(unknownTypes.length, 3);
  assert.ok(unknownTypes.some(fact => fact.value.includes('Damaged door hinge.')));
  assert.ok(unknownTypes.some(fact => fact.value.includes('Workers cleaning litter during time of inspection.')));
  assert.ok(bundle.profiles.flatMap(profile => profile.facts).every(fact => !fact.label.includes('undefined')));
});

test('offline builder deterministically regenerates the reviewed artifact with no publication-date promotion', () => {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/build-card-research.mjs'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout.trim());
  assert.equal(receipt.outputSHA256, createHash('sha256').update(bundleText).digest('hex'));
  assert.equal(receipt.productionWrites, 0); assert.equal(receipt.profiles, 1146);
  assert.ok(bundle.profiles.flatMap(profile => profile.sources).filter(source => source.kind === 'official-dataset')
    .every(source => source.publishedOn === null && source.observedOn === null));
});
