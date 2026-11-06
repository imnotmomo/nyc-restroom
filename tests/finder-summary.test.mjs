import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = await readFile(new URL("../lib/finder-summary.ts", import.meta.url), "utf8");
const { communityCardSummary, readFinderPlaceLink, resolveFinderPlaceLink } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
const report = { entryRule: "public", passcodeRequired: "no", stepFreeAccess: "yes", submittedAt: "2026-10-20T04:41:25Z", observedOn: null };

test("community summaries separate entry, code and route reports without claiming current conditions", () => {
  const summary = communityCardSummary({ communitySource: report, cleanliness: null });
  assert.deepEqual(summary.facts, [
    { label: "Entry", value: "Public entry reported", unknown: false },
    { label: "Code", value: "No code required · reported", unknown: false },
    { label: "Route", value: "Step-free reported", unknown: false },
    { label: "Conditions", value: "Not reported", unknown: true },
  ]);
  assert.equal(summary.observation, "Observation date not reported");
  assert.equal(summary.submission, "Submitted Oct 20, 2026");
  const restricted = communityCardSummary({ communitySource: { ...report, entryRule: "customers", passcodeRequired: "yes", stepFreeAccess: "no" }, cleanliness: null });
  assert.equal(restricted.facts[0].value, "Customers only reported");
  assert.equal(restricted.facts[1].value, "Code required · reported");
  assert.equal(restricted.facts[2].value, "Not step-free reported");
  assert.doesNotMatch(JSON.stringify(restricted), /purchase|stairs|accessible|verified/i);
});

test("missing and legacy facts remain unknown; submission dates never become observation dates", () => {
  const summary = communityCardSummary({ communitySource: { ...report, entryRule: "unknown", passcodeRequired: undefined, stepFreeAccess: "unknown", observedOn: null }, cleanliness: " " });
  assert.equal(summary.facts.every((item) => item.unknown && item.value === "Not reported"), true);
  assert.equal(summary.observation, "Observation date not reported");
  const observed = communityCardSummary({ communitySource: { ...report, observedOn: "2026-10-01" }, cleanliness: null });
  assert.equal(observed.observation, "Observed on 2026-10-01");
  assert.equal(observed.submission, "Submitted Oct 20, 2026");
  assert.equal(communityCardSummary({ cleanliness: null }), null);
});

test("a separate structured report owns the route summary without borrowing the original submission date", () => {
  const summary = communityCardSummary({ communitySource: report, cleanliness: null, accessDetails: { stairFreeRoute: "unknown" } });
  assert.equal(summary.facts.some((fact) => fact.label === "Route"), false);
  assert.equal(summary.observation, "Observation date not reported");
  assert.equal(summary.submission, "Submitted Oct 20, 2026");
});

test("summary only uses public listing facts and handles malformed submission time without inventing a date", () => {
  const summary = communityCardSummary({ communitySource: { ...report, submittedAt: "not-a-date" }, cleanliness: null, ownCode: "private-3535", notes: [{ soap: "yes" }] });
  assert.equal(summary.submission, "Submission date not reported");
  assert.doesNotMatch(JSON.stringify(summary), /3535|soap/);
});

test("fixed-place links decode every current city ID and community ID without requesting GPS", async () => {
  const dataset = JSON.parse(await readFile(new URL("../data/nyc-restrooms/restrooms.json", import.meta.url), "utf8"));
  for (const place of dataset.restrooms) {
    assert.deepEqual(readFinderPlaceLink(`?place=${encodeURIComponent(place.id)}`), { status: "valid", placeID: place.id });
  }
  for (const placeID of ["community-abcdefghijklmnopqrst", "community-1234567890ABCDEFGHIJ"]) {
    assert.deepEqual(readFinderPlaceLink(`?place=${placeID}`), { status: "valid", placeID });
  }
});

test("place links reject duplicates, empty, long and non-ID values and ignore unrelated parameters", () => {
  for (const search of ["?place=", "?place", "?place=a&place=b", "?place=" + "a".repeat(161), "?place=../../private", "?place=%3Cscript%3E", "?place=with+space", "?place=%E2%98%83"]) {
    assert.deepEqual(readFinderPlaceLink(search), { status: "invalid" });
  }
  assert.deepEqual(readFinderPlaceLink("?q=private-note&code=3535"), { status: "none" });
  assert.deepEqual(readFinderPlaceLink("?place=public-id&q=ignored&code=3535"), { status: "valid", placeID: "public-id" });
});

test("selection resolves only exact IDs already in the public collection, waiting for community load when needed", () => {
  const cityID = "i7jb-7jku:row-cunh~tmjb_ktcf";
  const communityID = "community-abcdefghijklmnopqrst";
  const ids = new Set([cityID]);
  assert.equal(resolveFinderPlaceLink(cityID, ids, true), "found");
  assert.equal(resolveFinderPlaceLink(cityID.toUpperCase(), ids, false), "missing");
  assert.equal(resolveFinderPlaceLink(communityID, ids, true), "pending");
  assert.equal(resolveFinderPlaceLink(communityID, ids, false), "missing");
  assert.equal(resolveFinderPlaceLink(communityID, new Set([...ids, communityID]), false), "found");
  assert.equal(resolveFinderPlaceLink("private-note-id", ids, true), "missing");
  assert.deepEqual([...ids], [cityID]);
});
