import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { Timestamp } from "firebase/firestore";
import { loadBindings, transform } from "next/dist/build/swc/index.js";

const source = await readFile(new URL("../lib/restroom-access-details-model.ts", import.meta.url), "utf8");
const model = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
const { ACCESS_DETAILS_FEED_LIMIT, decodeRestroomAccessDetails, attachRestroomAccessDetails, stairFreeRouteStatus, elevatorToRestroomStatus, accessDetailsCardFacts, accessDetailsProvenance } = model;
const placeID = "community-7398fe084d3d87eed23c";
class WireTimestamp { constructor(value) { this.value = value; } }
const readTimestamp = (value) => value instanceof WireTimestamp ? new Date(value.value) : null;
const wire = (overrides = {}) => ({
  schemaVersion: 1, placeID,
  restroomHours: "Open 24 hours a day, 7 days a week",
  entranceLocation: "Use the step-free doors on the right side of the main entrance.",
  entranceStepFree: "yes", stairFreeRoute: "yes", elevatorToRestroom: "yes",
  elevatorNote: "Take the elevator and choose Penthouse.", restroomFloor: "23rd floor", stairsAfterEntry: 0,
  sourceTitle: "Contributor report", reportedAt: new WireTimestamp("2026-10-23T14:00:00Z"), observedOn: null,
  updatedAt: new WireTimestamp("2026-10-23T14:05:00Z"), limitations: "Entry permission and current availability are not confirmed.",
  ...overrides,
});
const decode = (overrides = {}, id = placeID) => decodeRestroomAccessDetails(id, wire(overrides), readTimestamp);

test("the shared contract preserves zero stairs, explicit route answers and a missing observation date", () => {
  const details = decode();
  assert.equal(Object.keys(details).length, 15);
  assert.equal(details.stairsAfterEntry, 0);
  assert.equal(details.observedOn, null);
  assert.equal(details.reportedAt.toISOString(), "2026-10-23T14:00:00.000Z");
  assert.equal(ACCESS_DETAILS_FEED_LIMIT, 1000);
  const unknown = decode({ entranceStepFree: "unknown", stairFreeRoute: "no", elevatorToRestroom: "unknown", restroomHours: null, entranceLocation: null, elevatorNote: null, restroomFloor: null, stairsAfterEntry: null });
  assert.equal(unknown.entranceStepFree, "unknown");
  assert.equal(unknown.stairFreeRoute, "no");
  assert.equal(unknown.stairsAfterEntry, null);
});

test("extra, missing, mismatched or unsafe IDs and unsupported schema versions are rejected", () => {
  for (const overrides of [{ extra: "private fact" }, { placeID: "some-other-place" }, { schemaVersion: 2 }, { schemaVersion: "1" }]) assert.throws(() => decode(overrides));
  const missing = wire(); delete missing.limitations;
  assert.throws(() => decodeRestroomAccessDetails(placeID, missing, readTimestamp));
  for (const id of ["", "../private", "with space", "a".repeat(161)]) assert.throws(() => decode({}, id));
  for (const raw of [null, [], "report", 1]) assert.throws(() => decodeRestroomAccessDetails(placeID, raw, readTimestamp));
});

test("bounded text rejects empty strings, control characters and coercion", () => {
  const limits = { restroomHours: 160, entranceLocation: 500, elevatorNote: 300, restroomFloor: 80, sourceTitle: 160, limitations: 1000 };
  for (const [key, maximum] of Object.entries(limits)) {
    assert.equal(decode({ [key]: "x".repeat(maximum) })[key].length, maximum);
    for (const value of ["", " ", "x".repeat(maximum + 1), "line\nbreak", "tab\ttext", "hidden\u007f", "hidden\u0085", 24, false, undefined]) assert.throws(() => decode({ [key]: value }), key);
  }
  for (const key of ["sourceTitle", "limitations"]) assert.throws(() => decode({ [key]: null }));
});

test("only exact tri-state answers and integer stairs in the contract range are accepted", () => {
  for (const key of ["entranceStepFree", "stairFreeRoute", "elevatorToRestroom"]) {
    for (const value of [true, false, null, undefined, "Yes", "", 1]) assert.throws(() => decode({ [key]: value }));
    for (const value of ["yes", "no", "unknown"]) assert.equal(decode({ ...(key === "entranceStepFree" ? { stairFreeRoute: "unknown" } : {}), [key]: value })[key], value);
  }
  for (const stairsAfterEntry of [-1, 201, 1.5, "0", false, NaN, Infinity, undefined]) assert.throws(() => decode({ stairsAfterEntry }));
  assert.equal(decode({ stairsAfterEntry: 200, stairFreeRoute: "no" }).stairsAfterEntry, 200);
});

test("contradictory positive route reports are rejected without filling unknown entrance or stair facts", () => {
  assert.throws(() => decode({ entranceStepFree: "no", stairFreeRoute: "yes" }));
  assert.throws(() => decode({ stairsAfterEntry: 1, stairFreeRoute: "yes" }));
  assert.equal(decode({ entranceStepFree: "unknown", stairsAfterEntry: null, stairFreeRoute: "yes" }).stairFreeRoute, "yes");
  assert.equal(decode({ entranceStepFree: "no", stairsAfterEntry: 0, stairFreeRoute: "no" }).stairFreeRoute, "no");
  const details = decode();
  assert.equal(stairFreeRouteStatus({ id: placeID, accessDetails: { ...details, entranceStepFree: "no" } }), "unknown");
  assert.equal(stairFreeRouteStatus({ id: placeID, accessDetails: { ...details, stairsAfterEntry: 1 } }), "unknown");
});

test("timestamps stay distinct and ordered; strings, numeric epochs and nonfinite dates are rejected", () => {
  for (const key of ["reportedAt", "observedOn", "updatedAt"]) {
    for (const value of ["2026-10-23T14:00:00Z", 1792764000000, new Date(), new WireTimestamp("bad-date"), undefined]) assert.throws(() => decode({ [key]: value }));
  }
  assert.throws(() => decode({ reportedAt: null }));
  assert.throws(() => decode({ updatedAt: null }));
  assert.throws(() => decode({ observedOn: new WireTimestamp("2026-10-24T00:00:00Z") }));
  assert.throws(() => decode({ updatedAt: new WireTimestamp("2026-10-22T00:00:00Z") }));
  const details = decode({ observedOn: new WireTimestamp("2026-10-20T13:00:00Z") });
  assert.match(accessDetailsProvenance(details), /Reported Oct 23, 2026 · Observed Oct 20, 2026/);
});

test("sidecars attach only to exact known stable IDs without mutating source facts or creating listings", () => {
  const original = { id: placeID, name: "Peninsula", hours: null, restroomFloor: null, observationDate: null, communitySource: { entryRule: "unknown", stepFreeAccess: "yes", submittedAt: "2026-10-20T00:00:00Z", observedOn: null } };
  const similarlyNamed = { ...original, id: "different-place" };
  const before = JSON.stringify([original, similarlyNamed]);
  const details = decode();
  const attached = attachRestroomAccessDetails([original, similarlyNamed], [details, { ...details, placeID: "unknown-public-id" }]);
  assert.equal(attached.length, 2);
  assert.equal(attached[0].accessDetails, details);
  assert.equal(attached[1].accessDetails, undefined);
  assert.equal(attached[0].hours, null);
  assert.equal(attached[0].restroomFloor, null);
  assert.equal(attached[0].observationDate, null);
  assert.equal(attached[0].communitySource, original.communitySource);
  assert.equal(JSON.stringify([original, similarlyNamed]), before);
});

test("route and elevator capability require explicit evidence and sidecar unknowns own their status", () => {
  const place = { id: placeID, facilityAccessibility: "Fully Accessible", stairsToRestroom: "0", accessNotes: "Elevator, no stairs", communitySource: { stepFreeAccess: "yes" } };
  assert.equal(stairFreeRouteStatus(place), "yes");
  assert.equal(elevatorToRestroomStatus(place), "unknown");
  for (const answer of ["yes", "no", "unknown"]) {
    const withDetails = { ...place, accessDetails: decode({ stairFreeRoute: answer, elevatorToRestroom: answer }) };
    assert.equal(stairFreeRouteStatus(withDetails), answer);
    assert.equal(elevatorToRestroomStatus(withDetails), answer);
  }
  assert.equal(stairFreeRouteStatus({ ...place, communitySource: undefined }), "unknown");
  assert.equal(stairFreeRouteStatus({ ...place, communitySource: undefined, accessDetails: { ...decode(), placeID: "different-place" } }), "unknown");
});

test("compact facts show known hours, entrance and Penthouse route with separate source and date", () => {
  const details = decode();
  const facts = Object.fromEntries(accessDetailsCardFacts(details).map(({ label, value }) => [label, value]));
  assert.equal(facts["Restroom hours"], "Open 24 hours a day, 7 days a week");
  assert.match(facts.Entrance, /right side/);
  assert.equal(facts["Restroom floor"], "23rd floor");
  assert.equal(facts["Stairs after entry"], "0");
  assert.equal(facts["Stair-free route"], "Yes — reported");
  assert.match(facts["Elevator route"], /Penthouse/);
  assert.equal(accessDetailsProvenance(details), "Contributor report · Reported Oct 23, 2026 · Observation date not reported");
  assert.doesNotMatch(JSON.stringify(facts), /public entry|purchase|inspection|always open/i);
  assert.equal(Object.fromEntries(accessDetailsCardFacts(decode({ stairFreeRoute: "unknown" })).map(({ label, value }) => [label, value]))["Stair-free route"], "Not reported");
});

await loadBindings();
let listener, disconnected = false, connected = true;
const sdk = {
  Timestamp, getFirestore: (app) => app, collection: (database, ...path) => ({ database, path }),
  orderBy: (field, direction) => ({ orderBy: field, direction }), limit: (value) => ({ limit: value }),
  query: (collection, ...constraints) => ({ collection, constraints }),
  onSnapshot: (feed, options, changed, failed) => { listener = { feed, options, changed, failed }; return () => { disconnected = true; }; },
};
const feedSource = await readFile(new URL("../lib/restroom-access-details.ts", import.meta.url), "utf8");
const compiled = await transform(feedSource, { filename: "restroom-access-details.ts", jsc: { parser: { syntax: "typescript" }, target: "es2022" }, module: { type: "commonjs" } });
const module = { exports: {} };
const imports = { "firebase/firestore": sdk, "@/lib/firebase-client": { getFirebaseClient: () => connected ? { app: "mock-app" } : null }, "@/lib/restroom-access-details-model": model };
new Function("module", "exports", "require", compiled.code)(module, module.exports, (name) => imports[name]);
const { watchRestroomAccessDetails } = module.exports;
const firestoreWire = () => ({ ...wire(), reportedAt: Timestamp.fromDate(new Date("2026-10-23T14:00:00Z")), updatedAt: Timestamp.fromDate(new Date("2026-10-23T14:05:00Z")) });
const entry = (data = firestoreWire(), id = placeID) => ({ id, data: () => data });
const snapshot = (docs, metadata = {}) => ({ docs, metadata: { fromCache: false, hasPendingWrites: false, ...metadata } });

test("the public listener is globally bounded and ignores cached, pending and post-unsubscribe snapshots", () => {
  const records = [], errors = []; disconnected = false; connected = true;
  const stop = watchRestroomAccessDetails((value) => records.push(value), (error) => errors.push(error));
  assert.deepEqual(listener.feed.collection.path, ["restroomAccessDetails"]);
  assert.deepEqual(listener.feed.constraints, [{ orderBy: "updatedAt", direction: "desc" }, { limit: 1000 }]);
  listener.changed(snapshot([entry()], { fromCache: true }));
  listener.changed(snapshot([entry()], { hasPendingWrites: true }));
  assert.equal(records.length, 0);
  listener.changed(snapshot([entry()]));
  assert.equal(records.at(-1)[0].stairsAfterEntry, 0);
  assert.equal(records.at(-1)[0].observedOn, null);
  stop(); assert.equal(disconnected, true);
  listener.changed(snapshot([])); listener.failed({ message: "private provider response" });
  assert.equal(records.length, 1); assert.equal(errors.length, 0);
});

test("malformed timestamps or reports fail the feed instead of authorizing a community fallback", () => {
  const records = [], errors = [];
  const stop = watchRestroomAccessDetails((value) => records.push(value), (error) => errors.push(error.message));
  for (const data of [{ ...firestoreWire(), reportedAt: new Date() }, { ...firestoreWire(), reportedAt: { toDate: () => new Date() } }, { ...firestoreWire(), stairFreeRoute: "yes", stairsAfterEntry: 1 }, { ...firestoreWire(), extra: "private-value" }]) {
    listener.changed(snapshot([entry(data)]));
    assert.match(errors.at(-1), /could not be read safely/);
  }
  assert.equal(records.length, 0);
  listener.failed({ message: "secret raw provider response" });
  assert.doesNotMatch(errors.at(-1), /secret|raw provider/);
  listener.changed(snapshot([])); assert.deepEqual(records, [[]]);
  stop();
});

test("unconfigured feed errors are asynchronous and cancellation suppresses late callbacks", async () => {
  const errors = []; connected = false;
  const stop = watchRestroomAccessDetails(() => assert.fail("No records expected"), (error) => errors.push(error));
  stop(); await new Promise(queueMicrotask); assert.equal(errors.length, 0);
  watchRestroomAccessDetails(() => assert.fail("No records expected"), (error) => errors.push(error));
  assert.equal(errors.length, 0); await new Promise(queueMicrotask); assert.equal(errors.length, 1);
  connected = true;
});
