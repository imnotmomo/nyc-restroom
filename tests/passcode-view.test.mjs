import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadBindings, transform } from 'next/dist/build/swc/index.js';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

await loadBindings();
const root = fileURLToPath(new URL('../', import.meta.url));
const modules = new Map();
async function moduleURL(relative) {
  if (modules.has(relative)) return modules.get(relative);
  const source = await readFile(path.join(root, relative), 'utf8');
  let output = (await transform(source, { filename: relative, jsc: { parser: { syntax: 'typescript', tsx: relative.endsWith('.tsx') }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'es6' } })).code;
  const imports = [...output.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)].map(match => match[1]);
  const replacements = new Map();
  for (const specifier of new Set(imports)) {
    replacements.set(specifier, specifier.startsWith('@/') ? await moduleURL(specifier.slice(2) + '.ts') : import.meta.resolve(specifier));
  }
  output = output.replace(/((?:from\s*|import\s*)["'])([^"']+)(["'])/g, (_, before, name, after) => before + replacements.get(name) + after);
  const url = 'data:text/javascript;base64,' + Buffer.from(output).toString('base64'); modules.set(relative, url); return url;
}
const view = await import(await moduleURL('components/finder/passcodes.tsx'));
const policy = await import(await moduleURL('components/finder/passcode-view-state.ts'));
const PLACE = 'community-ABCDEFGHIJKLMNOPQRST';
const date = seconds => new Date(seconds * 1000);
function record(change = {}) {
  return { kind: 'v2', id: 'v2:ABCDEFGHIJKLMNOPQRST', reportID: 'ABCDEFGHIJKLMNOPQRST', placeID: PLACE,
    code: 'NEW-TEST-CODE', codeVersion: '1792800000:0', codeUpdatedAt: date(1792800000),
    verifiedAt: null, verifiedVersion: null, visibility: 'public', ownership: 'other',
    usedCount: 0, invalidCount: 0, currentVote: null, feedbackLoaded: true, createdAt: null, createdVersion: null, ...change };
}
function props(records = [], change = {}) {
  return { placeID: PLACE, uid: null, accountLoading: false,
    evidence: { records, publicLoading: false, ownLoading: false, feedbackLoading: false, publicError: null, ownError: null, feedbackError: null },
    newReportID: () => 'abcdefghijklmnopqrst', onSignIn() {}, onReport: async () => true, onVisibility: async () => true,
    onDelete: async () => true, onVerifyPrivate: async () => true, onFeedback: async () => true, onRetry() {}, ...change };
}
function render(records = [], change = {}) { return renderToStaticMarkup(React.createElement(view.RestroomPasscodes, props(records, change))); }
function feedbackButtons(html) { return [...html.matchAll(/<button\b([^>]*)>.*?(?:I used this code|Code didn’t work)<\/button>/g)].map(match => match[1]); }

// The actual pure draft policy is shared by the component, rather than a mocked save implementation.
test('unconfirmed report retries keep one immutable ID and original normalized payload', () => {
  let IDs = 0;
  const first = policy.prepareCodeReportAttempt(null, { code: '  0012#  ', visibility: 'private' }, () => { IDs++; return 'ABCDEFGHIJKLMNOPQRST'; });
  assert.deepEqual(first, { id: 'ABCDEFGHIJKLMNOPQRST', input: { code: '0012#', visibility: 'private' } });
  const retry = policy.prepareCodeReportAttempt(first, { code: 'different', visibility: 'public' }, () => { IDs++; return 'abcdefghijklmnopqrst'; });
  assert.equal(retry, first); assert.equal(IDs, 1);
});
test('invalid drafts do not consume a report ID and error messages do not repeat code content', () => {
  let IDs = 0;
  assert.throws(() => policy.prepareCodeReportAttempt(null, { code: 'secret-code\n', visibility: 'private' }, () => { IDs++; return 'ABCDEFGHIJKLMNOPQRST'; }), error => !error.message.includes('secret-code'));
  assert.equal(IDs, 0);
  assert.throws(() => policy.prepareCodeReportAttempt(null, { code: 'safe', visibility: 'private' }, () => 'bad-id'));
});
test('feedback requires an explicitly other-owned public record and loaded feedback', () => {
  assert.equal(policy.canGiveCodeFeedback(record(), true), true);
  for (const change of [{ ownership: 'own' }, { ownership: 'unknown' }, { visibility: 'private' }, { feedbackLoaded: false }]) assert.equal(policy.canGiveCodeFeedback(record(change), true), false);
  assert.equal(policy.canGiveCodeFeedback(record(), false), false);
});
test('unknown verification date with a positive count is distinct from no verification or an unread feed', () => {
  assert.equal(policy.codeVerificationLabel(record({ usedCount: 2 })), 'Verification date unknown');
  assert.equal(policy.codeVerificationLabel(record({ feedbackLoaded: false, usedCount: null })), 'Verification not loaded');
  assert.equal(policy.codeVerificationLabel(record()), 'Not yet verified');
  assert.equal(policy.codeVerificationLabel(record({ visibility: 'private', feedbackLoaded: false })), 'Not yet verified');
});
test('anonymous rendering includes V2 and legacy evidence but never an owned private code', () => {
  const html = render([record(), record({ id: 'legacy:abcdefghijklmnopqrst', kind: 'legacy', reportID: 'abcdefghijklmnopqrst', code: 'LEGACY-TEST', codeVersion: '1792700000:0', codeUpdatedAt: date(1792700000) }), record({ id: 'v2:11111111111111111111', reportID: '11111111111111111111', code: 'PRIVATE-SENTINEL', visibility: 'private', ownership: 'own' })]);
  assert.match(html, /NEW-TEST-CODE/); assert.match(html, /LEGACY-TEST/); assert.doesNotMatch(html, /PRIVATE-SENTINEL|Your code report|name="restroomPasscode"/);
  assert.match(html, /Sign in with Google/); assert.equal(feedbackButtons(html).length, 4);
  for (const button of feedbackButtons(html)) assert.match(button, /disabled/);
});
test('preferred verified report remains first when a newer unverified code exists', () => {
  const html = render([record(), record({ id: 'legacy:abcdefghijklmnopqrst', kind: 'legacy', reportID: 'abcdefghijklmnopqrst', code: 'OLDER-VERIFIED', codeVersion: '1792700000:0', codeUpdatedAt: date(1792700000), verifiedAt: date(1792800500), verifiedVersion: '1792800500:0' })]);
  assert.ok(html.indexOf('OLDER-VERIFIED') < html.indexOf('NEW-TEST-CODE')); assert.match(html, /Latest verified code/); assert.match(html, /Other code reports \(1\)/);
});
test('four-current-voter gate hides middle history while retaining the preferred verified code', () => {
  const html = render([record({ usedCount: 4 }), record({ id: 'legacy:abcdefghijklmnopqrst', kind: 'legacy', reportID: 'abcdefghijklmnopqrst', code: 'PREFERRED-OLD', codeVersion: '1792600000:0', codeUpdatedAt: date(1792600000), verifiedAt: date(1792800500), verifiedVersion: '1792800500:0' }), record({ id: 'v2:11111111111111111111', reportID: '11111111111111111111', code: 'MIDDLE-HISTORY', codeVersion: '1792700000:0', codeUpdatedAt: date(1792700000) })]);
  assert.match(html, /NEW-TEST-CODE/); assert.match(html, /PREFERRED-OLD/); assert.doesNotMatch(html, /MIDDLE-HISTORY/);
});
test('unresolved feedback preserves history and states failure rather than empty or never verified', () => {
  const rows = [record({ usedCount: 4 }), record({ id: 'legacy:abcdefghijklmnopqrst', kind: 'legacy', reportID: 'abcdefghijklmnopqrst', code: 'PENDING-HISTORY', codeVersion: '1792700000:0', codeUpdatedAt: date(1792700000), feedbackLoaded: false, usedCount: null, invalidCount: null })];
  const state = props(rows).evidence;
  const html = render(rows, { evidence: { ...state, feedbackError: 'Feedback could not load.' } });
  assert.match(html, /PENDING-HISTORY/); assert.match(html, /Code feedback is unavailable/); assert.match(html, /Retry loading codes/); assert.doesNotMatch(html, /No public code reported/);
  const pendingCard = html.match(/<article[^>]*>[^]*?PENDING-HISTORY[^]*?<\/article>/)?.[0];
  assert.match(pendingCard, /Verification not loaded/);
});
test('known code and verification remain visible while a different feed fails', () => {
  const rows = [record({ verifiedAt: date(1792800500), verifiedVersion: '1792800500:0' })];
  const html = render(rows, { evidence: { ...props(rows).evidence, publicError: 'Some code reports could not load.' } });
  assert.match(html, /NEW-TEST-CODE/); assert.ok(html.includes(date(1792800500).toISOString())); assert.doesNotMatch(html, /No public code reported/);
});
test('successful empty reads, loading and failed reads use different messages', () => {
  assert.match(render(), /No public code reported/);
  const loading = render([], { evidence: { ...props().evidence, publicLoading: true } });
  assert.match(loading, /Loading shared codes/); assert.doesNotMatch(loading, /No public code reported/);
  const failed = render([], { evidence: { ...props().evidence, publicError: 'Code reports unavailable.' } });
  assert.match(failed, /Code reports unavailable/); assert.doesNotMatch(failed, /No public code reported/);
});
test('known other-owned codes expose two distinct feedback controls after login', () => {
  const html = render([record()], { uid: 'test-owner' });
  assert.equal(feedbackButtons(html).length, 2);
  for (const button of feedbackButtons(html)) assert.doesNotMatch(button, /disabled/);
  assert.match(html, /Report a new code/); assert.doesNotMatch(html, /Edit code or visibility/);
});
test('owner and unresolved-owner public reports cannot contribute to their own consensus', () => {
  for (const ownership of ['own', 'unknown']) {
    const html = render([record({ ownership })], { uid: 'test-owner' });
    for (const button of feedbackButtons(html)) assert.match(button, /disabled/);
  }
});
test('owned legacy and V2 controls change visibility without offering a mutable code editor', () => {
  for (const kind of ['legacy', 'v2']) {
    const html = render([record({ kind, id: `${kind}:ABCDEFGHIJKLMNOPQRST`, ownership: 'own', createdAt: date(1792800000), createdVersion: '1792800000:0' })], { uid: 'test-owner' });
    assert.match(html, /Change visibility/); assert.match(html, /Delete my report/); assert.doesNotMatch(html, /name="restroomPasscode"|Edit code or visibility/);
  }
});
test('a confirmed-positive count with a missing date is not labeled never verified', () => {
  const html = render([record({ usedCount: 2 })]);
  assert.match(html, /Verification date unknown/); assert.doesNotMatch(html, /Not yet verified/);
});
test('rendering never performs sign-in, publication or feedback automatically', () => {
  let calls = 0; const action = () => { calls++; return Promise.resolve(true); };
  render([record()], { uid: 'test-owner', newReportID: () => { calls++; return 'ABCDEFGHIJKLMNOPQRST'; }, onSignIn: () => { calls++; }, onReport: action, onVisibility: action, onDelete: action, onFeedback: action, onVerifyPrivate: action });
  assert.equal(calls, 0);
});
