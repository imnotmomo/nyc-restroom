import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = await readFile(new URL("../lib/accessibility.ts", import.meta.url), "utf8");
const { accessibilityStatus, ACCESSIBILITY_VALUES } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);

test("city and community positive reports use one shared Accessible value", () => {
  const city = { facilityAccessibility: "Fully Accessible" };
  const community = { facilityAccessibility: null, communitySource: { stepFreeAccess: "yes" } };
  for (const place of [city, community]) {
    assert.equal(accessibilityStatus(place), "reported");
    assert.equal(ACCESSIBILITY_VALUES[accessibilityStatus(place)], "Reported accessible");
  }
});

test("partial, missing and malformed city facts stay unconfirmed", () => {
  for (const facilityAccessibility of ["Partially Accessible", "Not Accessible", "fully accessible", "", null, undefined, true, 1]) {
    const status = accessibilityStatus({ facilityAccessibility });
    assert.equal(status, "unknown");
    assert.equal(ACCESSIBILITY_VALUES[status], "Not confirmed");
  }
  assert.equal(accessibilityStatus({}), "unknown");
});

test("only exact community yes qualifies and unknowns never fall back to a city value", () => {
  for (const stepFreeAccess of ["no", "unknown", undefined, null, false, true, "Yes", "", 1]) {
    assert.equal(accessibilityStatus({ facilityAccessibility: "Fully Accessible", communitySource: { stepFreeAccess } }), "unknown");
  }
  for (const communitySource of [null, undefined, false, "yes", [], {}]) {
    assert.equal(accessibilityStatus({ facilityAccessibility: "Fully Accessible", communitySource }), "unknown");
  }
  assert.equal(accessibilityStatus({ facilityAccessibility: "Not Accessible", communitySource: { stepFreeAccess: "yes" } }), "reported");
});

test("stairs, elevator prose and private notes cannot manufacture a positive status", () => {
  assert.equal(accessibilityStatus({ accessNotes: "Elevator, 0 stairs, accessible", stairsToRestroom: "0", restroomFloor: "23rd floor" }), "unknown");
  assert.equal(accessibilityStatus({ communitySource: { stepFreeAccess: "unknown" }, privateNote: "Accessible", visitReports: [{ stairs: "no" }] }), "unknown");
});

test("unified status leaves original source values and provenance intact", () => {
  for (const place of [
    { facilityAccessibility: "Fully Accessible", sourceRecordId: "city-source", sourceUrl: "https://example.org/source" },
    { facilityAccessibility: null, communitySource: { stepFreeAccess: "yes", observedOn: null } },
  ]) {
    const before = JSON.stringify(place);
    accessibilityStatus(place);
    assert.equal(JSON.stringify(place), before);
  }
});
