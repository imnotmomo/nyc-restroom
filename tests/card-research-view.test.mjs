import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadBindings, transform } from 'next/dist/build/swc/index.js';

const require = createRequire(import.meta.url);
await loadBindings();
async function compile(relative, imports = {}) {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  const result = await transform(source, { filename: relative, jsc: { parser: { syntax: 'typescript', tsx: relative.endsWith('tsx') },
    target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.code)(module, module.exports, name => Object.hasOwn(imports, name) ? imports[name] : require(name));
  return module.exports;
}
const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
const model = await compile('../lib/card-research-model.ts');
const presentation = await compile('../lib/card-research-view.ts');
let listener, configured = true, stopped = false;
const sdk = { getFirestore: app => app, doc: (database, ...path) => ({ database, path }),
  onSnapshot: (reference, options, changed, failed) => { listener = { reference, options, changed, failed }; return () => { stopped = true; }; } };
const reader = await compile('../lib/card-research.ts', { 'firebase/firestore': sdk,
  '@/lib/firebase-client': { getFirebaseClient: () => configured ? { app: 'public-app' } : null }, '@/lib/card-research-model': model });
const researchUI = await compile('../components/finder/card-research.tsx', { '@/lib/card-research-model': model, '@/lib/card-research-view': presentation });
const oldSourceModel = await compile('../lib/source-reports.ts', { '@/data/research-2026/reports.json': JSON.parse(await readFile(new URL('../data/research-2026/reports.json', import.meta.url), 'utf8')) });
const oldSourceUI = await compile('../components/finder/source-reports.tsx', { '@/lib/source-reports': oldSourceModel, './source-reports.module.css': css });
const sourceCommentsModel = await compile('../lib/source-comments.ts', { '@/lib/firebase-client': { getFirebaseClient: () => null } });
const sourceComments = await compile('../components/finder/source-comments.tsx', { '@/lib/source-comments': sourceCommentsModel, './source-comments.module.css': css });
const restroomModel = await compile('../lib/restrooms.ts', { '@/data/nyc-restrooms/restrooms.json': JSON.parse(await readFile(new URL('../data/nyc-restrooms/restrooms.json', import.meta.url), 'utf8')) });
const accessModel = await compile('../lib/restroom-access-details-model.ts');
const accessibility = await compile('../lib/accessibility.ts');
const hoursModel = await compile('../lib/hours-schedule.ts');
const hoursClock = await compile('../components/finder/use-hours-date.ts', { '@/lib/hours-schedule': hoursModel });
const detail = await compile('../components/finder/detail.tsx', { '@/lib/restrooms': restroomModel, '@/lib/accessibility': accessibility,
  '@/components/finder/source-reports': oldSourceUI, '@/components/finder/source-comments': sourceComments,
  '@/lib/restroom-access-details-model': accessModel, '@/lib/card-research': reader, '@/lib/card-research-model': model,
  '@/lib/card-research-view': presentation, '@/components/finder/card-research': researchUI,
  '@/lib/hours-schedule': hoursModel, '@/components/finder/use-hours-date': hoursClock });
const id = n => n.toString(16).padStart(20, '0');
const placeID = 'community-0123456789abcdef0123';
const source = (n, patch = {}) => ({ id: id(n), label: 'Operator', title: 'Official exact branch page', url: 'https://example.org/branch',
  kind: 'official-page', publishedOn: null, displayedDate: 'Publication date not shown', observedOn: null,
  retrievedAt: '2026-10-24T04:00:00.000Z', limitations: 'Published information, not a current team visit.', ...patch });
const fact = (n, field, value, sourceID = id(1), scope = 'restroom', context = '') => ({ id: id(n), field,
  label: model.CARD_RESEARCH_FIELD_INFO[field].label, value, sourceID, scope, section: model.CARD_RESEARCH_FIELD_INFO[field].section, context });
function fixture() {
  return model.decodeCardResearch(placeID, { schemaVersion: 1, placeID, manifestSHA256: 'a'.repeat(64), generatedAt: '2026-10-24T05:00:00.000Z',
    sources: [source(1), source(2, { label: 'NYC Parks', kind: 'inspection', observedOn: '2026-07-27', displayedDate: 'Inspection: 2026-07-27' }),
      source(3, { label: 'Reddit', kind: 'social-comment', publishedOn: '2025-02-03', displayedDate: '2025-02-03' }), source(4, { label: 'Birdeye', kind: 'review' })],
    facts: [fact(10, 'venueHours', 'Daily 10am–6pm', id(1), 'venue'), fact(11, 'restroomFloor', 'Basement'),
      fact(12, 'entranceLocation', 'Use the right-side door', id(1), 'route'), fact(13, 'buildingAccessibility', 'Fully accessible', id(1), 'building'),
      fact(14, 'condition', 'Acceptable at the dated inspection', id(2), 'restroom', 'Men’s room'),
      fact(15, 'inspectionFixtureCount', '0', id(2), 'restroom', 'Men’s room · Soap dispensers'),
      fact(16, 'inspectionFeatureRating', 'C', id(2), 'restroom', 'Men’s room · Litter'), fact(17, 'inspectionIssue', 'Sink out of service', id(2), 'restroom', 'Men’s room'),
      fact(18, 'closure', 'No', id(2), 'restroom', 'Men’s room'), fact(19, 'inspectionDate', '2026-07-27', id(2)),
      fact(20, 'passcode', '001234', id(3)), fact(21, 'entryRule', 'Customers-only signage reported', id(3)),
      fact(22, 'sourceRating', '4.8/5 from 1,351 venue reviews; not restroom cleanliness', id(4), 'venue')],
    comments: [{ id: id(30), text: '<script>unsafe()</script> The reviewer described a downstairs restroom.', sourceID: id(3) }], coveredCommentIDs: [id(1), id(3)] });
}
function room(patch = {}) {
  return { id: placeID, name: 'Exact venue', latitude: 40.75, longitude: -73.98, locationType: 'store', operator: null,
    publishedStatus: 'Operational', seasonality: null, hours: '9am–5pm', facilityAccessibility: null, restroomType: null,
    changingStations: null, accessNotes: null, website: null, sourceRecordId: null, sourceRecordIds: [], sourceUrl: null,
    address: '123 Example Street', neighborhood: null, purchaseRequired: null, restroomFloor: null, stairsToRestroom: null,
    cleanliness: null, observationDate: null, communitySource: { submittedAt: '2026-10-20T00:00:00.000Z', observedOn: null,
      entryRule: 'unknown', stepFreeAccess: 'unknown', passcodeRequired: 'unknown' }, ...patch };
}
function render(profile = fixture(), patch = {}) {
  return renderToStaticMarkup(createElement(detail.RestroomDetailView, { restroom: room(), distance: null, userLocation: null,
    saved: false, saving: false, onToggleFavorite: () => assert.fail('SSR must not save'), onClose: () => {},
    passcodeContent: createElement('div', { 'data-existing-code': true }, 'Verified visitor code 9000'),
    ratingContent: createElement('div', { 'data-existing-rating': true }, 'App cleanliness: 4.5 from 2 votes'),
    personalContent: createElement('div', null, 'Existing public note actions'),
    visitReportContent: createElement('div', null, 'Existing Report visit details'), feedback: null,
    research: { placeID, profile, loading: false, error: null }, onRetryResearch: () => {}, ...patch }));
}
const section = (html, label) => html.match(new RegExp(`<section[^>]*aria-label="${label}"[^>]*>([\\s\\S]*?)</section>`))?.[1] ?? '';

test('research reader listens only to the selected public document and waits for server-confirmed snapshots', () => {
  const records = [], errors = []; configured = true; stopped = false;
  const stop = reader.watchCardResearch(placeID, value => records.push(value), error => errors.push(error));
  assert.deepEqual(listener.reference.path, ['restroomResearchProfiles', placeID]); assert.equal(listener.options.includeMetadataChanges, true);
  const snapshot = metadata => ({ exists: () => true, data: fixture, metadata: { fromCache: false, hasPendingWrites: false, ...metadata } });
  listener.changed(snapshot({ fromCache: true })); listener.changed(snapshot({ hasPendingWrites: true })); assert.equal(records.length, 0);
  listener.changed(snapshot({})); assert.equal(records[0].placeID, placeID); assert.equal(errors.length, 0);
  stop(); assert.equal(stopped, true); listener.changed(snapshot({})); listener.failed({ message: 'private provider text' });
  assert.equal(records.length, 1); assert.equal(errors.length, 0);
});

test('missing, malformed and wrong-place profiles remain distinct and provider errors do not leak', () => {
  const records = [], errors = [];
  const stop = reader.watchCardResearch(placeID, value => records.push(value), error => errors.push(error.message));
  listener.changed({ metadata: { fromCache: false, hasPendingWrites: false }, exists: () => false }); assert.deepEqual(records, [null]);
  listener.changed({ metadata: { fromCache: false, hasPendingWrites: false }, exists: () => true, data: () => ({ ...fixture(), placeID: 'another-place' }) });
  assert.equal(records.length, 1); assert.match(errors.at(-1), /could not load/);
  listener.failed({ message: 'private provider text' }); assert.doesNotMatch(errors.at(-1), /private provider/); stop();
});

test('invalid/unconfigured read failures are asynchronous and cleanly cancelled', async () => {
  const errors = []; configured = false;
  const stop = reader.watchCardResearch(placeID, () => assert.fail('unexpected profile'), error => errors.push(error)); stop();
  await new Promise(queueMicrotask); assert.equal(errors.length, 0);
  reader.watchCardResearch('../private', () => assert.fail('unexpected profile'), error => errors.push(error));
  assert.equal(errors.length, 0); await new Promise(queueMicrotask); assert.equal(errors.length, 1); configured = true;
});

test('place changes and failed/loading/missing reads cannot hide legacy comments with stale coverage IDs', () => {
  const feed = { placeID, profile: fixture(), loading: false, error: null };
  assert.deepEqual(reader.coveredCardResearchCommentIDs(feed, placeID), [id(1), id(3)]);
  for (const value of [{ ...feed, loading: true }, { ...feed, error: 'unavailable' }, { ...feed, profile: null },
    { ...feed, placeID: 'another-place' }, { ...feed, profile: { ...feed.profile, placeID: 'another-place' } }]) {
    assert.deepEqual(reader.coveredCardResearchCommentIDs(value, placeID), []);
  }
  assert.equal(reader.selectedCardResearchFeed(feed, 'another-place').profile, null);
  assert.equal(reader.selectedCardResearchFeed(feed, 'another-place').loading, true);
});

test('unknown and exact duplicate listing rows yield to matching research; known conflicts and venue/restroom boundaries survive', () => {
  const profile = fixture();
  assert.equal(presentation.showOriginalCardFact(profile, ['restroomFloor'], null, true, ['restroom', 'route']), false);
  assert.equal(presentation.showOriginalCardFact(profile, ['restroomFloor'], 'Basement', false, ['restroom', 'route']), false);
  assert.equal(presentation.showOriginalCardFact(profile, ['restroomFloor'], 'Second floor', false, ['restroom', 'route']), true);
  assert.equal(presentation.showOriginalCardFact(profile, ['hours', 'restroomHours'], null, true, ['restroom', 'route']), true);
  assert.equal(presentation.showOriginalCardFact(profile, ['restroomAccessibility'], null, true, ['restroom', 'route']), true);
  assert.equal(presentation.showOriginalCardFact(profile, ['stairsAfterEntry'], '0', false, ['restroom', 'route']), true);
  assert.equal(presentation.cardResearchFactLabel(fact(40, 'facilityAccessibility', 'Fully Accessible')), 'Building accessibility — directory');
});

test('inspection expansion preserves every fact and keeps the dated condition summary visible', () => {
  const profile = fixture(), rows = model.factsForSection(profile, 'conditions');
  const split = presentation.partitionCardResearchFacts(rows);
  assert.ok(split.primary.some(fact => fact.field === 'condition'));
  assert.ok(split.details.some(fact => fact.field === 'inspectionIssue'));
  assert.deepEqual([...split.primary, ...split.details].map(fact => fact.id).sort(), rows.map(fact => fact.id).sort());
  assert.equal(presentation.cardResearchFactValue(profile.facts.find(fact => fact.field === 'passcode')), '001234');
});

test('actual card SSR incorporates hours, route, amenities and dated inspection facts in their field sections', () => {
  const html = render();
  assert.match(section(html, 'Hours'), /Daily 10am–6pm/); assert.match(section(html, 'Hours'), /Venue hours/);
  assert.match(section(html, 'Hours'), /9am–5pm/); // Venue hours cannot overwrite the original restroom schedule.
  assert.match(section(html, 'Route inside'), /Basement/); assert.match(section(html, 'Route inside'), /Use the right-side door/);
  assert.doesNotMatch(section(html, 'Route inside'), /Restroom floor<\/dt><dd>Not reported/);
  assert.match(section(html, 'Amenities'), /Fully accessible/); assert.match(section(html, 'Amenities'), /Building information/);
  assert.match(section(html, 'Amenities'), /View room fixtures/); assert.match(section(html, 'Amenities'), /Soap dispensers/);
  assert.match(section(html, 'Conditions'), /Acceptable at the dated inspection/);
  assert.match(section(html, 'Conditions'), /Inspected Jul 27, 2026/); assert.match(section(html, 'Conditions'), /Not marked closed at inspection/);
  assert.doesNotMatch(section(html, 'Conditions'), /Observation date<\/dt><dd>Not reported/);
  assert.match(section(html, 'Conditions'), /View room features and issues/); assert.match(section(html, 'Conditions'), /Sink out of service/);
  for (const citation of html.matchAll(/class="finder-research-citation">([\s\S]*?)<\/span>/g)) {
    assert.ok((citation[1].match(/From NYC Parks/g) ?? []).length <= 1); // Each citation has one source prefix.
  }
  assert.doesNotMatch(html, />Source notes</);
});

test('source code claims and external venue scores never become confirmations, ownership controls or app votes', () => {
  const html = render();
  assert.match(html, /Verified visitor code 9000/); assert.match(html, /finder-research-code">001234/);
  const claims = html.slice(html.indexOf('<div class="finder-research-published-codes">'), html.indexOf('<section class="finder-detail-section finder-rate-comment"'));
  assert.match(claims, /unverified/); assert.doesNotMatch(claims, /<button|I used this code|Code didn’t work|4 confirmations/);
  const rate = section(html, 'Rate and Comment');
  assert.match(rate, /App cleanliness: 4.5 from 2 votes/); assert.match(rate, /Venue rating — source/); assert.match(rate, /4.8\/5 from 1,351 venue reviews/);
  assert.match(rate, /Existing Report visit details/); assert.match(rate, /Existing public note actions/);
});

test('published comments and source strings remain plain escaped text with safe direct source links', () => {
  const html = render(); assert.match(html, /Anonymous/); assert.match(html, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|<img|javascript:/); assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /From Reddit · Feb 3, 2025/); assert.match(html, /From Operator · Date unknown/);
  assert.doesNotMatch(section(html, 'Hours'), /Oct 24, 2026/); // Retrieval/generation cannot masquerade as a fact date.
});

test('loading/error keeps known base details, missing profiles restore normal fallback, and a different-place profile stays hidden', () => {
  const html = render(null, { research: { placeID, profile: null, loading: true, error: null } });
  assert.match(html, /Loading additional listing details/); assert.match(html, /9am–5pm/);
  const failed = render(null, { research: { placeID, profile: null, loading: false, error: 'Additional details unavailable' } });
  assert.match(failed, /Additional details unavailable/); assert.match(failed, /Retry details/); assert.match(failed, /9am–5pm/);
  assert.doesNotMatch(failed, /No research facts|No known details/);
  const wrong = render(fixture(), { research: { placeID: 'another-place', profile: fixture(), loading: false, error: null } });
  assert.doesNotMatch(wrong, /Daily 10am–6pm|Use the right-side door/);
});

test('known original floor conflicts remain beside the source claim without mutating the profile', () => {
  const profile = fixture(), before = JSON.stringify(profile);
  const html = render(profile, { restroom: room({ restroomFloor: 'Second floor' }) });
  assert.match(section(html, 'Route inside'), /Second floor/); assert.match(section(html, 'Route inside'), /Basement/);
  assert.equal(JSON.stringify(profile), before);
});

test('earlier bundled facts remain available inside provenance without a separate source-only card section', () => {
  const legacyID = 'community-30c01c58b8ff4dd8e3c4';
  const html = render(null, { restroom: room({ id: legacyID }), research: { placeID: legacyID, profile: null, loading: false, error: null } });
  const detailsAt = html.indexOf('<details class="finder-provenance">'), legacyAt = html.indexOf('2026 source reports');
  assert.ok(detailsAt >= 0 && legacyAt > detailsAt); assert.match(html, /Lower level/); assert.doesNotMatch(html, />Source notes</);
});

test('hours normalize only blank or explicit missing values without inventing opening times', () => {
  for (const value of [null, undefined, '', ' \n\t\u00a0 ', ' unknown ', 'Not reported', 'not-reported', 'Hours unknown', 'N/A']) {
    assert.equal(presentation.knownCardHours(value), null);
    const html = section(render(null, { restroom: room({ hours: value }) }), 'Hours');
    assert.match(html, /Listed restroom hours<\/dt><dd>Hours unknown/);
    assert.doesNotMatch(html, /<dd>\s*<\/dd>/);
  }
  for (const value of ['Temp Closed', 'Open by permit', 'Concession Operating Hours', 'Tuesday-Saturday', 'Park Hours', 'Closed', '24/7', 'Monday: 10–6\nTuesday: Closed']) {
    assert.equal(presentation.knownCardHours(` ${value} `), value);
  }
});

test('venue hours and seasonality never fill missing restroom hours; usable sourced restroom hours do', () => {
  const profile = fixture();
  profile.facts = [fact(50, 'hours', 'unknown'), fact(51, 'restroomHours', 'Not reported'),
    fact(52, 'venueHours', '10am–6pm', id(1), 'venue'), fact(53, 'seasonality', 'Year Round')];
  let html = section(render(profile, { restroom: room({ hours: ' ' }) }), 'Hours');
  assert.match(html, /Listed restroom hours<\/dt><dd>Hours unknown/);
  assert.match(html, /Venue hours<\/dt><dd><span>10am–6pm/);
  assert.match(html, /Year Round/); assert.doesNotMatch(html, /<span>unknown<|<span>Not reported</);
  profile.facts.push(fact(54, 'restroomHours', '24 hours daily'));
  html = section(render(profile, { restroom: room({ hours: null }) }), 'Hours');
  assert.match(html, /Restroom hours<\/dt><dd><span>24 hours daily/);
  assert.doesNotMatch(html, /Hours unknown/);
  profile.facts = [fact(55, 'hours', 'Closed')];
  html = section(render(profile, { restroom: room({ hours: null }) }), 'Hours');
  assert.match(html, /<span>Closed<\/span>/); assert.doesNotMatch(html, /Hours unknown/);
});

test('direct 24-hour reports and valid base schedules survive optional profile loading, failure and place races', () => {
  const accessDetails = { restroomHours: ' Open 24 hours a day, 7 days a week ', sourceTitle: 'Direct hours report',
    reportedAt: new Date('2026-10-23T00:00:00Z'), updatedAt: new Date('2026-10-23T00:00:00Z'),
    observedOn: null, limitations: 'Reported hours may change.' };
  for (const research of [{ placeID, profile: null, loading: true, error: null },
    { placeID, profile: null, loading: false, error: 'Additional details unavailable' },
    { placeID: 'another-place', profile: fixture(), loading: false, error: null }]) {
    const html = section(render(null, { restroom: room({ hours: null, accessDetails }), research }), 'Hours');
    assert.match(html, /Restroom hours — report<\/dt><dd>Open 24 hours a day, 7 days a week/);
    assert.doesNotMatch(html, /Hours unknown|Daily 10am–6pm/);
  }
  const html = section(render(null, { restroom: room({ hours: ' 9am–5pm ', accessDetails: { ...accessDetails, restroomHours: ' ' } }) }), 'Hours');
  assert.match(html, /Listed restroom hours<\/dt><dd>9am–5pm/); assert.doesNotMatch(html, /Hours unknown/);
  const duplicate = fixture(); duplicate.facts = [fact(56, 'restroomHours', ' 9am–5pm ')];
  // The collapsed answer repeats the schedule once; its expanded source rows
  // must still deduplicate the identical original listing and research fact.
  const expanded = section(render(duplicate), 'Hours').replace(/<summary>[\s\S]*?<\/summary>/g, '');
  assert.equal((expanded.match(/9am–5pm/g) ?? []).length, 1);
});

test('collapsed hours use today in New York while expanded schedule and source rows keep the full week', () => {
  const weekly = ['Monday: 9am–5pm', 'Tuesday: 10am–6pm', 'Wednesday: 11am–7pm', 'Thursday: 9am–8pm',
    'Friday: 9am–9pm', 'Saturday: 10am–4pm', 'Sunday: Closed'].join('\n');
  const html = section(render(null, { restroom: room({ hours: weekly }), hoursDate: new Date('2026-11-06T02:00:00Z') }), 'Hours');
  const summary = html.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? '';
  assert.match(summary, /Today \(Thu\): 9am–8pm/);
  assert.doesNotMatch(summary, /Monday:|Friday:|Closed/);
  assert.match(html, /Monday: 9am–5pm[\s\S]*Sunday: Closed/);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|>)/);
});

test('collapsed venue fallback stays labeled and cannot replace known restroom hours', () => {
  const profile = fixture();
  profile.facts = [fact(70, 'venueHours', 'Mon–Fri: 10am–6pm; Sat: 12pm–5pm; Sun: Closed', id(1), 'venue')];
  const html = section(render(profile, { restroom: room({ hours: null }), hoursDate: new Date('2026-11-05T18:00:00Z') }), 'Hours');
  const summary = html.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? '';
  assert.match(summary, /Venue hours — restroom hours unconfirmed/);
  assert.match(summary, /Today \(Thu\): 10am–6pm/);
  assert.match(html, /Listed restroom hours<\/dt><dd>Hours unknown/);
  assert.match(html, /Mon–Fri: 10am–6pm; Sat: 12pm–5pm; Sun: Closed/);
  const direct = section(render(profile, { restroom: room({ hours: '24/7' }), hoursDate: new Date('2026-11-05T18:00:00Z') }), 'Hours');
  assert.match(direct.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? '', /Listed restroom hours[\s\S]*24\/7/);
});

test('server and initial hydration never freeze a weekly today label to the deployment date', () => {
  const weekly = 'Mon–Fri: 9am–5pm; Sat: 10am–4pm; Sun: Closed';
  const html = section(render(null, { restroom: room({ hours: weekly }) }), 'Hours');
  assert.match(html.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? '', /See weekly schedule/);
  assert.doesNotMatch(html, /Today \(/);
});
