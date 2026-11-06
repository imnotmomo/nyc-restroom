import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

const source = await readFile(new URL("../lib/moderation-client.ts", import.meta.url), "utf8");
const api = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
const time = "2026-11-05T18:00:00.000Z";
const place = "community-abcdefghijklmnopqrst";
const actionId = "d9e685c4-a47e-4e81-81d1-29e163dcd588";
const request = () => ({
  id: place, status: "pending", revision: 1, submittedAt: time, reviewedAt: null, reason: null, hasCodeDraft: true,
  listing: { name: "Emulator café", address: "100 Test Street, New York", latitude: 40.75, longitude: -73.98,
    locationType: "cafe", entryRule: "customers", stepFreeAccess: "unknown", notes: "Ask at the counter.", observedOn: "2026-11-04T00:00:00.000Z", submittedAt: time, passcodeRequired: "yes" },
});
const comment = () => ({ id: "abcdefghijklmnopqrst", placeID: place, venueName: "Emulator café", kind: "unified-visit", text: "A public visitor observation.", authorLabel: "Anonymous", observedAt: "2026-11-04T17:00:00.000Z", submittedAt: time, revision: "1793901600:000000001" });
const session = { user: { email: "moderator@example.test", displayName: "Test moderator" }, role: "moderator" };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const identity = () => ({ getToken: async () => "PRIVATE_TEST_TOKEN", isCurrent: () => true });
const invalid = error => error instanceof api.ModerationApiError && error.code === "invalid_response";

test("session decoding requires the server moderator role and excludes unexpected private fields", () => {
  assert.deepEqual(api.decodeModeratorSession(session), session);
  assert.throws(() => api.decodeModeratorSession({ ...session, role: "admin" }), invalid);
  assert.throws(() => api.decodeModeratorSession({ ...session, roster: ["private-user"] }), invalid);
  assert.throws(() => api.decodeModeratorSession({ ...session, user: { ...session.user, uid: "private-user" } }), invalid);
});

test("request DTO preserves original dates and admits only the code-presence Boolean", () => {
  const data = request();
  assert.deepEqual(api.decodeModerationRequest(data), data);
  assert.equal(api.decodeModerationRequest(data).submittedAt, time);
  for (const extra of [{ ownerUID: "private-user" }, { codeDraft: { code: "PRIVATE_CODE", visibility: "private" } }, { codeFingerprint: "PRIVATE_DIGEST" }]) {
    assert.throws(() => api.decodeModerationRequest({ ...data, ...extra }), invalid);
  }
  assert.throws(() => api.decodeModerationRequest({ ...data, listing: { ...data.listing, code: "PRIVATE_CODE" } }), invalid);
  assert.throws(() => api.decodeModerationRequest({ ...data, listing: { ...data.listing, submittedAt: "2026-11-05T18:00:01.000Z" } }), invalid);
});

test("request DTO rejects unsafe identities, bad pin coordinates and inconsistent review state", () => {
  assert.throws(() => api.decodeModerationRequest({ ...request(), id: "../../users/private" }), invalid);
  assert.throws(() => api.decodeModerationRequest({ ...request(), listing: { ...request().listing, latitude: 0 } }), invalid);
  assert.throws(() => api.decodeModerationRequest({ ...request(), reviewedAt: time }), invalid);
  assert.throws(() => api.decodeModerationRequest({ ...request(), status: "denied", reviewedAt: time, reason: "arbitrary private text" }), invalid);
  const approved = api.decodeModerationRequest({ ...request(), status: "approved", revision: 2, reviewedAt: time, reason: "", hasCodeDraft: false });
  assert.equal(approved.status, "approved");
});

test("visitor DTO keeps original posting/visit times and exact revision without owner fields", () => {
  assert.deepEqual(api.decodeModerationComment(comment()), comment());
  assert.throws(() => api.decodeModerationComment({ ...comment(), ownerUID: "private-user" }), invalid);
  assert.throws(() => api.decodeModerationComment({ ...comment(), kind: "source-research" }), invalid);
  assert.throws(() => api.decodeModerationComment({ ...comment(), id: "../secrets" }), invalid);
  assert.throws(() => api.decodeModerationComment({ ...comment(), text: "" }), invalid);
});

test("paginated DTOs enforce a bounded page and opaque bounded cursor", () => {
  assert.deepEqual(api.decodeModerationPage({ items: [request()], nextCursor: "opaque-server-token" }, api.decodeModerationRequest), { items: [request()], nextCursor: "opaque-server-token" });
  assert.throws(() => api.decodeModerationPage({ items: Array(26).fill(request()), nextCursor: null }, api.decodeModerationRequest), invalid);
  assert.throws(() => api.decodeModerationPage({ items: [], nextCursor: "x".repeat(4_097) }, api.decodeModerationRequest), invalid);
  assert.throws(() => api.decodeModerationPage({ items: [], nextCursor: null, privatePath: "users/private" }, api.decodeModerationRequest), invalid);
});

test("transport uses same-origin bearer API, no-store and no cookie credentials", async () => {
  const calls = [];
  const client = api.createModerationClient(identity(), async (url, options) => { calls.push({ url, options }); return response(session); });
  await client.session();
  assert.equal(calls[0].url, "/api/moderation/session");
  assert.equal(calls[0].options.headers.Authorization, "Bearer PRIVATE_TEST_TOKEN");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].url.includes("PRIVATE_TEST_TOKEN"), false);
});

test("an already changed account cannot request a token or send a request", async () => {
  let tokens = 0; let network = 0;
  const client = api.createModerationClient({ isCurrent: () => false, getToken: async () => { tokens++; return "private"; } }, async () => { network++; return response(session); });
  await assert.rejects(client.session(), error => error.code === "account_changed");
  assert.equal(tokens, 0); assert.equal(network, 0);
});

test("account switch during token fetch prevents the API request", async () => {
  let current = true; let calls = 0;
  const client = api.createModerationClient({ isCurrent: () => current, getToken: async () => { current = false; return "PRIVATE_TEST_TOKEN"; } }, async () => { calls++; return response(session); });
  await assert.rejects(client.session(), error => error.code === "account_changed");
  assert.equal(calls, 0);
});

test("account switch while reading a response prevents returning its data", async () => {
  let current = true;
  const client = api.createModerationClient({ isCurrent: () => current, getToken: async () => "private" }, async () => ({ ok: true, status: 200, text: async () => { current = false; return JSON.stringify(session); } }));
  await assert.rejects(client.session(), error => error.code === "account_changed");
});

test("permission errors expose fixed safe text instead of server or SDK details", async () => {
  const client = api.createModerationClient(identity(), async () => response({ error: "PRIVATE_SDK_MESSAGE", message: "PRIVATE_USER_ID" }, 403));
  await assert.rejects(client.session(), error => error.status === 403 && error.code === "moderator_required"
    && !error.message.includes("PRIVATE") && !error.uncertain);
});

test("expired cursor and stale revision remain distinguishable refresh errors", async () => {
  const client = api.createModerationClient(identity(), async url => response({ error: url.includes("requests?") ? "cursor_expired" : "stale_revision" }, url.includes("requests?") ? 410 : 409));
  await assert.rejects(client.requests("pending", "opaque"), error => error.status === 410 && error.code === "cursor_expired");
  await assert.rejects(client.decide(request(), "approve", "", actionId), error => error.status === 409 && error.code === "stale_revision" && !error.uncertain);
});

test("ambiguous decision retry sends the identical action receipt and no listing data", async () => {
  const sent = [];
  const client = api.createModerationClient(identity(), async (url, options) => {
    sent.push({ url, body: JSON.parse(options.body) });
    if (sent.length === 1) throw new TypeError("private network diagnostic");
    return response({ id: place, status: "approved", revision: 2, reviewedAt: time });
  });
  await assert.rejects(client.decide(request(), "approve", "", actionId), error => error.uncertain && error.code === "request_unconfirmed" && !error.message.includes("private network"));
  const result = await client.decide(request(), "approve", "", actionId);
  assert.equal(result.status, "approved");
  assert.deepEqual(sent[0], sent[1]);
  assert.deepEqual(Object.keys(sent[0].body).sort(), ["actionId", "decision", "reason", "revision"]);
});

test("bad actions never reach the network and decision response must match its target", async () => {
  let calls = 0;
  const client = api.createModerationClient(identity(), async () => { calls++; return response({ id: place, status: "denied", revision: 2, reviewedAt: time }); });
  assert.throws(() => client.decide(request(), "deny", "arbitrary text", actionId), error => error.status === 400);
  assert.throws(() => client.decide(request(), "approve", "", "not-a-uuid"), error => error.status === 400);
  assert.equal(calls, 0);
  await assert.rejects(client.decide(request(), "approve", "", actionId), invalid);
});

test("comment removal preserves the exact revision and accepts only its own removal result", async () => {
  const sent = [];
  const target = comment();
  const client = api.createModerationClient(identity(), async (url, options) => { sent.push({ url, body: JSON.parse(options.body) }); return response({ id: target.id, placeID: target.placeID, kind: target.kind, status: "removed", mode: "redacted" }); });
  const result = await client.removeComment(target, "personal_information", actionId);
  assert.equal(result.mode, "redacted"); assert.equal(sent[0].body.revision, target.revision);
  assert.deepEqual(Object.keys(sent[0].body).sort(), ["actionId", "reason", "revision"]);
  assert.equal(sent[0].url, `/api/moderation/comments/unified-visit/${place}/${target.id}/remove`);
});

test("abort before token retrieval sends no request", async () => {
  const controller = new AbortController(); controller.abort();
  let tokenRequests = 0; let network = 0;
  const client = api.createModerationClient({ getToken: async () => { tokenRequests++; return "private"; }, isCurrent: () => true }, async () => { network++; return response(session); });
  await assert.rejects(client.session(controller.signal), error => error.name === "AbortError");
  assert.equal(tokenRequests, 0); assert.equal(network, 0);
});

const safetyReport=()=>({id:actionId,kind:'public-note',placeID:'i7jb-7jku:safety',recordID:'N'.repeat(20),reason:'harassment',status:'pending',createdAt:time,reviewedAt:null,decision:null,revision:'1793901600:1',text:'Synthetic public content.',available:true,canSuspend:true});
test('private safety report decoder admits only pinned public-shaped fields and no author/reporter identity',()=>{
 assert.deepEqual(api.decodeModerationSafetyReport(safetyReport()),safetyReport());
 for(const extra of [{reporterUID:'private'},{ownerUID:'private'},{code:'private'}])assert.throws(()=>api.decodeModerationSafetyReport({...safetyReport(),...extra}),invalid);
 for(const kind of ['source-comment','research-comment']){assert.doesNotThrow(()=>api.decodeModerationSafetyReport({...safetyReport(),kind,canSuspend:false}));assert.throws(()=>api.decodeModerationSafetyReport({...safetyReport(),kind}),invalid);}
 assert.throws(()=>api.decodeModerationSafetyReport({...safetyReport(),available:false}),invalid);
 assert.throws(()=>api.decodeModerationSafetyReport({...safetyReport(),status:'resolved'}),invalid);
});
test('safety resolution sends one exact stable action with safe transport and validates receipt target/decision',async()=>{
 const item=safetyReport();let sent;
 const client=api.createModerationClient(identity(),async(url,options)=>{sent={url,options};return response({reportID:item.id,status:'resolved',decision:'remove-and-suspend',mode:'deleted'});});
 assert.deepEqual(await client.resolveReport(item,'remove-and-suspend','harassment',actionId),{reportID:item.id,status:'resolved',decision:'remove-and-suspend',mode:'deleted'});
 assert.equal(sent.url,`/api/moderation/reports/${actionId}/resolve`);assert.deepEqual(JSON.parse(sent.options.body),{decision:'remove-and-suspend',revision:item.revision,reason:'harassment',actionId});assert.equal(sent.options.credentials,'omit');assert.equal(sent.options.redirect,'error');
 const malformed=api.createModerationClient(identity(),async()=>response({reportID:item.id,status:'resolved',decision:'dismiss',mode:null}));await assert.rejects(malformed.resolveReport(item,'remove','harassment',actionId),invalid);
});
