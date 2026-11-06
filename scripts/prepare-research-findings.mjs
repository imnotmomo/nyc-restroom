/** Converts the bounded per-place research queue to the shared evidence envelope; no network or writes to Firestore. */
import { open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { check, sha, stable, validateFindings } from './research-map-model.mjs';

const labels = { venueHours: 'Venue hours', restroomHours: 'Restroom hours', restroomAccessibility: 'Restroom accessibility',
  restroomLocation: 'Restroom location', restroomFloor: 'Restroom floor', entranceLocation: 'Entrance', entryRule: 'Entry rule',
  elevatorAccess: 'Elevator information', elevatorToRestroom: 'Elevator to restroom', elevatorNote: 'Elevator information',
  buildingAccessibility: 'Building access', passcodeRequired: 'Code requirement', codeRequired: 'Code requirement',
  staffAssistance: 'Staff assistance', changingStations: 'Changing stations', restroomType: 'Restroom type',
  closure: 'Dated closure/access notice', identity: 'Venue identity', venueLevel: 'Venue level', hours: 'Source-specific hours',
  elevatorOutage: 'Elevator outage notice', accessRestriction: 'Access notice' };

export function flattenCommunityEvidence(research, { excludedSources = [], preferredSourceKeys = new Set() } = {}) {
  check(research?.schemaVersion === 1 && Array.isArray(research.entries), 'Invalid per-place community evidence.');
  return research.entries.flatMap(place => {
    check(Array.isArray(place.evidence) && Array.isArray(place.queries), 'Missing bounded research provenance.');
    return place.evidence.filter(source => source.publicationEligible !== false && source.facts?.length > 0
      && !preferredSourceKeys.has(`${place.placeID}|${source.sourceURL}`)
      && !excludedSources.some(excluded => excluded.placeID === place.placeID && excluded.sourceURL === source.sourceURL)).map(source => {
      check(Array.isArray(source.rawEvidenceFiles) && source.rawEvidenceFiles.length > 0
        && source.rawEvidenceFiles.every(file => typeof file === 'string' && /^[A-Za-z0-9._/-]+$/.test(file)
          && !file.startsWith('/') && file.split('/').every(part => part && part !== '.' && part !== '..')), 'Source needs safe local raw evidence references.');
      const facts = source.facts.map(fact => ({ field: fact.field, value: fact.value, scope: fact.scope,
        evidence: typeof fact.evidence === 'string' ? fact.evidence : `${fact.value} (captured source: ${source.rawEvidenceFiles.join(', ')})` }));
      const paraphrase = facts.map(fact => `${labels[fact.field] ?? fact.field}: ${fact.value}.`).join(' ');
      const type = source.sourceType === 'official' ? 'official-page' : source.sourceType === 'discussion'
        ? (/\/comment\//.test(source.sourceURL) ? 'social-comment' : 'social-post') : source.sourceType;
      const scopes = [...new Set(facts.map(fact => fact.scope))];
      return { placeID: place.placeID, sourceURL: source.sourceURL, sourceTitle: source.title,
        retrievedAt: source.retrievedAt.replace(/\+00:00$/, 'Z'), evidenceType: type,
        scope: scopes.includes('restroom') ? 'restroom' : scopes.includes('route') ? 'route' : scopes.includes('building') ? 'building' : 'venue',
        identityEvidence: `${source.identityEvidence} Raw evidence: ${source.rawEvidenceFiles.join(', ')}.${source.captureFileSHA256 ? ` Capture SHA256: ${source.captureFileSHA256}.` : ''}`,
        publishedOn: source.publishedOn, originalTimestamp: source.originalTimestamp, dateEvidence: source.dateEvidence,
        paraphrase, facts, limitations: source.limitations };
    });
  });
}

export async function run(argv = process.argv.slice(2)) {
  const args = {}, allowed = new Set(['inventory', 'root-findings', 'community-evidence', 'linked-page-evidence', 'parks-findings', 'findings', 'curation', 'output']);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.startsWith('--') ? argv[i].slice(2) : '';
    check(allowed.has(key) && (key === 'findings' || !Object.hasOwn(args, key)) && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('--'), 'Invalid preparation arguments.');
    if (key === 'findings') (args.findings ??= []).push(resolve(argv[i + 1]));
    else args[key] = resolve(argv[i + 1]);
  }
  check(args.inventory && args.output && (args['root-findings'] || args['community-evidence'] || args['linked-page-evidence'] || args['parks-findings'] || args.findings?.length), 'Provide inventory, output and at least one findings source.');
  const inventoryText = await readFile(args.inventory, 'utf8'), inventory = JSON.parse(inventoryText), inventorySHA256 = sha(inventoryText), entries = [];
  for (const path of [args['root-findings'], args['parks-findings'], ...args.findings ?? []].filter(Boolean)) {
    const findings = JSON.parse(await readFile(path, 'utf8'));
    validateFindings(findings, inventory, inventorySHA256); entries.push(...findings.entries);
  }
  const curation = args.curation ? JSON.parse(await readFile(args.curation, 'utf8')) : { excludedSources: [] };
  check(Array.isArray(curation.excludedSources) && curation.excludedSources.every(item => typeof item.placeID === 'string'
    && typeof item.sourceURL === 'string' && typeof item.reason === 'string' && item.reason.trim()), 'Invalid explicit source quarantine.');
  for (const key of ['community-evidence', 'linked-page-evidence']) if (args[key]) entries.push(...flattenCommunityEvidence(JSON.parse(await readFile(args[key], 'utf8')),
    { excludedSources: curation.excludedSources, preferredSourceKeys: new Set(entries.map(entry => `${entry.placeID}|${entry.sourceURL}`)) }));
  const deduplicated = [...new Map(entries.map(entry => [stable(entry), entry])).values()];
  const findings = { schemaVersion: 1, batchID: 'research-map-2026-10-24', inventorySHA256, entries: deduplicated };
  validateFindings(findings, inventory, inventorySHA256);
  const file = await open(args.output, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify(findings, null, 2)}\n`); await file.sync(); } finally { await file.close(); }
  console.log(JSON.stringify({ evidence: findings.entries.length, duplicatesOmitted: entries.length - deduplicated.length, inventorySHA256 }));
  return findings;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) run().catch(error => {
  console.error(error instanceof Error ? error.message : 'Evidence preparation failed.'); process.exitCode = 1;
});
