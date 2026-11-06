import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, describe, test } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, deleteDoc, doc, getDocFromServer, getDocsFromServer,
  limit, orderBy, query, setDoc, setLogLevel, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';

const PLACE='i7jb-7jku:row-source-test', COMMUNITY='community-1234567890abcdef1234';
const ID='1234567890abcdef1234', stamp=Timestamp.fromDate(new Date('2026-10-21T20:00:00Z'));
const value=(placeID=PLACE)=>({placeID,sourceID:'xhs-source-test',sourceKind:'comment',
  text:'The source describes a restroom downstairs.',displayName:'Anonymous user',publishedOn:null,
  displayedDate:'10/3',dateStatus:'unknown-year',sourceURL:null,sourceTitle:'Xiaohongshu restroom discussion',
  capturedAt:'2026-10-21T19:00:00.000Z',observedOn:null,verified:false,
  limitations:'Source year not established. Not independently verified.',submittedAt:stamp});
const target=(db,place=PLACE,id=ID)=>doc(db,'restroomSourceComments',place,'comments',id);
let env,reader,alice,guest;

describe('imported source notes are public read-only projections',{concurrency:false},()=>{
  before(async()=>{
    setLogLevel('silent');
    const endpoint=new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST??'127.0.0.1:8197'}`);
    env=await initializeTestEnvironment({projectId:'demo-restroom-source-notes',firestore:{
      host:endpoint.hostname,port:Number(endpoint.port),
      rules:await readFile(new URL('../../firebase/firestore.rules',import.meta.url),'utf8')}});
    reader=env.unauthenticatedContext().firestore();
    alice=env.authenticatedContext('alice',{firebase:{sign_in_provider:'google.com'}}).firestore();
    guest=env.authenticatedContext('guest',{firebase:{sign_in_provider:'anonymous'}}).firestore();
  });
  beforeEach(async()=>{
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async(context)=>{
      const db=context.firestore(),batch=writeBatch(db);
      for(const place of [PLACE,COMMUNITY]){
        batch.set(doc(db,'restroomRatingSummaries',place),{ratingCount:0,ratingSum:0,updatedAt:stamp});
        batch.set(target(db,place),value(place));
      }
      batch.set(doc(db,'communityRestrooms',COMMUNITY),{name:'Emulator fixture'});
      batch.set(doc(db,'restroomResearch','xhs-fixture','sources','xhs-source-test'),{author:'Private source fixture',transcript:'Private original fixture'});
      batch.set(target(db,'orphan-place'),value('orphan-place'));
      await batch.commit();
    });
  });
  after(async()=>{if(env){try{await env.clearFirestore();}finally{await env.cleanup();}}});

  test('signed-out visitors can read curated notes on existing city and community places',async()=>{
    for(const place of [PLACE,COMMUNITY]){
      const snapshot=await assertSucceeds(getDocFromServer(target(reader,place)));
      assert.equal(snapshot.data().displayName,'Anonymous user');
      assert.equal(snapshot.data().verified,false);
      assert.equal(snapshot.data().observedOn,null);
      assert.equal('author' in snapshot.data(),false);
    }
  });
  test('latest-ten per-place query works; unbounded, excessive and cross-place feeds fail',async()=>{
    assert.equal((await assertSucceeds(getDocsFromServer(query(collection(reader,'restroomSourceComments',PLACE,'comments'),orderBy('submittedAt','desc'),limit(10))))).size,1);
    await assertFails(getDocsFromServer(collection(reader,'restroomSourceComments',PLACE,'comments')));
    await assertFails(getDocsFromServer(query(collection(reader,'restroomSourceComments',PLACE,'comments'),limit(11))));
    await assertFails(getDocsFromServer(query(collectionGroup(reader,'comments'),limit(10))));
    await assertFails(getDocsFromServer(collection(reader,'restroomSourceComments')));
  });
  test('every browser identity is denied creation, mutation, deletion and author spoofing',async()=>{
    for(const db of [reader,alice,guest]){
      await assertFails(setDoc(target(db,PLACE,'abcdef1234567890abcd'),value()));
      await assertFails(updateDoc(target(db),{displayName:'A real visitor',verified:true,ownerUID:'alice'}));
      await assertFails(setDoc(target(db),{...value(),text:'x'.repeat(100000),email:'private@example.org'}));
      await assertFails(deleteDoc(target(db)));
      assert.equal((await getDocFromServer(target(reader))).data().displayName,'Anonymous user');
    }
  });
  test('source originals remain private for every browser identity',async()=>{
    for(const db of [reader,alice,guest]){
      await assertFails(getDocFromServer(doc(db,'restroomResearch','xhs-fixture','sources','xhs-source-test')));
      await assertFails(getDocsFromServer(query(collection(db,'restroomResearch','xhs-fixture','sources'),limit(10))));
    }
  });
  test('orphan places and malformed note IDs are unreadable',async()=>{
    await assertFails(getDocFromServer(target(reader,'orphan-place')));
    await assertFails(getDocFromServer(target(reader,PLACE,'bad')));
    await assertFails(getDocsFromServer(query(collection(reader,'restroomSourceComments','orphan-place','comments'),limit(10))));
  });
});
