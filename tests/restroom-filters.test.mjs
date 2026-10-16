import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = await readFile(new URL("../lib/restroom-filters.ts", import.meta.url), "utf8");
const outputText = stripTypeScriptTypes(source);
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
    { value: "clean", label: "Clean (4★+)" },
    { value: "accessible", label: "Accessible" },
    { value: "saved", label: "Saved" },
  ]);
  for (const option of FILTER_OPTIONS) assert.ok(FILTER_HELP[option.value].length > 20);
  assert.match(FILTER_HELP.public, /Entry rules, fees/);
  assert.match(FILTER_HELP.clean, /Community cleanliness ratings averaging at least 4/);
  assert.match(FILTER_HELP.clean, /Unrated locations are excluded/);
  assert.match(FILTER_HELP.accessible, /routes and stalls are not confirmed/);
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
  assert.equal(matchesRestroomFilter(community, "accessible", noSavedPlaces), false);
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

test("Saved uses only the supplied current-account IDs and does not mutate them", () => {
  const savedIDs = new Set([place.id, "another-place"]);
  assert.equal(matchesRestroomFilter(place, "saved", savedIDs), true);
  assert.equal(matchesRestroomFilter(place, "saved", new Set(["someone-elses-place"])), false);
  assert.equal(matchesRestroomFilter(place, "saved", noSavedPlaces), false);
  assert.deepEqual([...savedIDs], [place.id, "another-place"]);
});

test("current official source counts remain truthful and filtering preserves source IDs and records", () => {
  const before = JSON.stringify(dataset);
  const idsBefore = dataset.restrooms.map((restroom) => restroom.id);
  const counts = Object.fromEntries(FILTER_OPTIONS.map(({ value }) => [value, dataset.restrooms.filter((restroom) => matchesRestroomFilter(restroom, value, noSavedPlaces)).length]));
  assert.deepEqual(counts, { all: 1064, public: 1064, clean: 0, accessible: 619, saved: 0 });
  const privatelyOwned = dataset.restrooms.filter((restroom) => restroom.locationType === "Privately Owned Public Space");
  assert.equal(privatelyOwned.length, 14);
  assert.equal(privatelyOwned.every((restroom) => matchesRestroomFilter(restroom, "public", noSavedPlaces)), true);
  assert.deepEqual(dataset.restrooms.map((restroom) => restroom.id), idsBefore);
  assert.equal(JSON.stringify(dataset), before);
});
