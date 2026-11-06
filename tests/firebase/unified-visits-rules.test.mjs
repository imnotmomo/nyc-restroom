import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before,beforeEach,after,test } from 'node:test';
import { initializeTestEnvironment,assertSucceeds,assertFails } from '@firebase/rules-unit-testing';
import { collection,collectionGroup,deleteDoc,doc,getDocFromServer,getDocsFromServer,limit,orderBy,query,serverTimestamp,setDoc,setLogLevel,Timestamp,updateDoc,writeBatch } from 'firebase/firestore';
const PROJECT='demo-restroom-unified-visits',PLACE='i7jb-7jku:unified-test',OTHER='i7jb-7jku:unified-other';
const ID='U'.repeat(20),SECOND='S'.repeat(20),CODE='C'.repeat(20),NAME='Example Visitor';
const OLD=Timestamp.fromDate(new Date('2026-01-01T12:00:00Z'));
let env,alice,bob,reader,guest,noName;
const report=(db,id=ID,p=PLACE)=>doc(db,'restroomUnifiedVisits',p,'reports',id);
const receipt=(db,uid='alice',id=ID)=>doc(db,'users',uid,'restroomReadyUnifiedVisitReceipts',id);
const ownCode=(db,uid='alice',id=CODE)=>doc(db,'users',uid,'restroomReadyPasscodesV2',id);
const codeOwner=(db,id=CODE)=>doc(db,'restroomPasscodeV2Owners',id);
const publicCode=(db,p=PLACE,id=CODE)=>doc(db,'restroomPasscodeReportsV2',p,'reports',id);
const saved=(db,uid='alice',p=PLACE)=>doc(db,'users',uid,'restroomReadySaved',p);
const fields=()=>({schemaVersion:1,placeID:PLACE,observedAt:OLD,submittedAt:serverTimestamp(),entryRule:'not-reported',purchaseRequired:'not-reported',codeRequired:'not-reported',stairs:'not-reported',soap:'not-reported',toiletPaper:'not-reported',floor:'not-reported',condition:'not-reported',comment:'A synthetic dated visit.',anonymous:true,authorName:null});
function create(db,{id=ID,p=PLACE,uid='alice',data={},proof={},code=null,omit=[]}={}){
 const batch=writeBatch(db),body={...fields(),placeID:p,...data};
 if(!omit.includes('report'))batch.set(report(db,id,p),body);
 if(!omit.includes('receipt'))batch.set(receipt(db,uid,id),{placeID:p,submittedAt:serverTimestamp(),codeReportID:code?CODE:null,...proof});
 if(code){const cp=code.placeID??p,visibility=code.visibility??'private';
  if(!omit.includes('ownCode'))batch.set(ownCode(db,uid),{placeID:cp,code:'0012#',visibility,createdAt:serverTimestamp(),codeUpdatedAt:serverTimestamp(),lastVerifiedAt:null,...code.own});
  if(!omit.includes('codeOwner'))batch.set(codeOwner(db),{ownerUID:uid,placeID:cp,createdAt:serverTimestamp()});
  if(visibility==='public'&&!omit.includes('codePublic'))batch.set(publicCode(db,cp),{placeID:cp,code:'0012#',codeUpdatedAt:serverTimestamp()});
  if(visibility==='private'&&!omit.includes('saved'))batch.set(saved(db,uid,cp),{placeID:cp,savedAt:serverTimestamp()});
 }
 return batch.commit();
}
function remove(db,{id=ID,p=PLACE,uid='alice',omit=[]}={}){const b=writeBatch(db);if(!omit.includes('report'))b.delete(report(db,id,p));if(!omit.includes('receipt'))b.delete(receipt(db,uid,id));return b.commit();}
before(async()=>{setLogLevel('silent');const u=new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST??'127.0.0.1:8185'}`);assert.ok(['127.0.0.1','localhost'].includes(u.hostname));env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:u.hostname,port:Number(u.port),rules:await readFile(new URL('../../firebase/firestore.rules',import.meta.url),'utf8')}});alice=env.authenticatedContext('alice',{name:NAME,email:'private@example.test',firebase:{sign_in_provider:'google.com'}}).firestore();bob=env.authenticatedContext('bob',{name:'Another Visitor',firebase:{sign_in_provider:'apple.com'}}).firestore();noName=env.authenticatedContext('no-name',{email:'private@example.test',firebase:{sign_in_provider:'apple.com'}}).firestore();guest=env.authenticatedContext('guest',{name:NAME,firebase:{sign_in_provider:'anonymous'}}).firestore();reader=env.unauthenticatedContext().firestore();});
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{const b=writeBatch(c.firestore());for(const p of [PLACE,OTHER])b.set(doc(c.firestore(),'restroomRatingSummaries',p),{ratingCount:0,ratingSum:0,updatedAt:OLD});await b.commit();});});
after(async()=>{if(env){try{await env.clearFirestore();}finally{await env.cleanup();}}});

test('anonymous immutable public15/private3 pair has no public account/code linkage',async()=>{await assertSucceeds(create(alice));const body=(await getDocFromServer(report(reader))).data(),own=(await getDocFromServer(receipt(alice))).data();assert.deepEqual(Object.keys(body).sort(),Object.keys(fields()).sort());assert.deepEqual(Object.keys(own).sort(),['codeReportID','placeID','submittedAt']);assert.equal(body.anonymous,true);assert.equal(body.authorName,null);assert.equal(own.codeReportID,null);assert.ok(body.submittedAt.isEqual(own.submittedAt));});
test('named public report uses exact signed-in token name; explicit anonymous mode never copies it',async()=>{await assertSucceeds(create(alice,{data:{anonymous:false,authorName:NAME}}));assert.equal((await getDocFromServer(report(reader))).data().authorName,NAME);await assertSucceeds(create(bob,{id:SECOND,uid:'bob',data:{anonymous:false,authorName:'Another Visitor'}}));});
for(const [label,data]of Object.entries({anonymousWithName:{anonymous:true,authorName:NAME},namedNull:{anonymous:false,authorName:null},forgedName:{anonymous:false,authorName:'Different Visitor'},wrongType:{anonymous:'true'},blankName:{anonymous:false,authorName:' '},controlName:{anonymous:false,authorName:'Example\nVisitor'},longName:{anonymous:false,authorName:'x'.repeat(121)}}))test(`author guard denies ${label}`,()=>assertFails(create(alice,{data})));
test('a missing name claim cannot fall back to account email or UID',async()=>{await assertFails(create(noName,{uid:'no-name',data:{anonymous:false,authorName:'private@example.test'}}));await assertFails(create(noName,{uid:'no-name',data:{anonymous:false,authorName:'no-name'}}));await assertSucceeds(create(noName,{uid:'no-name'}));});
test('comment-only or structured-only meaningful reports work; all unknown and blank text do not',async()=>{await assertSucceeds(create(alice));await assertSucceeds(create(alice,{id:SECOND,data:{comment:'',stairs:'no'}}));});
for(const comment of ['', ' \n', '\u0085', '\u2003', 'x'.repeat(1001), 'before\u0000after', 'before\u007fafter'])test(`comment rejects ${JSON.stringify(comment).slice(0,35)}`,()=>assertFails(create(alice,{data:{comment}})));
test('ordinary multiline comment and 1000-character boundary pass',async()=>{await assertSucceeds(create(alice,{data:{comment:'one\ttwo\nthree\rfour'}}));await assertSucceeds(create(alice,{id:SECOND,data:{comment:'x'.repeat(1000)}}));});
for(const change of [{observedAt:Timestamp.fromDate(new Date('1999-12-31'))},{observedAt:Timestamp.fromMillis(Date.now()+86400000)},{observedAt:OLD.toDate().toISOString()},{submittedAt:OLD},{schemaVersion:true},{schemaVersion:2},{stairs:'unknown'},{entryRule:'free'},{condition:'clean'}])test(`strict dates/enums/schema rejects ${Object.keys(change)[0]} ${String(Object.values(change)[0]).slice(0,20)}`,()=>assertFails(create(alice,{data:change})));
for(const key of ['uid','ownerUID','email','code','codeReportID','codeVisibility','authorPhoto'])test(`public schema rejects extra ${key}`,()=>assertFails(create(alice,{data:{[key]:'synthetic-not-public'}})));
test('separate/mismatched/other-account receipt and replay adoption are denied',async()=>{await assertFails(create(alice,{omit:['report']}));await assertFails(create(alice,{omit:['receipt']}));await assertFails(create(alice,{uid:'bob'}));await assertFails(create(alice,{proof:{placeID:OTHER}}));await create(alice);await assertFails(create(bob,{uid:'bob'}));await assertFails(create(alice));});
test('full private optional-code six-document batch fits rule budget and keeps code out of public visit',async()=>{await assertSucceeds(create(alice,{data:{codeRequired:'yes'},code:{visibility:'private'}}));const body=(await getDocFromServer(report(reader))).data(),own=(await getDocFromServer(receipt(alice))).data();assert.equal(Object.hasOwn(body,'code'),false);assert.equal(Object.hasOwn(body,'codeReportID'),false);assert.equal(own.codeReportID,CODE);assert.equal((await getDocFromServer(publicCode(reader))).exists(),false);assert.equal((await getDocFromServer(saved(alice))).exists(),true);assert.ok((await getDocFromServer(ownCode(alice))).data().createdAt.isEqual(body.submittedAt));await assertFails(getDocFromServer(ownCode(bob)));});
test('named public optional-code five-document batch is one timestamp/version and never verified by creation',async()=>{await assertSucceeds(create(alice,{data:{codeRequired:'yes',anonymous:false,authorName:NAME},code:{visibility:'public'}}));const body=(await getDocFromServer(report(reader))).data(),code=(await getDocFromServer(publicCode(reader))).data();assert.ok(code.codeUpdatedAt.isEqual(body.submittedAt));assert.deepEqual(Object.keys(code).sort(),['code','codeUpdatedAt','placeID']);assert.equal((await getDocFromServer(ownCode(alice))).data().lastVerifiedAt,null);});
for(const part of ['ownCode','codeOwner','saved'])test(`private code requires atomic ${part}`,()=>assertFails(create(alice,{data:{codeRequired:'yes'},code:{visibility:'private'},omit:[part]})));
test('public code needs its projection and both visibility alternatives reject incomplete pairs',()=>assertFails(create(alice,{data:{codeRequired:'yes'},code:{visibility:'public'},omit:['codePublic']})));
test('optional code requires Yes and same-place code ownership',async()=>{await assertFails(create(alice,{data:{codeRequired:'no'},code:{}}));await assertFails(create(alice,{data:{codeRequired:'yes'},code:{placeID:OTHER}}));await assertFails(create(alice,{proof:{codeReportID:'not-an-id'}}));});
test('an old independent code cannot be adopted as if created by this visit',async()=>{await env.withSecurityRulesDisabled(async c=>{const b=writeBatch(c.firestore());b.set(ownCode(c.firestore()),{placeID:PLACE,code:'old',visibility:'public',createdAt:OLD,codeUpdatedAt:OLD,lastVerifiedAt:null});b.set(codeOwner(c.firestore()),{ownerUID:'alice',placeID:PLACE,createdAt:OLD});b.set(publicCode(c.firestore()),{placeID:PLACE,code:'old',codeUpdatedAt:OLD});await b.commit();});await assertFails(create(alice,{data:{codeRequired:'yes'},proof:{codeReportID:CODE}}));});
test('owner-only paired deletion keeps the independently owned code and Saved',async()=>{await create(alice,{data:{codeRequired:'yes'},code:{visibility:'private'}});await assertFails(deleteDoc(report(alice)));await assertFails(deleteDoc(receipt(alice)));await assertFails(remove(bob,{uid:'bob'}));await assertSucceeds(remove(alice));assert.equal((await getDocFromServer(ownCode(alice))).exists(),true);assert.equal((await getDocFromServer(saved(alice))).exists(),true);});
test('independently deleted code does not prevent owner deleting the visit report',async()=>{await create(alice,{data:{codeRequired:'yes'},code:{visibility:'private'}});const b=writeBatch(alice);b.delete(ownCode(alice));b.delete(codeOwner(alice));await assertSucceeds(b.commit());await assertSucceeds(remove(alice));});
test('reports and receipts are immutable, including anonymous choice and public name',async()=>{await create(alice);for(const data of [{comment:'changed'},{anonymous:false,authorName:NAME},{submittedAt:serverTimestamp()}])await assertFails(updateDoc(report(alice),data));await assertFails(updateDoc(receipt(alice),{codeReportID:CODE}));});
test('anonymous bounded public feed and private bounded owner history preserve account isolation',async()=>{
 await create(alice);
 assert.equal((await assertSucceeds(getDocsFromServer(query(collection(reader,'restroomUnifiedVisits',PLACE,'reports'),orderBy('observedAt','desc'),limit(10))))).size,1);
 await assertFails(getDocsFromServer(collection(reader,'restroomUnifiedVisits',PLACE,'reports')));
 await assertFails(getDocsFromServer(query(collection(reader,'restroomUnifiedVisits',PLACE,'reports'),limit(11))));
 assert.equal((await assertSucceeds(getDocsFromServer(query(collection(alice,'users','alice','restroomReadyUnifiedVisitReceipts'),orderBy('submittedAt','desc'),limit(50))))).size,1);
 await assertFails(getDocsFromServer(collection(alice,'users','alice','restroomReadyUnifiedVisitReceipts')));
 await assertFails(getDocsFromServer(query(collection(alice,'users','alice','restroomReadyUnifiedVisitReceipts'),limit(51))));
 for(const db of [reader,bob,guest]) {await assertFails(getDocFromServer(receipt(db)));await assertFails(getDocsFromServer(query(collection(db,'users','alice','restroomReadyUnifiedVisitReceipts'),limit(10))));}
 await assertFails(getDocsFromServer(query(collectionGroup(alice,'restroomReadyUnifiedVisitReceipts'),limit(10))));
});
test('optional elevator and automatic door observations preserve old records and support amenity-only notes',async()=>{
 await assertSucceeds(create(alice,{data:{comment:'',elevatorPresent:'yes'}}));
 await assertSucceeds(create(alice,{id:SECOND,data:{comment:'',automaticDoorPresent:'no'}}));
 const elevator=(await getDocFromServer(report(reader))).data(),door=(await getDocFromServer(report(reader,SECOND))).data();
 assert.equal(elevator.elevatorPresent,'yes');assert.equal(Object.hasOwn(elevator,'automaticDoorPresent'),false);
 assert.equal(door.automaticDoorPresent,'no');assert.equal(door.stairs,'not-reported');
 await assertSucceeds(remove(alice));await assertSucceeds(remove(alice,{id:SECOND}));
});
for(const key of ['elevatorPresent','automaticDoorPresent'])for(const value of [null,true,1,'unknown','Yes',''])test(`amenity observation rejects ${key} ${String(value)}`,()=>assertFails(create(alice,{data:{[key]:value}})));
test('all unknown amenities do not make an empty note valid and do not relax schema',async()=>{
 await assertFails(create(alice,{data:{comment:'',elevatorPresent:'not-reported',automaticDoorPresent:'not-reported'}}));
 await assertFails(create(alice,{data:{elevatorPresent:'yes',accessible:true}}));
 await create(alice,{data:{elevatorPresent:'yes'}});await assertFails(updateDoc(report(alice),{elevatorPresent:'no'}));
});
test('signed-out/anonymous sessions and deletion-locked accounts cannot submit, own-read, or delete',async()=>{await assertFails(create(reader));await assertFails(create(guest,{uid:'guest'}));await create(alice);await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'accountDeletionLocks','alice'),{phase:'pending',policyVersion:4}));await assertFails(getDocFromServer(receipt(alice)));await assertFails(remove(alice));await assertFails(create(alice,{id:SECOND}));assert.equal((await getDocFromServer(report(reader))).exists(),true);});
