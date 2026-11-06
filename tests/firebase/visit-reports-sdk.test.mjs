import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { before, after, beforeEach, test } from 'node:test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocFromServer, getDocsFromServer, limit, query, setDoc, setLogLevel, Timestamp, writeBatch } from 'firebase/firestore';

const PLACE='i7jb-7jku:row-sdk-visit',ID='VisitSDKReport000001';
const workspace=await mkdtemp(join(tmpdir(),'restroom-visit-sdk-'));
async function moduleURL(name,source){const path=join(workspace,name+'.mjs');await writeFile(path,source);return pathToFileURL(path).href;}
const modelURL=await moduleURL('model',stripTypeScriptTypes(await readFile(new URL('../../lib/visit-report-model.ts',import.meta.url),'utf8')));
const firebaseURL=import.meta.resolve('firebase/firestore');
const clientURL=await moduleURL('client','export const getFirebaseClient=()=>globalThis.__visitSDKClient;export const getFirebaseConfigurationError=()=>null;');
const wrappedFirebaseURL=await moduleURL('firebase',`
  import * as real from ${JSON.stringify(firebaseURL)};
  export * from ${JSON.stringify(firebaseURL)};
  // rules-unit-testing returns a compat app; preserve its already-connected instance.
  export function getFirestore() { return globalThis.__visitSDKDatabase; }
  export function getDocFromServer(reference) {
    const hooks=globalThis.__visitSDKHooks;
    if(hooks.failReads>0){hooks.failReads--;return Promise.reject({code:'unavailable'});}
    return real.getDocFromServer(reference);
  }
  export function runTransaction(database, action) {
    const hooks=globalThis.__visitSDKHooks;
    // The same failed-readback case now fails the whole coherent server read.
    if(hooks.failReads>0){hooks.failReads=0;return Promise.reject({code:'unavailable'});}
    return real.runTransaction(database,action);
  }
  export function writeBatch(database) {
    const batch=real.writeBatch(database);
    const original=batch.commit.bind(batch);
    batch.commit=async()=>{
      const hooks=globalThis.__visitSDKHooks, mode=hooks.mode;hooks.mode=null;
      if(mode==='before-error')throw {code:'unavailable'};
      await original();
      if(mode==='after-error')throw {code:'unavailable'};
      if(mode==='readback-error')hooks.failReads=2;
      if(mode==='account-change')globalThis.__visitSDKClient.auth.currentUser={uid:'bob',isAnonymous:false};
    };
    return batch;
  }
`);
const serviceSource=stripTypeScriptTypes(await readFile(new URL('../../lib/visit-reports.ts',import.meta.url),'utf8'))
  .replaceAll('"firebase/firestore"',JSON.stringify(wrappedFirebaseURL))
  .replaceAll('"@/lib/firebase-client"',JSON.stringify(clientURL))
  .replaceAll('"@/lib/visit-report-model"',JSON.stringify(modelURL))
  .replace('const code = typeof error','globalThis.__visitSDKHooks.errors.push({message:error?.message,code:error?.code}); const code = typeof error');
const api=await import(await moduleURL('service',serviceSource));
const input=()=>({observedAt:new Date('2026-01-01T12:00:00Z'),entryRule:'public',purchaseRequired:'not-reported',codeRequired:'no',stairs:'no',soap:'yes',toiletPaper:'not-reported',floor:'entrance',condition:'not-reported'});
let env,alice,bob,reader;
function client(db,uid='alice',isAnonymous=false){globalThis.__visitSDKDatabase=db._delegate??db;globalThis.__visitSDKClient={app:db.app,auth:{currentUser:uid?{uid,isAnonymous}:null}};}
function watchUntil(check){
  return new Promise((resolve,reject)=>{
    let stop=()=>{};
    const timer=setTimeout(()=>{stop();reject(new Error('Public watcher did not reach its expected confirmed state'));},5000);
    stop=api.watchVisitReports(PLACE,reports=>{if(check(reports)){clearTimeout(timer);stop();resolve(reports);}},error=>{clearTimeout(timer);stop();reject(error);});
  });
}

before(async()=>{
  setLogLevel('silent');const endpoint=new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST??'127.0.0.1:8088'}`);
  env=await initializeTestEnvironment({projectId:'demo-restroom-visit-sdk',firestore:{host:endpoint.hostname,port:Number(endpoint.port),rules:await readFile(new URL('../../firebase/firestore.rules',import.meta.url),'utf8')}});
  alice=env.authenticatedContext('alice',{firebase:{sign_in_provider:'google.com'}}).firestore();bob=env.authenticatedContext('bob',{firebase:{sign_in_provider:'google.com'}}).firestore();reader=env.unauthenticatedContext().firestore();
});
beforeEach(async()=>{
  globalThis.__visitSDKHooks={mode:null,failReads:0,errors:[]};client(alice);
  await env.clearFirestore();await env.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),'restroomRatingSummaries',PLACE),{ratingCount:0,ratingSum:0,updatedAt:Timestamp.fromDate(new Date('2026-01-01'))}));
});
after(async()=>{if(env){try{await env.clearFirestore();}finally{await env.cleanup();}}delete globalThis.__visitSDKClient;delete globalThis.__visitSDKDatabase;delete globalThis.__visitSDKHooks;await rm(workspace,{recursive:true,force:true});});

test('actual SDK creates confirmed public observation, loads own visible IDs, and deletes atomically',async()=>{
  const id=api.newVisitReportID();assert.match(id,/^[A-Za-z0-9]{20}$/);
  let created;try{created=await api.createVisitReport('alice',PLACE,id,input());}catch(error){throw new Error(error.message+' '+JSON.stringify(globalThis.__visitSDKHooks.errors));}
  assert.equal(created.id,id);assert.equal(created.placeID,PLACE);assert.ok(created.submittedAt instanceof Date);assert.equal(created.observedAt.toISOString(),input().observedAt.toISOString());
  assert.deepEqual(await api.readOwnVisitReportIDs('alice',PLACE,[id]),[id]);
  client(reader,null);const reports=await watchUntil(reports=>reports.length===1);assert.equal(reports[0].id,id);
  client(bob,'bob');assert.deepEqual(await api.readOwnVisitReportIDs('bob',PLACE,[id]),[]);
  await assert.rejects(api.deleteVisitReport('bob',PLACE,id),/earlier request/);
  client(alice);await api.deleteVisitReport('alice',PLACE,id);
  assert.equal((await getDocFromServer(doc(reader,'restroomVisitReports',PLACE,'reports',id))).exists(),false);
  await api.deleteVisitReport('alice',PLACE,id); // Already-confirmed removal is idempotent.
});

test('stable ID retry recognizes exact prior commit, rejects changed draft, and does not duplicate',async()=>{
  const initial=await api.createVisitReport('alice',PLACE,ID,input());
  const again=await api.createVisitReport('alice',PLACE,ID,input());assert.equal(again.submittedAt.getTime(),initial.submittedAt.getTime());
  await assert.rejects(api.createVisitReport('alice',PLACE,ID,{...input(),soap:'no'}),/earlier version/);
  assert.equal((await getDocsFromServer(query(collection(reader,'restroomVisitReports',PLACE,'reports'),limit(10)))).size,1);
});

test('lost commit acknowledgement is recovered through exact server report and own receipt',async()=>{
  globalThis.__visitSDKHooks.mode='after-error';
  const result=await api.createVisitReport('alice',PLACE,ID,input());assert.equal(result.id,ID);
  assert.equal((await getDocsFromServer(query(collection(reader,'restroomVisitReports',PLACE,'reports'),limit(10)))).size,1);
});

test('lost delete acknowledgement confirms both documents are gone before returning success',async()=>{
  await api.createVisitReport('alice',PLACE,ID,input());
  globalThis.__visitSDKHooks.mode='after-error';
  await api.deleteVisitReport('alice',PLACE,ID);
  assert.equal((await getDocFromServer(doc(reader,'restroomVisitReports',PLACE,'reports',ID))).exists(),false);
  assert.equal((await getDocFromServer(doc(alice,'users','alice','restroomReadyVisitReceipts',ID))).exists(),false);
});

test('failed precommit and failed postcommit readback retain the stable ID for safe retries',async()=>{
  globalThis.__visitSDKHooks.mode='before-error';await assert.rejects(api.createVisitReport('alice',PLACE,ID,input()),/couldn’t be confirmed/);
  assert.equal((await getDocFromServer(doc(reader,'restroomVisitReports',PLACE,'reports',ID))).exists(),false);
  globalThis.__visitSDKHooks.mode='readback-error';await assert.rejects(api.createVisitReport('alice',PLACE,ID,input()),/couldn’t be confirmed/);
  const confirmed=await api.createVisitReport('alice',PLACE,ID,input());assert.equal(confirmed.id,ID);
  assert.equal((await getDocsFromServer(query(collection(reader,'restroomVisitReports',PLACE,'reports'),limit(10)))).size,1);
});

test('concurrent SDK requests for the same exact observation resolve to one public report',async()=>{
  const results=await Promise.all([api.createVisitReport('alice',PLACE,ID,input()),api.createVisitReport('alice',PLACE,ID,input())]);
  assert.equal(results[0].submittedAt.getTime(),results[1].submittedAt.getTime());
  assert.equal((await getDocsFromServer(query(collection(reader,'restroomVisitReports',PLACE,'reports'),limit(10)))).size,1);
});

test('account switches cannot return another user success or authorize later mutation',async()=>{
  globalThis.__visitSDKHooks.mode='account-change';await assert.rejects(api.createVisitReport('alice',PLACE,ID,input()),/account changed/);
  assert.equal((await getDocFromServer(doc(reader,'restroomVisitReports',PLACE,'reports',ID))).exists(),true);
  await assert.rejects(api.deleteVisitReport('alice',PLACE,ID),/account changed/);
  client(bob,'bob');await assert.rejects(api.deleteVisitReport('bob',PLACE,ID),/earlier request/);
  client(alice);assert.equal((await api.createVisitReport('alice',PLACE,ID,input())).id,ID);
});

test('ownership checks are bounded to displayed IDs, reject invalid requests, and never use receipt lists',async()=>{
  await api.createVisitReport('alice',PLACE,ID,input());
  assert.deepEqual(await api.readOwnVisitReportIDs('alice',PLACE,[ID,ID]),[ID]);
  await assert.rejects(api.readOwnVisitReportIDs('alice',PLACE,Array(11).fill(ID)),/visible visit reports/);
  await assert.rejects(api.readOwnVisitReportIDs('alice',PLACE,['invalid']),/visible visit reports/);
  client(alice,'guest',true);await assert.rejects(api.createVisitReport('guest',PLACE,ID,input()),/Sign in with Google/);
  client(reader,null);await assert.rejects(api.readOwnVisitReportIDs('alice',PLACE,[ID]),/account changed/);
});

test('anonymous public SDK watcher returns latest ten observations, not latest submissions',async()=>{
  await env.withSecurityRulesDisabled(async context=>{
    const batch=writeBatch(context.firestore());
    for(let i=0;i<12;i++)batch.set(doc(context.firestore(),'restroomVisitReports',PLACE,'reports',String(i).padStart(20,'R')),{...input(),placeID:PLACE,observedAt:Timestamp.fromDate(new Date(Date.UTC(2026,0,1+i))),submittedAt:Timestamp.fromDate(new Date(Date.UTC(2026,1,20-i)))});
    await batch.commit();
  });
  client(reader,null);const reports=await watchUntil(reports=>reports.length===10);
  assert.equal(reports[0].id,String(11).padStart(20,'R'));assert.equal(reports.at(-1).id,String(2).padStart(20,'R'));
});

test('malformed administrative public records are hidden individually with a warning',async()=>{
  await api.createVisitReport('alice',PLACE,ID,input());
  await env.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),'restroomVisitReports',PLACE,'reports','BadVisitReport000001'),{...input(),placeID:PLACE,observedAt:Timestamp.fromDate(input().observedAt),submittedAt:Timestamp.now(),email:'must-not-display@example.org'}));
  client(reader,null);
  const result=await new Promise((resolve,reject)=>{
    let reports=[],stop=()=>{};const timer=setTimeout(()=>{stop();reject(new Error('Expected malformed-report warning'));},5000);
    stop=api.watchVisitReports(PLACE,items=>{reports=items;},error=>{clearTimeout(timer);stop();resolve({reports,error});});
  });
  assert.equal(result.reports.length,1);assert.equal(result.reports[0].id,ID);assert.match(result.error.message,/hidden/);
  assert.equal(JSON.stringify(result.reports).includes('email'),false);
});

const unifiedRef=(db,id=ID)=>doc(db,'restroomUnifiedVisits',PLACE,'reports',id);
const unifiedData=(change={})=>({...input(),schemaVersion:1,placeID:PLACE,observedAt:Timestamp.fromDate(input().observedAt),submittedAt:Timestamp.fromDate(new Date('2026-02-01T12:00:00Z')),comment:'A dated public comment.',anonymous:true,authorName:null,...change});
function watchUnifiedUntil(check){
  return new Promise((resolve,reject)=>{
    let stop=()=>{};const timer=setTimeout(()=>{stop();reject(new Error('Unified public watcher did not reach its expected confirmed state'));},5000);
    stop=api.watchUnifiedVisitReports(PLACE,reports=>{if(check(reports)){clearTimeout(timer);stop();resolve(reports);}},error=>{clearTimeout(timer);stop();reject(error);});
  });
}
test('anonymous actual API reads strict unified comments and chosen names without legacy mutation',async()=>{
  await env.withSecurityRulesDisabled(async context=>{
    await setDoc(unifiedRef(context.firestore()),unifiedData());
    await setDoc(unifiedRef(context.firestore(),'NamedUnified00000001'),unifiedData({anonymous:false,authorName:' A Visitor '}));
  });
  client(reader,null);const rows=await watchUnifiedUntil(rows=>rows.length===2);
  assert.equal(rows.find(row=>row.id===ID).authorName,null);assert.equal(rows.find(row=>row.id==='NamedUnified00000001').authorName,' A Visitor ');
  assert.equal(rows[0].comment,'A dated public comment.');assert.equal(JSON.stringify(rows).includes('ownerUID'),false);
  client(alice);const legacy=await api.createVisitReport('alice',PLACE,ID,input());assert.equal(legacy.id,ID);
  const legacyWire=(await getDocFromServer(doc(reader,'restroomVisitReports',PLACE,'reports',ID))).data();assert.equal(Object.keys(legacyWire).length,11);assert.equal('comment'in legacyWire,false);
});
test('unified actual API is bounded to the ten latest visits rather than posting order',async()=>{
  await env.withSecurityRulesDisabled(async context=>{
    const batch=writeBatch(context.firestore());
    for(let i=0;i<12;i++)batch.set(unifiedRef(context.firestore(),String(i).padStart(20,'U')),unifiedData({observedAt:Timestamp.fromDate(new Date(Date.UTC(2026,0,1+i))),submittedAt:Timestamp.fromDate(new Date(Date.UTC(2026,1,20-i)))}));
    await batch.commit();
  });
  client(reader,null);const rows=await watchUnifiedUntil(rows=>rows.length===10);
  assert.equal(rows[0].id,String(11).padStart(20,'U'));assert.equal(rows.at(-1).id,String(2).padStart(20,'U'));
});
test('actual unified watcher reads optional amenity-only observations without inventing legacy values',async()=>{
  await env.withSecurityRulesDisabled(async context=>{
    await setDoc(unifiedRef(context.firestore()),unifiedData({comment:'',entryRule:'not-reported',purchaseRequired:'not-reported',codeRequired:'not-reported',stairs:'not-reported',soap:'not-reported',toiletPaper:'not-reported',floor:'not-reported',condition:'not-reported',elevatorPresent:'yes',automaticDoorPresent:'no'}));
    await setDoc(unifiedRef(context.firestore(),'OldUnified0000000001'),unifiedData());
  });
  client(reader,null);const rows=await watchUnifiedUntil(rows=>rows.length===2);
  const observed=rows.find(row=>row.id===ID),old=rows.find(row=>row.id==='OldUnified0000000001');
  assert.equal(observed.elevatorPresent,'yes');assert.equal(observed.automaticDoorPresent,'no');assert.equal(observed.stairs,'not-reported');
  assert.equal(Object.hasOwn(old,'elevatorPresent'),false);assert.equal(Object.hasOwn(old,'automaticDoorPresent'),false);
});
test('strict unified decoder hides malformed fields, names and nanosecond-reversed dates individually',async()=>{
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();const batch=writeBatch(db);batch.set(unifiedRef(db),unifiedData());
    const stamp=Timestamp.fromDate(new Date('2026-01-01T12:00:00Z'));
    const bad=[{schemaVersion:true},{ownerUID:'must-not-return'},{anonymous:true,authorName:'Unexpected name'},{anonymous:false,authorName:null},{comment:'bad\u0000text'},{submittedAt:Timestamp.fromMillis(Date.now()+60_000)},{observedAt:new Timestamp(stamp.seconds,2000),submittedAt:new Timestamp(stamp.seconds,1000)}];
    bad.forEach((change,index)=>batch.set(unifiedRef(db,String(index).padStart(20,'B')),unifiedData(change)));await batch.commit();
  });
  client(reader,null);const result=await new Promise((resolve,reject)=>{
    let rows=[],stop=()=>{};const timer=setTimeout(()=>{stop();reject(new Error('Expected hidden unified report warning'));},5000);
    stop=api.watchUnifiedVisitReports(PLACE,value=>{rows=value;},error=>{clearTimeout(timer);stop();resolve({rows,error});});
  });
  assert.deepEqual(result.rows.map(row=>row.id),[ID]);assert.match(result.error.message,/hidden/);assert.doesNotMatch(JSON.stringify(result.rows),/must-not-return/);
});
test('legacy removal never deletes a same-ID unified report or confers its ownership',async()=>{
  await api.createVisitReport('alice',PLACE,ID,input());
  await env.withSecurityRulesDisabled(context=>setDoc(unifiedRef(context.firestore()),unifiedData()));
  await api.deleteVisitReport('alice',PLACE,ID);
  assert.equal((await getDocFromServer(doc(reader,'restroomVisitReports',PLACE,'reports',ID))).exists(),false);
  assert.equal((await getDocFromServer(unifiedRef(reader))).exists(),true);
  assert.deepEqual(await api.readOwnVisitReportIDs('alice',PLACE,[ID]),[]);
});
test('unified unsubscribe suppresses queued setup errors and later live callbacks',async()=>{
  let errors=0;const stopInvalid=api.watchUnifiedVisitReports('invalid/path',()=>{throw new Error('unexpected setup data');},()=>{errors++;});stopInvalid();await Promise.resolve();assert.equal(errors,0);
  await env.withSecurityRulesDisabled(context=>setDoc(unifiedRef(context.firestore()),unifiedData()));
  client(reader,null);let calls=0,stop=()=>{};
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{stop();reject(new Error('Expected initial unified row'));},5000);stop=api.watchUnifiedVisitReports(PLACE,rows=>{calls++;if(rows.length){clearTimeout(timer);resolve();}},reject);});
  stop();const before=calls;await env.withSecurityRulesDisabled(context=>setDoc(unifiedRef(context.firestore(),'SecondUnified0000001'),unifiedData()));
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(calls,before);
});
