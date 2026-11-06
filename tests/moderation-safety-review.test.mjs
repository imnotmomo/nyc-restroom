import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

const moduleURL = source => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`;
const adapterURL = moduleURL(await readFile(new URL("../lib/moderation-client.ts", import.meta.url), "utf8"));
const reducerSource = (await readFile(new URL("../components/admin/safety-review-state.ts", import.meta.url), "utf8"))
  .replace('"@/lib/moderation-client"', JSON.stringify(adapterURL));
const { emptySafetyReview: empty, safetyReviewReducer: reduce, safetyDecisionAllowed: allowed,
  canConfirmSafetyReview: canConfirm } = await import(moduleURL(reducerSource));
const actionId = "d9e685c4-a47e-4e81-81d1-29e163dcd588";
const report = () => ({ id: "b0c1ede6-cfff-467a-8381-e6dcb562de68", kind: "unified-visit", placeID: "community-abcdefghijklmnopqrst",
  recordID: "visit-one", reason: "harassment", status: "pending", createdAt: "2026-11-05T18:00:00.000Z", reviewedAt: null,
  decision: null, revision: "1793901600:1", text: "Example reported visitor text.", available: true, canSuspend: true });
const open = (decision = "remove", item = report()) => reduce(empty, { type: "open", item, decision, actionId });
const reason = state => reduce(state, { type: "reason", reason: "harassment" });

test("each report decision requires a deliberate fixed category before confirmation", () => {
  for (const decision of ["dismiss", "remove"]) {
    const state = open(decision);
    assert.equal(canConfirm(state), false);
    assert.equal(reduce(state, { type: "begin" }), state);
    assert.equal(reduce(state, { type: "reason", reason: "arbitrary private audit text" }), state);
    assert.equal(canConfirm(reason(state)), true);
  }
});

test("author suspension needs explicit acknowledgement beyond the removal reason", () => {
  let state = reason(open("remove-and-suspend"));
  assert.equal(canConfirm(state), false);
  state = reduce(state, { type: "acknowledge", value: true });
  assert.equal(canConfirm(state), true);
  assert.equal(reduce(state, { type: "begin" }).busy, true);
});

test("source text cannot suspend an author even when a malformed permission flag says yes", () => {
  for (const kind of ["source-comment", "research-comment"]) {
    const item = { ...report(), kind, canSuspend: true };
    assert.equal(allowed(item, "remove"), true);
    assert.equal(allowed(item, "remove-and-suspend"), false);
    assert.equal(open("remove-and-suspend", item), empty);
  }
});

test("a verified shared-code owner can be suspended only with explicit permission and acknowledgement", () => {
  for (const kind of ["legacy-code", "v2-code"]) {
    const item = { ...report(), kind, text: "1234", canSuspend: true };
    assert.equal(allowed(item, "remove-and-suspend"), true);
    const state = reason(open("remove-and-suspend", item));
    assert.equal(canConfirm(state), false);
    assert.equal(canConfirm(reduce(state, { type: "acknowledge", value: true })), true);
    const ownerless = { ...item, canSuspend: false };
    assert.equal(allowed(ownerless, "remove"), true);
    assert.equal(allowed(ownerless, "remove-and-suspend"), false);
    assert.equal(open("remove-and-suspend", ownerless), empty);
  }
});

test("an unavailable reported version can only be dismissed; resolved reports cannot be acted on", () => {
  const unavailable = { ...report(), available: false, text: null, canSuspend: false };
  assert.equal(allowed(unavailable, "dismiss"), true);
  assert.equal(allowed(unavailable, "remove"), false);
  assert.equal(allowed(unavailable, "remove-and-suspend"), false);
  assert.equal(canConfirm(reason(open("dismiss", unavailable))), true);
  for (const decision of ["dismiss", "remove", "remove-and-suspend"]) {
    assert.equal(allowed({ ...report(), status: "resolved" }, decision), false);
  }
});

test("Cancel before sending clears the draft, while an in-flight action cannot be changed or closed", () => {
  assert.equal(reduce(open(), { type: "close" }), empty);
  const busy = reduce(reason(open()), { type: "begin" });
  for (const event of [{ type: "close" }, { type: "reason", reason: "spam" }, { type: "acknowledge", value: false },
    { type: "open", item: report(), decision: "dismiss", actionId: "another-action" }]) {
    assert.equal(reduce(busy, event), busy);
  }
});

test("ambiguous retries pin report, content version, decision, reason and action ID across queue navigation", () => {
  const source = report();
  let state = reason(open("remove", source));
  source.revision = "1793901601:2"; source.text = "A later edited version.";
  state = reduce(state, { type: "begin" });
  state = reduce(state, { type: "failed", error: "Network result unknown", uncertain: true });
  const pinned = structuredClone(state.attempt);
  state = reduce(state, { type: "close" });
  assert.equal(state.open, false);
  for (const event of [{ type: "reason", reason: "spam" }, { type: "acknowledge", value: true },
    { type: "open", item: { ...report(), id: "different-report" }, decision: "dismiss", actionId: "different-action" }]) {
    state = reduce(state, event);
  }
  assert.deepEqual(state.attempt, pinned);
  assert.equal(state.attempt.item.revision, "1793901600:1");
  assert.equal(state.attempt.item.text, "Example reported visitor text.");
  state = reduce(state, { type: "resume" });
  assert.equal(state.open, true);
  assert.equal(canConfirm(state), true);
  assert.equal(reduce(state, { type: "begin" }).attempt.actionId, actionId);
});

test("a later definite failure cannot unlock an already ambiguous attempt", () => {
  let state = reduce(reason(open()), { type: "failed", error: "Unconfirmed", uncertain: true });
  state = reduce(state, { type: "begin" });
  state = reduce(state, { type: "failed", error: "Request rejected", uncertain: false });
  assert.equal(state.attempt.uncertain, true);
  assert.equal(reduce(state, { type: "reason", reason: "spam" }), state);
});

test("confirmed success, stale version handling and account loss can clear all private action state", () => {
  const state = reduce(reason(open()), { type: "failed", error: "Unconfirmed", uncertain: true });
  assert.deepEqual(reduce(state, { type: "reset" }), { attempt: null, open: false, busy: false, error: null });
});
