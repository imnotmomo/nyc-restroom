import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, describe, test } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, deleteDoc, doc, getDocFromServer, getDocsFromServer, limit, orderBy, query, serverTimestamp, setDoc, setLogLevel, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';

const PLACE='i7jb-7jku:public-note-test', OTHER='i7jb-7jku:public-note-other', COMMUNITY='community-ABCDEFGHIJKLMNOPQRST';
const ID='PublicNoteExample001', SECOND='PublicNoteExample002';
const observed=Timestamp.fromDate(new Date('2026-01-01T12:00:00Z'));
let env,alice,bob,apple,reader,anonymous;
const note=(db,id=ID,place=PLACE)=>doc(db,'restroomPublicNotes',place,'notes',id);
const receipt=(db,uid='alice',id=ID)=>doc(db,'users',uid,'restroomReadyPublicNoteReceipts',id);
const fields=()=>({schemaVersion:1,placeID:PLACE,observedAt:observed,submittedAt:serverTimestamp(),body:'A synthetic public note.',condition:'not-reported',soap:'not-reported',toiletPaper:'not-reported',stairs:'not-reported'});
const receiptFields=()=>({placeID:PLACE,submittedAt:serverTimestamp()});
function create(db,{id=ID,place=PLACE,uid='alice',publicData={...fields(),placeID:place},privateData={...receiptFields(),placeID:place},omit=[]}={}) {
  const batch=writeBatch(db);
  if(!omit.includes('public'))batch.set(note(db,id,place),publicData);
  if(!omit.includes('receipt'))batch.set(receipt(db,uid,id),privateData);
  return batch.commit();
}
function remove(db,{id=ID,place=PLACE,uid='alice',omit=[]}={}) {
  const batch=writeBatch(db);
  if(!omit.includes('public'))batch.delete(note(db,id,place));
  if(!omit.includes('receipt'))batch.delete(receipt(db,uid,id));
  return batch.commit();
}

describe('public note rules',{concurrency:false},()=>{
  before(async()=>{
    setLogLevel('silent');
    const endpoint=new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST??'127.0.0.1:8185'}`);
    env=await initializeTestEnvironment({projectId:'demo-restroom-public-notes',firestore:{host:endpoint.hostname,port:Number(endpoint.port),rules:await readFile(new URL('../../firebase/firestore.rules',import.meta.url),'utf8')}});
    alice=env.authenticatedContext('alice',{firebase:{sign_in_provider:'google.com'}}).firestore();
    bob=env.authenticatedContext('bob',{firebase:{sign_in_provider:'google.com'}}).firestore();
    apple=env.authenticatedContext('apple',{firebase:{sign_in_provider:'apple.com'}}).firestore();
    anonymous=env.authenticatedContext('guest',{firebase:{sign_in_provider:'anonymous'}}).firestore();
    reader=env.unauthenticatedContext().firestore();
  });
  beforeEach(async()=>{
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context=>{
      const db=context.firestore(),batch=writeBatch(db);
      for(const id of [PLACE,OTHER,COMMUNITY])batch.set(doc(db,'restroomRatingSummaries',id),{ratingCount:0,ratingSum:0,updatedAt:observed});
      batch.set(doc(db,'communityRestrooms',COMMUNITY),{name:'Synthetic fixture only'});
      await batch.commit();
    });
  });
  after(async()=>{if(env){try{await env.clearFirestore();}finally{await env.cleanup();}}});
  test('Google owner creates exact public note and private ownership pair atomically',async()=>{
    await assertSucceeds(create(alice));
    const value=(await assertSucceeds(getDocFromServer(note(reader)))).data();
    assert.deepEqual(Object.keys(value).sort(),Object.keys(fields()).sort());
    assert.equal(value.body,'A synthetic public note.');assert.ok(value.observedAt.isEqual(observed));
    const own=(await assertSucceeds(getDocFromServer(receipt(alice)))).data();
    assert.deepEqual(Object.keys(own).sort(),['placeID','submittedAt']);assert.ok(own.submittedAt.isEqual(value.submittedAt));
  });
  test('Apple owner and existing community place are supported',async()=>{await assertSucceeds(create(apple,{uid:'apple',place:COMMUNITY}));});
  test('public ordered latest-ten read works while unbounded, excessive, parent and group queries fail',async()=>{
    await create(alice);
    const feed=query(collection(reader,'restroomPublicNotes',PLACE,'notes'),orderBy('submittedAt','desc'),limit(10));
    assert.equal((await assertSucceeds(getDocsFromServer(feed))).size,1);
    await assertFails(getDocsFromServer(collection(reader,'restroomPublicNotes',PLACE,'notes')));
    await assertFails(getDocsFromServer(query(collection(reader,'restroomPublicNotes',PLACE,'notes'),limit(11))));
    await assertFails(getDocsFromServer(collection(reader,'restroomPublicNotes')));
    await assertFails(getDocsFromServer(query(collectionGroup(reader,'notes'),limit(10))));
  });
  test('ownership receipts permit only bounded owner history; other-account and collection-group reads stay denied',async()=>{
    assert.equal((await assertSucceeds(getDocFromServer(receipt(alice)))).exists(),false);
    await create(alice);
    for(const db of [reader,bob,anonymous])await assertFails(getDocFromServer(receipt(db)));
    assert.equal((await assertSucceeds(getDocsFromServer(query(collection(alice,'users','alice','restroomReadyPublicNoteReceipts'),orderBy('submittedAt','desc'),limit(50))))).size,1);
    await assertFails(getDocsFromServer(collection(alice,'users','alice','restroomReadyPublicNoteReceipts')));
    await assertFails(getDocsFromServer(query(collection(alice,'users','alice','restroomReadyPublicNoteReceipts'),limit(51))));
    for(const db of [reader,bob,anonymous]){
      await assertFails(getDocsFromServer(query(collection(db,'users','alice','restroomReadyPublicNoteReceipts'),limit(10))));
      await assertFails(getDocsFromServer(query(collectionGroup(db,'restroomReadyPublicNoteReceipts'),limit(10))));
    }
    await assertFails(getDocsFromServer(query(collectionGroup(alice,'restroomReadyPublicNoteReceipts'),limit(10))));
  });
  test('signed-out and anonymous users cannot create public notes',async()=>{await assertFails(create(reader));await assertFails(create(anonymous,{uid:'guest'}));});
  test('separate public or private creation is denied',async()=>{await assertFails(create(alice,{omit:['receipt']}));await assertFails(create(alice,{omit:['public']}));});
  test('receipt owner, note ID and place must match',async()=>{
    await assertFails(create(alice,{uid:'bob'}));
    await assertFails(create(alice,{privateData:{...receiptFields(),placeID:OTHER}}));
    await assertFails(create(alice,{publicData:{...fields(),placeID:OTHER}}));
    const batch=writeBatch(alice);batch.set(note(alice),fields());batch.set(receipt(alice,'alice',SECOND),receiptFields());await assertFails(batch.commit());
  });
  test('existing note cannot be adopted, overwritten, or replay-created',async()=>{
    await create(alice);
    const existing=(await getDocFromServer(note(reader))).data();
    await assertFails(setDoc(receipt(bob,'bob'),{placeID:PLACE,submittedAt:existing.submittedAt}));
    await assertFails(create(bob,{uid:'bob'}));await assertFails(create(alice));
    const attack=writeBatch(bob);attack.set(receipt(bob,'bob'),{placeID:PLACE,submittedAt:existing.submittedAt});attack.delete(note(bob));await assertFails(attack.commit());
    assert.equal((await getDocFromServer(note(reader))).exists(),true);
  });
  test('owner removes both documents; single, other-owner and signed-out deletions fail',async()=>{
    await create(alice);
    await assertFails(deleteDoc(note(alice)));await assertFails(deleteDoc(receipt(alice)));
    await assertFails(remove(bob,{uid:'bob'}));await assertFails(remove(reader));await assertFails(remove(anonymous,{uid:'guest'}));
    await assertSucceeds(remove(alice));
    assert.equal((await getDocFromServer(note(reader))).exists(),false);assert.equal((await getDocFromServer(receipt(alice))).exists(),false);
  });
  test('updates are denied even for owners and valid-looking payloads',async()=>{
    await create(alice);
    for(const data of [{body:'Changed'},{schemaVersion:2},{ownerUID:'alice'},{placeID:OTHER},{submittedAt:serverTimestamp()}])await assertFails(updateDoc(note(alice),data));
    await assertFails(setDoc(note(alice),fields()));await assertFails(updateDoc(receipt(alice),{placeID:OTHER}));
  });
  test('deletion lock blocks new notes, ownership reads and deletion while public reads stay public',async()=>{
    await create(alice);
    await env.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),'accountDeletionLocks','alice'),{phase:'pending',policyVersion:3}));
    await assertFails(create(alice,{id:SECOND}));await assertFails(remove(alice));await assertFails(getDocFromServer(receipt(alice)));
    assert.equal((await assertSucceeds(getDocFromServer(note(reader)))).exists(),true);
  });
  test('body length is bounded and ordinary multiline Unicode text is allowed',async()=>{
    await assertSucceeds(create(alice,{publicData:{...fields(),body:'x'.repeat(1000)}}));
    await assertFails(create(alice,{id:SECOND,publicData:{...fields(),body:'x'.repeat(1001)}}));
    await assertSucceeds(create(bob,{uid:'bob',id:SECOND,publicData:{...fields(),body:'Entry was straightforward.\n电梯在右侧。'}}));
  });
  for(const body of ['', '   ', '\t\n\r', '\u00a0'])test(`blank all-unknown body rejected (${JSON.stringify(body)})`,async()=>{await assertFails(create(alice,{publicData:{...fields(),body}}));});
  test('each structured answer allows a textless public note',async()=>{
    let i=0;for(const change of [{condition:'usable'},{condition:'needs-attention'},{soap:'no'},{toiletPaper:'yes'},{stairs:'no'}])await assertSucceeds(create(alice,{id:String(++i).padStart(20,'N'),publicData:{...fields(),body:'',...change}}));
  });
  for(const body of ['x\u0000y','x\u0001y','x\u000by','x\u007fy'])test(`unsupported control character rejected (${JSON.stringify(body)})`,async()=>{await assertFails(create(alice,{publicData:{...fields(),body}}));});
  test('actual visit bounds and server timestamps are enforced',async()=>{
    for(const observedAt of [Timestamp.fromDate(new Date('1999-12-31T23:59:59Z')),Timestamp.fromMillis(Date.now()+86400000),null,'today',123])await assertFails(create(alice,{publicData:{...fields(),observedAt}}));
    for(const submittedAt of [observed,null,123,'today']){
      await assertFails(create(alice,{publicData:{...fields(),submittedAt}}));await assertFails(create(alice,{privateData:{...receiptFields(),submittedAt}}));
    }
    await assertSucceeds(create(alice,{publicData:{...fields(),observedAt:Timestamp.fromDate(new Date('2000-01-01T00:00:00Z'))}}));
  });
  test('unknown places and fabricated same-batch summaries cannot receive notes',async()=>{
    for(const place of ['missing-place','community-abcdefghijklmnopqrst'])await assertFails(create(alice,{place}));
    const batch=writeBatch(alice),place='manufactured-place';batch.set(doc(alice,'restroomRatingSummaries',place),{ratingCount:0,ratingSum:0,updatedAt:serverTimestamp()});batch.set(note(alice,ID,place),{...fields(),placeID:place});batch.set(receipt(alice),{...receiptFields(),placeID:place});await assertFails(batch.commit());
  });
  for(const key of Object.keys(fields()))test(`missing ${key} is rejected`,async()=>{const data=fields();delete data[key];await assertFails(create(alice,{publicData:data}));});
  for(const [key,value] of Object.entries({uid:'alice',ownerUID:'alice',author:'Anonymous',email:'private@example.test',code:'1234',latitude:40.7,extra:true}))test(`public extra ${key} rejected`,async()=>{await assertFails(create(alice,{publicData:{...fields(),[key]:value}}));});
  for(const [key,value] of [['schemaVersion',true],['schemaVersion',2],['schemaVersion','1'],['body',null],['condition','clean'],['soap',true],['toiletPaper',[]],['stairs','unknown']])test(`invalid ${key} type or value ${JSON.stringify(value)}`,async()=>{await assertFails(create(alice,{publicData:{...fields(),[key]:value}}));});
  for(const extra of [{uid:'alice'},{ownerUID:'alice'},{body:'Private'},{schemaVersion:1}])test(`receipt extra ${Object.keys(extra)[0]} rejected`,async()=>{await assertFails(create(alice,{privateData:{...receiptFields(),...extra}}));});
  for(const id of ['bad','a'.repeat(21),'a'.repeat(19)+'_'])test(`invalid note ID ${id}`,async()=>{await assertFails(create(alice,{id}));});
  test('mismatched ownership timestamps cannot remove another public note',async()=>{
    await create(alice);
    await env.withSecurityRulesDisabled(context=>setDoc(receipt(context.firestore(),'bob'),{placeID:PLACE,submittedAt:observed}));
    await assertFails(remove(bob,{uid:'bob'}));assert.equal((await getDocFromServer(note(reader))).exists(),true);
  });
  test('same owner cannot reuse a receipt ID for another place; another owner at another place is independent',async()=>{
    await create(alice);await assertFails(create(alice,{place:OTHER}));await assertSucceeds(create(bob,{uid:'bob',place:OTHER}));
  });
  test('new public-note text cannot be injected into strict legacy visit reports',async()=>{
    const batch=writeBatch(alice);batch.set(doc(alice,'restroomVisitReports',PLACE,'reports',ID),fields());batch.set(doc(alice,'users','alice','restroomReadyVisitReceipts',ID),receiptFields());await assertFails(batch.commit());
  });
});
