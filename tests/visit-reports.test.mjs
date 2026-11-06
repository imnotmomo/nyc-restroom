import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const source = await readFile(new URL('../lib/visit-report-model.ts', import.meta.url), 'utf8');
const model = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const now = new Date('2026-10-21T14:00:00Z');
const input = () => ({observedAt:new Date('2026-10-20T13:00:00Z'),entryRule:'not-reported',purchaseRequired:'not-reported',codeRequired:'not-reported',stairs:'not-reported',soap:'yes',toiletPaper:'not-reported',floor:'not-reported',condition:'not-reported'});

test('public observation preserves explicit unknowns and copies its observation date', () => {
  const original = input();
  const result = model.normalizeVisitReportInput(original,now);
  assert.deepEqual(result,original);
  original.observedAt.setFullYear(1990);
  assert.equal(result.observedAt.toISOString(),'2026-10-20T13:00:00.000Z');
  assert.equal(result.stairs,'not-reported');
  assert.equal(result.codeRequired,'not-reported');
});

test('report and place IDs have distinct bounded namespaces with no paths or query values', () => {
  assert.equal(model.isVisitReportID('ABCDEFGHIJKLMNOPQRST'),true);
  for (const bad of ['',null,123,'a'.repeat(19),'a'.repeat(21),'x'.repeat(19)+'/', 'x'.repeat(19)+'\n']) assert.equal(model.isVisitReportID(bad),false);
  for (const good of ['i7jb-7jku:row-example~123','community-ABCDEFGHIJKLMNOPQRST','x'.repeat(128)]) assert.equal(model.isVisitReportPlaceID(good),true);
  for (const bad of ['',null,'a'.repeat(129),'../users/alice','place\n','space place','community-bad','?uid=alice']) assert.equal(model.isVisitReportPlaceID(bad),false);
});

test('public schemas reject every extra identity, code, coordinate or free-text field and missing fields', () => {
  for (const [key,value] of Object.entries({uid:'alice',ownerUID:'alice',email:'private@example.org',name:'Alice',notes:'private',code:'1234',latitude:40.7,longitude:-74,isAdmin:true,placeID:'arbitrary'})) {
    assert.throws(()=>model.normalizeVisitReportInput({...input(),[key]:value},now));
  }
  for (const key of Object.keys(input())) { const missing=input();delete missing[key];assert.throws(()=>model.normalizeVisitReportInput(missing,now)); }
  for (const bad of [null,[],{},true,'report']) assert.throws(()=>model.normalizeVisitReportInput(bad,now));
});

test('actual observation time is required and bounded independently from the later submission', () => {
  for (const bad of [null,'2026-10-20T13:00:00Z',Date.now(),new Date('invalid'),new Date('1999-12-31T23:59:59.999Z'),new Date('2026-10-21T14:00:00.001Z')]) assert.throws(()=>model.normalizeVisitReportInput({...input(),observedAt:bad},now));
  for (const good of [new Date('2000-01-01T00:00:00Z'),now]) assert.doesNotThrow(()=>model.normalizeVisitReportInput({...input(),observedAt:good},now));
});

test('at least one known observation is required without turning unknowns into negative reports', () => {
  const unknown={...input(),soap:'not-reported'};
  assert.throws(()=>model.normalizeVisitReportInput(unknown,now),/at least one detail/);
  for(const change of [{entryRule:'public'},{entryRule:'customers'},{purchaseRequired:'yes'},{codeRequired:'no'},{stairs:'no'},{soap:'yes'},{toiletPaper:'no'},{floor:'entrance'},{condition:'needs-attention'}]) {
    assert.doesNotThrow(()=>model.normalizeVisitReportInput({...unknown,...change},now));
  }
});

test('enum fields reject coercion, excessive text and nonspecific accessibility claims', () => {
  for (const key of ['purchaseRequired','codeRequired','stairs','soap','toiletPaper']) {
    for(const bad of [true,false,null,undefined,'unknown',0,['yes'],'yes'.repeat(10000)]) assert.throws(()=>model.normalizeVisitReportInput({...input(),[key]:bad},now));
  }
  for(const change of [{entryRule:'everyone'},{floor:'accessible'},{condition:'five-stars'},{condition:3.5}]) assert.throws(()=>model.normalizeVisitReportInput({...input(),...change},now));
  const separate=model.normalizeVisitReportInput({...input(),entryRule:'customers',purchaseRequired:'not-reported',codeRequired:'no',floor:'above',stairs:'no'},now);
  assert.equal(separate.purchaseRequired,'not-reported');
  assert.equal(separate.floor,'above');
  assert.equal(separate.stairs,'no');
});

test('stable retry equality distinguishes every field and observation time', () => {
  const original=input();assert.equal(model.sameVisitReportInput(original,{...original,observedAt:new Date(original.observedAt)}),true);
  for(const change of [{observedAt:new Date('2026-10-20T13:00:01Z')},{entryRule:'public'},{purchaseRequired:'no'},{codeRequired:'yes'},{stairs:'no'},{soap:'no'},{toiletPaper:'yes'},{floor:'above'},{condition:'usable'}]) {
    assert.equal(model.sameVisitReportInput(original,{...original,...change}),false);
  }
});

const unified = (change = {}) => ({ schemaVersion:1,placeID:'community-ABCDEFGHIJKLMNOPQRST',
  observedAt:new Date('2026-10-20T13:00:00Z'),submittedAt:new Date('2026-10-21T13:00:00Z'),
  entryRule:'not-reported',purchaseRequired:'not-reported',codeRequired:'not-reported',stairs:'not-reported',soap:'not-reported',toiletPaper:'not-reported',floor:'not-reported',condition:'not-reported',
  comment:'A dated observation.',anonymous:true,authorName:null,...change });
const readUnified = value => model.normalizeUnifiedVisitReport('ABCDEFGHIJKLMNOPQRST','community-ABCDEFGHIJKLMNOPQRST',value,now);

test('unified read schema accepts comment-only observations without relaxing legacy writes',()=>{
  const result=readUnified(unified());assert.equal(result.comment,'A dated observation.');assert.equal(result.authorName,null);assert.equal(result.soap,'not-reported');
  assert.throws(()=>model.normalizeVisitReportInput({...input(),soap:'not-reported'},now));
  assert.throws(()=>model.normalizeVisitReportInput({...input(),comment:'Not a legacy field'},now));
  assert.equal(Object.keys(result).length,16); // Public15 plus the separate document ID.
});
test('strict unified payload rejects every missing or extra public key and boolean version coercion',()=>{
  for(const key of Object.keys(unified())){const value=unified();delete value[key];assert.throws(()=>readUnified(value));}
  for(const extra of [{uid:'must-not-render'},{email:'must-not-render'},{code:'must-not-render'},{codeReportID:'ABCDEFGHIJKLMNOPQRST'},{latitude:40.7},{isAnonymous:true}])assert.throws(()=>readUnified(unified(extra)));
  for(const schemaVersion of [true,false,'1',0,2,NaN,null])assert.throws(()=>readUnified(unified({schemaVersion})));
});
test('anonymous and named display modes require their exact stored name pairing',()=>{
  const named=readUnified(unified({anonymous:false,authorName:'A Visitor'}));assert.equal(named.authorName,'A Visitor');
  for(const change of [{anonymous:true,authorName:'A Visitor'},{anonymous:false,authorName:null},{anonymous:false,authorName:''},{anonymous:false,authorName:'   '},{anonymous:false,authorName:'Name\nOther'},{anonymous:'true',authorName:null}])assert.throws(()=>readUnified(unified(change)));
  assert.equal(readUnified(unified({anonymous:false,authorName:' Name '})).authorName,' Name ');
  assert.doesNotThrow(()=>readUnified(unified({anonymous:false,authorName:'x'.repeat(120)})));
  assert.throws(()=>readUnified(unified({anonymous:false,authorName:'x'.repeat(121)})));
  assert.doesNotThrow(()=>readUnified(unified({anonymous:false,authorName:'😀'.repeat(60)})));
  assert.throws(()=>readUnified(unified({anonymous:false,authorName:'😀'.repeat(61)})));
});
test('unified comment validation preserves plain text within the conservative UTF16 limit',()=>{
  const comment='<script>alert("text")</script>\nhttps://example.org/';assert.equal(readUnified(unified({comment})).comment,comment);
  assert.doesNotThrow(()=>readUnified(unified({comment:'😀'.repeat(500)})));
  for(const comment of ['x'.repeat(1001),'😀'.repeat(501),' untrimmed','end ','bad\u0000text','bad\u000btext','bad\u007ftext'])assert.throws(()=>readUnified(unified({comment})));
  assert.doesNotThrow(()=>readUnified(unified({comment:'',soap:'no'})));
  for(const comment of ['', '\u0085'])assert.throws(()=>readUnified(unified({comment})));
});
test('unified read requires actual finite observation and posting dates in the right order',()=>{
  for(const change of [{observedAt:new Date('invalid')},{submittedAt:new Date('invalid')},{observedAt:new Date('1999-12-31')},{observedAt:new Date('2026-10-21T13:00:00.001Z')},{submittedAt:new Date('2026-10-21T14:00:00.001Z')},{observedAt:'2026-10-20'},{submittedAt:NaN}])assert.throws(()=>readUnified(unified(change)));
  assert.throws(()=>model.normalizeUnifiedVisitReport('ABCDEFGHIJKLMNOPQRST','community-ABCDEFGHIJKLMNOPQRST',unified(),new Date('invalid')));
  const value=unified();const result=readUnified(value);value.observedAt.setFullYear(1990);assert.equal(result.observedAt.getUTCFullYear(),2026);
});
test('unified read keeps unknown or negative facts without inferring accessibility or entry',()=>{
  const result=readUnified(unified({comment:'',stairs:'no',floor:'above'}));assert.equal(result.stairs,'no');assert.equal(result.entryRule,'not-reported');assert.equal(result.floor,'above');
  for(const change of [{entryRule:'accessible'},{soap:true},{condition:5},{floor:0}])assert.throws(()=>readUnified(unified(change)));
  assert.throws(()=>model.normalizeUnifiedVisitReport('short','community-ABCDEFGHIJKLMNOPQRST',unified(),now));
  assert.throws(()=>model.normalizeUnifiedVisitReport('ABCDEFGHIJKLMNOPQRST','another-place',unified(),now));
});
test('unified optional amenity observations are backwards-compatible, typed and meaningful on their own',()=>{
  const old=readUnified(unified());assert.equal(Object.hasOwn(old,'elevatorPresent'),false);assert.equal(Object.hasOwn(old,'automaticDoorPresent'),false);
  for(const key of ['elevatorPresent','automaticDoorPresent']) {
    for(const value of ['yes','no']) {
      const note=readUnified(unified({comment:'',[key]:value}));assert.equal(note[key],value);assert.equal(note.stairs,'not-reported');
    }
    for(const value of [null,undefined,1,true,'unknown','Yes',''])assert.throws(()=>readUnified(unified({[key]:value})));
    assert.throws(()=>readUnified(unified({comment:'',[key]:'not-reported'})));
  }
  const both=readUnified(unified({elevatorPresent:'no',automaticDoorPresent:'yes'}));assert.equal(both.elevatorPresent,'no');assert.equal(both.automaticDoorPresent,'yes');
  assert.throws(()=>readUnified(unified({elevatorPresent:'yes',accessible:true})));
});
test('merged sources namespace equal raw IDs and preserve independent observations and public names',()=>{
  const legacy={...input(),id:'ABCDEFGHIJKLMNOPQRST',placeID:'community-ABCDEFGHIJKLMNOPQRST',submittedAt:new Date('2026-10-21T13:00:00Z')};
  const rows=model.mergeVisitReportEvidence(legacy.placeID,[legacy],[readUnified(unified({anonymous:false,authorName:'A Visitor'}))]);
  assert.equal(rows.length,2);assert.deepEqual(new Set(rows.map(row=>row.key)),new Set(['legacy:ABCDEFGHIJKLMNOPQRST','unified:ABCDEFGHIJKLMNOPQRST']));
  assert.equal(rows.find(row=>row.source==='legacy').comment,'');assert.equal(rows.find(row=>row.source==='legacy').authorName,null);
  assert.equal(rows.find(row=>row.source==='unified').authorName,'A Visitor');
});
test('merge remains bounded to ten per source and exact place IDs, without changing inputs',()=>{
  const first=readUnified(unified());const records=Array.from({length:12},(_,index)=>({...first,id:String(index).padStart(20,'R'),observedAt:new Date(Date.UTC(2026,0,1+index))}));
  const legacy=records.map(({schemaVersion,comment,anonymous,authorName,...report})=>report);
  const before=records.map(row=>row.id);const rows=model.mergeVisitReportEvidence(first.placeID,[...legacy,{...legacy[0],placeID:'another-place'}],records);
  assert.equal(rows.length,20);assert.equal(rows.filter(row=>row.source==='legacy').length,10);assert.equal(rows.filter(row=>row.source==='unified').length,10);
  assert.equal(rows[0].report.observedAt.toISOString(),'2026-01-12T00:00:00.000Z');assert.deepEqual(records.map(row=>row.id),before);
});
