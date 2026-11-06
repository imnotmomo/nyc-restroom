import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = await readFile(new URL("../lib/restroom-filters.ts", import.meta.url), "utf8");
const accessibilitySource = await readFile(new URL("../lib/accessibility.ts", import.meta.url), "utf8");
const accessibilityURL = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(accessibilitySource)).toString("base64")}`;
const accessSource = await readFile(new URL("../lib/restroom-access-details-model.ts", import.meta.url), "utf8");
const accessURL = `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(accessSource)).toString("base64")}`;
const outputText = stripTypeScriptTypes(source).replace('"@/lib/accessibility"', JSON.stringify(accessibilityURL)).replace('"@/lib/restroom-access-details-model"', JSON.stringify(accessURL));
const { FILTER_OPTIONS, FILTER_HELP, matchesRestroomFilter } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const dataset = JSON.parse(await readFile(new URL("../data/nyc-restrooms/restrooms.json", import.meta.url), "utf8"));
const noSavedPlaces = new Set();
const place = {
  id: "fixture-place",
  sourceRecordId: "fixture-source-record",
  sourceUrl: "https://data.cityofnewyork.us/City-Government/Public-Restrooms/i7jb-7jku",
  facilityAccessibility: "Fully Accessible",
};
const rating = { average: 4, ratingCount: 1, sourceUrl: "https://example.org/public-cleanliness-reports" };

test("filter options have the requested order, exact labels, and meaningful explanations", () => {
  assert.deepEqual(FILTER_OPTIONS, [
    { value: "all", label: "ALL" },
    { value: "public", label: "Public" },
    { value: "no-code", label: "No code" },
    { value: "clean", label: "Clean (4★+)" },
    { value: "accessible", label: "Accessible" },
    { value: "stair-free", label: "Stair Free" },
    { value: "saved", label: "Saved" },
  ]);
  for (const option of FILTER_OPTIONS) assert.ok(FILTER_HELP[option.value].length > 20);
  assert.match(FILTER_HELP.public, /Entry rules, fees/);
  assert.match(FILTER_HELP["no-code"], /explicitly reported as not requiring a code/);
  assert.match(FILTER_HELP["no-code"], /Unknown requirements and missing code reports are excluded/);
  assert.match(FILTER_HELP.clean, /Community cleanliness ratings averaging at least 4/);
  assert.match(FILTER_HELP.clean, /Unrated locations are excluded/);
  assert.match(FILTER_HELP.accessible, /Locations reported as accessible/);
  assert.match(FILTER_HELP.accessible, /route details and source dates/);
  assert.match(FILTER_HELP.accessible, /stall features and current availability are not confirmed/);
  assert.match(FILTER_HELP["stair-free"], /street to the restroom/);
});

test("Public recognizes official-directory records including privately owned public spaces", () => {
  assert.equal(matchesRestroomFilter({ ...place, locationType: "Privately Owned Public Space", operator: "Private operator" }, "public", noSavedPlaces), true);
  assert.equal(matchesRestroomFilter({ ...place, locationType: "Park" }, "public", noSavedPlaces), true);
  for (const sourceRecordId of [null, undefined, "", "  "]) {
    assert.equal(matchesRestroomFilter({ ...place, sourceRecordId }, "public", noSavedPlaces), false);
  }
  for (const sourceUrl of [null, undefined, "", "https://example.org/", `${place.sourceUrl}/`, "http://data.cityofnewyork.us/City-Government/Public-Restrooms/i7jb-7jku"]) {
    assert.equal(matchesRestroomFilter({ ...place, sourceUrl }, "public", noSavedPlaces), false);
  }
});

test("visitor reports of public permission appear in Public without claiming city accessibility", () => {
  const community = { ...place, id: "community-abcdefghijklmnopqrst", sourceRecordId: null, sourceUrl: null, facilityAccessibility: null,
    communitySource: { entryRule: "public", stepFreeAccess: "yes", submittedAt: "2026-10-15T12:00:00.000Z", observedOn: null } };
  assert.equal(matchesRestroomFilter(community, "all", noSavedPlaces), true);
  assert.equal(matchesRestroomFilter(community, "public", noSavedPlaces), true);
  assert.equal(matchesRestroomFilter(community, "accessible", noSavedPlaces), true);
  for (const entryRule of ["customers", "unknown"]) {
    assert.equal(matchesRestroomFilter({ ...community, communitySource: { ...community.communitySource, entryRule } }, "public", noSavedPlaces), false);
  }
  assert.equal(matchesRestroomFilter({ ...community, cleanlinessRating: rating }, "clean", noSavedPlaces), true);
  assert.equal(matchesRestroomFilter(community, "saved", new Set([community.id])), true);
});

test("Clean accepts the four-star boundary and requires attributable numeric ratings", () => {
  for (const average of [4, 4.5, 5]) {
    assert.equal(matchesRestroomFilter({ ...place, cleanlinessRating: { ...rating, average } }, "clean", noSavedPlaces), true);
  }
  for (const average of [3.9999, 0, -1, 5.001, NaN, Infinity, -Infinity, "4", null, undefined]) {
    assert.equal(matchesRestroomFilter({ ...place, cleanlinessRating: { ...rating, average } }, "clean", noSavedPlaces), false);
  }
  for (const ratingCount of [0, -1, 0.5, NaN, Infinity, "2", null, undefined]) {
    assert.equal(matchesRestroomFilter({ ...place, cleanlinessRating: { ...rating, ratingCount } }, "clean", noSavedPlaces), false);
  }
  for (const sourceUrl of ["", " ", null, undefined, "/reports/1", "javascript:alert(1)", "data:text/plain,rating", "https://", "https:example.org", "https://person:secret@example.org/reports"]) {
    assert.equal(matchesRestroomFilter({ ...place, cleanlinessRating: { ...rating, sourceUrl } }, "clean", noSavedPlaces), false);
  }
  assert.equal(matchesRestroomFilter({ ...place, cleanlinessRating: { ...rating, sourceUrl: "http://example.org/reports" } }, "clean", noSavedPlaces), true);
});

test("No code requires an explicit public listing report, never missing codes or private knowledge", () => {
  const communitySource = { entryRule: "customers", stepFreeAccess: "unknown", submittedAt: "2026-10-20T12:00:00.000Z", observedOn: null };
  assert.equal(matchesRestroomFilter({ ...place, communitySource: { ...communitySource, passcodeRequired: "no" } }, "no-code", noSavedPlaces), true);
  for (const passcodeRequired of ["yes", "unknown", undefined, null, false, "No"]) {
    assert.equal(matchesRestroomFilter({ ...place, communitySource: { ...communitySource, passcodeRequired } }, "no-code", noSavedPlaces), false);
  }
  for (const fixture of [place, { ...place, publicReports: [] }, { ...place, passcodeRequired: "no", privateNote: "No code" }]) {
    assert.equal(matchesRestroomFilter(fixture, "no-code", noSavedPlaces), false);
  }
  assert.equal(matchesRestroomFilter({ ...place, communitySource: { ...communitySource, passcodeRequired: "yes" }, publicReports: [] }, "no-code", noSavedPlaces), false);
});

test("missing ratings and private condition text never become four-star public cleanliness claims", () => {
  for (const fixture of [
    place,
    { ...place, cleanlinessRating: null },
    { ...place, cleanliness: "Clean" },
    { ...place, condition: "usable", soap: "yes", toiletPaper: "yes" },
    { ...place, average: 5, ratingCount: 100, sourceUrl: "https://example.org/private-note" },
  ]) {
    assert.equal(matchesRestroomFilter(fixture, "clean", noSavedPlaces), false);
  }
});

test("Accessible matches the exact facility label without claiming partial or unknown access", () => {
  assert.equal(matchesRestroomFilter(place, "accessible", noSavedPlaces), true);
  for (const facilityAccessibility of ["Partially Accessible", "Limited Accessibility", "Not Accessible", null, undefined, "", "fully accessible"]) {
    assert.equal(matchesRestroomFilter({ ...place, facilityAccessibility }, "accessible", noSavedPlaces), false);
  }
});

test("Accessible includes explicit community step-free reports without changing city provenance", () => {
  const community = { ...place, id: "community-abcdefghijklmnopqrst", sourceRecordId: null, sourceUrl: null, facilityAccessibility: null,
    communitySource: { entryRule: "unknown", stepFreeAccess: "yes", submittedAt: "2026-10-22T12:00:00.000Z", observedOn: null } };
  const before = JSON.stringify(community);
  assert.equal(matchesRestroomFilter(community, "accessible", noSavedPlaces), true);
  assert.equal(community.facilityAccessibility, null);
  assert.equal(community.sourceRecordId, null);
  assert.equal(community.sourceUrl, null);
  assert.equal(JSON.stringify(community), before);
  for (const stepFreeAccess of ["no", "unknown", undefined, null, false, "Yes", ""]) {
    assert.equal(matchesRestroomFilter({ ...community, facilityAccessibility: "Fully Accessible", communitySource: { ...community.communitySource, stepFreeAccess } }, "accessible", noSavedPlaces), false);
  }

  for (const stepFreeAccess of ["no", "unknown", undefined, null, false, "Yes", "", 1]) {
    assert.equal(matchesRestroomFilter({ ...community, communitySource: { ...community.communitySource, stepFreeAccess } }, "accessible", noSavedPlaces), false);
  }
  for (const fixture of [
    { ...community, communitySource: undefined, stepFreeAccess: "yes" },
    { ...community, communitySource: { ...community.communitySource, stepFreeAccess: "unknown" }, accessNotes: "Accessible by elevator; no stairs" },
    { ...community, communitySource: { ...community.communitySource, stepFreeAccess: "unknown" }, visitReports: [{ stairs: "no" }] },
  ]) {
    assert.equal(matchesRestroomFilter(fixture, "accessible", noSavedPlaces), false);
  }
});

test("Saved uses only the supplied current-account IDs and does not mutate them", () => {
  const savedIDs = new Set([place.id, "another-place"]);
  assert.equal(matchesRestroomFilter(place, "saved", savedIDs), true);
  assert.equal(matchesRestroomFilter(place, "saved", new Set(["someone-elses-place"])), false);
  assert.equal(matchesRestroomFilter(place, "saved", noSavedPlaces), false);
  assert.deepEqual([...savedIDs], [place.id, "another-place"]);
});

test("Stair Free requires a complete route report and honors sidecar unknown or negative answers", () => {
  const community = { ...place, communitySource: { stepFreeAccess: "yes" } };
  assert.equal(matchesRestroomFilter(community, "stair-free", noSavedPlaces), true);
  assert.equal(matchesRestroomFilter({ ...place, accessDetails: { placeID: place.id, stairFreeRoute: "yes" } }, "stair-free", noSavedPlaces), true);
  for (const stairFreeRoute of ["no", "unknown"]) {
    assert.equal(matchesRestroomFilter({ ...community, accessDetails: { placeID: place.id, stairFreeRoute } }, "stair-free", noSavedPlaces), false);
  }
  for (const fixture of [place, { ...place, stairsToRestroom: "0" }, { ...place, restroomFloor: "Ground floor" }, { ...place, accessNotes: "No stairs, accessible elevator" }, { ...place, accessDetails: { placeID: place.id, stairFreeRoute: "unknown", entranceStepFree: "yes", elevatorToRestroom: "yes", stairsAfterEntry: 0 } }]) {
    assert.equal(matchesRestroomFilter(fixture, "stair-free", noSavedPlaces), false);
  }
  for (const contradiction of [{ entranceStepFree: "no", stairsAfterEntry: 0 }, { entranceStepFree: "yes", stairsAfterEntry: 2 }]) {
    assert.equal(matchesRestroomFilter({ ...community, accessDetails: { placeID: place.id, stairFreeRoute: "yes", ...contradiction } }, "stair-free", noSavedPlaces), false);
  }
});

test("current official source counts remain truthful and filtering preserves source IDs and records", () => {
  const before = JSON.stringify(dataset);
  const idsBefore = dataset.restrooms.map((restroom) => restroom.id);
  const counts = Object.fromEntries(FILTER_OPTIONS.map(({ value }) => [value, dataset.restrooms.filter((restroom) => matchesRestroomFilter(restroom, value, noSavedPlaces)).length]));
  assert.deepEqual(counts, { all: 1064, public: 1064, "no-code": 0, clean: 0, accessible: 619, "stair-free": 0, saved: 0 });
  const privatelyOwned = dataset.restrooms.filter((restroom) => restroom.locationType === "Privately Owned Public Space");
  assert.equal(privatelyOwned.length, 14);
  assert.equal(privatelyOwned.every((restroom) => matchesRestroomFilter(restroom, "public", noSavedPlaces)), true);
  assert.deepEqual(dataset.restrooms.map((restroom) => restroom.id), idsBefore);
  assert.equal(JSON.stringify(dataset), before);
});
