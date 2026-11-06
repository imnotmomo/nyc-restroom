import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { before, after, beforeEach, test } from 'node:test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocFromServer, getDocsFromServer, limit, query, setDoc, setLogLevel, Timestamp, writeBatch } from 'firebase/firestore';

const PLACE='i7jb-7jku:row-sdk-note',ID='PublicSDKNote0000001';
const workspace=await mkdtemp(join(tmpdir(),'restroom-public-note-sdk-'));
async function moduleURL(name,source){const path=join(workspace,name+'.mjs');await writeFile(path,source);return pathToFileURL(path).href;}
const modelURL=await moduleURL('model',stripTypeScriptTypes(await readFile(new URL('../../lib/public-note-model.ts',import.meta.url),'utf8')));
const firebaseURL=import.meta.resolve('firebase/firestore');
const clientURL=await moduleURL('client','export const getFirebaseClient=()=>globalThis.__publicNoteSDKClient;export const getFirebaseConfigurationError=()=>null;');
const wrappedFirebaseURL=await moduleURL('firebase',`
  import * as real from ${JSON.stringify(firebaseURL)};
  export * from ${JSON.stringify(firebaseURL)};
  // rules-unit-testing returns a compat app; preserve its already-connected instance.
  export function getFirestore() { return globalThis.__publicNoteSDKDatabase; }
  export function runTransaction(database, callback, options) {
    const hooks=globalThis.__publicNoteSDKHooks;
    if(hooks.failReads>0){hooks.failReads--;return Promise.reject({code:'unavailable'});}
    return real.runTransaction(database, callback, options);
  }
  export function writeBatch(database) {
    const batch=real.writeBatch(database);
    const original=batch.commit.bind(batch);
    batch.commit=async()=>{
      const hooks=globalThis.__publicNoteSDKHooks, mode=hooks.mode;hooks.mode=null;
      if(mode==='before-error')throw {code:'unavailable'};
      await original();
      if(mode==='after-error')throw {code:'unavailable'};
      if(mode==='readback-error')hooks.failReads=1;
      if(mode==='account-change')globalThis.__publicNoteSDKClient.auth.currentUser={uid:'bob',isAnonymous:false};
      if(mode==='same-uid-replacement')globalThis.__publicNoteSDKClient.auth.currentUser={uid:'alice',isAnonymous:false};
    };
    return batch;
  }
`);
const serviceSource=stripTypeScriptTypes(await readFile(new URL('../../lib/public-notes.ts',import.meta.url),'utf8'))
  .replaceAll('"firebase/firestore"',JSON.stringify(wrappedFirebaseURL))
  .replaceAll('"@/lib/firebase-client"',JSON.stringify(clientURL))
  .replaceAll('"@/lib/public-note-model"',JSON.stringify(modelURL))
  .replace('const code = typeof error','globalThis.__publicNoteSDKHooks.errors.push({message:error?.message,code:error?.code}); const code = typeof error');
const api=await import(await moduleURL('service',serviceSource));
const input=()=>({observedAt:new Date('2026-01-01T12:00:00Z'),body:'A dated public observation.',condition:'not-reported',soap:'yes',toiletPaper:'not-reported',stairs:'no'});
let env,alice,bob,reader;
function client(db,uid='alice',isAnonymous=false){globalThis.__publicNoteSDKDatabase=db._delegate??db;globalThis.__publicNoteSDKClient={app:db.app,auth:{currentUser:uid?{uid,isAnonymous}:null}};}
function watchUntil(check){
  return new Promise((resolve,reject)=>{
    let stop=()=>{};
    const timer=setTimeout(()=>{stop();reject(new Error('Public watcher did not reach its expected confirmed state'));},5000);
    stop=api.watchPublicNotes(PLACE,reports=>{if(check(reports)){clearTimeout(timer);stop();resolve(reports);}},error=>{clearTimeout(timer);stop();reject(error);});
  });
}

before(async()=>{
  setLogLevel('silent');const endpoint=new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST??'127.0.0.1:8185'}`);
  env=await initializeTestEnvironment({projectId:'demo-restroom-public-notes-sdk',firestore:{host:endpoint.hostname,port:Number(endpoint.port),rules:await readFile(new URL('../../firebase/firestore.rules',import.meta.url),'utf8')}});
  alice=env.authenticatedContext('alice',{firebase:{sign_in_provider:'google.com'}}).firestore();bob=env.authenticatedContext('bob',{firebase:{sign_in_provider:'google.com'}}).firestore();reader=env.unauthenticatedContext().firestore();
});
beforeEach(async()=>{
  globalThis.__publicNoteSDKHooks={mode:null,failReads:0,errors:[]};client(alice);
  await env.clearFirestore();await env.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),'restroomRatingSummaries',PLACE),{ratingCount:0,ratingSum:0,updatedAt:Timestamp.fromDate(new Date('2026-01-01'))}));
});
after(async()=>{if(env){try{await env.clearFirestore();}finally{await env.cleanup();}}delete globalThis.__publicNoteSDKClient;delete globalThis.__publicNoteSDKDatabase;delete globalThis.__publicNoteSDKHooks;await rm(workspace,{recursive:true,force:true});});

test('actual SDK creates confirmed public observation, loads own visible IDs, and deletes atomically',async()=>{
  const id=api.newPublicNoteID();assert.match(id,/^[A-Za-z0-9]{20}$/);
  let created;try{created=await api.createPublicNote('alice',PLACE,id,input());}catch(error){throw new Error(error.message+' '+JSON.stringify(globalThis.__publicNoteSDKHooks.errors));}
  assert.equal(created.id,id);assert.equal(created.placeID,PLACE);assert.ok(created.submittedAt instanceof Date);assert.equal(created.observedAt.toISOString(),input().observedAt.toISOString());
  const publicData=(await getDocFromServer(doc(reader,'restroomPublicNotes',PLACE,'notes',id))).data();
  assert.deepEqual(Object.keys(publicData).sort(),['schemaVersion','placeID','observedAt','submittedAt','body','condition','soap','toiletPaper','stairs'].sort());
  assert.equal(publicData.schemaVersion,1);assert.equal(publicData.body,input().body);
  const privateData=(await getDocFromServer(doc(alice,'users','alice','restroomReadyPublicNoteReceipts',id))).data();
  assert.deepEqual(Object.keys(privateData).sort(),['placeID','submittedAt']);assert.equal(privateData.submittedAt.isEqual(publicData.submittedAt),true);
  assert.deepEqual(await api.readOwnPublicNoteIDs('alice',PLACE,[id]),[id]);
  client(reader,null);const reports=await watchUntil(reports=>reports.length===1);assert.equal(reports[0].id,id);
  client(bob,'bob');assert.deepEqual(await api.readOwnPublicNoteIDs('bob',PLACE,[id]),[]);
  await assert.rejects(api.deletePublicNote('bob',PLACE,id),/earlier request/);
  client(alice);await api.deletePublicNote('alice',PLACE,id);
  assert.equal((await getDocFromServer(doc(reader,'restroomPublicNotes',PLACE,'notes',id))).exists(),false);
  await api.deletePublicNote('alice',PLACE,id); // Already-confirmed removal is idempotent.
});

test('stable ID retry recognizes exact prior commit, rejects changed draft, and does not duplicate',async()=>{
  const initial=await api.createPublicNote('alice',PLACE,ID,input());
  const again=await api.createPublicNote('alice',PLACE,ID,input());assert.equal(again.submittedAt.getTime(),initial.submittedAt.getTime());
  await assert.rejects(api.createPublicNote('alice',PLACE,ID,{...input(),soap:'no'}),/earlier version/);
  assert.equal((await getDocsFromServer(query(collection(reader,'restroomPublicNotes',PLACE,'notes'),limit(10)))).size,1);
});

test('lost commit acknowledgement is recovered through exact server report and own receipt',async()=>{
  globalThis.__publicNoteSDKHooks.mode='after-error';
  const result=await api.createPublicNote('alice',PLACE,ID,input());assert.equal(result.id,ID);
  assert.equal((await getDocsFromServer(query(collection(reader,'restroomPublicNotes',PLACE,'notes'),limit(10)))).size,1);
});

test('lost delete acknowledgement confirms both documents are gone before returning success',async()=>{
  await api.createPublicNote('alice',PLACE,ID,input());
  globalThis.__publicNoteSDKHooks.mode='after-error';
  await api.deletePublicNote('alice',PLACE,ID);
  assert.equal((await getDocFromServer(doc(reader,'restroomPublicNotes',PLACE,'notes',ID))).exists(),false);
  assert.equal((await getDocFromServer(doc(alice,'users','alice','restroomReadyPublicNoteReceipts',ID))).exists(),false);
});

test('failed precommit and failed postcommit readback retain the stable ID for safe retries',async()=>{
  globalThis.__publicNoteSDKHooks.mode='before-error';await assert.rejects(api.createPublicNote('alice',PLACE,ID,input()),/could not be confirmed/);
  assert.equal((await getDocFromServer(doc(reader,'restroomPublicNotes',PLACE,'notes',ID))).exists(),false);
  globalThis.__publicNoteSDKHooks.mode='readback-error';await assert.rejects(api.createPublicNote('alice',PLACE,ID,input()),/could not be confirmed/);
  const confirmed=await api.createPublicNote('alice',PLACE,ID,input());assert.equal(confirmed.id,ID);
  assert.equal((await getDocsFromServer(query(collection(reader,'restroomPublicNotes',PLACE,'notes'),limit(10)))).size,1);
});

test('concurrent SDK requests for the same exact observation resolve to one public report',async()=>{
  const results=await Promise.all([api.createPublicNote('alice',PLACE,ID,input()),api.createPublicNote('alice',PLACE,ID,input())]);
  assert.equal(results[0].submittedAt.getTime(),results[1].submittedAt.getTime());
  assert.equal((await getDocsFromServer(query(collection(reader,'restroomPublicNotes',PLACE,'notes'),limit(10)))).size,1);
});

test('account switches cannot return another user success or authorize later mutation',async()=>{
  globalThis.__publicNoteSDKHooks.mode='account-change';await assert.rejects(api.createPublicNote('alice',PLACE,ID,input()),/account changed/);
  assert.equal((await getDocFromServer(doc(reader,'restroomPublicNotes',PLACE,'notes',ID))).exists(),true);
  await assert.rejects(api.deletePublicNote('alice',PLACE,ID),/account changed/);
  client(bob,'bob');await assert.rejects(api.deletePublicNote('bob',PLACE,ID),/earlier request/);
  client(alice);assert.equal((await api.createPublicNote('alice',PLACE,ID,input())).id,ID);
});

test('ownership checks are bounded to displayed IDs, reject invalid requests, and never use receipt lists',async()=>{
  await api.createPublicNote('alice',PLACE,ID,input());
  assert.deepEqual(await api.readOwnPublicNoteIDs('alice',PLACE,[ID,ID]),[ID]);
  await assert.rejects(api.readOwnPublicNoteIDs('alice',PLACE,Array(11).fill(ID)),/visible notes/);
  await assert.rejects(api.readOwnPublicNoteIDs('alice',PLACE,['invalid']),/visible notes/);
  client(alice,'guest',true);await assert.rejects(api.createPublicNote('guest',PLACE,ID,input()),/Sign in with Google/);
  client(reader,null);await assert.rejects(api.readOwnPublicNoteIDs('alice',PLACE,[ID]),/Sign in with Google/);
});

test('anonymous public SDK watcher returns latest ten submitted notes, retaining their actual visit dates',async()=>{
  await env.withSecurityRulesDisabled(async context=>{
    const batch=writeBatch(context.firestore());
    for(let i=0;i<12;i++)batch.set(doc(context.firestore(),'restroomPublicNotes',PLACE,'notes',String(i).padStart(20,'R')),{...input(),schemaVersion:1,placeID:PLACE,observedAt:Timestamp.fromDate(new Date(Date.UTC(2026,0,1+i))),submittedAt:Timestamp.fromDate(new Date(Date.UTC(2026,1,20-i)))});
    await batch.commit();
  });
  client(reader,null);const reports=await watchUntil(reports=>reports.length===10);
  assert.equal(reports[0].id,String(0).padStart(20,'R'));assert.equal(reports.at(-1).id,String(9).padStart(20,'R'));
});

test('malformed administrative public records are hidden individually with a warning',async()=>{
  await api.createPublicNote('alice',PLACE,ID,input());
  await env.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),'restroomPublicNotes',PLACE,'notes','BadPublicNote0000001'),{...input(),schemaVersion:1,placeID:PLACE,observedAt:Timestamp.fromDate(input().observedAt),submittedAt:Timestamp.now(),email:'must-not-display@example.org'}));
  client(reader,null);
  const result=await new Promise((resolve,reject)=>{
    let reports=[],stop=()=>{};const timer=setTimeout(()=>{stop();reject(new Error('Expected malformed-report warning'));},5000);
    stop=api.watchPublicNotes(PLACE,items=>{reports=items;},error=>{clearTimeout(timer);stop();resolve({reports,error});});
  });
  assert.equal(result.reports.length,1);assert.equal(result.reports[0].id,ID);assert.match(result.error.message,/hidden/);
  assert.equal(JSON.stringify(result.reports).includes('email'),false);
});

test('same UID with a replaced authentication session cannot return stale operation success',async()=>{
  globalThis.__publicNoteSDKHooks.mode='same-uid-replacement';
  await assert.rejects(api.createPublicNote('alice',PLACE,ID,input()),/account changed/);
  assert.equal((await getDocFromServer(doc(reader,'restroomPublicNotes',PLACE,'notes',ID))).exists(),true);
  assert.equal((await api.createPublicNote('alice',PLACE,ID,input())).id,ID);
  assert.equal((await getDocsFromServer(query(collection(reader,'restroomPublicNotes',PLACE,'notes'),limit(10)))).size,1);
});

test('partial administrative pairs fail closed without overwriting or removing either surviving document',async()=>{
  for(const side of ['public','receipt']){
    const noteID=side==='public'?'PartialPublicNote001':'PartialReceiptNote01';
    assert.equal(noteID.length,20);
    await env.withSecurityRulesDisabled(async context=>{
      const db=context.firestore(), stamp=Timestamp.fromDate(new Date('2026-01-02'));
      if(side==='public')await setDoc(doc(db,'restroomPublicNotes',PLACE,'notes',noteID),{...input(),schemaVersion:1,placeID:PLACE,observedAt:Timestamp.fromDate(input().observedAt),submittedAt:stamp});
      else await setDoc(doc(db,'users','alice','restroomReadyPublicNoteReceipts',noteID),{placeID:PLACE,submittedAt:stamp});
    });
    await assert.rejects(api.createPublicNote('alice',PLACE,noteID,input()),/needs checking/);
    await assert.rejects(api.deletePublicNote('alice',PLACE,noteID),/needs checking/);
    assert.equal((await getDocFromServer(doc(reader,'restroomPublicNotes',PLACE,'notes',noteID))).exists(),side==='public');
    assert.equal((await getDocFromServer(doc(alice,'users','alice','restroomReadyPublicNoteReceipts',noteID))).exists(),side==='receipt');
  }
});

test('a same-ID receipt for another place does not grant note ownership',async()=>{
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore(), stamp=Timestamp.fromDate(new Date('2026-01-02'));
    await setDoc(doc(db,'restroomPublicNotes',PLACE,'notes',ID),{...input(),schemaVersion:1,placeID:PLACE,observedAt:Timestamp.fromDate(input().observedAt),submittedAt:stamp});
    await setDoc(doc(db,'users','alice','restroomReadyPublicNoteReceipts',ID),{placeID:'i7jb-7jku:row-other-place',submittedAt:stamp});
  });
  assert.deepEqual(await api.readOwnPublicNoteIDs('alice',PLACE,[ID]),[]);
  await assert.rejects(api.deletePublicNote('alice',PLACE,ID),/needs checking/);
  assert.equal((await getDocFromServer(doc(reader,'restroomPublicNotes',PLACE,'notes',ID))).exists(),true);
});

test('visible ownership requires an exact public and private Timestamp pair, not merely a valid receipt',async()=>{
  for(const kind of ['missing-public','different-nanos','invalid-public']){
    const id=kind.replaceAll('-','').padEnd(20,'X');
    const stamp=new Timestamp(1_767_312_000,123_000_000);
    await env.withSecurityRulesDisabled(async context=>{
      const db=context.firestore();
      await setDoc(doc(db,'users','alice','restroomReadyPublicNoteReceipts',id),{placeID:PLACE,submittedAt:stamp});
      if(kind!=='missing-public')await setDoc(doc(db,'restroomPublicNotes',PLACE,'notes',id),{
        ...input(),schemaVersion:1,placeID:PLACE,observedAt:Timestamp.fromDate(input().observedAt),
        submittedAt:kind==='different-nanos'?new Timestamp(stamp.seconds,stamp.nanoseconds+1_000):stamp,
        ...(kind==='invalid-public'?{body:'Unsupported\u0000body'}:{}),
      });
    });
    await assert.rejects(api.readOwnPublicNoteIDs('alice',PLACE,[id]),/ownership|invalid/);
    assert.equal((await getDocFromServer(doc(alice,'users','alice','restroomReadyPublicNoteReceipts',id))).exists(),true);
  }
});

test('future-submitted public records are hidden and cannot be marked as owned',async()=>{
  await api.createPublicNote('alice',PLACE,ID,input());
  const id='FutureSubmittedNoteX',stamp=Timestamp.fromDate(new Date(Date.now()+86_400_000));
  assert.equal(id.length,20);
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(doc(db,'restroomPublicNotes',PLACE,'notes',id),{...input(),schemaVersion:1,placeID:PLACE,observedAt:Timestamp.fromDate(input().observedAt),submittedAt:stamp});
    await setDoc(doc(db,'users','alice','restroomReadyPublicNoteReceipts',id),{placeID:PLACE,submittedAt:stamp});
  });
  await assert.rejects(api.readOwnPublicNoteIDs('alice',PLACE,[id]),/invalid dates/);
  client(reader,null);
  const result=await new Promise((resolve,reject)=>{
    let reports=[],stop=()=>{};const timer=setTimeout(()=>{stop();reject(new Error('Expected future-report warning'));},5000);
    stop=api.watchPublicNotes(PLACE,items=>{reports=items;},error=>{clearTimeout(timer);stop();resolve({reports,error});});
  });
  assert.deepEqual(result.reports.map(note=>note.id),[ID]);assert.match(result.error.message,/hidden/);
});

test('account deletion lock blocks new public note pairs even with an existing issued account context',async()=>{
  await env.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),'accountDeletionLocks','alice'),{phase:'pending'}));
  await assert.rejects(api.createPublicNote('alice',PLACE,ID,input()),/not authorized/);
  assert.equal((await getDocFromServer(doc(reader,'restroomPublicNotes',PLACE,'notes',ID))).exists(),false);
});
