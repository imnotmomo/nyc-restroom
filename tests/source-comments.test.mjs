import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Timestamp } from "firebase/firestore";
import { loadBindings, transform } from "next/dist/build/swc/index.js";

const require = createRequire(import.meta.url);
await loadBindings();
async function compile(relative, imports) {
  const source = await readFile(new URL(relative, import.meta.url), "utf8");
  const compiled = await transform(source, { filename: relative, jsc: { parser: { syntax: "typescript", tsx: relative.endsWith("tsx") },
    target: "es2022", transform: { react: { runtime: "automatic" } } }, module: { type: "commonjs" } });
  const module = { exports: {} };
  new Function("module", "exports", "require", compiled.code)(module, module.exports, (name) => Object.hasOwn(imports, name) ? imports[name] : require(name));
  return module.exports;
}
let listener, disconnected = false, connected = true;
const sdk = {
  Timestamp,
  getFirestore: (app) => app,
  collection: (database, ...path) => ({ database, path }),
  orderBy: (field, direction) => ({ orderBy: field, direction }),
  limit: (value) => ({ limit: value }),
  query: (collection, ...constraints) => ({ collection, constraints }),
  onSnapshot: (feed, options, changed, failed) => { listener = { feed, options, changed, failed }; return () => { disconnected = true; }; },
};
const model = await compile("../lib/source-comments.ts", {
  "firebase/firestore": sdk,
  "@/lib/firebase-client": { getFirebaseClient: () => connected ? { app: "mock-app" } : null },
});
const component = await compile("../components/finder/source-comments.tsx", {
  "@/lib/source-comments": model,
  "./source-comments.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) },
});
const placeID = "i7jb-7jku:row-example~one";
const id = "0123456789abcdef0123";
const fixture = () => ({ placeID, sourceID: "xhs-native-comment-one", sourceKind: "comment", text: "The restroom is downstairs; the complete route is not reported.",
  displayName: "Anonymous user", publishedOn: "2026-10-16", displayedDate: "5d ago", dateStatus: "resolved-relative", sourceURL: null,
  sourceTitle: "Xiaohongshu restroom discussion", capturedAt: "2026-10-21T12:00:00.000Z", observedOn: null, verified: false,
  limitations: "Not independently verified. Entry permission was not stated.", submittedAt: Timestamp.fromDate(new Date("2026-10-21T13:00:00.000Z")) });
const decode = (data = fixture()) => model.decodeSourceComment(id, placeID, data);
const entry = (data = fixture(), documentID = id) => ({ id: documentID, data: () => data });
const snapshot = (docs, metadata = {}) => ({ docs, metadata: { fromCache: false, hasPendingWrites: false, ...metadata } });

test("imported comments keep source, capture and import dates independent without inventing a visit or verification", () => {
  const record = decode();
  assert.equal(record.publishedOn, "2026-10-16");
  assert.equal(record.capturedAt.toISOString(), "2026-10-21T12:00:00.000Z");
  assert.equal(record.submittedAt.toISOString(), "2026-10-21T13:00:00.000Z");
  assert.equal(record.observedOn, null); assert.equal(record.verified, false);
  assert.equal(record.displayName, "Anonymous user");
  assert.equal(record.sourceKind, "comment");
  assert.equal(decode({ ...fixture(), sourceKind: "post" }).sourceKind, "post");
  assert.deepEqual(Object.keys(record).sort(), [...Object.keys(fixture()), "id"].sort());
});

test("strict public schema rejects extra author/account fields, missing fields, false verification and mismatched place IDs", () => {
  for (const key of ["author", "accountUID", "uid", "email", "privateSourceCommentAuthor", "ownerUID", "rating", "code"]) {
    assert.throws(() => decode({ ...fixture(), [key]: "private-value" }));
  }
  for (const key of Object.keys(fixture())) { const data = fixture(); delete data[key]; assert.throws(() => decode(data)); }
  for (const patch of [{ displayName: "Source username" }, { observedOn: "2026-10-16" }, { verified: true }, { placeID: "another-place" },
    { sourceID: "../private" }, { sourceKind: "discussion" }, { sourceKind: null }, { dateStatus: "verified" }, { text: "x".repeat(1001) }, { text: "bad\u0000text" }, { sourceTitle: "Private 中文 title" }]) {
    assert.throws(() => decode({ ...fixture(), ...patch }));
  }
  for (const bad of [null, [], "comment", true, 7]) assert.throws(() => decode(bad));
  for (const bad of ["0123", "A".repeat(20), `${id}/nested`, `${id}\n`]) assert.throws(() => model.decodeSourceComment(bad, placeID, fixture()));
  for (const bad of ["../users/alice", "space place", "place\n", "", "x".repeat(161)]) assert.equal(model.isSourceCommentPlaceID(bad), false);
});

test("unknown-year comments retain a null source date; historical explicit dates and separately dated comments are allowed", () => {
  for (const dateStatus of ["unknown-year", "unknown"]) {
    const record = decode({ ...fixture(), publishedOn: null, dateStatus, displayedDate: "10/3" });
    assert.equal(record.publishedOn, null); assert.equal(record.displayedDate, "10/3");
    assert.throws(() => decode({ ...fixture(), dateStatus }));
  }
  assert.equal(decode({ ...fixture(), publishedOn: "2025-10-03", dateStatus: "explicit-year" }).publishedOn, "2025-10-03");
  for (const dateStatus of ["explicit-year", "resolved-relative"]) assert.throws(() => decode({ ...fixture(), dateStatus, publishedOn: null }));
});

test("calendar dates and Timestamp types reject impossible dates, source-after-capture and capture-after-import", () => {
  for (const publishedOn of ["2026-02-29", "2026-04-31", "2026-10-22", "2026-1-1", "2026-10-16T12:00:00Z", "1999-12-31"]) assert.throws(() => decode({ ...fixture(), publishedOn }));
  for (const capturedAt of ["2026-02-30T12:00:00Z", "2026-10-21T24:01:00Z", "2026-10-21T14:00:00Z", "yesterday", "2026-10-21"]) assert.throws(() => decode({ ...fixture(), capturedAt }));
  for (const submittedAt of [new Date(), "2026-10-21T13:00:00Z", { toDate: () => new Date() }, null, Timestamp.fromDate(new Date("1999-01-01T00:00:00Z"))]) assert.throws(() => decode({ ...fixture(), submittedAt }));
  assert.equal(model.formatSourceCommentDate("2026-10-16"), "Oct 16, 2026");
});

test("source links allow public HTTPS without credentials, local hosts, executable URLs or secret parameters", () => {
  for (const sourceURL of ["javascript:alert(1)", "data:text/html,test", "http://example.com", "https://u:p@example.com", "https://localhost", "https://127.1", "https://host.local", "https://[::1]", "https://example.com:8443", "https://example.com/a b", "https://example.com/?xsec_token=secret"]) assert.throws(() => decode({ ...fixture(), sourceURL }));
  assert.equal(decode({ ...fixture(), sourceURL: "https://www.xiaohongshu.com/explore/native-id" }).sourceURL, "https://www.xiaohongshu.com/explore/native-id");
});

test("anonymous listener uses only the bounded per-place public collection ordered by import time", () => {
  const records = [], errors = []; disconnected = false; connected = true;
  const stop = model.watchSourceComments(placeID, (value) => records.push(value), (error) => errors.push(error));
  assert.deepEqual(listener.feed.collection.path, ["restroomSourceComments", placeID, "comments"]);
  assert.deepEqual(listener.feed.constraints, [{ orderBy: "submittedAt", direction: "desc" }, { limit: 10 }]);
  listener.changed(snapshot([entry()], { fromCache: true }));
  listener.changed(snapshot([entry()], { hasPendingWrites: true })); assert.equal(records.length, 0);
  listener.changed(snapshot([entry()])); assert.equal(records.at(-1).length, 1); assert.equal(errors.length, 0);
  stop(); assert.equal(disconnected, true);
  listener.changed(snapshot([])); listener.failed({ message: "private provider response" });
  assert.equal(records.length, 1); assert.equal(errors.length, 0);
});

test("invalid records stay hidden while valid comments remain; provider errors are redacted", () => {
  const records = [], errors = [];
  const stop = model.watchSourceComments(placeID, (value) => records.push(value), (error) => errors.push(error.message));
  listener.changed(snapshot([entry(), entry({ ...fixture(), author: "private-name" }, "11111111111111111111")]));
  assert.equal(records.at(-1).length, 1); assert.match(errors.at(-1), /hidden/);
  listener.failed({ message: "secret private provider response" }); assert.doesNotMatch(errors.at(-1), /secret|private provider/);
  stop();
});

test("invalid/unconfigured listener errors are asynchronous and cancelled cleanly", async () => {
  const errors = []; connected = false;
  const stop = model.watchSourceComments(placeID, () => assert.fail("No records expected"), (error) => errors.push(error));
  stop(); await new Promise(queueMicrotask); assert.equal(errors.length, 0);
  model.watchSourceComments("../invalid", () => assert.fail("No records expected"), (error) => errors.push(error));
  assert.equal(errors.length, 0); await new Promise(queueMicrotask); assert.equal(errors.length, 1); connected = true;
});

test("rendered source notes distinguish posts/comments and keep capture/import details collapsed while escaping source text", () => {
  const record = decode({ ...fixture(), text: '<img src=x onerror="alert(1)"> A source claim.', sourceTitle: "<script>source title</script>", sourceURL: "https://www.xiaohongshu.com/explore/native-id" });
  const html = renderToStaticMarkup(createElement(component.SourceCommentList, { comments: [record] }));
  for (const phrase of ["From Xiaohongshu", "Anonymous user", "English paraphrase", "(approx.)", "Source retrieved", "Imported, unverified source report"]) assert.ok(html.includes(phrase), phrase);
  const visible = html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, "");
  assert.doesNotMatch(visible, /Source retrieved|Displayed source date|Source link|Visit date|2026-10-21T/);
  assert.equal((visible.match(/Imported, unverified source report/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  const postHTML = renderToStaticMarkup(createElement(component.SourceCommentList, { comments: [decode({ ...fixture(), sourceKind: "post" })] }));
  assert.match(postHTML, /Source publication/); assert.doesNotMatch(postHTML, /From Xiaohongshu/);
  assert.match(html, /&lt;img src=x/); assert.match(html, /&lt;script&gt;source title&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img|<script|Source username|star-rating|verified badge/);
  assert.match(html, /rel="noopener noreferrer"/); assert.match(html, /referrerPolicy="no-referrer"/i);
  assert.match(html, /dateTime="2026-10-16"/i); assert.match(html, /dateTime="2026-10-21T12:00:00.000Z"/i); assert.match(html, /dateTime="2026-10-21T13:00:00.000Z"/i);
});

test("rendered unknown-year comments never promote capture/import year to source year", () => {
  const record = decode({ ...fixture(), publishedOn: null, dateStatus: "unknown-year", displayedDate: "10/3" });
  const html = renderToStaticMarkup(createElement(component.SourceCommentList, { comments: [record] }));
  assert.match(html, /10\/3 · year unknown/);
  assert.match(html, /Retrieval and import dates do not establish a publication or visit date/);
  assert.match(html, /Source link not available/); assert.doesNotMatch(html, /<a /);
  assert.doesNotMatch(html, /dateTime="2026-10-03"/i);
});

test("platform attribution uses exact safe source domains instead of a hardcoded social platform or source title", () => {
  for (const [url, label] of [
    ["https://old.reddit.com/r/AskNYC/comments/example/", "From Reddit"],
    ["https://www.facebook.com/public-post", "From Facebook"],
    ["https://www.google.com/maps/place/example", "From Google"],
    ["https://maps.app.goo.gl/example", "From Google"],
    ["https://www.nycgovparks.org/parks/example/facilities/bathrooms", "From NYC Parks"],
    ["https://data.cityofnewyork.us/resource/example.json", "From NYC Open Data"],
    ["https://reddit.com.example.org/source", "From source website"],
    ["https://www.nypl.org/locations/example", "From source website"],
  ]) assert.equal(model.sourceCommentAttribution({ sourceURL: url, sourceKind: "post" }), label);
  assert.equal(model.sourceCommentAttribution({ sourceURL: null, sourceKind: "comment" }), "Source comment");
  assert.throws(() => model.sourceCommentAttribution({ sourceURL: "javascript:alert(1)", sourceKind: "post" }));
});

test("undated official pages and separately dated inspections do not acquire a publication year", () => {
  const comment = decode({ ...fixture(), sourceKind: "post", dateStatus: "unknown", publishedOn: null,
    displayedDate: "Inspection: 2026-09-15", sourceTitle: "NYC Parks inspection", sourceURL: "https://www.nycgovparks.org/parks/example" });
  const html = renderToStaticMarkup(createElement(component.SourceCommentList, { comments: [comment] }));
  const visible = html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, "");
  assert.match(visible, /From NYC Parks/); assert.match(visible, /Publication date not shown/);
  assert.doesNotMatch(visible, /year unknown|2026-09-15|Screenshot/);
  assert.match(html, /Displayed source date<\/dt><dd>Inspection: 2026-09-15/);
  const undated = renderToStaticMarkup(createElement(component.SourceCommentList, { comments: [decode({ ...fixture(),
    dateStatus: "unknown", publishedOn: null, displayedDate: "Publication date not shown" })] }));
  assert.doesNotMatch(undated, /Publication date not shown · year unknown/);
});

test("profile coverage removes only exact comment IDs while other legacy comments stay visible", () => {
  const covered = decode({ ...fixture(), text: "Already incorporated in the field rows." });
  const legacy = model.decodeSourceComment("11111111111111111111", placeID, { ...fixture(), text: "Older legacy route directions remain available." });
  const html = renderToStaticMarkup(createElement(component.SourceCommentList, { comments: [covered, legacy], excludeIDs: [covered.id] }));
  assert.doesNotMatch(html, /Already incorporated/); assert.match(html, /Older legacy route directions remain available/);
  assert.equal(component.uncoveredSourceComments([covered, legacy], []).length, 2);
});
