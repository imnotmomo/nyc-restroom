/** Read-only, bounded public-hours inventory. Uses the existing private CLI login. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { dataOf } from './research-map-model.mjs';

const project = 'nye-restroom', databaseID = '(default)';
const databaseRoot = `projects/${project}/databases/${databaseID}`;
const documentsRoot = `${databaseRoot}/documents`;
const require = createRequire('/opt/homebrew/lib/node_modules/firebase-tools/package.json');
const auth = require('./lib/auth.js');
const { requireAuth } = require('./lib/requireAuth.js');
const { Client } = require('./lib/apiv2.js');
const account = auth.getGlobalDefaultAccount();
if (!account) throw Error('The existing Firebase CLI login is unavailable.');
const options = { project }; auth.setActiveAccount(options, account); await requireAuth(options);
const api = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
const database = (await api.get(`/${databaseRoot}`)).body;
if (database.databaseEdition !== 'STANDARD' || database.name !== databaseRoot) throw Error('Unexpected database identity or edition.');
let readTime;
const collections = {};
for (const collectionId of ['communityRestrooms', 'restroomAccessDetails', 'restroomResearchProfiles']) {
  const body = { structuredQuery: { from: [{ collectionId }], limit: 5000 }, ...(readTime ? { readTime } : {}) };
  const response = (await api.post(`/${documentsRoot}:runQuery`, body)).body;
  if (!Array.isArray(response)) throw Error('Unexpected bounded-query response.');
  readTime ??= response.find(row => row.readTime)?.readTime;
  collections[collectionId] = response.filter(row => row.document).map(row => row.document);
  if (collections[collectionId].length >= 5000) throw Error('Inventory exceeded its bounded query.');
}
const directory = resolve('.firebase-agent/hours-20261105');
const output = resolve('data/hours-research-2026-11-05');
await mkdir(directory, { recursive: true }); await mkdir(output, { recursive: true });
await writeFile(`${directory}/live-preimages.json`, JSON.stringify({ project, databaseID, readTime, collections }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const city = JSON.parse(await readFile('data/nyc-restrooms/restrooms.json', 'utf8')).restrooms;
const profileMap = new Map(collections.restroomResearchProfiles.map(doc => [doc.name.split('/').at(-1), dataOf(doc)]));
const accessMap = new Map(collections.restroomAccessDetails.map(doc => [doc.name.split('/').at(-1), dataOf(doc)]));
const community = collections.communityRestrooms.map(doc => ({ id: doc.name.split('/').at(-1), ...dataOf(doc) }));
const known = value => typeof value === 'string' && value.trim() && !/^(?:unknown|hours unknown|not[ -]reported|not available|n\/a)$/i.test(value.trim());
const inventory = [...city.map(place => ({ ...place, sourceKind: 'city' })), ...community.map(place => ({ ...place, sourceKind: 'community' }))].map(place => {
  const profile = profileMap.get(place.id), access = accessMap.get(place.id);
  const scheduleFacts = (profile?.facts ?? []).filter(fact => ['restroomHours', 'venueHours', 'hours'].includes(fact.field) && known(fact.value));
  const direct = known(access?.restroomHours) ? access.restroomHours : known(place.hours) ? place.hours : null;
  return { id: place.id, sourceKind: place.sourceKind, name: place.name, address: place.address ?? null,
    latitude: place.latitude, longitude: place.longitude, locationType: place.locationType, operator: place.operator ?? null,
    website: place.website ?? null, sourceRecordId: place.sourceRecordId ?? null, directHours: direct,
    scheduleFacts: scheduleFacts.map(fact => ({ ...fact, source: profile.sources.find(source => source.id === fact.sourceID) })),
    needsHoursResearch: direct === null && scheduleFacts.length === 0 };
});
if (new Set(inventory.map(place => place.id)).size !== inventory.length) throw Error('Duplicate live map IDs.');
const missing = inventory.filter(place => place.needsHoursResearch);
const report = { schemaVersion: 1, project, databaseID, edition: database.databaseEdition, readTime, capturedAt: new Date().toISOString(),
  productionWrites: 0, total: inventory.length, city: city.length, community: community.length, profiles: profileMap.size,
  missing: missing.length, missingCity: missing.filter(place => place.sourceKind === 'city').length,
  missingCommunity: missing.filter(place => place.sourceKind === 'community').length, places: inventory };
await writeFile(`${output}/inventory.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
await writeFile(`${output}/unknown-hours.json`, JSON.stringify(missing, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ project, databaseID, edition: database.databaseEdition, readTime, total: report.total, city: city.length, community: community.length, profiles: profileMap.size, missing: missing.length, missingCity: report.missingCity, missingCommunity: report.missingCommunity, productionWrites: 0 }));
