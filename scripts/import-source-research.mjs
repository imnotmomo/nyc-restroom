/** Administrator-only, immutable research archive. Never writes locations, codes, or rules. */
import { createHash } from 'node:crypto';
import { readFile, open, rename, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROJECT = 'nye-restroom';
const DATABASE = '(default)';
const BATCH_ID = 'web-2026-10-21';
const CUTOFF = '2026-10-21';
const ROOT = `projects/${PROJECT}/databases/${DATABASE}/documents`;
const DATE_KINDS = new Set(['published', 'updated', 'post', 'comment', 'edition']);
const SOURCE_TYPES = new Set(['official', 'guide', 'news', 'discussion']);
const publicSourceType = type => type === 'social' ? 'discussion' : type;
const FACT_FIELDS = new Set([
  'restroomFloor', 'restroomLocation', 'elevatorAccess', 'stairsToRestroom',
  'stepFreeAccess', 'restroomAccessibility', 'buildingAccessibility',
  'staffAssistance', 'entryRule', 'hours', 'closure', 'changingStations',
  'genderDesignation',
]);
const sha = text => createHash('sha256').update(text).digest('hex');
const id20 = text => sha(text).slice(0, 20);
const stable = value => JSON.stringify(value, (_, entry) => (
  entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
    : entry
));

class ImportError extends Error {}
const check = (condition, message) => { if (!condition) throw new ImportError(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 100_000) => typeof value === 'string' && value.trim().length > 0
  && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
const sameKeys = (value, expected) => object(value)
  && Object.keys(value).sort().join(',') === [...expected].sort().join(',');

function isoDate(value, earliest = '2026-01-01') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    && value >= earliest && value <= CUTOFF;
}

export function safeHTTPSURL(value) {
  try {
    check(text(value, 4096), 'Invalid source URL.');
    const url = new URL(value);
    check(url.protocol === 'https:' && !url.username && !url.password
      && (!url.port || url.port === '443'), 'Source URLs must be public HTTPS URLs.');
    // Source links must be public domain names, without local/IP destinations or credentials.
    check(url.hostname.includes('.') && !/[:\[\]]/.test(url.hostname)
      && !/^\d+(?:\.\d+){3}$/.test(url.hostname)
      && !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname), 'Unsafe source host.');
    for (const key of url.searchParams.keys()) {
      check(!/(?:token|password|secret|authorization|api.?key|credential|session|signature|key-pair-id|policy)/i.test(key), 'Source URL contains a credential-like parameter.');
    }
    return true;
  } catch {
    return false;
  }
}

function validateContent(value, depth = 0) {
  check(depth <= 14, 'Research content is nested too deeply.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    check(Number.isFinite(value), 'Research content contains a non-finite number.');
    return;
  }
  if (typeof value === 'string') {
    check(value.length <= 200_000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value), 'Invalid research text.');
    // Dates, floor numbers, opening hours and street numbers remain valid. Actual access codes do not.
    check(!/\b(?:passcode|password|(?:door|bathroom|restroom|access|entry|keypad)\s+code|code)\s*(?:is|was|:|=|-)?\s*[#*]?\d{3,12}(?:[#*]|\b)/i.test(value), 'Numeric access-code text is excluded from this release.');
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) check(safeHTTPSURL(value), 'Unsafe URL in research content.');
    return;
  }
  if (Array.isArray(value)) {
    check(value.length <= 10_000, 'Research array is too large.');
    value.forEach(entry => validateContent(entry, depth + 1));
    return;
  }
  check(object(value), 'Unsupported research value.');
  for (const [key, entry] of Object.entries(value)) {
    check(text(key, 500) && !/^__.*__$/.test(key), 'Invalid research field name.');
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    check(!/(?:passcode|password)/.test(normalized)
      && !['code', 'codes', 'doorcode', 'accesscode', 'entrycode', 'keypadcode', 'pincode', 'numericcode'].includes(normalized), 'Passcode fields are excluded from this release.');
    if (key === 'field' && typeof entry === 'string') {
      check(!/(?:passcode|password|(?:access|entry|door|keypad|pin)code)/i.test(entry)
        && !/^codes?$/i.test(entry), 'Passcode facts are excluded from this release.');
    }
    if (/(?:url|uri)$/i.test(key) && entry !== null) check(safeHTTPSURL(entry), 'Invalid research URL field.');
    if (['publishedOn', 'reportedOn', 'observedOn'].includes(key) && entry !== null) {
      check(isoDate(entry), 'Research dates must be real 2026 dates through the cutoff.');
    }
    // A comment can qualify in 2026 while its separately preserved parent thread is older.
    if (key === 'threadPublishedOn') check(isoDate(entry, '2000-01-01'), 'Invalid historical parent-thread date.');
    validateContent(entry, depth + 1);
  }
}

export function validateManifest(manifest) {
  check(object(manifest) && manifest.project === PROJECT && manifest.database === DATABASE
    && manifest.batchID === BATCH_ID && manifest.cutoff === CUTOFF, 'Unexpected manifest project, database, batch, or cutoff.');
  check(Array.isArray(manifest.sources) && manifest.sources.length > 0 && manifest.sources.length <= 1000
    && Array.isArray(manifest.matches) && manifest.matches.length <= 10_000
    && object(manifest.registry) && manifest.registry.cutoff === CUTOFF
    && Array.isArray(manifest.registry.sources) && Array.isArray(manifest.registry.reports), 'Invalid research manifest structure.');
  validateContent(manifest);
  const sources = new Map(), documentIDs = new Set();
  for (const source of manifest.sources) {
    check(object(source) && text(source.sourceID, 160) && !/[\/\s]/.test(source.sourceID)
      && !sources.has(source.sourceID), 'Invalid or repeated source ID.');
    check(text(source.title, 2000) && safeHTTPSURL(source.url) && isoDate(source.publishedOn)
      && object(source.dateEvidence) && DATE_KINDS.has(source.dateEvidence.kind)
      && text(source.dateEvidence.text) && safeHTTPSURL(source.dateEvidence.evidenceUrl)
      && SOURCE_TYPES.has(publicSourceType(source.sourceType)) && Array.isArray(source.venues), 'Invalid dated source.');
    check(!documentIDs.has(id20(source.sourceID)), 'Source document ID collision.');
    documentIDs.add(id20(source.sourceID));
    source.venues.forEach(venue => {
      check(object(venue) && text(venue.nameEnglish, 1000) && Array.isArray(venue.facts), 'Invalid source venue.');
      venue.facts.forEach(fact => check(object(fact) && FACT_FIELDS.has(fact.field)
        && text(fact.value) && !/^[#*]?\d{3,12}[#*]?$/.test(fact.value.trim()), 'Invalid source fact or numeric access-code string.'));
    });
    sources.set(source.sourceID, source);
  }
  const matches = new Map(), matchesBySource = new Map();
  for (const match of manifest.matches) {
    const source = sources.get(match?.sourceID);
    check(source && Number.isInteger(match.venueIndex) && match.venueIndex >= 0
      && match.venueIndex < source.venues.length && Array.isArray(match.matchedPlaceIDs)
      && new Set(match.matchedPlaceIDs).size === match.matchedPlaceIDs.length
      && match.matchedPlaceIDs.every(id => text(id, 200) && !/[\/\s]/.test(id)), 'Invalid source-place match.');
    const key = `${match.sourceID}|${match.venueIndex}`;
    check(!matches.has(key), 'Duplicate source-venue match.');
    matches.set(key, match);
    if (!matchesBySource.has(match.sourceID)) matchesBySource.set(match.sourceID, []);
    matchesBySource.get(match.sourceID).push(match);
  }
  check(matches.size === manifest.sources.reduce((sum, source) => sum + source.venues.length, 0), 'Every source venue needs a resolved or unresolved match entry.');
  const publicSources = new Map();
  for (const source of manifest.registry.sources) {
    check(sameKeys(source, ['id', 'title', 'url', 'publishedOn', 'dateKind', 'sourceType', 'dateEvidence', 'limitations']), 'Invalid public source schema.');
    const original = sources.get(source.id);
    check(original && !publicSources.has(source.id) && text(source.title, 2000)
      && safeHTTPSURL(source.url) && [original.url, original.dateEvidence.evidenceUrl].includes(source.url)
      && source.publishedOn === original.publishedOn && source.dateKind === original.dateEvidence.kind
      && source.sourceType === publicSourceType(original.sourceType) && text(source.dateEvidence)
      && typeof source.limitations === 'string', 'Invalid public source reference or date.');
    publicSources.set(source.id, source);
  }
  const reports = new Map();
  for (const report of manifest.registry.reports) {
    check(sameKeys(report, ['id', 'placeID', 'sourceID', 'venueLabel', 'reportedOn', 'observedOn', 'facts', 'limitations']), 'Invalid public report schema.');
    check(/^[a-f0-9]{20}$/.test(report.id) && !reports.has(report.id)
      && text(report.placeID, 200) && publicSources.has(report.sourceID)
      && text(report.venueLabel, 1000) && (report.reportedOn === null || isoDate(report.reportedOn))
      && report.observedOn === null && Array.isArray(report.facts) && report.facts.length > 0
      && report.facts.length <= 100 && typeof report.limitations === 'string', 'Invalid public report or source reference.');
    const source = sources.get(report.sourceID);
    const matchingVenues = source.venues.filter((venue, index) => {
      const match = matches.get(`${report.sourceID}|${index}`);
      const labels = [venue.nameEnglish, match?.venueLabel,
        ...(text(venue.addressOrLocation) ? [`${venue.nameEnglish} — ${venue.addressOrLocation}`] : [])];
      return match?.matchedPlaceIDs.includes(report.placeID) && labels.includes(report.venueLabel);
    });
    check(matchingVenues.length === 1, 'Public report lacks one exact matched source venue.');
    const supported = new Set(matchingVenues[0].facts.map(fact => stable({
      field: fact.field, value: fact.value, reportedOn: fact.reportedOn ?? null,
    })));
    const used = new Set();
    for (const fact of report.facts) {
      const key = stable(fact);
      check(sameKeys(fact, ['field', 'value']) && FACT_FIELDS.has(fact.field) && text(fact.value)
        && supported.has(stable({ ...fact, reportedOn: report.reportedOn })) && !used.has(key), 'Public report contains an unsupported, differently dated, or duplicated fact.');
      check(!/^[#*]?\d{3,12}[#*]?$/.test(fact.value.trim()), 'Numeric access-code strings are excluded from report facts.');
      used.add(key);
    }
    reports.set(report.id, report);
  }
  return { sources, matches, matchesBySource, publicSources, reports };
}

function parseArgs(argv) {
  const args = {}, valued = new Set(['manifest', 'snapshot', 'report', 'firebase-tools-dir', 'expected-sha']);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : '';
    check((valued.has(key) || key === 'apply') && !(key in args), 'Invalid or repeated command-line option.');
    if (key === 'apply') args[key] = true;
    else {
      check(typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('--'), 'Missing command-line option value.');
      args[key] = argv[++i];
    }
  }
  check(['manifest', 'snapshot', 'report', 'firebase-tools-dir'].every(key => text(args[key], 4096)), 'Required: --manifest --snapshot --report --firebase-tools-dir; optional --apply --expected-sha.');
  for (const key of ['manifest', 'snapshot', 'report', 'firebase-tools-dir']) args[key] = resolve(args[key]);
  check(new Set([args.manifest, args.snapshot, args.report]).size === 3, 'Manifest, snapshot, and report paths must be distinct.');
  return args;
}

function decode(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) { const number = Number(value.integerValue); check(Number.isSafeInteger(number), 'Stored integer is unsafe.'); return number; }
  if ('doubleValue' in value) return value.doubleValue;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decode);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([key, entry]) => [key, decode(entry)]));
  throw new ImportError('Unsupported stored research value.');
}
const dataOf = document => Object.fromEntries(Object.entries(document.fields ?? {}).map(([key, value]) => [key, decode(value)]));

function encode(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (object(value)) return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encode(entry)])) } };
  throw new ImportError('Unsupported archive value.');
}

function createWrite(path, payload) {
  check(/^restroomResearch\/web-2026-10-21(?:\/(?:sources|reports)\/[a-f0-9]{20})?$/.test(path), 'Unexpected archive target.');
  const update = { name: `${ROOT}/${path}`, fields: Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, encode(value)])) };
  check(Buffer.byteLength(JSON.stringify(update)) < 900_000, 'Archive document exceeds the safe size limit.');
  return { update, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'importedAt', setToServerValue: 'REQUEST_TIME' }] };
}

async function exclusiveJSON(path, value) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); await file.sync(); }
  finally { await file.close(); }
}

async function replaceJSON(path, value) {
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  try { await exclusiveJSON(temporary, value); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => {}); }
}

export async function run(argv = process.argv.slice(2)) {
  let report, reportPath, reportCreated = false, stage = 'validation';
  try {
    const args = parseArgs(argv);
    reportPath = args.report;
    const manifestText = await readFile(args.manifest, 'utf8');
    check(Buffer.byteLength(manifestText) <= 20_000_000, 'Manifest exceeds the safe size limit.');
    const manifestHash = sha(manifestText), manifest = JSON.parse(manifestText);
    const validated = validateManifest(manifest);
    check(!args.apply || args['expected-sha'] === manifestHash, 'Apply requires the exact independently reviewed manifest SHA.');
    const cityFile = JSON.parse(await readFile(new URL('../data/nyc-restrooms/restrooms.json', import.meta.url), 'utf8'));
    check(Array.isArray(cityFile.restrooms), 'Invalid bundled city-place inventory.');
    const knownPlaces = new Set(cityFile.restrooms.map(place => place.id));
    stage = 'authentication';
    // Reuse the configured CLI login only in memory. Never print, export, or save its tokens.
    const cliRequire = createRequire(pathToFileURL(resolve(args['firebase-tools-dir'], 'package.json')));
    const auth = cliRequire('./lib/auth.js');
    const { requireAuth } = cliRequire('./lib/requireAuth.js');
    const { Client } = cliRequire('./lib/apiv2.js');
    const account = auth.getGlobalDefaultAccount();
    check(account, 'Use the configured project Firebase CLI login first.');
    const authOptions = { project: PROJECT };
    auth.setActiveAccount(authOptions, account);
    await requireAuth(authOptions);
    const api = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
    const get = async path => {
      try { return (await api.get(`/${ROOT}/${path}`)).body; }
      catch (error) {
        if (error.status === 404 || error.context?.response?.statusCode === 404 || error.context?.body?.error?.code === 404) return null;
        throw error;
      }
    };
    const list = async path => {
      const documents = []; let pageToken;
      do {
        const response = (await api.get(`/${ROOT}/${path}`, { queryParams: { pageSize: 1000, ...(pageToken ? { pageToken } : {}) } })).body;
        check(!response.documents || Array.isArray(response.documents), 'Unexpected collection response.');
        documents.push(...response.documents ?? []);
        check(documents.length <= 100_000, 'Collection snapshot exceeds the safe size limit.');
        pageToken = response.nextPageToken;
      } while (pageToken);
      return documents;
    };
    stage = 'database-verification';
    const database = (await api.get(`/projects/${PROJECT}/databases/${DATABASE}`)).body;
    check(database.name === `projects/${PROJECT}/databases/${DATABASE}` && database.databaseEdition === 'STANDARD', 'Unexpected Firestore database identity or edition.');
    // This fresh public inventory intentionally does not read private ownership or visitor documents.
    const community = await list('communityRestrooms');
    for (const document of community) {
      check(document.name?.startsWith(`${ROOT}/communityRestrooms/`), 'Unexpected public-place document path.');
      knownPlaces.add(document.name.split('/').at(-1));
    }
    for (const match of manifest.matches) check(match.matchedPlaceIDs.every(id => knownPlaces.has(id)), 'A match targets an unknown public place.');
    for (const sourceReport of validated.reports.values()) check(knownPlaces.has(sourceReport.placeID), 'A report targets an unknown public place.');
    const archiveRoot = `restroomResearch/${BATCH_ID}`;
    const resolved = manifest.matches.filter(match => match.matchedPlaceIDs.length > 0);
    const top = {
      schemaVersion: 1, project: PROJECT, database: DATABASE, batchID: BATCH_ID, cutoff: CUTOFF,
      manifestHash, sourceCount: manifest.sources.length, reportCount: validated.reports.size,
      matchCount: manifest.matches.length, resolvedMatchCount: resolved.length,
      matchedPlaceCount: new Set(resolved.flatMap(match => match.matchedPlaceIDs)).size,
      publicSourceCount: validated.publicSources.size,
    };
    const desired = [{ path: archiveRoot, payload: top }];
    for (const source of manifest.sources) desired.push({ path: `${archiveRoot}/sources/${id20(source.sourceID)}`, payload: {
      sourceID: source.sourceID, manifestHash, source, matches: validated.matchesBySource.get(source.sourceID) ?? [],
    } });
    for (const sourceReport of validated.reports.values()) desired.push({ path: `${archiveRoot}/reports/${sourceReport.id}`, payload: {
      manifestHash, report: sourceReport, sourceID: sourceReport.sourceID, sourceDocumentID: id20(sourceReport.sourceID),
    } });
    const desiredNames = new Set(desired.map(target => `${ROOT}/${target.path}`));
    stage = 'target-review';
    const [existingSources, existingReports] = await Promise.all([list(`${archiveRoot}/sources`), list(`${archiveRoot}/reports`)]);
    check([...existingSources, ...existingReports].every(document => desiredNames.has(document.name)), 'Existing archive contains documents absent from this manifest.');
    const targetSnapshot = [], writes = [];
    for (let offset = 0; offset < desired.length; offset += 12) {
      const targets = desired.slice(offset, offset + 12);
      const states = await Promise.all(targets.map(async target => ({ ...target, document: await get(target.path) })));
      for (const state of states) {
        targetSnapshot.push({ path: state.path, document: state.document });
        if (state.document) {
          const stored = dataOf(state.document);
          check(state.document.fields?.importedAt?.timestampValue && Number.isFinite(Date.parse(stored.importedAt)), 'Existing archive is missing its server import timestamp.');
          delete stored.importedAt;
          check(stable(stored) === stable(state.payload), 'Immutable archive payload differs; stop for review.');
        } else writes.push(createWrite(state.path, state.payload));
      }
    }
    stage = 'snapshot';
    // Exclusive, private, durable snapshot is completed before any Firestore commit.
    await exclusiveJSON(args.snapshot, {
      project: PROJECT, database: DATABASE, batchID: BATCH_ID, manifestHash, capturedAt: new Date().toISOString(),
      databaseIdentity: { name: database.name, databaseEdition: database.databaseEdition },
      targetSnapshot, publicCommunityDocuments: community,
    });
    report = {
      project: PROJECT, database: DATABASE, batchID: BATCH_ID, cutoff: CUTOFF, manifestHash,
      mode: args.apply ? 'apply' : 'dry-run', status: args.apply ? 'ready' : 'planned',
      counts: { sources: manifest.sources.length, reports: validated.reports.size, matches: manifest.matches.length,
        plannedWrites: writes.length, alreadyPresent: desired.length - writes.length },
      plannedPaths: writes.map(write => write.update.name.slice(ROOT.length + 1)),
      committedPaths: [], batchesCommitted: 0, pendingBatchPaths: [],
      startedAt: new Date().toISOString(),
    };
    await exclusiveJSON(args.report, report); reportCreated = true;
    if (args.apply) {
      stage = 'commit';
      for (let offset = 0; offset < writes.length; offset += 300) {
        const batch = writes.slice(offset, offset + 300);
        report.status = 'applying';
        report.pendingBatchPaths = batch.map(write => write.update.name.slice(ROOT.length + 1));
        await replaceJSON(args.report, report);
        // Every mutation has exists:false. A concurrent creation fails the atomic batch; nothing is overwritten.
        await api.post(`/${ROOT}:commit`, { writes: batch });
        report.committedPaths.push(...report.pendingBatchPaths);
        report.pendingBatchPaths = [];
        report.batchesCommitted++;
        await replaceJSON(args.report, report);
      }
      stage = 'readback';
      for (let offset = 0; offset < desired.length; offset += 12) {
        const states = await Promise.all(desired.slice(offset, offset + 12).map(async target => ({ ...target, document: await get(target.path) })));
        for (const state of states) {
          check(state.document, 'Archive readback is missing a target.');
          const stored = dataOf(state.document);
          check(state.document.fields?.importedAt?.timestampValue && Number.isFinite(Date.parse(stored.importedAt)), 'Archive readback is missing its server import timestamp.');
          delete stored.importedAt;
          check(stable(stored) === stable(state.payload), 'Archive readback payload differs.');
        }
      }
      report.status = 'complete';
    }
    report.completedAt = new Date().toISOString();
    await replaceJSON(args.report, report);
    // Counts/hash only: no source text, account information, or credentials on stdout.
    console.log(JSON.stringify({ project: PROJECT, database: DATABASE, batchID: BATCH_ID, manifestHash,
      mode: report.mode, status: report.status, ...report.counts,
      writesCommitted: report.committedPaths.length, batchesCommitted: report.batchesCommitted }));
    return report;
  } catch (error) {
    if (reportCreated && report) {
      report.status = report.pendingBatchPaths.length ? 'commit-outcome-unknown' : 'failed';
      report.failedStage = stage;
      report.requiresReconciliation = stage === 'commit' || stage === 'readback' || report.committedPaths.length > 0;
      report.error = error instanceof ImportError ? error.message : 'Operation failed; raw provider errors are intentionally omitted.';
      await replaceJSON(reportPath, report).catch(() => {});
    }
    // Provider errors can contain request headers or response content. Never print those errors.
    throw new ImportError(error instanceof ImportError ? error.message : `Research import failed during ${stage}; inspect the private report and rerun a read-only preview.`);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
