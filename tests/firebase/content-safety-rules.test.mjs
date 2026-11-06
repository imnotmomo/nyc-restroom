import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch, serverTimestamp, Timestamp, getDocFromServer, setLogLevel } from 'firebase/firestore';
const PLACE='i7jb-7jku:content-safety', ID='N'.repeat(20), OLD=Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
let env,alice,reader;
const ref=(db,path)=>doc(db,path);
function legacy(db,body='Accessible assistance is available.') {const b=writeBatch(db);b.set(ref(db,`restroomPublicNotes/${PLACE}/notes/${ID}`),{schemaVersion:1,placeID:PLACE,observedAt:OLD,submittedAt:serverTimestamp(),body,condition:'not-reported',soap:'not-reported',toiletPaper:'not-reported',stairs:'not-reported'});b.set(ref(db,`users/alice/restroomReadyPublicNoteReceipts/${ID}`),{placeID:PLACE,submittedAt:serverTimestamp()});return b.commit();}
function unified(db,comment='A class next door.',extra={}) {const b=writeBatch(db);b.set(ref(db,`restroomUnifiedVisits/${PLACE}/reports/${ID}`),{schemaVersion:1,placeID:PLACE,observedAt:OLD,submittedAt:serverTimestamp(),comment,anonymous:true,authorName:null,entryRule:'not-reported',purchaseRequired:'not-reported',codeRequired:'not-reported',floor:'not-reported',condition:'not-reported',soap:'not-reported',toiletPaper:'not-reported',stairs:'not-reported',...extra});b.set(ref(db,`users/alice/restroomReadyUnifiedVisitReceipts/${ID}`),{placeID:PLACE,submittedAt:serverTimestamp(),codeReportID:null});return b.commit();}
async function suspend(){await env.withSecurityRulesDisabled(c=>setDoc(ref(c.firestore(),'restroomContributorSuspensions/alice'),{reason:'harassment'}));}
before(async()=>{setLogLevel('silent');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8185');env=await initializeTestEnvironment({projectId:'demo-content-safety-rules',firestore:{host:'127.0.0.1',port:8185,rules:await readFile(new URL('../../firebase/firestore.rules',import.meta.url),'utf8')}});alice=env.authenticatedContext('alice',{firebase:{sign_in_provider:'google.com'}}).firestore();reader=env.unauthenticatedContext().firestore();});
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(c=>setDoc(ref(c.firestore(),`restroomRatingSummaries/${PLACE}`),{ratingCount:0,ratingSum:0,updatedAt:OLD}));});
after(async()=>{if(env){await env.clearFirestore();await env.cleanup();}});
for(const [name,create] of [['legacy',legacy],['unified',unified]]){
 test(`${name} benign text is accepted including word-boundary false-positive fixtures`,async()=>{await assertSucceeds(create(alice,'Cockroaches; accessible assistance; a class next door.'));});
 for(const body of ['FUCK you','Please go die.','kill yourself','spam child porn link'])test(`${name} abusive text is rejected by direct SDK atomic write`,async()=>{await assertFails(create(alice,body));assert.equal((await getDocFromServer(ref(reader,`restroomRatingSummaries/${PLACE}`))).get('ratingCount'),0);});
 test(`${name} suspended user cannot publish but can remove owned content and use private Saved`,async()=>{
  await assertSucceeds(create(alice));await suspend();const note=name==='legacy'?`restroomPublicNotes/${PLACE}/notes/${ID}`:`restroomUnifiedVisits/${PLACE}/reports/${ID}`, receipt=name==='legacy'?`users/alice/restroomReadyPublicNoteReceipts/${ID}`:`users/alice/restroomReadyUnifiedVisitReceipts/${ID}`;
  await assertSucceeds(getDocFromServer(ref(reader,note)));const b=writeBatch(alice);b.delete(ref(alice,note));b.delete(ref(alice,receipt));await assertSucceeds(b.commit());await assertFails(create(alice));await assertSucceeds(setDoc(ref(alice,`users/alice/restroomReadySaved/${PLACE}`),{placeID:PLACE,savedAt:serverTimestamp()}));
 });
}
test('suspended users cannot add/change ratings while own rating cleanup still updates exact totals',async()=>{
 const rate=(stars,count,sum)=>{const b=writeBatch(alice);b.set(ref(alice,`restroomRatingSummaries/${PLACE}/ratings/alice`),{stars,updatedAt:serverTimestamp()});b.set(ref(alice,`restroomRatingSummaries/${PLACE}`),{ratingCount:count,ratingSum:sum,updatedAt:serverTimestamp()});return b.commit();};
 await assertSucceeds(rate(4.5,1,4.5));await suspend();await assertFails(rate(5,1,5));const b=writeBatch(alice);b.delete(ref(alice,`restroomRatingSummaries/${PLACE}/ratings/alice`));b.set(ref(alice,`restroomRatingSummaries/${PLACE}`),{ratingCount:0,ratingSum:0,updatedAt:serverTimestamp()});await assertSucceeds(b.commit());await assertFails(rate(4,1,4));
});
test('all safety state is server-only even for self and claimed administrators',async()=>{
 for(const ctx of [env.unauthenticatedContext(),env.authenticatedContext('alice',{admin:true})])for(const path of ['restroomContentReports/00000000-0000-4000-8000-000000000001','restroomContentReportLimits/alice','restroomContributorSuspensions/alice']){await assertFails(getDocFromServer(ref(ctx.firestore(),path)));await assertFails(setDoc(ref(ctx.firestore(),path),{reason:'spam'}));}
});

test('public display names pass the same filter even on structured-only notes; Anonymous remains available',async()=>{
 const bad=env.authenticatedContext('alice',{name:'FUCK YOU',firebase:{sign_in_provider:'google.com'}}).firestore();
 await assertFails(unified(bad,'',{anonymous:false,authorName:'FUCK YOU',soap:'yes'}));
 await assertSucceeds(unified(bad,'',{anonymous:true,authorName:null,soap:'yes'}));
});
test('ordinary public profile names remain supported with their exact fresh claim',async()=>{
 const named=env.authenticatedContext('alice',{name:'Cassandra Jones',firebase:{sign_in_provider:'apple.com'}}).firestore();await assertSucceeds(unified(named,'',{anonymous:false,authorName:'Cassandra Jones',soap:'yes'}));
});
