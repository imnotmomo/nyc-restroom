/** Deterministic offline public-card projection. No Firebase, credentials, HTTP or database operations. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CARD_RESEARCH_FIELD_INFO, decodeCardResearch } from '../lib/card-research-model.ts';
import { desiredTargets, stable } from './research-map-model.mjs';

export const CARD_MANIFEST_SHA256 = 'adee7ab48de4bbf78d8286c150f9a1d7b7f392490c4c7de2c224a021719c4b74';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIRECTORY = resolve(ROOT, 'data/research-map-2026-10-24');
const hash = value => createHash('sha256').update(value).digest('hex');
const id20 = value => hash(stable(value)).slice(0, 20);
const check = (value, message) => { if (!value) throw new Error(message); };
const FILE_PINS = {
  'parks/matched-inspection-details.json': '22f8015a7446b51ab7d38b3fb36510ab5ed798600a2ff53eee17598a9a5a31d6',
  'parks/building-supplement-details.json': 'd8da570f4246b7a6f3516f3c0dbc50af8c72d581dd0f2ea91d14fe3abc750b04',
};
const fixtureLabels = { handDryers: 'Hand dryers', changingTables: 'Changing tables', mirrors: 'Mirrors',
  urinals: 'Urinals', toilets: 'Toilets', sinks: 'Sinks', toiletPaperDispensers: 'Toilet paper dispensers',
  soapDispensers: 'Soap dispensers', paperTowelDispensers: 'Paper towel dispensers' };
const roomContext = room => room === 'M1' ? 'Men’s room' : room === 'W1' ? 'Women’s room' : `Room ${room}`;

function sourceLabel(entry) {
  const host = new URL(entry.sourceURL).hostname.toLowerCase();
  if (entry.evidenceType === 'inspection' || host.endsWith('nycgovparks.org')) return 'NYC Parks';
  if (host === 'data.cityofnewyork.us') return 'NYC Open Data';
  if (host.endsWith('bklynlibrary.org')) return 'BPL';
  if (host.endsWith('queenslibrary.org')) return 'QPL';
  if (host.endsWith('nypl.org')) return 'NYPL';
  if (host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it') return 'Reddit';
  if (host.endsWith('xiaohongshu.com') || host.endsWith('xhslink.com')) return 'Xiaohongshu';
  if (host.endsWith('google.com') || host === 'maps.app.goo.gl') return 'Google';
  if (entry.sourceTitle.length <= 80) return entry.sourceTitle;
  return host.replace(/^www\./, '');
}

function sourceForEntry(entry) {
  const inspectionDate = entry.evidenceType === 'inspection'
    ? entry.facts.find(fact => fact.field === 'inspectionDate')?.value : null;
  check(entry.evidenceType !== 'inspection' || typeof inspectionDate === 'string', 'Inspection source lacks its actual observation date.');
  return { id: entry.id, label: sourceLabel(entry), title: entry.sourceTitle, url: entry.sourceURL, kind: entry.evidenceType,
    publishedOn: entry.publishedOn,
    displayedDate: entry.originalTimestamp || 'Date unknown',
    observedOn: inspectionDate, retrievedAt: entry.retrievedAt,
    limitations: entry.limitations };
}

function factContext(entry, fact) {
  if (entry.evidenceType !== 'inspection') return '';
  const match = /\broom\s+([MW]1)\b/i.exec(`${fact.evidence} ${fact.value}`);
  return match ? roomContext(match[1].toUpperCase()) : '';
}

function narrative(entry) {
  if (!['review', 'social-post', 'social-comment'].includes(entry.evidenceType)) return false;
  const fields = entry.facts.map(fact => fact.field);
  if (fields.length && fields.every(field => field === 'sourceRating')) return false;
  // Reviewed FACILITY code guides remain direct historical passcode facts, not duplicate narratives.
  if (fields.includes('passcode') && fields.every(field => ['passcode', 'restroomFloor', 'codeRequired', 'passcodeRequired'].includes(field))) return false;
  return true;
}

/** Pure builder used by the offline command and adversarial/schema projection tests. */
export function buildCardProfiles(manifest, inspectionDetails) {
  check(manifest.project === 'nye-restroom' && manifest.database === '(default)', 'Unexpected research target.');
  const commentTargets = new Map(desiredTargets(manifest).filter(target => target.path.startsWith('restroomSourceComments/'))
    .map(target => [target.path.split('/').at(-1), target]));
  const details = new Map();
  for (const row of inspectionDetails) {
    check(!details.has(row.placeID), 'Duplicate Parks place identity.'); details.set(row.placeID, row);
  }
  const grouped = new Map();
  for (const entry of manifest.entries) {
    if (!grouped.has(entry.placeID)) grouped.set(entry.placeID, []);
    grouped.get(entry.placeID).push(entry);
  }
  const profiles = [];
  for (const [placeID, entries] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const profile = { schemaVersion: 1, placeID, manifestSHA256: CARD_MANIFEST_SHA256, generatedAt: manifest.reviewedAt,
      sources: [], facts: [], comments: [], coveredCommentIDs: [] };
    const factIDs = new Set();
    const addFact = (sourceID, field, value, scope, context = '', label = CARD_RESEARCH_FIELD_INFO[field]?.label) => {
      check(CARD_RESEARCH_FIELD_INFO[field] && label, 'An unknown card fact would be lost.');
      const displayed = typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
      const fact = { field, label, value: displayed, scope, sourceID, section: CARD_RESEARCH_FIELD_INFO[field].section, context };
      const id = id20(fact);
      if (!factIDs.has(id)) { profile.facts.push({ id, ...fact }); factIDs.add(id); }
    };
    for (const entry of [...entries].sort((a, b) => a.id.localeCompare(b.id))) {
      const initialFacts = profile.facts.length, initialComments = profile.comments.length;
      for (const fact of entry.facts) {
        if (fact.field === 'identity') continue;
        check(fact.sourceURL === entry.sourceURL, 'Fact-level alternate URL requires separate source attribution review.');
        const scope = fact.field === 'venueHours' ? 'venue' : fact.field === 'buildingAccessibility' ? 'building' : fact.scope;
        addFact(entry.id, fact.field, fact.value, scope, factContext(entry, fact));
      }
      if (entry.evidenceType === 'inspection') {
        const detail = details.get(placeID);
        const inspectedOn = entry.facts.find(fact => fact.field === 'inspectionDate')?.value;
        check(detail && detail.latestInspectionDate === inspectedOn && detail.roomEvidence.length === 2,
          'Reviewed inspection details do not match the frozen source observation.');
        addFact(entry.id, 'conditionDetail', entry.paraphrase, 'restroom');
        const overallAdded = new Set();
        for (const room of detail.roomEvidence) {
          check(room.inspectionDate === inspectedOn && ['M1', 'W1'].includes(room.room), 'Inspection room/date mismatch.');
          const context = roomContext(room.room);
          for (const [key, label] of Object.entries(fixtureLabels)) {
            const count = room.fixtureCountsAtInspection[key];
            if (count === undefined || count === null) continue;
            check(Number.isInteger(count) && count >= 0 && count <= 1000, 'Invalid inspected fixture count.');
            addFact(entry.id, 'inspectionFixtureCount', count, 'restroom', context, label);
          }
          for (const feature of room.features) {
            if (feature.rating === undefined || feature.rating === null) continue;
            check(['A', 'U', 'N', 'U/S'].includes(feature.rating), 'Unreviewed inspector grade category.');
            addFact(entry.id, 'inspectionFeatureRating', feature.rating, 'restroom', context, `${feature.feature_1} grade`);
          }
          // Preserve restroom-level grades once instead of repeating identical aggregate rows for both rooms.
          for (const overall of room.restroomOverall) for (const [key, label] of Object.entries({ cs_overall_condition: 'Overall restroom grade',
            cs_litter: 'Restroom litter grade', cs_graffiti: 'Restroom graffiti grade', cs_amenities: 'Restroom amenities grade', cs_structural: 'Restroom structural grade' })) {
            const value = overall[key]; if (value === undefined || value === null) continue;
            check(['A', 'U', 'N', 'U/S'].includes(value), 'Unreviewed overall inspector grade category.');
            const signature = `${key}:${value}`;
            if (!overallAdded.has(signature)) { addFact(entry.id, 'inspectionFeatureRating', value, 'restroom', 'Restroom overall', label); overallAdded.add(signature); }
          }
          for (const issue of room.hazards) {
            const text = [['problem', 'Problem'], ['extent', 'Extent'], ['number', 'Count'], ['priority', 'Priority'], ['location_comments', 'Location']]
              .filter(([key]) => issue[key] !== undefined && issue[key] !== null && String(issue[key]).trim())
              .map(([key, label]) => `${label}: ${issue[key]}`).join('; ');
            addFact(entry.id, 'inspectionIssue', text || 'Recorded in the dated inspection.', 'restroom', context,
              `${issue.class ? `${issue.class}: ` : ''}${issue.type || 'Type not reported'}`);
          }
          if (typeof room.roomComment === 'string' && room.roomComment.trim()) addFact(entry.id, 'inspectionIssue', room.roomComment, 'restroom', context, 'Room notes');
        }
      }
      if (narrative(entry)) profile.comments.push({ id: entry.id, text: entry.paraphrase, sourceID: entry.id });
      if (profile.facts.length > initialFacts || profile.comments.length > initialComments) {
        profile.sources.push(sourceForEntry(entry));
        const target = commentTargets.get(entry.id);
        if (target) {
          check(target.payload.placeID === placeID && target.path === `restroomSourceComments/${placeID}/comments/${entry.id}`,
            'Actual SDK source-comment identity does not match the profile source.');
          profile.coveredCommentIDs.push(entry.id);
        }
      }
    }
    if (!profile.facts.length && !profile.comments.length) continue;
    profile.sources.sort((a, b) => a.id.localeCompare(b.id));
    profile.facts.sort((a, b) => a.section.localeCompare(b.section) || a.field.localeCompare(b.field) || a.context.localeCompare(b.context) || a.id.localeCompare(b.id));
    profile.comments.sort((a, b) => a.id.localeCompare(b.id)); profile.coveredCommentIDs.sort();
    profiles.push(decodeCardResearch(placeID, profile));
  }
  check(new Set(profiles.map(profile => profile.placeID)).size === profiles.length && profiles.length < 5000, 'Duplicate or unbounded public profiles.');
  return { schemaVersion: 1, manifestSHA256: CARD_MANIFEST_SHA256, profiles };
}

export async function run() {
  const manifestText = await readFile(resolve(DIRECTORY, 'manifest.json'), 'utf8');
  check(hash(manifestText) === CARD_MANIFEST_SHA256, 'Only the exact frozen research manifest may be projected.');
  const inputs = {};
  for (const [file, expected] of Object.entries(FILE_PINS)) {
    const text = await readFile(resolve(DIRECTORY, file), 'utf8'); check(hash(text) === expected, 'Reviewed public evidence input changed.'); inputs[file] = JSON.parse(text);
  }
  const result = buildCardProfiles(JSON.parse(manifestText), [...inputs['parks/matched-inspection-details.json'], ...inputs['parks/building-supplement-details.json']]);
  const output = `${JSON.stringify(result, null, 2)}\n`;
  await writeFile(resolve(DIRECTORY, 'public-card-profiles.json'), output);
  console.log(JSON.stringify({ manifestSHA256: CARD_MANIFEST_SHA256, outputSHA256: hash(output), profiles: result.profiles.length,
    facts: result.profiles.reduce((n, profile) => n + profile.facts.length, 0), comments: result.profiles.reduce((n, profile) => n + profile.comments.length, 0),
    coveredCommentIDs: result.profiles.reduce((n, profile) => n + profile.coveredCommentIDs.length, 0), maxFacts: Math.max(...result.profiles.map(profile => profile.facts.length)), productionWrites: 0 }));
  return result;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
