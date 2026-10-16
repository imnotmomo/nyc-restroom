import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, deleteDoc, doc, getDocFromServer, getDocsFromServer, limit, orderBy, query, serverTimestamp, setDoc, setLogLevel, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';

const PROJECT_ID='demo-restroom-community';
const ID='community-ABCDEFGHIJKLMNOPQRST';
const OTHER='community-abcdefghijklmnopqrst';
const OFFICIAL='i7jb-7jku:row-official';
let environment,alice,bob,signedOut,anonymous;
const listing=(db,id=ID)=>doc(db,'communityRestrooms',id);
const receipt=(db,id=ID)=>doc(db,'restroomSubmissions',id);
const summary=(db,id=ID)=>doc(db,'restroomRatingSummaries',id);
const input=()=>({name:'Library bathroom',address:'1 Broadway, New York, NY',latitude:40.75,longitude:-73.98,locationType:'library',entryRule:'public',stepFreeAccess:'unknown',notes:'Ask at the desk.',observedOn:Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')),submittedAt:serverTimestamp()});
const receiptData=()=>({ownerUID:'alice',submittedAt:serverTimestamp()});
const summaryData=()=>({ratingCount:0,ratingSum:0,updatedAt:serverTimestamp()});
function submit(db,{id=ID,publicData=input(),privateData=receiptData(),ratingData=summaryData(),omit=[]}={}){
 const batch=writeBatch(db);
 if(!omit.includes('listing'))batch.set(listing(db,id),publicData);
 if(!omit.includes('receipt'))batch.set(receipt(db,id),privateData);
 if(!omit.includes('summary'))batch.set(summary(db,id),ratingData);
 return batch.commit();
}

describe('public community restroom submission rules',{concurrency:false},()=>{
 before(async()=>{
  const endpoint=new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST??'127.0.0.1:8088'}`);setLogLevel('silent');
  environment=await initializeTestEnvironment({projectId:PROJECT_ID,firestore:{host:endpoint.hostname,port:Number(endpoint.port),rules:await readFile(new URL('../../firebase/firestore.rules',import.meta.url),'utf8')}});
  alice=environment.authenticatedContext('alice',{firebase:{sign_in_provider:'google.com'}}).firestore();
  bob=environment.authenticatedContext('bob',{firebase:{sign_in_provider:'google.com'}}).firestore();
  anonymous=environment.authenticatedContext('guest',{firebase:{sign_in_provider:'anonymous'}}).firestore();signedOut=environment.unauthenticatedContext().firestore();
 });
 beforeEach(async()=>{await environment.clearFirestore();});
 after(async()=>{if(environment){try{await environment.clearFirestore();}finally{await environment.cleanup();}}});

 test('a signed-in account creates a public report, private receipt and empty rating summary atomically',async()=>{
  await assertSucceeds(submit(alice));
  const report=(await assertSucceeds(getDocFromServer(listing(signedOut)))).data();
  assert.equal(report.name,'Library bathroom');assert.ok(report.submittedAt instanceof Timestamp);assert.ok(report.observedOn instanceof Timestamp);
  assert.deepEqual(Object.keys(report).sort(),Object.keys(input()).sort());assert.equal(report.ownerUID,undefined);assert.equal(report.email,undefined);
  const own=(await assertSucceeds(getDocFromServer(receipt(alice)))).data();assert.equal(own.ownerUID,'alice');assert.ok(own.submittedAt.isEqual(report.submittedAt));
  const totals=(await assertSucceeds(getDocFromServer(summary(signedOut)))).data();assert.equal(totals.ratingCount,0);assert.equal(totals.ratingSum,0);assert.ok(totals.updatedAt.isEqual(report.submittedAt));
 });
 test('public feed permits ordered bounded queries and forbids unlimited or excessive reads',async()=>{
  await submit(alice);
  assert.equal((await assertSucceeds(getDocsFromServer(query(collection(signedOut,'communityRestrooms'),orderBy('submittedAt','desc'),limit(1000))))).size,1);
  await assertFails(getDocsFromServer(collection(signedOut,'communityRestrooms')));
  await assertFails(getDocsFromServer(query(collection(signedOut,'communityRestrooms'),limit(1001))));
 });
 test('signed-out and anonymous provider accounts cannot log restrooms',async()=>{
  await assertFails(submit(signedOut));await assertFails(submit(anonymous,{privateData:{...receiptData(),ownerUID:'guest'}}));
 });
 test('owner can read a missing receipt to confirm retries; identities and raw receipt lists remain private',async()=>{
  assert.equal((await assertSucceeds(getDocFromServer(receipt(alice)))).exists(),false);
  await assertFails(getDocFromServer(receipt(signedOut)));
  await submit(alice);
  for(const db of [bob,signedOut,anonymous])await assertFails(getDocFromServer(receipt(db)));
  for(const db of [alice,bob,signedOut]){
   await assertFails(getDocsFromServer(query(collection(db,'restroomSubmissions'),limit(1000))));
   await assertFails(getDocsFromServer(collectionGroup(db,'restroomSubmissions')));
  }
 });
 for(const field of ['listing','receipt','summary'])test(`create fails when paired ${field} is missing`,async()=>{await assertFails(submit(alice,{omit:[field]}));assert.equal((await getDocFromServer(listing(signedOut))).exists(),false);});
 test('separate single writes cannot create orphan documents',async()=>{
  await assertFails(setDoc(listing(alice),input()));await assertFails(setDoc(receipt(alice),receiptData()));await assertFails(setDoc(summary(alice),summaryData()));
 });
 for(const id of [OFFICIAL,'community-too-short','community-ABCDEFGHIJKLMNOPQRS_','not-a-community-place'])test(`cannot create source or malformed ID ${id}`,async()=>{await assertFails(submit(alice,{id}));});
 test('mismatched paired IDs and another account’s owner UID are rejected',async()=>{
  await assertFails(submit(alice,{privateData:{...receiptData(),ownerUID:'bob'}}));
  const batch=writeBatch(alice);batch.set(listing(alice),input());batch.set(receipt(alice,OTHER),receiptData());batch.set(summary(alice),summaryData());await assertFails(batch.commit());
 });
 test('a repeated or edited submission cannot overwrite or delete an existing listing, receipt or summary',async()=>{
  await submit(alice);await assertFails(submit(alice));await assertFails(submit(alice,{publicData:{...input(),name:'Replacement'}}));
  for(const db of [alice,bob])for(const ref of [listing(db),receipt(db),summary(db)]){
   await assertFails(deleteDoc(ref));await assertFails(updateDoc(ref,{isAdmin:true}));
  }
  await assertFails(updateDoc(listing(alice),{name:'Different valid name'}));
  await assertFails(updateDoc(receipt(alice),{ownerUID:'bob'}));
 });
 test('new community submission cannot initialize or reset an already seeded summary',async()=>{
  await environment.withSecurityRulesDisabled(async context=>{await setDoc(summary(context.firestore()),{ratingCount:3,ratingSum:12,updatedAt:Timestamp.fromMillis(1)});await setDoc(summary(context.firestore(),OFFICIAL),{ratingCount:0,ratingSum:0,updatedAt:Timestamp.fromMillis(1)});});
  await assertFails(submit(alice));await assertFails(submit(alice,{id:OFFICIAL}));
  await environment.withSecurityRulesDisabled(async context=>assert.equal((await getDocFromServer(summary(context.firestore()))).data().ratingCount,3));
 });
 test('new locations support subsequent exact paired public ratings by any signed-in account',async()=>{
  await submit(alice);
  const batch=writeBatch(bob);batch.set(summary(bob),{ratingCount:1,ratingSum:4,updatedAt:serverTimestamp()});batch.set(doc(summary(bob),'ratings','bob'),{stars:4,updatedAt:serverTimestamp()});await assertSucceeds(batch.commit());
  const totals=(await getDocFromServer(summary(signedOut))).data();assert.equal(totals.ratingCount,1);assert.equal(totals.ratingSum,4);
  await assertFails(getDocFromServer(doc(summary(alice),'ratings','bob')));
 });
 test('community favorites and notes require a real public listing; existing source paths still work',async()=>{
  const saved=(id)=>doc(alice,'users','alice','restroomReadySaved',id);
  await assertFails(setDoc(saved(ID),{placeID:ID,savedAt:serverTimestamp()}));
  await assertSucceeds(setDoc(saved(OFFICIAL),{placeID:OFFICIAL,savedAt:serverTimestamp()}));
  await submit(alice);await assertSucceeds(setDoc(saved(ID),{placeID:ID,savedAt:serverTimestamp()}));
  await assertFails(setDoc(saved(OTHER),{placeID:OTHER,savedAt:serverTimestamp()}));
  const note=(id)=>({placeID:id,observedAt:Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')),submittedAt:serverTimestamp(),condition:'not-reported',soap:'not-reported',toiletPaper:'not-reported',stairs:'not-reported',entryNote:''});
  await assertSucceeds(setDoc(doc(alice,'users','alice','restroomReadyNotes','ABCDEFGHIJKLMNOPQRST'),note(ID)));
  await assertFails(setDoc(doc(alice,'users','alice','restroomReadyNotes','abcdefghijklmnopqrst'),note(OTHER)));
 });

 const invalidPublic=[
  ['empty name',()=>({...input(),name:''})],['whitespace name',()=>({...input(),name:'\t   '})],['long name',()=>({...input(),name:'a'.repeat(121)})],['name wrong type',()=>({...input(),name:3})],
  ['empty address',()=>({...input(),address:''})],['long address',()=>({...input(),address:'a'.repeat(241)})],['address wrong type',()=>({...input(),address:[]})],
  ['long notes',()=>({...input(),notes:'a'.repeat(1001)})],['notes wrong type',()=>({...input(),notes:7})],
  ['latitude south',()=>({...input(),latitude:40.489})],['latitude north',()=>({...input(),latitude:40.931})],['latitude nonfinite',()=>({...input(),latitude:NaN})],['latitude coercion',()=>({...input(),latitude:'40.75'})],
  ['longitude west',()=>({...input(),longitude:-74.261})],['longitude east',()=>({...input(),longitude:-73.679})],['longitude nonfinite',()=>({...input(),longitude:Infinity})],
  ['location enum',()=>({...input(),locationType:'arbitrary'})],['entry enum',()=>({...input(),entryRule:'always-open'})],['step-free enum',()=>({...input(),stepFreeAccess:true})],
  ['missing field',()=>{const data=input();delete data.notes;return data;}],['public identity',()=>({...input(),ownerUID:'alice'})],['public email',()=>({...input(),email:'a@example.test'})],['privilege',()=>({...input(),isAdmin:true})],
  ['observation type',()=>({...input(),observedOn:'2020-01-01'})],['observation ancient',()=>({...input(),observedOn:Timestamp.fromMillis(1)})],['observation future',()=>({...input(),observedOn:Timestamp.fromDate(new Date('2099-01-01T00:00:00Z'))})],['observation not midnight',()=>({...input(),observedOn:Timestamp.fromDate(new Date('2020-01-01T12:00:00Z'))})],
  ['submission past',()=>({...input(),submittedAt:Timestamp.fromMillis(1)})],['submission future',()=>({...input(),submittedAt:Timestamp.fromMillis(Date.now()+86_400_000)})],['submission type',()=>({...input(),submittedAt:'now'})],
 ];
 for(const[name,make]of invalidPublic)test(`public create rejects ${name}`,async()=>{await assertFails(submit(alice,{publicData:make()}));});
 for(const field of ['name','address','notes'])for(const character of ['\u0000','\u0008','\u000B','\u000C','\u000E','\u001F','\u007F'])test(`public ${field} rejects control U+${character.charCodeAt(0).toString(16)}`,async()=>{await assertFails(submit(alice,{publicData:{...input(),[field]:`Text${character}more`}}));});
 for(const field of Object.keys(input()))test(`public create requires ${field}`,async()=>{const data=input();delete data[field];await assertFails(submit(alice,{publicData:data}));});
 const invalidPrivate=[['missing owner',()=>({submittedAt:serverTimestamp()})],['owner too long',()=>({...receiptData(),ownerUID:'x'.repeat(129)})],['owner other account',()=>({...receiptData(),ownerUID:'bob'})],['owner wrong type',()=>({...receiptData(),ownerUID:5})],['identity pollution',()=>({...receiptData(),email:'a@example.test'})],['private privilege',()=>({...receiptData(),isAdmin:true})],['missing timestamp',()=>({ownerUID:'alice'})],['timestamp past',()=>({...receiptData(),submittedAt:Timestamp.fromMillis(1)})]];
 for(const[name,make]of invalidPrivate)test(`private receipt rejects ${name}`,async()=>{await assertFails(submit(alice,{privateData:make()}));});
 for(const[name,make]of [['nonzero count',()=>({...summaryData(),ratingCount:1,ratingSum:4})],['extra field',()=>({...summaryData(),email:'a@example.test'})],['past time',()=>({...summaryData(),updatedAt:Timestamp.fromMillis(1)})],['missing sum',()=>({ratingCount:0,updatedAt:serverTimestamp()})]])test(`initial summary rejects ${name}`,async()=>{await assertFails(submit(alice,{ratingData:make()}));});
 for(const whitespace of ['\u00a0','\u1680','\u2000','\u2028','\u2029','\u202f','\u205f','\u3000','\ufeff'])test(`whitespace-only public name rejected U+${whitespace.charCodeAt(0).toString(16)}`,async()=>{await assertFails(submit(alice,{publicData:{...input(),name:whitespace}}));});
 test('Unicode UTF-16 text boundaries match the public decoder',async()=>{await assertSucceeds(submit(alice,{publicData:{...input(),name:'🧻'.repeat(60)}}));await assertFails(submit(alice,{id:OTHER,publicData:{...input(),name:'🧻'.repeat(61)}}));});
 test('multiline notes remain valid without allowing forbidden control characters',async()=>{await assertSucceeds(submit(alice,{publicData:{...input(),notes:'First line.\nSecond line.\tTab.'}}));});
 test('unknown observation date and all explicit unknown enums are accepted without inventing facts',async()=>{
  await assertSucceeds(submit(alice,{publicData:{...input(),observedOn:null,entryRule:'unknown',stepFreeAccess:'unknown',notes:''}}));assert.equal((await getDocFromServer(listing(signedOut))).data().observedOn,null);
 });
 test('a valid submission cannot smuggle a profile, admin role or nested identity document',async()=>{
  for(const path of ['users/alice','roles/alice',`communityRestrooms/${ID}/identity/alice`]){
   const batch=writeBatch(alice);batch.set(listing(alice),input());batch.set(receipt(alice),receiptData());batch.set(summary(alice),summaryData());batch.set(doc(alice,path),{isAdmin:true,email:'a@example.test'});await assertFails(batch.commit());
  }
 });
});
