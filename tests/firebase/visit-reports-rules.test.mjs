import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, describe, test } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, deleteDoc, doc, getDocFromServer, getDocsFromServer, limit, orderBy, query, serverTimestamp, setDoc, setLogLevel, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';

const PLACE='i7jb-7jku:row-visit-test',OTHER_PLACE='i7jb-7jku:row-other-test',COMMUNITY='community-ABCDEFGHIJKLMNOPQRST';
const ID='VisitObservation0001',OTHER_ID='VisitObservation0002';
const observed=Timestamp.fromDate(new Date('2026-01-01T12:00:00Z'));
let env,alice,bob,reader,anonymous;
const report=(db,id=ID,place=PLACE)=>doc(db,'restroomVisitReports',place,'reports',id);
const receipt=(db,uid='alice',id=ID)=>doc(db,'users',uid,'restroomReadyVisitReceipts',id);
const fields=()=>({placeID:PLACE,observedAt:observed,submittedAt:serverTimestamp(),entryRule:'not-reported',purchaseRequired:'not-reported',codeRequired:'not-reported',stairs:'not-reported',soap:'yes',toiletPaper:'not-reported',floor:'not-reported',condition:'not-reported'});
const receiptFields=()=>({placeID:PLACE,submittedAt:serverTimestamp()});
function create(db,{id=ID,place=PLACE,uid='alice',publicData={...fields(),placeID:place},privateData={...receiptFields(),placeID:place},omit=[]}={}) {
  const batch=writeBatch(db);
  if(!omit.includes('public'))batch.set(report(db,id,place),publicData);
  if(!omit.includes('receipt'))batch.set(receipt(db,uid,id),privateData);
  return batch.commit();
}
function remove(db,{id=ID,place=PLACE,uid='alice',omit=[]}={}) {
  const batch=writeBatch(db);
  if(!omit.includes('public'))batch.delete(report(db,id,place));
  if(!omit.includes('receipt'))batch.delete(receipt(db,uid,id));
  return batch.commit();
}

describe('public visit observation rules',{concurrency:false},()=>{
  before(async()=>{
    setLogLevel('silent');
    const endpoint=new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST??'127.0.0.1:8185'}`);
    env=await initializeTestEnvironment({projectId:'demo-restroom-visit-rules',firestore:{host:endpoint.hostname,port:Number(endpoint.port),rules:await readFile(new URL('../../firebase/firestore.rules',import.meta.url),'utf8')}});
    alice=env.authenticatedContext('alice',{firebase:{sign_in_provider:'google.com'}}).firestore();
    bob=env.authenticatedContext('bob',{firebase:{sign_in_provider:'google.com'}}).firestore();
    anonymous=env.authenticatedContext('guest',{firebase:{sign_in_provider:'anonymous'}}).firestore();reader=env.unauthenticatedContext().firestore();
  });
  beforeEach(async()=>{
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context=>{
      const db=context.firestore(),batch=writeBatch(db);
      for(const id of [PLACE,OTHER_PLACE,COMMUNITY]) batch.set(doc(db,'restroomRatingSummaries',id),{ratingCount:0,ratingSum:0,updatedAt:observed});
      batch.set(doc(db,'communityRestrooms',COMMUNITY),{name:'Emulator-only place'});
      await batch.commit();
    });
  });
  after(async()=>{if(env){try{await env.clearFirestore();}finally{await env.cleanup();}}});

  test('signed-in visitor atomically creates public facts and private ownership receipt',async()=>{
    await assertSucceeds(create(alice));
    const value=(await assertSucceeds(getDocFromServer(report(reader)))).data();
    assert.equal(Object.keys(value).length,11);assert.equal(value.soap,'yes');assert.equal(value.entryRule,'not-reported');
    assert.ok(value.observedAt.isEqual(observed));assert.ok(value.submittedAt instanceof Timestamp);
    const own=(await getDocFromServer(receipt(alice))).data();assert.deepEqual(Object.keys(own).sort(),['placeID','submittedAt']);assert.ok(own.submittedAt.isEqual(value.submittedAt));
  });
  test('existing genuine community places can receive observations',async()=>{await assertSucceeds(create(alice,{place:COMMUNITY}));});
  test('public ordered latest-ten queries work, unbounded/excessive and group queries fail',async()=>{
    await create(alice);
    assert.equal((await assertSucceeds(getDocsFromServer(query(collection(reader,'restroomVisitReports',PLACE,'reports'),orderBy('observedAt','desc'),limit(10))))).size,1);
    await assertFails(getDocsFromServer(collection(reader,'restroomVisitReports',PLACE,'reports')));
    await assertFails(getDocsFromServer(query(collection(reader,'restroomVisitReports',PLACE,'reports'),limit(11))));
    await assertFails(getDocsFromServer(query(collectionGroup(reader,'reports'),limit(10))));
    await assertFails(getDocsFromServer(collection(reader,'restroomVisitReports')));
  });
  test('missing own receipt GET is readable but other users and all receipt lists are private',async()=>{
    assert.equal((await assertSucceeds(getDocFromServer(receipt(alice)))).exists(),false);
    await create(alice);
    for(const db of [reader,bob,anonymous]) await assertFails(getDocFromServer(receipt(db)));
    for(const db of [reader,alice,bob]) {
      await assertFails(getDocsFromServer(query(collection(db,'users','alice','restroomReadyVisitReceipts'),limit(10))));
      await assertFails(getDocsFromServer(query(collectionGroup(db,'restroomReadyVisitReceipts'),limit(10))));
    }
  });
  test('signed-out and anonymous users cannot create observations',async()=>{
    await assertFails(create(reader));await assertFails(create(anonymous,{uid:'guest'}));
  });
  test('public and receipt documents cannot be created separately',async()=>{
    await assertFails(create(alice,{omit:['receipt']}));await assertFails(create(alice,{omit:['public']}));
    assert.equal((await getDocFromServer(report(reader))).exists(),false);
  });
  test('cannot write another owner receipt, mismatched places, or mismatched public IDs',async()=>{
    await assertFails(create(alice,{uid:'bob'}));
    await assertFails(create(alice,{privateData:{...receiptFields(),placeID:OTHER_PLACE}}));
    await assertFails(create(alice,{publicData:{...fields(),placeID:OTHER_PLACE}}));
    const batch=writeBatch(alice);batch.set(report(alice),fields());batch.set(receipt(alice,'alice',OTHER_ID),receiptFields());await assertFails(batch.commit());
  });
  test('Bob cannot attach a forged receipt to Alice existing public report',async()=>{
    await create(alice);
    const existing=(await getDocFromServer(report(reader))).data();
    await assertFails(setDoc(receipt(bob,'bob'),{placeID:PLACE,submittedAt:existing.submittedAt}));
    const attack=writeBatch(bob);attack.set(receipt(bob,'bob'),{placeID:PLACE,submittedAt:existing.submittedAt});attack.delete(report(bob));await assertFails(attack.commit());
    const overwrite=writeBatch(bob);overwrite.set(receipt(bob,'bob'),receiptFields());overwrite.set(report(bob),fields());await assertFails(overwrite.commit());
    assert.equal((await getDocFromServer(report(reader))).exists(),true);
  });
  test('same owner cannot reuse a receipt ID at another place; a new owner at another place is independent',async()=>{
    await create(alice);
    await assertFails(create(alice,{place:OTHER_PLACE}));
    await assertSucceeds(create(bob,{place:OTHER_PLACE,uid:'bob'}));
    await assertFails(remove(alice,{place:OTHER_PLACE}));
  });
  test('owner deletion removes both documents atomically; standalone and other-user deletes fail',async()=>{
    await create(alice);
    await assertFails(deleteDoc(report(alice)));await assertFails(deleteDoc(receipt(alice)));
    await assertFails(remove(bob,{uid:'bob'}));await assertFails(remove(reader));await assertFails(remove(anonymous,{uid:'guest'}));
    await assertSucceeds(remove(alice));
    assert.equal((await getDocFromServer(report(reader))).exists(),false);assert.equal((await getDocFromServer(receipt(alice))).exists(),false);
  });
  test('public and receipt updates, including schema deletion and owner injection, are always denied',async()=>{
    await create(alice);
    for(const change of [{soap:'no'},{uid:'alice'},{placeID:OTHER_PLACE},{observedAt:serverTimestamp()},{submittedAt:serverTimestamp()}]) await assertFails(updateDoc(report(alice),change));
    await assertFails(setDoc(report(alice),{soap:'no'}));await assertFails(updateDoc(receipt(alice),{placeID:OTHER_PLACE}));await assertFails(setDoc(receipt(alice),receiptFields()));
  });
  test('observation dates are bounded; server submission time is mandatory on both documents',async()=>{
    for(const observedAt of [Timestamp.fromDate(new Date('1999-12-31T23:59:59Z')),Timestamp.fromDate(new Date(Date.now()+86400000)),null,'2026-01-01',123]) await assertFails(create(alice,{publicData:{...fields(),observedAt}}));
    for(const submittedAt of [observed,null,123,'today']) {
      await assertFails(create(alice,{publicData:{...fields(),submittedAt}}));
      await assertFails(create(alice,{privateData:{...receiptFields(),submittedAt}}));
    }
    await assertSucceeds(create(alice,{publicData:{...fields(),observedAt:Timestamp.fromDate(new Date('2000-01-01T00:00:00Z'))}}));
  });
  test('all-unknown reports are rejected while each single known observation is sufficient',async()=>{
    const unknown={...fields(),soap:'not-reported'};
    await assertFails(create(alice,{publicData:unknown}));
    let i=0;
    for(const change of [{entryRule:'public'},{entryRule:'customers'},{purchaseRequired:'no'},{codeRequired:'no'},{stairs:'yes'},{soap:'no'},{toiletPaper:'yes'},{floor:'entrance'},{condition:'usable'}]) {
      await assertSucceeds(create(alice,{id:String(++i).padStart(20,'S'),publicData:{...unknown,...change}}));
    }
  });
  test('unknown or untrusted places cannot gain a report by manufacturing a rating summary',async()=>{
    for(const place of ['missing-place','community-abcdefghijklmnopqrst']) await assertFails(create(alice,{place}));
    const batch=writeBatch(alice);const place='manufactured-place';batch.set(doc(alice,'restroomRatingSummaries',place),{ratingCount:0,ratingSum:0,updatedAt:serverTimestamp()});batch.set(report(alice,ID,place),{...fields(),placeID:place});batch.set(receipt(alice),{...receiptFields(),placeID:place});await assertFails(batch.commit());
  });
  for(const field of Object.keys(fields())) test(`missing public ${field} is rejected`,async()=>{const data=fields();delete data[field];await assertFails(create(alice,{publicData:data}));});
  for(const [field,value] of Object.entries({uid:'alice',ownerUID:'alice',email:'private@example.org',name:'Private',notes:'Text',code:'1234',latitude:40.7,longitude:-74,isAdmin:true})) test(`public ${field} injection is rejected`,async()=>{await assertFails(create(alice,{publicData:{...fields(),[field]:value}}));});
  for(const [field,value] of [['entryRule','everyone'],['floor','accessible'],['condition',5],['soap',true],['stairs',null],['codeRequired','unknown'],['purchaseRequired',['no']],['toiletPaper','x'.repeat(10000)]]) test(`invalid public enum ${field} is rejected`,async()=>{await assertFails(create(alice,{publicData:{...fields(),[field]:value}}));});
  for(const extra of [{ownerUID:'alice'},{uid:'alice'},{email:'private@example.org'},{code:'1234'}]) test(`private receipt rejects extra ${Object.keys(extra)[0]}`,async()=>{await assertFails(create(alice,{privateData:{...receiptFields(),...extra}}));});
  for(const id of ['bad','a'.repeat(21),'a'.repeat(19)+'_']) test(`invalid report ID ${id} rejected`,async()=>{await assertFails(create(alice,{id}));});
  test('administrative mismatched or orphan receipts cannot authorize a deletion',async()=>{
    await create(alice);
    await env.withSecurityRulesDisabled(async context=>{await setDoc(receipt(context.firestore(),'bob'),{placeID:OTHER_PLACE,submittedAt:observed});});
    await assertFails(remove(bob,{uid:'bob'}));
    await env.withSecurityRulesDisabled(async context=>{const data=(await getDocFromServer(report(context.firestore()))).data();await setDoc(receipt(context.firestore(),'bob'),{placeID:PLACE,submittedAt:observed});assert.notEqual(data.submittedAt.toMillis(),observed.toMillis());});
    await assertFails(remove(bob,{uid:'bob'}));
  });
});
