import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const source = await readFile(new URL("../lib/analytics.ts", import.meta.url), "utf8");
const model = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
const origin = "https://nyc.imfinethanku.me";
function harness(url = `${origin}/`, referrer = "") {
  const calls = [];
  const client = model.createAnalyticsClient({ id: "G-MOCKTEST", initialUrl: url, referrer, transport: (...args) => calls.push(args) });
  return { client, calls, events: (name) => calls.filter(([kind, event]) => kind === "event" && event === name) };
}

test("analytics requires a valid explicit ID and an exact production HTTPS origin", () => {
  assert.equal(model.measurementId(undefined, "G-A1B2"), "G-A1B2");
  assert.equal(model.measurementId("G-OVERRIDE", "G-A1B2"), "G-OVERRIDE");
  assert.equal(model.measurementId("", "G-A1B2"), "G-A1B2");
  assert.equal(model.measurementId("  ", "G-A1B2"), "G-A1B2");
  for (const value of ["559243633", "UA-123", "G-test", "G-<script>"]) assert.equal(model.measurementId(value, ""), null);
  assert.equal(model.isAnalyticsOrigin(origin), true);
  assert.equal(model.isAnalyticsOrigin("https://restroom-ready-nyc.clcii.chatgpt.site"), true);
  for (const value of ["http://nyc.imfinethanku.me", "https://nyc.imfinethanku.me.evil.test", "https://nyc.imfinethanku.me:444", "http://localhost:4173", "https://user:password@nyc.imfinethanku.me"]) {
    assert.equal(model.isAnalyticsOrigin(value), false);
    assert.equal(harness(`${value}/`).client, null);
  }
});

test("only known routes and safe lowercase campaign labels survive URL sanitization", () => {
  assert.equal(model.analyticsPageLocation(`${origin}/find?email=person%40example.com&lat=40.81234&lng=-73.92345&notes=private&utm_source=Reddit&utm_campaign=HW5#user-private-note`), `${origin}/find/?utm_source=reddit&utm_campaign=hw5`);
  assert.equal(model.analyticsPageLocation(`${origin}/?utm_source=%20Reddit%20&utm_term=person%40example.com&utm_medium=40.12345&utm_content=${"a".repeat(121)}`), `${origin}/?utm_source=reddit`);
  for (const path of ["/", "/conditions/", "/entry-route/", "/dated-reports/", "/find/", "/demo/", "/privacy/", "/thank-you/"]) assert.equal(model.analyticsPageLocation(`${origin}${path}`), `${origin}${path}`);
  for (const path of ["/access/", "/api/finder-access/", "/person@example.com/", "/40.12345,-73.98765/", "/find/secret/", "/find//"]) assert.equal(model.analyticsPageLocation(`${origin}${path}`), null);
});

test("referrers exclude sensitive query strings, fragments, credentials, and external paths", () => {
  assert.equal(model.analyticsReferrer(`${origin}/conditions/?email=secret@example.com#note`, origin), `${origin}/conditions/`);
  assert.equal(model.analyticsReferrer("https://example.com/private/person@example.com?q=40.1234#note", origin), "https://example.com");
  assert.equal(model.analyticsReferrer(`${origin}/private-person@example.com/`, origin), origin);
  for (const value of ["", "javascript:alert(1)", "not a URL"]) assert.equal(model.analyticsReferrer(value, origin), "");
});

test("manual pageviews deduplicate repeated effects but count navigation and back/forward", () => {
  const { client, calls, events } = harness(`${origin}/?utm_source=Reddit&email=secret@example.com`, "https://search.example/private?q=secret");
  assert.ok(client);
  assert.equal(client.pageView(`${origin}/?utm_source=Reddit&email=secret@example.com`, "Home"), true);
  assert.equal(client.pageView(`${origin}/?utm_source=reddit&lat=40.123456#private`, "Home"), false);
  assert.equal(client.pageView(`${origin}/find/`, "Find a restroom"), true);
  assert.equal(client.pageView(`${origin}/?utm_source=reddit`, "Home"), true);
  assert.equal(client.pageView(`${origin}/find/`, "Find a restroom"), true);
  assert.equal(client.pageView(`${origin}/person@example.com/`, "Unknown"), false);
  assert.equal(client.pageView("https://restroom-ready-nyc.clcii.chatgpt.site/find/", "Wrong origin"), false);
  assert.equal(events("page_view").length, 4);
  assert.equal(events("page_view")[0][2].page_referrer, "https://search.example");
  assert.equal(events("page_view")[1][2].page_referrer, `${origin}/?utm_source=reddit`);
  assert.equal(calls.filter(([kind]) => kind === "config").length, 1);
  assert.equal(calls.find(([kind]) => kind === "config")[2].send_page_view, false);
  assert.equal(calls.find(([kind]) => kind === "config")[2].allow_google_signals, false);
  assert.equal(calls.find(([kind]) => kind === "config")[2].allow_ad_personalization_signals, false);
  assert.equal(calls[1][0], "set");
  assert.equal(calls[1][1].page_location, `${origin}/?utm_source=reddit`);
  assert.doesNotMatch(JSON.stringify(calls), /secret|40\.123456|person@|user_id|email_address/);
});

test("only a confirmed first-time Google account produces one private signup event", () => {
  const { client, events, calls } = harness(`${origin}/find/`);
  const result = { isNewUser: true, providerId: "google.com", accountId: "private-account", currentAccountId: "private-account" };
  assert.equal(client.confirmedGoogleSignup(result), true);
  assert.equal(client.confirmedGoogleSignup(result), false);
  assert.deepEqual(events("sign_up"), [["event", "sign_up", { method: "google", send_to: "G-MOCKTEST" }]]);
  assert.equal(events("generate_lead").length, 0);
  assert.doesNotMatch(JSON.stringify(calls), /private-account|user_id|email|uid|waitlist/);
});

test("returning, restored, unknown, non-Google and stale-account results never count as signup", () => {
  const { client, events } = harness(`${origin}/find/`);
  const result = { isNewUser: true, providerId: "google.com", accountId: "private-account", currentAccountId: "private-account" };
  for (const change of [
    { isNewUser: false }, { isNewUser: undefined }, { providerId: "password" },
    { providerId: null }, { accountId: "" }, { currentAccountId: null }, { currentAccountId: "different-account" },
  ]) assert.equal(client.confirmedGoogleSignup({ ...result, ...change }), false);
  client.pageView(`${origin}/thank-you/`, "Legacy thank you");
  assert.equal(events("sign_up").length, 0);
  assert.equal(events("generate_lead").length, 0);
  assert.equal(client.confirmedGoogleSignup(result), true);
});
