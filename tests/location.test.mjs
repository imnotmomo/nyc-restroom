import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = await readFile(new URL("../lib/location.ts", import.meta.url), "utf8");
const outputText = stripTypeScriptTypes(source);
const { locationAvailabilityError, locationFailureMessage, requestBrowserLocation, validCoordinates } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("location preflight distinguishes insecure, missing API, and denied page policy", () => {
  assert.match(locationAvailabilityError({ secureContext: false, hasGeolocation: true }), /HTTPS/);
  assert.match(locationAvailabilityError({ secureContext: true, hasGeolocation: false }), /browser doesn’t provide/);
  assert.match(locationAvailabilityError({ secureContext: true, hasGeolocation: true, allowedByPolicy: false }), /permissions policy/);
  assert.equal(locationAvailabilityError({ secureContext: true, hasGeolocation: true }), null);
});

test("location errors give distinct permission, availability, and timeout guidance", () => {
  const denied = locationFailureMessage({ code: 1 });
  assert.match(denied, /address-bar settings/);
  assert.match(denied, /System Settings/);
  assert.match(denied, /Chrome or Safari/);
  assert.match(locationFailureMessage({ code: 2 }), /couldn’t determine/);
  assert.match(locationFailureMessage({ code: 3 }), /took too long/);
  assert.equal(locationFailureMessage({ name: "SecurityError" }), denied);
});

test("coordinates allow actual locations outside NYC and reject invalid ranges", () => {
  assert.equal(validCoordinates({ latitude: 34.42, longitude: -119.7 }), true);
  assert.equal(validCoordinates({ latitude: 0, longitude: 0 }), true);
  for (const coordinates of [{ latitude: NaN, longitude: -73 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: Infinity }]) {
    assert.equal(validCoordinates(coordinates), false);
  }
});

test("a successful request finishes once and ignores later callbacks", () => {
  const results = [];
  const failures = [];
  let success;
  let failure;
  requestBrowserLocation({
    geolocation: { getCurrentPosition(onSuccess, onError) { success = onSuccess; failure = onError; } },
    onSuccess: (value) => results.push(value), onError: (value) => failures.push(value),
  });
  success({ coords: { latitude: 34.42, longitude: -119.7 } });
  success({ coords: { latitude: 40.8, longitude: -73.9 } });
  failure({ code: 3 });
  assert.deepEqual(results, [{ latitude: 34.42, longitude: -119.7 }]);
  assert.deepEqual(failures, []);
});

test("cancelled/unmounted requests ignore their late callbacks", () => {
  let success;
  let failure;
  let calls = 0;
  const cancel = requestBrowserLocation({
    geolocation: { getCurrentPosition(onSuccess, onError) { success = onSuccess; failure = onError; } },
    onSuccess: () => calls++, onError: () => calls++,
  });
  cancel();
  success({ coords: { latitude: 40.8, longitude: -73.9 } });
  failure({ code: 1 });
  assert.equal(calls, 0);
});

test("host silence times out and a later location is ignored", async () => {
  let success;
  let calls = 0;
  const error = await new Promise((resolve) => requestBrowserLocation({
    geolocation: { getCurrentPosition(onSuccess) { success = onSuccess; } },
    watchdogMs: 5,
    onSuccess: () => calls++, onError: resolve,
  }));
  assert.match(error, /took too long/);
  success({ coords: { latitude: 40.8, longitude: -73.9 } });
  assert.equal(calls, 0);
});

test("synchronous browser security errors and invalid coordinates return useful errors", () => {
  const messages = [];
  requestBrowserLocation({
    geolocation: { getCurrentPosition() { throw new DOMException("blocked", "SecurityError"); } },
    onSuccess: () => assert.fail("No location was returned"), onError: (error) => messages.push(error),
  });
  requestBrowserLocation({
    geolocation: { getCurrentPosition(success) { success({ coords: { latitude: 100, longitude: 0 } }); } },
    onSuccess: () => assert.fail("Invalid coordinates must not update the map"), onError: (error) => messages.push(error),
  });
  assert.match(messages[0], /Location is blocked/);
  assert.match(messages[1], /invalid location/);
});
