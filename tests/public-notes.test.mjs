import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const source = await readFile(new URL('../lib/public-note-model.ts', import.meta.url), 'utf8');
const model = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const now = new Date('2026-10-23T14:00:00Z');
const input = () => ({ observedAt: new Date('2026-10-22T13:00:00Z'), body: '', condition: 'not-reported', soap: 'yes', toiletPaper: 'not-reported', stairs: 'not-reported' });

test('public note keeps actual observation time and explicit unknowns without an author field', () => {
  const original = input();
  const normalized = model.normalizePublicNoteInput(original, now);
  assert.deepEqual(normalized, original);
  assert.notEqual(normalized.observedAt, original.observedAt);
  original.observedAt.setFullYear(1990);
  assert.equal(normalized.observedAt.toISOString(), '2026-10-22T13:00:00.000Z');
  assert.equal(normalized.stairs, 'not-reported');
  assert.deepEqual(Object.keys(normalized).sort(), ['observedAt','body','condition','soap','toiletPaper','stairs'].sort());
});

test('public note and place namespaces reject paths, malformed community IDs and unbounded identifiers', () => {
  assert.equal(model.isPublicNoteID('ABCDEFGHIJKLMNOPQRST'), true);
  for (const bad of ['', null, 123, 'a'.repeat(19), 'a'.repeat(21), 'a'.repeat(19)+'/', 'a'.repeat(19)+'\n']) assert.equal(model.isPublicNoteID(bad), false);
  for (const good of ['i7jb-7jku:row-example~123','community-ABCDEFGHIJKLMNOPQRST','x'.repeat(128)]) assert.equal(model.isPublicNotePlaceID(good), true);
  for (const bad of ['', null, 'a'.repeat(129), '../users/alice', 'place\n', 'space place', 'community-bad', '?uid=alice']) assert.equal(model.isPublicNotePlaceID(bad), false);
});

test('input rejects extra identity, profile, private/code fields and all missing keys', () => {
  for (const [key, value] of Object.entries({uid:'alice',ownerUID:'alice',email:'private@example.org',displayName:'Alice',visibility:'private',code:'3434',placeID:'arbitrary',schemaVersion:1,submittedAt:now,isAdmin:true})) {
    assert.throws(() => model.normalizePublicNoteInput({...input(),[key]:value}, now));
  }
  for (const key of Object.keys(input())) { const missing=input();delete missing[key];assert.throws(() => model.normalizePublicNoteInput(missing,now)); }
  for (const bad of [null,[],{},true,'note']) assert.throws(() => model.normalizePublicNoteInput(bad,now));
});

test('body is trimmed and limited by UTF-16 length without rewriting meaningful text', () => {
  assert.equal(model.normalizePublicNoteInput({...input(),body:' \nMy visit\nwas fine.\t'},now).body,'My visit\nwas fine.');
  assert.doesNotThrow(() => model.normalizePublicNoteInput({...input(),body:'🙂'.repeat(500)},now));
  for (const body of ['x'.repeat(1001),'🙂'.repeat(501),null,123,[],true]) assert.throws(() => model.normalizePublicNoteInput({...input(),body},now));
  const publicText='<script>alert("example")</script>';
  assert.equal(model.normalizePublicNoteInput({...input(),body:publicText},now).body, publicText); // React renders this as text.
});

test('note requires a meaningful body or a known observed field without turning unknown into No', () => {
  const unknown={...input(),soap:'not-reported'};
  for (const body of ['', ' \n\t ', '\u00a0', '\u0085', '\u0085\u2007\u2028']) assert.throws(() => model.normalizePublicNoteInput({...unknown,body},now),/note or report/);
  for (const change of [{body:'The entrance is on the right.'},{condition:'usable'},{soap:'no'},{toiletPaper:'no'},{stairs:'no'}]) assert.doesNotThrow(() => model.normalizePublicNoteInput({...unknown,...change},now));
  assert.equal(model.normalizePublicNoteInput({...unknown,body:'Dated visit.'},now).stairs,'not-reported');
});

test('body rejects forbidden C0 and DEL controls while preserving permitted whitespace', () => {
  for (const code of [...Array.from({length:9},(_,i)=>i),11,12,...Array.from({length:18},(_,i)=>i+14),127]) {
    assert.throws(() => model.normalizePublicNoteInput({...input(),body:`Before${String.fromCharCode(code)}after`},now),/control/);
  }
  assert.equal(model.normalizePublicNoteInput({...input(),body:'One\ttwo\nthree\rfour'},now).body,'One\ttwo\nthree\rfour');
});

test('actual visit date is finite and bounded independently of a later submission', () => {
  for (const observedAt of [null,'2026-10-22',Date.now(),new Date('invalid'),new Date('1999-12-31T23:59:59.999Z'),new Date(now.getTime()+1)]) assert.throws(() => model.normalizePublicNoteInput({...input(),observedAt},now));
  for (const observedAt of [new Date('2000-01-01T00:00:00Z'),now]) assert.doesNotThrow(() => model.normalizePublicNoteInput({...input(),observedAt},now));
  assert.throws(() => model.normalizePublicNoteInput(input(),new Date('invalid')));
});

test('structured fields reject coercion and do not infer accessibility or floor from no stairs', () => {
  for (const key of ['soap','toiletPaper','stairs']) for (const bad of [true,false,null,undefined,'unknown',0,['yes'],'yes'.repeat(1000)]) assert.throws(() => model.normalizePublicNoteInput({...input(),[key]:bad},now));
  for (const condition of ['clean',3.5,true,null,'accessible']) assert.throws(() => model.normalizePublicNoteInput({...input(),condition},now));
  const normalized=model.normalizePublicNoteInput({...input(),stairs:'no'},now);
  assert.equal(normalized.stairs,'no');
  for (const key of ['accessible','elevator','floor','entryRule','code']) assert.equal(Object.hasOwn(normalized,key),false);
});

test('stable retry equality compares every published input field and actual visit time', () => {
  const original=input();
  assert.equal(model.samePublicNoteInput(original,{...original,observedAt:new Date(original.observedAt)}),true);
  for (const change of [{body:'changed'},{condition:'usable'},{soap:'no'},{toiletPaper:'yes'},{stairs:'no'},{observedAt:new Date(original.observedAt.getTime()+1)}]) assert.equal(model.samePublicNoteInput(original,{...original,...change}),false);
});
