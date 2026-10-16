import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';
const source=await readFile(new URL('../lib/community-restroom-model.ts',import.meta.url),'utf8');
const model=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const now=new Date('2026-10-15T12:00:00Z');
const valid=()=>({name:'Neighborhood library',address:'1 Broadway, New York, NY',latitude:40.75,longitude:-73.98,locationType:'library',entryRule:'public',stepFreeAccess:'unknown',notes:'Ask at the desk.',observedOn:'2026-10-14'});

test('community identity is a separate stable, strictly bounded namespace',()=>{
 assert.equal(model.isCommunityRestroomID('community-ABCDEFGHIJKLMNOPQRST'),true);
 for(const value of ['community-a','community-ABCDEFGHIJKLMNOPQRS_','community-ABCDEFGHIJKLMNOPQRST/extra','i7jb-7jku:row-one',null,{}])assert.equal(model.isCommunityRestroomID(value),false);
});
test('community input normalizes whitespace while preserving reported unknowns and dates',()=>{
 const input=valid(); input.name='  Neighborhood\n library  ';input.address='  1   Broadway, New York, NY  ';input.notes='  Ask at the desk.\nNo code reported.  ';
 const normalized=model.normalizeCommunityRestroomInput(input,now);
 assert.equal(normalized.name,'Neighborhood library');assert.equal(normalized.address,'1 Broadway, New York, NY');assert.equal(normalized.notes,'Ask at the desk.\nNo code reported.');
 assert.equal(normalized.stepFreeAccess,'unknown');assert.equal(normalized.observedOn,'2026-10-14');
 assert.equal(model.normalizeCommunityRestroomInput({...valid(),observedOn:null},now).observedOn,null);
});
test('observation dates are logical UTC dates, bounded separately from submission time',()=>{
 for(const date of [null,'2000-01-01','2024-02-29','2026-10-15'])assert.equal(model.isValidCommunityObservationDate(date,now),true);
 for(const date of ['1999-12-31','2026-10-16','2026-02-29','2026-04-31','2026-1-1','2026-10-15T00:00:00Z','',1,{}])assert.equal(model.isValidCommunityObservationDate(date,now),false);
 assert.equal(model.communityObservationDateLimit(new Date('2026-10-16T01:00:00Z')),'2026-10-15');
 assert.equal(model.isValidCommunityObservationDate('2026-10-16',new Date('2026-10-16T01:00:00Z')),false);
});
test('numeric coordinates must be finite and inside the approximate NYC rectangle',()=>{
 for(const [key,value] of [['latitude',NaN],['latitude',Infinity],['latitude','40.75'],['latitude',40.489],['latitude',40.931],['longitude',-74.261],['longitude',-73.679],['longitude',null]])assert.throws(()=>model.normalizeCommunityRestroomInput({...valid(),[key]:value},now));
 for(const [latitude,longitude]of [[40.49,-74.26],[40.93,-73.68]])assert.doesNotThrow(()=>model.normalizeCommunityRestroomInput({...valid(),latitude,longitude},now));
});
test('unknown facts stay explicit and enums cannot be coerced or polluted',()=>{
 for(const [key,value] of [['locationType','hospital'],['entryRule','always-open'],['entryRule',['public']],['stepFreeAccess','accessible'],['stepFreeAccess',true]])assert.throws(()=>model.normalizeCommunityRestroomInput({...valid(),[key]:value},now));
 assert.throws(()=>model.normalizeCommunityRestroomInput({...valid(),isAdmin:true},now));
 const missing=valid();delete missing.address;assert.throws(()=>model.normalizeCommunityRestroomInput(missing,now));
});
test('every submitted text field is bounded and identity/HTML is never treated as markup',()=>{
 for(const[key,value]of [['name',' '],['address','\t'],['name','x'.repeat(121)],['address','x'.repeat(241)],['notes','x'.repeat(1001)],['notes','bad\u0000text'],['name',5]])assert.throws(()=>model.normalizeCommunityRestroomInput({...valid(),[key]:value},now));
 const normalized=model.normalizeCommunityRestroomInput({...valid(),name:'<script>alert(1)</script>'},now);assert.equal(normalized.name,'<script>alert(1)</script>');
});
test('idempotent content comparison recognizes changes including dates, unknowns and coordinates',()=>{
 const input=valid();assert.equal(model.sameCommunityRestroomInput(input,{...input}),true);
 for(const[key,value]of [['name','Different'],['latitude',40.76],['entryRule','unknown'],['stepFreeAccess','yes'],['observedOn',null]])assert.equal(model.sameCommunityRestroomInput(input,{...input,[key]:value}),false);
});

test('stored observation dates use the authoritative submission date across NY/UTC midnight and device clocks',()=>{
 const submitted=new Date('2026-10-16T02:00:00Z');
 const sameUTCDate={...valid(),observedOn:'2026-10-16'};
 assert.throws(()=>model.normalizeCommunityRestroomInput(sameUTCDate,submitted));
 assert.equal(model.normalizeRecordedCommunityRestroomInput(sameUTCDate,submitted).observedOn,'2026-10-16');
 assert.throws(()=>model.normalizeRecordedCommunityRestroomInput({...valid(),observedOn:'2026-10-17'},submitted));
 assert.throws(()=>model.normalizeRecordedCommunityRestroomInput({...valid(),observedOn:'2026-02-30'},submitted));
});
test('Unicode UTF-16 length bounds match Firestore while Unicode whitespace alone is empty',()=>{
 assert.equal(model.normalizeCommunityRestroomInput({...valid(),name:'🧻'.repeat(60)},now).name.length,120);
 assert.throws(()=>model.normalizeCommunityRestroomInput({...valid(),name:'🧻'.repeat(61)},now));
 for(const whitespace of ['\u00a0','\u1680','\u2000','\u2028','\u2029','\u202f','\u205f','\u3000','\ufeff'])assert.throws(()=>model.normalizeCommunityRestroomInput({...valid(),name:whitespace},now));
});
