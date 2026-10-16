import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const source = await readFile(new URL('../lib/passcode-model.ts', import.meta.url), 'utf8');
const model = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const record = () => ({ placeID: 'community-ABCDEFGHIJKLMNOPQRST', reportID: 'abcdefghijklmnopqrst', code: '1234#', visibility: 'private', createdAt: new Date('2026-10-16T12:00:00Z'), codeUpdatedAt: new Date('2026-10-16T12:00:00Z'), lastVerifiedAt: null, codeVersion: '1792152000:123456000' });

test('codes preserve keypad symbols and leading zeroes while trimming surrounding spaces', () => {
  assert.deepEqual(model.normalizePasscodeInput({ code: '  0012#  ', visibility: 'private' }), { code: '0012#', visibility: 'private' });
  assert.equal(model.normalizePasscodeInput({ code: 'Ab 12-*#', visibility: 'public' }).code, 'Ab 12-*#');
  assert.equal(model.MAX_PASSCODE_LENGTH, 40);
  assert.equal(model.normalizePasscodeInput({ code: 'x'.repeat(40), visibility: 'private' }).code.length, 40);
});

test('saving requires an explicit privacy choice and rejects extra identity or verification fields', () => {
  for (const input of [null, [], '1234', {}, {code:'1234'}, {code:'1234', visibility:'everyone'}, {code:'1234', visibility:true}, {code:'1234', visibility:'public', ownerUID:'alice'}, {code:'1234', visibility:'private', lastVerifiedAt:new Date()}]) {
    assert.throws(() => model.normalizePasscodeInput(input));
  }
});

test('empty, overlong, non-ASCII and control-containing codes cannot be stored', () => {
  for (const code of ['', '   ', 'x'.repeat(41), '密碼', '１２３４', '1234\n', '12\t34', '12\u000034', '\u007f']) {
    assert.throws(() => model.normalizePasscodeInput({ code, visibility:'private' }));
  }
});

test('validation errors never repeat submitted code content', () => {
  const sentinel='private-code-sentinel';
  assert.throws(() => model.normalizePasscodeInput({code:sentinel,visibility:'invalid'}), error => !error.message.includes(sentinel));
  assert.throws(() => model.normalizePasscodeInput({code:sentinel+'\n',visibility:'private'}), error => !error.message.includes(sentinel));
});

test('report identifiers are opaque exact-length alphanumeric values', () => {
  assert.equal(model.isPasscodeReportID('ABCDEFGHIJKLMNOPQRST'), true);
  for (const value of ['short', 'ABCDEFGHIJKLMNOPQRS_', 'ABCDEFGHIJKLMNOPQRST/child', 'ABCDEFGHIJKLMNOPQRST\n', 1, null]) assert.equal(model.isPasscodeReportID(value), false);
  assert.equal(model.PUBLIC_PASSCODE_LIMIT, 10);
});

test('timestamp versions preserve differences that a Date would round away', () => {
  const a={seconds:1792152000,nanoseconds:123456000}, b={...a,nanoseconds:123457000};
  assert.notEqual(model.passcodeTimestampVersion(a),model.passcodeTimestampVersion(b));
  assert.equal(new Date(a.seconds*1000+a.nanoseconds/1e6).getTime(),new Date(b.seconds*1000+b.nanoseconds/1e6).getTime());
  for (const value of [{seconds:1,nanoseconds:0},{seconds:NaN,nanoseconds:0},{seconds:1792152000.1,nanoseconds:0},{seconds:1792152000,nanoseconds:-1},{seconds:1792152000,nanoseconds:1e9},{seconds:1792152000,nanoseconds:0.5}]) assert.throws(()=>model.passcodeTimestampVersion(value));
});

test('stale owner edits and deletes detect changed content, privacy, report identity or place', () => {
  const current=record();
  assert.equal(model.samePasscodeRevision(current,{...current}),true);
  assert.equal(model.samePasscodeRevision(null,null),true);
  assert.equal(model.samePasscodeRevision(current,null),false);
  assert.equal(model.samePasscodeRevision(null,current),false);
  for (const change of [{codeVersion:'1792152000:123457000'},{visibility:'public'},{reportID:'ABCDEFGHIJKLMNOPQRST'},{placeID:'another-place'}]) assert.equal(model.samePasscodeRevision(current,{...current,...change}),false);
  assert.equal(model.samePasscodeRevision(current,{...current,lastVerifiedAt:new Date()}),true);
});

test('new or edited code clears verification; visibility changes retain only its existing verification source', () => {
  const current=record();
  assert.equal(model.passcodeVerificationSourceForEdit(null,{code:'1234#',visibility:'private'}),null);
  assert.equal(model.passcodeVerificationSourceForEdit(current,{code:'5678#',visibility:'private'}),null);
  assert.equal(model.passcodeVerificationSourceForEdit(current,{code:'5678#',visibility:'public'}),null);
  assert.equal(model.passcodeVerificationSourceForEdit(current,{code:'1234#',visibility:'public'}),'private');
  assert.equal(model.passcodeVerificationSourceForEdit({...current,visibility:'public'},{code:'1234#',visibility:'private'}),'public');
  assert.equal(model.passcodeVerificationSourceForEdit({...current,visibility:'public'},{code:'1234#',visibility:'public'}),'public');
});
