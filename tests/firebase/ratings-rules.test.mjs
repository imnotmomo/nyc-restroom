import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, collectionGroup, deleteDoc, doc, getDocFromServer, getDocsFromServer,
  increment, query, runTransaction, serverTimestamp, setDoc, setLogLevel,
  Timestamp, where, writeBatch,
} from 'firebase/firestore';

const PROJECT_ID='demo-restroom-ratings';
const PLACE='i7jb-7jku:row-xb7j_yzsr~cp6w';
const SECOND_PLACE='i7jb-7jku:second-source-record';
const ALICE='alice';
let environment,alice,bob,signedOut,anonymousProvider;
const summary=(database,place=PLACE)=>doc(database,'restroomRatingSummaries',place);
const vote=(database,uid=ALICE,place=PLACE)=>doc(summary(database,place),'ratings',uid);
const totals=(ratingCount,ratingSum)=>({ratingCount,ratingSum,updatedAt:serverTimestamp()});
const voteData=stars=>({stars,updatedAt:serverTimestamp()});
class RatingUnchanged extends Error {}

function batchRating(database,{uid=ALICE,place=PLACE,stars=4,count=1,sum=stars,summaryData,votePayload}={}){
 const batch=writeBatch(database);
 batch.set(summary(database,place),summaryData??totals(count,sum));
 if(stars===null)batch.delete(vote(database,uid,place));
 else batch.set(vote(database,uid,place),votePayload??voteData(stars));
 return batch.commit();
}

async function transactRating(database,uid,stars,place=PLACE){
 for(let attempt=0;attempt<3;attempt++){
  let previous=null,attemptedWrite=false,previousVersion=null;
  try{
   await runTransaction(database,async transaction=>{
    const beforeSummary=await transaction.get(summary(database,place));
    previousVersion=beforeSummary.data().updatedAt;
    const beforeVote=await transaction.get(vote(database,uid,place));
    previous=beforeVote.exists()?beforeVote.data().stars:null;
    if(previous===stars)throw new RatingUnchanged();
    attemptedWrite=true;
    transaction.update(summary(database,place),{ratingCount:increment((stars===null?0:1)-(previous===null?0:1)),ratingSum:increment((stars??0)-(previous??0)),updatedAt:serverTimestamp()});
    if(stars===null)transaction.delete(vote(database,uid,place));
    else transaction.set(vote(database,uid,place),voteData(stars));
   });
   return;
  }catch(error){
   if(error instanceof RatingUnchanged)return;
   if(attempt<2&&attemptedWrite&&error.code==='permission-denied'){
    const [freshSummary,fresh]=await Promise.all([getDocFromServer(summary(database,place)),getDocFromServer(vote(database,uid,place))]);
    const latest=fresh.exists()?fresh.data().stars:null;
    if(latest===stars)return;
    if(latest!==previous||!freshSummary.data().updatedAt.isEqual(previousVersion))continue;
   }
   throw error;
  }
 }
}

describe('public cleanliness rating rules',{concurrency:false},()=>{
 before(async()=>{
  const endpoint=new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST??'127.0.0.1:8088'}`);
  setLogLevel('silent');
  environment=await initializeTestEnvironment({projectId:PROJECT_ID,firestore:{host:endpoint.hostname,port:Number(endpoint.port),rules:await readFile(new URL('../../firebase/firestore.rules',import.meta.url),'utf8')}});
  alice=environment.authenticatedContext(ALICE,{firebase:{sign_in_provider:'google.com'}}).firestore();
  bob=environment.authenticatedContext('bob',{firebase:{sign_in_provider:'github.com'}}).firestore();
  anonymousProvider=environment.authenticatedContext('guest',{firebase:{sign_in_provider:'anonymous'}}).firestore();
  signedOut=environment.unauthenticatedContext().firestore();
 });
 beforeEach(async()=>{
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context=>{
   for(const place of [PLACE,SECOND_PLACE])await setDoc(summary(context.firestore(),place),{ratingCount:0,ratingSum:0,updatedAt:Timestamp.fromDate(new Date('2020-01-01T00:00:00Z'))});
  });
 });
 after(async()=>{if(environment){try{await environment.clearFirestore();}finally{await environment.cleanup();}}});

 test('signed-out visitors get summaries and query only nonzero aggregates',async()=>{
  assert.equal((await assertSucceeds(getDocFromServer(summary(signedOut)))).data().ratingCount,0);
  const sparse=query(collection(signedOut,'restroomRatingSummaries'),where('ratingCount','>',0));
  assert.equal((await assertSucceeds(getDocsFromServer(sparse))).size,0);
  await transactRating(alice,ALICE,4);
  const result=await assertSucceeds(getDocsFromServer(sparse));
  assert.equal(result.size,1);
  assert.deepEqual(Object.keys(result.docs[0].data()).sort(),['ratingCount','ratingSum','updatedAt']);
  await assertFails(getDocsFromServer(collection(signedOut,'restroomRatingSummaries')));
 });

 test('owner adds, changes and removes one vote while retaining zero summary',async()=>{
  await assertSucceeds(transactRating(alice,ALICE,4));
  assert.equal((await getDocFromServer(summary(signedOut))).data().ratingSum,4);
  const own=await assertSucceeds(getDocFromServer(vote(alice)));
  assert.equal(own.data().stars,4);assert.ok(own.data().updatedAt instanceof Timestamp);
  await assertSucceeds(transactRating(alice,ALICE,2));
  let data=(await getDocFromServer(summary(signedOut))).data();
  assert.equal(data.ratingCount,1);assert.equal(data.ratingSum,2);
  await assertSucceeds(transactRating(alice,ALICE,null));
  data=(await getDocFromServer(summary(signedOut))).data();
  assert.equal(data.ratingCount,0);assert.equal(data.ratingSum,0);
  assert.equal((await getDocFromServer(vote(alice))).exists(),false);
 });

 test('simultaneous accounts and repeated same-account transactions preserve exact totals',async()=>{
  await assert.doesNotReject(Promise.all([transactRating(alice,ALICE,4),transactRating(bob,'bob',2)]),'two different accounts adding votes');
  let data=(await getDocFromServer(summary(signedOut))).data();
  assert.equal(data.ratingCount,2);assert.equal(data.ratingSum,6);
  await assert.doesNotReject(Promise.all([transactRating(alice,ALICE,5),transactRating(bob,'bob',null)]),'one account editing while another removes its vote');
  data=(await getDocFromServer(summary(signedOut))).data();
  assert.equal(data.ratingCount,1);assert.equal(data.ratingSum,5);
  await assert.doesNotReject(Promise.all([transactRating(alice,ALICE,3),transactRating(alice,ALICE,3)]),'the same account repeating a requested value');
  data=(await getDocFromServer(summary(signedOut))).data();
  assert.equal(data.ratingCount,1);assert.equal(data.ratingSum,3);
 });

 test('a non-anonymous account using a different provider may rate its own listing',async()=>{
  await assertSucceeds(transactRating(bob,'bob',2));
  const data=(await getDocFromServer(summary(signedOut))).data();
  assert.equal(data.ratingCount,1);assert.equal(data.ratingSum,2);
 });

 test('same-account competing edit and removal keep aggregate consistent with the final vote',async()=>{
  await transactRating(alice,ALICE,4);
  await Promise.all([transactRating(alice,ALICE,2),transactRating(alice,ALICE,null)]);
  const finalVote=await getDocFromServer(vote(alice));
  const aggregate=(await getDocFromServer(summary(signedOut))).data();
  assert.equal(aggregate.ratingCount,finalVote.exists()?1:0);
  assert.equal(aggregate.ratingSum,finalVote.exists()?finalVote.data().stars:0);
 });

 test('another user, signed-out visitor and anonymous-provider account cannot get or list raw votes',async()=>{
  await transactRating(alice,ALICE,4);
  for(const database of [bob,signedOut,anonymousProvider]){
   await assertFails(getDocFromServer(vote(database)));
   await assertFails(getDocsFromServer(collection(summary(database),'ratings')));
   await assertFails(getDocsFromServer(collectionGroup(database,'ratings')));
  }
  await assertFails(getDocsFromServer(collection(summary(alice),'ratings')));
  await assertFails(getDocsFromServer(collectionGroup(alice,'ratings')));
 });

 test('signed-out and anonymous-provider clients cannot vote even with a paired aggregate',async()=>{
  await assertFails(batchRating(signedOut));
  await assertFails(batchRating(anonymousProvider,{uid:'guest'}));
 });

 test('clients cannot bootstrap an unlisted summary or delete a seeded summary',async()=>{
  await assertFails(setDoc(summary(alice,'unseeded-place'),totals(0,0)));
  await assertFails(batchRating(alice,{place:'unseeded-place'}));
  await assertFails(deleteDoc(summary(alice)));
  await transactRating(alice,ALICE,4);
  const batch=writeBatch(alice);batch.delete(vote(alice));batch.delete(summary(alice));
  await assertFails(batch.commit());
 });

 test('vote-only create, update and delete cannot bypass the aggregate',async()=>{
  await assertFails(setDoc(vote(alice),voteData(4)));
  await transactRating(alice,ALICE,4);
  await assertFails(setDoc(vote(alice),voteData(5)));
  await assertFails(setDoc(vote(alice),voteData(4)));
  await assertFails(deleteDoc(vote(alice)));
 });

 test('aggregate-only writes and replay inflation fail before and after a vote',async()=>{
  await assertFails(setDoc(summary(alice),totals(1,4)));
  await transactRating(alice,ALICE,4);
  await assertFails(setDoc(summary(alice),totals(2,8)));
  await assertFails(setDoc(summary(alice),totals(1,4)));
  await assertFails(batchRating(alice,{stars:4,count:2,sum:8}));
  await assertFails(batchRating(alice,{stars:4,count:1,sum:4}));
  assert.equal((await getDocFromServer(summary(alice))).data().ratingCount,1);
 });

 test('a batch cannot replace another account’s vote or modify a different listing summary',async()=>{
  await assertFails(batchRating(alice,{uid:'bob'}));
  await transactRating(alice,ALICE,4);
  await assertFails(batchRating(bob,{uid:ALICE,stars:5,count:1,sum:5}));
  const batch=writeBatch(alice);
  batch.set(vote(alice,ALICE,SECOND_PLACE),voteData(3));
  batch.set(summary(alice),totals(2,7));
  await assertFails(batch.commit());
 });

 test('wrong count/sum deltas are rejected for an update and a deletion',async()=>{
  await transactRating(alice,ALICE,4);
  await assertFails(batchRating(alice,{stars:5,count:2,sum:9}));
  await assertFails(batchRating(alice,{stars:5,count:1,sum:4}));
  await assertFails(batchRating(alice,{stars:null,count:0,sum:1}));
  await assertFails(batchRating(alice,{stars:null,count:1,sum:0}));
 });

 for(const stars of [0,6,-1,3.5,'4',true,null,[],{}]){
  test(`vote rejects invalid stars ${JSON.stringify(stars)}`,async()=>{
   await assertFails(batchRating(alice,{votePayload:{stars,updatedAt:serverTimestamp()},sum:4}));
  });
 }

 for(const name of ['missing stars','missing timestamp','extra identity','extra privilege','past timestamp','future timestamp','string timestamp']){
  const payload=()=>{
   const normal=voteData(4);
   if(name==='missing stars')delete normal.stars;
   if(name==='missing timestamp')delete normal.updatedAt;
   if(name==='extra identity')normal.email='must-not-be-public@example.test';
   if(name==='extra privilege')normal.isAdmin=true;
   if(name==='past timestamp')normal.updatedAt=Timestamp.fromMillis(1);
   if(name==='future timestamp')normal.updatedAt=Timestamp.fromMillis(Date.now()+86_400_000);
   if(name==='string timestamp')normal.updatedAt='now';
   return normal;
  };
  test(`vote create rejects ${name}`,async()=>{await assertFails(batchRating(alice,{votePayload:payload()}));});
  test(`vote update rejects ${name}`,async()=>{await transactRating(alice,ALICE,4);await assertFails(batchRating(alice,{votePayload:payload()}));});
 }

 const invalidSummaries=[
  ['negative count',()=>totals(-1,0)],['fractional count',()=>totals(1.5,4)],
  ['fractional sum',()=>totals(1,4.5)],['oversized count',()=>totals(1_000_001,4_000_004)],
  ['sum above five per vote',()=>totals(1,6)],['sum below one per vote',()=>totals(1,0)],
  ['nonzero empty sum',()=>totals(0,1)],['missing count',()=>({ratingSum:4,updatedAt:serverTimestamp()})],
  ['missing sum',()=>({ratingCount:1,updatedAt:serverTimestamp()})],['missing timestamp',()=>({ratingCount:1,ratingSum:4})],
  ['PII field',()=>({...totals(1,4),email:'private@example.test'})],['privilege field',()=>({...totals(1,4),isAdmin:true})],
  ['forged past time',()=>({...totals(1,4),updatedAt:Timestamp.fromMillis(1)})],
  ['forged future time',()=>({...totals(1,4),updatedAt:Timestamp.fromMillis(Date.now()+86_400_000)})],
 ];
 for(const[name,make]of invalidSummaries)test(`aggregate rejects ${name}`,async()=>{
  await assertFails(batchRating(alice,{summaryData:make()}));
 });

 test('a valid rating transaction cannot smuggle profile, private-note or nested collection writes',async()=>{
  for(const path of ['users/alice','roles/alice',`restroomRatingSummaries/${PLACE}/ratings/alice/attachments/injected`]){
   const batch=writeBatch(alice);
   batch.set(summary(alice),totals(1,4));batch.set(vote(alice),voteData(4));
   batch.set(doc(alice,path),{isAdmin:true});
   await assertFails(batch.commit());
  }
 });
});
